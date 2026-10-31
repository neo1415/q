import { createHash } from "node:crypto";

import {
  QFindingIdSchema,
  Q_ARTIFACT_GAP_MAX,
  Q_ARTIFACT_SECTION_BODY_MAX,
  type QArtifactContent,
  type QArtifactFinding,
} from "@capital-q/contracts";
import { plainMarkdown } from "@capital-q/deck-render";
import {
  clipAtWord,
  type AnalysisCritiqueResult,
  type AnalysisDocumentResult,
} from "@capital-q/q-core";

import {
  PUBLIC_SEARCH_LIMITS,
  type PrimaryKind,
  type SourceTier,
} from "@capital-q/q-research";

import {
  isOwnSiteOf,
  type CapitalQRecord,
  type InvestigationSummary,
  type ResearchDossier,
  type Spend,
} from "./deep-research.js";
import type { PublicSourcesGap } from "./jobs.js";
import { safeReport, type LiveReport } from "./live.js";
import type { Trace, Who, WorkforceModels } from "./models.js";
import {
  namesakeSources,
  publicFactStanding,
  type SubjectIdentity,
} from "./subject-identity.js";

/**
 * An ANALYSIS document (owner 2026-10-23): written from the research
 * steps' admitted facts and the company's own record, critiqued by a
 * second analyst and by code, and revised until it passes -- production
 * 17:47 UTC filed a critique that found contradictions and a missing plan
 * and still delivered the document it criticised.
 *
 * Code's own checks are deterministic and few: a money, percentage or
 * scale figure must carry its basis in the same sentence ([S n], an
 * estimate, the company record or Q's inference), and a cited source must
 * exist. What the request needed is the second analyst's judgement, never
 * a phrase list.
 */

/** How an open reviewer point starts in a document's "not known" list. */
export const REVIEWER_OPEN_POINT = "Reviewer's open point";

/** Drafts at most: the first and two revisions. */
export const ANALYSIS_MAX_DRAFTS = 3;

export type AnalysisSource = {
  readonly index: number;
  readonly url: string;
  readonly domain: string;
  readonly title: string | null;
  readonly publishedAt: string | null;
  /** Investigation (2026-10-29): the publisher's tier, when known. */
  readonly tier?: SourceTier | undefined;
  readonly tierKind?: PrimaryKind | null | undefined;
};

export type AnalysisFact = ResearchDossier["facts"][number];

/** Several research steps' dossiers as one, sources numbered on. */
export function mergeDossiers(dossiers: readonly ResearchDossier[]): {
  readonly sources: readonly AnalysisSource[];
  readonly facts: readonly AnalysisFact[];
  /** A research step's search budget narrowed what it searched. */
  readonly budgetLimited: boolean;
  /** Investigation (2026-10-29): how each step's investigation went. */
  readonly investigations: readonly InvestigationSummary[];
  /** Capital Q records the person may see, kept apart from web facts. */
  readonly records: readonly CapitalQRecord[];
  /** Owner 2026-10-29: each research step's brief, for the writer. */
  readonly briefs: readonly string[];
} {
  const sources: AnalysisSource[] = [];
  const facts: AnalysisFact[] = [];
  const records: CapitalQRecord[] = [];
  let offset = 0;
  let factNumber = 0;
  for (const dossier of dossiers) {
    const top = dossier.sources.reduce(
      (max, source) => Math.max(max, source.index),
      0,
    );
    for (const source of dossier.sources) {
      sources.push({ ...source, index: source.index + offset });
    }
    // A fact's cross-check names others of its own dossier: renumbered
    // with them.
    const renamed = new Map<string, string>();
    dossier.facts.forEach((fact, position) => {
      renamed.set(fact.id, `F${String(factNumber + position + 1)}`);
    });
    const rename = (ids: readonly string[] | undefined) =>
      ids === undefined
        ? undefined
        : ids
            .map((id) => renamed.get(id))
            .filter((id): id is string => id !== undefined);
    for (const fact of dossier.facts) {
      factNumber += 1;
      const corroboratedBy = rename(fact.corroboratedBy);
      const contradicts = rename(fact.contradicts);
      facts.push({
        ...fact,
        id: `F${String(factNumber)}`,
        source: fact.source + offset,
        ...(corroboratedBy === undefined ? {} : { corroboratedBy }),
        ...(contradicts === undefined ? {} : { contradicts }),
      });
    }
    for (const record of dossier.records ?? []) {
      if (!records.some((one) => one.companyId === record.companyId))
        records.push(record);
    }
    offset += top;
  }
  return {
    sources,
    facts,
    budgetLimited: dossiers.some((dossier) => dossier.budgetLimited === true),
    investigations: dossiers.flatMap((dossier) =>
      dossier.investigation === undefined ? [] : [dossier.investigation],
    ),
    records,
    briefs: [
      ...new Set(
        dossiers.flatMap((dossier) =>
          dossier.brief === undefined ? [] : [dossier.brief.writer],
        ),
      ),
    ],
  };
}

/** How a fact's tier, evidence and status read to the writer. */
function factStanding(fact: AnalysisFact): string | null {
  if (fact.tier === undefined && fact.evidenceStatus === undefined) return null;
  const tier =
    fact.tier === "PRIMARY"
      ? fact.tierKind === "COMPANY_DISCLOSURE"
        ? "primary: the company's own claim"
        : "primary: official"
      : fact.tier === "SECONDARY"
        ? "secondary"
        : "other source";
  const evidence =
    fact.evidenceStatus === "MULTI_SOURCE_SUPPORTED"
      ? `several independent sources (with ${(fact.corroboratedBy ?? []).join(", ")})`
      : fact.evidenceStatus === "SELF_REPORTED"
        ? "the company's own claim"
        : "one source";
  const status =
    fact.lifecycleStatus === "CONTRADICTORY"
      ? `CONTRADICTORY: disagrees with ${(fact.contradicts ?? []).join(", ")}`
      : fact.lifecycleStatus === "STALE"
        ? "STALE: out of date for this line of enquiry"
        : "current";
  return `${tier}; ${evidence}; ${status}`;
}

