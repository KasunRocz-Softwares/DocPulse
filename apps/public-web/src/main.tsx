import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  PublicProjectPage,
  PublicSiteFooter,
  PublicSiteHeader,
  defaultPublicPageConfig,
  normalizePublicPageConfig,
  publicPageAttributes,
  publicPageStyle,
  usePublicPageFonts,
  type PublicPageConfig,
  type PublicPageRelease,
} from "@rdps/ui/public-page";
import "@rdps/ui/styles.css";
import "@rdps/ui/public-page.css";
import {
  contentLocaleOptions,
  normalizeContentLocale,
  normalizeLocale,
  translate,
  type SupportedLocale,
} from "./i18n";
import { customDomainPath } from "./custom-domain-routing";
import { ClientAccessPage } from "./ClientAccessPage";
import "./style.css";

const LocaleContext = createContext<SupportedLocale>("en");

function useT() {
  const locale = useContext(LocaleContext);
  return useCallback(
    (key: string, values?: Record<string, string | number>) =>
      translate(locale, key, values),
    [locale],
  );
}

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.DEV
    ? "http://localhost:13001/api/v1/public"
    : `${window.location.origin}/api/v1/public`);
let customDomainSlug: string | null = null;
const sentAnalyticsEvents = new Set<string>();

type Project = {
  slug: string;
  name: string;
  releaseCount: number;
  latestPublishedAt: string;
  latestReleaseDate?: string | null;
  primaryColor?: string;
  accentColor?: string | null;
  logoUrl?: string | null;
  defaultLocale?: string;
  availableLocales?: string[];
  latestRelease?: Release;
};

type Change = {
  title: string;
  category: string;
  description?: string;
  sortOrder: number;
};

type Release = {
  id?: string;
  projectSlug: string;
  projectName: string;
  version: string;
  title: string;
  summary: string | null;
  locale: string;
  defaultLocale?: string;
  availableLocales?: string[];
  primaryColor?: string;
  accentColor?: string | null;
  logoUrl?: string | null;
  publishedAt: string;
  /** Release date from the approved revision, when one was set. */
  releaseDate?: string | null;
  changes?: Change[];
  attachments?: Array<{
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: string;
    checksumSha256: string;
    downloadUrl: string;
  }>;
};

type SearchResults = {
  query: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  results: Release[];
};

type PaginatedReleases = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  results: Release[];
};

type Route =
  /** No shared project list: each project has its own public pages. */
  | { page: "unavailable" }
  | { page: "profile"; slug: string }
  | { page: "history"; slug: string; pageNumber: number }
  | { page: "changelog"; slug: string; pageNumber: number }
  | { page: "search"; slug: string; query: string; pageNumber: number }
  | { page: "release"; slug: string; version: string }
  | { page: "client"; slug: string }
  | {
      page: "subscription-action";
      slug: string;
      action: "verify" | "unsubscribe";
      token: string;
    };

function readRoute(): Route {
  if (
    window.location.hash.startsWith("#/verify-subscription?") ||
    window.location.hash.startsWith("#/unsubscribe?")
  ) {
    const action = window.location.hash.startsWith("#/verify-subscription?")
      ? "verify"
      : "unsubscribe";
    const query = new URLSearchParams(
      window.location.hash.slice(window.location.hash.indexOf("?") + 1),
    );
    const slug = query.get("project") ?? "";
    const token = query.get("token") ?? "";
    if (slug && token)
      return { page: "subscription-action", slug, action, token };
  }
  const directParts = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  if (directParts[0] === "client" && directParts[1])
    return { page: "client", slug: directParts[1] };
  const customPath = customDomainSlug
    ? customDomainPath(
        customDomainSlug,
        window.location.pathname,
        window.location.search,
      )
    : window.location.pathname;
  const parts = customPath.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== "projects" || !parts[1]) return { page: "unavailable" };
  const slug = parts[1];
  const pageNumber = Math.max(
    1,
    Number.parseInt(
      new URLSearchParams(window.location.search).get("page") ?? "1",
      10,
    ) || 1,
  );
  if (parts[2] === "search")
    return {
      page: "search",
      slug,
      query: new URLSearchParams(window.location.search).get("q") ?? "",
      pageNumber,
    };
  if (parts[2] === "changelog") return { page: "changelog", slug, pageNumber };
  if (parts[2] === "releases" && !parts[3])
    return { page: "history", slug, pageNumber };
  if (parts[2] === "releases" && parts[3])
    return { page: "release", slug, version: parts[3] };
  return { page: "profile", slug };
}

