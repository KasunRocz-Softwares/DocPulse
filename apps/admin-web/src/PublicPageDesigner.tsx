import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CARD_STYLES,
  CONTENT_WIDTHS,
  DENSITIES,
  FONT_KEYS,
  FONT_OPTIONS,
  HEADER_STYLES,
  LAYOUT_TEMPLATES,
  LIMITS,
  REPEATABLE_WIDGETS,
  THEME_PRESETS,
  WIDGET_META,
  WIDGET_TYPES,
  PublicProjectPage,
  PublicSiteFooter,
  PublicSiteHeader,
  applyThemePreset,
  contrastRatio,
  createWidget,
  defaultPublicPageConfig,
  normalizePublicPageConfig,
  parsePublicPageConfig,
  publicPageAttributes,
  publicPageStyle,
  readableOn,
  translatePreview,
  usePublicPageFonts,
  type PublicPageConfig,
  type PublicPageData,
  type PublicPageTheme,
  type PublicPageWidget,
  type WidgetType,
} from "@rdps/ui/public-page";
import "@rdps/ui/public-page.css";
import { adminApi, api, apiBaseUrl } from "./api";
import { ApiError } from "./api-client";
import "./public-page-designer.css";

type PublicPageState = {
  draft: PublicPageConfig;
  published: PublicPageConfig | null;
  draftUpdatedAt: string | null;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
};

type Brand = {
  primaryColor: string;
  accentColor: string | null;
  logoUrl: string | null;
};

type DesignerProject = { id: string; name: string; slug: string };
type Panel = "theme" | "layout" | "widgets";
type Device = "desktop" | "tablet" | "mobile";

const LABELS: Record<string, string> = {
  single: "Single column",
  "sidebar-right": "Sidebar right",
  "sidebar-left": "Sidebar left",
  narrow: "Narrow",
  standard: "Standard",
  wide: "Wide",
  full: "Full width",
  compact: "Compact",
  comfortable: "Comfortable",
  spacious: "Spacious",
  flat: "Flat",
  bordered: "Bordered",
  elevated: "Elevated",
  centered: "Centered",
  minimal: "Minimal",
  top: "Top banner",
  main: "Main column",
  sidebar: "Sidebar",
  start: "Left",
  center: "Center",
};

export function publicSiteUrl() {
  const configured = import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, "");
  if (import.meta.env.DEV) return "http://localhost:5174";
  const { protocol, host } = window.location;
  return `${protocol}//${host.replace(/^admin\./, "")}`;
}

