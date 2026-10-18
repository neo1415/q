import type { ArcBox } from "./layout.js";

/**
 * Deck quality: the two shapes a rectangle and a circle cannot draw — a
 * rounded panel and a donut segment — as SVG path data in slide units, so
 * the SVG and the PDF (pdf-lib reads the same path syntax) trace exactly
 * the same outline. PowerPoint draws its own preset shapes from the same
 * box (`roundRect`, `blockArc`).
 */

const round = (value: number): string =>
  (Math.round(value * 100) / 100).toString();

/** A rectangle with corners of radius `r`, clockwise from the top left. */
export function roundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  r: number,
): string {
  const radius = Math.max(0, Math.min(r, width / 2, height / 2));
  const right = x + width;
  const bottom = y + height;
  return [
    `M${round(x + radius)} ${round(y)}`,
    `H${round(right - radius)}`,
    `A${round(radius)} ${round(radius)} 0 0 1 ${round(right)} ${round(y + radius)}`,
    `V${round(bottom - radius)}`,
    `A${round(radius)} ${round(radius)} 0 0 1 ${round(right - radius)} ${round(bottom)}`,
    `H${round(x + radius)}`,
    `A${round(radius)} ${round(radius)} 0 0 1 ${round(x)} ${round(bottom - radius)}`,
    `V${round(y + radius)}`,
    `A${round(radius)} ${round(radius)} 0 0 1 ${round(x + radius)} ${round(y)}`,
    "Z",
  ].join(" ");
}

/** The point at `degrees` clockwise from twelve o'clock on a circle. */
function at(cx: number, cy: number, r: number, degrees: number): string {
  const radians = (degrees * Math.PI) / 180;
  return `${round(cx + r * Math.sin(radians))} ${round(cy - r * Math.cos(radians))}`;
}

/** A ring segment: outer arc forward, inner arc back. */
export function arcPath(box: ArcBox): string {
  const outer = box.width / 2;
  const inner = Math.max(0, outer - box.thickness);
  const cx = box.x + outer;
  const cy = box.y + outer;
  // A full ring cannot be one arc (its ends meet): draw it as two halves.
  const sweep = Math.min(box.sweep, 359.99);
  const pieces =
    sweep > 359
      ? [
          [box.start, 180],
          [box.start + 180, sweep - 180],
        ]
      : [[box.start, sweep]];
  return pieces
    .map(([start = 0, length = 0]) => {
      const end = start + length;
      const large = length > 180 ? 1 : 0;
      return [
        `M${at(cx, cy, outer, start)}`,
        `A${round(outer)} ${round(outer)} 0 ${String(large)} 1 ${at(cx, cy, outer, end)}`,
        `L${at(cx, cy, inner, end)}`,
        `A${round(inner)} ${round(inner)} 0 ${String(large)} 0 ${at(cx, cy, inner, start)}`,
        "Z",
      ].join(" ");
    })
    .join(" ");
}
