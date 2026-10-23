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

import type { ResearchDossier, Spend } from "./deep-research.js";
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

/** Drafts at most: the first and two revisions. */
export const ANALYSIS_MAX_DRAFTS = 3;

export type AnalysisSource = {
  readonly index: number;
  readonly url: string;
  readonly domain: string;
  readonly title: string | null;
  readonly publishedAt: string | null;
};

export type AnalysisFact = ResearchDossier["facts"][number];

/** Several research steps' dossiers as one, sources numbered on. */
export function mergeDossiers(dossiers: readonly ResearchDossier[]): {
  readonly sources: readonly AnalysisSource[];
  readonly facts: readonly AnalysisFact[];
} {
  const sources: AnalysisSource[] = [];
  const facts: AnalysisFact[] = [];
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
    for (const fact of dossier.facts) {
      factNumber += 1;
      facts.push({
        ...fact,
        id: `F${String(factNumber)}`,
        source: fact.source + offset,
      });
    }
    offset += top;
  }
  return { sources, facts };
}

export function researchText(facts: readonly AnalysisFact[]): string {
  if (facts.length === 0)
    return "No public research was available for this document.";
  return facts
    .map(
      (fact) =>
        `${fact.id} [S${String(fact.source)}] (${fact.lane}, ${fact.kind}${fact.asOf === null ? "" : `, as of ${fact.asOf}`}) ${fact.statement}`,
    )
    .join("\n")
    .slice(0, 24_000);
}

export function sourcesText(sources: readonly AnalysisSource[]): string {
  return sources
    .map(
      (source) =>
        `S${String(source.index)} ${source.title ?? "(untitled)"} | ${source.domain}${source.publishedAt === null ? "" : ` | ${source.publishedAt.slice(0, 10)}`}`,
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
}): Promise<{
  readonly draft: AnalysisDocumentResult;
  readonly review: AnalysisReview;
} | null> {
  const { models, who, trace, spend, inputs } = dependencies;
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
      // What a public page says: supported by that document, not verified
      // by Capital Q.
      truthClass: "UNKNOWN" as const,
      evidenceStatus: "DOCUMENT_SUPPORTED" as const,
      lifecycleStatus: "CURRENT" as const,
      confidence: "MODERATE" as const,
      evidenceRefs: [],
      subjects: [],
    }));
}

/** Text over a section's limit, as several sections ("(continued)"). */
function split(
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
export function analysisContent(input: {
  readonly draft: AnalysisDocumentResult;
  readonly review: AnalysisReview;
  readonly sources: readonly AnalysisSource[];
  readonly facts: readonly AnalysisFact[];
  readonly seed: string;
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
    [draft.summary, ...draft.sections.map((section) => section.body)].flatMap(
      (body) => [...body.matchAll(CITED)].map((match) => Number(match[1])),
    ),
  );
  const listed = input.sources.filter((source) => cited.has(source.index));
  const sourceLines = listed.map(
    (source) =>
      `[S${String(source.index)}] ${source.title ?? source.domain} — ${source.domain}${source.publishedAt === null ? "" : `, published ${source.publishedAt.slice(0, 10)}`}. ${source.url}`,
  );
  const sourceSections =
    sourceLines.length === 0
      ? []
      : split(
          "Sources",
          `Public sources this document cites. A source states what it states; Capital Q has not verified it.\n${sourceLines.join("\n")}`,
        );
  const gaps = [
    ...draft.gaps,
    // Honest when the review did not pass: its open points are named.
    ...review.open.map((issue) =>
      `Reviewer's open point (${issue.section}): ${issue.problem}`.slice(
        0,
        300,
      ),
    ),
  ].slice(0, 24);
  return {
    sections: [
      ...sections.flatMap((section) =>
        split(section.heading, section.body).map((part, index) => ({
          heading: part.heading.slice(0, 160),
          body: part.body,
          findings: index === 0 ? section.findings : [],
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
