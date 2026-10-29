import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * Q as an analyst doing deep work (owner 2026-10-23): "a full growth plan
 * for Maji Loop for the next 12 months, with proper market research".
 *
 *   RESEARCH_PLAN      the focused web searches a strong analyst would run
 *                      for the request (market size, demand, competitors by
 *                      name, alternatives, regulation, unit economics,
 *                      news). The model plans them; code composes every
 *                      query through the egress policy before it leaves.
 *   RESEARCH_FACTS     the dated, sourced facts in one question's public
 *                      pages, and what to search next because of them.
 *                      Code admits a fact only when every number it states
 *                      is in its source's own text.
 *   ANALYSIS_WRITE     the document, sections chosen for the request, every
 *                      figure with its basis (a source, an estimate with its
 *                      assumptions, or Q's inference). Also the revision,
 *                      from the reviewer's findings.
 *   ANALYSIS_CRITIQUE  a second analyst's verdict on it. Code adds its own
 *                      checks and decides whether it is revised again.
 */

// ---------------------------------------------------------------------------
// RESEARCH_PLAN
// ---------------------------------------------------------------------------

export const RESEARCH_PLAN_SCHEMA_NAME = "ResearchPlanResult";
export const RESEARCH_PLAN_SCHEMA_VERSION = 1;

export const ResearchPlanVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The person's request, in their words. UNTRUSTED. */
    request: z.string().min(1).max(4_000),
    /** The plan step's goal. UNTRUSTED. */
    purpose: z.string().max(600),
    /**
     * The subject as they may search for it: for their own company, its
     * name, country, declared sectors and own description. UNTRUSTED.
     * (1,200 since 2026-10-24: 400 cut the description off.)
     */
    subject: z.string().max(1_200),
    today: z.string().min(1).max(40),
  })
  .strict();
export type ResearchPlanVariables = z.infer<typeof ResearchPlanVariablesSchema>;
export const RESEARCH_PLAN_UNTRUSTED = [
  "request",
  "purpose",
  "subject",
] as const;

const Lane = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z][A-Za-z0-9_ -]*$/u);
const Query = z.string().trim().min(3).max(160);

export const ResearchPlanResultSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            lane: Lane,
            query: Query,
            alsoQuery: Query.nullable(),
            recent: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type ResearchPlanResult = z.infer<typeof ResearchPlanResultSchema>;

// ---------------------------------------------------------------------------
// RESEARCH_FACTS
// ---------------------------------------------------------------------------

export const RESEARCH_FACTS_SCHEMA_NAME = "ResearchFactsResult";
export const RESEARCH_FACTS_SCHEMA_VERSION = 1;

export const ResearchFactsVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    request: z.string().min(1).max(4_000),
    lane: z.string().min(1).max(40),
    question: z.string().min(1).max(200),
    today: z.string().min(1).max(40),
    /** Numbered public page excerpts. UNTRUSTED. */
    pages: z.string().min(1).max(20_000),
  })
  .strict();
export type ResearchFactsVariables = z.infer<
  typeof ResearchFactsVariablesSchema
>;
export const RESEARCH_FACTS_UNTRUSTED = [
  "request",
  "lane",
  "question",
  "pages",
] as const;

export const RESEARCH_FACT_KINDS = [
  "FIGURE",
  "FACT",
  "COMPETITOR",
  "ALTERNATIVE",
  "REGULATION",
  "TREND",
  "RISK",
  "NEWS",
] as const;

export const ResearchFactsResultSchema = z
  .object({
    facts: z
      .array(
        z
          .object({
            statement: z.string().trim().min(1).max(400),
            figure: z.string().trim().min(1).max(80).nullable(),
            asOf: z.string().trim().min(1).max(40).nullable(),
            /** The page's number: 3 for S3. */
            source: z.number().int().min(1).max(200),
            kind: z.enum(RESEARCH_FACT_KINDS),
          })
          .strict(),
      )
      .max(12),
    followUps: z.array(z.object({ lane: Lane, query: Query }).strict()).max(3),
  })
  .strict();
export type ResearchFactsResult = z.infer<typeof ResearchFactsResultSchema>;

// ---------------------------------------------------------------------------
// ANALYSIS_WRITE
// ---------------------------------------------------------------------------

export const ANALYSIS_WRITE_SCHEMA_NAME = "AnalysisDocumentResult";
export const ANALYSIS_WRITE_SCHEMA_VERSION = 1;

