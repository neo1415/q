import "server-only";

import { cache } from "react";

import { getBrandTheme } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

import { brandPalette, brandStyleSheet } from "./brand-colour";

/**
 * The brand colour in effect for the signed-in person as a style sheet, or
 * null for Capital Q's own colours (and whenever the read fails: the app
 * then simply keeps its default accent, never a broken one).
 */
export const loadBrandStyle = cache(async (): Promise<string | null> => {
  const session = await apiSession();
  if (session === null) return null;
  const theme = await getBrandTheme(session).catch(() => null);
  if (theme?.primaryHex == null) return null;
  const palette = brandPalette(theme.primaryHex);
  if (palette === null) return null;
  const css = brandStyleSheet(palette);
  return css === "" ? null : css;
});

/**
 * Rendered after the global stylesheets so the same selectors win by
 * source order. The text is built only from validated #rrggbb values
 * (brandStyleSheet re-checks each one), so it is safe to write inline.
 */
export function BrandStyle({ css }: { readonly css: string | null }) {
  if (css === null) return null;
  return (
    <style data-cq-brand dangerouslySetInnerHTML={{ __html: css }} />
  );
}
