import { FACE_METRICS, METRIC_CODEPOINTS, type FaceKey } from "./metrics.js";

export type { FaceKey };

/**
 * The faces a deck is set in, and how wide a line of them is (deck quality,
 * 2026-10-08).
 *
 * The layout used one width model for every face, deliberately pessimistic,
 * and the PDF then drew everything in Noto Sans whatever pairing the deck
 * named — so a deck "in IBM Plex" was a deck in Noto, wrapped for a font it
 * was not set in. The faces are bundled now (`fonts/`, SIL OFL 1.1, none
 * with a Reserved Font Name or shipped unmodified), and each one's advance
 * widths are a generated table (`metrics.ts`), read synchronously: the
 * layout still measures without touching a font file, and the PDF draws in
 * the face the layout measured, so wrapping and drawing agree.
 *
 * A character outside a face's table is measured at a generous average
 * and drawn from Noto Sans (see `fonts.ts`), which covers the scripts the
 * display faces do not.
 */

/** The file under `fonts/` each face is drawn from. */
export const FACE_FILES: Readonly<Record<FaceKey, string>> = {
  INTER: "Inter-Regular.ttf",
  INTER_SEMIBOLD: "Inter-SemiBold.ttf",
  INTER_DISPLAY: "InterDisplay-SemiBold.ttf",
  SOURCE_SERIF_DISPLAY: "SourceSerif4Display-SemiBold.ttf",
  FRAUNCES: "Fraunces-SemiBold.ttf",
  PLEX_SERIF: "IBMPlexSerif-SemiBold.ttf",
  NOTO: "NotoSans-Regular.ttf",
  NOTO_BOLD: "NotoSans-Bold.ttf",
};

/** Whether a face is a bold cut: its missing glyphs come from Noto Bold. */
export const FACE_IS_BOLD: Readonly<Record<FaceKey, boolean>> = {
  INTER: false,
  INTER_SEMIBOLD: true,
  INTER_DISPLAY: true,
  SOURCE_SERIF_DISPLAY: true,
  FRAUNCES: true,
  PLEX_SERIF: true,
  NOTO: false,
  NOTO_BOLD: true,
};

const CODEPOINTS = METRIC_CODEPOINTS.split(",").map(Number);

const TABLES = new Map<FaceKey, ReadonlyMap<number, number>>();

function table(face: FaceKey): ReadonlyMap<number, number> {
  let found = TABLES.get(face);
  if (found === undefined) {
    const widths = FACE_METRICS[face].split(",").map(Number);
    const built = new Map<number, number>();
    CODEPOINTS.forEach((code, index) => {
      const width = widths[index] ?? 0;
      if (width > 0) built.set(code, width);
    });
    found = built;
    TABLES.set(face, found);
  }
  return found;
}

/** Width of a character the table does not hold: wider than most glyphs. */
const UNKNOWN_WIDTH = 640;
/**
 * A little slack on every measured line: kerning is off in the PDF, but a
 * PowerPoint that substitutes a face runs a few per cent wider.
 */
const SLACK = 1.02;

/** How wide `text` is in `face` at `size` points. */
export function measureIn(text: string, size: number, face: FaceKey): number {
  const widths = table(face);
  let units = 0;
  for (const character of text.normalize("NFC")) {
    units += widths.get(character.codePointAt(0) ?? 0) ?? UNKNOWN_WIDTH;
  }
  return (units / 1000) * size * SLACK;
}
