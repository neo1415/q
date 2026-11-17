import type { AuthorisedFact } from "@capital-q/q-core";

/**
 * Live 17 Nov 2026, run 13279c88 (production be260a584, Savanna on Nixo):
 * code read page 1 of Nixo's KPI pack and management accounts, both of
 * which state October 2026 net burn 125,800 and runway 8.8 months; the
 * limit fact named them, and the parallel findings call stated both
 * figures. The answer call, from the same messages, said "Nixo's monthly
 * burn and runway aren't established by the authorised figures I have".
 * Nothing in code held a sentence that says a figure is unknown to the
 * pages this run read.
 *
 * This is that check. A sentence that says a measure (burn, runway, cash)
 * is unknown, not established, not stated or not available, when a
 * document read for this turn states that measure as one figure, is said
 * as the document states it: its title, page, figure and period, in the
 * document's own words and units. Values are read by code from the page
 * text; nothing is computed, converted or guessed, and a measure the
 * documents do not state as one figure is left as the model said it.
 */

/** A document read for this turn: its title and the page text read. */
export type ReadDocument = { readonly title: string; readonly text: string };

/** One figure a document states, as code read it from the page text. */
type Stated = {
  readonly measure: Measure;
  readonly title: string;
  readonly page: number | null;
  readonly value: string;
  readonly currency: string | null;
  readonly period: string | null;
};

type Measure = {
  readonly key: string;
  /** The measure named in a sentence of the answer. */
  readonly named: RegExp;
  /** The measure's label in the document. */
  readonly label: RegExp;
  /** A label that names this measure but states another one. */
  readonly not?: RegExp;
  readonly say: string;
  readonly months?: true;
  readonly money?: true;
};

const MEASURES: readonly Measure[] = [
  {
    key: "burn",
    named: /\bburn(?:s|ing|ed)?\b/iu,
    label: /\b(?:net\s+)?burn(?:\s+rate)?\b/iu,
    not: /\brunway\b/iu,
    say: "net burn",
    money: true,
  },
  {
    key: "runway",
    named: /\brunway\b/iu,
    label: /\brunway\b/iu,
    say: "runway",
    months: true,
  },
  {
    key: "cash",
    named:
      /\bcash\s+(?:balance|position|on\s+hand|in\s+the\s+bank)\b|\bclosing\s+cash\b/iu,
    label:
      /\b(?:cash\s+at\s+(?:month|period|year)[-\s]end|closing\s+cash|cash\s+balance)\b/iu,
    say: "cash",
    money: true,
  },
];

const DENIAL =
  /(?:\bnot|n['’]t|\bnever)\s+(?:been\s+|yet\s+)?(?:established|known|available|stated|disclosed|given|reported|provided|shown|included|specified|visible|confirmed|in\s+what\s+I)\b|\bunknown\b|\b(?:can(?:not|['’]t)|could(?:n['’]t|\s+not)|unable\s+to)\s+(?:see|give|find|confirm|verify|state|provide|tell|determine|establish)\b|\bdo(?:es)?(?:n['’]t|\s+not)\s+(?:state|show|give|include|list|provide|say|have)\b|\bno\s+(?:reliable\s+|reported\s+|published\s+)?(?:figures?|data|numbers?|information)\b/iu;

const MONTH =
  /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b/u;
const NUMBER = /^-?\d[\d,]*(?:\.\d+)?$/u;

/** The documents read for this turn, from the facts the model was given. */
export function documentsReadOf(
  facts: readonly AuthorisedFact[],
): readonly ReadDocument[] {
  const byTitle = new Map<string, string>();
  for (const fact of facts) {
    if (fact.evidenceStatus !== "DOCUMENT_SUPPORTED") continue;
    if (!/\[p\.\s*\d+\]/u.test(fact.statement)) continue;
    const title = /"([^"]+)"/u.exec(fact.source ?? "")?.[1];
    if (title === undefined) continue;
    byTitle.set(title, `${byTitle.get(title) ?? ""}${fact.statement}\n`);
  }
  return [...byTitle].map(([title, text]) => ({ title, text }));
}

