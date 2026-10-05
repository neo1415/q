/**
 * Brand colour (admin brand theming): turns one admin-chosen colour into the
 * accent tokens for light and dark, keeping text readable.
 *
 * The accent is used two ways across the product: as a fill under
 * `--cq-text-inverse` (primary buttons, chips) and as text or an icon on the
 * page's surfaces (links, active navigation). Both must reach WCAG AA 4.5:1,
 * so each theme keeps the brand's hue and chroma and moves only lightness
 * until both pairs pass: darker on paper, lighter on the dark canvas. The
 * colour the admin picked is used unchanged wherever it already passes.
 *
 * Pure functions, no DOM: the server renders the result as a style element,
 * and the admin preview uses the same math.
 */

export type Rgb = { readonly r: number; readonly g: number; readonly b: number };
type Oklch = { readonly l: number; readonly c: number; readonly h: number };

export type ThemePalette = {
  readonly accent: string;
  readonly hover: string;
  readonly soft: string;
  /** Contrast of `--cq-text-inverse` on the accent (the primary button). */
  readonly fillContrast: number;
  /** Contrast of the accent as text on the theme's lightest/darkest surface. */
  readonly textContrast: number;
  /** True when lightness was moved to reach AA. */
  readonly adjusted: boolean;
};

export type BrandPalette = {
  readonly source: string;
  readonly light: ThemePalette;
  readonly dark: ThemePalette;
};

/** WCAG AA for body text. */
export const AA = 4.5;

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/iu;

