import {
  BRAND_PRESET_KEYS,
  BrandPresetKeySchema,
  DEFAULT_BRAND_PRESET,
  type BrandPresetKey,
} from "@capital-q/contracts";

import { DEFAULT_BRAND_HEX, contrastRatio } from "./brand-colour";

/**
 * Brand presets (K3, ADR 0051): a whole look in one click -- the page,
 * the surfaces, the menu bar, the accent and Q's light together -- with
 * the admin's own accent still able to go on top. "Capital Q's colours
 * are black and gold... anybody should be able to change the branding at
 * any time" (founder, 2026-10-06).
 *
 * Black and gold is design B's brand board: warm ivory paper and near-black
 * in light, near-black and ivory in dark, a black menu bar in both, and
 * gold used two ways. Gold is a fill or a deep bronze for text: classic
 * gold #C9A227 reads on black (8:1) but fails on white (2.4:1), so light
 * mode's accent is bronze #8A6A12 (5.1:1 on white) with #6E5410 for hover.
 * Classic blue is tokens.css itself: choosing it writes nothing.
 *
 * Data, not styling: every value is a plain hex, each preset's pairs are
 * contrast-tested (brand-presets.test.ts), and the style sheet is written
 * only from values that re-check as hex.
 */

/** The tokens a preset may set, by their name after `--cq-`. */
export const PRESET_TOKENS = [
  "canvas",
  "surface",
  "surface-raised",
  "surface-subtle",
  "surface-strong",
  "surface-sunken",
  "text-primary",
  "text-secondary",
  "text-tertiary",
  "text-inverse",
  "border-subtle",
  "border",
  "border-strong",
  "accent",
  "accent-hover",
  "accent-soft",
  "q-light",
  "q-ember",
  "q-bloom",
  "qcard-surface",
  "qcard-text",
  "qcard-muted",
  "qcard-edge",
  "qcard-glow",
  "qcard-arc",
] as const;
export type PresetToken = (typeof PRESET_TOKENS)[number];
export type PresetMode = Readonly<Record<PresetToken, string>>;

/** The menu bar: dark in both themes, so it has one palette. */
export type PresetChrome = {
  readonly surface: string;
  readonly subtle: string;
  readonly border: string;
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  readonly soft: string;
};

/** The Q stage (the Q page and Discover's player), dark in both themes. */
export type PresetStage = {
  readonly canvas: string;
  readonly accent: string;
  readonly qLight: string;
  readonly qEmber: string;
  readonly qBloom: string;
};

export type BrandPreset = {
  readonly key: BrandPresetKey;
  readonly name: string;
  readonly description: string;
  /** Two colours for the picker's swatch: the page and the accent. */
  readonly swatch: readonly [string, string];
  /** Null: tokens.css as it is (classic blue). */
  readonly palette: {
    readonly light: PresetMode;
    readonly dark: PresetMode;
    readonly chrome: PresetChrome;
    readonly stage: PresetStage;
  } | null;
};

const GOLD = "#c9a227";
const BRONZE = "#8a6a12";
const DEEP_BRONZE = "#6e5410";
const CHAMPAGNE = "#e2b858";
const INK = "#16140f";
const IVORY = "#f4efe2";