export const AnalysisWriteVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    principalName: z.string().min(1).max(120),
    request: z.string().min(1).max(4_000),
    purpose: z.string().max(600),
    today: z.string().min(1).max(40),
    /** The company's own record, as the person may read it. UNTRUSTED. */
    company: z.string().max(12_000),
    /** Admitted public facts, F-numbered with their S sources. UNTRUSTED. */
    research: z.string().max(24_000),
    /** The numbered sources. UNTRUSTED. */
    sources: z.string().max(10_000),
    /** The reviewer's findings and the last draft; empty on a first draft. UNTRUSTED. */
    revision: z.string().max(40_000),
  })
  .strict();
export type AnalysisWriteVariables = z.infer<
  typeof AnalysisWriteVariablesSchema
>;
export const ANALYSIS_WRITE_UNTRUSTED = [
  "request",
  "purpose",
  "company",
  "research",
  "sources",
  "revision",
] as const;

export const ANALYSIS_SECTION_BODY_MAX = 5_500;

export const AnalysisDocumentResultSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    /** The conclusion in two or three sentences. */
    summary: z.string().trim().min(1).max(600),
    sections: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(120),
            body: z.string().trim().min(1).max(ANALYSIS_SECTION_BODY_MAX),
          })
          .strict(),
      )
      .min(3)
      .max(16),
    /** Exactly the three most important recommendations, one sentence each. */
    topRecommendations: z
      .array(z.string().trim().min(1).max(300))
      .min(1)
      .max(3),
    /** What is not known and would change the conclusion. */
    gaps: z.array(z.string().trim().min(1).max(300)).max(12),
  })
  .strict();
export type AnalysisDocumentResult = z.infer<
  typeof AnalysisDocumentResultSchema
>;

// ---------------------------------------------------------------------------
// ANALYSIS_CRITIQUE
// ---------------------------------------------------------------------------

export const ANALYSIS_CRITIQUE_SCHEMA_NAME = "AnalysisCritiqueResult";
export const ANALYSIS_CRITIQUE_SCHEMA_VERSION = 1;

export const AnalysisCritiqueVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    principalName: z.string().min(1).max(120),
    request: z.string().min(1).max(4_000),
    company: z.string().max(12_000),
    research: z.string().max(24_000),
    document: z.string().min(1).max(60_000),
  })
  .strict();
export type AnalysisCritiqueVariables = z.infer<
  typeof AnalysisCritiqueVariablesSchema
>;
export const ANALYSIS_CRITIQUE_UNTRUSTED = [
  "request",
  "company",
  "research",
  "document",
] as const;

export const ANALYSIS_ISSUE_KINDS = [
  "MISSING_SECTION",
  "UNSUPPORTED",
  "CONTRADICTION",
  "WEAK_SIZING",
  "GENERIC",
  "MISSING_RISK",
  "UNCLEAR_CONCLUSION",
] as const;
export type AnalysisIssueKind = (typeof ANALYSIS_ISSUE_KINDS)[number];

export const AnalysisCritiqueResultSchema = z
  .object({
    passes: z.boolean(),
    score: z.number().int().min(0).max(100),
    issues: z
      .array(
        z
          .object({
            kind: z.enum(ANALYSIS_ISSUE_KINDS),
            section: z.string().trim().min(1).max(120),
            problem: z.string().trim().min(1).max(400),
            fix: z.string().trim().min(1).max(400),
          })
          .strict(),
      )
      .max(10),
    strengths: z.array(z.string().trim().min(1).max(300)).max(3),
  })
  .strict();
export type AnalysisCritiqueResult = z.infer<
  typeof AnalysisCritiqueResultSchema
>;

// ---------------------------------------------------------------------------
// Tolerant results (live 2026-10-24, batch 5): one model refused as
// INVALID_MODEL_OUTPUT on most deep-work calls -- research facts, the
// analysis draft, the investor's job plan -- never truncated. Same
// templates; the results now strip keys they do not use, take longer text
// that code clips to what it stores, and let a malformed list element cost
// that element (the gateway's DROP). Nothing a model writes is trusted more:
// code still admits every fact, bounds every field it files and checks every
// figure's basis.
// ---------------------------------------------------------------------------

const LooseLane = z.string().trim().min(1).max(80);
const LooseQuery = z.string().trim().min(3).max(240);

export const RESEARCH_PLAN_V2_SCHEMA_VERSION = 2;
export const ResearchPlanResultV2Schema = z.object({
  questions: z
    .array(
      z.object({
        lane: LooseLane,
        query: LooseQuery,
        alsoQuery: LooseQuery.nullable().catch(null),
        recent: z.boolean().catch(false),
      }),
    )
    .min(1)
    .max(16),
});
export type ResearchPlanResultV2 = z.infer<typeof ResearchPlanResultV2Schema>;

