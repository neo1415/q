/** "3", "3m", "$1.8m", "250k", "1,000" → a plain decimal string, or null. */
export function parseFigure(text: string): string | null {
  const match =
    /(?:^|[^a-z0-9.])(?:[$£€]|usd|gbp|eur|ngn|kes|zar)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|m|mn|million|bn|b|billion|thousand)?(?![a-z0-9])/i.exec(
      text,
    );
  if (match === null) {
    return null;
  }
  const whole = (match[1] ?? "0").replace(/,/g, "");
  const fraction = match[2] ?? "";
  const suffix = (match[3] ?? "").toLowerCase();
  let value = Number.parseFloat(
    `${whole}${fraction.length > 0 ? `.${fraction}` : ""}`,
  );
  if (!Number.isFinite(value)) {
    return null;
  }
  if (suffix === "k" || suffix === "thousand") {
    value *= 1_000;
  } else if (suffix === "m" || suffix === "mn" || suffix === "million") {
    value *= 1_000_000;
  } else if (suffix === "b" || suffix === "bn" || suffix === "billion") {
    value *= 1_000_000_000;
  }
  if (!Number.isInteger(value) && Math.abs(value) >= 1) {
    value = Math.round(value * 100) / 100;
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
