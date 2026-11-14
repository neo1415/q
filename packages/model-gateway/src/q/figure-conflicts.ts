import {
  figuresAgree,
  measureWords,
  parseFigure,
  registrableDomain,
} from "@capital-q/q-research";

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

// ---------------------------------------------------------------------------
// Page against page (audit 14 Nov, slice 2; decision 92)
// ---------------------------------------------------------------------------

/**
 * Which fundraising concept a sentence states, so "seeking $5m" and "raised
 * $1m" are never read as the same measure (decision 95). Null: none.
 */
function fundingConcept(sentence: string): string | null {
  if (/\bvalu(?:ed|ation)\b/iu.test(sentence)) {
    return /\bpre[- ]?money\b/iu.test(sentence)
      ? "VALUATION_PRE"
      : /\bpost[- ]?money\b/iu.test(sentence)
        ? "VALUATION_POST"
        : "VALUATION";
  }
  if (
    /\b(?:seek(?:s|ing)?|(?:is|are) raising|looking to raise|aims? to raise|plans? to raise)\b/iu.test(
      sentence,
    )
  ) {
    return "SOUGHT";
  }
  if (/\b(?:commit(?:ted|ments?)|pledged?)\b/iu.test(sentence)) {
    return "COMMITTED";
  }
  if (/\b(?:raised|raises|closed|secured)\b/iu.test(sentence)) {
    return "COMPLETED";
  }
  return null;
}

export type PageFigureConflict = {
  readonly first: { readonly domain: string; readonly sentence: string };
  readonly second: { readonly domain: string; readonly sentence: string };
};

/**
 * Figures two independent publishers give for the same measure, unit, year
 * and fundraising concept that disagree. Both kept; neither chosen; and two
 * pages agreeing is never treated as verification. Code, no model call.
 */
export function pageFigureConflicts(
  pages: readonly ConflictPage[],
): PageFigureConflict[] {
  const matched = pages.filter((page) => page.subjectMatch === "MATCH");
  const out: PageFigureConflict[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < matched.length; i += 1) {
    for (let j = i + 1; j < matched.length; j += 1) {
      const a = matched[i];
      const b = matched[j];
      if (a === undefined || b === undefined) continue;
      // One publisher (or its subdomains) is one report, not two.
      if (registrableDomain(a.domain) === registrableDomain(b.domain)) {
        continue;
      }
      for (const sa of sentencesOf(a.excerpt ?? "")) {
        const fa = parseFigure(sa);
        if (fa === null) continue;
        for (const sb of sentencesOf(b.excerpt ?? "")) {
          const fb = parseFigure(sb);
          if (fb === null || fb.unit !== fa.unit) continue;
          if (figuresAgree(fa, fb)) continue;
          if (fundingConcept(sa) !== fundingConcept(sb)) continue;
          if (!sameYears(years(sa), years(sb))) continue;
          if (!sameMeasure(sa, sb)) continue;
          const key = `${sa}|${sb}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            first: { domain: a.domain, sentence: sa },
            second: { domain: b.domain, sentence: sb },
          });
          if (out.length >= CONFLICTS_MAX) return out;
        }
      }
    }
  }
  return out;
}

/** Each page-versus-page disagreement as an UNCERTAINTY block, in code's words. */
export function pageFigureConflictBlocks(
  conflicts: readonly PageFigureConflict[],
): QResultBlock[] {
  return conflicts.map((conflict) => ({
    kind: "UNCERTAINTY",
    statement: `Public reports disagree, not reconciled: a page on ${
      conflict.first.domain
    } says "${quote(conflict.first.sentence)}"; a page on ${
      conflict.second.domain
    } says "${quote(conflict.second.sentence)}".`,
    confidence: "CONFLICTING_EVIDENCE",
    missing: ["The company's own dated figure, or an independent source"],
  }));
}
