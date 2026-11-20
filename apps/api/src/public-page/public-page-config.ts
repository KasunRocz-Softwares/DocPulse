/**
 * Public release page configuration.
 *
 * This module is dependency-free on purpose: the exact same file is mirrored
 * into the API (apps/api/src/public-page/public-page-config.ts) so the server
 * validates with the same rules the editors and renderer use. A test in the
 * API asserts the two copies stay byte-identical — edit this file, then copy it.
 */

export const PUBLIC_PAGE_CONFIG_VERSION = 1 as const;

export const FONT_OPTIONS = {
  system: {
    label: "System UI",
    stack:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  "dm-sans": {
    label: "DM Sans",
    stack: '"DM Sans", system-ui, sans-serif',
    google: "DM+Sans:wght@400;500;600;700",
  },
  manrope: {
    label: "Manrope",
    stack: "Manrope, system-ui, sans-serif",
    google: "Manrope:wght@400;500;600;700;800",
  },
  inter: {
    label: "Inter",
    stack: "Inter, system-ui, sans-serif",
    google: "Inter:wght@400;500;600;700;800",
  },
  "plus-jakarta": {
    label: "Plus Jakarta Sans",
    stack: '"Plus Jakarta Sans", system-ui, sans-serif',
    google: "Plus+Jakarta+Sans:wght@400;500;600;700;800",
  },
  "ibm-plex-sans": {
    label: "IBM Plex Sans",
    stack: '"IBM Plex Sans", system-ui, sans-serif',
    google: "IBM+Plex+Sans:wght@400;500;600;700",
  },
  "space-grotesk": {
    label: "Space Grotesk",
    stack: '"Space Grotesk", system-ui, sans-serif',
    google: "Space+Grotesk:wght@400;500;600;700",
  },
  "source-serif": {
    label: "Source Serif",
    stack: '"Source Serif 4", Georgia, serif',
    google: "Source+Serif+4:wght@400;600;700",
  },
  merriweather: {
    label: "Merriweather",
    stack: "Merriweather, Georgia, serif",
    google: "Merriweather:wght@400;700",
  },
  playfair: {
    label: "Playfair Display",
    stack: '"Playfair Display", Georgia, serif',
    google: "Playfair+Display:wght@500;600;700;800",
  },
  georgia: {
    label: "Georgia (system serif)",
    stack: 'Georgia, "Times New Roman", serif',
  },
  "jetbrains-mono": {
    label: "JetBrains Mono",
    stack: '"JetBrains Mono", ui-monospace, monospace',
    google: "JetBrains+Mono:wght@400;500;700",
  },
} as const satisfies Record<
  string,
  { label: string; stack: string; google?: string }
>;

export type FontKey = keyof typeof FONT_OPTIONS;
export const FONT_KEYS = Object.keys(FONT_OPTIONS) as FontKey[];

export const LAYOUT_TEMPLATES = [
  "single",
  "sidebar-right",
  "sidebar-left",
] as const;
export const CONTENT_WIDTHS = ["narrow", "standard", "wide", "full"] as const;
export const DENSITIES = ["compact", "comfortable", "spacious"] as const;
export const CARD_STYLES = ["flat", "bordered", "elevated"] as const;
export const HEADER_STYLES = ["standard", "centered", "minimal"] as const;
export const WIDGET_REGIONS = ["top", "main", "sidebar"] as const;
export const WIDGET_ALIGNMENTS = ["start", "center"] as const;

export const WIDGET_TYPES = [
  "hero",
  "latestRelease",
  "recentReleases",
  "stats",
  "about",
  "navigation",
  "links",
  "customText",
  "subscribe",
  "search",
] as const;

export type LayoutTemplate = (typeof LAYOUT_TEMPLATES)[number];
export type ContentWidth = (typeof CONTENT_WIDTHS)[number];
export type Density = (typeof DENSITIES)[number];
export type CardStyle = (typeof CARD_STYLES)[number];
export type HeaderStyle = (typeof HEADER_STYLES)[number];
export type WidgetRegion = (typeof WIDGET_REGIONS)[number];
export type WidgetAlignment = (typeof WIDGET_ALIGNMENTS)[number];
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Widget types that may appear more than once on a page. */
export const REPEATABLE_WIDGETS: readonly WidgetType[] = [
  "customText",
  "links",
];

export const WIDGET_META: Record<
  WidgetType,
  { label: string; description: string; defaultRegion: WidgetRegion }
> = {
  hero: {
    label: "Hero banner",
    description: "Large heading and introduction at the top of the page.",
    defaultRegion: "top",
  },
  latestRelease: {
    label: "Latest release",
    description: "Highlights the most recently published release.",
    defaultRegion: "main",
  },
  recentReleases: {
    label: "Recent releases",
    description: "A short list of the newest published releases.",
    defaultRegion: "main",
  },
  stats: {
    label: "Release stats",
    description: "Published release count and last update date.",
    defaultRegion: "sidebar",
  },
  about: {
    label: "About",
    description: "A short description of the product.",
    defaultRegion: "main",
  },
  navigation: {
    label: "Page links",
    description: "Links to release history, changelog, and RSS.",
    defaultRegion: "sidebar",
  },
  links: {
    label: "External links",
    description: "Up to eight links to docs, support, or status pages.",
    defaultRegion: "sidebar",
  },
  customText: {
    label: "Text block",
    description: "A heading and plain-text paragraph you write.",
    defaultRegion: "main",
  },
  subscribe: {
    label: "Email subscription",
    description: "Lets visitors subscribe to release emails.",
    defaultRegion: "sidebar",
  },
  search: {
    label: "Search",
    description: "Search box for published release notes.",
    defaultRegion: "sidebar",
  },
};

export type PublicPageLink = { label: string; url: string };

export type PublicPageWidget = {
  id: string;
  type: WidgetType;
  enabled: boolean;
  region: WidgetRegion;
  /** Heading override. Empty string uses the built-in heading. */
  title: string;
  /** Plain text body for hero, about, and text blocks. */
  body: string;
  /** Number of items for list widgets. */
  count: number;
  align: WidgetAlignment;
  links: PublicPageLink[];
};

export type PublicPageTheme = {
  /** Null falls back to the project brand colour. */
  primaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  headingFont: FontKey;
  bodyFont: FontKey;
  /** Root font size in px. */
  baseFontSize: number;
  /** Multiplier applied to heading sizes. */
  headingScale: number;
  headingWeight: number;
  /** Corner radius in px for cards and controls. */
  radius: number;
};

export type PublicPageLayout = {
  template: LayoutTemplate;
  contentWidth: ContentWidth;
  density: Density;
  cardStyle: CardStyle;
  headerStyle: HeaderStyle;
  showPoweredBy: boolean;
};

export type PublicPageConfig = {
  version: typeof PUBLIC_PAGE_CONFIG_VERSION;
  theme: PublicPageTheme;
  layout: PublicPageLayout;
  widgets: PublicPageWidget[];
};

export const LIMITS = {
  widgets: 16,
  links: 8,
  title: 120,
  body: 2000,
  linkLabel: 80,
  url: 2048,
  serializedBytes: 48_000,
} as const;

const HEX = /^#[0-9a-f]{6}$/i;
const WIDGET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

export function defaultTheme(): PublicPageTheme {
  return {
    primaryColor: null,
    accentColor: null,
    backgroundColor: "#f7f8f5",
    surfaceColor: "#ffffff",
    textColor: "#1f2a23",
    mutedColor: "#5b6860",
    borderColor: "#e1e6df",
    headingFont: "manrope",
    bodyFont: "dm-sans",
    baseFontSize: 16,
    headingScale: 1,
    headingWeight: 700,
    radius: 12,
  };
}

export function defaultLayout(): PublicPageLayout {
  return {
    template: "sidebar-right",
    contentWidth: "standard",
    density: "comfortable",
    cardStyle: "bordered",
    headerStyle: "standard",
    showPoweredBy: true,
  };
}

export function createWidget(
  type: WidgetType,
  id: string = type,
  overrides: Partial<Omit<PublicPageWidget, "id" | "type">> = {},
): PublicPageWidget {
  return {
    id,
    type,
    enabled: true,
    region: WIDGET_META[type].defaultRegion,
    title: "",
    body: "",
    count: type === "recentReleases" ? 3 : 0,
    align: "start",
    links: [],
    ...overrides,
  };
}

export function defaultWidgets(): PublicPageWidget[] {
  return [
    createWidget("hero"),
    createWidget("latestRelease"),
    createWidget("recentReleases"),
    createWidget("about", "about", { enabled: false }),
    createWidget("stats"),
    createWidget("search"),
    createWidget("navigation"),
    createWidget("subscribe"),
  ];
}

export function defaultPublicPageConfig(): PublicPageConfig {
  return {
    version: PUBLIC_PAGE_CONFIG_VERSION,
    theme: defaultTheme(),
    layout: defaultLayout(),
    widgets: defaultWidgets(),
  };
}

export type ThemePreset = {
  id: string;
  label: string;
  theme: Partial<PublicPageTheme>;
  layout?: Partial<PublicPageLayout>;
};

export const THEME_PRESETS: ThemePreset[] = [
  { id: "default", label: "Studio", theme: defaultTheme() },
  {
    id: "midnight",
    label: "Midnight",
    theme: {
      primaryColor: "#8ab4ff",
      accentColor: "#c7f284",
      backgroundColor: "#0f1420",
      surfaceColor: "#171e2e",
      textColor: "#e8edf7",
      mutedColor: "#9aa6bd",
      borderColor: "#283247",
      headingFont: "space-grotesk",
      bodyFont: "inter",
      headingWeight: 700,
      radius: 14,
    },
  },
  {
    id: "editorial",
    label: "Editorial",
    theme: {
      primaryColor: "#9b2c2c",
      accentColor: "#d69e2e",
      backgroundColor: "#fbf8f3",
      surfaceColor: "#ffffff",
      textColor: "#2a2420",
      mutedColor: "#6f625a",
      borderColor: "#e9e0d6",
      headingFont: "playfair",
      bodyFont: "source-serif",
      headingWeight: 700,
      baseFontSize: 17,
      radius: 4,
    },
    layout: { cardStyle: "flat", contentWidth: "narrow" },
  },
  {
    id: "ocean",
    label: "Ocean",
    theme: {
      primaryColor: "#0f6fb8",
      accentColor: "#14b8a6",
      backgroundColor: "#f3f8fc",
      surfaceColor: "#ffffff",
      textColor: "#10243a",
      mutedColor: "#506579",
      borderColor: "#d8e5f0",
      headingFont: "plus-jakarta",
      bodyFont: "inter",
      headingWeight: 800,
      radius: 16,
    },
    layout: { cardStyle: "elevated" },
  },
  {
    id: "terminal",
    label: "Terminal",
    theme: {
      primaryColor: "#16a34a",
      accentColor: "#facc15",
      backgroundColor: "#fafafa",
      surfaceColor: "#ffffff",
      textColor: "#111111",
      mutedColor: "#555555",
      borderColor: "#dddddd",
      headingFont: "jetbrains-mono",
      bodyFont: "ibm-plex-sans",
      headingWeight: 700,
      radius: 0,
    },
    layout: { cardStyle: "bordered" },
  },
];

export function applyThemePreset(
  config: PublicPageConfig,
  preset: ThemePreset,
): PublicPageConfig {
  return {
    ...config,
    theme: { ...config.theme, ...preset.theme },
    layout: { ...config.layout, ...(preset.layout ?? {}) },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strip control characters (keeping newlines/tabs) and trim to a limit. */
export function cleanText(value: unknown, max: number, multiline = false) {
  if (typeof value !== "string") return "";
  const stripped = value
    .replace(multiline ? /[^\P{Cc}\n\t]/gu : /\p{Cc}/gu, "")
    .replace(/\r\n?/g, "\n");
  return (multiline ? stripped : stripped.replace(/\s+/g, " "))
    .trim()
    .slice(0, max);
}

export function isSafeHttpsUrl(value: string): boolean {
  if (value.length > LIMITS.url) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

type Issues = string[];

function pickEnum<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
  path: string,
  issues: Issues,
): T {
  if (value === undefined) return fallback;
  if (
    typeof value === "string" &&
    (options as readonly string[]).includes(value)
  )
    return value as T;
  issues.push(`${path} must be one of: ${options.join(", ")}`);
  return fallback;
}

function pickColor(
  value: unknown,
  fallback: string,
  path: string,
  issues: Issues,
): string {
  if (value === undefined) return fallback;
  if (typeof value === "string" && HEX.test(value)) return value.toLowerCase();
  issues.push(`${path} must be a #RRGGBB colour`);
  return fallback;
}

function pickOptionalColor(
  value: unknown,
  fallback: string | null,
  path: string,
  issues: Issues,
): string | null {
  if (value === undefined) return fallback;
  if (value === null || value === "") return null;
  return pickColor(value, fallback ?? "#000000", path, issues);
}

function pickNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  path: string,
  issues: Issues,
  step = 0,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${path} must be a number`);
    return fallback;
  }
  if (value < min || value > max) {
    issues.push(`${path} must be between ${min} and ${max}`);
    return Math.min(max, Math.max(min, value));
  }
  return step ? Math.round(value / step) * step : value;
}

function pickBoolean(
  value: unknown,
  fallback: boolean,
  path: string,
  issues: Issues,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  issues.push(`${path} must be true or false`);
  return fallback;
}

function readTheme(input: unknown, issues: Issues): PublicPageTheme {
  const base = defaultTheme();
  if (input === undefined) return base;
  if (!isRecord(input)) {
    issues.push("theme must be an object");
    return base;
  }
  return {
    primaryColor: pickOptionalColor(
      input.primaryColor,
      base.primaryColor,
      "theme.primaryColor",
      issues,
    ),
    accentColor: pickOptionalColor(
      input.accentColor,
      base.accentColor,
      "theme.accentColor",
      issues,
    ),
    backgroundColor: pickColor(
      input.backgroundColor,
      base.backgroundColor,
      "theme.backgroundColor",
      issues,
    ),
    surfaceColor: pickColor(
      input.surfaceColor,
      base.surfaceColor,
      "theme.surfaceColor",
      issues,
    ),
    textColor: pickColor(
      input.textColor,
      base.textColor,
      "theme.textColor",
      issues,
    ),
    mutedColor: pickColor(
      input.mutedColor,
      base.mutedColor,
      "theme.mutedColor",
      issues,
    ),
    borderColor: pickColor(
      input.borderColor,
      base.borderColor,
      "theme.borderColor",
      issues,
    ),
    headingFont: pickEnum(
      input.headingFont,
      FONT_KEYS,
      base.headingFont,
      "theme.headingFont",
      issues,
    ),
    bodyFont: pickEnum(
      input.bodyFont,
      FONT_KEYS,
      base.bodyFont,
      "theme.bodyFont",
      issues,
    ),
    baseFontSize: pickNumber(
      input.baseFontSize,
      base.baseFontSize,
      13,
      20,
      "theme.baseFontSize",
      issues,
      1,
    ),
    headingScale: pickNumber(
      input.headingScale,
      base.headingScale,
      0.75,
      1.5,
      "theme.headingScale",
      issues,
      0.05,
    ),
    headingWeight: pickNumber(
      input.headingWeight,
      base.headingWeight,
      400,
      800,
      "theme.headingWeight",
      issues,
      100,
    ),
    radius: pickNumber(
      input.radius,
      base.radius,
      0,
      28,
      "theme.radius",
      issues,
      1,
    ),
  };
}

function readLayout(input: unknown, issues: Issues): PublicPageLayout {
  const base = defaultLayout();
  if (input === undefined) return base;
  if (!isRecord(input)) {
    issues.push("layout must be an object");
    return base;
  }
  return {
    template: pickEnum(
      input.template,
      LAYOUT_TEMPLATES,
      base.template,
      "layout.template",
      issues,
    ),
    contentWidth: pickEnum(
      input.contentWidth,
      CONTENT_WIDTHS,
      base.contentWidth,
      "layout.contentWidth",
      issues,
    ),
    density: pickEnum(
      input.density,
      DENSITIES,
      base.density,
      "layout.density",
      issues,
    ),
    cardStyle: pickEnum(
      input.cardStyle,
      CARD_STYLES,
      base.cardStyle,
      "layout.cardStyle",
      issues,
    ),
    headerStyle: pickEnum(
      input.headerStyle,
      HEADER_STYLES,
      base.headerStyle,
      "layout.headerStyle",
      issues,
    ),
    showPoweredBy: pickBoolean(
      input.showPoweredBy,
      base.showPoweredBy,
      "layout.showPoweredBy",
      issues,
    ),
  };
}

function readLinks(
  input: unknown,
  path: string,
  issues: Issues,
): PublicPageLink[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    issues.push(`${path} must be a list`);
    return [];
  }
  if (input.length > LIMITS.links)
    issues.push(`${path} can contain at most ${LIMITS.links} links`);
  const links: PublicPageLink[] = [];
  input.slice(0, LIMITS.links).forEach((item, index) => {
    if (!isRecord(item)) {
      issues.push(`${path}[${index}] must be an object`);
      return;
    }
    const label = cleanText(item.label, LIMITS.linkLabel);
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!label) {
      issues.push(`${path}[${index}].label is required`);
      return;
    }
    if (!isSafeHttpsUrl(url)) {
      issues.push(`${path}[${index}].url must be an https:// URL`);
      return;
    }
    links.push({ label, url });
  });
  return links;
}

