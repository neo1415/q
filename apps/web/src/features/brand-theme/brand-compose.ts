import { brandPalette, brandStyleSheet } from "./brand-colour";
import { brandPreset, presetStyleSheet } from "./brand-presets";

/**
 * The brand style sheet in effect (K3): the preset's look, then the
 * admin's own accent, if any, after it so it wins by source order. A
 * theme that could not be read is the default preset with its own accent
 * (black and gold), never a broken page. Null when there is nothing to
 * write (classic blue, no colour of its own).
 */
export function composeBrandStyle(
  theme: {
    readonly presetKey: string;
    readonly primaryHex: string | null;
  } | null,
): string | null {
  const preset = presetStyleSheet(brandPreset(theme?.presetKey));
  const palette =
    theme?.primaryHex == null ? null : brandPalette(theme.primaryHex);
  const accent = palette === null ? "" : brandStyleSheet(palette);
  const css = [preset, accent].filter((part) => part !== "").join("\n");
  return css === "" ? null : css;
}