export const RESEARCH_FACTS_V2_SCHEMA_VERSION = 2;
export const ResearchFactsResultV2Schema = z.object({
  facts: z
    .array(
      z.object({
        statement: z.string().trim().min(1).max(800),
        figure: z.string().trim().min(1).max(400).nullable().catch(null),
        asOf: z.string().trim().min(1).max(120).nullable().catch(null),
        source: z.number().int().min(1).max(500),
        kind: z.enum(RESEARCH_FACT_KINDS).catch("FACT"),
      }),
    )
    .max(24),
  followUps: z
    .array(z.object({ lane: LooseLane, query: LooseQuery }))
    .max(6)
    .catch([]),
});
export type ResearchFactsResultV2 = z.infer<typeof ResearchFactsResultV2Schema>;

export const ANALYSIS_WRITE_V3_SCHEMA_VERSION = 3;
export const AnalysisDocumentResultV3Schema = z.object({
  title: z.string().trim().min(1).max(400),
  summary: z.string().trim().min(1).max(6_000),
  // An empty heading or body (live: sections.3.body too_small) costs that
  // section alone: code drops it, never the draft.
  sections: z
    .array(
      z.object({
        heading: z.string().trim().max(300).catch(""),
        body: z.string().trim().max(40_000).catch(""),
      }),
    )
    .min(3)
    .max(24),
  topRecommendations: z.array(z.string().trim().min(1).max(800)).min(1).max(8),
  gaps: z.array(z.string().trim().min(1).max(800)).max(30).catch([]),
});
export type AnalysisDocumentResultV3 = z.infer<
  typeof AnalysisDocumentResultV3Schema
>;

// ---------------------------------------------------------------------------
// Investigation-grade research (owner 2026-10-29): the planner is asked
// again after each round for the open questions code found (and told what
// was already asked), marks the lines whose answer an official body
// publishes, and names words for Capital Q's own company search; the fact
// reader labels what each figure measures, so code can cross-check them.
// ---------------------------------------------------------------------------

export const RESEARCH_PLAN_V4_SCHEMA_VERSION = 4;

export const ResearchPlanVariablesV4Schema = z
  .object({
    ...TaskFrameSchema,
    request: z.string().min(1).max(4_000),
    purpose: z.string().max(600),
    subject: z.string().max(1_200),
    today: z.string().min(1).max(40),
    /**
     * The open questions code found after a round, one per line; empty on
     * the first round. Lane labels and code's own wording. UNTRUSTED.
     */
    gaps: z.string().max(4_000),
    /** Queries already sent, one per line (never repeated). UNTRUSTED. */
    asked: z.string().max(6_000),
  })
  .strict();
export type ResearchPlanVariablesV4 = z.infer<
  typeof ResearchPlanVariablesV4Schema
>;
export const RESEARCH_PLAN_V4_UNTRUSTED = [
  "request",
  "purpose",
  "subject",
  "gaps",
  "asked",
] as const;

export const ResearchPlanResultV4Schema = z.object({
  questions: z
    .array(
      z.object({
        lane: LooseLane,
        query: LooseQuery,
        alsoQuery: LooseQuery.nullable().catch(null),
        recent: z.boolean().catch(false),
        /** An official body publishes the answer: a primary source is expected. */
        primary: z.boolean().catch(false),
      }),
    )
    .max(16),
  /**
   * A few words for Capital Q's own company search (sector, place, stage),
   * never sent outside Capital Q; null when the request is not about a
   * sector or market.
   */
  internalQuery: z.string().trim().max(200).nullable().catch(null),
});
export type ResearchPlanResultV4 = z.infer<typeof ResearchPlanResultV4Schema>;

export const RESEARCH_FACTS_V3_SCHEMA_VERSION = 3;
export const ResearchFactsResultV3Schema = z.object({
  facts: z
    .array(
      z.object({
        statement: z.string().trim().min(1).max(800),
        figure: z.string().trim().min(1).max(400).nullable().catch(null),
        asOf: z.string().trim().min(1).max(120).nullable().catch(null),
        source: z.number().int().min(1).max(500),
        kind: z.enum(RESEARCH_FACT_KINDS).catch("FACT"),
        /** What the figure measures, in 2-5 plain words; null for none. */
        measure: z.string().trim().min(1).max(120).nullable().catch(null),
        /** What it is about (the market, place or organisation); null for none. */
        entity: z.string().trim().min(1).max(120).nullable().catch(null),
      }),
    )
    .max(24),
  followUps: z
    .array(z.object({ lane: LooseLane, query: LooseQuery }))
    .max(6)
    .catch([]),
});
export type ResearchFactsResultV3 = z.infer<typeof ResearchFactsResultV3Schema>;

