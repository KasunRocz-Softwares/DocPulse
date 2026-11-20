import { spawnSync } from "node:child_process";

const archivePath = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
if (!archivePath || !databaseUrl) {
  console.error("An archive path and DATABASE_URL are required.");
  process.exit(64);
}

let url;
try {
  url = new URL(databaseUrl);
} catch {
  console.error("DATABASE_URL is not a valid PostgreSQL connection URL.");
  process.exit(64);
}
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !url.hostname ||
  !url.pathname.slice(1)
) {
  console.error("DATABASE_URL must include a PostgreSQL host and database.");
  process.exit(64);
}

const env = { ...process.env };
delete env.DATABASE_URL;
env.PGHOST = url.hostname.replace(/^\[|\]$/g, "");
env.PGPORT = url.port || "5432";
env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
if (url.username) env.PGUSER = decodeURIComponent(url.username);
if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
for (const name of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) {
  const value = url.searchParams.get(name);
  if (value) env[`PG${name.toUpperCase()}`] = value;
}

const result = spawnSync(
  "pg_dump",
  ["--format=custom", "--no-owner", "--no-acl", `--file=${archivePath}`],
  { env, stdio: "inherit" },
);
if (result.error) {
  console.error("pg_dump could not be started.");
  process.exit(69);
}
process.exit(result.status ?? 1);
