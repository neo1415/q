import "server-only";

import { renderSVG } from "uqr";

/**
 * The card's QR (BIZ-004): it encodes the short first-party redirect
 * (`https://<origin>/c/<code>`, under ~30 characters on a real domain), so
 * the target can change and a code can be revoked without reprinting.
 * Rendered on the server as SVG in `currentColor`, so it follows the theme
 * on screen and stays crisp at any print size.
 */
export function qrSvg(
  url: string,
  options: { readonly dark?: string; readonly light?: string } = {},
): string {
  return renderSVG(url, {
    ecc: "M",
    border: 2,
    blackColor: options.dark ?? "currentColor",
    whiteColor: options.light ?? "transparent",
  });
}
