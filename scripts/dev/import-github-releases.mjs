#!/usr/bin/env node
/**
 * Import GitHub releases into RDPS and publish them through the normal
 * review workflow (local development and demos).
 *
 *   node scripts/dev/import-github-releases.mjs [options]
 *
 * Options (defaults in brackets):
 *   --repo <owner/name>       GitHub repository [Storemate-OMS/oms-fe]
 *   --line <prefix>           Tag family to import, e.g. prod, ent, beta [prod]
 *   --project-name <name>     RDPS project name [Storemate OMS]
 *   --project-slug <slug>     RDPS project slug [storemate-oms]
 *   --api <url>               RDPS API base [http://localhost:13001/api/v1]
 *   --site <url>              Public site, for the printed link [http://localhost:5174]
 *   --admin-email <email>     Publisher (Admin) account [$RDPS_ADMIN_EMAIL]
 *   --reviewer-email <email>  Second account that approves [reviewer@example.test]
 *   --limit <n>               Import only the newest n releases
 *   --dry-run                 Print the mapping; make no RDPS changes
 *
 * Release notes come from `gh api` (uses your GitHub CLI login). Passwords
 * are prompted with hidden input (or read as two lines from stdin when not a
 * terminal: admin password, then reviewer password). The two-person rule is
 * kept: the reviewer approves, the admin publishes.
 *
 * Re-running is safe: versions already in the project are skipped.
 */
import { execFileSync } from "node:child_process";
import readline from "node:readline";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const config = {
  repo: option("repo", "Storemate-OMS/oms-fe"),
  line: option("line", "prod"),
  projectName: option("project-name", "Storemate OMS"),
  projectSlug: option("project-slug", "storemate-oms"),
  api: option("api", "http://localhost:13001/api/v1").replace(/\/+$/, ""),
  site: option("site", "http://localhost:5174").replace(/\/+$/, ""),
  adminEmail: option("admin-email", process.env.RDPS_ADMIN_EMAIL ?? ""),
  reviewerEmail: option("reviewer-email", "reviewer@example.test"),
  limit: Number(option("limit", "0")) || 0,
  dryRun: args.includes("--dry-run"),
};

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- mapping

const CHANNELS = {
  prod: "STABLE",
  ent: "STABLE",
  beta: "BETA",
  canary: "ALPHA",
};
// Branch-style prefixes such as "feature/", "Feaure/", "fix(scope):".
const PREFIX = /^[a-z]+(?:\([^)]*\))?\s*[/:]\s*/i;
// Merge and version-bump PRs that carry no user-facing change.
const NOISE =
  /^(?:(?:master|main|develop|dev|beta|prod|production|staging|release|ent|canary)(?:[\s-]+(?:to[\s-]+)?(?:master|main|develop|dev|beta|prod|production|staging|release|ent|canary|new))*|v?\d+(?:\.\d+)+)$/i;

/** Map `1.25.0` → 1.25.0 and the 4th hotfix number `1.25.0.1` → 1.25.0-hotfix.1. */
export function mapVersion(raw) {
  const parts = raw.split(".").map((part) => Number(part));
  if (parts.length < 3 || parts.some((part) => !Number.isInteger(part)))
    return null;
  const [major, minor, patch, hotfix] = parts;
  const base = `${major}.${minor}.${patch}`;
  if (parts.length === 3 || !hotfix)
    return { version: base, base, type: patch ? "PATCH" : "MINOR", hotfix: 0 };
  return { version: `${base}-hotfix.${hotfix}`, base, type: "HOTFIX", hotfix };
}

