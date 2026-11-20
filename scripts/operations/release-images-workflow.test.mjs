import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/release-images.yml", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const components = ["api", "worker", "migrate", "web", "alertmanager"];
const source = "${{ needs.resolve.outputs.source_commit }}";

function job(name) {
  const body = workflow.match(
    new RegExp(`^  ${name}:\\n((?:^ {4}.*\\n|^\\n)*)`, "m"),
  )?.[1];
  assert.ok(body, `Expected the ${name} job`);
  return body;
}

function inlineNode(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `Expected the ${name} step`);
  const step = workflow.slice(start).split(/\n      - /)[0];
  const script = step.match(
    /node(?: --input-type=module)? <<'NODE'\n([\s\S]*?)\n {10}NODE/,
  )?.[1];
  assert.ok(script, `Expected an inline Node script in ${name}`);
  return script;
}

test("release resolution fetches the explicit tag and checks its commit against main", () => {
  const resolve = job("resolve");
  assert.match(
    resolve,
    /github\.event\.inputs\.release_tag \|\| github\.ref_name/,
  );
  assert.match(resolve, /refs\/tags\/\$IMAGE_TAG/);
  assert.match(resolve, /git rev-parse .*\^\{commit\}/);
  assert.match(
    resolve,
    /git merge-base --is-ancestor "\$source_commit" refs\/remotes\/origin\/main/,
  );
  assert.match(resolve, /source_commit=\$source_commit/);
});

test("release CI and publish jobs check out the resolved SHA", () => {
  for (const name of ["verify", "production-images", "publish"]) {
    const body = job(name);
    assert.match(body, /needs:.*\bresolve\b/);
    assert.ok(body.includes(`ref: ${source}`), `${name} must pin checkout`);
  }
  assert.match(job("publish"), /needs:.*\bverify\b.*\bproduction-images\b/);
});

test("published GitHub release tags cannot be reused and retain the permanent digest manifest", async () => {
  const resolve = job("resolve");
  const script = inlineNode("Reject an already published release tag");
  assert.match(resolve, /permissions:\n      contents: read/);
  assert.match(job("publish"), /contents: write/);
  assert.match(
    job("publish"),
    /gh release create "\$IMAGE_TAG" rdps-production-images\.json/,
  );
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction("fetch", "process", script);
  const process = {
    env: {
      GH_TOKEN: "test-token",
      GITHUB_REPOSITORY: "example/rdps",
      IMAGE_TAG: "v1.2.3",
    },
  };
  await run(async () => ({ status: 404 }), process);
  await assert.rejects(
    run(async () => ({ status: 200 }), process),
    /already been published/,
  );
  await assert.rejects(
    run(async () => ({ status: 403 }), process),
    /Could not verify release-tag uniqueness/,
  );
});

test("published aliases are unique per run attempt, so failed partial pushes can be retried", () => {
  assert.match(
    workflow,
    /^concurrency:\n  group: .*release_tag.*ref_name.*\n  cancel-in-progress: false$/m,
  );
  const publish = job("publish");
  assert.doesNotMatch(publish, /Reject existing release image tags/);
  const publishedTags = [...publish.matchAll(/tags: ghcr\.io\/[^\n]+/g)].map(
    ([line]) => line,
  );
  assert.equal(publishedTags.length, components.length);
  for (const tag of publishedTags) {
    assert.match(tag, /\$\{\{ env\.SOURCE_COMMIT \}\}/);
    assert.match(tag, /\$\{\{ github\.run_id \}\}/);
    assert.match(tag, /\$\{\{ github\.run_attempt \}\}/);
    assert.doesNotMatch(tag, /:\$\{\{ env\.IMAGE_TAG \}\}$/);
  }
});

test("the uploaded manifest contains exactly five digest refs from the publish job", () => {
  const publish = job("publish");
  const env = {
    IMAGE_OWNER: "example",
    IMAGE_TAG: "v1.2.3",
    SOURCE_COMMIT: "a".repeat(40),
  };
  const images = {};
  for (const [index, name] of components.entries()) {
    const key = `${name.toUpperCase()}_DIGEST`;
    assert.ok(publish.includes(`${key}: \${{ steps.${name}.outputs.digest }}`));
    env[key] = `sha256:${String(index).repeat(64)}`;
    images[name] = `ghcr.io/example/rdps-${name}@${env[key]}`;
  }
  const run = new Function(
    "require",
    "process",
    inlineNode("Write immutable digest manifest"),
  );
  const written = new Map();
  const execute = () =>
    run(
      (module) => {
        assert.equal(module, "node:fs");
        return {
          writeFileSync: (path, contents) => written.set(path, contents),
        };
      },
      { env },
    );
  execute();
  assert.deepEqual(JSON.parse(written.get("rdps-production-images.json")), {
    release_tag: "v1.2.3",
    source_commit: "a".repeat(40),
    images,
  });
  assert.match(
    publish,
    /uses: actions\/upload-artifact@v4[\s\S]*path: rdps-production-images\.json\n.*if-no-files-found: error/,
  );
  written.clear();
  env.WEB_DIGEST = "";
  assert.throws(execute, /digest/);
  assert.equal(written.size, 0);
});