function readWidgets(input: unknown, issues: Issues): PublicPageWidget[] {
  if (input === undefined) return defaultWidgets();
  if (!Array.isArray(input)) {
    issues.push("widgets must be a list");
    return defaultWidgets();
  }
  if (input.length > LIMITS.widgets)
    issues.push(`A page can contain at most ${LIMITS.widgets} widgets`);
  const seenIds = new Set<string>();
  const seenTypes = new Set<WidgetType>();
  const widgets: PublicPageWidget[] = [];
  input.slice(0, LIMITS.widgets).forEach((item, index) => {
    const path = `widgets[${index}]`;
    if (!isRecord(item)) {
      issues.push(`${path} must be an object`);
      return;
    }
    const type = item.type;
    if (
      typeof type !== "string" ||
      !(WIDGET_TYPES as readonly string[]).includes(type)
    ) {
      issues.push(`${path}.type is not a supported widget`);
      return;
    }
    const widgetType = type as WidgetType;
    if (seenTypes.has(widgetType) && !REPEATABLE_WIDGETS.includes(widgetType)) {
      issues.push(
        `${path}: only one ${WIDGET_META[widgetType].label} widget is allowed`,
      );
      return;
    }
    const id = typeof item.id === "string" ? item.id : "";
    if (!WIDGET_ID.test(id) || seenIds.has(id)) {
      issues.push(
        `${path}.id must be unique and use letters, digits, dashes, or underscores`,
      );
      return;
    }
    seenIds.add(id);
    seenTypes.add(widgetType);
    const base = createWidget(widgetType, id);
    widgets.push({
      id,
      type: widgetType,
      enabled: pickBoolean(item.enabled, true, `${path}.enabled`, issues),
      region: pickEnum(
        item.region,
        WIDGET_REGIONS,
        base.region,
        `${path}.region`,
        issues,
      ),
      title: cleanText(item.title, LIMITS.title),
      body: cleanText(item.body, LIMITS.body, true),
      count:
        widgetType === "recentReleases"
          ? pickNumber(item.count, 3, 1, 10, `${path}.count`, issues, 1)
          : 0,
      align: pickEnum(
        item.align,
        WIDGET_ALIGNMENTS,
        base.align,
        `${path}.align`,
        issues,
      ),
      links:
        widgetType === "links"
          ? readLinks(item.links, `${path}.links`, issues)
          : [],
    });
  });
  return widgets;
}

