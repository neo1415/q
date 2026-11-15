import { isBrandish } from "@capital-q/q-artifacts";

/**
 * A firm's brand colours from its own CSS (GateQ brand from website, live
 * re-check 2026-11-15: Stripe read as the pale tint #b9b9f9 that its
 * stylesheet names first, not its main #635bff).
 *
 * Pure and deterministic: no network, nothing sent to a model. Every
 * colour the CSS uses is weighed by where it appears, and the weight is
 * scaled by how vivid the colour is (HSL chroma), so a brand's main
 * colour beats its own light tints:
 *   - a custom property named brand / primary / accent: strong, unless the
 *     name says it is a variant (light, subtle, tint, a 50-300 step...);
 *   - a background, border or text colour on a button, CTA or link rule;
 *   - anywhere else: once per use.
 * Ties keep the first colour the CSS mentions. Greys, near-white and
 * near-black are never brand colours (isBrandish).
 */

const COLOUR =
  /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
/** A flat rule: its selector and its declarations (inner rules of @media too). */
const RULE = /([^{}]*)\{([^{}]*)\}/g;
const BRAND_PROPERTY = /^--[\w-]*(brand|primary|accent)[\w-]*$/iu;
/** A named variant of the brand colour, not the colour itself. */
const VARIANT_NAME =
  /(light|lighter|lightest|subtle|soft|pale|muted|faint|tint|wash|bg|background|surface|hover|active|disabled|alpha|transparent|(^|-)(50|100|200|300)($|-))/iu;
const ACTION_SELECTOR = /button|btn|cta|\ba\b|link|primary/iu;
const ACTION_PROPERTY =
  /^(background|background-color|border-color|color|fill)$/iu;

const WEIGHT_BRAND_PROPERTY = 6;
const WEIGHT_BRAND_VARIANT = 1;
const WEIGHT_ACTION = 3;
const WEIGHT_USE = 1;
const KEEP = 4;

function expand(digits: string): string | null {
  const lower = digits.toLowerCase();
  if (/^[0-9a-f]{6}$/u.test(lower)) return `#${lower}`;
  if (/^[0-9a-f]{3}$/u.test(lower)) {
    return `#${[...lower].map((d) => d + d).join("")}`;
  }
  return null;
}

function fromRgb(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function coloursIn(value: string): string[] {
  const found: string[] = [];
  for (const match of value.matchAll(COLOUR)) {
    const hex =
      match[1] !== undefined
        ? expand(match[1])
        : fromRgb(Number(match[2]), Number(match[3]), Number(match[4]));
    if (hex !== null) found.push(hex);
  }
  return found;
}

/** HSL chroma, 0..1: 0 for any grey, highest for a full, mid-light hue. */
export function chromaOf(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
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

function weightOf(selector: string, property: string): number {
  if (property.startsWith("--")) {
    if (!BRAND_PROPERTY.test(property)) return WEIGHT_USE;
    return VARIANT_NAME.test(property.slice(2))
      ? WEIGHT_BRAND_VARIANT
      : WEIGHT_BRAND_PROPERTY;
  }
  return ACTION_PROPERTY.test(property) && ACTION_SELECTOR.test(selector)
    ? WEIGHT_ACTION
    : WEIGHT_USE;
}

/**
 * The brand-like colours a site's CSS uses, strongest first, at most four
 * and none two a reader would call the same. `css` is every stylesheet
 * body and <style> block; `inline` the page's style attributes.
 */
export function rankCssBrandColours(input: {
  readonly css: readonly string[];
  readonly inline?: readonly string[] | undefined;
}): string[] {
  const score = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;
  const add = (hex: string, weight: number) => {
    if (!firstSeen.has(hex)) firstSeen.set(hex, order++);
    score.set(hex, (score.get(hex) ?? 0) + weight);
  };
  const declarations = (selector: string, body: string) => {
    for (const declaration of body.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const weight = weightOf(selector, property);
      for (const hex of coloursIn(declaration.slice(colon + 1))) {
        add(hex, weight);
      }
    }
  };
  for (const sheet of input.css) {
    for (const rule of sheet.matchAll(RULE)) {
      declarations(rule[1] ?? "", rule[2] ?? "");
    }
  }
  for (const style of input.inline ?? []) declarations("", style);

  const ranked = [...score.entries()]
    .filter(([hex]) => isBrandish(hex))
    .map(([hex, weight]) => ({
      hex,
      value: weight * chromaOf(hex),
      first: firstSeen.get(hex) ?? 0,
    }))
    .sort((a, b) => b.value - a.value || a.first - b.first);
  const kept: string[] = [];
  for (const { hex } of ranked) {
    if (kept.some((k) => near(k, hex))) continue;
    kept.push(hex);
    if (kept.length >= KEEP) break;
  }
  return kept;
}