function projectPath(slug: string, section = "") {
  if (customDomainSlug && customDomainSlug === slug) return section || "/";
  return `/projects/${encodeURIComponent(slug)}${section}`;
}

function releasePath(slug: string, version: string) {
  return projectPath(slug, `/releases/${encodeURIComponent(version)}`);
}

async function getJson<T>(
  path: string,
  signal?: AbortSignal,
  locale = "en",
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(
      body?.message ??
        (response.status === 404
          ? translate(locale, "unavailable")
          : translate(locale, "loadFailure")),
    );
  }
  return response.json() as Promise<T>;
}

function formatDate(value: string, locale?: string) {
  return new Intl.DateTimeFormat(locale || undefined, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value));
}

/** The date readers care about: the release date, else when it was published. */
function shownDate(release: {
  releaseDate?: string | null;
  publishedAt: string;
}) {
  return release.releaseDate || release.publishedAt;
}

/** True when a description only repeats its title (e.g. imported PR titles). */
function repeatsTitle(title: string, description?: string) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[\s.…!?]+$/u, "")
      .replace(/\s+/g, " ")
      .trim();
  return !description || normalize(description) === normalize(title);
}

function setShareMeta(title: string, description: string) {
  document.title = title;
  const meta =
    document.querySelector<HTMLMetaElement>('meta[name="description"]') ??
    document.head.appendChild(
      Object.assign(document.createElement("meta"), { name: "description" }),
    );
  meta.content = description;
  for (const property of ["og:title", "og:description"]) {
    const tag =
      document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`) ??
      document.head.appendChild(
        Object.assign(document.createElement("meta"), { property }),
      );
    tag.content = property === "og:title" ? title : description;
  }
  const ogUrl =
    document.querySelector<HTMLMetaElement>('meta[property="og:url"]') ??
    document.head.appendChild(
      Object.assign(document.createElement("meta"), { property: "og:url" }),
    );
  ogUrl.content = window.location.href;
}

function usePublicData<T>(key: string, locale: string, clientOnly = false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    (clientOnly
      ? Promise.resolve([] as T)
      : getJson<T>(key, controller.signal, locale)
    )
      .then(setData)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : translate(locale, "loadFailure"),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [key, attempt, locale, clientOnly]);
  return {
    data,
    error,
    loading,
    retry: () => setAttempt((value) => value + 1),
  };
}

/** Published page layout for a project; the default layout until one loads. */
function usePageConfig(slug: string) {
  const [config, setConfig] = useState<PublicPageConfig>(
    defaultPublicPageConfig,
  );
  useEffect(() => {
    if (!slug) {
      setConfig(defaultPublicPageConfig());
      return;
    }
    const controller = new AbortController();
    getJson<{ config?: unknown }>(
      `/projects/${encodeURIComponent(slug)}/page`,
      controller.signal,
    )
      .then((body) => {
        if (!controller.signal.aborted)
          setConfig(normalizePublicPageConfig(body?.config));
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfig(defaultPublicPageConfig());
      });
    return () => controller.abort();
  }, [slug]);
  return config;
}

type ProjectBrand = {
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
};

function brandFrom(data: unknown, fallbackName: string): ProjectBrand {
  const item = Array.isArray(data)
    ? data[0]
    : data && typeof data === "object" && "results" in data
      ? (data as { results: unknown[] }).results[0]
      : data;
  const record =
    item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const text = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : null;
  return {
    name: text("projectName") ?? text("name") ?? fallbackName,
    logoUrl: text("logoUrl"),
    primaryColor: text("primaryColor"),
    accentColor: text("accentColor"),
  };
}

function PublicApp() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [copied, setCopied] = useState(false);
  const [localeOverride, setLocaleOverride] = useState<string | null>(null);
  const skipHostLookup = () =>
    Boolean(customDomainSlug) ||
    window.location.pathname.startsWith("/projects/") ||
    window.location.hash.startsWith("#/verify-subscription?") ||
    window.location.hash.startsWith("#/unsubscribe?");
  // A custom domain's root resolves to its project; wait before saying
  // "not found" so that page never flashes.
  const [hostResolved, setHostResolved] = useState(skipHostLookup);
  useEffect(() => {
    if (skipHostLookup()) return;
    const controller = new AbortController();
    getJson<{ slug: string }>(
      `/host?hostname=${encodeURIComponent(window.location.hostname)}`,
      controller.signal,
    )
      .then(({ slug }) => {
        if (!controller.signal.aborted && slug) {
          customDomainSlug = slug;
          setRoute(readRoute());
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setHostResolved(true);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onPopState);
    };
  }, []);

  const routeKey = JSON.stringify(route);
  useEffect(() => {
    if (
      route.page === "unavailable" ||
      route.page === "subscription-action" ||
      route.page === "client"
    )
      return;
    const kind = route.page === "release" ? "RELEASE_VIEW" : "PROJECT_VIEW";
    const version = route.page === "release" ? route.version : undefined;
    const key = `${route.slug}:${kind}:${version ?? ""}`;
    if (sentAnalyticsEvents.has(key)) return;
    sentAnalyticsEvents.add(key);
    void fetch(`${API_BASE}/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectSlug: route.slug,
        kind,
        ...(version ? { version } : {}),
      }),
      keepalive: true,
    }).catch(() => undefined);
  }, [route]);
  const endpoint = useMemo(() => {
    const contentLocale = encodeURIComponent(
      normalizeContentLocale(localeOverride ?? navigator.language),
    );
    if (
      route.page === "client" ||
      route.page === "subscription-action" ||
      route.page === "unavailable"
    )
      return "";
    if (route.page === "profile")
      return `/projects/${encodeURIComponent(route.slug)}?locale=${contentLocale}`;
    if (route.page === "history")
      return `/projects/${encodeURIComponent(route.slug)}/releases?page=${route.pageNumber}&locale=${contentLocale}`;
    if (route.page === "changelog")
      return `/projects/${encodeURIComponent(route.slug)}/changelog?page=${route.pageNumber}&locale=${contentLocale}`;
    if (route.page === "search")
      return `/projects/${encodeURIComponent(route.slug)}/search?q=${encodeURIComponent(route.query)}&page=${route.pageNumber}&locale=${contentLocale}`;
    if (route.version === "latest")
      return `/projects/${encodeURIComponent(route.slug)}/releases/latest?locale=${contentLocale}`;
    return `/projects/${encodeURIComponent(route.slug)}/releases/${encodeURIComponent(route.version)}?locale=${contentLocale}`;
  }, [route, localeOverride]);
  const result = usePublicData<
    Project[] | Project | PaginatedReleases | Release | SearchResults
  >(
    endpoint,
    localeOverride ?? normalizeLocale(navigator.language),
    endpoint === "",
  );

  const snapshotLocale = useMemo(() => {
    const data = result.data;
    const item = Array.isArray(data)
      ? data[0]
      : data && "results" in data
        ? data.results[0]
        : data;
    if (item && "locale" in item && typeof item.locale === "string")
      return item.locale;
    if (
      item &&
      "latestRelease" in item &&
      item.latestRelease &&
      typeof item.latestRelease === "object" &&
      "locale" in item.latestRelease &&
      typeof item.latestRelease.locale === "string"
    )
      return item.latestRelease.locale;
    return item &&
      "defaultLocale" in item &&
      typeof item.defaultLocale === "string"
      ? item.defaultLocale
      : undefined;
  }, [result.data]);
  const contentLocale = normalizeContentLocale(
    localeOverride ?? snapshotLocale ?? navigator.language,
  );
  const uiLocale = normalizeLocale(
    localeOverride ?? snapshotLocale ?? navigator.language,
  );
  const localeOptions = useMemo(() => {
    const data = result.data;
    const item = Array.isArray(data)
      ? data[0]
      : data && "results" in data
        ? data.results[0]
        : data;
    const publishedLocales =
      item && "availableLocales" in item && Array.isArray(item.availableLocales)
        ? item.availableLocales
        : item &&
            "latestRelease" in item &&
            item.latestRelease &&
            typeof item.latestRelease === "object" &&
            "availableLocales" in item.latestRelease &&
            Array.isArray(item.latestRelease.availableLocales)
          ? item.latestRelease.availableLocales
          : [];
    return contentLocaleOptions(publishedLocales, contentLocale);
  }, [result.data, contentLocale]);
  const t = useCallback(
    (key: string, values?: Record<string, string | number>) =>
      translate(uiLocale, key, values),
    [uiLocale],
  );
  const activeRouteSlug = "slug" in route ? route.slug : "";

  useEffect(() => {
    if (route.page !== "unavailable") return;
    const robots = document.head.appendChild(
      Object.assign(document.createElement("meta"), {
        name: "robots",
        content: "noindex",
      }),
    );
    return () => robots.remove();
  }, [route.page]);

  useEffect(() => {
    document.documentElement.lang = contentLocale;
    document.documentElement.dir = "ltr";
  }, [uiLocale, contentLocale]);

  useEffect(() => {
    if (route.page === "unavailable")
      setShareMeta(t("pageNotFoundTitle"), t("pageNotFoundBody"));
    else if (result.data && "projectName" in result.data)
      setShareMeta(
        `${result.data.title} · ${result.data.projectName}`,
        result.data.summary ??
          t("releaseMetaDescription", {
            project: result.data.projectName,
            version: result.data.version,
          }),
      );
    else if (result.data && "name" in result.data)
      setShareMeta(
        t("projectMetaTitle", { project: result.data.name }),
        t("projectMetaDescription", {
          count: result.data.releaseCount,
          project: result.data.name,
        }),
      );
    else if (route.page === "history" || route.page === "changelog")
      setShareMeta(
        t(
          route.page === "changelog"
            ? "changelogMetaTitle"
            : "historyMetaTitle",
          { project: activeRouteSlug },
        ),
        t("publishedUpdatesMeta", { project: activeRouteSlug }),
      );
    else if (route.page === "search")
      setShareMeta(
        t("searchMetaTitle", { project: activeRouteSlug }),
        t("searchMetaDescription", { project: activeRouteSlug }),
      );
  }, [routeKey, route.page, activeRouteSlug, result.data, uiLocale, t]);

  function navigate(path: string) {
    window.history.pushState({}, "", path);
    setRoute(readRoute());
    setCopied(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  const activeSlug =
    route.page === "unavailable" || route.page === "client" ? "" : route.slug;
  const searchQuery = route.page === "search" ? route.query : "";
  const pageConfig = usePageConfig(activeSlug);
  usePublicPageFonts(pageConfig);
  const [brand, setBrand] = useState<ProjectBrand | null>(null);
  useEffect(() => {
    if (!activeSlug) {
      setBrand(null);
      return;
    }
    if (!result.data) return;
    const next = brandFrom(result.data, activeSlug);
    // Empty pages (e.g. a search with no hits) carry no brand; keep the last one.
    setBrand((current) =>
      current && next.primaryColor === null && next.name === activeSlug
        ? current
        : next,
    );
  }, [activeSlug, result.data]);
  const shellStyle = useMemo(
    () => publicPageStyle(pageConfig, brand ?? {}),
    [pageConfig, brand],
  );
  useEffect(() => {
    document.body.style.backgroundColor = pageConfig.theme.backgroundColor;
    return () => {
      document.body.style.backgroundColor = "";
    };
  }, [pageConfig.theme.backgroundColor]);
  const heroEnabled = pageConfig.widgets.some(
    (widget) => widget.type === "hero" && widget.enabled,
  );
  const feedPath = activeSlug
    ? `${API_BASE}/projects/${encodeURIComponent(activeSlug)}/rss.xml`
    : undefined;
  useEffect(() => {
    const previous = document.head.querySelector<HTMLLinkElement>(
      'link[rel="alternate"][type="application/rss+xml"]',
    );
    if (!feedPath) {
      previous?.remove();
      return;
    }
    const link =
      previous ?? document.head.appendChild(document.createElement("link"));
    link.rel = "alternate";
    link.type = "application/rss+xml";
    link.title = `${activeSlug} ${translate(uiLocale, "releaseNotes")}`;
    link.href = feedPath;
    return () => link.remove();
  }, [feedPath, activeSlug, uiLocale]);

  if (route.page === "client") {
    return (
      <ClientAccessPage
        projectSlug={route.slug}
        apiBaseUrl={API_BASE.replace(/\/+public\/?$/, "")}
      />
    );
  }

  if (route.page === "subscription-action") {
    return (
      <SubscriptionActionPage
        slug={route.slug}
        action={route.action}
        token={route.token}
      />
    );
  }

  const languagePicker = (
    <label className="language-picker">
      <span className="sr-only">{t("language")}</span>
      <select
        aria-label={t("language")}
        value={contentLocale}
        onChange={(event) =>
          setLocaleOverride(normalizeContentLocale(event.target.value))
        }
      >
        {localeOptions.map((locale) => (
          <option key={locale} value={locale}>
            {locale === "si-LK"
              ? "සිංහල · si-LK"
              : locale === "ta-LK"
                ? "தமிழ் · ta-LK"
                : locale === "en"
                  ? "English · en"
                  : locale}
          </option>
        ))}
      </select>
    </label>
  );
  const homeHref = activeSlug ? projectPath(activeSlug) : "/projects";

  return (
    <LocaleContext.Provider value={uiLocale}>
      <div
        className="pp-root site-shell"
        style={shellStyle}
        {...publicPageAttributes(pageConfig)}
      >
        <a className="skip-link" href="#main">
          {t("skipToContent")}
        </a>
        <PublicSiteHeader
          config={pageConfig}
          name={activeSlug ? (brand?.name ?? activeSlug) : "RDPS"}
          logoUrl={activeSlug ? brand?.logoUrl : null}
          homeHref={homeHref}
          onHome={(event) => {
            event.preventDefault();
            navigate(homeHref);
          }}
          tail={activeSlug ? undefined : `/ ${t("releaseNotes")}`}
          nav={
            <>
              {feedPath && (
                <a href={feedPath}>
                  {t("rssFeed")} <span aria-hidden="true">↗</span>
                </a>
              )}
              {languagePicker}
            </>
          }
        />

        {activeSlug && (
          <div className="project-nav-bar">
            <nav
              className="project-nav pp-container"
              aria-label={t("projectPages")}
            >
              <div className="project-tabs">
                <button
                  type="button"
                  aria-current={route.page === "profile" ? "page" : undefined}
                  onClick={() => navigate(projectPath(activeSlug))}
                >
                  {t("overview")}
                </button>
                <button
                  type="button"
                  aria-current={route.page === "history" ? "page" : undefined}
                  onClick={() => navigate(projectPath(activeSlug, "/releases"))}
                >
                  {t("releaseHistory")}
                </button>
                <button
                  type="button"
                  aria-current={route.page === "changelog" ? "page" : undefined}
                  onClick={() =>
                    navigate(projectPath(activeSlug, "/changelog"))
                  }
                >
                  {t("changelog")}
                </button>
              </div>
              <form
                role="search"
                action={projectPath(activeSlug, "/search")}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const query = String(form.get("q") ?? "").trim();
                  navigate(
                    `${projectPath(activeSlug, "/search")}?q=${encodeURIComponent(query)}`,
                  );
                }}
              >
                <label className="sr-only" htmlFor="release-search">
                  {t("searchReleases")}
                </label>
                <input
                  id="release-search"
                  name="q"
                  type="search"
                  autoComplete="off"
                  placeholder={t("searchUpdates")}
                  defaultValue={searchQuery}
                  key={searchQuery}
                />
                <button type="submit">{t("search")}</button>
              </form>
            </nav>
          </div>
        )}

        <main id="main" tabIndex={-1} className="pp-container site-main">
          {route.page === "unavailable" ? (
            hostResolved ? (
              <section className="not-found" aria-labelledby="not-found-title">
                <p className="eyebrow">404</p>
                <h1 id="not-found-title">{t("pageNotFoundHeading")}</h1>
                <p className="lead-copy">{t("pageNotFoundBody")}</p>
              </section>
            ) : (
              <div className="state-card" role="status" aria-live="polite">
                <span className="spinner" aria-hidden="true" />
                {t("loading")}
              </div>
            )
          ) : route.page !== "profile" || !heroEnabled ? (
            <header className="page-intro">
              <p className="eyebrow">{brand?.name ?? activeSlug}</p>
              <h1>
                {route.page === "release"
                  ? `${t("releaseTitle")} ${route.version}`
                  : route.page === "history"
                    ? t("releaseHistory")
                    : route.page === "changelog"
                      ? t("changelog")
                      : route.page === "search"
                        ? t("publicSearch")
                        : (brand?.name ?? activeSlug)}
              </h1>
              {route.page === "release" && (
                <>
                  <button
                    className="text-button"
                    type="button"
                    onClick={copyLink}
                  >
                    {copied ? t("linkCopied") : t("copyShareLink")}
                  </button>
                  <span className="sr-only" role="status" aria-live="polite">
                    {copied ? t("pageLinkCopied") : ""}
                  </span>
                </>
              )}
            </header>
          ) : null}

          {result.loading && route.page !== "unavailable" && (
            <div className="state-card" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              {t("loading")}
            </div>
          )}
          {result.error && !result.loading && (
            <div className="state-card state-error" role="alert">
              <h2>{t("loadErrorTitle")}</h2>
              <p>{result.error}</p>
              <button type="button" onClick={result.retry}>
                {t("tryAgain")}
              </button>
            </div>
          )}
          {!result.loading &&
            !result.error &&
            route.page === "profile" &&
            result.data &&
            "name" in result.data && (
              <ProjectProfile
                project={result.data as Project}
                config={pageConfig}
                locale={contentLocale}
                navigate={navigate}
              />
            )}
          {!result.loading &&
            !result.error &&
            (route.page === "history" || route.page === "changelog") &&
            result.data &&
            "totalPages" in result.data && (
              <ReleaseList
                result={result.data as PaginatedReleases}
                slug={activeSlug}
                heading={
                  route.page === "changelog"
                    ? t("changelog")
                    : t("releaseHistory")
                }
                navigate={navigate}
              />
            )}
          {!result.loading &&
            !result.error &&
            route.page === "release" &&
            result.data &&
            "projectName" in result.data && (
              <ReleaseDetail
                release={result.data as Release}
                navigate={navigate}
              />
            )}
          {!result.loading &&
            !result.error &&
            route.page === "search" &&
            result.data &&
            "results" in result.data && (
              <SearchPage
                result={result.data as SearchResults}
                slug={activeSlug}
                navigate={navigate}
              />
            )}
        </main>

        <PublicSiteFooter config={pageConfig} poweredBy={t("poweredBy")}>
          <span>{t("publishedInformation")}</span>
        </PublicSiteFooter>
      </div>
    </LocaleContext.Provider>
  );
}

