import { createHash } from "node:crypto";

import {
  QFindingIdSchema,
  Q_ARTIFACT_SECTION_BODY_MAX,
  type QArtifactContent,
  type QArtifactFinding,
} from "@capital-q/contracts";
import type {
  AnalysisCritiqueResult,
  AnalysisDocumentResult,
} from "@capital-q/q-core";

import {
  PUBLIC_SEARCH_LIMITS,
  type PrimaryKind,
  type SourceTier,
} from "@capital-q/q-research";

import type {
  CapitalQRecord,
  InvestigationSummary,
  ResearchDossier,
  Spend,
} from "./deep-research.js";
import type { PublicSourcesGap } from "./jobs.js";
import { safeReport, type LiveReport } from "./live.js";
import type { Trace, Who, WorkforceModels } from "./models.js";

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

export function sourcesText(sources: readonly AnalysisSource[]): string {
  return sources
    .map(
      (source) =>
        `S${String(source.index)} ${source.title ?? "(untitled)"} | ${source.domain}${source.publishedAt === null ? "" : ` | ${source.publishedAt.slice(0, 10)}`}${tierText(source) === null ? "" : ` | ${tierText(source) ?? ""}`}`,
    )
    .join("\n")
    .slice(0, 10_000);
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

/** Code's own checks: figures without a basis, sources that do not exist. */
export function basisProblems(
  draft: AnalysisDocumentResult,
  sourceIndices: ReadonlySet<number>,
): readonly AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
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
        problem: `Cites sources that do not exist: ${[...new Set(missing)]
          .map((index) => `S${String(index)}`)
          .join(", ")}.`.slice(0, 400),
        fix: "Cite only the numbered sources given, or label the figure as an estimate or Q's inference.",
      });
    }
  }
  return issues.slice(0, 10);
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
};

const WRITE_CEILING_USD = 0.45;
const CRITIQUE_CEILING_USD = 0.1;

/**
 * Write, critique (the second analyst and code), revise from the findings,
 * until a draft passes or the drafts, the budget or the continuation run
 * out. Null: not even a first draft could be written.
 */
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
    const coded = basisProblems(draft, inputs.sourceIndices);
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
    const issues = [...(verdict?.issues ?? []), ...coded].slice(0, 12);
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
  report({ stage: "FILING", openPoints: passes ? 0 : open.length });
  return {
    draft,
    review: { passes, score, drafts, found, open: passes ? [] : open },
  };
}

function findingIdFor(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return QFindingIdSchema.parse(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
  );
}

/** The sourced facts a section cites, as findings with their truth axes. */
function findingsFor(
  body: string,
  facts: readonly AnalysisFact[],
  seed: string,
): readonly QArtifactFinding[] {
  const cited = new Set(
    [...body.matchAll(CITED)].map((match) => Number(match[1])),
  );
  return facts
    .filter((fact) => cited.has(fact.source))
    .slice(0, 12)
    .map((fact) => ({
      findingId: findingIdFor(`${seed}:${fact.id}:${fact.url}`),
      type: "FACT" as const,
      statement:
        `${fact.statement} (${fact.domain}${fact.asOf === null ? "" : `, ${fact.asOf}`}) [S${String(fact.source)}]`.slice(
          0,
          2_000,
        ),
      // What a public page says is its publisher's claim (ADR-001
      // USER_CLAIM: a party's own statement, as the platform's other
      // public findings label it -- live 2026-10-29, run A filed them
      // UNKNOWN), supported by that document, by several independent
      // ones, or only by the company's own word; never verified by
      // Capital Q. Code's cross-check decided the evidence and status.
      truthClass: "USER_CLAIM" as const,
      evidenceStatus: fact.evidenceStatus ?? ("DOCUMENT_SUPPORTED" as const),
      lifecycleStatus: fact.lifecycleStatus ?? ("CURRENT" as const),
      confidence:
        fact.lifecycleStatus === "CONTRADICTORY"
          ? ("CONFLICTING_EVIDENCE" as const)
          : fact.lifecycleStatus === "STALE" ||
              fact.evidenceStatus === "SELF_REPORTED"
            ? ("LOW" as const)
            : ("MODERATE" as const),
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
}): QArtifactContent {
  const { draft, review } = input;
  const sections = draft.sections.map((section, index) => ({
    heading: section.heading,
    body: section.body,
    findings: [
      ...findingsFor(
        section.body,
        input.facts,
        `${input.seed}:${String(index)}`,
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
  const listed = input.sources.filter((source) => cited.has(source.index));
  const sourceLines = listed.map(
    (source) =>
      `[S${String(source.index)}] ${source.title ?? source.domain} — ${source.domain}${source.publishedAt === null ? "" : `, published ${source.publishedAt.slice(0, 10)}`}${tierText(source) === null ? "" : ` (${tierText(source) ?? ""})`}. ${source.url}`,
  );
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
    ...(input.codeGaps ?? []).map((gap) => gap.slice(0, 300)),
    ...draft.gaps,
    // Honest when the review did not pass: its open points are named.
    ...review.open.map((issue) =>
      `${REVIEWER_OPEN_POINT} (${issue.section}): ${issue.problem}`.slice(
        0,
        300,
      ),
    ),
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
export function investigationGaps(
  investigations: readonly InvestigationSummary[],
): readonly string[] {
  return [
    ...new Set(
      investigations.flatMap((one) =>
        one.open.map((gap) => `Still open after research: ${gap}.`),
      ),
    ),
  ].slice(0, 8);
}
