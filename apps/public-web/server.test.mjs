import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { createPublicWebServer } from "./server.mjs";

const html = `<!doctype html><html><head><title>Product updates · RDPS</title><meta name="description" content="Approved product updates and release notes."><meta property="og:type" content="website"><meta property="og:title" content="Product updates · RDPS"><meta property="og:description" content="Browse approved product updates and published release notes."><meta name="twitter:card" content="summary"></head><body><div id="root"></div></body></html>`;

async function withServer(options, run) {
  const server = createPublicWebServer({ indexHtml: html, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function apiResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestRaw(base, pathname, host, forwardedProto = "https") {
  const target = new URL(base);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: pathname,
        headers: { host, "x-forwarded-proto": forwardedProto },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

test("raw project and release HTML contains snapshot-backed social metadata", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    if (String(url).endsWith("/projects/orbit/share"))
      return apiResponse({
        title: `Orbit <Updates> & More`,
        description: `Published <b>summary</b>`,
        project: { slug: "orbit", name: "Orbit" },
        // The renderer must never serialize unapproved or unexpected fields.
        internalNotes: "PRIVATE_DRAFT_SENTINEL",
      });
    if (String(url).endsWith("/projects/orbit/releases/2.4.0/share"))
      return apiResponse({
        title: "Orbit 2.4.0",
        description: "New orbital maps",
        project: { slug: "orbit", name: "Orbit" },
        version: "2.4.0",
      });
    return apiResponse({ message: "Not found" }, 404);
  };

  await withServer(
    {
      fetchImpl,
      apiBaseUrl: "http://api.test/api/v1/public",
      publicBaseUrl: "https://updates.example.test",
    },
    async (base) => {
      const project = await requestRaw(
        base,
        "/projects/orbit",
        "updates.example.test",
      );
      const projectHtml = project.body;
      assert.equal(project.status, 200);
      assert.match(
        projectHtml,
        /<title>Orbit &lt;Updates&gt; &amp; More<\/title>/,
      );
      assert.match(
        projectHtml,
        /property="og:description" content="Published &lt;b&gt;summary&lt;\/b&gt;"/,
      );
      assert.match(
        projectHtml,
        /property="og:url" content="https:\/\/updates\.example\.test\/projects\/orbit"/,
      );
      assert.match(
        projectHtml,
        /rel="canonical" href="https:\/\/updates\.example\.test\/projects\/orbit"/,
      );
      assert.doesNotMatch(projectHtml, /PRIVATE_DRAFT_SENTINEL|internalNotes/);

      const release = await requestRaw(
        base,
        "/projects/orbit/releases/2.4.0",
        "updates.example.test",
      );
      const releaseHtml = release.body;
      assert.equal(release.status, 200);
      assert.match(releaseHtml, /<title>Orbit 2\.4\.0<\/title>/);
      assert.match(releaseHtml, /name="twitter:title" content="Orbit 2\.4\.0"/);
      assert.ok(requested.some((url) => url.endsWith("/projects/orbit/share")));
      assert.ok(
        requested.some((url) =>
          url.endsWith("/projects/orbit/releases/2.4.0/share"),
        ),
      );
    },
  );
});

test("default-host sitemap lists no projects and robots still points to it", async () => {
  const requested = [];
  const fetchImpl = async (input) => {
    requested.push(String(input));
    return apiResponse({ error: "no API call expected" }, 404);
  };

  await withServer(
    {
      fetchImpl,
      apiBaseUrl: "http://api.test/api/v1/public",
      publicBaseUrl: "https://updates.example.test",
    },
    async (base) => {
      const sitemapResponse = await requestRaw(
        base,
        "/sitemap.xml",
        "updates.example.test",
      );
      assert.equal(sitemapResponse.status, 200);
      assert.match(sitemapResponse.headers["content-type"], /application\/xml/);
      assert.match(sitemapResponse.body, /<urlset[^>]*>\s*<\/urlset>/);
      assert.doesNotMatch(sitemapResponse.body, /<url>|\/projects/);
      assert.deepEqual(
        requested.filter((url) => new URL(url).pathname.endsWith("/projects")),
        [],
      );

      const robotsResponse = await requestRaw(
        base,
        "/robots.txt",
        "updates.example.test",
      );
      assert.equal(robotsResponse.status, 200);
      assert.match(robotsResponse.body, /Disallow: \/client\//);
      assert.match(
        robotsResponse.body,
        /Sitemap: https:\/\/updates\.example\.test\/sitemap\.xml/,
      );
    },
  );
});

test("sitemap cache remains isolated by host and reuses each host entry", async () => {
  let projectListRequests = 0;
  let customHostResolutions = 0;
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/host")) {
      customHostResolutions += 1;
      return apiResponse(
        url.searchParams.get("hostname") === "beta.example.test"
          ? { slug: "beta" }
          : {},
      );
    }
    if (url.pathname.endsWith("/projects")) {
      projectListRequests += 1;
      return apiResponse({ page: 1, totalPages: 1, results: [] });
    }
    if (url.pathname.endsWith("/projects/beta/releases"))
      return apiResponse({
        page: 1,
        totalPages: 1,
        results: [{ version: "2.0.0" }],
      });
    return apiResponse({ page: 1, totalPages: 1, results: [] });
  };

  await withServer(
    {
      fetchImpl,
      apiBaseUrl: "http://api.test/api/v1/public",
      publicBaseUrl: "https://alpha.example.test",
    },
    async (base) => {
      const alpha = await requestRaw(
        base,
        "/sitemap.xml",
        "alpha.example.test",
      );
      const beta = await requestRaw(base, "/sitemap.xml", "beta.example.test");
      const alphaAgain = await requestRaw(
        base,
        "/sitemap.xml",
        "alpha.example.test",
      );
      assert.doesNotMatch(alpha.body, /<url>/);
      assert.match(
        beta.body,
        /https:\/\/beta\.example\.test\/releases\/2\.0\.0/,
      );
      assert.equal(alphaAgain.body, alpha.body);
      assert.equal(projectListRequests, 0);
      assert.equal(customHostResolutions, 1);
    },
  );
});

test("verified custom-domain root and release routes receive published metadata", async () => {
  const requested = [];
  const fetchImpl = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/host?hostname=docs.example.test"))
      return apiResponse({ slug: "orbit" });
    if (url.endsWith("/projects/orbit/share"))
      return apiResponse({
        title: "Orbit release notes",
        description: "Published Orbit releases.",
      });
    if (url.endsWith("/projects/orbit/releases/2.4.0/share"))
      return apiResponse({
        title: "Orbit 2.4.0",
        description: "New orbital maps.",
      });
    return apiResponse({ message: "Not found" }, 404);
  };

  await withServer(
    { fetchImpl, apiBaseUrl: "http://api.test/api/v1/public" },
    async (base) => {
      const project = await requestRaw(base, "/", "docs.example.test");
      assert.equal(project.status, 200);
      assert.match(project.body, /<title>Orbit release notes<\/title>/);
      assert.match(
        project.body,
        /property="og:url" content="https:\/\/docs\.example\.test\/"/,
      );

      const release = await requestRaw(
        base,
        "/releases/2.4.0",
        "docs.example.test",
      );
      assert.equal(release.status, 200);
      assert.match(release.body, /<title>Orbit 2\.4\.0<\/title>/);
      assert.match(
        release.body,
        /canonical" href="https:\/\/docs\.example\.test\/releases\/2\.4\.0"/,
      );
      assert.ok(requested.some((url) => url.endsWith("/projects/orbit/share")));
      assert.ok(
        requested.some((url) =>
          url.endsWith("/projects/orbit/releases/2.4.0/share"),
        ),
      );
    },
  );
});

