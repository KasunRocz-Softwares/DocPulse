import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultOutput = resolve(repoRoot, "docs/api/reference.md");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const outputArg = args.find((arg) => arg.startsWith("--output="));
const outputPath = outputArg
  ? resolve(repoRoot, outputArg.slice("--output=".length))
  : defaultOutput;
const sourceUrl =
  process.env.RDPS_OPENAPI_URL ?? "http://localhost:13001/api/docs-json";

function inline(value) {
  if (!value) return "—";
  if (typeof value === "string")
    return value.replaceAll("|", "\\|").replaceAll("\n", " ");
  if (value.$ref) return `\`${value.$ref.split("/").at(-1)}\``;
  if (value.type === "array") return `array of ${inline(value.items)}`;
  if (value.type === "object" && value.additionalProperties)
    return `object of ${inline(value.additionalProperties)}`;
  return value.format
    ? `${value.type ?? "value"} (${value.format})`
    : (value.type ?? JSON.stringify(value));
}

function renderDocument(spec) {
  const paths = spec.paths ?? {};
  const operations = [];
  for (const [path, pathItem] of Object.entries(paths).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (
        !["get", "post", "put", "patch", "delete", "options", "head"].includes(
          method,
        )
      )
        continue;
      operations.push({ path, method: method.toUpperCase(), operation });
    }
  }

  const tags = new Map();
  for (const entry of operations) {
    const name = entry.operation.tags?.[0] ?? "untagged";
    if (!tags.has(name)) tags.set(name, []);
    tags.get(name).push(entry);
  }

  const lines = [
    `# ${spec.info?.title ?? "RDPS API"} reference`,
    "",
    `**OpenAPI version:** ${spec.openapi ?? "unspecified"}  `,
    `**API version:** ${spec.info?.version ?? "unspecified"}  `,
    `**Generated from:** \`${sourceUrl}\`  `,
    "**Generation:** `node scripts/docs/generate-api-reference.mjs` (requires the API to be running)",
    "",
    spec.info?.description ??
      "Generated from the application's OpenAPI document.",
    "",
    "> This file is generated. Update API source decorators and DTOs, then regenerate; do not hand-edit endpoint details here.",
    "> Swagger metadata may be less detailed than runtime validation. The API rejects non-whitelisted request fields and transforms declared DTOs.",
    "",
    "## Authentication",
    "",
    "Protected operations use the bearer authentication scheme declared in the OpenAPI document. Public delivery and webhook operations may be anonymous or use provider-specific signature verification; consult each operation's security metadata and the integration runbooks.",
    "",
    `**Operations:** ${operations.length}  `,
    `**Paths:** ${Object.keys(paths).length}  `,
    `**Tags:** ${tags.size}`,
    "",
  ];

  for (const [tag, entries] of [...tags.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(`## ${tag}`, "");
    for (const { path, method, operation } of entries) {
      const title =
        operation.summary ?? operation.operationId ?? `${method} ${path}`;
      lines.push(`### \`${method} ${path}\``, "", title, "");
      if (operation.description) lines.push(operation.description, "");
      if (operation.operationId)
        lines.push(`**Operation ID:** \`${operation.operationId}\`  `);
      if (operation.deprecated) lines.push("**Deprecated:** yes  ");
      const security = operation.security ?? spec.security;
      if (security?.length) {
        const names = [
          ...new Set(security.flatMap((item) => Object.keys(item))),
        ];
        lines.push(
          `**Security:** ${names.length ? names.map((name) => `\`${name}\``).join(", ") : "none"}  `,
        );
      } else {
        lines.push("**Security:** none declared  ");
      }
      const params = operation.parameters ?? [];
      if (params.length) {
        lines.push(
          "",
          "| Parameter | In | Required | Type | Description |",
          "| --- | --- | --- | --- | --- |",
        );
        for (const parameter of params) {
          lines.push(
            `| \`${parameter.name}\` | ${parameter.in} | ${parameter.required ? "yes" : "no"} | ${inline(parameter.schema)} | ${inline(parameter.description)} |`,
          );
        }
      }
      const body = operation.requestBody;
      if (body) {
        const content = Object.entries(body.content ?? {})
          .map(([type, value]) => `\`${type}\`: ${inline(value.schema)}`)
          .join("; ");
        lines.push(
          "",
          `**Request body${body.required ? " (required)" : " (optional)"}:** ${content || "schema not declared"}`,
        );
      }
      const responses = Object.entries(operation.responses ?? {});
      if (responses.length) {
        lines.push(
          "",
          "| Status | Description | Response |",
          "| --- | --- | --- |",
        );
        for (const [status, response] of responses) {
          const media = Object.values(response.content ?? {});
          const schema =
            media.map((item) => inline(item.schema)).join(", ") || "—";
          lines.push(
            `| ${status} | ${inline(response.description)} | ${schema} |`,
          );
        }
      }
      lines.push("");
    }
  }

  const schemas = spec.components?.schemas ?? {};
  if (Object.keys(schemas).length) {
    lines.push("## Schemas", "");
    for (const [name, schema] of Object.entries(schemas).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      lines.push(`### \`${name}\``, "");
      if (schema.description) lines.push(schema.description, "");
      if (schema.enum)
        lines.push(
          `**Values:** ${schema.enum.map((value) => `\`${value}\``).join(", ")}`,
          "",
        );
      const properties = Object.entries(schema.properties ?? {});
      if (properties.length) {
        const required = new Set(schema.required ?? []);
        lines.push(
          "| Property | Required | Type | Description |",
          "| --- | --- | --- | --- |",
        );
        for (const [property, value] of properties) {
          lines.push(
            `| \`${property}\` | ${required.has(property) ? "yes" : "no"} | ${inline(value)} | ${inline(value.description)} |`,
          );
        }
        lines.push("");
      } else if (!schema.enum) {
        lines.push(`Schema: ${inline(schema)}`, "");
      }
    }
  }

  return `${lines
    .join("\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

const response = await fetch(sourceUrl, {
  headers: { accept: "application/json" },
});
if (!response.ok) {
  throw new Error(
    `OpenAPI fetch failed: ${response.status} ${response.statusText} (${sourceUrl})`,
  );
}
const spec = await response.json();
if (!spec || typeof spec !== "object" || !spec.paths) {
  throw new Error(
    `Response is not an OpenAPI document with a paths object (${sourceUrl})`,
  );
}
const generated = await prettier.format(renderDocument(spec), {
  filepath: outputPath,
});

if (checkOnly) {
  let existing;
  try {
    existing = await readFile(outputPath, "utf8");
  } catch {
    throw new Error(`Generated reference is missing: ${outputPath}`);
  }
  if (existing !== generated) {
    throw new Error(`Generated reference is stale: ${outputPath}`);
  }
  console.log(
    `API reference is current (${Object.keys(spec.paths).length} paths): ${outputPath}`,
  );
} else {
  await writeFile(outputPath, generated, "utf8");
  console.log(
    `Generated API reference (${Object.keys(spec.paths).length} paths): ${outputPath}`,
  );
}
