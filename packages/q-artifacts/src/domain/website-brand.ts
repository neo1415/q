/**
 * What a company's own website says about its look (DOCS spec §3 F4).
 *
 * Deterministic reading of markup and stylesheets the company published:
 * the theme colour it declares, the colours its CSS uses most, the font
 * families it names, and where its logo is. Every result is a suggestion
 * for the person to confirm, never a fact about the company and never
 * applied on its own. Nothing here reads anybody's words: it reads CSS
 * and HTML attributes, and nothing here reaches a model.
 */

export type WebsiteBrandReading = {
  /** Most likely brand colours, strongest first, as #rrggbb. */
  readonly colours: readonly string[];
  /** Font families the site names, in order of first use. */
  readonly fontFamilies: readonly string[];
  /** Absolute URLs of likely logo images (PNG/JPEG), best first. */
  readonly logoCandidates: readonly string[];
  /** Stylesheets the page links, absolute, same-site only, in order. */
  readonly stylesheets: readonly string[];
};

function expand(hex: string): string | null {
  const digits = hex.replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(digits)) return `#${digits}`;
  if (/^[0-9a-f]{3}$/.test(digits)) {
    return `#${[...digits].map((d) => d + d).join("")}`;
  }
  return null;
}

function fromRgb(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Saturation and lightness (HSL), 0..1. */
function hsl(hex: string): { s: number; l: number } {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

/** A colour a brand is recognised by: not a grey, not near white or black. */
export function isBrandish(hex: string): boolean {
  const { s, l } = hsl(hex);
  return s >= 0.25 && l >= 0.12 && l <= 0.88;
}

/** Two colours a reader would call the same. */
function near(a: string, b: string): boolean {
  const x = Number.parseInt(a.slice(1), 16);
  const y = Number.parseInt(b.slice(1), 16);
  const dr = ((x >> 16) & 255) - ((y >> 16) & 255);
  const dg = ((x >> 8) & 255) - ((y >> 8) & 255);
  const db = (x & 255) - (y & 255);
  return Math.sqrt(dr * dr + dg * dg + db * db) < 48;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  return match === null ? null : (match[1] ?? match[2] ?? match[3] ?? null);
}

function absolute(base: URL, href: string | null): URL | null {
  if (href === null || href.trim().length === 0) return null;
  try {
    const url = new URL(href.trim(), base);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** The registrable-ish part of a host: example.com for www.example.com. */
export function siteOf(host: string): string {
  const parts = host.toLowerCase().split(".");
  return parts.slice(-2).join(".");
}

const COLOUR_IN_CSS =
  /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
/** Custom properties a site uses to name its brand colours. */
const NAMED_BRAND_PROPERTY =
  /--[\w-]*(?:brand|primary|accent)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,6})\b/gi;
const FONT_FAMILY = /font-family\s*:\s*([^;}{]+)/gi;
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "-apple-system",
  "blinkmacsystemfont",
  "inherit",
  "initial",
  "unset",
  "var",
]);

