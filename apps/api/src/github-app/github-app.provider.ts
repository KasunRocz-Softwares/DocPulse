import { createSign } from "node:crypto";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export type GitHubInstallation = {
  id: string;
  accountLogin: string;
  accountType: string;
};

export type GitHubRepository = {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string | null;
  private: boolean;
  htmlUrl: string;
};

export interface GitHubAppProvider {
  isConfigured(): boolean;
  getInstallUrl(state: string): string;
  getInstallation(installationId: string): Promise<GitHubInstallation>;
  listRepositories(installationId: string): Promise<GitHubRepository[]>;
}

export const GITHUB_APP_PROVIDER = Symbol("GITHUB_APP_PROVIDER");

@Injectable()
export class GitHubApiAppProvider implements GitHubAppProvider {
  isConfigured(): boolean {
    return Boolean(
      process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_SLUG &&
      process.env.GITHUB_APP_PRIVATE_KEY &&
      process.env.GITHUB_APP_WEBHOOK_SECRET &&
      process.env.GITHUB_APP_ADMIN_ORIGIN,
    );
  }

  getInstallUrl(state: string): string {
    if (!this.isConfigured())
      throw new ServiceUnavailableException("GitHub App is not configured");
    const url = new URL(
      `https://github.com/apps/${encodeURIComponent(process.env.GITHUB_APP_SLUG!)}/installations/new`,
    );
    url.searchParams.set("state", state);
    return url.toString();
  }

  async getInstallation(installationId: string): Promise<GitHubInstallation> {
    const data = asRecord(
      await this.appRequest(`/app/installations/${installationId}`),
    );
    const account = asRecord(data.account);
    const id = numericId(data.id);
    const accountLogin = boundedString(account.login, 120);
    const accountType = boundedString(account.type, 40);
    if (!id || id !== installationId || !accountLogin || !accountType)
      throw new ServiceUnavailableException(
        "GitHub returned an invalid installation response",
      );
    return { id, accountLogin, accountType };
  }

  async listRepositories(installationId: string): Promise<GitHubRepository[]> {
    const token = await this.createInstallationToken(installationId);
    const repositories: GitHubRepository[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const data = await this.request(
        `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
        token,
      );
      const entries = Array.isArray(asRecord(data).repositories)
        ? (asRecord(data).repositories as unknown[])
        : [];
      for (const entry of entries) {
        const repo = asRecord(entry);
        const owner = boundedString(asRecord(repo.owner).login, 120);
        const name = boundedString(repo.name, 160);
        const id = numericId(repo.id);
        if (!id || !owner || !name) continue;
        repositories.push({
          id,
          owner,
          name,
          fullName: `${owner}/${name}`,
          defaultBranch: boundedString(repo.default_branch, 255) || null,
          private: repo.private === true,
          htmlUrl: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
        });
      }
      const total = Number(asRecord(data).total_count);
      if (
        entries.length < 100 ||
        (Number.isFinite(total) && page * 100 >= total)
      )
        break;
    }
    return repositories;
  }

  private async appRequest(path: string): Promise<unknown> {
    return this.request(
      `https://api.github.com${path}`,
      await this.createAppJwt(),
    );
  }

  private async createInstallationToken(installationId: string) {
    const data = asRecord(
      await this.request(
        `https://api.github.com/app/installations/${installationId}/access_tokens`,
        await this.createAppJwt(),
        "POST",
      ),
    );
    if (typeof data.token !== "string" || data.token.length < 20)
      throw new ServiceUnavailableException(
        "GitHub did not return an installation token",
      );
    // Installation tokens are intentionally ephemeral and never written to storage or logs.
    return data.token;
  }

  private async createAppJwt(): Promise<string> {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n",
    );
    if (!appId || !privateKey)
      throw new ServiceUnavailableException("GitHub App is not configured");
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(
      JSON.stringify({ iat: now - 30, exp: now + 8 * 60, iss: appId }),
    );
    const input = `${header}.${payload}`;
    try {
      const signer = createSign("RSA-SHA256");
      signer.update(input);
      signer.end();
      return `${input}.${signer.sign(privateKey).toString("base64url")}`;
    } catch {
      throw new ServiceUnavailableException(
        "GitHub App credentials are invalid",
      );
    }
  }

  private async request(
    url: string,
    token: string,
    method: "GET" | "POST" = "GET",
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "RDPS-GitHub-App",
        },
      });
    } catch {
      throw new ServiceUnavailableException("GitHub API request failed");
    }
    if (!response.ok) {
      // Never return provider response bodies, which can contain credential or account details.
      await response.body?.cancel();
      throw new ServiceUnavailableException(
        `GitHub API request failed (${response.status})`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new ServiceUnavailableException("GitHub returned invalid JSON");
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

function numericId(value: unknown): string | null {
  const id = typeof value === "number" ? String(value) : value;
  return typeof id === "string" && /^\d{1,40}$/.test(id) ? id : null;
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}