/** Capital Q's own records, as the writer reads them: never web facts. */
export function recordsText(records: readonly CapitalQRecord[]): string {
  if (records.length === 0) return "";
  return [
    "CAPITAL Q RECORDS (companies on Capital Q the person may see; each is the company's own declared profile, not verified and not a recommendation; never cite them as [S n]):",
    ...records.map(
      (record) =>
        `- ${record.name}${record.stage === null ? "" : ` (${record.stage})`}${record.country === null ? "" : `, ${record.country}`}${record.description === null ? "" : `: ${record.description.slice(0, 300)}`}`,
    ),
  ].join("\n");
}

export function researchText(
  facts: readonly AnalysisFact[],
  gap: PublicSourcesGap | null = null,
): string {
  // Production 2026-10-25: the public web could not be searched. The
  // document is written from Capital Q's records and the person's own
  // documents, and what only public sources could tell stays unknown.
  if (facts.length === 0 && gap === "UNAVAILABLE")
    return "PUBLIC SOURCES UNAVAILABLE: the public web could not be searched for this document. Write from Capital Q's records and the person's own documents only. Whatever only public sources could tell (market size, competitors, prices, recent news) is not known: say so where it matters, never estimate or invent it.";
  if (facts.length === 0 && gap === "NONE_FOUND")
    return "NO PUBLIC SOURCES FOUND: the searches found nothing public for this. Write from Capital Q's records and the person's own documents only; what only public sources could tell is not known -- say so, never invent it.";
  if (facts.length === 0)
    return "No public research was available for this document.";
  const lines = facts.map((fact) => {
    const standing = factStanding(fact);
    return `${fact.id} [S${String(fact.source)}] (${fact.lane}, ${fact.kind}${fact.asOf === null ? "" : `, as of ${fact.asOf}`}${standing === null ? "" : `; ${standing}`}) ${fact.statement}`;
  });
  // Investigation (2026-10-29): code cross-checked these facts.
  const investigated = facts.some((fact) => fact.evidenceStatus !== undefined);
  return (
    investigated
      ? [
          "INVESTIGATION: facts from public pages, admitted only when their numbers are on their page, then cross-checked by code (independent publishers, disagreeing figures, dates).",
          ...lines,
        ]
      : lines
  )
    .join("\n")
    .slice(0, 24_000);
}

/** A source's tier, as a report states it. */
export function tierText(source: AnalysisSource): string | null {
  if (source.tier === undefined) return null;
  return source.tier === "PRIMARY"
    ? source.tierKind === "COMPANY_DISCLOSURE"
      ? "primary: the company's own disclosure, its claim"
      : "primary: official source"
    : source.tier === "SECONDARY"
      ? "secondary"
      : "other";
}

/**
 * A source's standing as the filed Sources list states it. The writer's
 * input keeps tierText (recorded research replays read it unchanged); the
 * person reads whose page it is: a namesake's page is named as not about
 * the subject, and another organisation's own site is its claim, never
 * "the company's".
 */
export function filedTierText(
  source: AnalysisSource,
  identity: SubjectIdentity | null,
  namesakes: ReadonlySet<number>,
): string | null {
  if (identity !== null && namesakes.has(source.index))
    return `not about ${identity.name}: a different organisation with a similar name; not used as evidence`;
  if (source.tier === "PRIMARY" && source.tierKind === "COMPANY_DISCLOSURE")
    return identity !== null && isOwnSiteOf(source.domain, identity.name)
      ? `primary: ${identity.name}'s own disclosure, its claim`
      : "primary: the publisher's own disclosure, its claim about itself";
  return tierText(source);
}

export function sourcesText(sources: readonly AnalysisSource[]): string {
  return sources
    .map(
      (source) =>
        `S${String(source.index)} ${source.title ?? "(untitled)"} | ${source.domain}${source.publishedAt === null ? "" : ` | ${source.publishedAt.slice(0, 10)}`}${tierText(source) === null ? "" : ` | ${tierText(source) ?? ""}`}`,
    )
    .join("\n")
    .slice(0, 10_000);
}

/**
 * Live 2026-10-31 (IC memo PDF lead: "…raising £9m (company record,
 * self-reported),…"): text code cut for its stored bound (models.ts prose,
 * an ellipsis at the end) as the person reads it -- back to its last whole
 * sentence when that keeps most of it, else the cut without a dangling
 * comma. Only code's own cut is touched; the model's input is not (the
 * recorded research replays read it unchanged).
 */
export function personProse(text: string): string {
  if (!text.endsWith("…")) return text;
  const room = text.slice(0, -1);
  let end = -1;
  for (const match of room.matchAll(/[.!?](?=\s|$)/gu)) {
    end = match.index + 1;
  }
  if (end >= room.length * 0.4) return room.slice(0, end).trimEnd();
  return `${room.replace(/[\s,;:\-–—]+$/u, "")}…`;
}

/**
 * Text within `max`, ending where a sentence does: whole when it fits,
 * else its whole sentences that fit. Only text with no sentence end in
 * reach is cut at a word.
 */
