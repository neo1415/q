import "server-only";

import { cache } from "react";

import { getBrandTheme } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

import { composeBrandStyle } from "./brand-compose";

/**
 * The brand in effect for the signed-in person as a style sheet: the
 * preset's look (black and gold by default; K3) and the admin's own
 * accent on top, or null for classic blue with no colour of its own. A
 * read that fails paints the default preset, never a broken page.
 */
export const loadBrandStyle = cache(async (): Promise<string | null> => {
  const session = await apiSession();
  if (session === null) return null;
  const theme = await getBrandTheme(session).catch(() => null);
  return composeBrandStyle(theme);
});

/**
 * Rendered after the global stylesheets so the same selectors win by
 * source order. The text is built only from validated hex values
 * (presetStyleSheet and brandStyleSheet re-check each one), so it is safe
 * to write inline.
 */
export function BrandStyle({ css }: { readonly css: string | null }) {
  if (css === null) return null;
  return <style data-cq-brand dangerouslySetInnerHTML={{ __html: css }} />;
}
