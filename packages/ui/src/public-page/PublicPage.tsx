import {
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  FONT_OPTIONS,
  accessibleColor,
  mixColors,
  readableOn,
  type PublicPageConfig,
  type PublicPageWidget,
} from "./config";

export type PublicPageRelease = {
  version: string;
  title: string;
  summary: string | null;
  publishedAt: string;
};

export type PublicPageData = {
  slug: string;
  name: string;
  logoUrl?: string | null | undefined;
  primaryColor?: string | null | undefined;
  accentColor?: string | null | undefined;
  releaseCount: number;
  latestPublishedAt?: string | null | undefined;
  latestRelease?: PublicPageRelease | null | undefined;
  recentReleases: PublicPageRelease[];
};

export type PublicPageLinks = {
  release: (version: string) => string;
  history: string;
  changelog: string;
  rss: string;
  navigate: (href: string) => void;
  search: (query: string) => void;
  subscribe?: (email: string) => Promise<void>;
};

export type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

const WIDTHS = {
  narrow: "880px",
  standard: "1180px",
  wide: "1360px",
  full: "100%",
} as const;

const GAPS = {
  compact: "16px",
  comfortable: "24px",
  spacious: "36px",
} as const;

/** CSS custom properties for a config. Brand colours fill unset theme colours. */
export function publicPageStyle(
  config: PublicPageConfig,
  brand: { primaryColor?: string | null; accentColor?: string | null } = {},
): CSSProperties {
  const { theme, layout } = config;
  const primary = theme.primaryColor ?? brand.primaryColor ?? "#2457c5";
  const accent = theme.accentColor ?? brand.accentColor ?? primary;
  // Text drawn in brand colours must stay readable on cards, the page, and
  // the tinted "soft" panels (which CSS mixes as 9% primary into the surface).
  const soft = mixColors(theme.surfaceColor, primary, 0.09);
  const backgrounds = [theme.surfaceColor, theme.backgroundColor, soft];
  return {
    "--pp-primary": primary,
    "--pp-primary-text": accessibleColor(primary, backgrounds, theme.textColor),
    "--pp-muted": accessibleColor(
      theme.mutedColor,
      backgrounds,
      theme.textColor,
    ),
    "--pp-on-primary": readableOn(primary),
    "--pp-accent": accent,
    "--pp-on-accent": readableOn(accent),
    "--pp-bg": theme.backgroundColor,
    "--pp-surface": theme.surfaceColor,
    "--pp-text": theme.textColor,
    "--pp-border": theme.borderColor,
    "--pp-font-heading": FONT_OPTIONS[theme.headingFont].stack,
    "--pp-font-body": FONT_OPTIONS[theme.bodyFont].stack,
    "--pp-font-size": `${theme.baseFontSize}px`,
    "--pp-heading-scale": String(theme.headingScale),
    "--pp-heading-weight": String(theme.headingWeight),
    "--pp-radius": `${theme.radius}px`,
    "--pp-width": WIDTHS[layout.contentWidth],
    "--pp-gap": GAPS[layout.density],
  } as CSSProperties;
}

export function publicPageAttributes(config: PublicPageConfig) {
  return {
    "data-pp-template": config.layout.template,
    "data-pp-cards": config.layout.cardStyle,
    "data-pp-header": config.layout.headerStyle,
    "data-pp-density": config.layout.density,
  };
}