/** The nearest page marker and short period heading before `at`. */
function placeOf(
  text: string,
  at: number,
): { readonly page: number | null; readonly period: string | null } {
  const before = text.slice(0, at);
  const marks = [...before.matchAll(/\[p\.\s*(\d+)\]/gu)];
  const mark = marks.at(-1);
  const page = mark === undefined ? null : Number(mark[1]);
  const pageText = before.slice(mark?.index ?? 0);
  // A heading: a short line without table cells that names a month.
  const lines = pageText.split("\n").slice(0, -1).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > 60 || trimmed.includes("|"))
      continue;
    const month = MONTH.exec(trimmed);
    if (month !== null) return { page, period: month[0] };
  }
  return { page, period: null };
}

/** The single figure a document states for a measure, if it states one. */
function statedIn(document: ReadDocument, measure: Measure): Stated | null {
  const currencyOfDocument =
    /\bAmounts\s+in\s+([A-Z]{3})\b/u.exec(document.text)?.[1] ?? null;
  let offset = 0;
  for (const line of document.text.split("\n")) {
    const at = offset;
    offset += line.length + 1;
    // A table row: one label and exactly one value.
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length === 2) {
      const [label = "", value = ""] = cells;
      if (
        measure.label.test(label) &&
        !(measure.not?.test(label) ?? false) &&
        NUMBER.test(value) &&
        (measure.months !== true || /\bmonths?\b/iu.test(label))
      ) {
        const place = placeOf(document.text, at);
        return {
          measure,
          title: document.title,
          page: place.page,
          value,
          currency: measure.money === true ? currencyOfDocument : null,
          period: place.period,
        };
      }
      continue;
    }
    if (cells.length > 2) continue;
    // Prose: the label, then its figure within a few words.
    for (const clause of line.split(/;\s*|\.\s+(?=[A-Z])/u)) {
      const label = measure.label.exec(clause);
      if (label === null) continue;
      if (measure.not?.test(clause.slice(0, label.index)) ?? false) continue;
      const rest = clause.slice(label.index + label[0].length);
      const figure =
        /^[^\d|]{0,24}?(?:\b([A-Z]{3})\s*|\$)?(-?\d[\d,]*(?:\.\d+)?)(\s*months?\b)?/u.exec(
          rest,
        );
      if (figure === null) continue;
      const value = figure[2] ?? "";
      if (measure.months === true && figure[3] === undefined) continue;
      const place = placeOf(document.text, at);
      const inline = MONTH.exec(line);
      return {
        measure,
        title: document.title,
        page: place.page,
        value,
        currency:
          measure.money === true
            ? (figure[1] ??
              (rest.includes("$") ? "USD" : null) ??
              currencyOfDocument)
            : null,
        period: place.period ?? inline?.[0] ?? null,
      };
    }
  }
  return null;
}

const figureOf = (stated: Stated): string =>
  `${stated.measure.say} of ${stated.currency === null ? "" : `${stated.currency} `}${stated.value}${stated.measure.months === true ? " months" : ""}`;

/** Where one document says it, and what it states of these measures. */
function sayDocument(stated: readonly Stated[]): {
  readonly where: string;
  readonly what: string;
} {
  const first = stated[0];
  if (first === undefined) return { where: "", what: "" };
  const one = new Set(stated.map((s) => s.period)).size === 1;
  const figures = stated.map(
    (s) =>
      `${figureOf(s)}${!one && s.period !== null ? ` for ${s.period}` : ""}`,
  );
  const list =
    figures.length === 1
      ? (figures[0] ?? "")
      : `${figures.slice(0, -1).join(", ")} and ${figures.at(-1) ?? ""}`;
  return {
    where: `"${first.title}"${first.page === null ? "" : ` (p. ${String(first.page)})`}`,
    what: `${list}${one && first.period !== null ? ` for ${first.period}` : ""}`,
  };
}

/**
 * The figures the documents state for the measures a denying sentence
 * names, or null when the sentence does not deny one they state.
 */