function ProjectProfile({
  project,
  config,
  locale,
  navigate,
}: {
  project: Project;
  config: PublicPageConfig;
  locale: string;
  navigate: (path: string) => void;
}) {
  const t = useT();
  const recentWidget = config.widgets.find(
    (widget) => widget.type === "recentReleases" && widget.enabled,
  );
  const recentCount = recentWidget?.count ?? 0;
  const [recent, setRecent] = useState<PublicPageRelease[]>([]);
  useEffect(() => {
    if (!recentCount) {
      setRecent([]);
      return;
    }
    const controller = new AbortController();
    getJson<PaginatedReleases>(
      `/projects/${encodeURIComponent(project.slug)}/releases?page=1&pageSize=${recentCount}&locale=${encodeURIComponent(locale)}`,
      controller.signal,
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        setRecent(
          (Array.isArray(page?.results) ? page.results : []).map((release) => ({
            version: release.version,
            title: release.title,
            summary: release.summary,
            publishedAt: shownDate(release),
          })),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setRecent([]);
      });
    return () => controller.abort();
  }, [project.slug, recentCount, locale]);

  return (
    <PublicProjectPage
      config={config}
      locale={project.defaultLocale ?? locale}
      t={t}
      data={{
        slug: project.slug,
        name: project.name,
        logoUrl: project.logoUrl,
        primaryColor: project.primaryColor,
        accentColor: project.accentColor,
        releaseCount: project.releaseCount,
        latestPublishedAt:
          project.latestReleaseDate || project.latestPublishedAt,
        latestRelease: project.latestRelease
          ? {
              version: project.latestRelease.version,
              title: project.latestRelease.title,
              summary: project.latestRelease.summary,
              publishedAt: shownDate(project.latestRelease),
            }
          : null,
        recentReleases: recent,
      }}
      links={{
        release: (version) => releasePath(project.slug, version),
        history: projectPath(project.slug, "/releases"),
        changelog: projectPath(project.slug, "/changelog"),
        rss: `${API_BASE}/projects/${encodeURIComponent(project.slug)}/rss.xml`,
        navigate,
        search: (query) =>
          navigate(
            `${projectPath(project.slug, "/search")}?q=${encodeURIComponent(query)}`,
          ),
        subscribe: async (email) => {
          const response = await fetch(
            `${API_BASE}/projects/${encodeURIComponent(project.slug)}/subscriptions`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email,
                locale: project.defaultLocale ?? "en",
              }),
            },
          );
          if (!response.ok) throw new Error(t("subscriptionRequestFailed"));
        },
      }}
    />
  );
}