export function googleFontsHref(config: PublicPageConfig): string | null {
  const families = [
    ...new Set(
      [config.theme.headingFont, config.theme.bodyFont]
        .map((key) => {
          const option = FONT_OPTIONS[key] as { google?: string };
          return option.google;
        })
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  return families.length
    ? `https://fonts.googleapis.com/css2?${families.map((family) => `family=${family}`).join("&")}&display=swap`
    : null;
}

/** Loads the Google Fonts a config needs, once per href. */
export function usePublicPageFonts(config: PublicPageConfig) {
  const href = googleFontsHref(config);
  useEffect(() => {
    if (!href || typeof document === "undefined") return;
    const existing = document.head.querySelector(
      `link[data-pp-font="${CSS.escape(href)}"]`,
    );
    if (existing) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.ppFont = href;
    document.head.appendChild(link);
  }, [href]);
}

function formatDate(value: string | null | undefined, locale?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(locale || undefined, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

function linkHandler(href: string, navigate: (href: string) => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    navigate(href);
  };
}

type WidgetProps = {
  widget: PublicPageWidget;
  data: PublicPageData;
  links: PublicPageLinks;
  t: Translate;
  locale?: string | undefined;
  preview: boolean;
};

function Card({
  widget,
  className = "",
  children,
  label,
}: {
  widget: PublicPageWidget;
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  return (
    <section
      className={`pp-card pp-widget-${widget.type} ${className}`.trim()}
      data-align={widget.align}
      aria-label={label}
    >
      {children}
    </section>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return <p className="pp-placeholder">{children}</p>;
}

function HeroWidget({ widget, data, t }: WidgetProps) {
  return (
    <section className="pp-hero" data-align={widget.align}>
      <div className="pp-hero-copy">
        <p className="pp-eyebrow">{t("whatsNew")}</p>
        <h1>{widget.title || data.name}</h1>
        <p className="pp-hero-text">{widget.body || t("heroText")}</p>
      </div>
      <div className="pp-hero-mark" aria-hidden="true">
        {data.logoUrl ? (
          <img src={data.logoUrl} alt="" />
        ) : (
          <span>{data.name.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
    </section>
  );
}

function LatestReleaseWidget({
  widget,
  data,
  links,
  t,
  locale,
  preview,
}: WidgetProps) {
  const latest = data.latestRelease;
  return (
    <Card widget={widget} className="pp-feature">
      <p className="pp-eyebrow">
        {widget.title || t("latestPublishedRelease")}
      </p>
      {latest ? (
        <>
          <p className="pp-version">{latest.version}</p>
          <h2>{latest.title}</h2>
          <p className="pp-copy">
            {latest.summary || t("releaseNotesAvailable")}
          </p>
          <div className="pp-row">
            <time dateTime={latest.publishedAt}>
              {formatDate(latest.publishedAt, locale)}
            </time>
            <a
              className="pp-button"
              href={links.release(latest.version)}
              onClick={linkHandler(
                links.release(latest.version),
                links.navigate,
              )}
            >
              {t("readReleaseNotes")} <span aria-hidden="true">→</span>
            </a>
          </div>
        </>
      ) : (
        <Placeholder>
          {preview
            ? "Your newest published release appears here."
            : t("noReleases")}
        </Placeholder>
      )}
    </Card>
  );
}

function RecentReleasesWidget({
  widget,
  data,
  links,
  t,
  locale,
  preview,
}: WidgetProps) {
  const items = data.recentReleases.slice(0, widget.count || 3);
  return (
    <Card widget={widget}>
      <div className="pp-card-head">
        <h2>{widget.title || t("recentReleases")}</h2>
        <a
          href={links.history}
          onClick={linkHandler(links.history, links.navigate)}
        >
          {t("viewAllReleases")} <span aria-hidden="true">→</span>
        </a>
      </div>
      {items.length ? (
        <ol className="pp-release-list">
          {items.map((release) => (
            <li key={`${release.version}-${release.publishedAt}`}>
              <span className="pp-version">{release.version}</span>
              <a
                href={links.release(release.version)}
                onClick={linkHandler(
                  links.release(release.version),
                  links.navigate,
                )}
              >
                {release.title}
              </a>
              <time dateTime={release.publishedAt}>
                {formatDate(release.publishedAt, locale)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <Placeholder>
          {preview ? "Published releases are listed here." : t("noReleases")}
        </Placeholder>
      )}
    </Card>
  );
}

function StatsWidget({ widget, data, t, locale }: WidgetProps) {
  return (
    <Card widget={widget}>
      <h2>{widget.title || t("releaseStats")}</h2>
      <dl className="pp-stats">
        <div>
          <dt>{t("statReleases")}</dt>
          <dd>{data.releaseCount}</dd>
        </div>
        <div>
          <dt>{t("lastUpdated")}</dt>
          <dd className="pp-stats-date">
            {formatDate(data.latestPublishedAt, locale) || "—"}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function TextWidget({ widget, t, preview }: WidgetProps) {
  const heading =
    widget.title || (widget.type === "about" ? t("aboutProject") : "");
  if (!widget.body && !preview) return null;
  return (
    <Card widget={widget}>
      {heading && <h2>{heading}</h2>}
      {widget.body ? (
        <p className="pp-copy pp-prose">{widget.body}</p>
      ) : (
        <Placeholder>Add text for this block in the page designer.</Placeholder>
      )}
    </Card>
  );
}

function NavigationWidget({ widget, links, t }: WidgetProps) {
  return (
    <Card widget={widget}>
      <h2>{widget.title || t("pageLinks")}</h2>
      <ul className="pp-link-list">
        <li>
          <a
            href={links.history}
            onClick={linkHandler(links.history, links.navigate)}
          >
            {t("browseReleaseHistory")} <span aria-hidden="true">→</span>
          </a>
        </li>
        <li>
          <a
            href={links.changelog}
            onClick={linkHandler(links.changelog, links.navigate)}
          >
            {t("readChangelog")} <span aria-hidden="true">→</span>
          </a>
        </li>
        <li>
          <a href={links.rss}>
            {t("subscribeRss")} <span aria-hidden="true">↗</span>
          </a>
        </li>
      </ul>
    </Card>
  );
}

function LinksWidget({ widget, t, preview }: WidgetProps) {
  if (!widget.links.length && !preview) return null;
  return (
    <Card widget={widget}>
      <h2>{widget.title || t("usefulLinks")}</h2>
      {widget.links.length ? (
        <ul className="pp-link-list">
          {widget.links.map((link, index) => (
            <li key={`${link.url}-${index}`}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label} <span aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <Placeholder>Add links in the page designer.</Placeholder>
      )}
    </Card>
  );
}

function SearchWidget({ widget, links, t }: WidgetProps) {
  const [query, setQuery] = useState("");
  return (
    <Card widget={widget}>
      <h2>{widget.title || t("searchReleases")}</h2>
      <form
        className="pp-inline-form"
        role="search"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          links.search(query.trim());
        }}
      >
        <label className="pp-sr-only" htmlFor={`pp-search-${widget.id}`}>
          {t("searchReleases")}
        </label>
        <input
          id={`pp-search-${widget.id}`}
          type="search"
          autoComplete="off"
          placeholder={t("searchUpdates")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="pp-button" type="submit">
          {t("search")}
        </button>
      </form>
    </Card>
  );
}

function SubscribeWidget({ widget, links, t, preview }: WidgetProps) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card widget={widget} className="pp-subscribe">
      <p className="pp-eyebrow">{t("emailUpdates")}</p>
      <h2>{widget.title || t("getByEmail")}</h2>
      <p className="pp-copy">{widget.body || t("confirmBeforeSending")}</p>
      <form
        className="pp-inline-form"
        onSubmit={async (event: FormEvent) => {
          event.preventDefault();
          if (preview || !links.subscribe) return;
          setBusy(true);
          setMessage("");
          try {
            await links.subscribe(email);
            setEmail("");
            setMessage(t("confirmationCheckInbox"));
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : t("subscriptionRequestFailed"),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="pp-sr-only" htmlFor={`pp-email-${widget.id}`}>
          {t("emailAddress")}
        </label>
        <input
          id={`pp-email-${widget.id}`}
          name="email"
          type="email"
          required
          maxLength={320}
          spellCheck={false}
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button className="pp-button" type="submit" disabled={busy}>
          {busy ? t("sending") : t("subscribe")}
        </button>
      </form>
      {message && (
        <p className="pp-status" role="status">
          {message}
        </p>
      )}
    </Card>
  );
}

const RENDERERS: Record<
  PublicPageWidget["type"],
  (props: WidgetProps) => ReactNode
> = {
  hero: HeroWidget,
  latestRelease: LatestReleaseWidget,
  recentReleases: RecentReleasesWidget,
  stats: StatsWidget,
  about: TextWidget,
  customText: TextWidget,
  navigation: NavigationWidget,
  links: LinksWidget,
  search: SearchWidget,
  subscribe: SubscribeWidget,
};

export type PublicProjectPageProps = {
  config: PublicPageConfig;
  data: PublicPageData;
  links: PublicPageLinks;
  t: Translate;
  locale?: string | undefined;
  /** Designer preview: shows placeholders and disables submissions. */
  preview?: boolean;
  selectedWidgetId?: string | null | undefined;
  hoveredWidgetId?: string | null | undefined;
  onSelectWidget?: ((id: string) => void) | undefined;
};

/** Renders the widget regions of a project's public overview page. */
export function PublicProjectPage({
  config,
  data,
  links,
  t,
  locale,
  preview = false,
  selectedWidgetId,
  hoveredWidgetId,
  onSelectWidget,
}: PublicProjectPageProps) {
  const visible = config.widgets.filter((widget) => widget.enabled);
  const top = visible.filter((widget) => widget.region === "top");
  const rest = visible.filter((widget) => widget.region !== "top");
  const single = config.layout.template === "single";
  const main = single
    ? rest
    : rest.filter((widget) => widget.region === "main");
  const side = single
    ? []
    : rest.filter((widget) => widget.region === "sidebar");

  const render = (widget: PublicPageWidget) => {
    const Renderer = RENDERERS[widget.type];
    const content = (
      <Renderer
        widget={widget}
        data={data}
        links={links}
        t={t}
        locale={locale}
        preview={preview}
      />
    );
    if (!preview)
      return (
        <div key={widget.id} className="pp-slot">
          {content}
        </div>
      );
    return (
      <div
        key={widget.id}
        className="pp-slot pp-slot-preview"
        data-widget-id={widget.id}
        data-selected={selectedWidgetId === widget.id ? "true" : undefined}
        data-hovered={hoveredWidgetId === widget.id ? "true" : undefined}
        onClickCapture={(event) => {
          if (!onSelectWidget) return;
          event.preventDefault();
          event.stopPropagation();
          onSelectWidget(widget.id);
        }}
      >
        {content}
      </div>
    );
  };

  return (
    <div className="pp-page">
      {top.length > 0 && (
        <div className="pp-region pp-region-top">{top.map(render)}</div>
      )}
      <div className="pp-grid">
        <div className="pp-region pp-region-main">{main.map(render)}</div>
        {side.length > 0 && (
          <aside className="pp-region pp-region-sidebar">
            {side.map(render)}
          </aside>
        )}
      </div>
      {preview && visible.length === 0 && (
        <Placeholder>
          All widgets are hidden. Turn one on to see it here.
        </Placeholder>
      )}
    </div>
  );
}

export type PublicSiteHeaderProps = {
  config: PublicPageConfig;
  name: string;
  logoUrl?: string | null | undefined;
  homeHref: string;
  onHome?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  nav?: ReactNode;
  tail?: string | undefined;
};

export function PublicSiteHeader({
  config,
  name,
  logoUrl,
  homeHref,
  onHome,
  nav,
  tail,
}: PublicSiteHeaderProps) {
  return (
    <header className="pp-header" data-style={config.layout.headerStyle}>
      <div className="pp-header-inner">
        <a className="pp-wordmark" href={homeHref} onClick={onHome}>
          {logoUrl ? (
            <img className="pp-logo" src={logoUrl} alt="" height={28} />
          ) : (
            <span className="pp-mark" aria-hidden="true">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="pp-wordmark-name">{name}</span>
          {tail && <span className="pp-wordmark-tail">{tail}</span>}
        </a>
        {nav && <nav className="pp-nav">{nav}</nav>}
      </div>
    </header>
  );
}

export function PublicSiteFooter({
  config,
  children,
  poweredBy,
}: {
  config: PublicPageConfig;
  children?: ReactNode;
  poweredBy: string;
}) {
  return (
    <footer className="pp-footer">
      <div className="pp-footer-inner">
        {children}
        {config.layout.showPoweredBy && (
          <span className="pp-powered">
            {poweredBy} <b>RDPS</b>
          </span>
        )}
      </div>
    </footer>
  );
}
