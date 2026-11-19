/** Words and numbers for the console's spend figures (no React, no browser). */

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "19 Nov" for a YYYY-MM-DD UTC day. */
export function dayLabel(day: string): string {
  return DAY.format(new Date(`${day}T00:00:00.000Z`));
}

/** "$1,234.50" from the API's decimal string. */
export function usd(value: string): string {
  const n = Number(value);
  return `$${n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Rounds the axis top up to a readable figure (1, 2 or 5 × 10ⁿ). */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * power) return step * power;
  }
  return 10 * power;
}