test("verified custom-domain changelog, search, and release history routes load the public app", async () => {
  const requested = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    requested.push(url);
    if (url.pathname.endsWith("/host")) return apiResponse({ slug: "orbit" });
    return apiResponse({ message: "Not found" }, 404);
  };

  await withServer(
    { fetchImpl, apiBaseUrl: "http://api.test/api/v1/public" },
    async (base) => {
      for (const pathname of [
        "/changelog?page=2",
        "/search?q=security&page=2",
        "/releases?page=2",
      ]) {
        const response = await requestRaw(base, pathname, "docs.example.test");
        assert.equal(response.status, 200, `${pathname} should load the app`);
        assert.match(response.headers["content-type"], /text\/html/);
        assert.match(response.body, /<div id="root"><\/div>/);
        assert.ok(
          response.body.includes(
            `property="og:url" content="https://docs.example.test${pathname.split("?")[0]}`,
          ),
        );
      }

      assert.equal(
        requested.filter((url) => !url.pathname.endsWith("/host")).length,
        0,
        "SPA routes do not need share metadata lookups",
      );
    },
  );
});

test("verified custom-domain sitemap lists only its project using custom-domain routes", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/host"))
      return apiResponse({
        slug:
          url.searchParams.get("hostname") === "docs.example.test"
            ? "orbit"
            : undefined,
      });
    if (url.pathname.endsWith("/projects/orbit/releases"))
      return apiResponse({
        page: 1,
        totalPages: 1,
        results: [{ version: "2.4.0" }],
      });
    if (url.pathname.endsWith("/projects"))
      return apiResponse({
        page: 1,
        totalPages: 1,
        results: [{ slug: "another-public-project" }],
      });
    return apiResponse({ page: 1, totalPages: 1, results: [] });
  };

  await withServer(
    { fetchImpl, apiBaseUrl: "http://api.test/api/v1/public" },
    async (base) => {
      const response = await requestRaw(
        base,
        "/sitemap.xml",
        "docs.example.test",
      );
      assert.equal(response.status, 200);
      assert.match(
        response.body,
        /https:\/\/docs\.example\.test\/releases\/2\.4\.0/,
      );
      assert.doesNotMatch(
        response.body,
        /another-public-project|\/projects\/orbit/,
      );
    },
  );
});

