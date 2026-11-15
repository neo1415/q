import {
  GATEQ_SVG_LOGO_CSP,
  GATEQ_SVG_LOGO_MAX_BYTES,
} from "@capital-q/contracts";

const SVG_PREFIX = '<svg xmlns="http://www.w3.org/2000/svg"';

/**
 * An SVG logo as the API serves it: labelled image/svg+xml, within the
 * bound, starting as the sanitiser writes it, and carrying nothing that
 * runs or loads (a second, independent check of the API's).
 */
function isServedSvgLogo(contentType: string | null, bytes: Uint8Array) {
  if (contentType?.split(";")[0]?.trim() !== "image/svg+xml") return false;
  if (bytes.byteLength > GATEQ_SVG_LOGO_MAX_BYTES) return false;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!text.startsWith(SVG_PREFIX) || !text.endsWith("</svg>")) return false;
  return !/<\s*(script|foreignobject|iframe|image|a|animate|set)\b|\son[a-z]+\s*=|javascript:|data:|@import|<!/iu.test(
    text,
  );
}

/**
 * A gateway logo the API answered with, re-checked here before it leaves
 * this origin: PNG or JPEG by its bytes, or an SVG in the sanitiser's exact
 * form with nothing that could run. Served with nosniff and a sandboxing
 * policy so it can only ever be an image. Null: not a logo, a 404.
 */
export function servedLogo(
  contentType: string | null,
  bytes: Uint8Array,
  cacheControl: string,
): Response | null {
  if (bytes.byteLength > 512 * 1024) return null;
  const png =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const svg = !png && !jpeg && isServedSvgLogo(contentType, bytes);
  if (!png && !jpeg && !svg) return null;
  // A copy backed by its own ArrayBuffer is a BodyInit; any view is not.
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": svg ? "image/svg+xml" : png ? "image/png" : "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": svg
        ? GATEQ_SVG_LOGO_CSP
        : "default-src 'none'; sandbox",
      "Cache-Control": cacheControl,
    },
  });
}