export function wholeSentences(text: string, max: number): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  if (clean.length <= max) return clean;
  const room = clean.slice(0, max);
  let end = -1;
  for (const match of room.matchAll(/[.!?]["”’)]?(?=\s|$)/gu)) {
    end = match.index + match[0].length;
  }
  return end > 0 ? room.slice(0, end) : clipAtWord(clean, max);
}

/**
 * A review's open point as filed in the document's gaps, for the person:
 * words, never the memo's own markdown it quotes (live 2026-10-31: a
 * quoted "- **Cheque and role:** …"), and in full. Live 2026-10-31 (IC
 * memo PDF, page 13): cut at 300 characters, a point ended "…the
 * implications of the stated…". A gap now holds a whole point (a section
 * of at most 120 and a problem of at most 400, schemas/analyst.ts), and
 * anything longer keeps its whole sentences.
 */
export function reviewOpenPoint(
  issue: Pick<AnalysisIssue, "section" | "problem">,
): string {
  return wholeSentences(
    `${REVIEWER_OPEN_POINT} (${plainMarkdown(issue.section)}): ${readersWords(plainMarkdown(issue.problem))}`,
    Q_ARTIFACT_GAP_MAX,
  );
}

/** The document as the critic reads it. */
export function analysisText(draft: AnalysisDocumentResult): string {
  return [
    `# ${draft.title}`,
    draft.summary,
    ...draft.sections.map(
      (section) => `## ${section.heading}\n${section.body}`,
    ),
    `## Top recommendations\n${draft.topRecommendations.map((one, index) => `${String(index + 1)}. ${one}`).join("\n")}`,
    draft.gaps.length === 0
      ? ""
      : `## Not known\n${draft.gaps.map((gap) => `- ${gap}`).join("\n")}`,
  ]
    .filter((part) => part.length > 0)
    .join("\n\n")
    .slice(0, 60_000);
}

export type AnalysisIssue = AnalysisCritiqueResult["issues"][number];

/**
 * A figure that needs a basis: money, a percentage, or a scale word. Years,
 * quarters, counts of months and list numbers are not figures.
 */
const FIGURE =
  /(?:[$£€]\s?\d[\d,.]*|\b(?:USD|KES|KSh|EUR|GBP|NGN|ZAR)\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:%|per ?cent\b|percent\b|[mb]n?\b|million\b|billion\b|thousand\b|k\b))/iu;
