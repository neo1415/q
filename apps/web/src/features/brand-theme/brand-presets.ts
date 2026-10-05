import { DEFAULT_BRAND_HEX } from "./brand-colour";

/**
 * Quick picks for the brand colour control: a starting point, not a
 * limit (any colour can be typed or picked). Data, not styling: each is
 * run through the same AA math as a typed colour before it is shown.
 */
export const BRAND_PRESETS: readonly {
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
