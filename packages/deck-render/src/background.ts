/**
 * A slide background the person chose (ADR 0025), as something every
 * renderer can draw. SVG draws a real gradient; a PDF page and a PPTX
 * slide have no gradient primitive this renderer can rely on, so a
 * gradient becomes thin horizontal bands, fine enough to read as smooth
 * at slide size. One stop is a fill.
 */
export type BackgroundBand = {
  readonly y: number;
  readonly height: number;
  readonly colour: string;
};

const BANDS = 96;

function channels(hex: string): readonly [number, number, number] {
  const digits = hex.replace("#", "");
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
}

function mix(from: string, to: string, at: number): string {
  const a = channels(from);
  const b = channels(to);
  return `#${a
    .map((value, index) =>
      Math.round(value + ((b[index] ?? value) - value) * at)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Top to bottom; the bands overlap by a point so no seam shows. */
export function backgroundBands(
  stops: readonly string[],
  height: number,
): readonly BackgroundBand[] {
  const [from, to] = stops;
  if (from === undefined) return [];
  if (to === undefined) return [{ y: 0, height, colour: from }];
  const step = height / BANDS;
  return Array.from({ length: BANDS }, (_, index) => ({
    y: index * step,
    height: step + 1,
    colour: mix(from, to, index / (BANDS - 1)),
  }));
}
