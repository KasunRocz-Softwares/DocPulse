import {
  authorizationCodeGrant,
  allowInsecureRequests,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretBasic,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  enableNonRepudiationChecks,
  type Configuration,
} from "openid-client";

export const OIDC_PROTOCOL = Symbol("OIDC_PROTOCOL");

export type OidcSettings = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
};

export type OidcTransaction = {
  state: string;
  nonce: string;
  codeVerifier: string;
  purpose?: "login" | "link";
  userId?: string;
};

export interface OidcProtocol {
  createTransaction(): Promise<OidcTransaction>;
  authorizationUrl(
    settings: OidcSettings,
    transaction: OidcTransaction,
  ): Promise<string>;
  exchange(
    settings: OidcSettings,
    callbackUrl: string,
    transaction: OidcTransaction,
  ): Promise<Record<string, unknown>>;
}

export class OpenIdClientProtocol implements OidcProtocol {
  private cacheKey = "";
  private configuration: Promise<Configuration> | undefined;

  async createTransaction(): Promise<OidcTransaction> {
    return {
      state: randomState(),
      nonce: randomNonce(),
      codeVerifier: randomPKCECodeVerifier(),
    };
  }

  async authorizationUrl(settings: OidcSettings, transaction: OidcTransaction) {
    const config = await this.getConfiguration(settings);
    const codeChallenge = await calculatePKCECodeChallenge(
      transaction.codeVerifier,
    );
    return buildAuthorizationUrl(config, {
      redirect_uri: settings.callbackUrl,
      response_type: "code",
      scope: "openid email profile",
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
  }

  async exchange(
    settings: OidcSettings,
    callbackUrl: string,
    transaction: OidcTransaction,
  ) {
    const config = await this.getConfiguration(settings);
    const tokens = await authorizationCodeGrant(config, new URL(callbackUrl), {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
    });
    return (tokens.claims() ?? {}) as Record<string, unknown>;
  }

  private getConfiguration(settings: OidcSettings) {
    const key = `${settings.issuer}\n${settings.clientId}\n${settings.clientSecret}`;
    if (this.configuration && this.cacheKey === key) return this.configuration;
    this.cacheKey = key;
    const issuerUrl = new URL(settings.issuer);
    const localHttp =
      issuerUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(issuerUrl.hostname);
    if (issuerUrl.protocol !== "https:" && !localHttp)
      throw new Error(
        "OIDC issuer must use HTTPS outside loopback development",
      );
    this.configuration = discovery(
      new URL(settings.issuer),
      settings.clientId,
      { client_secret: settings.clientSecret },
      ClientSecretBasic(settings.clientSecret),
      {
        execute: localHttp
          ? [allowInsecureRequests, enableNonRepudiationChecks]
          : [enableNonRepudiationChecks],
      },
    ).catch((error: unknown) => {
      this.configuration = undefined;
      this.cacheKey = "";
      throw error;
    });
    return this.configuration;
  }
}
