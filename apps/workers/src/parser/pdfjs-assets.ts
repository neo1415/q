import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";

/**
 * pdf.js's character maps, standard font data and wasm decoders, from the
 * pdfjs-dist package on disk (never the network). Without the CMaps a PDF
 * whose fonts use CID encodings (most Arabic, Chinese, Japanese and Korean
 * decks, and many exported from design tools) yields empty or garbled
 * text; without the standard font data, the fourteen base fonts have no
 * metrics and render as boxes. pdf.js in Node reads these with fs from the
 * directory paths given here (trailing separator required).
 */
export function pdfjsAssetOptions(): {
  readonly cMapUrl: string;
  readonly cMapPacked: true;
  readonly standardFontDataUrl: string;
  readonly wasmUrl: string;
} {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("pdfjs-dist/package.json"));
  return {
    cMapUrl: join(root, "cmaps") + sep,
    cMapPacked: true,
    standardFontDataUrl: join(root, "standard_fonts") + sep,
    wasmUrl: join(root, "wasm") + sep,
  };
}