/** Turn a raw PR title into a readable public sentence. */
export function cleanTitle(raw) {
  let title = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“]+|["'”]+$/g, "");
  const conventional = /^[a-z]+\(([^)]+)\):\s*/i.exec(title);
  title = title.replace(PREFIX, "");
  // Drop ticket-style IDs left by branch names ("z93r0b7fju", "86exau9rd").
  title = title.replace(
    /^(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{6,14}[\s-]+/i,
    "",
  );
  if (/^[\w-]+$/.test(title)) title = title.replace(/[-_]+/g, " ");
  title = title.replace(/\s+/g, " ").trim();
  if (
    conventional &&
    !title.toLowerCase().includes(conventional[1].toLowerCase())
  )
    title = `${conventional[1].replace(/[-_]+/g, " ")}: ${title}`;
  if (!title) title = raw.trim();
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function categorize(raw) {
  const text = raw.toLowerCase();
  if (/^(perf|performance)\b|\bperf\(|debounce|faster|optimi[sz]/.test(text))
    return "PERFORMANCE";
  if (/\bsecurity\b|\bpermission|\b2fa\b|\bauth/.test(text)) return "SECURITY";
  if (
    /^(fix|hotfix|bugfix|bug)\b|\bfix(es|ed)?\b|\bbug\b|doesn.?t|not working|issue/.test(
      text,
    )
  )
    return "FIX";
  if (
    /^(refactor|improvement|improve|perf|chore)\b|redesign|refactor|enhance|improv|update|optimi/.test(
      text,
    )
  )
    return "IMPROVEMENT";
  if (
    /^(feature|feat|add)\b|\badd\b|\bnew\b|report|dashboard|feature/.test(text)
  )
    return "FEATURE";
  return "OTHER";
}

/** Parse GitHub's generated notes: "* <title> by @user in <url>". */
export function parseChanges(body) {
  const seen = new Set();
  const changes = [];
  for (const line of (body ?? "").split(/\r?\n/)) {
    const match =
      /^\s*[*-]\s+(.+?)(?:\s+by\s+@[\w-]+(?:\[bot\])?)?(?:\s+in\s+(https:\/\/\S+))?\s*$/.exec(
        line,
      );
    if (!match || /^\*\*full changelog/i.test(line.trim())) continue;
    const rawTitle = match[1].trim();
    const title = cleanTitle(rawTitle).slice(0, 240);
    if (
      title.length < 2 ||
      NOISE.test(title.replace(/[-\s]+$/, "")) ||
      seen.has(title.toLowerCase())
    )
      continue;
    seen.add(title.toLowerCase());
    changes.push({
      title,
      category: categorize(rawTitle),
      internalDescription: line.trim().slice(0, 20000),
      publicDescription: `${title.replace(/[.…]+$/, "")}.`,
    });
  }
  return changes;
}

export function planRelease(release, line) {
  const raw = release.tag_name.slice(line.length + 1);
  const mapped = mapVersion(raw);
  if (!mapped) return null;
  let changes = parseChanges(release.body);
  const compare = /\*\*Full Changelog\*\*:\s*(\S+)/.exec(
    release.body ?? "",
  )?.[1];
  if (changes.length === 0)
    changes = [
      {
        title: mapped.hotfix ? "Hotfix" : "Maintenance release",
        category: mapped.hotfix ? "FIX" : "OTHER",
        internalDescription: `GitHub release ${release.tag_name} had no itemised notes.${compare ? ` Changelog: ${compare}` : ""}`,
        publicDescription: "No detailed notes were published for this release.",
      },
    ];
  const label =
    { prod: "Production", ent: "Enterprise", beta: "Beta", canary: "Canary" }[
      line
    ] ?? line;
  return {
    tag: release.tag_name,
    version: mapped.version,
    type: mapped.type,
    channel: CHANNELS[line] ?? "STABLE",
    title: `${label} ${mapped.base}${mapped.hotfix ? ` hotfix ${mapped.hotfix}` : ""}`,
    releaseDate: release.published_at,
    internalSummary: `Imported from GitHub release ${release.tag_name}: ${release.html_url}`,
    changes,
  };
}

// ------------------------------------------------------------------- I/O

function loadGitHubReleases() {
  let output;
  try {
    output = execFileSync(
      "gh",
      ["api", "--paginate", `repos/${config.repo}/releases?per_page=100`],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    fail(
      `Could not read GitHub releases with the gh CLI (${error.message.split("\n")[0]}). Run "gh auth login" first.`,
    );
  }
  return JSON.parse(output.replace(/\]\s*\[/g, ","));
}

async function readPasswords() {
  if (!process.stdin.isTTY) {
    const lines = [];
    const rl = readline.createInterface({ input: process.stdin });
    for await (const line of rl) {
      lines.push(line);
      if (lines.length === 2) break;
    }
    rl.close();
    return lines;
  }
  const ask = (prompt) =>
    new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      let muted = false;
      rl._writeToOutput = (text) => {
        if (!muted) process.stdout.write(text);
      };
      rl.question(prompt, (answer) => {
        rl.close();
        process.stdout.write("\n");
        resolve(answer);
      });
      muted = true;
    });
  return [
    await ask(`Password for ${config.adminEmail} (publishes): `),
    await ask(`Password for ${config.reviewerEmail} (approves): `),
  ];
}

async function call(token, method, path, body) {
  const response = await fetch(`${config.api}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = Array.isArray(payload?.message)
      ? payload.message.join("; ")
      : (payload?.message ?? text);
    throw new Error(`${method} ${path} → ${response.status}: ${message}`);
  }
  return payload;
}

async function signIn(email, password) {
  const result = await call(null, "POST", "/internal/auth/login", {
    email,
    password,
  });
  return { token: result.accessToken, user: result.user };
}

// ------------------------------------------------------------------- main

const all = loadGitHubReleases();
const prefix = `${config.line}-`;
let plans = all
  .filter((release) => !release.draft && release.tag_name.startsWith(prefix))
  .map((release) => planRelease(release, config.line))
  .filter(Boolean);
if (config.limit) plans = plans.slice(0, config.limit);
plans.reverse(); // publish oldest first so the newest ends up "latest"

const seenVersions = new Set();
plans = plans.filter(
  (plan) => !seenVersions.has(plan.version) && seenVersions.add(plan.version),
);

console.log(
  `${config.repo}: ${plans.length} "${config.line}" releases → RDPS project "${config.projectName}" (/${config.projectSlug})`,
);
if (config.dryRun) {
  for (const plan of plans) {
    console.log(
      `\n${plan.tag} → ${plan.version} [${plan.type}] "${plan.title}"`,
    );
    for (const change of plan.changes)
      console.log(`   ${change.category.padEnd(11)} ${change.title}`);
  }
  process.exit(0);
}

if (!config.adminEmail)
  fail("Pass --admin-email <your admin email> (or set RDPS_ADMIN_EMAIL).");
const [adminPassword, reviewerPassword] = await readPasswords();
if (!adminPassword || !reviewerPassword) fail("Both passwords are required.");

let admin;
let reviewer;
try {
  admin = await signIn(config.adminEmail, adminPassword);
  reviewer = await signIn(config.reviewerEmail, reviewerPassword);
} catch (error) {
  fail(`Sign-in failed: ${error.message}`);
}
if (admin.user.id === reviewer.user.id)
  fail("The reviewer must be a different person from the publisher.");

const projects = await call(admin.token, "GET", "/internal/projects");
let project = projects.find((item) => item.slug === config.projectSlug);
if (!project) {
  project = await call(admin.token, "POST", "/internal/projects", {
    name: config.projectName,
    slug: config.projectSlug,
    description: `Release notes imported from ${config.repo}.`,
  });
  console.log(`Created project ${project.name}.`);
}
await call(admin.token, "POST", `/internal/projects/${project.id}/members`, {
  email: config.reviewerEmail,
  role: "REVIEWER",
}).catch((error) => {
  if (!/admin|already/i.test(error.message)) throw error;
});

const existing = new Set(
  (
    await call(admin.token, "GET", `/internal/projects/${project.id}/releases`)
  ).map((release) => release.version.replace(/^v/, "")),
);

let published = 0;
let skipped = 0;
for (const [index, plan] of plans.entries()) {
  const step = `[${String(index + 1).padStart(String(plans.length).length)}/${plans.length}] ${plan.tag}`;
  if (existing.has(plan.version)) {
    skipped += 1;
    console.log(`${step} – already imported, skipped`);
    continue;
  }
  try {
    const release = await call(
      admin.token,
      "POST",
      `/internal/projects/${project.id}/releases`,
      {
        version: plan.version,
        title: plan.title,
        type: plan.type,
        channel: plan.channel,
        releaseDate: plan.releaseDate,
        internalSummary: plan.internalSummary,
      },
    );
    for (const change of plan.changes)
      await call(
        admin.token,
        "POST",
        `/internal/releases/${release.id}/changes`,
        change,
      );
    await call(
      admin.token,
      "PATCH",
      `/internal/releases/${release.id}/submit-review`,
    );
    const revision = await call(
      admin.token,
      "POST",
      `/internal/releases/${release.id}/approval-revisions`,
    );
    await call(
      reviewer.token,
      "PATCH",
      `/internal/releases/${release.id}/approval-revisions/${revision.id}/approve`,
      {
        comment: `Imported from GitHub release ${plan.tag}.`,
      },
    );
    await call(
      admin.token,
      "POST",
      `/internal/releases/${release.id}/approval-revisions/${revision.id}/publish`,
    );
    published += 1;
    console.log(
      `${step} → ${plan.version} published (${plan.changes.length} change${plan.changes.length === 1 ? "" : "s"})`,
    );
  } catch (error) {
    fail(
      `${step} failed: ${error.message}\nFix the cause and re-run; finished releases are skipped.`,
    );
  }
}

console.log(`\nDone: ${published} published, ${skipped} skipped.`);
console.log(`Public page: ${config.site}/projects/${config.projectSlug}`);