export type PublicPageConfigResult = {
  config: PublicPageConfig;
  issues: string[];
};

/**
 * Parse untrusted input into a complete config. Invalid values fall back to
 * defaults and are reported in `issues`, so callers can either reject (API
 * writes) or render leniently (stored data from an older version).
 */
export function parsePublicPageConfig(input: unknown): PublicPageConfigResult {
  const issues: Issues = [];
  if (input === undefined || input === null)
    return { config: defaultPublicPageConfig(), issues };
  if (!isRecord(input)) {
    return {
      config: defaultPublicPageConfig(),
      issues: ["Page configuration must be an object"],
    };
  }
  if (
    input.version !== undefined &&
    input.version !== PUBLIC_PAGE_CONFIG_VERSION
  )
    issues.push(`Unsupported configuration version ${String(input.version)}`);
  try {
    if (JSON.stringify(input).length > LIMITS.serializedBytes)
      issues.push("Page configuration is too large");
  } catch {
    issues.push("Page configuration must be plain JSON");
  }
  return {
    config: {
      version: PUBLIC_PAGE_CONFIG_VERSION,
      theme: readTheme(input.theme, issues),
      layout: readLayout(input.layout, issues),
      widgets: readWidgets(input.widgets, issues),
    },
    issues,
  };
}