function deniedButStated(
  sentence: string,
  documents: readonly ReadDocument[],
): readonly Stated[] | null {
  if (!DENIAL.test(sentence)) return null;
  const named = MEASURES.filter((measure) => measure.named.test(sentence));
  if (named.length === 0) return null;
  const stated: Stated[] = [];
  for (const measure of named) {
    for (const document of documents) {
      const one = statedIn(document, measure);
      if (one !== null) {
        stated.push(one);
        break;
      }
    }
  }
  if (stated.length === 0) return null;
  // Another year than the document's (a projection asked about): not ours.
  const years = new Set(
    stated.flatMap((one) => /\d{4}/u.exec(one.period ?? "")?.[0] ?? []),
  );
  const asked = sentence.match(/\b20\d{2}\b/gu) ?? [];
  if (asked.length > 0 && !asked.some((year) => years.has(year))) return null;
  // Already says the figures: a scoped denial beside them stays.
  const digits = (value: string) => value.replace(/,/gu, "");
  const plain = sentence.replace(/,/gu, "");
  if (stated.every((one) => plain.includes(digits(one.value)))) return null;
  return stated;
}

/** The statement, grouped by document, of what the documents state. */
function statementOf(stated: readonly Stated[], superseded: boolean): string {
  const byTitle = new Map<string, Stated[]>();
  for (const one of stated) {
    byTitle.set(one.title, [...(byTitle.get(one.title) ?? []), one]);
  }
  const parts = [...byTitle.values()].map(sayDocument);
  if (superseded) {
    return `[Superseded by this turn's read of ${parts.map((part) => `${part.where}, which states ${part.what}`).join("; and of ")}.]`;
  }
  return `${parts.map((part, at) => `${at === 0 ? "The document" : "the document"} ${part.where} states ${part.what}`).join("; ")}.`;
}

const SENTENCES = /(?<=[.!?])\s+(?=[\p{Lu}\d"“'‘(*])/u;

/**
 * Corrects one sentence; `said` holds what this answer already said so a
 * second denying sentence of the same figures is dropped (null).
 */
export function createDocumentDenialGuard(
  documents: () => readonly ReadDocument[],
): {
  readonly sentence: (sentence: string) => string | null;
  readonly corrected: () => number;
} {
  const said = new Set<string>();
  let corrected = 0;
  return {
    corrected: () => corrected,
    sentence: (sentence) => {
      const read = documents();
      if (read.length === 0) return sentence;
      const stated = deniedButStated(sentence, read);
      if (stated === null) return sentence;
      corrected += 1;
      const keys = stated.map((one) => one.measure.key);
      const fresh = stated.filter((one) => !said.has(one.measure.key));
      for (const key of keys) said.add(key);
      if (fresh.length === 0) return null;
      // Keep the sentence's own spacing and list marker.
      const lead = /^\s*(?:[-*•]\s+|\d+[.)]\s+)?/u.exec(sentence)?.[0] ?? "";
      const tail = /\s*$/u.exec(sentence)?.[0] ?? "";
      return `${lead}${statementOf(fresh, false)}${tail}`;
    },
  };
}

/** A whole answer, sentence by sentence, keeping its line breaks. */
export function correctDocumentDenials(
  answer: string,
  documents: readonly ReadDocument[],
): { readonly text: string; readonly corrected: number } {
  if (documents.length === 0) return { text: answer, corrected: 0 };
  const guard = createDocumentDenialGuard(() => documents);
  const lines = answer.split("\n").map((line) => {
    if (line.trim().length === 0) return line;
    const kept = line
      .split(SENTENCES)
      .map((sentence) => guard.sentence(sentence))
      .filter((sentence): sentence is string => sentence !== null);
    return kept.length === 0 ? null : kept.join(" ");
  });
  return {
    text: lines.filter((line): line is string => line !== null).join("\n"),
    corrected: guard.corrected(),
  };
}

/**
 * Q's earlier words (a recalled summary or reply, an earlier turn of this
 * conversation) that call a figure unknown which a document read for this
 * turn states: each such sentence is labelled as superseded by that read,
 * so what Q said before never outweighs the page in front of it. The
 * earlier words stay as they were said (history); only the label is added.
 */
export function supersededByDocuments(
  text: string,
  documents: readonly ReadDocument[],
): string {
  if (documents.length === 0 || !DENIAL.test(text)) return text;
  return text
    .split("\n")
    .map((line) =>
      line
        .split(SENTENCES)
        .map((sentence) => {
          const stated = deniedButStated(sentence, documents);
          return stated === null
            ? sentence
            : `${sentence} ${statementOf(stated, true)}`;
        })
        .join(" "),
    )
    .join("\n");
}