export const BLACK_GOLD: BrandPreset = {
  key: "black_gold",
  name: "Black and gold",
  description: "Capital Q's brand",
  swatch: [INK, GOLD],
  palette: {
    light: {
      canvas: "#f6f4ef",
      surface: "#fbfaf7",
      "surface-raised": "#ffffff",
      "surface-subtle": "#f1ede4",
      "surface-strong": "#e6e0d3",
      "surface-sunken": "#efebe2",
      "text-primary": INK,
      "text-secondary": "#4f4a40",
      "text-tertiary": "#6b6457",
      "text-inverse": "#ffffff",
      "border-subtle": "#e7e1d5",
      border: "#d9d1c1",
      "border-strong": "#8f8673",
      accent: BRONZE,
      "accent-hover": DEEP_BRONZE,
      "accent-soft": "#f3ead2",
      "q-light": BRONZE,
      "q-ember": "#7a705c",
      "q-bloom": "#c9a22757",
      "qcard-surface": "#fbf8ef",
      "qcard-text": INK,
      "qcard-muted": "#5f5848",
      "qcard-edge": BRONZE,
      "qcard-glow": "#c9a22729",
      "qcard-arc": "#c9a2271a",
    },
    dark: {
      canvas: "#0f0e0b",
      surface: "#17150f",
      "surface-raised": "#1d1a13",
      "surface-subtle": "#232017",
      "surface-strong": "#2e2a1f",
      "surface-sunken": "#0b0a08",
      "text-primary": IVORY,
      "text-secondary": "#c9c0ab",
      "text-tertiary": "#a59c87",
      "text-inverse": INK,
      "border-subtle": "#2a261c",
      border: "#3a3427",
      "border-strong": "#7a715c",
      accent: GOLD,
      "accent-hover": "#d9b45a",
      "accent-soft": "#2e2714",
      "q-light": CHAMPAGNE,
      "q-ember": "#9c917a",
      "q-bloom": "#e2b8587a",
      "qcard-surface": "#1a170f",
      "qcard-text": IVORY,
      "qcard-muted": "#c9c0ab",
      "qcard-edge": GOLD,
      "qcard-glow": "#c9a22738",
      "qcard-arc": "#c9a22733",
    },
    chrome: {
      surface: INK,
      subtle: "#26231b",
      border: "#2f2b22",
      text: IVORY,
      muted: "#bfb6a2",
      accent: CHAMPAGNE,
      soft: "#2e2714",
    },
    stage: {
      canvas: "#0b0a08",
      accent: CHAMPAGNE,
      qLight: CHAMPAGNE,
      qEmber: "#9c917a",
      qBloom: "#e2b8587a",
    },
  },
};

export const CLASSIC_BLUE: BrandPreset = {
  key: "classic_blue",
  name: "Capital Q blue",
  description: "The classic look",
  swatch: ["#f7f7f5", DEFAULT_BRAND_HEX],
  palette: null,
};

export const BRAND_THEME_PRESETS: Readonly<
  Record<BrandPresetKey, BrandPreset>
> = { black_gold: BLACK_GOLD, classic_blue: CLASSIC_BLUE };

/** In picker order: the brand first. */
export const BRAND_THEME_PRESET_LIST: readonly BrandPreset[] =
  BRAND_PRESET_KEYS.map((key) => BRAND_THEME_PRESETS[key]);

/** The preset for a key; an unknown or missing key is the default preset. */
export function brandPreset(key: string | null | undefined): BrandPreset {
  const parsed = BrandPresetKeySchema.safeParse(key);
  return BRAND_THEME_PRESETS[
    parsed.success ? parsed.data : DEFAULT_BRAND_PRESET
  ];
}

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/u;

/**
 * The style sheet for a preset: its light and dark tokens with the same
 * selectors tokens.css uses (so it wins by source order), the dark menu
 * bar scoped to the sidebar and the tab bar in both themes, and the Q
 * stage. Empty for classic blue, and empty if any value is not a plain
 * hex: nothing but a colour ever reaches the style element.
 */
export function presetStyleSheet(preset: BrandPreset): string {
  const palette = preset.palette;
  if (palette === null) return "";
  const { light, dark, chrome, stage } = palette;
  const values = [
    ...Object.values(light),
    ...Object.values(dark),
    ...Object.values(chrome),
    ...Object.values(stage),
  ];
  if (!values.every((value) => HEX.test(value))) return "";
  const block = (mode: PresetMode) =>
    PRESET_TOKENS.map((token) => `--cq-${token}:${mode[token]};`).join("");
  const root = [
    `--cq-nav-accent:${chrome.accent};`,
    `--cq-stage-canvas:${stage.canvas};`,
    `--cq-stage-accent:${stage.accent};`,
    `--cq-stage-q-light:${stage.qLight};`,
    `--cq-stage-q-ember:${stage.qEmber};`,
    `--cq-stage-q-bloom:${stage.qBloom};`,
  ].join("");
  const nav = [
    "color-scheme:dark;",
    `background-color:${chrome.surface};`,
    `color:${chrome.text};`,
    `border-color:${chrome.border};`,
    `--cq-canvas:${chrome.surface};`,
    `--cq-surface:${chrome.surface};`,
    `--cq-surface-raised:${chrome.subtle};`,
    `--cq-surface-subtle:${chrome.subtle};`,
    `--cq-surface-strong:${chrome.border};`,
    `--cq-text-primary:${chrome.text};`,
    `--cq-text-secondary:${chrome.muted};`,
    `--cq-text-tertiary:${chrome.muted};`,
    `--cq-text-inverse:${chrome.surface};`,
    `--cq-border-subtle:${chrome.border};`,
    `--cq-border:${chrome.border};`,
    "--cq-accent:var(--cq-nav-accent);",
    `--cq-accent-soft:${chrome.soft};`,
    "--cq-q-light:var(--cq-nav-accent);",
  ].join("");
  return [
    `:root{${block(light)}${root}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${block(dark)}}}`,
    `:root[data-theme="dark"]{${block(dark)}}`,
    `.cq-shell-sidebar,.cq-bottom-nav{${nav}}`,
  ].join("\n");
}