export function normalizePublicPageConfig(input: unknown): PublicPageConfig {
  return parsePublicPageConfig(input).config;
}

function channel(value: number) {
  const scaled = value / 255;
  return scaled <= 0.03928
    ? scaled / 12.92
    : Math.pow((scaled + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const value = HEX.test(hex) ? hex.slice(1) : "000000";
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two #RRGGBB colours (1–21). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/** Pick black or white text for a filled background. */
export function readableOn(background: string): string {
  return contrastRatio("#ffffff", background) >= 4.5 ||
    contrastRatio("#ffffff", background) >= contrastRatio("#111111", background)
    ? "#ffffff"
    : "#111111";
}

function hexChannels(hex: string): [number, number, number] {
  const value = HEX.test(hex) ? hex.slice(1) : "000000";
  return [0, 2, 4].map((start) =>
    Number.parseInt(value.slice(start, start + 2), 16),
  ) as [number, number, number];
}

/** sRGB mix, matching CSS `color-mix(in srgb, to amount, from)`. */
export function mixColors(from: string, to: string, amount: number): string {
  const a = hexChannels(from);
  const b = hexChannels(to);
  return `#${a
    .map((channel, index) =>
      Math.round(channel + (b[index]! - channel) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * Return `color`, nudged toward `towards` just enough to reach `min` contrast
 * on every background. Keeps brand hues where they are already readable.
 */
export function accessibleColor(
  color: string,
  backgrounds: string[],
  towards: string,
  min = 4.5,
): string {
  const passes = (candidate: string) =>
    backgrounds.every(
      (background) => contrastRatio(candidate, background) >= min,
    );
  if (passes(color)) return color;
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixColors(color, towards, step / 20);
    if (passes(candidate)) return candidate;
  }
  return towards;
}