export const ANALYSIS_CRITIQUE_V3_SCHEMA_VERSION = 3;
export const AnalysisCritiqueResultV3Schema = z.object({
  passes: z.boolean(),
  score: z.number().min(0).max(100),
  issues: z
    .array(
      z.object({
        kind: z.enum(ANALYSIS_ISSUE_KINDS).catch("GENERIC"),
        section: z.string().trim().min(1).max(300),
        problem: z.string().trim().min(1).max(1_200),
        fix: z.string().trim().min(1).max(1_200),
      }),
    )
    .max(20),
  strengths: z.array(z.string().trim().min(1).max(800)).max(8).catch([]),
});
export type AnalysisCritiqueResultV3 = z.infer<
  typeof AnalysisCritiqueResultV3Schema
>;

// ---------------------------------------------------------------------------
// Situation-first research (owner 2026-10-29): every Q capability starts
// from everything Q knows about the account. A research BRIEF first decides,
// from the person's situation dossier (the one planning reads, with F<n>
// refs), what this question needs; the planner reads the brief and the facts
// it selected, never the whole dossier; code still composes every query.
// ---------------------------------------------------------------------------

export const ResearchPlanVariablesV5Schema =
  ResearchPlanVariablesV4Schema.extend({
    /**
     * The research brief as code grounded it: the question, the market in
     * question, the angles, what is unknown, what must not drive the
     * research, and the selected facts (F<n>). Private context for planning
     * only; nothing in it may be written into a query. UNTRUSTED.
     */
    brief: z.string().max(8_000),
  }).strict();
export type ResearchPlanVariablesV5 = z.infer<
  typeof ResearchPlanVariablesV5Schema
>;
export const RESEARCH_PLAN_V5_UNTRUSTED = [
  ...RESEARCH_PLAN_V4_UNTRUSTED,
  "brief",
] as const;

export const RESEARCH_BRIEF_SCHEMA_NAME = "ResearchBriefResult";
export const RESEARCH_BRIEF_SCHEMA_VERSION = 1;

export const ResearchBriefVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The person's request, in their words. UNTRUSTED. */
    request: z.string().min(1).max(4_000),
    /** Their own earlier messages in the conversation. UNTRUSTED. */
    earlier: z.string().max(4_000),
    today: z.string().min(1).max(40),
    /** The situation dossier, sections of F<n> facts. UNTRUSTED. */
    situation: z.string().max(24_000),
  })
  .strict();
export type ResearchBriefVariables = z.infer<
  typeof ResearchBriefVariablesSchema
>;
export const RESEARCH_BRIEF_UNTRUSTED = [
  "request",
  "earlier",
  "situation",
] as const;

const BriefFrom = z.string().trim().min(1).max(200);
const BriefTerm = z.object({
  name: z.string().trim().min(1).max(80),
  /** The F<n> ref or the person's quoted words it came from. */
  from: BriefFrom,
});

export const ResearchBriefResultSchema = z.object({
  /** The question restated in their terms. */
  question: z.string().trim().min(1).max(600),
  market: z
    .object({
      places: z.array(BriefTerm).max(8).catch([]),
      sectors: z.array(BriefTerm).max(6).catch([]),
      stage: BriefTerm.nullable().catch(null),
      /** Companies, products or bodies the research is about. */
      subjects: z.array(BriefTerm).max(6).catch([]),
    })
    .catch({ places: [], sectors: [], stage: null, subjects: [] }),
  /** The facts that matter for this question, and why. */
  relevant: z
    .array(
      z.object({
        ref: z
          .string()
          .trim()
          .regex(/^F\d{1,3}$/u),
        why: z.string().trim().min(1).max(200),
      }),
    )
    .max(12)
    .catch([]),
  /** What Q needs and does not know; who can establish it. */
  unknowns: z
    .array(
      z.object({
        what: z.string().trim().min(1).max(200),
        establish: z.enum(["RESEARCH", "PERSON"]).catch("PERSON"),
      }),
    )
    .max(8)
    .catch([]),
  angles: z.array(z.string().trim().min(1).max(200)).max(8).catch([]),
  /** What is irrelevant and must not drive the research. */
  irrelevant: z.array(z.string().trim().min(1).max(200)).max(8).catch([]),
  /** For the person: what Q is looking into, plain words, no refs. */
  summary: z.string().trim().min(1).max(600),
});
export type ResearchBriefResult = z.infer<typeof ResearchBriefResultSchema>;
