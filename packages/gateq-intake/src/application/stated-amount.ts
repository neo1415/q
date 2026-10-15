/**
 * Was this amount actually SAID (lead decision 2026-10-15, live run)?
 *
 * The interviewer heard "two of them pay $180,000 each" and recorded
 * revenue "360000 USD" as the founder's own words. A figure Q computed is
 * not a claim the founder made (ADR-001: truth class is its own axis). This
 * is the deterministic check behind both sides of that rule:
 *
 *  - at write, a heard amount that is not stated in the utterance it was
 *    heard in is not stored (the verbatim claim stays in its phrases);
 *  - at build and read, a frozen heard amount that is not stated in its
 *    source turn is shown as Q_INFERENCE with its derivation, never as
 *    "you said".
 *
 * Conservative on purpose: only amounts written as digits (with an optional
 * k / thousand / m / million / bn / billion scale) count as stated. An
 * amount said only in words is therefore not recorded as a value; the
 * person's own sentence still is, so nothing they said is lost.
 */

const SCALES: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  mn: 1e6,
  million: 1e6,
  millions: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

const NUMBER =
  /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|thousand|mm|mn|m|millions|million|bn|b|billion)?(?![a-z])/giu;

/** Every amount written in `text`, as numbers (scales applied). */
export function amountsIn(text: string): readonly number[] {
  const found: number[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const whole = (match[1] ?? "").replace(/,/gu, "");
    const fraction = match[2] ?? "";
    const scale = SCALES[(match[3] ?? "").toLowerCase()] ?? 1;
    const value = Number(fraction === "" ? whole : `${whole}.${fraction}`);
    if (Number.isFinite(value)) found.push(value * scale);
  }
  return found;
}

/** True only when `amount` (a decimal string) is written in `text`. */
export function amountStatedIn(amount: string, text: string): boolean {
  const target = Number(amount);
  if (!Number.isFinite(target)) return false;
  // Half a cent: the stored decimal has at most two places.
  return amountsIn(text).some((value) => Math.abs(value - target) < 0.005);
}

/** "360000 USD", the dossier's summary of an AMOUNT fact, back to its parts. */
export function amountOfSummary(
  summary: string,
): { readonly amount: string; readonly currency: string } | null {
  const match = /^(\d+(?:\.\d{1,2})?) ([A-Z]{3})$/u.exec(summary.trim());
  return match === null || match[1] === undefined || match[2] === undefined
    ? null
    : { amount: match[1], currency: match[2] };
}
