import type { OnboardingRecordResult } from "@capital-q/q-tools";

/**
 * The reply code writes itself after a clean recording round (owner
 * 2026-10-16: a second model round only to say "got it" made a typed turn
 * 6 s at p50). When every answer the person gave was COMMITTED and their
 * words asked nothing else of the turn, what Q says is fully decided: what
 * was saved, in the record's own words, then the next question from
 * coverage. Saying it needs no model.
 *
 * It claims only what committed: the results come back from the write, so
 * "saved" is never said before the commit. Anything else in the round (a
 * refusal, an ambiguity, a held save, a finding to put to them, a check to
 * raise) needs judgement and goes to the model as before: null here.
 */

const LEADS = [
  "Got it, saved",
  "Thanks, that's on your record",
  "Noted and saved",
  "Great, saved",
] as const;

/** The longest a recorded value is read back whole; longer text by its opening. */
const MAX_VALUE = 80;

/** The lead used where the reply is translated: one line per language. */
export const FIXED_LEAD = "Got it, saved";

/** A long answer's opening words, cut at a word, marked as cut. */
function openingWords(text: string): string {
  const head = text.slice(0, 60);
  const cut = head.lastIndexOf(" ");
  const words = (cut > 20 ? head.slice(0, cut) : head)
    .replace(/[,;:\s]+$/u, "")
    .split(" ");
  // Not on a small joining word ("in Accra and…").
  while (
    words.length > 3 &&
    /^(?:and|or|but|in|on|at|for|the|a|an|of|to|with|by|from)$/iu.test(
      words.at(-1) ?? "",
    )
  ) {
    words.pop();
  }
  return `${words.join(" ").replace(/[,;:\s]+$/u, "")}…`;
}

type AcknowledgementInput = {
  readonly results: readonly OnboardingRecordResult[];
  /** Each step's short label, from the journey's coverage profile. */
  readonly labelOf: (stepKey: string) => string | undefined;
  /** The question that comes next, from coverage; null when none does. */
  readonly next: {
    readonly question: string;
    readonly optional: boolean;
  } | null;
  /** Varies the opening so no two turns sound alike. */
  readonly turnIndex: number;
  /** The one fixed lead (a reply to be translated). */
  readonly fixedLead?: boolean | undefined;
  /** A fixed line said between the receipt and the question (research). */
  readonly aside?: string | undefined;
};

/** One receipt line: a label with what was recorded (a long answer's opening words). */
export type AcknowledgedItem =
  | {
      readonly kind: "VALUE";
      readonly stepKey: string;
      readonly label: string;
      readonly value: string;
    }
  /** A fact kept with their notes, read back as written ("revenue: first revenue only"). */
  | { readonly kind: "KEPT"; readonly text: string };

/**
 * The acknowledgement's pieces, before any language is chosen: the lead,
 * each receipt line, and the next question. Product copy (lead, labels,
 * question) is kept apart from what was recorded, so a translation is
 * asked only for product copy and the record is read back exactly.
 */
export type AcknowledgementParts = {
  readonly lead: string;
  readonly items: readonly AcknowledgedItem[];
  /** The next question, ending in "?". */
  readonly question: string;
  readonly optional: boolean;
  /** A fixed line of product copy before the question, if any. */
  readonly aside?: string | undefined;
};

/** Said once when research on them starts (product copy, translated like the rest). */
export const RESEARCH_STARTED_LINE =
  "I'll look at your public sources and bring back what I find for you to confirm.";
/** Said once when that research found nothing useful. */
export const RESEARCH_NOTHING_LINE =
  "Public sources had nothing useful on the company, so we'll carry on here.";

export const OPTIONAL_ACKNOWLEDGEMENT_TAIL =
  "We can come back to this if you'd rather skip it.";