function messageFor(error: unknown) {
  if (error instanceof ApiError && error.status === 403)
    return "Only project administrators can change the public page.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

function timeLabel(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function sampleData(project: DesignerProject): PublicPageData {
  const day = 86_400_000;
  const now = Date.now();
  const releases = [
    ["2.4.0", "Faster dashboards and saved filters"],
    ["2.3.1", "Reliability fixes for exports"],
    ["2.3.0", "Team workspaces"],
    ["2.2.0", "New notification centre"],
    ["2.1.0", "Single sign-on improvements"],
  ].map(([version, title], index) => ({
    version: version!,
    title: title!,
    summary: "Sample release used for the preview until notes are published.",
    publishedAt: new Date(now - index * 12 * day).toISOString(),
  }));
  return {
    slug: project.slug,
    name: project.name,
    releaseCount: releases.length,
    latestPublishedAt: releases[0]!.publishedAt,
    latestRelease: releases[0]!,
    recentReleases: releases,
  };
}

/** Loads the project's real published content for the preview, if any. */
function usePreviewData(project: DesignerProject) {
  const [data, setData] = useState<PublicPageData>(() => sampleData(project));
  const [sample, setSample] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const base = `${apiBaseUrl.replace(/\/+$/, "")}/public/projects/${encodeURIComponent(project.slug)}`;
    const load = (path: string) =>
      fetch(`${base}${path}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      }).then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<Record<string, unknown>>;
      });
    Promise.all([load(""), load("/releases?page=1&pageSize=10")])
      .then(([profile, page]) => {
        if (typeof profile.name !== "string")
          throw new Error("Project has no published release notes");
        const results = Array.isArray(page.results)
          ? (page.results as PublicPageData["recentReleases"])
          : [];
        const latest = profile.latestRelease as
          PublicPageData["latestRelease"] | undefined;
        setData({
          slug: project.slug,
          name: String(profile.name ?? project.name),
          logoUrl: (profile.logoUrl as string | null) ?? null,
          releaseCount: Number(profile.releaseCount ?? results.length),
          latestPublishedAt: (profile.latestPublishedAt as string) ?? null,
          latestRelease: latest ?? null,
          recentReleases: results,
        });
        setSample(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setData(sampleData(project));
        setSample(true);
      });
    return () => controller.abort();
  }, [project]);
  return { data, sample };
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="ppd-field">
      <legend>{label}</legend>
      <div className="ppd-segmented">
        {options.map((option) => (
          <label key={option} data-active={option === value || undefined}>
            <input
              type="radio"
              name={label}
              value={option}
              checked={option === value}
              onChange={() => onChange(option)}
            />
            {LABELS[option] ?? option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ColorField({
  label,
  value,
  onChange,
  inherit,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  inherit?: string | undefined;
}) {
  const shown = value ?? inherit ?? "#000000";
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <div className="ppd-color">
      <label className="ppd-color-swatch" style={{ background: shown }}>
        <span className="sr-only">{label} colour picker</span>
        <input
          type="color"
          value={shown}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <label className="ppd-color-text">
        <span>{label}</span>
        <input
          value={text}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label} hex value`}
          onChange={(event) => {
            setText(event.target.value);
            if (/^#[0-9a-f]{6}$/i.test(event.target.value))
              onChange(event.target.value.toLowerCase());
          }}
          onBlur={() => setText(shown)}
        />
      </label>
      {inherit !== undefined && (
        <button
          type="button"
          className="ppd-chip"
          aria-pressed={value === null}
          onClick={() => onChange(value === null ? inherit : null)}
          title="Use the project brand colour"
        >
          {value === null ? "Brand" : "Use brand"}
        </button>
      )}
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  unit = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="ppd-field ppd-range">
      <span>
        {label} <output>{`${value}${unit}`}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ContrastBadge({
  label,
  foreground,
  background,
}: {
  label: string;
  foreground: string;
  background: string;
}) {
  const ratio = contrastRatio(foreground, background);
  const level = ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : "Low";
  return (
    <li data-level={level}>
      <span
        className="ppd-contrast-sample"
        style={{ color: foreground, background }}
        aria-hidden="true"
      >
        Aa
      </span>
      <span>{label}</span>
      <strong>
        {ratio.toFixed(2)} · {level}
      </strong>
    </li>
  );
}

function WidgetEditor({
  widget,
  onChange,
}: {
  widget: PublicPageWidget;
  onChange: (next: PublicPageWidget) => void;
}) {
  const set = <K extends keyof PublicPageWidget>(
    key: K,
    value: PublicPageWidget[K],
  ) => onChange({ ...widget, [key]: value });
  const bodyLabel =
    widget.type === "hero"
      ? "Introduction"
      : widget.type === "subscribe"
        ? "Description"
        : "Text";
  const hasBody = ["hero", "about", "customText", "subscribe"].includes(
    widget.type,
  );
  const hasAlign = ["hero", "about", "customText"].includes(widget.type);
  return (
    <div className="ppd-widget-editor">
      <label className="ppd-field">
        <span>{widget.type === "hero" ? "Heading" : "Title"}</span>
        <input
          value={widget.title}
          maxLength={LIMITS.title}
          placeholder="Use the default heading"
          onChange={(event) => set("title", event.target.value)}
        />
      </label>
      {hasBody && (
        <label className="ppd-field">
          <span>
            {bodyLabel}{" "}
            <small>
              {widget.body.length}/{LIMITS.body}
            </small>
          </span>
          <textarea
            rows={widget.type === "hero" ? 2 : 4}
            value={widget.body}
            maxLength={LIMITS.body}
            placeholder={
              widget.type === "hero" || widget.type === "subscribe"
                ? "Use the default text"
                : "Plain text. Line breaks are kept."
            }
            onChange={(event) => set("body", event.target.value)}
          />
        </label>
      )}
      {widget.type === "recentReleases" && (
        <Range
          label="Releases shown"
          value={widget.count || 3}
          min={1}
          max={10}
          step={1}
          onChange={(value) => set("count", value)}
        />
      )}
      {hasAlign && (
        <Segmented
          label={`Alignment for ${widget.id}`}
          value={widget.align}
          options={["start", "center"] as const}
          onChange={(value) => set("align", value)}
        />
      )}
      {widget.type === "links" && (
        <div className="ppd-links">
          {widget.links.map((link, index) => (
            <div className="ppd-link-row" key={index}>
              <input
                aria-label={`Link ${index + 1} label`}
                placeholder="Label"
                value={link.label}
                maxLength={LIMITS.linkLabel}
                onChange={(event) =>
                  set(
                    "links",
                    widget.links.map((item, position) =>
                      position === index
                        ? { ...item, label: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <input
                aria-label={`Link ${index + 1} URL`}
                placeholder="https://"
                type="url"
                value={link.url}
                onChange={(event) =>
                  set(
                    "links",
                    widget.links.map((item, position) =>
                      position === index
                        ? { ...item, url: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="ppd-icon-button"
                aria-label={`Remove link ${index + 1}`}
                onClick={() =>
                  set(
                    "links",
                    widget.links.filter((_, position) => position !== index),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
          {widget.links.length < LIMITS.links && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                set("links", [...widget.links, { label: "", url: "https://" }])
              }
            >
              Add link
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const DEVICE_WIDTHS: Record<Device, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 390,
};

/** Renders children at a real device width, scaled down to fit the stage. */
function ScaledFrame({
  width,
  label,
  onScale,
  children,
}: {
  width: number;
  label: string;
  onScale: (scale: number) => void;
  children: ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const update = () => {
      const next = Math.min(1, outer.clientWidth / width);
      setScale(next);
      onScale(next);
      setHeight(inner.offsetHeight * next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [width, onScale]);
  return (
    <div className="ppd-scale-outer" ref={outerRef} style={{ height }}>
      <div
        ref={innerRef}
        className="ppd-frame"
        role="region"
        aria-label={label}
        style={{ width, transform: `translateX(-50%) scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

function readState(value: PublicPageState | null | undefined): PublicPageState {
  const published = value?.published
    ? normalizePublicPageConfig(value.published)
    : null;
  return {
    draft: normalizePublicPageConfig(value?.draft ?? published ?? undefined),
    published,
    draftUpdatedAt: value?.draftUpdatedAt ?? null,
    publishedAt: value?.publishedAt ?? null,
    hasUnpublishedChanges: Boolean(value?.hasUnpublishedChanges),
  };
}

export function PublicPageDesigner({ project }: { project: DesignerProject }) {
  const [state, setState] = useState<PublicPageState | null>(null);
  const [draft, setDraft] = useState<PublicPageConfig>(defaultPublicPageConfig);
  const [brand, setBrand] = useState<Brand>({
    primaryColor: "#2457c5",
    accentColor: null,
    logoUrl: null,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "save" | "publish">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [panel, setPanel] = useState<Panel>("widgets");
  const [device, setDevice] = useState<Device>("desktop");
  const [scale, setScale] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [addType, setAddType] = useState<WidgetType | "">("");
  const listRef = useRef<HTMLOListElement>(null);
  const { data: previewData, sample } = usePreviewData(project);
  usePublicPageFonts(draft);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [page, brandResult] = await Promise.all([
        api.request<PublicPageState>(
          `/internal/projects/${encodeURIComponent(project.id)}/public-page`,
        ),
        adminApi.getBrand<Brand>(project.id).catch(() => null),
      ]);
      const next = readState(page);
      setState(next);
      setDraft(next.draft);
      if (brandResult) setBrand(brandResult);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const baseline = state?.draft ?? null;
  const dirty = baseline
    ? JSON.stringify(draft) !== JSON.stringify(baseline)
    : false;
  const issues = useMemo(() => parsePublicPageConfig(draft).issues, [draft]);
  const live = state?.published ?? null;
  const differsFromLive =
    JSON.stringify(draft) !== JSON.stringify(live ?? defaultPublicPageConfig());

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useCallback(async () => {
    if (issues.length) {
      setError(`Fix ${issues.length} problem(s) before saving.`);
      return null;
    }
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const next = readState(
        await api.request<PublicPageState>(
          `/internal/projects/${encodeURIComponent(project.id)}/public-page/draft`,
          { method: "PUT", body: { config: draft } },
        ),
      );
      setState(next);
      setDraft(next.draft);
      setNotice("Draft saved. Visitors still see the live page.");
      return next;
    } catch (cause) {
      setError(messageFor(cause));
      return null;
    } finally {
      setBusy("");
    }
  }, [draft, issues.length, project.id]);

  async function publish() {
    if (dirty && !(await save())) return;
    setBusy("publish");
    setError("");
    try {
      const next = readState(
        await api.request<PublicPageState>(
          `/internal/projects/${encodeURIComponent(project.id)}/public-page/publish`,
          { method: "POST" },
        ),
      );
      setState(next);
      setDraft(next.draft);
      setNotice("Published. The public page now uses this design.");
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty && !busy) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, busy, save]);

  const setTheme = <K extends keyof PublicPageTheme>(
    key: K,
    value: PublicPageTheme[K],
  ) =>
    setDraft((current) => ({
      ...current,
      theme: { ...current.theme, [key]: value },
    }));
  const setLayout = <K extends keyof PublicPageConfig["layout"]>(
    key: K,
    value: PublicPageConfig["layout"][K],
  ) =>
    setDraft((current) => ({
      ...current,
      layout: { ...current.layout, [key]: value },
    }));
  const updateWidget = (next: PublicPageWidget) =>
    setDraft((current) => ({
      ...current,
      widgets: current.widgets.map((widget) =>
        widget.id === next.id ? next : widget,
      ),
    }));
  const moveWidget = (from: number, to: number) =>
    setDraft((current) => {
      if (to < 0 || to >= current.widgets.length || from === to) return current;
      const widgets = [...current.widgets];
      const [item] = widgets.splice(from, 1);
      widgets.splice(to, 0, item!);
      return { ...current, widgets };
    });
  const removeWidget = (id: string) => {
    setDraft((current) => ({
      ...current,
      widgets: current.widgets.filter((widget) => widget.id !== id),
    }));
    if (selected === id) setSelected(null);
  };
  const usedTypes = new Set(draft.widgets.map((widget) => widget.type));
  const addable = WIDGET_TYPES.filter(
    (type) => REPEATABLE_WIDGETS.includes(type) || !usedTypes.has(type),
  );
  const addWidget = () => {
    if (!addType || draft.widgets.length >= LIMITS.widgets) return;
    let id: string = addType;
    for (let n = 2; draft.widgets.some((widget) => widget.id === id); n += 1)
      id = `${addType}-${n}`;
    setDraft((current) => ({
      ...current,
      widgets: [...current.widgets, createWidget(addType, id)],
    }));
    setSelected(id);
    setExpanded(id);
    setPanel("widgets");
    setAddType("");
  };

  const widgetAt = (x: number, y: number) => {
    const slots = document.querySelectorAll<HTMLElement>(
      ".ppd-frame [data-widget-id]",
    );
    for (const slot of slots) {
      const rect = slot.getBoundingClientRect();
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      )
        return slot.dataset.widgetId ?? null;
    }
    return null;
  };

  const selectFromPreview = (id: string) => {
    setSelected(id);
    setExpanded(id);
    setPanel("widgets");
    window.requestAnimationFrame(() =>
      listRef.current
        ?.querySelector(`[data-widget="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };

  const primary = draft.theme.primaryColor ?? brand.primaryColor;
  const previewStyle = publicPageStyle(draft, brand);
  const liveUrl = `${publicSiteUrl()}/projects/${encodeURIComponent(project.slug)}`;

  if (loading)
    return (
      <div className="loading-state" role="status">
        <span className="spinner" aria-hidden="true" /> Loading page designer
      </div>
    );

  return (
    <section className="ppd" aria-labelledby="ppd-heading">
      <header className="ppd-toolbar">
        <div className="ppd-toolbar-title">
          <h2 id="ppd-heading">Public page designer</h2>
          <p>
            {live ? (
              <>
                <span className="ppd-dot ppd-dot-live" /> Live since{" "}
                {timeLabel(state?.publishedAt ?? null)}
              </>
            ) : (
              <>
                <span className="ppd-dot" /> Using the default design
              </>
            )}
            {dirty ? (
              <span className="ppd-flag">Unsaved changes</span>
            ) : differsFromLive ? (
              <span className="ppd-flag ppd-flag-info">
                Draft not published
              </span>
            ) : null}
          </p>
        </div>
        <div className="ppd-toolbar-actions">
          <a
            className="button button-quiet"
            href={liveUrl}
            target="_blank"
            rel="noreferrer"
          >
            View live page ↗
          </a>
          <button
            type="button"
            className="button button-secondary"
            disabled={!dirty || Boolean(busy)}
            onClick={() => baseline && setDraft(baseline)}
          >
            Discard
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={!dirty || Boolean(busy) || issues.length > 0}
            onClick={() => void save()}
            title="Ctrl+S"
          >
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={
              Boolean(busy) || issues.length > 0 || (!dirty && !differsFromLive)
            }
            onClick={() => void publish()}
          >
            {busy === "publish" ? "Publishing…" : "Publish"}
          </button>
        </div>
      </header>

      <div className="ppd-feedback" aria-live="polite">
        {error && <p className="notice notice-error">{error}</p>}
        {notice && !error && <p className="notice notice-success">{notice}</p>}
        {issues.length > 0 && (
          <ul className="notice notice-error ppd-issues">
            {issues.slice(0, 5).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="ppd-body">
        <aside className="ppd-controls" aria-label="Design controls">
          <div
            className="ppd-tabs"
            role="tablist"
            aria-label="Designer sections"
          >
            {(["widgets", "layout", "theme"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                id={`ppd-tab-${item}`}
                aria-selected={panel === item}
                aria-controls={`ppd-panel-${item}`}
                onClick={() => setPanel(item)}
              >
                {item === "widgets"
                  ? "Widgets"
                  : item === "layout"
                    ? "Layout"
                    : "Style"}
              </button>
            ))}
          </div>

          {panel === "widgets" && (
            <div
              className="ppd-panel"
              role="tabpanel"
              id="ppd-panel-widgets"
              aria-labelledby="ppd-tab-widgets"
            >
              <p className="ppd-hint">
                Drag to reorder, or use the arrows. Click a widget in the
                preview to edit it.
              </p>
              <ol className="ppd-widget-list" ref={listRef}>
                {draft.widgets.map((widget, index) => {
                  const meta = WIDGET_META[widget.type];
                  const open = expanded === widget.id;
                  return (
                    <li
                      key={widget.id}
                      data-widget={widget.id}
                      data-selected={selected === widget.id || undefined}
                      data-disabled={!widget.enabled || undefined}
                      data-dragging={dragIndex === index || undefined}
                      onDragOver={(event) => {
                        if (dragIndex === null) return;
                        event.preventDefault();
                        if (dragIndex !== index) {
                          moveWidget(dragIndex, index);
                          setDragIndex(index);
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragIndex(null);
                      }}
                    >
                      <div className="ppd-widget-row">
                        <span
                          className="ppd-handle"
                          draggable
                          aria-hidden="true"
                          title="Drag to reorder"
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", widget.id);
                            setDragIndex(index);
                          }}
                          onDragEnd={() => setDragIndex(null)}
                        >
                          ⋮⋮
                        </span>
                        <button
                          type="button"
                          className="ppd-widget-name"
                          aria-expanded={open}
                          onClick={() => {
                            setExpanded(open ? null : widget.id);
                            setSelected(widget.id);
                          }}
                        >
                          <strong>{widget.title || meta.label}</strong>
                          <small>
                            {widget.title ? `${meta.label} · ` : ""}
                            {LABELS[widget.region]}
                          </small>
                        </button>
                        <label className="ppd-switch">
                          <input
                            type="checkbox"
                            checked={widget.enabled}
                            onChange={(event) =>
                              updateWidget({
                                ...widget,
                                enabled: event.target.checked,
                              })
                            }
                          />
                          <span className="sr-only">Show {meta.label}</span>
                        </label>
                        <span className="ppd-order">
                          <button
                            type="button"
                            className="ppd-icon-button"
                            aria-label={`Move ${meta.label} up`}
                            disabled={index === 0}
                            onClick={() => moveWidget(index, index - 1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="ppd-icon-button"
                            aria-label={`Move ${meta.label} down`}
                            disabled={index === draft.widgets.length - 1}
                            onClick={() => moveWidget(index, index + 1)}
                          >
                            ↓
                          </button>
                        </span>
                      </div>
                      {open && (
                        <div className="ppd-widget-body">
                          <p className="ppd-hint">{meta.description}</p>
                          <label className="ppd-field">
                            <span>Placement</span>
                            <select
                              value={widget.region}
                              onChange={(event) =>
                                updateWidget({
                                  ...widget,
                                  region: event.target
                                    .value as PublicPageWidget["region"],
                                })
                              }
                            >
                              <option value="top">
                                Top banner (full width)
                              </option>
                              <option value="main">Main column</option>
                              <option value="sidebar">Sidebar</option>
                            </select>
                          </label>
                          {draft.layout.template === "single" &&
                            widget.region === "sidebar" && (
                              <p className="ppd-hint">
                                Single-column layout: sidebar widgets appear in
                                the main column, in list order.
                              </p>
                            )}
                          <WidgetEditor
                            widget={widget}
                            onChange={updateWidget}
                          />
                          <button
                            type="button"
                            className="button button-quiet ppd-remove"
                            onClick={() => removeWidget(widget.id)}
                          >
                            Remove widget
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              <div className="ppd-add">
                <label className="sr-only" htmlFor="ppd-add-type">
                  Widget to add
                </label>
                <select
                  id="ppd-add-type"
                  value={addType}
                  onChange={(event) =>
                    setAddType(event.target.value as WidgetType)
                  }
                  disabled={draft.widgets.length >= LIMITS.widgets}
                >
                  <option value="">Add a widget…</option>
                  {addable.map((type) => (
                    <option key={type} value={type}>
                      {WIDGET_META[type].label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={!addType}
                  onClick={addWidget}
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {panel === "layout" && (
            <div
              className="ppd-panel"
              role="tabpanel"
              id="ppd-panel-layout"
              aria-labelledby="ppd-tab-layout"
            >
              <fieldset className="ppd-field">
                <legend>Page template</legend>
                <div className="ppd-templates">
                  {LAYOUT_TEMPLATES.map((template) => (
                    <label
                      key={template}
                      data-active={
                        draft.layout.template === template || undefined
                      }
                    >
                      <input
                        type="radio"
                        name="template"
                        checked={draft.layout.template === template}
                        onChange={() => setLayout("template", template)}
                      />
                      <span
                        className="ppd-template-art"
                        data-template={template}
                      >
                        <i />
                        <i />
                        <i />
                      </span>
                      {LABELS[template]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Segmented
                label="Content width"
                value={draft.layout.contentWidth}
                options={CONTENT_WIDTHS}
                onChange={(value) => setLayout("contentWidth", value)}
              />
              <Segmented
                label="Spacing"
                value={draft.layout.density}
                options={DENSITIES}
                onChange={(value) => setLayout("density", value)}
              />
              <Segmented
                label="Card style"
                value={draft.layout.cardStyle}
                options={CARD_STYLES}
                onChange={(value) => setLayout("cardStyle", value)}
              />
              <Segmented
                label="Header"
                value={draft.layout.headerStyle}
                options={HEADER_STYLES}
                onChange={(value) => setLayout("headerStyle", value)}
              />
              <label className="ppd-check">
                <input
                  type="checkbox"
                  checked={draft.layout.showPoweredBy}
                  onChange={(event) =>
                    setLayout("showPoweredBy", event.target.checked)
                  }
                />
                Show “Powered by RDPS” in the footer
              </label>
            </div>
          )}

          {panel === "theme" && (
            <div
              className="ppd-panel"
              role="tabpanel"
              id="ppd-panel-theme"
              aria-labelledby="ppd-tab-theme"
            >
              <fieldset className="ppd-field">
                <legend>Start from a preset</legend>
                <div className="ppd-presets">
                  {THEME_PRESETS.map((preset) => {
                    const theme = { ...draft.theme, ...preset.theme };
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          setDraft((current) =>
                            applyThemePreset(current, preset),
                          )
                        }
                        style={{
                          background: theme.backgroundColor,
                          color: theme.textColor,
                          borderColor: theme.borderColor,
                          fontFamily: FONT_OPTIONS[theme.headingFont].stack,
                        }}
                      >
                        <span
                          className="ppd-preset-dot"
                          style={{
                            background:
                              theme.primaryColor ?? brand.primaryColor,
                          }}
                        />
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <h3 className="ppd-group">Colours</h3>
              <ColorField
                label="Primary"
                value={draft.theme.primaryColor}
                inherit={brand.primaryColor}
                onChange={(value) => setTheme("primaryColor", value)}
              />
              <ColorField
                label="Accent"
                value={draft.theme.accentColor}
                inherit={brand.accentColor ?? brand.primaryColor}
                onChange={(value) => setTheme("accentColor", value)}
              />
              <ColorField
                label="Background"
                value={draft.theme.backgroundColor}
                onChange={(value) =>
                  value && setTheme("backgroundColor", value)
                }
              />
              <ColorField
                label="Cards"
                value={draft.theme.surfaceColor}
                onChange={(value) => value && setTheme("surfaceColor", value)}
              />
              <ColorField
                label="Text"
                value={draft.theme.textColor}
                onChange={(value) => value && setTheme("textColor", value)}
              />
              <ColorField
                label="Secondary text"
                value={draft.theme.mutedColor}
                onChange={(value) => value && setTheme("mutedColor", value)}
              />
              <ColorField
                label="Borders"
                value={draft.theme.borderColor}
                onChange={(value) => value && setTheme("borderColor", value)}
              />
              <ul className="ppd-contrast" aria-label="Contrast checks">
                <ContrastBadge
                  label="Text on cards"
                  foreground={draft.theme.textColor}
                  background={draft.theme.surfaceColor}
                />
                <ContrastBadge
                  label="Secondary text on cards"
                  foreground={draft.theme.mutedColor}
                  background={draft.theme.surfaceColor}
                />
                <ContrastBadge
                  label="Text on background"
                  foreground={draft.theme.textColor}
                  background={draft.theme.backgroundColor}
                />
                <ContrastBadge
                  label="Button label"
                  foreground={readableOn(primary)}
                  background={primary}
                />
              </ul>

              <h3 className="ppd-group">Typography</h3>
              <div className="ppd-two">
                <label className="ppd-field">
                  <span>Heading font</span>
                  <select
                    value={draft.theme.headingFont}
                    onChange={(event) =>
                      setTheme(
                        "headingFont",
                        event.target.value as PublicPageTheme["headingFont"],
                      )
                    }
                  >
                    {FONT_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {FONT_OPTIONS[key].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ppd-field">
                  <span>Body font</span>
                  <select
                    value={draft.theme.bodyFont}
                    onChange={(event) =>
                      setTheme(
                        "bodyFont",
                        event.target.value as PublicPageTheme["bodyFont"],
                      )
                    }
                  >
                    {FONT_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {FONT_OPTIONS[key].label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Range
                label="Base text size"
                value={draft.theme.baseFontSize}
                min={13}
                max={20}
                step={1}
                unit="px"
                onChange={(value) => setTheme("baseFontSize", value)}
              />
              <Range
                label="Heading size"
                value={draft.theme.headingScale}
                min={0.75}
                max={1.5}
                step={0.05}
                unit="×"
                onChange={(value) => setTheme("headingScale", value)}
              />
              <Range
                label="Heading weight"
                value={draft.theme.headingWeight}
                min={400}
                max={800}
                step={100}
                onChange={(value) => setTheme("headingWeight", value)}
              />
              <h3 className="ppd-group">Shape</h3>
              <Range
                label="Corner radius"
                value={draft.theme.radius}
                min={0}
                max={28}
                step={1}
                unit="px"
                onChange={(value) => setTheme("radius", value)}
              />
              <button
                type="button"
                className="button button-quiet"
                onClick={() =>
                  setDraft((current) => ({
                    ...defaultPublicPageConfig(),
                    widgets: current.widgets,
                  }))
                }
              >
                Reset style and layout to defaults
              </button>
            </div>
          )}
        </aside>

        <div className="ppd-stage">
          <div className="ppd-stage-bar">
            <div className="ppd-devices" role="group" aria-label="Preview size">
              {(["desktop", "tablet", "mobile"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={device === item}
                  onClick={() => setDevice(item)}
                >
                  {item === "desktop"
                    ? "Desktop"
                    : item === "tablet"
                      ? "Tablet"
                      : "Mobile"}
                </button>
              ))}
            </div>
            <span className="ppd-stage-note">
              {scale < 1 && (
                <span className="ppd-scale">
                  {DEVICE_WIDTHS[device]}px · {Math.round(scale * 100)}%
                </span>
              )}
              {sample
                ? "Sample content — publish release notes to preview real data"
                : "Previewing published release notes"}
            </span>
          </div>
          <div className="ppd-frame-wrap">
            <ScaledFrame
              width={DEVICE_WIDTHS[device]}
              label="Live preview of the public page"
              onScale={setScale}
            >
              <div
                className="pp-root"
                style={previewStyle}
                inert
                {...publicPageAttributes(draft)}
              >
                <PublicSiteHeader
                  config={draft}
                  name={previewData.name}
                  logoUrl={brand.logoUrl ?? previewData.logoUrl}
                  homeHref="#"
                  onHome={(event) => event.preventDefault()}
                  nav={
                    <>
                      <a href="#" onClick={(event) => event.preventDefault()}>
                        {translatePreview("rssFeed")} ↗
                      </a>
                    </>
                  }
                />
                <div className="ppd-subnav">
                  <div className="pp-container">
                    <span aria-current="page">
                      {translatePreview("overview")}
                    </span>
                    <span>{translatePreview("releaseHistory")}</span>
                    <span>{translatePreview("changelog")}</span>
                  </div>
                </div>
                <div className="pp-container">
                  <PublicProjectPage
                    config={draft}
                    data={{
                      ...previewData,
                      logoUrl: brand.logoUrl ?? previewData.logoUrl,
                    }}
                    t={translatePreview}
                    preview
                    selectedWidgetId={selected}
                    hoveredWidgetId={hovered}
                    links={{
                      release: () => "#",
                      history: "#",
                      changelog: "#",
                      rss: "#",
                      navigate: () => undefined,
                      search: () => undefined,
                    }}
                  />
                </div>
                <PublicSiteFooter
                  config={draft}
                  poweredBy={translatePreview("poweredBy")}
                >
                  <span>{translatePreview("publishedInformation")}</span>
                </PublicSiteFooter>
              </div>
              {/* The preview is inert (not focusable or announced); this
                  layer maps pointer positions to widgets for click-to-edit.
                  Keyboard users edit widgets from the list on the left. */}
              <div
                className="ppd-hit"
                aria-hidden="true"
                data-hovering={hovered ? "true" : undefined}
                onMouseMove={(event) =>
                  setHovered(widgetAt(event.clientX, event.clientY))
                }
                onMouseLeave={() => setHovered(null)}
                onClick={(event) => {
                  const id = widgetAt(event.clientX, event.clientY);
                  if (id) selectFromPreview(id);
                }}
              />
            </ScaledFrame>
          </div>
        </div>
      </div>
    </section>
  );
}