test("invalid Host syntax falls back safely and snapshot 404 stays a 404", async () => {
  await withServer(
    {
      fetchImpl: async () =>
        apiResponse({ error: "PRIVATE_NOT_FOUND_DETAIL" }, 404),
      apiBaseUrl: "http://api.test/api/v1/public",
      publicBaseUrl: "https://updates.example.test",
    },
    async (base) => {
      const robots = await requestRaw(
        base,
        "/robots.txt",
        "evil..example.test",
      );
      assert.equal(robots.status, 421);
      assert.doesNotMatch(robots.body, /evil\.example\.test/);
      for (const host of [
        "docs.example.test/path",
        "docs.example.test?query=1",
        "docs.example.test#fragment",
      ]) {
        const malformed = await requestRaw(base, "/sitemap.xml", host);
        assert.equal(malformed.status, 421);
      }

      const missing = await requestRaw(
        base,
        "/projects/private-draft",
        "updates.example.test",
      );
      assert.equal(missing.status, 404);
      assert.match(missing.body, /Product updates · RDPS/);
      assert.doesNotMatch(missing.body, /PRIVATE_NOT_FOUND_DETAIL/);
    },
  );
});

test("custom-domain canonical URLs ignore forwarded-protocol values", async () => {
  const fetchImpl = async (input) => {
    if (String(input).endsWith("/host?hostname=docs.example.test"))
      return apiResponse({ slug: "orbit" });
    if (String(input).endsWith("/projects/orbit/share"))
      return apiResponse({ title: "Orbit", description: "Published releases" });
    return apiResponse({}, 404);
  };

  await withServer(
    { fetchImpl, apiBaseUrl: "http://api.test/api/v1/public" },
    async (base) => {
      for (const forwardedProto of [
        "http",
        "https",
        "https, http",
        "javascript",
      ]) {
        const response = await requestRaw(
          base,
          "/",
          "docs.example.test",
          forwardedProto,
        );
        assert.equal(response.status, 200);
        assert.match(
          response.body,
          /rel="canonical" href="https:\/\/docs\.example\.test\/"/,
        );
        assert.doesNotMatch(response.body, /javascript:\/\//);
      }
    },
  );
});

test("custom-domain sitemap cache is isolated when a domain is reassigned", async () => {
  let assignedSlug = "alpha";
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/host"))
      return apiResponse({ slug: assignedSlug });
    if (url.pathname.endsWith(`/projects/${assignedSlug}/releases`))
      return apiResponse({
        page: 1,
        totalPages: 1,
        results: [{ version: `${assignedSlug}-1.0.0` }],
      });
    return apiResponse({ page: 1, totalPages: 1, results: [] });
  };

  await withServer(
    { fetchImpl, apiBaseUrl: "http://api.test/api/v1/public" },
    async (base) => {
      const alpha = await requestRaw(base, "/sitemap.xml", "docs.example.test");
      assignedSlug = "beta";
      const beta = await requestRaw(base, "/sitemap.xml", "docs.example.test");
      assert.match(alpha.body, /alpha-1\.0\.0/);
      assert.match(beta.body, /beta-1\.0\.0/);
      assert.doesNotMatch(beta.body, /alpha-1\.0\.0/);
    },
  );
});

test("unverified Host cannot control canonical or sitemap origins", async () => {
  const requested = [];
  await withServer(
    {
      publicBaseUrl: "https://releases.example.test",
      apiBaseUrl: "http://api.test/api/v1/public",
      fetchImpl: async (input) => {
        requested.push(String(input));
        return apiResponse({ message: "unknown custom host" }, 404);
      },
    },
    async (base) => {
      const page = await requestRaw(
        base,
        "/projects/orbit",
        "attacker.example.test",
      );
      const sitemap = await requestRaw(
        base,
        "/sitemap.xml",
        "attacker.example.test",
      );

      assert.equal(page.status, 421);
      assert.equal(sitemap.status, 421);
      assert.doesNotMatch(page.body, /attacker\.example\.test/);
      assert.doesNotMatch(sitemap.body, /attacker\.example\.test/);
      assert.equal(
        requested.filter((url) => url.includes("/host?hostname=")).length,
        2,
      );
    },
  );
});

test("metadata API failure never injects upstream response content", async () => {
  await withServer(
    {
      fetchImpl: async () =>
        apiResponse({ error: "PRIVATE_DATABASE_ERROR" }, 503),
      apiBaseUrl: "http://api.test/api/v1/public",
    },
    async (base) => {
      const response = await fetch(`${base}/projects/orbit`);
      const document = await response.text();
      assert.equal(response.status, 503);
      assert.match(document, /Product updates · RDPS/);
      assert.doesNotMatch(document, /PRIVATE_DATABASE_ERROR/);
    },
  );
});
