#!/usr/bin/env node
/**
 * Reset a user's password in a LOCAL development database.
 *
 *   node scripts/operations/reset-local-password.mjs <email>
 *
 * Prompts twice for the new password (input hidden). Uses the Docker dev
 * database by default; set DATABASE_URL to target another local database.
 * Refuses non-local hosts — production accounts must use the product's own
 * account flows, never direct database edits.
 *
 * Effects (one transaction): sets a bcrypt hash (cost 12, as the API does),
 * revokes the user's active sessions, clears active login lockouts, and writes
 * an `identity.password.reset_local` audit event.
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

const require = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const { Client } = require("pg");
const bcrypt = require("bcryptjs");

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "postgres",
]);
const DEFAULT_URL = "postgresql://rdps:rdps_dev_only@localhost:15432/rdps";

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes("@"))
  fail("Usage: node scripts/operations/reset-local-password.mjs <email>", 64);

let url;
try {
  url = new URL(process.env.DATABASE_URL || DEFAULT_URL);
} catch {
  fail("DATABASE_URL is not a valid PostgreSQL URL.", 64);
}
if (!LOCAL_HOSTS.has(url.hostname))
  fail(`Refusing to reset a password on non-local host "${url.hostname}".`, 65);

/** Read the two password entries: hidden prompts on a terminal, lines otherwise. */
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
  return [await ask("New password: "), await ask("Confirm password: ")];
}

const [password, confirmation] = await readPasswords();
if (password !== confirmation) fail("Passwords do not match.");
if (!password || password.length < 12 || password.length > 128)
  fail("Password must be 12–128 characters (the API's sign-in rules).");

const client = new Client({ connectionString: url.toString() });
await client.connect();
try {
  await client.query("BEGIN");
  const { rows } = await client.query(
    `SELECT id, status, "isSystemAdmin" FROM "User" WHERE lower(email) = $1 FOR UPDATE`,
    [email],
  );
  const user = rows[0];
  if (!user) {
    await client.query("ROLLBACK");
    fail(`No user with email ${email}.`);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await client.query(
    `UPDATE "User" SET "passwordHash" = $1, "updatedAt" = now() WHERE id = $2`,
    [passwordHash, user.id],
  );
  const sessions = await client.query(
    `UPDATE "UserSession" SET "revokedAt" = now()
     WHERE "userId" = $1 AND "revokedAt" IS NULL`,
    [user.id],
  );
  const lockouts = await client.query(
    `DELETE FROM "LoginAttempt" WHERE "blockedUntil" > now()`,
  );
  await client.query(
    `INSERT INTO "AuditLog" (id, "actorId", action, "entityType", "entityId", metadata)
     VALUES ($1, NULL, 'identity.password.reset_local', 'user', $2, $3)`,
    [
      randomUUID(),
      user.id,
      JSON.stringify({ via: "reset-local-password script" }),
    ],
  );
  await client.query("COMMIT");
  console.log(
    `Password reset for ${email} (${user.isSystemAdmin ? "system admin" : "user"}, status ${user.status}).` +
      ` Revoked ${sessions.rowCount} session(s); cleared ${lockouts.rowCount} login lockout(s).`,
  );
  if (user.status !== "ACTIVE")
    console.log(
      `Note: this account is ${user.status}, so it still cannot sign in.`,
    );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  fail(
    `Reset failed: ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  await client.end();
}