const BASIS =
  /\[S\d{1,3}\]|\(estimate|\bestimate[sd]?\b|\(company record|\(Q's inference|Q's inference|\bnot known\b|\bunknown\b/iu;
const CITED = /\[S(\d{1,3})\]/gu;

function sentencesOf(text: string): readonly string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

const ANY_CITATION = /\[S\d{1,3}/u;

/**
 * The clauses of a sentence: its ";"-joined parts and a table row's cells.
 * Re-recorded case A: "B2B solutions include ... [S42]; LedgerBridge is
 * recorded as ... (Capital Q record)." keeps the two apart correctly, yet
 * a whole-sentence check sent it back twice.
 */
function clausesOf(sentence: string): readonly string[] {
  return sentence
    .split(/;\s+|\s\|\s|^\||\|$/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

const RECORD_MARK = /\(Capital Q record\)/iu;

const RECORD_CITED_PROBLEM = "A Capital Q record is cited as a web source";

/** A record's name, as a whole word (it comes from code's own records). */
function recordPatterns(recordNames: readonly string[]): readonly RegExp[] {
  return recordNames
    .map((name) => name.trim())
    .filter((name) => name.length >= 3)
    .map(
      (name) =>
        new RegExp(
          `(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\p{L}\\p{N}])`,
          "iu",
        ),
    );
}

/** Whether a clause names a record and cites [S n], unmarked. */
const mixes = (clause: string, named: readonly RegExp[]) =>
  ANY_CITATION.test(clause) &&
  !RECORD_MARK.test(clause) &&
  named.some((pattern) => pattern.test(clause));

/** The sentences of `text` with a clause that mixes a record and [S n]. */
function mixedSentences(
  text: string,
  named: readonly RegExp[],
): readonly string[] {
  return sentencesOf(text).filter((sentence) =>
    clausesOf(sentence).some((clause) => mixes(clause, named)),
  );
}

/** A draft's filed parts, as recordsCitedAsWeb reads them. */
function filedParts(draft: AnalysisDocumentResult) {
  return [
    { heading: "Summary", body: draft.summary },
    ...draft.sections,
    { heading: "Gaps", body: draft.gaps.join("\n") },
    {
      heading: "Top recommendations",
      body: draft.topRecommendations.join("\n"),
    },
  ];
}

/**
 * Live case A (2026-10-29): sentences about a Capital Q record carried web
 * citations ("Their reported pricing [S22] increases the burden on
 * LedgerBridge"), so the record read as web-sourced. A record's name comes
 * from code's own records, never from anyone's words: a sentence naming
 * one and citing [S n] is sent back to be split.
 */
export function recordsCitedAsWeb(
  draft: AnalysisDocumentResult,
  recordNames: readonly string[],
): readonly AnalysisIssue[] {
  const named = recordPatterns(recordNames);
  if (named.length === 0) return [];
  const issues: AnalysisIssue[] = [];
  for (const section of filedParts(draft)) {
    // The record's own claim carries no web citation: a clause naming it
    // and citing [S n], unless marked as the record.
    const mixed = sentencesOf(section.body)
      .flatMap((sentence) => clausesOf(sentence))
      .filter((clause) => mixes(clause, named));
    if (mixed.length === 0) continue;
    issues.push({
      kind: "UNSUPPORTED",
      section: section.heading.slice(0, 120),
      // The quote without its citations: the point is filed in the
      // report's gaps when the last draft still has it.
      // Model input only (the redraft reads it; what the person reads is
      // cut at a word in analysisContent). Unchanged so recorded research
      // replays stay identical.
      problem:
        `${RECORD_CITED_PROBLEM}: "${withoutCitations(mixed[0] ?? "").slice(0, 200)}"`.slice(
          0,
          400,
        ),
      fix: "Keep Capital Q records apart from web evidence: the sentence naming the record cites no [S n] and is marked (Capital Q record); put the web evidence in its own sentence.",
    });
  }
  return issues;
}

const CITATION_MARK = /\s*\[S\d{1,3}(?:\s*[,;]\s*S?\d{1,3})*\]/gu;
const withoutCitations = (text: string) =>
  text.replace(CITATION_MARK, "").replace(/\s+([.,;:])/gu, "$1");

/**
 * The filed draft keeps Capital Q records apart, whatever the rewrites
 * did (live case F, 2026-10-29: the last of three drafts still cited [S38]
 * in a sentence naming LedgerBridge, and the report was filed with it,
 * the reviewer's open point quoting it a second time). A sentence that
 * still mixes a record with a web citation is removed -- its web figure
 * cannot keep a citation it shares with the record, nor stand without
 * one -- and the person is told; the open points no longer quote it.
 */
export function keepRecordsApart(
  draft: AnalysisDocumentResult,
  open: readonly AnalysisIssue[],
  recordNames: readonly string[],
): {
  readonly draft: AnalysisDocumentResult;
  readonly open: readonly AnalysisIssue[];
  readonly removed: number;
} {
  const named = recordPatterns(recordNames);
  if (named.length === 0) return { draft, open, removed: 0 };
  let removed = 0;
  const clean = (text: string) => {
    const mixed = mixedSentences(text, named);
    if (mixed.length === 0) return text;
    removed += mixed.length;
    let out = text;
    for (const sentence of mixed) out = out.replace(sentence, "");
    return out
      .split("\n")
      .map((line) => line.replace(/[ \t]{2,}/gu, " ").trimEnd())
      .filter((line) => !/^\s*(?:[-*\u2022]|\d+[.)])?\s*$/u.test(line))
      .join("\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim();
  };
  const list = (items: readonly string[]) =>
    items.map(clean).filter((item) => item.length > 0);
  const next: AnalysisDocumentResult = {
    ...draft,
    summary: clean(draft.summary),
    sections: draft.sections.map((section) => ({
      ...section,
      body: clean(section.body),
    })),
    topRecommendations: list(draft.topRecommendations),
    gaps: list(draft.gaps),
  };
  const quoteSafe = (text: string) =>
    sentencesOf(text).some((sentence) =>
      clausesOf(sentence).some((clause) => mixes(clause, named)),
    )
      ? withoutCitations(text)
      : text;
  return {
    draft:
      removed === 0
        ? next
        : {
            ...next,
            gaps: [
              ...next.gaps,
              `Q removed ${String(removed)} sentence${removed === 1 ? "" : "s"} that cited public sources for a Capital Q record; what Capital Q records say is kept apart from web evidence.`,
            ],
          },
    open: open
      .filter((issue) => !issue.problem.startsWith(RECORD_CITED_PROBLEM))
      .map((issue) => ({
        ...issue,
        problem: quoteSafe(issue.problem),
        fix: quoteSafe(issue.fix),
      })),
    removed,
  };
}

const CITATION_GROUP = /\[S\d{1,3}(?:\s*[,;]\s*S?\d{1,3})*\]/gu;
const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/u;

/** The [S n] numbers one citation mark names ("[S4]", "[S4, S9]"). */
const markNumbers = (mark: string) =>
  [...mark.matchAll(/\d{1,3}/gu)].map((match) => Number(match[0]));

/**
 * Live 2026-10-31 (IC memo on "Karoo Gridworks"): the Sources list said
 * [S15] was "not about Karoo Gridworks ... not used as evidence", yet the
 * Competition table and Risks cited it, and [S4]/[S9] (Gridworks, a
 * different investor) filled a competitor row. A page judged by code to be
 * about a namesake (subject-identity.ts) is not cited in the filed
 * document: a sentence, or table row, that cites only such pages is
 * removed; one that also cites other pages keeps those citations only.
 *
 * Removed after the writing loop, never sent back to be redrafted: this
 * runs on code's decision alone, after the last model call, so no model's
 * input changes (the recorded research replays rest on those inputs), and
 * it holds for the last draft too, which a redraft could not promise.
 */
export function withoutCitationsOf(
  text: string,
  namesakes: ReadonlySet<number>,
): {
  readonly text: string;
  readonly removed: number;
  readonly cut: ReadonlySet<number>;
} {
  const cut = new Set<number>();
  if (namesakes.size === 0 || !ANY_CITATION.test(text))
    return { text, removed: 0, cut };
  let removed = 0;
  const unit = (part: string): string | null => {
    const numbers = [...part.matchAll(CITATION_GROUP)].flatMap((match) =>
      markNumbers(match[0]),
    );
    const theirs = numbers.filter((number) => namesakes.has(number));
    if (theirs.length === 0) return part;
    for (const number of theirs) cut.add(number);
    if (theirs.length === numbers.length) {
      removed += 1;
      return null;
    }
    return part
      .replace(CITATION_GROUP, (mark) => {
        const kept = markNumbers(mark).filter(
          (number) => !namesakes.has(number),
        );
        return kept.length === 0
          ? ""
          : `[${kept.map((number) => `S${String(number)}`).join(", ")}]`;
      })
      .replace(/\s+([.,;:])/gu, "$1");
  };
  const lines = text.split("\n").flatMap((line) => {
    if (!ANY_CITATION.test(line)) return [line];
    // A table row is one unit: its cells are not sentences.
    if (/^\s*\|/u.test(line)) {
      const kept = unit(line);
      return kept === null ? [] : [kept];
    }
    const marker = LIST_MARKER.exec(line)?.[0] ?? "";
    const kept = line
      .slice(marker.length)
      .split(/(?<=[.!?])\s+/u)
      .map(unit)
      .filter(
        (part): part is string => part !== null && part.trim().length > 0,
      );
    return kept.length === 0 ? [] : [`${marker}${kept.join(" ")}`];
  });
  return { text: lines.join("\n"), removed, cut };
}

/** The same removal, named for the namesake pages it was written for. */
export const withoutNamesakeCitations = withoutCitationsOf;

/** How basisProblems names a citation of a source that does not exist. */
const NOT_A_SOURCE = "Cites sources that do not exist";

/** Code's own checks: figures without a basis, sources that do not exist. */
export function basisProblems(
  draft: AnalysisDocumentResult,
  sourceIndices: ReadonlySet<number>,
  /** Capital Q records' company names: never in a sentence citing [S n]. */
  recordNames: readonly string[] = [],
): readonly AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  issues.push(...recordsCitedAsWeb(draft, recordNames));
  for (const section of [
    { heading: "Summary", body: draft.summary },
    ...draft.sections,
  ]) {
    const unlabelled = sentencesOf(section.body).filter(
      (sentence) => FIGURE.test(sentence) && !BASIS.test(sentence),
    );
    if (unlabelled.length > 0) {
      issues.push({
        kind: "UNSUPPORTED",
        section: section.heading.slice(0, 120),
        // Model input only; see recordsCitedAsWeb.
        problem:
          `${String(unlabelled.length)} figure${unlabelled.length === 1 ? "" : "s"} without a basis, e.g. "${(unlabelled[0] ?? "").slice(0, 200)}"`.slice(
            0,
            400,
          ),
        fix: "Give each figure its basis in the same sentence: [S n] for a source, (estimate: ...) with the assumptions, (company record), or (Q's inference); or remove it.",
      });
    }
    const missing = [...section.body.matchAll(CITED)]
      .map((match) => Number(match[1]))
      .filter((index) => !sourceIndices.has(index));
    if (missing.length > 0) {
      issues.push({
        kind: "UNSUPPORTED",
        section: section.heading.slice(0, 120),
        problem: `${NOT_A_SOURCE}: ${[...new Set(missing)]
          .map((index) => `S${String(index)}`)
          .join(", ")}.`.slice(0, 400),
        fix: "Cite only the numbered sources given, or label the figure as an estimate or Q's inference.",
      });
    }
  }
  // The gaps and recommendations are filed too: they cite only real
  // sources (re-recorded case A, 2026-10-29: [S47] and [S55] reached the
  // report with 41 sources).
  for (const part of [
    { heading: "Gaps", text: draft.gaps.join("\n") },
    {
      heading: "Top recommendations",
      text: draft.topRecommendations.join("\n"),
    },
  ]) {
    const missing = unknownCitations(part.text, sourceIndices);
    if (missing.length > 0)
      issues.push({
        kind: "UNSUPPORTED",
        section: part.heading,
        problem: `${NOT_A_SOURCE}: ${missing
          .map((index) => `S${String(index)}`)
          .join(", ")}.`.slice(0, 400),
        fix: "Cite only the numbered sources given, or label the point as an estimate or Q's inference.",
      });
  }
  return issues.slice(0, 10);
}

/** The [S n] in `text` that name no source in the list. */
export function unknownCitations(
  text: string,
  sourceIndices: ReadonlySet<number>,
): readonly number[] {
  return [
    ...new Set(
      [...text.matchAll(CITED)]
        .map((match) => Number(match[1]))
        .filter((index) => !sourceIndices.has(index)),
    ),
  ];
}

/**
 * The reviewer's findings that rest on sources that exist. A finding
 * citing an [S n] not in the list is not evidence of anything (re-recorded
 * case A, 2026-10-29: the reviewer read fact numbers F47 and F55 as
 * sources [S47] and [S55], told the writer a correct citation was wrong,
 * and the point was filed in the report's gaps citing sources that do not
 * exist). It is neither sent to the writer nor filed.
 */
export function foundedIssues(
  issues: readonly AnalysisIssue[],
  sourceIndices: ReadonlySet<number>,
): readonly AnalysisIssue[] {
  return issues.filter(
    (issue) =>
      unknownCitations(
        `${issue.section} ${issue.problem} ${issue.fix}`,
        sourceIndices,
      ).length === 0,
  );
}

export type AnalysisReview = {
  readonly passes: boolean;
  readonly score: number | null;
  /** Drafts written (1 = no revision was needed). */
  readonly drafts: number;
  /** Every issue found across the rounds, in the order found. */
  readonly found: readonly AnalysisIssue[];
  /** Issues still open on the filed draft. */
  readonly open: readonly AnalysisIssue[];
};

export type AnalysisInputs = {
  readonly principalName: string;
  readonly request: string;
  readonly purpose: string;
  readonly today: string;
  readonly company: string;
  readonly research: string;
  readonly sources: string;
  readonly sourceIndices: ReadonlySet<number>;
  /** Capital Q records' names, kept out of sentences citing [S n]. */
  readonly recordNames?: readonly string[] | undefined;
};

const WRITE_CEILING_USD = 0.45;
const CRITIQUE_CEILING_USD = 0.1;

/**
 * Write, critique (the second analyst and code), revise from the findings,
 * until a draft passes or the drafts, the budget or the continuation run
 * out. Null: not even a first draft could be written.
 */
/**
 * The writer's own name for its inputs is not the reader's: live
 * 2026-10-30 an investor's report summary said "the supplied evidence
 * does not establish ...", Capital Q's internal framing of what the
 * writer was handed. ANALYSIS_WRITE never says "supplied" (it says "the
 * evidence below"); the model coins it. Said as "the evidence" here,
 * after the last model call of the loop, so no prompt -- and no recorded
 * research case, whose hashes rest on these prompts -- changes. A later
 * ANALYSIS_WRITE version can ask for it directly when the cases are
 * re-recorded.
 */
const SUPPLIED_NOUN =
  "(?=(?:evidence|research|records?|sources?|facts?|material|primary)\\b)";
const SUPPLIED_AFTER = new RegExp(
  `\\b(from|in|by|on|with|of|under|beyond) supplied ${SUPPLIED_NOUN}`,
  "giu",
);
const SUPPLIED_ANY = new RegExp(
  `\\b([Ss])upplied ${SUPPLIED_NOUN}(\\p{L})`,
  "gu",
);

export function readersWords(text: string): string {
  if (!text.includes("upplied")) return text;
  return text
    .replace(SUPPLIED_AFTER, "$1 the ")
    .replace(SUPPLIED_ANY, (_whole, s: string, first: string) =>
      s === "S" ? first.toUpperCase() : first,
    );
}

/** The draft in the reader's words (readersWords), every part of it. */
export function readersDraft(
  draft: AnalysisDocumentResult,
): AnalysisDocumentResult {
  return {
    ...draft,
    title: readersWords(draft.title),
    summary: readersWords(draft.summary),
    sections: draft.sections.map((section) => ({
      ...section,
      heading: readersWords(section.heading),
      body: readersWords(section.body),
    })),
    topRecommendations: draft.topRecommendations.map(readersWords),
    gaps: draft.gaps.map(readersWords),
  };
}

export async function writeAnalysisWithReview(dependencies: {
  readonly models: Pick<WorkforceModels, "writeAnalysis" | "critiqueAnalysis">;
  readonly who: Who;
  readonly trace: Trace;
  readonly spend: Spend;
  readonly canContinue: () => Promise<boolean>;
  readonly inputs: AnalysisInputs;
  /** Where the writing stands, for the person watching (never awaited). */
  readonly progress?: LiveReport | undefined;
}): Promise<{
  readonly draft: AnalysisDocumentResult;
  readonly review: AnalysisReview;
} | null> {
  const { models, who, trace, spend, inputs } = dependencies;
  const report = safeReport(dependencies.progress);
  let draft: AnalysisDocumentResult | null = null;
  let revision = "";
  const found: AnalysisIssue[] = [];
  let open: readonly AnalysisIssue[] = [];
  let passes = false;
  let score: number | null = null;
  let drafts = 0;
  while (drafts < ANALYSIS_MAX_DRAFTS) {
    if (!spend.canAfford(WRITE_CEILING_USD) && draft !== null) break;
    if (!(await dependencies.canContinue())) break;
    report(
      draft === null
        ? { stage: "DRAFTING", draft: 1, drafts: ANALYSIS_MAX_DRAFTS }
        : {
            stage: "REVISING",
            draft: drafts + 1,
            drafts: ANALYSIS_MAX_DRAFTS,
            openPoints: open.length,
          },
    );
    const written = await models.writeAnalysis(who, trace, {
      principalName: inputs.principalName.slice(0, 120),
      request: inputs.request.slice(0, 4_000),
      purpose: inputs.purpose.slice(0, 600),
      today: inputs.today,
      company: inputs.company.slice(0, 12_000),
      research: inputs.research.slice(0, 24_000),
      sources: inputs.sources.slice(0, 10_000),
      revision: revision.slice(0, 40_000),
    });
    spend.charge(written?.costUsd ?? null, WRITE_CEILING_USD);
    if (written === null) break;
    draft = written.output;
    drafts += 1;
    report({
      stage: "REVIEWING",
      draft: drafts,
      drafts: ANALYSIS_MAX_DRAFTS,
      openPoints: null,
      title: draft.title.slice(0, 160),
      sections: draft.sections
        .slice(0, 16)
        .map((section) => section.heading.slice(0, 120)),
    });
    // Code's checks first: they are certain, and cost nothing.
    const coded = basisProblems(
      draft,
      inputs.sourceIndices,
      inputs.recordNames ?? [],
    );
    let verdict: AnalysisCritiqueResult | null = null;
    if (
      spend.canAfford(CRITIQUE_CEILING_USD) &&
      (await dependencies.canContinue())
    ) {
      const critique = await models.critiqueAnalysis(who, trace, {
        principalName: inputs.principalName.slice(0, 120),
        request: inputs.request.slice(0, 4_000),
        company: inputs.company.slice(0, 12_000),
        research: inputs.research.slice(0, 24_000),
        document: analysisText(draft),
      });
      spend.charge(critique?.costUsd ?? null, CRITIQUE_CEILING_USD);
      verdict = critique?.output ?? null;
    }
    const issues = [
      ...foundedIssues(verdict?.issues ?? [], inputs.sourceIndices),
      ...coded,
    ].slice(0, 12);
    found.push(...issues);
    open = issues;
    score = verdict?.score ?? null;
    // A draft no reviewer could read has not passed a review.
    passes = verdict !== null && verdict.passes && coded.length === 0;
    if (passes) break;
    revision = [
      "THE SECOND ANALYST'S FINDINGS ON YOUR LAST DRAFT (fix every one):",
      ...issues.map(
        (issue, index) =>
          `${String(index + 1)}. [${issue.kind}] ${issue.section}: ${issue.problem} Fix: ${issue.fix}`,
      ),
      "",
      "YOUR LAST DRAFT:",
      analysisText(draft),
    ].join("\n");
  }
  if (draft === null) return null;
  const apart = keepRecordsApart(
    readersDraft(draft),
    open,
    inputs.recordNames ?? [],
  );
  report({ stage: "FILING", openPoints: passes ? 0 : apart.open.length });
  return {
    draft: apart.draft,
    review: { passes, score, drafts, found, open: passes ? [] : apart.open },
  };
}

function findingIdFor(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return QFindingIdSchema.parse(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
  );
}

/**
 * The sourced facts a section cites, as findings with their truth axes.
 * A namesake's page is never a finding about the subject, and only the
 * subject's own site is its claim (subject-identity.ts, live 2026-10-31).
 */
function findingsFor(
  body: string,
  facts: readonly AnalysisFact[],
  seed: string,
  identity: SubjectIdentity | null,
  namesakes: ReadonlySet<number>,
): readonly QArtifactFinding[] {
  const cited = new Set(
    [...body.matchAll(CITED)].map((match) => Number(match[1])),
  );
  return facts
    .filter((fact) => cited.has(fact.source) && !namesakes.has(fact.source))
    .slice(0, 12)
    .map((fact) => ({
      findingId: findingIdFor(`${seed}:${fact.id}:${fact.url}`),
      type: "FACT" as const,
      statement:
        `${fact.statement} (${fact.domain}${fact.asOf === null ? "" : `, ${fact.asOf}`}) [S${String(fact.source)}]`.slice(
          0,
          2_000,
        ),
      // Never verified by Capital Q. Code's cross-check decided the
      // support and status; whose page it is decides the truth class.
      ...publicFactStanding(fact, identity),
      evidenceRefs: [],
      subjects: [],
    }));
}

/** Text over a section's limit, as several sections ("(continued)"). */
export function splitSection(
  heading: string,
  body: string,
): readonly { heading: string; body: string }[] {
  const parts: { heading: string; body: string }[] = [];
  let rest = body;
  while (rest.length > 0) {
    let cut = rest.length;
    if (cut > Q_ARTIFACT_SECTION_BODY_MAX) {
      const at = rest.lastIndexOf("\n", Q_ARTIFACT_SECTION_BODY_MAX);
      cut =
        at > Q_ARTIFACT_SECTION_BODY_MAX / 2 ? at : Q_ARTIFACT_SECTION_BODY_MAX;
    }
    parts.push({
      heading: parts.length === 0 ? heading : `${heading} (continued)`,
      body: rest.slice(0, cut).trim(),
    });
    rest = rest.slice(cut).trim();
  }
  return parts;
}

/**
 * The filed document: the writer's sections (each with the sourced facts
 * it cites as findings), then the sources it cites, numbered as cited,
 * then what is not known. Code writes the Sources section, never a model.
 */
export const PUBLIC_UNAVAILABLE_GAP =
  "Public sources were unavailable when this was prepared: nothing here comes from the public web, and what only public sources could tell (market size, competitors, prices, recent news) is not known.";
export const PUBLIC_NONE_FOUND_GAP =
  "No public sources were found for this: nothing here comes from the public web, and what only public sources could tell is not known.";

export function analysisContent(input: {
  readonly draft: AnalysisDocumentResult;
  readonly review: AnalysisReview;
  readonly sources: readonly AnalysisSource[];
  readonly facts: readonly AnalysisFact[];
  readonly seed: string;
  /** The public research it rests on could not be had: stated by code. */
  readonly publicSources?: PublicSourcesGap | null | undefined;
  /** Text code adds that cites sources (Claims vs evidence): listed too. */
  readonly alsoCites?: readonly string[] | undefined;
  /** Gaps code states (a search budget, a data room not open to them). */
  readonly codeGaps?: readonly string[] | undefined;
  /** A Sources section even when nothing is cited (a diligence memo's fixed shape). */
  readonly sourcesAlways?: boolean | undefined;
  /**
   * Investigation (2026-10-29): sections code writes from its cross-check
   * (Contradictions, What public sources cannot establish), before Sources.
   */
  readonly codeSections?:
    readonly { readonly heading: string; readonly body: string }[] | undefined;
  /**
   * The one company the document is about (diligence, a named or own
   * company's analysis); null or absent: a market or general question.
   */
  readonly subject?: SubjectIdentity | null | undefined;
}): QArtifactContent {
  const { review } = input;
  const identity = input.subject ?? null;
  const namesakes = namesakeSources(input.facts, identity);
  // A namesake's page is not cited as evidence (withoutNamesakeCitations).
  let namesakeRemoved = 0;
  const namesakeCut = new Set<number>();
  const apart = (text: string) => {
    const out = withoutNamesakeCitations(text, namesakes);
    namesakeRemoved += out.removed;
    for (const index of out.cut) namesakeCut.add(index);
    return out.text;
  };
  // A citation of a source the document does not list (live 2026-10-31,
  // the Nixo memo cited [S57] with no S57 in its Sources, and its own
  // review said so): removed the same way, after the last model call. A
  // statement resting only on it goes; another source beside it stays.
  const known = new Set(input.sources.map((source) => source.index));
  const unlisted = new Set(
    [
      input.draft.summary,
      ...input.draft.sections.map((section) => section.body),
      ...input.draft.gaps,
    ].flatMap((text) =>
      [...text.matchAll(CITATION_GROUP)]
        .flatMap((mark) => markNumbers(mark[0]))
        .filter((index) => !known.has(index)),
    ),
  );
  let unlistedRemoved = 0;
  const listedOnly = (text: string) => {
    const out = withoutCitationsOf(text, unlisted);
    unlistedRemoved += out.removed;
    return out.text;
  };
  const clean = (text: string) => listedOnly(apart(text));
  const draft: AnalysisDocumentResult = {
    ...input.draft,
    summary: clean(input.draft.summary),
    sections: input.draft.sections
      .map((section) => ({ ...section, body: clean(section.body) }))
      .filter((section) => section.body.trim().length > 0),
    gaps: input.draft.gaps.map(clean).filter((gap) => gap.trim().length > 0),
  };
  const openPoints = review.open
    // Code removed every such citation above: the point no longer holds.
    .filter(
      (issue) => unlisted.size === 0 || !issue.problem.startsWith(NOT_A_SOURCE),
    )
    .map(reviewOpenPoint)
    .map(apart)
    .filter((point) => point.trim().length > 0);
  const unlistedGap =
    unlisted.size === 0
      ? []
      : [
          wholeSentences(
            `Q removed citations of ${[...unlisted]
              .sort((a, b) => a - b)
              .map((index) => `S${String(index)}`)
              .join(
                ", ",
              )}, which ${unlisted.size === 1 ? "is" : "are"} not among this document's sources${unlistedRemoved === 0 ? "" : `, and ${String(unlistedRemoved)} statement${unlistedRemoved === 1 ? "" : "s"} that rested only on ${unlisted.size === 1 ? "it" : "them"}`}; what ${unlisted.size === 1 ? "it was" : "they were"} cited for has no source here.`,
            Q_ARTIFACT_GAP_MAX,
          ),
        ];
  const namesakeGap =
    identity === null || namesakeCut.size === 0
      ? []
      : [
          wholeSentences(
            `Q removed ${namesakeRemoved === 0 ? "the citations" : `${String(namesakeRemoved)} statement${namesakeRemoved === 1 ? "" : "s"}`} that rested on pages about a different organisation named like ${identity.name} (${[
              ...namesakeCut,
            ]
              .sort((a, b) => a - b)
              .map((index) => `S${String(index)}`)
              .join(", ")}); they are not evidence about ${identity.name}.`,
            Q_ARTIFACT_GAP_MAX,
          ),
        ];
  const sections = draft.sections.map((section, index) => ({
    heading: section.heading,
    body: section.body,
    findings: [
      ...findingsFor(
        section.body,
        input.facts,
        `${input.seed}:${String(index)}`,
        identity,
        namesakes,
      ),
    ],
  }));
  const cited = new Set(
    [
      draft.summary,
      ...draft.sections.map((section) => section.body),
      ...(input.alsoCites ?? []),
      ...(input.codeSections ?? []).map((section) => section.body),
    ].flatMap((body) =>
      [...body.matchAll(CITED)].map((match) => Number(match[1])),
    ),
  );
  // A namesake page the writer cited stays listed, named as not used.
  const listed = input.sources.filter(
    (source) => cited.has(source.index) || namesakeCut.has(source.index),
  );
  const sourceLines = listed.map((source) => {
    const standing = filedTierText(source, identity, namesakes);
    return `[S${String(source.index)}] ${source.title ?? source.domain} — ${source.domain}${source.publishedAt === null ? "" : `, published ${source.publishedAt.slice(0, 10)}`}${standing === null ? "" : ` (${standing})`}. ${source.url}`;
  });
  const sourceSections =
    sourceLines.length === 0
      ? input.sourcesAlways === true
        ? [
            {
              heading: "Sources",
              body: "No public source is cited in this document.",
            },
          ]
        : []
      : splitSection(
          "Sources",
          `Public sources this document cites. A source states what it states; Capital Q has not verified it.\n${sourceLines.join("\n")}`,
        );
  const gaps = [
    // Stated by code, never left to the writer (2026-10-25).
    ...(input.publicSources === "UNAVAILABLE"
      ? [PUBLIC_UNAVAILABLE_GAP]
      : input.publicSources === "NONE_FOUND"
        ? [PUBLIC_NONE_FOUND_GAP]
        : []),
    // Cut at a word, never mid-word (live 2026-10-30, deep research:
    // "risks soundin", "contracts with cust"), and at a sentence's end
    // when one is in reach (live 2026-10-31, a dangling clause).
    ...(input.codeGaps ?? []).map((gap) =>
      wholeSentences(gap, Q_ARTIFACT_GAP_MAX),
    ),
    ...namesakeGap,
    ...unlistedGap,
    ...draft.gaps,
    // Honest when the review did not pass: its open points are named.
    ...openPoints,
  ].slice(0, 24);
  return {
    sections: [
      ...sections.flatMap((section) =>
        splitSection(section.heading, section.body).map((part, index) => ({
          heading: part.heading.slice(0, 160),
          body: part.body,
          findings: index === 0 ? section.findings : [],
        })),
      ),
      ...(input.codeSections ?? []).flatMap((section) =>
        splitSection(section.heading, section.body).map((part) => ({
          heading: part.heading.slice(0, 160),
          body: part.body,
          findings: [],
        })),
      ),
      ...sourceSections.map((part) => ({
        heading: part.heading,
        body: part.body,
        findings: [],
      })),
    ].slice(0, 24),
    gaps,
  };
}

/**
 * Investigation (2026-10-29): the sections code writes from its own
 * cross-check, never a model -- every contradiction with both sides and
 * their sources, and what public search cannot establish, with the lines
 * of enquiry no search could run named.
 */
export function investigationSections(input: {
  readonly facts: readonly AnalysisFact[];
  readonly investigations: readonly InvestigationSummary[];
}): readonly { readonly heading: string; readonly body: string }[] {
  if (input.investigations.length === 0) return [];
  const byId = new Map(input.facts.map((fact) => [fact.id, fact]));
  const side = (fact: AnalysisFact) =>
    `[S${String(fact.source)}] ${fact.domain}${fact.asOf === null ? "" : ` (${fact.asOf})`}: "${fact.statement}"`;
  const pairs: string[] = [];
  const seen = new Set<string>();
  for (const fact of input.facts) {
    for (const other of fact.contradicts ?? []) {
      const partner = byId.get(other);
      if (partner === undefined) continue;
      const key = [fact.id, partner.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const about =
        fact.measure != null && fact.entity != null
          ? `${fact.entity}, ${fact.measure}`
          : fact.lane;
      pairs.push(
        `- ${about}: ${side(fact)} -- against ${side(partner)}. Not reconciled: both stand until a primary source settles it.`,
      );
    }
  }
  const contradictions =
    pairs.length === 0
      ? "Code compared every pair of figures about the same measure and period across the sources; none disagreed. Figures for different periods or in different units are not compared."
      : [
          "Sources that disagree, as code found them when it compared figures about the same measure and period. Neither side is chosen.",
          ...pairs,
        ].join("\n");
  const couldNotRun = [
    ...new Set(input.investigations.flatMap((one) => one.couldNotRun)),
  ];
  const stale = input.facts.filter(
    (fact) => fact.lifecycleStatus === "STALE",
  ).length;
  // Owner 2026-10-29: the market covered, and from what context (or that
  // it is global because no place was named), in code's words.
  const scopes = [
    ...new Set(
      input.investigations.flatMap((one) =>
        one.scope === undefined ? [] : [one.scope],
      ),
    ),
  ];
  const limits = [
    ...scopes,
    "Public search reaches what is published. It cannot establish:",
    ...PUBLIC_SEARCH_LIMITS.map((line) => `- ${line}`),
    ...(couldNotRun.length === 0
      ? []
      : [
          `- Lines of enquiry no search could run (the search providers did not answer): ${couldNotRun.join(", ")}. Nothing is said about them.`,
        ]),
    ...(stale === 0
      ? []
      : [
          `- ${String(stale)} fact${stale === 1 ? " is" : "s are"} older than their line of enquiry's horizon (marked out of date); newer figures may exist that were not found.`,
        ]),
  ].join("\n");
  return [
    { heading: "Contradictions", body: contradictions },
    { heading: "What public sources cannot establish", body: limits },
  ];
}

/** What stayed open when the investigation stopped, for "not known". */
/** What the writer is told when the research under it ran reduced. */
export function reducedResearchText(reduced: string): string {
  return `RESEARCH RAN REDUCED (code's finding; say so plainly in the summary, and never present this as a full investigation): ${reduced}`;
}

export function investigationGaps(
  investigations: readonly InvestigationSummary[],
): readonly string[] {
  return [
    ...new Set([
      // First: an investigation that ran reduced says so before anything.
      ...investigations.flatMap((one) =>
        one.reduced === undefined ? [] : [one.reduced],
      ),
      ...investigations.flatMap((one) =>
        one.open.map((gap) => `Still open after research: ${gap}.`),
      ),
    ]),
  ].slice(0, 8);
}
