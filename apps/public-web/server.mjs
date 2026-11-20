import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TITLE = "Product updates · RDPS";
const DEFAULT_DESCRIPTION =
  "Browse approved product updates and published release notes.";
const PAGE_SIZE = 100;
const MAX_SITEMAP_URLS = 50_000;
const MAX_CACHED_SITEMAPS = 32;
const SITEMAP_CACHE_MS = 5 * 60 * 1000;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character];
  });
}

function safeHost(value) {
  if (
    typeof value !== "string" ||
    value.length > 253 ||
    /[\\/?#@\s]/.test(value)
  )
    return null;
  try {
    const parsed = new URL(`http://${value}`);
    const hostname = parsed.hostname.toLowerCase();
    const suppliedHostname = value.startsWith("[")
      ? value.slice(1, value.indexOf("]"))
      : value.split(":")[0]?.toLowerCase();
    if (
      hostname !== suppliedHostname ||
      !hostname
        .split(".")
        .every((label) =>
          /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
        ) ||
      parsed.username ||
      parsed.password
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

function requestOrigin(request) {
  const host = safeHost(request.headers.host);
  if (!host) return "http://localhost";
  return `http://${host}`;
}

function setMeta(html, attribute, name, content) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagPattern = new RegExp(
    `<meta\\b(?=[^>]*\\b${attribute}=["']${escapedName}["'])[^>]*>`,
    "i",
  );
  const replacement = `<meta ${attribute}="${escapeHtml(name)}" content="${escapeHtml(content)}">`;
  return tagPattern.test(html)
    ? html.replace(tagPattern, replacement)
    : html.replace("</head>", `  ${replacement}\n  </head>`);
}

function setTitle(html, title) {
  const safeTitle = escapeHtml(title);
  return /<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)
    ? html.replace(
        /<title\b[^>]*>[\s\S]*?<\/title>/i,
        `<title>${safeTitle}</title>`,
      )
    : html.replace("</head>", `  <title>${safeTitle}</title>\n  </head>`);
}

function setCanonical(html, url) {
  const replacement = `<link rel="canonical" href="${escapeHtml(url)}">`;
  const pattern = /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i;
  return pattern.test(html)
    ? html.replace(pattern, replacement)
    : html.replace("</head>", `  ${replacement}\n  </head>`);
}

function renderHtml(template, metadata, url) {
  let html = setTitle(template, metadata?.title || DEFAULT_TITLE);
  const description = metadata?.description || DEFAULT_DESCRIPTION;
  html = setMeta(html, "name", "description", description);
  html = setMeta(html, "property", "og:type", "website");
  html = setMeta(
    html,
    "property",
    "og:title",
    metadata?.title || DEFAULT_TITLE,
  );
  html = setMeta(html, "property", "og:description", description);
  html = setMeta(html, "property", "og:url", url);
  html = setMeta(html, "name", "twitter:card", "summary");
  html = setMeta(
    html,
    "name",
    "twitter:title",
    metadata?.title || DEFAULT_TITLE,
  );
  html = setMeta(html, "name", "twitter:description", description);
  html = setMeta(html, "name", "twitter:url", url);
  return setCanonical(html, url);
}

function apiRoute(pathname, searchParams, apiBaseUrl) {
  let segments;
  try {
    segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments[0] !== "projects" || !segments[1]) return null;
  const slug = encodeURIComponent(segments[1]);
  const locale = searchParams.get("locale");
  const query =
    locale && locale.length <= 35
      ? `?locale=${encodeURIComponent(locale)}`
      : "";
  if (segments.length === 2)
    return `${apiBaseUrl}/projects/${slug}/share${query}`;
  if (segments.length === 4 && segments[2] === "releases")
    return `${apiBaseUrl}/projects/${slug}/releases/${encodeURIComponent(segments[3])}/share${query}`;
  return null;
}

function customDomainRoute(pathname, searchParams, apiBaseUrl, slug) {
  let segments;
  try {
    segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.length === 0)
    return apiRoute(
      `/projects/${encodeURIComponent(slug)}`,
      searchParams,
      apiBaseUrl,
    );
  if (segments.length === 2 && segments[0] === "releases")
    return apiRoute(
      `/projects/${encodeURIComponent(slug)}/releases/${encodeURIComponent(segments[1])}`,
      searchParams,
      apiBaseUrl,
    );
  if (
    segments.length === 1 &&
    ["changelog", "search", "releases"].includes(segments[0])
  )
    return undefined;
  return null;
}

function absolutePublicUrl(origin, pathname) {
  return `${origin}${pathname}`;
}

function validRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createPublicWebServer({
  apiBaseUrl = process.env.PUBLIC_METADATA_API_BASE_URL ??
    "http://api:3001/api/v1/public",
  publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:5174",
  indexHtml,
  indexHtmlPath = "/usr/share/nginx/html/public/index.html",
  fetchImpl = fetch,
} = {}) {
  const sitemapCache = new Map();
  const configuredPublicUrl = new URL(publicBaseUrl);
  if (
    !["http:", "https:"].includes(configuredPublicUrl.protocol) ||
    configuredPublicUrl.username ||
    configuredPublicUrl.password
  )
    throw new Error("PUBLIC_BASE_URL must be an HTTP(S) origin");
  const configuredPublicOrigin = configuredPublicUrl.origin;
  const configuredPublicHostname = configuredPublicUrl.hostname.toLowerCase();
  const isLoopback = (hostname) =>
    hostname === "localhost" || hostname === "127.0.0.1";

  async function getIndexHtml() {
    return indexHtml ?? readFile(indexHtmlPath, "utf8");
  }

  async function getJson(url) {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const error = new Error("Public metadata unavailable");
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async function resolveCustomDomain(hostname) {
    try {
      const resolved = await getJson(
        `${apiBaseUrl}/host?hostname=${encodeURIComponent(hostname)}`,
      );
      return typeof resolved?.slug === "string" ? resolved.slug : null;
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
  }

  async function resolveRequestDomain(request) {
    const host = safeHost(request.headers.host);
    if (!host) return null;
    let parsedHost;
    try {
      parsedHost = new URL(`http://${host}`);
    } catch {
      return null;
    }
    const hostname = parsedHost.hostname.toLowerCase();
    if (hostname === configuredPublicHostname) {
      if (parsedHost.port && parsedHost.port !== configuredPublicUrl.port)
        return null;
      return { origin: configuredPublicOrigin, customSlug: null, hostname };
    }
    if (isLoopback(configuredPublicHostname) && isLoopback(hostname))
      return {
        origin: requestOrigin(request),
        customSlug: null,
        hostname,
      };
    if (parsedHost.port) return null;
    const customSlug = await resolveCustomDomain(hostname);
    return customSlug
      ? { origin: `https://${hostname}`, customSlug, hostname }
      : null;
  }

  async function generateSitemap(origin, customSlug) {
    const urls = new Set([absolutePublicUrl(origin, "/")]);
    if (customSlug) {
      const slug = encodeURIComponent(customSlug);
      const firstReleasePage = await getJson(
        `${apiBaseUrl}/projects/${slug}/releases?page=1&pageSize=${PAGE_SIZE}`,
      );
      const releasePages = Math.min(
        1000,
        Math.max(1, Number(firstReleasePage.totalPages) || 1),
      );
      const addReleases = (result) => {
        if (!Array.isArray(result.results)) return;
        for (const release of result.results) {
          if (urls.size >= MAX_SITEMAP_URLS) break;
          if (typeof release?.version !== "string") continue;
          urls.add(
            absolutePublicUrl(
              origin,
              `/releases/${encodeURIComponent(release.version)}`,
            ),
          );
        }
      };
      addReleases(firstReleasePage);
      for (
        let page = 2;
        page <= releasePages && urls.size < MAX_SITEMAP_URLS;
        page += 1
      ) {
        const result = await getJson(
          `${apiBaseUrl}/projects/${slug}/releases?page=${page}&pageSize=${PAGE_SIZE}`,
        );
        addReleases(result);
      }
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
        ...urls,
      ]
        .map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`)
        .join("\n")}\n</urlset>\n`;
    }

    // The default host has no shared project directory: projects are only
    // reachable from their own links, so its sitemap lists nothing.
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n`;
  }

  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let requestDomain;
    try {
      requestDomain = await resolveRequestDomain(request);
    } catch {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      response.end(
        method === "HEAD" ? undefined : "Public site temporarily unavailable\n",
      );
      return;
    }
    if (!requestDomain) {
      response.writeHead(421, { "content-type": "text/plain; charset=utf-8" });
      response.end(method === "HEAD" ? undefined : "Misdirected request\n");
      return;
    }
    const { origin, customSlug } = requestDomain;
    const requestUrl = new URL(request.url ?? "/", origin);
    try {
      if (requestUrl.pathname === "/robots.txt") {
        const body = `User-agent: *\nAllow: /\nDisallow: /client/\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`;
        response.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=300",
        });
        response.end(method === "HEAD" ? undefined : body);
        return;
      }
      if (requestUrl.pathname === "/sitemap.xml") {
        const cacheKey = JSON.stringify([origin, customSlug]);
        const cached = sitemapCache.get(cacheKey);
        let sitemap = cached?.expiresAt > Date.now() ? cached.body : null;
        if (!sitemap) {
          sitemap = await generateSitemap(origin, customSlug);
          sitemapCache.delete(cacheKey);
          sitemapCache.set(cacheKey, {
            body: sitemap,
            expiresAt: Date.now() + SITEMAP_CACHE_MS,
          });
          while (sitemapCache.size > MAX_CACHED_SITEMAPS)
            sitemapCache.delete(sitemapCache.keys().next().value);
        } else {
          sitemapCache.delete(cacheKey);
          sitemapCache.set(cacheKey, cached);
        }
        response.writeHead(200, {
          "content-type": "application/xml; charset=utf-8",
          "cache-control": "public, max-age=300",
        });
        response.end(method === "HEAD" ? undefined : sitemap);
        return;
      }

      let metadata = null;
      let status = 200;
      const normalizedApiBase = apiBaseUrl.replace(/\/$/, "");
      const resolvedMetadataApiUrl = customSlug
        ? customDomainRoute(
            requestUrl.pathname,
            requestUrl.searchParams,
            normalizedApiBase,
            customSlug,
          )
        : apiRoute(
            requestUrl.pathname,
            requestUrl.searchParams,
            normalizedApiBase,
          );
      if (customSlug && resolvedMetadataApiUrl === null) status = 404;
      if (resolvedMetadataApiUrl) {
        try {
          const result = await getJson(resolvedMetadataApiUrl);
          if (validRecord(result)) {
            metadata = {
              title:
                typeof result.title === "string" ? result.title : DEFAULT_TITLE,
              description:
                typeof result.description === "string"
                  ? result.description
                  : DEFAULT_DESCRIPTION,
            };
          }
        } catch (error) {
          status = Number.isInteger(error?.status) ? error.status : 503;
          if (status < 400 || status > 599) status = 503;
        }
      }
      const html = renderHtml(
        await getIndexHtml(),
        metadata,
        absolutePublicUrl(origin, requestUrl.pathname + requestUrl.search),
      );
      response.writeHead(status, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      });
      response.end(method === "HEAD" ? undefined : html);
    } catch {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      response.end(
        method === "HEAD" ? undefined : "Public site temporarily unavailable\n",
      );
    }
  });
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const server = createPublicWebServer();
  server.listen(Number(process.env.PUBLIC_METADATA_PORT ?? 3002), "127.0.0.1");
}
