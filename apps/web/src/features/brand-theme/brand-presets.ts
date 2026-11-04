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
 * Black and gold is design B's brand board, neutralised 2026-11-04: clean
 * white and near-black ink in light, charcoal and soft white in dark, a black menu bar in dark, and
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

/** The menu bar in the dark theme (light follows the page, owner 2026-10-17). */
export type PresetChrome = {
  readonly surface: string;
  readonly subtle: string;
  readonly border: string;
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  readonly soft: string;
};

/**
 * The night: the Q stage in the dark theme, and the cinema (Discover's
 * player, Explore's tiles, every video frame) in both. The light theme's
 * stage is paper, derived from the light mode itself (presetPaperStage).
 */
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
const INK = "#0d0d0d";
/** Dark-theme text: neutral, not ivory (boss 2026-11-04). */
const PAPER_TEXT = "#ececec";

export const BLACK_GOLD: BrandPreset = {
  key: "black_gold",
  name: "Black and gold",
  description: "Capital Q's brand",
  swatch: [INK, GOLD],
  palette: {
    light: {
      // Clean neutral white (client feedback UX-03, boss 2026-11-04):
      // no cream or ivory in the surfaces; gold stays the accent and Q's
      // light only. Text and borders keep AA on every light surface,
      // including the #f4f4f4 sunken well (brand-presets.test.ts).
      canvas: "#ffffff",
      surface: "#ffffff",
      "surface-raised": "#ffffff",
      "surface-subtle": "#f9f9f9",
      "surface-strong": "#ececec",
      "surface-sunken": "#f4f4f4",
      "text-primary": INK,
      "text-secondary": "#4d4d4d",
      "text-tertiary": "#666666",
      "text-inverse": "#ffffff",
      "border-subtle": "#ececec",
      border: "#e0e0e0",
      "border-strong": "#8f8f8f",
      accent: BRONZE,
      "accent-hover": DEEP_BRONZE,
      "accent-soft": "#f3ead2",
      "q-light": BRONZE,
      "q-ember": "#737373",
      "q-bloom": "#c9a22757",
      "qcard-surface": "#f9f9f9",
      "qcard-text": INK,
      "qcard-muted": "#5d5d5d",
      "qcard-edge": BRONZE,
      "qcard-glow": "#c9a22729",
      "qcard-arc": "#c9a2271a",
    },
    dark: {
      // Neutral charcoal (boss 2026-11-04): no navy and no brown in the
      // blacks. Page #212121, sunken/sidebar #171717, raised #2f2f2f.
      canvas: "#212121",
      surface: "#262626",
      "surface-raised": "#2f2f2f",
      "surface-subtle": "#2a2a2a",
      "surface-strong": "#383838",
      "surface-sunken": "#171717",
      "text-primary": PAPER_TEXT,
      "text-secondary": "#c4c4c4",
      "text-tertiary": "#a3a3a3",
      "text-inverse": INK,
      "border-subtle": "#333333",
      border: "#424242",
      "border-strong": "#757575",
      accent: GOLD,
      "accent-hover": "#d9b45a",
      "accent-soft": "#2e2714",
      "q-light": CHAMPAGNE,
      "q-ember": "#9e9e9e",
      "q-bloom": "#e2b8587a",
      "qcard-surface": "#262626",
      "qcard-text": PAPER_TEXT,
      "qcard-muted": "#c4c4c4",
      "qcard-edge": GOLD,
      "qcard-glow": "#c9a22738",
      "qcard-arc": "#c9a22733",
    },
    chrome: {
      surface: "#171717",
      subtle: "#262626",
      border: "#2a2a2a",
      text: PAPER_TEXT,
      muted: "#b4b4b4",
      accent: CHAMPAGNE,
      soft: "#2e2714",
    },
    stage: {
      canvas: "#212121",
      accent: CHAMPAGNE,
      qLight: CHAMPAGNE,
      qEmber: "#9e9e9e",
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
 * bar scoped to the sidebar and the tab bar in the dark theme, and the Q
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
  const paper = presetPaperStage(light);
  if (!Object.values(paper).every((value) => HEX.test(value))) return "";
  const root = [
    `--cq-nav-accent:${chrome.accent};`,
    `--cq-night-canvas:${stage.canvas};`,
    `--cq-night-accent:${stage.accent};`,
    `--cq-night-q-light:${stage.qLight};`,
    `--cq-night-q-ember:${stage.qEmber};`,
    `--cq-night-q-bloom:${stage.qBloom};`,
    // Light theme: the stage is the preset's own paper. The dark theme
    // re-points --cq-stage-* at the night (tokens.css), which outranks
    // this bare :root.
    ...Object.entries(paper).map(
      ([token, value]) => `--cq-stage-${token}:${value};`,
    ),
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
    // Dark theme only: in light mode a black menu bar beside the light page
    // read as a bug, so the bar follows the page (owner 2026-10-17).
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) :is(.cq-shell-sidebar,.cq-bottom-nav){${nav}}}`,
    `:root[data-theme="dark"] :is(.cq-shell-sidebar,.cq-bottom-nav){${nav}}`,
  ].join("\n");
}

/** Ink alpha steps on the paper stage (hex alpha suffixes). */
const PAPER_INK = {
  surface: "0b", // ~4.5%
  "surface-strong": "16", // ~8.5%
  border: "29", // ~16%
  star: "33", // ~20%
  "star-faint": "1a", // ~10%
} as const;

/**
 * The Q stage on paper (owner 2026-10-20: the Q page follows the theme):
 * the light page's own canvas and text, wells and stars in its ink at a
 * whisper, and Q's light as the light theme draws it (ink on paper). Keyed
 * by the token's name after `--cq-stage-`.
 */
export function presetPaperStage(
  light: PresetMode,
): Readonly<Record<string, string>> {
  const ink = light["text-primary"].slice(0, 7);
  return {
    canvas: light.canvas,
    surface: `${ink}${PAPER_INK.surface}`,
    "surface-strong": `${ink}${PAPER_INK["surface-strong"]}`,
    border: `${ink}${PAPER_INK.border}`,
    text: light["text-primary"],
    "text-muted": light["text-secondary"],
    accent: light.accent,
    star: `${ink}${PAPER_INK.star}`,
    "star-faint": `${ink}${PAPER_INK["star-faint"]}`,
    veil: `${light.canvas.slice(0, 7)}e0`,
    "q-light": light["q-light"],
    "q-sweep": light["q-light"],
    "q-ember": light["q-ember"],
    "q-bloom": light["q-bloom"],
  };
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