export function acknowledgementParts(
  input: AcknowledgementInput,
): AcknowledgementParts | null {
  const { results, next } = input;
  if (results.length === 0 || next === null) return null;
  if (results.some((result) => result.outcome !== "COMMITTED")) return null;
  const items: AcknowledgedItem[] = [];
  for (const result of results) {
    // A fact kept with their notes (not a question on their path) reads as
    // its own line ("revenue: first revenue only"), never "anything else".
    const kept = /^(.*?) \(kept with their notes/u.exec(result.recorded ?? "");
    if (kept?.[1] !== undefined) {
      items.push({
        kind: "KEPT",
        text: kept[1]
          .slice(0, MAX_VALUE)
          .replace(/^([^:]+):/u, (l) => l.toLowerCase()),
      });
      continue;
    }
    const label = input.labelOf(result.stepKey);
    // Their own sentence keeps its words, not its full stop ("schools..").
    const value = (result.recorded?.trim() ?? "").replace(/[.!?;:,\s]+$/u, "");
    if (label === undefined || value.length === 0) return null;
    // Each with its label, as a receipt ("stage: Seed"): a choice like
    // "Yes, actively" means nothing on its own. Long text is read back by
    // its opening words (live AH 2026-10-16: "your what the company does").
    items.push({
      kind: "VALUE",
      stepKey: result.stepKey,
      label,
      value: value.length > MAX_VALUE ? openingWords(value) : value,
    });
  }
  // One lead in a language other than English: one line to translate.
  const lead =
    input.fixedLead === true
      ? FIXED_LEAD
      : (LEADS[Math.abs(input.turnIndex) % LEADS.length] ?? LEADS[0]);
  const question = next.question.trim().endsWith("?")
    ? next.question.trim()
    : `${next.question.trim()}?`;
  return {
    lead,
    items,
    question,
    optional: next.optional,
    ...(input.aside === undefined ? {} : { aside: input.aside }),
  };
}

/** The English receipt line for one item. */
export function acknowledgedLine(item: AcknowledgedItem): string {
  if (item.kind === "KEPT") return item.text;
  return `${item.label.toLowerCase()}: ${item.value}`;
}

export function quickAcknowledgement(
  input: AcknowledgementInput,
): string | null {
  const parts = acknowledgementParts(input);
  if (parts === null) return null;
  const said = parts.items.map(acknowledgedLine).join("; ");
  const aside = parts.aside === undefined ? "" : `${parts.aside} `;
  return `${parts.lead}: ${said}. ${aside}${parts.question}${parts.optional ? ` ${OPTIONAL_ACKNOWLEDGEMENT_TAIL}` : ""}`;
}

/**
 * The same acknowledgement in another language (lane ob1 with lane ml):
 * the English product-copy lines it needs (lead, labels, choices, the
 * question) are listed by `acknowledgementCopy`; `acknowledgementIn` puts
 * the reply together from their translations, with what was recorded read
 * back exactly. Null when any line has no translation: the reply is then
 * the model's, never half one language.
 */
export type AcknowledgementCopy = {
  /** Product copy to translate, English. */
  readonly lines: readonly string[];
};

export type ChoicesOf = (
  stepKey: string,
  value: string,
) => readonly string[] | null;

function keptParts(text: string): { label: string; words: string } | null {
  const at = text.indexOf(": ");
  if (at <= 0) return null;
  return { label: text.slice(0, at), words: text.slice(at + 2) };
}

export function acknowledgementCopy(
  parts: AcknowledgementParts,
  /**
   * The step's own choices a recorded value consists of (product copy, one
   * or several), or null when it is their own words.
   */
  choicesOf: ChoicesOf,
  /** Lines already in the language by hand (the question, the optional tail). */
  hand: { readonly question: string | null; readonly tail: string | null },
): AcknowledgementCopy | null {
  const lines: string[] = [parts.lead];
  for (const item of parts.items) {
    if (item.kind === "KEPT") {
      const kept = keptParts(item.text);
      if (kept === null) return null;
      lines.push(kept.label);
    } else {
      lines.push(item.label.toLowerCase());
      lines.push(...(choicesOf(item.stepKey, item.value) ?? []));
    }
  }
  if (parts.aside !== undefined) lines.push(parts.aside);
  if (hand.question === null) lines.push(parts.question);
  if (parts.optional && hand.tail === null)
    lines.push(OPTIONAL_ACKNOWLEDGEMENT_TAIL);
  return { lines: [...new Set(lines)] };
}

export function acknowledgementIn(
  parts: AcknowledgementParts,
  words: (english: string) => string | null,
  choicesOf: ChoicesOf,
  hand: { readonly question: string | null; readonly tail: string | null },
  /** Between receipt lines, and between choices within one. */
  separators: { readonly items: string; readonly list: string },
): string | null {
  const said: string[] = [];
  for (const item of parts.items) {
    if (item.kind === "KEPT") {
      const kept = keptParts(item.text);
      const label = kept === null ? null : words(kept.label);
      if (kept === null || label === null) return null;
      said.push(`${label}: ${kept.words}`);
    } else {
      const label = words(item.label.toLowerCase());
      // A choice is product copy and is said in their language; their own
      // words are read back exactly as recorded.
      const choices = choicesOf(item.stepKey, item.value);
      const value =
        choices === null
          ? [item.value]
          : choices.map((choice) => words(choice));
      if (label === null || value.some((v) => v === null)) return null;
      said.push(`${label}: ${value.join(separators.list)}`);
    }
  }
  const lead = words(parts.lead);
  const question = hand.question ?? words(parts.question);
  const tail = parts.optional
    ? (hand.tail ?? words(OPTIONAL_ACKNOWLEDGEMENT_TAIL))
    : "";
  if (lead === null || question === null || tail === null) return null;
  const aside = parts.aside === undefined ? "" : words(parts.aside);
  if (aside === null) return null;
  const opening = lead.replace(/[.!:;,\s]+$/u, "");
  return `${opening}: ${said.join(separators.items)}. ${aside === "" ? "" : `${aside} `}${question}${tail === "" ? "" : ` ${tail}`}`;
}

/** Latin-script words only: the code-written reply is English (lane ml owns others). */
export function writtenInLatinScript(text: string): boolean {
  return /^[\p{Script=Latin}\p{N}\p{P}\p{S}\p{Zs}\s]*$/u.test(text);
}
