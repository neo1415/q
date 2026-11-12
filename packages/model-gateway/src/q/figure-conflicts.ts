import { figuresAgree, measureWords, parseFigure } from "@capital-q/q-research";

import type { QResultBlock } from "@capital-q/contracts";

/**
 * Investigation milestone, gap 2 (audit 12 Nov): a figure the company states
 * and a figure a public page gives for the same measure, when they disagree,
 * are shown side by side as a conflict -- never resolved by choosing one
 * (CLAUDE.md: contradictions coexist until reconciled). Code, not the model:
 * the same figure reading as the research job's cross-check
 * (q-research/domain/cross-check.ts), so no extra model call.
 *
 * Deliberately narrow, so a conflict shown is a real one:
 * - only the company's own or verified figures (USER_CLAIM, ESTIMATE,
 *   VERIFIED), never Q's inference;
 * - only pages the research matched to the subject;
 * - only the same unit (a share is not an amount; currencies never convert);
 * - most of the shorter statement's words shared (the same measure);
 * - the same year when either names one.
 * Authority: the facts are this turn's authorised facts for this viewer and
 * the pages are public; the block quotes nothing the turn could not show.
 */

const COMPARED_TRUTH = new Set(["USER_CLAIM", "ESTIMATE", "VERIFIED"]);
/** Shared words over the shorter statement's words. */
const SAME_MEASURE_CONTAINMENT = 0.6;
const SHARED_WORDS_MIN = 2;
const CONFLICTS_MAX = 3;
const QUOTE_CHARS = 240;

export type ConflictFact = {
  readonly ref?: string | undefined;
  readonly statement: string;
  readonly truthClass: string;
  readonly source?: string | undefined;
  readonly asOf?: string | undefined;
};

export type ConflictPage = {
  readonly domain: string;
  readonly excerpt: string | null | undefined;
  /** MATCH, POSSIBLE or NONE as the research read it. */
  readonly subjectMatch: string | null | undefined;
};

export type FigureConflict = {
  readonly fact: ConflictFact;
  readonly domain: string;
  readonly sentence: string;
};

const years = (text: string): Set<string> =>
  new Set([...text.matchAll(/\b(?:19|20)\d{2}\b/gu)].map((match) => match[0]));

function sameYears(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 && b.size === 0) return true;
  for (const year of a) if (b.has(year)) return true;
  return false;
}

function sameMeasure(a: string, b: string): boolean {
  const wa = measureWords(a);
  const wb = measureWords(b);
  const smaller = Math.min(wa.size, wb.size);
  if (smaller === 0) return false;
  let shared = 0;
  for (const word of wa) if (wb.has(word)) shared += 1;
  return (
    shared >= SHARED_WORDS_MIN && shared / smaller >= SAME_MEASURE_CONTAINMENT
  );
}

const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

/** The disagreements between the company's figures and the pages read. */
export function figureConflicts(input: {
  readonly facts: readonly ConflictFact[];
  readonly pages: readonly ConflictPage[];
}): FigureConflict[] {
  const out: FigureConflict[] = [];
  const seen = new Set<string>();
  for (const fact of input.facts) {
    if (!COMPARED_TRUTH.has(fact.truthClass)) continue;
    const stated = parseFigure(fact.statement);
    if (stated === null) continue;
    const factYears = years(`${fact.statement} ${fact.asOf ?? ""}`);
    for (const page of input.pages) {
      if (page.subjectMatch !== "MATCH") continue;
      for (const sentence of sentencesOf(page.excerpt ?? "")) {
        const found = parseFigure(sentence);
        if (found === null || found.unit !== stated.unit) continue;
        if (figuresAgree(stated, found)) continue;
        if (!sameYears(factYears, years(sentence))) continue;
        if (!sameMeasure(fact.statement, sentence)) continue;
        const key = `${fact.statement}|${page.domain}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ fact, domain: page.domain, sentence });
        if (out.length >= CONFLICTS_MAX) return out;
      }
    }
  }
  return out;
}

const quote = (text: string): string => {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > QUOTE_CHARS
    ? `${flat.slice(0, QUOTE_CHARS - 1).trimEnd()}…`
    : flat;
};

/**
 * Each conflict as an UNCERTAINTY "disagrees" block, in code's own words:
 * both statements with where each comes from, and that it is not settled.
 */
export function figureConflictBlocks(
  conflicts: readonly FigureConflict[],
): QResultBlock[] {
  return conflicts.map((conflict) => ({
    kind: "UNCERTAINTY",
    statement: `Figures disagree, not reconciled: ${
      conflict.fact.source ?? "Capital Q's record"
    } says "${quote(conflict.fact.statement)}"${
      conflict.fact.asOf === undefined ? "" : ` (as of ${conflict.fact.asOf})`
    }; a public page on ${conflict.domain} (not verified) says "${quote(
      conflict.sentence,
    )}".`,
    confidence: "CONFLICTING_EVIDENCE",
    missing: ["A dated, independent source for this figure"],
  }));
}
