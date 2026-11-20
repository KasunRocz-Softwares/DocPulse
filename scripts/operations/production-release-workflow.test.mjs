import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);

test("production images require full CI and a main-reachable release commit", async () => {
  const release = await readFile(
    new URL(".github/workflows/release-images.yml", repositoryRoot),
    "utf8",
  );

  assert.match(release, /verify:\n\s+needs: resolve/);
  assert.match(release, /production-images:[\s\S]*?needs: \[resolve, verify\]/);
  assert.match(
    release,
    /publish:[\s\S]*?needs: \[resolve, verify, production-images\]/,
  );
  assert.match(
    release,
    /GITHUB_EVENT_NAME.*workflow_dispatch[\s\S]*GITHUB_REF.*refs\/heads\/main/,
  );
  assert.match(release, /fetch-depth: 0/);
  assert.match(
    release,
    /git fetch --no-tags origin \\\n\s+\+refs\/heads\/main:refs\/remotes\/origin\/main/,
  );
  assert.match(
    release,
    /git merge-base --is-ancestor "\$source_commit" refs\/remotes\/origin\/main/,
  );
  assert.match(
    release,
    /ref: \$\{\{ needs\.resolve\.outputs\.source_commit \}\}/,
  );
});
