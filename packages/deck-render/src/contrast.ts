/** Colour arithmetic the layout and the inspector share (WCAG 2.2). */

function channel(component: number): number {
  const c = component / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  const digits = match?.[1];
  if (digits === undefined) return null;
  const r = Number.parseInt(digits.slice(0, 2), 16);
  const g = Number.parseInt(digits.slice(2, 4), 16);
  const b = Number.parseInt(digits.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.2 contrast ratio, or null when a colour cannot be read. */
export function contrastRatio(a: string, b: string): number | null {
  const first = luminance(a);
  const second = luminance(b);
  if (first === null || second === null) return null;
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * `from` moved towards `to` by `amount` (0 keeps `from`, 1 is `to`), in
 * sRGB. For tints of one accent on a chart, so a part-of-whole bar uses
 * one hue and its labels, not colour, carry which part is which.
 */
export function mix(from: string, to: string, amount: number): string {
  const read = (hex: string): readonly number[] | null => {
    const digits = /^#([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
    if (digits === undefined) return null;
    return [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16));
  };
  const a = read(from);
  const b = read(to);
  if (a === null || b === null) return from;
  const t = Math.min(1, Math.max(0, amount));
  return `#${a
    .map((value, index) =>
      Math.round(value + ((b[index] ?? value) - value) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