function SubscriptionActionPage({
  slug,
  action,
  token,
}: {
  slug: string;
  action: "verify" | "unsubscribe";
  token: string;
}) {
  const t = useT();
  const [message, setMessage] = useState(() => t("processingRequest"));
  useEffect(() => {
    let active = true;
    const route =
      action === "verify"
        ? "/subscriptions/verify"
        : "/subscriptions/unsubscribe";
    void fetch(`${API_BASE}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: slug, token }),
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          verified?: boolean;
          unsubscribed?: boolean;
        };
        if (!response.ok) throw new Error(t("subscriptionLinkUnavailable"));
        if (active)
          setMessage(
            action === "verify"
              ? body.verified
                ? t("subscriptionConfirmed")
                : t("confirmationExpired")
              : body.unsubscribed
                ? t("unsubscribed")
                : t("unsubscribeExpired"),
          );
      })
      .catch(() => {
        if (active)
          setMessage(
            `${t("subscriptionLinkUnavailable")} ${t("requestNewLink")}`,
          );
      })
      .finally(() => {
        if (active)
          window.history.replaceState({}, "", window.location.pathname);
      });
    return () => {
      active = false;
    };
  }, [action, slug, token, t]);
  return (
    <main className="subscription-action">
      <a className="skip-link" href="#main">
        {t("skipToContent")}
      </a>
      <a className="wordmark" href="/projects">
        <span className="mark" aria-hidden="true">
          R
        </span>
        <span>RDPS</span>
        <span className="wordmark-tail"> / {t("releaseNotes")}</span>
      </a>
      <section id="main" className="content-section" tabIndex={-1}>
        <p className="eyebrow">{t("emailPreferences")}</p>
        <h1>
          {action === "verify" ? t("confirmSubscription") : t("unsubscribe")}
        </h1>
        <p role="status">{message}</p>
      </section>
    </main>
  );
}

function ReleaseList({
  result,
  slug,
  heading,
  navigate,
}: {
  result: PaginatedReleases;
  slug: string;
  heading: string;
  navigate: (path: string) => void;
}) {
  const t = useT();
  const releases = result.results;
  const section = heading === t("changelog") ? "/changelog" : "/releases";
  return (
    <section className="content-section" aria-labelledby="release-list-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{heading.toUpperCase()}</p>
          <h2 id="release-list-title">{heading}</h2>
        </div>
        <span className="count-pill">
          {result.total} {t("versions")}
        </span>
      </div>
      {releases.length === 0 ? (
        <p className="empty-state">{t("noReleases")}</p>
      ) : (
        <ol className="release-list">
          {releases.map((release) => (
            <li key={`${release.version}-${release.publishedAt}`}>
              <time dateTime={shownDate(release)}>
                {formatDate(shownDate(release), release.defaultLocale)}
              </time>
              <div>
                <p className="release-version">{release.version}</p>
                <h3>
                  <a
                    href={releasePath(slug, release.version)}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(releasePath(slug, release.version));
                    }}
                  >
                    {release.title}
                  </a>
                </h3>
                {release.summary && <p>{release.summary}</p>}
                {release.changes && release.changes.length > 0 && (
                  <ul className="change-preview">
                    {release.changes.slice(0, 3).map((change, index) => (
                      <li key={`${change.sortOrder}-${index}`}>
                        <span className="category-tag">
                          {change.category.replaceAll("_", " ").toLowerCase()}
                        </span>
                        {change.title}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <a
                className="arrow-link"
                href={releasePath(slug, release.version)}
                aria-label={t("readVersionNotes", { version: release.version })}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(releasePath(slug, release.version));
                }}
              >
                →
              </a>
            </li>
          ))}
        </ol>
      )}
      {result.totalPages > 1 && (
        <nav className="pagination" aria-label={t("releasePagination")}>
          <button
            className="secondary-button"
            type="button"
            disabled={result.page <= 1}
            onClick={() =>
              navigate(projectPath(slug, `${section}?page=${result.page - 1}`))
            }
          >
            {t("previousPage")}
          </button>
          <span aria-live="polite">
            {result.page} / {result.totalPages}
          </span>
          <button
            className="secondary-button"
            type="button"
            disabled={result.page >= result.totalPages}
            onClick={() =>
              navigate(projectPath(slug, `${section}?page=${result.page + 1}`))
            }
          >
            {t("nextPage")}
          </button>
        </nav>
      )}
    </section>
  );
}

function ReleaseDetail({
  release,
  navigate,
}: {
  release: Release;
  navigate: (path: string) => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <article className="content-section release-detail">
      <p className="eyebrow">
        {release.projectName} · {t("releaseNotesEyebrow")}
      </p>
      <div className="detail-heading">
        <div>
          <p className="release-version">{release.version}</p>
          <h2>{release.title}</h2>
        </div>
        <button className="secondary-button" type="button" onClick={copy}>
          {copied ? t("copied") : t("copyLink")}
        </button>
      </div>
      <time dateTime={shownDate(release)}>
        {release.releaseDate ? t("releasedOn") : t("publishedOn")}{" "}
        {formatDate(shownDate(release), release.locale)}
      </time>
      {release.summary && <p className="lead-copy">{release.summary}</p>}
      <div className="share-links">
        <a
          href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.href)}`}
          target="_blank"
          rel="noreferrer"
        >
          {t("shareLinkedIn")}
        </a>
        <a
          href={`mailto:?subject=${encodeURIComponent(release.title)}&body=${encodeURIComponent(window.location.href)}`}
        >
          {t("shareEmail")}
        </a>
        <span role="status" aria-live="polite">
          {copied ? t("releaseCopied") : ""}
        </span>
      </div>
      {release.attachments?.length ? (
        <section
          className="public-attachments"
          aria-labelledby="attachments-heading"
        >
          <h3 id="attachments-heading">{t("releaseAttachments")}</h3>
          <ul>
            {release.attachments.map((attachment) => (
              <li key={attachment.id}>
                <a href={`${API_BASE}${attachment.downloadUrl}`} download>
                  {attachment.fileName}
                </a>
                <small>
                  {(Number(attachment.sizeBytes) / 1024).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 1 },
                  )}{" "}
                  KB
                </small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <h3 className="changes-heading">{t("whatChanged")}</h3>
      {release.changes?.length ? (
        <ul className="change-list">
          {release.changes.map((change, index) => (
            <li key={`${change.sortOrder}-${index}`}>
              <span className="category-tag">
                {change.category.replaceAll("_", " ").toLowerCase()}
              </span>
              <div>
                <h4>{change.title}</h4>
                {!repeatsTitle(change.title, change.description) && (
                  <p>{change.description}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-state">{t("noPublicChanges")}</p>
      )}
      <button
        className="text-button"
        type="button"
        onClick={() => navigate(projectPath(release.projectSlug, "/releases"))}
      >
        ← {t("backToHistory")}
      </button>
    </article>
  );
}

function SearchPage({
  result,
  slug,
  navigate,
}: {
  result: SearchResults;
  slug: string;
  navigate: (path: string) => void;
}) {
  const t = useT();
  const searchPath = (page: number) =>
    projectPath(
      slug,
      `/search?q=${encodeURIComponent(result.query)}&page=${page}`,
    );
  return (
    <section className="content-section" aria-labelledby="search-title">
      <p className="eyebrow">{t("publicSearch")}</p>
      <h2 id="search-title">
        {t("searchResultsFor", { query: result.query })}
      </h2>
      <p className="muted-copy">
        {result.total} {t("matching")}{" "}
        {t(result.total === 1 ? "release" : "releases")}
      </p>
      {result.results.length ? (
        <ol className="release-list">
          {result.results.map((release) => (
            <li key={`${release.version}-${release.publishedAt}`}>
              <time dateTime={shownDate(release)}>
                {formatDate(shownDate(release), release.defaultLocale)}
              </time>
              <div>
                <p className="release-version">{release.version}</p>
                <h3>
                  <a
                    href={releasePath(slug, release.version)}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(releasePath(slug, release.version));
                    }}
                  >
                    {release.title}
                  </a>
                </h3>
                <p>{release.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-state">{t("noSearchResults")}</p>
      )}
      {result.totalPages > 1 && (
        <nav className="pagination" aria-label={t("releasePagination")}>
          <button
            className="secondary-button"
            type="button"
            disabled={result.page <= 1}
            onClick={() => navigate(searchPath(result.page - 1))}
          >
            {t("previousPage")}
          </button>
          <span aria-live="polite">
            {result.page} / {result.totalPages}
          </span>
          <button
            className="secondary-button"
            type="button"
            disabled={result.page >= result.totalPages}
            onClick={() => navigate(searchPath(result.page + 1))}
          >
            {t("nextPage")}
          </button>
        </nav>
      )}
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<PublicApp />);