/** "#1A2b3c" or "1a2b3c" or "#abc" → "#1a2b3c"; anything else → null. */
export function normaliseHex(input: string): string | null {
  const match = HEX.exec(input.trim());
  const digits = match?.[1];
  if (digits === undefined) return null;
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((d) => d + d)
          .join("")
      : digits;
  return `#${full.toLowerCase()}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const normal = normaliseHex(hex);
  if (normal === null) return null;
  const value = Number.parseInt(normal.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

// --- sRGB <-> OKLab (Björn Ottosson's reference matrices) -------------------

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) =>
  255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** Linear sRGB for an OKLCH colour; may fall outside [0, 1]. */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (rgb: readonly number[]) =>
  rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH → hex, reducing chroma (never hue or lightness) to fit sRGB. */
function oklchToHex(colour: Oklch): string {
  let { c } = colour;
  let rgb = oklchToLinear({ ...colour, c });
  if (!inGamut(rgb)) {
    let low = 0;
    let high = c;
    for (let i = 0; i < 24; i += 1) {
      c = (low + high) / 2;
      if (inGamut(oklchToLinear({ ...colour, c }))) low = c;
      else high = c;
    }
    c = low;
    rgb = oklchToLinear({ ...colour, c });
  }
  const [r, g, b] = rgb.map((v) => fromLinear(Math.min(1, Math.max(0, v))));
  return rgbToHex({ r: r ?? 0, g: g ?? 0, b: b ?? 0 });
}

// --- WCAG 2 contrast ---------------------------------------------------------

function luminance(rgb: Rgb): number {
  return (
    0.2126 * toLinear(rgb.r) +
    0.7152 * toLinear(rgb.g) +
    0.0722 * toLinear(rgb.b)
  );
}

export function contrastRatio(a: string, b: string): number {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (ra === null || rb === null) return 1;
  const la = luminance(ra);
  const lb = luminance(rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// --- the reference surfaces ---------------------------------------------------

/**
 * The token colours the accent must read against, as sRGB hex. They mirror
 * packages/ui/src/tokens/tokens.css (light: --cq-text-inverse and the
 * brightest surface, --cq-surface-raised; dark: --cq-text-inverse and the
 * lightest surface an accent link sits on, --cq-surface-subtle). Checking
 * the worst case covers every surface in between.
 */
const REFERENCE = {
  light: {
    inverse: oklchToHex({ l: 0.98, c: 0.004, h: 92 }),
    surface: oklchToHex({ l: 1, c: 0, h: 0 }),
  },
  dark: {
    inverse: oklchToHex({ l: 0.17, c: 0.01, h: 258 }),
    surface: oklchToHex({ l: 0.24, c: 0.01, h: 258 }),
  },
} as const;

/** The default Capital Q accent (light), the reset value the admin sees. */
export const DEFAULT_BRAND_HEX = oklchToHex({ l: 0.53, c: 0.18, h: 258 });

function scores(hex: string, mode: "light" | "dark") {
  const ref = REFERENCE[mode];
  return {
    fill: contrastRatio(hex, ref.inverse),
    text: contrastRatio(hex, ref.surface),
  };
}

const passes = (hex: string, mode: "light" | "dark") => {
  const s = scores(hex, mode);
  return s.fill >= AA && s.text >= AA;
};

/**
 * The lightness for this theme closest to the brand's own that passes AA,
 * found by bisection along the one direction that raises contrast.
 */
function readableAccent(base: Oklch, mode: "light" | "dark"): string {
  const exact = oklchToHex(base);
  if (passes(exact, mode)) return exact;
  // Light theme: darker until it passes (L = 0 is black, always passes).
  // Dark theme: lighter until it passes (L = 1 is white, always passes).
  let good = mode === "light" ? 0 : 1;
  let bad = base.l;
  for (let i = 0; i < 28; i += 1) {
    const mid = (good + bad) / 2;
    if (passes(oklchToHex({ ...base, l: mid }), mode)) good = mid;
    else bad = mid;
  }
  return oklchToHex({ ...base, l: good });
}

function themePalette(base: Oklch, mode: "light" | "dark"): ThemePalette {
  const accent = readableAccent(base, mode);
  const tuned = rgbToOklch(hexToRgb(accent) ?? { r: 0, g: 0, b: 0 });
  // Hover moves further in the readable direction, so it can only gain contrast.
  const hover = oklchToHex({
    ...tuned,
    l:
      mode === "light"
        ? Math.max(0, tuned.l - 0.05)
        : Math.min(1, tuned.l + 0.04),
  });
  // Soft: a quiet tint of the hue behind primary text (selected rows, chips).
  const soft = oklchToHex(
    mode === "light"
      ? { l: 0.94, c: Math.min(base.c * 0.25, 0.04), h: base.h }
      : { l: 0.27, c: Math.min(base.c * 0.4, 0.06), h: base.h },
  );
  const s = scores(accent, mode);
  return {
    accent,
    hover,
    soft,
    fillContrast: s.fill,
    textContrast: s.text,
    adjusted: accent !== oklchToHex(base),
  };
}

/** The full palette for a brand colour, or null for a value that is not a colour. */
export function brandPalette(hex: string): BrandPalette | null {
  const rgb = hexToRgb(hex);
  if (rgb === null) return null;
  const base = rgbToOklch(rgb);
  return {
    source: rgbToHex(rgb),
    light: themePalette(base, "light"),
    dark: themePalette(base, "dark"),
  };
}

const HEX_ONLY = /^#[0-9a-f]{6}$/u;

/**
 * The style sheet that applies a palette, overriding the accent tokens with
 * the same selectors tokens.css uses so it wins by source order (it is
 * rendered after the stylesheets). Q's own light (--cq-q-*) and the stage
 * accent are deliberately untouched (ADR 0017 F2: Q keeps its colour).
 *
 * Every value is re-checked as a plain hex before it is written, so nothing
 * but a colour can ever reach the style element.
 */
export function brandStyleSheet(palette: BrandPalette): string {
  const block = (p: ThemePalette) => {
    const values = [p.accent, p.hover, p.soft];
    if (!values.every((v) => HEX_ONLY.test(v))) return "";
    return `--cq-accent:${p.accent};--cq-accent-hover:${p.hover};--cq-accent-soft:${p.soft};`;
  };
  const light = block(palette.light);
  const dark = block(palette.dark);
  if (light === "" || dark === "") return "";
  return [
    `:root{${light}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}`,
    `:root[data-theme="dark"]{${dark}}`,
  ].join("\n");
}

/**
 * The preview's fixed surfaces for each theme, mirroring tokens.css, so the
 * admin sees the colour on paper and on the dark canvas side by side
 * whatever theme they are in.
 */
export const PREVIEW_SURFACES = {
  light: {
    canvas: "oklch(0.985 0.004 92)",
    border: "oklch(0.91 0.006 258)",
    text: "oklch(0.19 0.012 258)",
    muted: "oklch(0.43 0.012 258)",
    inverse: REFERENCE.light.inverse,
  },
  dark: {
    canvas: "oklch(0.16 0.01 258)",
    border: "oklch(0.28 0.01 258)",
    text: "oklch(0.95 0.005 92)",
    muted: "oklch(0.75 0.008 258)",
    inverse: REFERENCE.dark.inverse,
  },
} as const;