/** One contrast requirement between two colours. */
export type ContrastPair = {
  readonly name: string;
  readonly fg: string;
  readonly bg: string;
  /** 4.5 for text; 3 for focus, Q's light and UI boundaries. */
  readonly need: number;
};

/**
 * The pairs a preset must pass in a theme (design B's contrast table):
 * text on the page and on cards, the accent as text and as a fill, the
 * menu bar, the focus ring and Q's light. The menu bar and stage pairs
 * apply to presets that set them.
 */
export function contrastPairs(
  mode: PresetMode,
  chrome: PresetChrome | null,
  stage: { readonly canvas: string; readonly qLight: string } | null,
): ContrastPair[] {
  const pair = (name: string, fg: string, bg: string, need = 4.5) => ({
    name,
    fg,
    bg,
    need,
  });
  const pairs: ContrastPair[] = [
    pair("Body text on the page", mode["text-primary"], mode.canvas),
    pair("Body text on cards", mode["text-primary"], mode.surface),
    pair("Secondary text on the page", mode["text-secondary"], mode.canvas),
    pair(
      "Secondary text in a quiet well",
      mode["text-secondary"],
      mode["surface-subtle"],
    ),
    pair("Quiet text on cards", mode["text-tertiary"], mode.surface),
    pair("Accent links on cards", mode.accent, mode["surface-raised"]),
    pair("Accent links on the page", mode.accent, mode.canvas),
    pair("Button label on the accent", mode["text-inverse"], mode.accent),
    pair("Button label on hover", mode["text-inverse"], mode["accent-hover"]),
    pair("Text on a selected row", mode["text-primary"], mode["accent-soft"]),
    pair("Focus ring against the page", mode.accent, mode.canvas, 3),
    pair("Q's light against the page", mode["q-light"], mode.canvas, 3),
    pair("Q card text", mode["qcard-text"], mode["qcard-surface"]),
    pair("Q card quiet text", mode["qcard-muted"], mode["qcard-surface"]),
  ];
  if (chrome !== null) {
    pairs.push(
      pair("Menu text on the black bar", chrome.text, chrome.surface),
      pair("Quiet menu text on the black bar", chrome.muted, chrome.surface),
      pair("Active menu item in gold", chrome.accent, chrome.surface),
      pair("Active menu item on its highlight", chrome.text, chrome.soft),
      pair(
        "Field and control borders against cards",
        mode["border-strong"],
        mode.surface,
        3,
      ),
    );
  }
  if (stage !== null) {
    pairs.push(
      pair("Q's light against the stage", stage.qLight, stage.canvas, 3),
    );
  }
  return pairs;
}

export type ContrastResult = ContrastPair & {
  readonly ratio: number;
  readonly passes: boolean;
};

/** Each pair's WCAG ratio (alpha ignored: pairs are opaque colours). */
export function checkContrast(
  pairs: readonly ContrastPair[],
): ContrastResult[] {
  return pairs.map((item) => {
    const ratio = contrastRatio(item.fg.slice(0, 7), item.bg.slice(0, 7));
    return { ...item, ratio, passes: ratio >= item.need };
  });
}

/** Accent quick picks for a colour on top of a preset (any colour can be typed). */
export const ACCENT_PICKS: readonly {
  readonly name: string;
  readonly hex: string;
}[] = [
  { name: "Capital Q blue", hex: DEFAULT_BRAND_HEX },
  { name: "Teal", hex: "#0f766e" },
  { name: "Forest", hex: "#166534" },
  { name: "Violet", hex: "#6d28d9" },
  { name: "Crimson", hex: "#be123c" },
  { name: "Copper", hex: "#c2410c" },
  { name: "Gold", hex: "#ca8a04" },
  { name: "Graphite", hex: "#27272a" },
];
