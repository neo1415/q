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
 * Amounts written as digits (with an optional k / thousand / m / million /
 * bn / billion scale) count as stated, and so do amounts said in words
 * with a scale ("two million"). Anything else is not recorded as a value;
 * the person's own sentence still is, so nothing they said is lost.
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

const SMALL: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const WORD_SCALES: Readonly<Record<string, number>> = {
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
};

/**
 * Amounts said in words with a scale ("two million", "half a million",
 * "one hundred and fifty thousand"): said by the person as surely as
 * digits are (owner 2026-10-21: an amount said aloud was never kept). A
 * bare "two" is not an amount, so only a number that carries hundred,
 * thousand, million or billion counts.
 */
function wordAmountsIn(text: string): readonly number[] {
  const words = text.toLowerCase().match(/[a-z]+/gu) ?? [];
  const found: number[] = [];
  let total = 0;
  let group = 0;
  let counting = false;
  let scaled = false;
  const flush = () => {
    if (counting && scaled) found.push(total + group);
    total = 0;
    group = 0;
    counting = false;
    scaled = false;
  };
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? "";
    const next = words[i + 1] ?? "";
    const small = SMALL[word];
    const scale = WORD_SCALES[word];
    if (small !== undefined) {
      group += small;
      counting = true;
    } else if (
      (word === "a" || word === "an") &&
      (next === "hundred" || WORD_SCALES[next] !== undefined)
    ) {
      if (group === 0) group = 1;
      counting = true;
    } else if (word === "half" && (next === "a" || next === "an")) {
      flush();
      group = 0.5;
      counting = true;
      i += 1;
    } else if (word === "hundred" && counting) {
      group = (group === 0 ? 1 : group) * 100;
      scaled = true;
    } else if (scale !== undefined && counting) {
      total += (group === 0 ? 1 : group) * scale;
      group = 0;
      scaled = true;
    } else if (word === "and" && counting) {
      continue;
    } else {
      flush();
    }
  }
  flush();
  return found;
}

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
  return [...found, ...wordAmountsIn(text)];
}

/** True only when `amount` (a decimal string) is written in `text`. */
export function amountStatedIn(amount: string, text: string): boolean {
  const target = Number(amount);
  if (!Number.isFinite(target)) return false;
  // Half a cent: the stored decimal has at most two places.
  return amountsIn(text).some((value) => Math.abs(value - target) < 0.005);
}

/** A reply that agrees ("Yes", "yeah, that's right", "correct"). */
const AFFIRM =
  /^\s*(?:yes|yeah|yep|yup|yes please|correct|right|exactly|indeed|sure|that'?s (?:right|correct|it)|that is (?:right|correct)|spot on)\b/iu;
/** A reply that turns it down, even after a "yes" ("yes, no, it's less"). */
const DISAGREE = /\b(?:no|not|wrong|actually|but|less|more|wait)\b/iu;

/**
 * Whether the applicant agreed to a figure Q read back to them: Q's last
 * turn says it, and their reply agrees and states no figure of its own (a
 * figure they give is checked as said, on its own). Agreeing to a figure
 * put to them makes it their claim, as a figure read back and confirmed
 * does in onboarding.
 */
export function affirmsReadBack(
  amount: string,
  qText: string | undefined,
  reply: string,
): boolean {
  return (
    qText !== undefined &&
    amountStatedIn(amount, qText) &&
    AFFIRM.test(reply) &&
    !DISAGREE.test(reply) &&
    amountsIn(reply).length === 0
  );
}

/**
 * An AMOUNT fact in words for a person: the ISO currency, then the exact
 * decimal grouped in thousands ("USD 360,000"; live check 2026-10-16:
 * "360000 USD" read as a raw value). Never through a float.
 */
export function amountWords(amount: string, currency: string): string {
  const [whole = "0", fraction] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const cents =
    fraction === undefined || /^0*$/u.test(fraction)
      ? ""
      : `.${fraction.padEnd(2, "0").slice(0, 2)}`;
  return `${currency} ${grouped}${cents}`;
}

/**
 * The dossier's summary of an AMOUNT fact back to its parts: "USD 360,000"
 * (amountWords) or, in dossiers frozen before it, "360000 USD".
 */
export function amountOfSummary(
  summary: string,
): { readonly amount: string; readonly currency: string } | null {
  const text = summary.trim();
  const legacy = /^(\d+(?:\.\d{1,2})?) ([A-Z]{3})$/u.exec(text);
  if (legacy?.[1] !== undefined && legacy[2] !== undefined) {
    return { amount: legacy[1], currency: legacy[2] };
  }
  const words = /^([A-Z]{3}) (\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)$/u.exec(text);
  return words?.[1] === undefined || words[2] === undefined
    ? null
    : { amount: words[2].replace(/,/gu, ""), currency: words[1] };
}