export function readWebsiteBrand(input: {
  readonly pageUrl: string;
  readonly html: string;
  /** Stylesheet bodies already fetched (same-site), in link order. */
  readonly css?: readonly string[] | undefined;
}): WebsiteBrandReading {
  const base = new URL(input.pageUrl);
  const site = siteOf(base.host);
  const html = input.html.slice(0, 1_000_000);
  const styles = [
    ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(
      (m) => m[1] ?? "",
    ),
    ...[...html.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1] ?? ""),
    ...(input.css ?? []).map((sheet) => sheet.slice(0, 256 * 1024)),
  ].join("\n");

  const tags = [...html.matchAll(/<(meta|link|img)\b[^>]*>/gi)].map(
    (m) => m[0],
  );

  // Declared colours first: what the site says its colour is.
  const declared: string[] = [];
  for (const tag of tags) {
    const name = (
      attribute(tag, "name") ??
      attribute(tag, "property") ??
      ""
    ).toLowerCase();
    if (name === "theme-color" || name === "msapplication-tilecolor") {
      const hex = expand(attribute(tag, "content") ?? "");
      if (hex !== null) declared.push(hex);
    }
  }
  for (const match of styles.matchAll(NAMED_BRAND_PROPERTY)) {
    const hex = expand(match[1] ?? "");
    if (hex !== null) declared.push(hex);
  }

  // Then the colours its stylesheets use most.
  const counts = new Map<string, number>();
  for (const match of styles.matchAll(COLOUR_IN_CSS)) {
    const hex =
      match[1] !== undefined
        ? expand(match[1])
        : fromRgb(Number(match[2]), Number(match[3]), Number(match[4]));
    if (hex === null) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const used = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => hex);

  const colours: string[] = [];
  for (const hex of [...declared, ...used]) {
    if (!isBrandish(hex)) continue;
    if (colours.some((kept) => near(kept, hex))) continue;
    colours.push(hex);
    if (colours.length >= 4) break;
  }

  const fontFamilies: string[] = [];
  for (const match of styles.matchAll(FONT_FAMILY)) {
    for (const raw of (match[1] ?? "").split(",")) {
      const name = raw
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim();
      if (name.length === 0 || name.length > 60) continue;
      if (GENERIC_FAMILIES.has(name.toLowerCase())) continue;
      if (name.startsWith("var(") || name.includes("(")) continue;
      if (!fontFamilies.includes(name)) fontFamilies.push(name);
    }
    if (fontFamilies.length >= 6) break;
  }

  const sameSite = (url: URL | null): url is URL =>
    url !== null && siteOf(url.host) === site;
  const raster = (url: URL) => /\.(png|jpe?g)$/i.test(url.pathname);

  const logos: URL[] = [];
  const add = (url: URL | null) => {
    if (url === null || !raster(url)) return;
    if (logos.some((known) => known.href === url.href)) return;
    logos.push(url);
  };
  // An image the page itself calls its logo is the best evidence.
  for (const tag of tags) {
    if (!/^<img/i.test(tag)) continue;
    const named = [
      attribute(tag, "alt"),
      attribute(tag, "class"),
      attribute(tag, "id"),
      attribute(tag, "src"),
    ]
      .join(" ")
      .toLowerCase();
    if (named.includes("logo")) add(absolute(base, attribute(tag, "src")));
  }
  for (const tag of tags) {
    if (!/^<link/i.test(tag)) continue;
    const rel = (attribute(tag, "rel") ?? "").toLowerCase();
    if (rel.includes("apple-touch-icon")) {
      add(absolute(base, attribute(tag, "href")));
    }
  }
  for (const tag of tags) {
    if (!/^<link/i.test(tag)) continue;
    const rel = (attribute(tag, "rel") ?? "").toLowerCase();
    if (rel.split(/\s+/).includes("icon")) {
      add(absolute(base, attribute(tag, "href")));
    }
  }

  const stylesheets: string[] = [];
  for (const tag of tags) {
    if (!/^<link/i.test(tag)) continue;
    if (!(attribute(tag, "rel") ?? "").toLowerCase().includes("stylesheet")) {
      continue;
    }
    const url = absolute(base, attribute(tag, "href"));
    if (sameSite(url) && !stylesheets.includes(url.href)) {
      stylesheets.push(url.href);
    }
  }

  return {
    colours,
    fontFamilies,
    logoCandidates: logos.map((url) => url.href).slice(0, 4),
    stylesheets: stylesheets.slice(0, 2),
  };
}

/** Font families each pairing is recognised by, lower case. */
const PAIRING_BY_FAMILY: readonly (readonly [string, string])[] = [
  ["ibm plex", "PLEX_SANS_PLEX_SERIF"],
  ["fraunces", "SOURCE_SANS_FRAUNCES"],
  ["source sans", "SOURCE_SANS_FRAUNCES"],
  ["source serif", "INTER_SOURCE_SERIF"],
  ["inter", "INTER_ONLY"],
];

/**
 * A pairing that matches a family the site already uses, when there is
 * one. Most sites use a face Capital Q does not carry; then there is no
 * match and the sector's pairing is suggested instead (as Q's choice).
 */
export function pairingForFamilies(
  families: readonly string[],
): string | undefined {
  for (const family of families) {
    const lower = family.toLowerCase();
    const found = PAIRING_BY_FAMILY.find(([name]) => lower.startsWith(name));
    if (found !== undefined) return found[1];
  }
  return undefined;
}
