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
  "Got it, I've saved",
  "Thanks, I've noted",
  "Great, I've saved",
  "Noted, I've saved",
] as const;

/** The longest a recorded value is read back whole; longer text by its opening. */
const MAX_VALUE = 80;

/** The lead used where the reply is translated: one line per language. */
export const FIXED_LEAD = "Got it, saved";

/** The full stop after the receipt, unless it already ends on a cut ("…"). */
function endOf(said: string): string {
  return /[….!?]$/u.test(said) ? "" : ".";
}

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
  // What was already on the record was said when it was saved: never
  // again (live 25 Oct e2e: one note restated on every turn).
  for (const result of results.filter((r) => r.alreadyRecorded !== true)) {
    // A fact kept with their notes (not a question on their path) reads as
    // its own line ("revenue: first revenue only"), never "anything else".
    const kept = /^(.*?) \(kept with their notes/u.exec(result.recorded ?? "");
    if (kept?.[1] !== undefined) {
      items.push({
        kind: "KEPT",
        text: kept[1]
          .slice(0, MAX_VALUE)
          .replace(/^([^:]+):/u, (l) => l.toLowerCase())
          .replace(/[.!?;:,\s]+$/u, ""),
      });
      continue;
    }
    const label = input.labelOf(result.stepKey);
    // Their own sentence keeps its words, not its full stop ("schools..").
    // Their own words are read back as theirs, with no English note
    // (live AJ: "basés au Sénégal (in their words)" in a French reply).
    const value = (result.recorded?.trim() ?? "")
      .replace(/\s*\(in their words\)$/u, "")
      .replace(/[.!?;:,\s]+$/u, "");
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

/**
 * The English receipt for one item, said as speech (QA QO-20, 23 Oct:
 * "saved: stage: Seed; raising now: Yes…" read as a key:value dump). What
 * was recorded comes first, its field after it in brackets: "Seed
 * (stage)", "Yes, actively (raising now)"; a fact kept with their notes
 * reads "first revenue only (in your notes on revenue)".
 */
export function acknowledgedLine(item: AcknowledgedItem): string {
  if (item.kind === "KEPT") {
    const kept = keptParts(item.text);
    return kept === null
      ? item.text
      : `${kept.words} (in your notes on ${kept.label})`;
  }
  return `${item.value} (${item.label.toLowerCase()})`;
}

/** "a", "a and b", "a, b and c". */
function spokenList(lines: readonly string[]): string {
  if (lines.length <= 1) return lines[0] ?? "";
  return `${lines.slice(0, -1).join(", ")} and ${lines.at(-1) ?? ""}`;
}

/** The English receipt sentence: the lead, then what was saved; nothing when nothing new was. */
function receiptSentence(parts: AcknowledgementParts): string {
  if (parts.items.length === 0) return "";
  const said = spokenList(parts.items.map(acknowledgedLine));
  return `${parts.lead} ${said}${endOf(said)}`;
}

export function quickAcknowledgement(
  input: AcknowledgementInput,
): string | null {
  const parts = acknowledgementParts(input);
  if (parts === null) return null;
  const receipt = receiptSentence(parts);
  const aside = parts.aside === undefined ? "" : `${parts.aside} `;
  return `${receipt === "" ? "" : `${receipt} `}${aside}${parts.question}${parts.optional ? ` ${OPTIONAL_ACKNOWLEDGEMENT_TAIL}` : ""}`;
}

/**
 * What one result reads back as in a receipt: a note kept with their notes
 * by its words ("the 210 customers is right"), anything else as recorded.
 * What a reply that repeats the receipt is matched against.
 */
export function receiptValueOf(result: OnboardingRecordResult): string {
  const recorded = (result.recorded ?? "").replace(
    /\s*\(in their words\)$/u,
    "",
  );
  const kept = /^(.*?) \(kept with their notes/u.exec(recorded)?.[1];
  if (kept === undefined) return recorded;
  return keptParts(kept)?.words ?? kept;
}

/**
 * The receipt alone, for what was saved, without a question (owner
 * 2026-10-21: Q's first words within 2-3 s). Said by code the moment the
 * saves commit, while the model writes the rest of a reply that needs its
 * judgement. Null when nothing committed, or a label is unknown.
 */
export function quickReceipt(
  input: Pick<AcknowledgementInput, "results" | "labelOf" | "turnIndex">,
): string | null {
  const committed = input.results.filter(
    (result) => result.outcome === "COMMITTED",
  );
  const parts = acknowledgementParts({
    ...input,
    results: committed,
    next: { question: "-", optional: false },
  });
  if (parts === null || parts.items.length === 0) return null;
  return receiptSentence(parts);
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
  /**
   * Of those, the choices' own labels ("Seed", "CEO", "US dollar"): whole
   * labels, translated as they are (a sentence path would read "Seed" as
   * a name and keep it English; live AL Arabic read-back).
   */
  readonly choices: readonly string[];
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
  const choices: string[] = [];
  for (const item of parts.items) {
    if (item.kind === "KEPT") {
      const kept = keptParts(item.text);
      if (kept === null) return null;
      lines.push(kept.label);
    } else {
      lines.push(item.label.toLowerCase());
      choices.push(...(choicesOf(item.stepKey, item.value) ?? []));
    }
  }
  if (parts.aside !== undefined) lines.push(parts.aside);
  if (hand.question === null) lines.push(parts.question);
  if (parts.optional && hand.tail === null)
    lines.push(OPTIONAL_ACKNOWLEDGEMENT_TAIL);
  return { lines: [...new Set(lines)], choices: [...new Set(choices)] };
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
          ? [figuresInDigits(item.value)]
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
  const joined = said.join(separators.items);
  const receipt =
    said.length === 0 ? "" : `${opening}: ${joined}${endOf(joined)} `;
  return `${receipt}${aside === "" ? "" : `${aside} `}${question}${tail === "" ? "" : ` ${tail}`}`;
}

/** Latin-script words only: the code-written reply is English (lane ml owns others). */
export function writtenInLatinScript(text: string): boolean {
  return /^[\p{Script=Latin}\p{N}\p{P}\p{S}\p{Zs}\s]*$/u.test(text);
}

/**
 * A figure read back in another language with its English scale word
 * written out in digits ("$2 million" -> "$2,000,000"; live AL Arabic).
 */
export function figuresInDigits(value: string): string {
  const scales: Readonly<Record<string, number>> = {
    thousand: 1e3,
    k: 1e3,
    million: 1e6,
    m: 1e6,
    billion: 1e9,
    bn: 1e9,
  };
  return value.replace(
    /(\d+(?:\.\d+)?)\s*(thousand|million|billion|bn|k|m)\b/giu,
    (whole, figure: string, scale: string) => {
      const factor = scales[scale.toLowerCase()];
      return factor === undefined
        ? whole
        : Math.round(Number(figure) * factor).toLocaleString("en-US");
    },
  );
}
