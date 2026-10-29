import { randomUUID } from "node:crypto";

import {
  CorrelationIdSchema,
  type QSituationDossier,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDeepResearch,
  createSearchBudget,
  crossCheck,
  gapText,
  openGaps,
  publicTermsOf,
  rankFacts,
  registrableDomain,
  searchPhrase,
  sourceTier,
  tierRank,
  verifyFacts,
  factKey,
  countryName,
  placeCountries,
  CHECKED_EVIDENCE_STATUSES,
  CHECKED_LIFECYCLE_STATUSES,
  DOSSIER_MAX_FACTS,
  FACT_KINDS,
  PRIMARY_KINDS,
  SOURCE_TIERS,
  type CrossChecked,
  type DeepResearchQuestion,
  type DeepResearchSource,
  type OpenGap,
  type PrimaryKind,
  type ProposedFact,
  rejectOnAbort,
  SYSTEM_RESEARCH_TIME,
  type PublicWebResearchService,
  type ResearchTime,
  type SearchBudget,
  type SourceTier,
  type VerifiedFact,
} from "@capital-q/q-research";
import type { ActorContext } from "@capital-q/security";
import { z } from "zod";

import {
  briefSituation,
  groundBrief,
  GroundedBriefSchema,
  type GroundedBrief,
} from "./research-brief.js";
import type { ResearchFound } from "./jobs.js";
import { safeReport } from "./live.js";
import {
  diligenceSubjectLines,
  subjectLines,
  type OwnResearchSubject,
} from "./own-subject.js";
import { DEFAULT_WORKFORCE_JOB_SEARCH_BUDGET as DEFAULT_JOB_SEARCH_BUDGET } from "./limit.js";
import type { WorkforceModels } from "./models.js";
import type { WorkforcePortServices } from "./ports.js";

/**
 * A RESEARCH step as an analyst investigates (owner 2026-10-23, made
 * investigation-grade 2026-10-29: "Q must investigate, not write a
 * convincing answer from a handful of results").
 *
 *   1. PLAN. A model plans 6-12 focused questions from the request,
 *      official (primary) sources first. It sees the person's request and
 *      the step's goal only -- nothing from their records -- so no private
 *      fact can be put in a query; every query is composed again by the
 *      egress policy.
 *   2. ROUNDS. The questions run side by side over the configured providers
 *      (which fail over), each reading its best pages. A model reads each
 *      line's pages into dated, sourced facts; code admits a fact only when
 *      every number in it is on its page. Code then cross-checks them
 *      (q-research cross-check.ts: corroboration across independent
 *      publishers, contradictions with both sides kept, staleness) and
 *      names the open questions: a planned line with no fact or that could
 *      not run, facts that disagree, only stale facts, a line that wants an
 *      official source and has none. The planner is asked for queries for
 *      THOSE gaps only, never one already sent. A bounded loop: it stops on
 *      no gaps, the search budget, the model-call cap, the deadline, the
 *      round cap, or nothing new to ask.
 *   3. DURABLE. After each phase of each round the investigation is kept on
 *      the job's row (checkpoint): a worker that restarts resumes where it
 *      was -- the queries already sent are never sent again.
 *   4. CAPITAL Q RECORDS. Beside the web, companies on Capital Q the person
 *      may see (the company search tool, as them, under their firewall
 *      plan). They are kept apart from web facts and never reach a query.
 *
 * Page text never leaves this step: the dossier keeps facts, sources'
 * addresses, titles, dates and tiers.
 */

export const DEEP_RESEARCH_DEADLINE_MS = 150_000;
/**
 * Rounds at most. Round one covers the plan; round two fills what it
 * missed; round three settles what round two found disputed or official.
 * Each later round costs a planner call and its page reads for fewer new
 * facts, and three rounds of four-wide searches with their reads fit the
 * 150 s deadline (live rounds take 30-40 s).
 */
export const INVESTIGATION_ROUNDS_MAX = 3;
/**
 * Questions a later round may ask: the job's search budget (8 by default)
 * keeps two searches back after round one, so more would only be skipped.
 */
export const GAP_QUESTIONS_MAX = 4;
/**
 * A line of enquiry is searched at most twice: what two differently
 * phrased searches did not find, a third rarely does; the report then
 * names it as open instead of spending on it again.
 */
export const LANE_TRIES_MAX = 2;
/**
 * Model calls one RESEARCH step may make: a planner call per round (3) and
 * the page reads (up to 12 in round one, 4 in each later round), with room
 * for a retry's worth. The step's dollar cap still bounds every call.
 */
export const MODEL_CALLS_MAX = 24;
const FACT_CALLS_AT_ONCE = 4;
const PAGES_PER_LANE = 4;
const PAGE_CHARS = 2_200;
/** Round one's OPEN QUESTIONS, said plainly (see planOnce). */
export const FIRST_ROUND_GAPS =
  "None yet: this is the first round. Plan the full investigation the request needs.";
/**
 * Live case E (2026-10-29): the first plan came back with no questions
 * and the retry, byte-identical, was refused by the provider (a 400 on a
 * request that had just succeeded). A first round asked again says why:
 * a different request, and the planner is told what went wrong.
 */
export const FIRST_ROUND_RETRY_GAPS =
  "None yet: this is the first round. An earlier answer to this same request planned no questions, but the request asks for research: plan the full investigation it needs, between 6 and 12 questions.";
/**
 * Live case E: round one ran without a plan (reduced) and round two's
 * planner, asked only for the one GENERAL line's gap, wrote eight good
 * lines that were all dropped as not GENERAL. A run with no plan asks for
 * the plan once more after round one, as a first round.
 */
export const RECOVERY_ROUND_GAPS =
  "None yet: round one ran without a plan (only the request's own words were searched, as one query). Plan the full investigation the request needs now, between 6 and 12 questions, as a first round.";
/** Questions a recovered plan may run (round one's own cap). */
const PLAN_QUESTIONS_MAX = 12;
const FOLLOW_UPS_MAX = 4;
const REQUEST_MAX = 4_000;
const PLAN_CEILING_USD = 0.04;
/**
 * A plan call's failures worth asking once more (live 2026-10-29: OpenAI
 * TRANSIENT failures cost case A its plan, and the job searched one
 * generic query).
 */
const RETRIED_PLAN_FAILURES: ReadonlySet<string> = new Set([
  "TRANSIENT",
  "RATE_LIMIT",
  "PROVIDER_OUTAGE",
  "TIMEOUT",
]);
const BRIEF_CEILING_USD = 0.05;
const FACTS_CEILING_USD = 0.05;
const RECORDS_MAX = 12;
/** The person's earlier messages a job reads, and each one's length. */
const EARLIER_MAX = 4;
const EARLIER_CHARS = 1_000;

const Tier = z.enum(SOURCE_TIERS);
const TierKind = z.enum(PRIMARY_KINDS).nullable();

export const DossierSourceSchema = z
  .object({
    index: z.number().int().min(1),
    url: z.string().max(2_000),
    domain: z.string().max(300),
    title: z.string().max(400).nullable(),
    publishedAt: z.string().max(40).nullable(),
    /** Investigation (2026-10-29): the publisher's tier. Absent: older dossier. */
    tier: Tier.optional(),
    tierKind: TierKind.optional(),
  })
  .strict();

export const DossierFactSchema = z
  .object({
    id: z.string().regex(/^F\d{1,3}$/u),
    statement: z.string().min(1).max(400),
    figure: z.string().max(80).nullable(),
    asOf: z.string().max(40).nullable(),
    source: z.number().int().min(1),
    lane: z.string().max(40),
    kind: z.string().max(20),
    domain: z.string().max(300),
    title: z.string().max(400).nullable(),
    url: z.string().max(2_000),
    publishedAt: z.string().max(40).nullable(),
    // Investigation (2026-10-29), all optional: an older dossier has none.
    measure: z.string().max(60).nullable().optional(),
    entity: z.string().max(60).nullable().optional(),
    tier: Tier.optional(),
    tierKind: TierKind.optional(),
    /** ADR-001 evidence_status, decided by code's cross-check. */
    evidenceStatus: z.enum(CHECKED_EVIDENCE_STATUSES).optional(),
    /** ADR-001 lifecycle_status, decided by code's cross-check. */
    lifecycleStatus: z.enum(CHECKED_LIFECYCLE_STATUSES).optional(),
    corroboratedBy: z.array(z.string().max(8)).max(12).optional(),
    contradicts: z.array(z.string().max(8)).max(12).optional(),
  })
  .strict();

/** A company on Capital Q the person may see: its own declared profile. */
export const CapitalQRecordSchema = z
  .object({
    companyId: z.string().max(64),
    name: z.string().min(1).max(200),
    stage: z.string().max(64).nullable(),
    country: z.string().max(8).nullable(),
    description: z.string().max(400).nullable(),
  })
  .strict();
export type CapitalQRecord = z.infer<typeof CapitalQRecordSchema>;

/** How the investigation went, as code counted it. */
export const InvestigationSummarySchema = z
  .object({
    rounds: z.number().int().min(0).max(10),
    stop: z.string().max(40),
    /** Open questions left when it stopped (code's wording). */
    open: z.array(z.string().max(300)).max(24),
    /** Lines of enquiry no provider could search. */
    couldNotRun: z.array(z.string().max(40)).max(24),
    searches: z.number().int().min(0),
    modelCalls: z.number().int().min(0),
    ms: z.number().int().min(0),
    /**
     * Owner 2026-10-29: the market the research covered and where that came
     * from (their words, the conversation, their declared context), or that
     * it is global because no place was named. Absent: an older dossier.
     */
    scope: z.string().max(400).optional(),
    /**
     * The investigation ran in a reduced form, and why, in plain words
     * (2026-10-29: a plan that failed degraded it to one generic search
     * that read as a full investigation). Absent: it ran as planned.
     */
    reduced: z.string().max(400).optional(),
  })
  .strict();
export type InvestigationSummary = z.infer<typeof InvestigationSummarySchema>;

/** What a RESEARCH step hands the document after it (kept with the job). */
export const ResearchDossierSchema = z
  .object({
    version: z.literal(1),
    sources: z.array(DossierSourceSchema).max(80),
    facts: z.array(DossierFactSchema).max(80),
    lanes: z
      .array(
        z
          .object({
            lane: z.string().max(40),
            query: z.string().max(200).nullable(),
            status: z.string().max(40),
            sources: z.number().int().min(0),
          })
          .strict(),
      )
      .max(40),
    /**
     * The job's search budget left some lines of enquiry unsearched or
     * narrowed (2026-10-28); the document says so. Absent: an older dossier.
     */
    budgetLimited: z.boolean().optional(),
    /** Investigation (2026-10-29): rounds, why it stopped, what stayed open. */
    investigation: InvestigationSummarySchema.optional(),
    /** Capital Q records the person may see, kept apart from web facts. */
    records: z.array(CapitalQRecordSchema).max(RECORDS_MAX).optional(),
    /**
     * Owner 2026-10-29: the research brief, for the writer: what Q decided
     * the question needs, the facts it selected and the sections of their
     * situation it drew on (private; never sent outside).
     */
    brief: z
      .object({
        summary: z.string().max(600),
        writer: z.string().max(12_000),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ResearchDossier = z.infer<typeof ResearchDossierSchema>;

/** Bytes a value takes as JSON text (what jsonb keeps is about the same). */
export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/** Facts and writer text a compacted dossier keeps at the least. */
const COMPACT_FACTS_MIN = 12;
const COMPACT_WRITER_CHARS = 4_000;

/**
 * Production 2026-10-29: a 40-source dossier, kept with its step on the
 * job's row, broke the row's size cap and the finished research was marked
 * FAILED. The copy kept on the row (read back only when a restarted job
 * resumes after this step) is made to fit `maxBytes`: the lowest-ranked
 * facts go first (both sides of a contradiction stay), then the sources no
 * kept fact cites, then the writer's brief is shortened. Null: it cannot
 * fit at all. The step's own result, handed to the next step, is untouched.
 */
export function compactDossier(
  dossier: ResearchDossier,
  maxBytes: number,
): ResearchDossier | null {
  if (jsonBytes(dossier) <= maxBytes) return dossier;
  const shape = (keep: number, writerChars: number): ResearchDossier => {
    const facts = dossier.facts.filter(
      (fact, index) => index < keep || fact.lifecycleStatus === "CONTRADICTORY",
    );
    const kept = new Set(facts.map((fact) => fact.id));
    const cited = new Set(facts.map((fact) => fact.source));
    return {
      ...dossier,
      sources: dossier.sources.filter((source) => cited.has(source.index)),
      facts: facts.map((fact) => ({
        ...fact,
        ...(fact.corroboratedBy === undefined
          ? {}
          : {
              corroboratedBy: fact.corroboratedBy.filter((id) => kept.has(id)),
            }),
        ...(fact.contradicts === undefined
          ? {}
          : { contradicts: fact.contradicts.filter((id) => kept.has(id)) }),
      })),
      ...(dossier.brief === undefined
        ? {}
        : {
            brief: {
              summary: dossier.brief.summary,
              writer: dossier.brief.writer.slice(0, writerChars),
            },
          }),
    };
  };
  const writerFull = dossier.brief?.writer.length ?? 0;
  for (
    let keep = dossier.facts.length;
    keep >= COMPACT_FACTS_MIN;
    keep =
      keep === COMPACT_FACTS_MIN
        ? -1
        : Math.max(COMPACT_FACTS_MIN, Math.floor(keep * 0.75))
  ) {
    const candidate = shape(keep, writerFull);
    if (jsonBytes(candidate) <= maxBytes) return candidate;
  }
  const smallest = shape(COMPACT_FACTS_MIN, COMPACT_WRITER_CHARS);
  return jsonBytes(smallest) <= maxBytes ? smallest : null;
}

/** Jobs whose search budgets are held at once (one process). */
const JOB_BUDGETS_MAX = 500;

/** A step's spend against its budget, from what each call really cost. */
export function createSpend(capUsd: number) {
  let spent = 0;
  return {
    /** Charges a call; an unpriced one is charged its ceiling. */
    charge: (costUsd: number | null, ceilingUsd: number) => {
      spent += costUsd ?? ceilingUsd;
    },
    canAfford: (ceilingUsd: number) => spent + ceilingUsd <= capUsd + 1e-9,
    spent: () => spent,
  };
}
export type Spend = ReturnType<typeof createSpend>;

/** At most `limit` of `items` in flight at once, results in order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      results[index] = await fn(item, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/** One question's pages, numbered as the dossier numbers them. */
export function pagesText(sources: readonly DeepResearchSource[]): string {
  return sources
    .map((source) =>
      [
        `S${String(source.index)} | ${source.title ?? "(untitled)"} | ${source.domain}${source.publishedAt === null ? "" : ` | published ${source.publishedAt.slice(0, 10)}`}`,
        source.excerpt.slice(0, PAGE_CHARS),
      ].join("\n"),
    )
    .join("\n\n")
    .slice(0, 19_000);
}

/**
 * A lane's pages found this round that were READ in full: the only pages
 * a fact may come from (live 2026-10-29, case A: three facts were taken
 * from the search snippets of regulator pages whose reads timed out).
 */
export function pagesFor<
  S extends Pick<DeepResearchSource, "lanes" | "excerpt" | "extracted">,
>(lane: string, sources: readonly S[]): readonly S[] {
  return sources
    .filter(
      (source) =>
        source.lanes.includes(lane) &&
        source.excerpt !== "" &&
        source.extracted,
    )
    .slice(0, PAGES_PER_LANE);
}

/**
 * A lane's pages known only from a search snippet (their read failed),
 * shown to the fact reader without a source number: a lead to follow up,
 * never a fact. Code admits facts against read pages only.
 */
export function leadsText(
  lane: string,
  sources: readonly DeepResearchSource[],
): string {
  const unread = sources
    .filter(
      (source) =>
        source.lanes.includes(lane) &&
        source.excerpt !== "" &&
        !source.extracted,
    )
    .slice(0, PAGES_PER_LANE);
  if (unread.length === 0) return "";
  return [
    "NOT READ (search-result snippets of pages that could not be read; no source number: never the source of a fact, at most a follow-up lead)",
    ...unread.map(
      (source) =>
        `- ${source.title ?? "(untitled)"} | ${source.domain}: ${source.excerpt.replace(/\s+/gu, " ").slice(0, 400)}`,
    ),
  ]
    .join("\n")
    .slice(0, 2_400);
}

/**
 * Live 2026-10-29 (case A): the planner dropped the place from queries
 * that name an official body by its initials ("cbn licensed payment
 * operators 2025"). When the market in question has a place, every
 * outgoing query carries one: a query naming none of the market's
 * countries (or a place within them) gets the first country's name. A
 * deterministic boundary; egress still decides what may leave.
 */
export function withMarketPlace(
  query: string,
  countries: readonly string[],
): string {
  const first = countries[0];
  if (first === undefined) return query;
  if (placeCountries(query).some((code) => countries.includes(code)))
    return query;
  const name = countryName(first);
  if (name === null) return query;
  return `${query.slice(0, 239 - name.length).trimEnd()} ${name}`;
}

/**
 * Pages from the market's own official bodies (the regulator, central
 * bank, statistics office) whose read failed get one longer read before
 * they are given up (live 2026-10-29: cbn.gov.ng timed out in a shared
 * 8 s batch). Bounded by the job's deadline.
 */
export const PRIMARY_REREAD_MS = 20_000;
const PRIMARY_REREADS_MAX = 3;
const REREAD_MIN_MS = 2_000;

const urlKey = (url: string) => url.toLowerCase().replace(/\/+$/u, "");

/**
 * The re-read itself: the market's official pages among `sources` that
 * were not read, read once more on their own, within `budgetMs`. What is
 * read comes back by address; anything else (a failure, a timeout, a
 * refusal) leaves the page unread, never an error.
 */
export async function rereadPrimary(input: {
  readonly service: Pick<PublicWebResearchService, "extract">;
  readonly actor: ActorContext;
  readonly runId: string;
  readonly correlationId: z.infer<typeof CorrelationIdSchema>;
  readonly sources: readonly DeepResearchSource[];
  readonly countries: ReadonlySet<string>;
  readonly budgetMs: number;
  /** The deadline's timer (the system's by default). */
  readonly time?: ResearchTime | undefined;
}): Promise<
  ReadonlyMap<
    string,
    {
      readonly excerpt: string;
      readonly title: string | null;
      readonly instructionRisk: boolean;
    }
  >
> {
  const none = new Map<
    string,
    { excerpt: string; title: string | null; instructionRisk: boolean }
  >();
  if (input.budgetMs < REREAD_MIN_MS) return none;
  const urls = input.sources
    .filter((source) => {
      if (source.extracted) return false;
      const tier = sourceTier({
        url: source.url,
        domain: source.domain,
        title: source.title,
        countries: input.countries,
      });
      return tier.tier === "PRIMARY" && tier.kind !== "COMPANY_DISCLOSURE";
    })
    .slice(0, PRIMARY_REREADS_MAX)
    .map((source) => source.url);
  if (urls.length === 0) return none;
  const deadline = (input.time ?? SYSTEM_RESEARCH_TIME).timeout(input.budgetMs);
  try {
    const outcome = await Promise.race([
      input.service.extract({
        actor: input.actor,
        runId: input.runId,
        correlationId: input.correlationId,
        urls,
        signal: deadline.signal,
      }),
      // Raced too, for a provider that does not heed its signal.
      rejectOnAbort(deadline.signal, () => new Error("re-read timed out")),
    ]);
    if (outcome.status !== "OK") return none;
    for (const source of outcome.sources) {
      if (source.excerpt.trim().length === 0) continue;
      none.set(urlKey(source.url), {
        excerpt: source.excerpt,
        title: source.title,
        instructionRisk: source.instructionRisk.length > 0,
      });
    }
    return none;
  } catch {
    return none;
  } finally {
    deadline.cancel();
  }
}

/**
 * Owner 2026-10-24: the sources being read, for the person watching: each
 * public page's site and title as text (never its address, never a link),
 * the first twelve in the order read.
 */
export function readOf(
  sources: readonly DeepResearchSource[],
): { readonly domain: string; readonly title: string | null }[] {
  const plain = (text: string) =>
    text
      .replace(/\p{Cc}+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  return sources.slice(0, 12).map((source) => {
    const title = source.title === null ? "" : plain(source.title);
    return {
      domain: plain(source.domain).slice(0, 120) || "source",
      title: title.length === 0 ? null : title.slice(0, 160),
    };
  });
}

export type DeepResearchInput = Parameters<
  NonNullable<WorkforcePortServices["research"]>
>[0];

/**
 * Where an investigation is kept between phases, on the job's own durable
 * row (runner.ts): what is loaded is re-validated, never trusted.
 */
export type ResearchCheckpoint = {
  readonly load: () => Promise<unknown>;
  readonly save: (value: unknown) => Promise<void>;
};

// ---------------------------------------------------------------------------
// The investigation's durable state
// ---------------------------------------------------------------------------

const QuestionSchema = z
  .object({
    lane: z.string().min(1).max(40),
    query: z.string().min(1).max(240),
    alsoQuery: z.string().max(240).nullable(),
    recent: z.boolean(),
    primary: z.boolean(),
  })
  .strict();
type PlannedQuestion = z.infer<typeof QuestionSchema>;

const StoredSourceSchema = z
  .object({
    index: z.number().int().min(1),
    url: z.string().max(2_000),
    domain: z.string().max(300),
    title: z.string().max(400).nullable(),
    publishedAt: z.string().max(40).nullable(),
    retrievedAt: z.string().max(40),
    /** Kept only until the round's facts are read; "" after. */
    excerpt: z.string().max(PAGE_CHARS),
    extracted: z.boolean(),
    instructionRisk: z.boolean(),
    lanes: z.array(z.string().max(40)).max(40),
  })
  .strict();

const StoredFactSchema = z
  .object({
    statement: z.string().min(1).max(400),
    figure: z.string().max(80).nullable(),
    asOf: z.string().max(40).nullable(),
    source: z.number().int().min(1),
    lane: z.string().max(40),
    kind: z.enum(FACT_KINDS),
    measure: z.string().max(60).nullable(),
    entity: z.string().max(60).nullable(),
    domain: z.string().max(300),
    title: z.string().max(400).nullable(),
    url: z.string().max(2_000),
    publishedAt: z.string().max(40).nullable(),
  })
  .strict();

const LaneOutcomeSchema = z
  .object({
    lane: z.string().max(40),
    query: z.string().max(240).nullable(),
    status: z.enum([
      "OK",
      "NOTHING_SAFE_TO_SEND",
      "PROVIDER_UNAVAILABLE",
      "SKIPPED_DEADLINE",
      "SKIPPED_BUDGET",
      "FAILED",
    ]),
    sources: z.number().int().min(0),
  })
  .strict();

export const INVESTIGATION_PHASES = ["PLANNED", "SEARCHED", "READ"] as const;

/** The checkpoint kept on the job's row after each phase of each round. */
export const InvestigationCheckpointSchema = z
  .object({
    status: z.literal("CHECKPOINT"),
    version: z.literal(1),
    /** The round in hand (0: not planned yet) and how far it got. */
    round: z.number().int().min(0).max(INVESTIGATION_ROUNDS_MAX),
    phase: z.enum(INVESTIGATION_PHASES),
    /** Round one's plan: the lines of enquiry gaps are measured against. */
    plan: z.array(QuestionSchema).max(16),
    /** This round's questions. */
    current: z.array(QuestionSchema).max(16),
    /** Every query sent, lower-cased: never sent again. */
    asked: z.array(z.string().max(240)).max(80),
    tries: z.record(z.string().max(40), z.number().int().min(0).max(10)),
    lanes: z.array(LaneOutcomeSchema).max(40),
    sources: z.array(StoredSourceSchema).max(60),
    facts: z.array(StoredFactSchema).max(200),
    followUps: z
      .array(
        z
          .object({ lane: z.string().max(40), query: z.string().max(240) })
          .strict(),
      )
      .max(12),
    /** Public words earlier rounds read, allowed to travel (egress.ts). */
    publicTerms: z.array(z.string().max(24_000)).max(200),
    /** The job's searches spent when this was kept (restores its budget). */
    searches: z.number().int().min(0),
    modelCalls: z.number().int().min(0),
    spentUsd: z.number().min(0),
    internalQuery: z.string().max(200).nullable(),
    records: z.array(CapitalQRecordSchema).max(RECORDS_MAX).nullable(),
    budgetLimited: z.boolean(),
    /** Why the investigation ran reduced (see the summary); absent: it did not. */
    reduced: z.string().max(400).optional(),
    /** The context read once for the job (owner 2026-10-29). Absent: older. */
    context: z
      .object({
        earlier: z.array(z.string().max(EARLIER_CHARS)).max(EARLIER_MAX),
        /** The grounded research brief; null: none could be written. */
        brief: GroundedBriefSchema.nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type InvestigationCheckpoint = z.infer<
  typeof InvestigationCheckpointSchema
>;

export const STOP_REASONS = [
  "NO_GAPS",
  "ROUND_CAP",
  "SEARCH_BUDGET",
  "MODEL_BUDGET",
  "DEADLINE",
  "NO_NEW_QUERIES",
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

const laneOf = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 40) || "GENERAL";

const PUBLIC_TERMS_MAX = 24_000;

/** Public words, bounded: what travels is what was read, never more. */
function addTerms(terms: string[], more: readonly string[]): void {
  let used = terms.reduce((sum, term) => sum + term.length, 0);
  for (const term of more) {
    if (term.length === 0 || used >= PUBLIC_TERMS_MAX) continue;
    const kept = term.slice(0, PUBLIC_TERMS_MAX - used);
    terms.push(kept);
    used += kept.length;
  }
}

type TieredFact = VerifiedFact & {
  readonly measure: string | null;
  readonly entity: string | null;
  readonly tier: SourceTier;
  readonly tierKind: PrimaryKind | null;
};

/** Words a site's name may add to a company's ("paystackhq", "rampapp"). */
const OWN_SITE_SUFFIXES = ["", "hq", "app", "inc", "group", "global", "online"];

/**
 * Whether `domain` is the own site of the organisation `name`: a proper
 * name (as the page writes it, capitalised: "Payoneer", never a market
 * label like "payments"), and the site's first label is that name run
 * together, or it with a short corporate suffix. Live 2026-10-29 (run A):
 * the label "payments" made paymentsdive.com a company's own disclosure.
 */
export function isOwnSiteOf(domain: string, name: string): boolean {
  const trimmed = name.trim();
  if (!/^\p{Lu}/u.test(trimmed)) return false;
  const compact = trimmed.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (compact.length < 3) return false;
  const label = (registrableDomain(domain).split(".")[0] ?? "").replace(
    /-/gu,
    "",
  );
  return OWN_SITE_SUFFIXES.some((suffix) => label === `${compact}${suffix}`);
}

/**
 * Each fact's publisher tier. A page on the site of a company the facts
 * name (or the subject's) is that company's own disclosure: its claim.
 * An official source counts as primary for the market in question
 * (`countries`; none: a global question).
 */
function tiered(
  facts: readonly z.infer<typeof StoredFactSchema>[],
  subjectName: string | null,
  countries: ReadonlySet<string>,
): readonly TieredFact[] {
  const named = [
    ...new Set(
      [subjectName ?? "", ...facts.map((fact) => fact.entity ?? "")].filter(
        (name) => name.trim().length >= 3,
      ),
    ),
  ];
  const companyDomains = new Set(
    facts
      .filter((fact) => named.some((name) => isOwnSiteOf(fact.domain, name)))
      .map((fact) => registrableDomain(fact.domain)),
  );
  return facts.map((fact) => {
    const tier = sourceTier({
      url: fact.url,
      domain: fact.domain,
      title: fact.title,
      companyDomains,
      countries,
    });
    return { ...fact, tier: tier.tier, tierKind: tier.kind };
  });
}

/** Cross-checked facts with provisional ids, in the order found. */
function checkedFacts(
  facts: readonly z.infer<typeof StoredFactSchema>[],
  subjectName: string | null,
  today: Date,
  countries: ReadonlySet<string>,
): readonly CrossChecked<TieredFact & { readonly id: string }>[] {
  return crossCheck(
    tiered(facts, subjectName, countries).map((fact, position) => ({
      ...fact,
      id: `V${String(position + 1)}`,
    })),
    today,
  );
}

/**
 * The dossier's facts: ranked (coverage first, official sources first),
 * with every fact a kept fact disagrees with kept too -- both sides of a
 * contradiction always reach the document -- and references renumbered.
 */
export function dossierFacts(
  checked: readonly CrossChecked<TieredFact & { readonly id: string }>[],
): ResearchDossier["facts"] {
  // Ranking gives final ids; the cross-check's references use the
  // provisional ones, kept beside them.
  const ranked = rankFacts(
    checked.map((fact) => ({ ...fact, provisional: fact.id })),
    DOSSIER_MAX_FACTS,
    (fact) => tierRank(fact.tier),
  );
  const kept = [...ranked];
  const byProvisional = new Map(checked.map((fact) => [fact.id, fact]));
  const have = new Set(kept.map((fact) => fact.provisional));
  for (const fact of [...kept]) {
    for (const other of fact.contradicts) {
      const partner = byProvisional.get(other);
      if (partner === undefined || have.has(other) || kept.length >= 80)
        continue;
      have.add(other);
      kept.push({
        ...partner,
        id: `F${String(kept.length + 1)}`,
        provisional: other,
      });
    }
  }
  const finalId = new Map(kept.map((fact) => [fact.provisional, fact.id]));
  const rename = (ids: readonly string[]) =>
    ids
      .map((id) => finalId.get(id))
      .filter((id): id is string => id !== undefined)
      .slice(0, 12);
  return kept.map((fact) => ({
    id: fact.id,
    statement: fact.statement,
    figure: fact.figure,
    asOf: fact.asOf,
    source: fact.source,
    lane: fact.lane.slice(0, 40),
    kind: fact.kind,
    domain: fact.domain,
    title: fact.title?.slice(0, 400) ?? null,
    url: fact.url,
    publishedAt: fact.publishedAt,
    measure: fact.measure,
    entity: fact.entity,
    tier: fact.tier,
    tierKind: fact.tierKind,
    evidenceStatus: fact.evidenceStatus,
    lifecycleStatus: fact.lifecycleStatus,
    corroboratedBy: rename(fact.corroboratedBy),
    contradicts: rename(fact.contradicts),
  }));
}

/**
 * Without a brief, the scope the report states: the countries the
 * person's own words name (a state or city counts as its country), or
 * global.
 */
export function scopeOfWords(words: readonly string[]): string {
  const countries = placeCountries(words.join("\n"));
  return countries.length === 0
    ? "Scope: global. No place was named in the request or earlier in the conversation, and Q's brief of their situation was not available, so no country was assumed."
    : `Scope: ${countries.map((code) => countryName(code) ?? code).join(", ")} (from their words).`;
}

/**
 * Why an investigation with no plan ran reduced, in the person's terms:
 * what failed, and what was searched instead.
 */
export function reducedReason(plan: {
  readonly planned: unknown;
  readonly transient: boolean;
  readonly retried: boolean;
}): string {
  const why =
    plan.planned !== null
      ? "the research plan came back with no lines of enquiry"
      : plan.transient
        ? `the research plan could not be written because the model service failed with a temporary error${plan.retried ? ", twice" : ""}`
        : "the research plan could not be written";
  return `This investigation ran in a reduced form: ${why}, so it searched the request's own words as a single query instead of planned lines of enquiry. Ask again for the full investigation.`;
}

export function workforceDeepResearch(dependencies: {
  readonly service: PublicWebResearchService | undefined;
  readonly models: Pick<WorkforceModels, "planResearch" | "researchFacts"> &
    Partial<Pick<WorkforceModels, "researchBrief">>;
  readonly now?: (() => number) | undefined;
  /**
   * The clock and deadlines of the whole research path (q-research
   * time.ts): the acceptance gate records and replays them. The system's
   * by default; it is the clock too when `now` is absent.
   */
  readonly time?: ResearchTime | undefined;
  readonly deadlineMs?: number | undefined;
  readonly logger?: Logger | undefined;
  /**
   * Live 2026-10-24: their own company's name, country and declared
   * sectors (own-subject.ts), for a request about "my company". Null or
   * absent: the request alone.
   */
  readonly ownSubject?:
    ((actor: ActorContext) => Promise<OwnResearchSubject | null>) | undefined;
  /**
   * Diligence (2026-10-28): the company a job names, read as the person
   * through the Context Firewall -- its name and country only. Null: not
   * theirs to read, and the research plans from the request alone.
   */
  readonly namedSubject?:
    | ((
        actor: ActorContext,
        companyId: string,
      ) => Promise<OwnResearchSubject | null>)
    | undefined;
  /**
   * Investigation (2026-10-29): companies on Capital Q the person may see,
   * found by the company search tool AS them under their firewall plan
   * (capital-q-records.ts). Null: none readable. Never sent outside.
   */
  readonly capitalQRecords?:
    | ((
        actor: ActorContext,
        query: { readonly text: string },
      ) => Promise<readonly CapitalQRecord[] | null>)
    | undefined;
  /** Searches one job may send, planned ones included (default 8). */
  readonly jobSearchBudget?: number | undefined;
  /**
   * Owner 2026-10-29: the person's own earlier messages in the
   * conversation the job came from (their words, never Q's), most recent
   * last. Absent or failing: the request alone.
   */
  readonly earlierUserText?:
    | ((actor: ActorContext, runId: string) => Promise<readonly string[]>)
    | undefined;
  /**
   * Owner 2026-10-29: every Q capability starts from everything Q knows
   * about the account. The person's situation dossier (the assembler
   * planning uses, read as them; cached per actor), once per job, from
   * which the research brief is written. Null: no situation readable.
   */
  readonly situation?:
    | ((
        actor: ActorContext,
        runId: string,
        ask: string,
      ) => Promise<QSituationDossier | null>)
    | undefined;
}): WorkforcePortServices["research"] {
  const service = dependencies.service;
  if (service === undefined) return undefined;
  const time = dependencies.time ?? SYSTEM_RESEARCH_TIME;
  const now = dependencies.now ?? time.now;
  const deep = createDeepResearch({
    service,
    clock: now,
    logger: dependencies.logger,
  });
  const { models, logger } = dependencies;
  const searchLimit = dependencies.jobSearchBudget ?? DEFAULT_JOB_SEARCH_BUDGET;
  // One budget per job, across its research steps and their rounds.
  const budgets = new Map<string, SearchBudget>();
  const budgetFor = (tenantId: string, jobId: string | undefined) => {
    if (jobId === undefined) return createSearchBudget(searchLimit);
    const key = `${tenantId}:${jobId}`;
    const held = budgets.get(key);
    if (held !== undefined) return held;
    if (budgets.size >= JOB_BUDGETS_MAX) {
      const oldest = budgets.keys().next().value;
      if (oldest !== undefined) budgets.delete(oldest);
    }
    const fresh = createSearchBudget(searchLimit);
    budgets.set(key, fresh);
    return fresh;
  };

  return async (input): Promise<ResearchFound> => {
    const started = now();
    const deadlineMs = dependencies.deadlineMs ?? DEEP_RESEARCH_DEADLINE_MS;
    const who = { tenantId: input.actor.tenantId, userId: input.actor.userId };
    const trace =
      input.jobId === undefined
        ? null
        : { jobId: input.jobId, runId: input.runId };
    const request = input.request.slice(0, REQUEST_MAX);
    const todayDate = new Date(started);
    const today = todayDate.toISOString().slice(0, 10);
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);
    const report = safeReport(input.progress);
    const budget = budgetFor(input.actor.tenantId, input.jobId);

    // A resumed step carries on from its checkpoint (re-validated: the
    // job's stored results are a trust boundary).
    const loaded = await (input.checkpoint?.load() ?? Promise.resolve(null))
      .then((value) => InvestigationCheckpointSchema.safeParse(value))
      .catch(() => null);
    const resumed = loaded?.success === true ? loaded.data : null;
    const state: InvestigationCheckpoint = resumed ?? {
      status: "CHECKPOINT",
      version: 1,
      round: 0,
      phase: "READ",
      plan: [],
      current: [],
      asked: [],
      tries: {},
      lanes: [],
      sources: [],
      facts: [],
      followUps: [],
      publicTerms: [],
      searches: 0,
      modelCalls: 0,
      spentUsd: 0,
      internalQuery: null,
      records: null,
      budgetLimited: false,
    };
    // What the job had spent stays spent: a restart never refills it.
    const used = budget.limit - budget.remaining();
    if (state.searches > used) budget.reserve(state.searches - used);
    if (state.budgetLimited) budget.markLimited();
    const spend = createSpend(input.budgetUsd ?? 0.6);
    spend.charge(state.spentUsd, 0);
    let modelCalls = state.modelCalls;
    const save = async () => {
      if (input.checkpoint === undefined) return;
      const value: InvestigationCheckpoint = {
        ...state,
        searches: budget.limit - budget.remaining(),
        modelCalls,
        spentUsd: Number(spend.spent().toFixed(6)),
        budgetLimited: budget.limited(),
      };
      // A checkpoint that cannot be written costs a resume, never the work.
      await input.checkpoint.save(value).catch(() => undefined);
    };

    // The context an analyst would use, read once for the job and kept
    // with it (owner 2026-10-29): their earlier words, and the research
    // brief Q writes from their whole situation -- what THIS question
    // needs. One brief call per job, inside the model-call cap.
    if (state.context === undefined) {
      const earlier = await (
        dependencies.earlierUserText?.(input.actor, input.runId) ??
        Promise.resolve([])
      ).catch((): readonly string[] => []);
      const kept = earlier
        .slice(-EARLIER_MAX)
        .map((text) => text.slice(0, EARLIER_CHARS));
      let brief: GroundedBrief | null = null;
      const situation =
        models.researchBrief === undefined
          ? null
          : await (
              dependencies.situation?.(input.actor, input.runId, request) ??
              Promise.resolve(null)
            ).catch(() => null);
      if (
        situation !== null &&
        models.researchBrief !== undefined &&
        modelCalls < MODEL_CALLS_MAX &&
        spend.canAfford(BRIEF_CEILING_USD)
      ) {
        modelCalls += 1;
        const raw = await models
          .researchBrief(who, trace, {
            request,
            earlier: kept.join("\n---\n").slice(0, 4_000),
            today,
            situation: briefSituation(situation).slice(0, 24_000),
          })
          .catch(() => null);
        spend.charge(raw?.costUsd ?? null, BRIEF_CEILING_USD);
        if (raw !== null) {
          try {
            brief = groundBrief({
              raw: raw.output,
              dossier: situation,
              words: [request, ...kept],
            });
          } catch {
            brief = null;
          }
        }
      }
      state.context = { earlier: kept, brief };
      await save();
    }
    const context = state.context;
    const brief = context.brief;
    if (brief !== null && brief.summary.length > 0)
      report({ stage: "PLANNING_RESEARCH", round: 1, brief: brief.summary });

    // The subject, as the planner reads it and egress may send it. A
    // company being diligenced: its name and country as they may read it.
    // Their own company: from the brief when there is one (it drew on
    // their whole situation); otherwise its name, country and sectors.
    const named =
      input.subject === undefined
        ? null
        : ((await dependencies
            .namedSubject?.(input.actor, input.subject.companyId)
            .catch(() => null)) ?? null);
    const ownSubject =
      input.subject === undefined && brief === null
        ? ((await dependencies.ownSubject?.(input.actor).catch(() => null)) ??
          null)
        : null;
    // A named company they may not read is researched from the request
    // alone -- never as their own company.
    const own =
      input.subject !== undefined
        ? named === null
          ? subjectLines(null)
          : diligenceSubjectLines(named)
        : brief !== null
          ? {
              text: "Their own situation, as far as this question needs it, is in THE RESEARCH BRIEF.",
              terms: [] as readonly string[],
            }
          : subjectLines(ownSubject);
    const subjectName =
      named?.name ?? ownSubject?.name ?? brief?.subjects[0] ?? null;
    const scope = brief?.scope ?? scopeOfWords([request, ...context.earlier]);
    // The market in question's countries, for source relevance: the
    // brief's places, else the person's own words.
    const marketCountries = new Set(
      placeCountries(
        brief !== null
          ? brief.places.join("\n")
          : [request, ...context.earlier].join("\n"),
      ),
    );

    // The brief's market countries, in its order: every outgoing query
    // carries one of them (withMarketPlace).
    const queryCountries =
      brief === null
        ? []
        : [...new Set(brief.places.flatMap((place) => placeCountries(place)))];
    const placed = (query: string) => withMarketPlace(query, queryCountries);

    const plannedLane = (one: {
      readonly lane: string;
      readonly query: string;
      readonly alsoQuery: string | null;
      readonly recent: boolean;
      readonly primary?: boolean | undefined;
    }): PlannedQuestion => ({
      lane: laneOf(one.lane),
      query: one.query.slice(0, 240),
      alsoQuery: one.alsoQuery === null ? null : one.alsoQuery.slice(0, 240),
      recent: one.recent,
      primary: one.primary === true,
    });
    const planOnce = async (
      gaps: readonly OpenGap[],
      firstRound: string = FIRST_ROUND_GAPS,
    ) => {
      modelCalls += 1;
      let failure: string | null | undefined;
      const planned = await models.planResearch(
        who,
        trace,
        {
          request,
          purpose: input.query.slice(0, 600),
          subject: own.text.slice(0, 1_200),
          brief:
            brief?.planner ??
            "No brief: Q could not read their situation for this question. Plan from the request alone; when it names no place, keep the queries global.",
          today,
          // Said, never left empty: an empty field reaches the prompt as
          // "(not provided)", which the planner sometimes read as a later
          // round with nothing open and planned no questions (re-recorded
          // case A, twice in four runs).
          gaps:
            gaps.length === 0
              ? firstRound
              : gaps.map(gapText).join("\n").slice(0, 4_000),
          asked:
            state.asked.length === 0
              ? "Nothing yet."
              : state.asked.join("\n").slice(0, 6_000),
        },
        {
          onFailed: (failureClass) => {
            failure = failureClass;
          },
        },
      );
      spend.charge(planned?.costUsd ?? null, PLAN_CEILING_USD);
      return { planned, failure };
    };
    // A transient failure is asked once more, inside the model-call cap,
    // the job's spend and round one's share of its deadline.
    const planCall = async (
      gaps: readonly OpenGap[],
      firstRound: string = FIRST_ROUND_GAPS,
    ) => {
      const first = await planOnce(gaps, firstRound);
      // A first round with no questions is a failed plan, not a finding:
      // the request asked for research. Asked once more, as a transient.
      const empty =
        gaps.length === 0 &&
        first.planned !== null &&
        first.planned.output.questions.length === 0;
      const transient =
        empty ||
        (first.planned === null &&
          first.failure !== undefined &&
          RETRIED_PLAN_FAILURES.has(first.failure ?? ""));
      if (
        !transient ||
        modelCalls >= MODEL_CALLS_MAX ||
        !spend.canAfford(PLAN_CEILING_USD) ||
        now() >= started + deadlineMs * 0.45
      )
        return { ...first, retried: false, transient };
      logger?.warn(
        { jobId: input.jobId, runId: input.runId, failure: first.failure },
        "deep research plan failed transiently; asked once more",
      );
      // An empty first round is asked again with what went wrong, never
      // the same request (see FIRST_ROUND_RETRY_GAPS); a transient
      // failure, the same request.
      const second = await planOnce(
        gaps,
        empty ? FIRST_ROUND_RETRY_GAPS : firstRound,
      );
      return {
        ...second,
        retried: true,
        transient:
          second.planned === null &&
          second.failure !== undefined &&
          RETRIED_PLAN_FAILURES.has(second.failure ?? ""),
      };
    };

    let stop: StopReason | null = null;
    // What stayed open when it stopped (set after each round).
    let open: readonly OpenGap[];
    const checkedNow = () =>
      checkedFacts(state.facts, subjectName, todayDate, marketCountries);
    const gapsNow = () =>
      openGaps({
        lanes: state.plan.map((question) => ({
          lane: question.lane,
          ran: state.lanes.some(
            (lane) =>
              lane.lane === question.lane &&
              (lane.status === "OK" || lane.status === "NOTHING_SAFE_TO_SEND"),
          ),
          primary: question.primary,
        })),
        facts: checkedNow(),
        tries: new Map(Object.entries(state.tries)),
        maxTries: LANE_TRIES_MAX,
      });

    // A round: plan (round one) or the open questions' queries, search,
    // read, cross-check -- each phase kept before the next begins.
    for (;;) {
      if (state.phase === "READ") {
        if (state.round === 0) {
          // 1. The plan, primary sources first.
          report({ stage: "PLANNING_RESEARCH", round: 1 });
          const plan = await planCall([]);
          const planned = plan.planned;
          let questions: PlannedQuestion[] = (planned?.output.questions ?? [])
            .slice(0, 12)
            .map(plannedLane);
          if (questions.length === 0) {
            // No plan: the person's own sentence, as one question, rather
            // than nothing. Honest only when it says so: the report and
            // the card state that the investigation ran reduced, and why
            // (2026-10-29: it read as a full investigation).
            state.reduced = reducedReason(plan);
            logger?.warn(
              { jobId: input.jobId, runId: input.runId, why: state.reduced },
              "deep research ran reduced: no research plan",
            );
            const phrase = searchPhrase(request);
            if (phrase.length > 0)
              questions = [
                {
                  lane: "GENERAL",
                  query: phrase.slice(0, 160),
                  alsoQuery: null,
                  recent: false,
                  primary: false,
                },
              ];
          }
          if (questions.length === 0) {
            return {
              status: "UNAVAILABLE",
              message: "There was nothing in the request to research.",
              reason: "NOTHING_TO_RESEARCH",
            };
          }
          if (budget.remaining() === 0) {
            budget.markLimited();
            return {
              status: "UNAVAILABLE",
              message:
                "This job's public search budget was already spent, so nothing more was searched.",
              reason: "NO_SOURCES",
            };
          }
          state.plan = questions;
          state.internalQuery =
            planned?.output.internalQuery?.trim().slice(0, 120) || null;
          // The job's search budget (2026-10-28): the planner orders
          // questions by importance; round one keeps searches back for
          // later rounds when the budget allows them at all.
          const reserve =
            budget.remaining() >= 6
              ? Math.min(GAP_QUESTIONS_MAX, Math.floor(budget.remaining() / 4))
              : 0;
          const roundOne = questions.slice(0, budget.remaining() - reserve);
          if (roundOne.length < questions.length) budget.markLimited();
          state.current = roundOne;
        } else {
          // 2. After a round: code's open questions decide whether to go on.
          open = gapsNow();
          // A run that had no plan (state.reduced) asks for one once more
          // after round one, whatever round one found.
          const recovering = state.reduced !== undefined && state.round === 1;
          if (open.length === 0 && !recovering) stop = "NO_GAPS";
          else if (state.round >= INVESTIGATION_ROUNDS_MAX) stop = "ROUND_CAP";
          else if (budget.remaining() === 0) {
            budget.markLimited();
            stop = "SEARCH_BUDGET";
          } else if (now() >= started + deadlineMs * 0.65) stop = "DEADLINE";
          else if (
            modelCalls + 1 + Math.min(open.length, GAP_QUESTIONS_MAX) >
              MODEL_CALLS_MAX ||
            !spend.canAfford(PLAN_CEILING_USD + FACTS_CEILING_USD)
          )
            stop = "MODEL_BUDGET";
          if (stop !== null) break;
          const asked = new Set(state.asked);
          const gapLanes = new Set(open.map((gap) => gap.lane));
          const next: PlannedQuestion[] = [];
          const take = (question: PlannedQuestion) => {
            const key = question.query.toLowerCase();
            if (asked.has(key) || next.length >= GAP_QUESTIONS_MAX) return;
            asked.add(key);
            next.push(question);
          };
          // A planned line the budget or a provider kept from running is
          // asked as planned first: no model is needed to know its query.
          for (const gap of open) {
            if (gap.reason !== "COULD_NOT_RUN") continue;
            const planned = state.plan.find((one) => one.lane === gap.lane);
            if (planned !== undefined) take(planned);
          }
          if (recovering) {
            report({ stage: "PLANNING_RESEARCH", round: state.round + 1 });
            const { planned } = await planCall([], RECOVERY_ROUND_GAPS);
            const recovered = (planned?.output.questions ?? [])
              .slice(0, PLAN_QUESTIONS_MAX)
              .map(plannedLane)
              .filter((question) => !asked.has(question.query.toLowerCase()));
            if (recovered.length > 0) {
              // Planned lines run from here on: the investigation is no
              // longer the request's own words alone.
              state.plan = [...state.plan, ...recovered];
              state.reduced = undefined;
              for (const question of recovered) {
                asked.add(question.query.toLowerCase());
                next.push(question);
              }
            }
          } else if (open.some((gap) => gap.reason !== "COULD_NOT_RUN")) {
            report({
              stage: "PLANNING_RESEARCH",
              round: state.round + 1,
              questions: open.length,
            });
            const { planned } = await planCall(
              open.filter((gap) => gap.reason !== "COULD_NOT_RUN"),
            );
            // Only the open questions' lines: anything else is dropped.
            for (const one of planned?.output.questions ?? []) {
              const question = plannedLane(one);
              if (gapLanes.has(question.lane)) take(question);
            }
          }
          // Round two also follows what round one's pages named.
          if (state.round === 1) {
            for (const lead of state.followUps.slice(0, FOLLOW_UPS_MAX)) {
              take({
                lane: laneOf(lead.lane),
                query: lead.query,
                alsoQuery: null,
                recent: false,
                primary: false,
              });
            }
          }
          if (next.length === 0) {
            stop = "NO_NEW_QUERIES";
            break;
          }
          state.current = next.slice(0, Math.max(1, budget.remaining()));
        }
        state.round += 1;
        state.phase = "PLANNED";
        await save();
      }

      if (state.phase === "PLANNED") {
        // 3. The round's searches, side by side.
        report({
          stage: "SEARCHING",
          questions: state.current.length,
          round: state.round,
        });
        const questions: DeepResearchQuestion[] = state.current.map((one) => ({
          lane: one.lane,
          query: placed(one.query),
          ...(one.alsoQuery === null
            ? {}
            : { alsoQuery: placed(one.alsoQuery) }),
          recent: one.recent,
        }));
        const result = await deep.run({
          actor: input.actor,
          runId: input.runId,
          correlationId,
          request,
          questions,
          // Their own company's identity may travel (their own facts), a
          // diligenced company's name and country, and the public words
          // earlier rounds read. Capital Q records never.
          // Owner 2026-10-29: and what the brief judged relevant AND public
          // (research-brief.ts) -- nothing else of their situation.
          publicTerms: [
            ...own.terms,
            ...(brief?.terms ?? []),
            ...state.publicTerms,
          ],
          earlierUserText: context.earlier,
          known: state.sources,
          deadlineAt: started + deadlineMs * (state.round === 1 ? 0.45 : 0.75),
          pagesPerQuestion: state.round === 1 ? PAGES_PER_LANE : 3,
          searchBudget: budget,
        });
        const knownIndex = new Set(state.sources.map((one) => one.index));
        const found = result.sources.filter(
          (one) => !knownIndex.has(one.index),
        );
        // The market's own official pages whose read failed: one longer
        // read each, inside the job's deadline.
        const reread = await rereadPrimary({
          service,
          actor: input.actor,
          runId: input.runId,
          correlationId,
          sources: found,
          countries: marketCountries,
          time,
          budgetMs: Math.min(
            PRIMARY_REREAD_MS,
            started + deadlineMs * 0.8 - now(),
          ),
        });
        const withRead = (one: DeepResearchSource): DeepResearchSource => {
          const page = one.extracted ? undefined : reread.get(urlKey(one.url));
          return page === undefined
            ? one
            : {
                ...one,
                title: one.title ?? page.title,
                excerpt: page.excerpt,
                extracted: true,
                instructionRisk: one.instructionRisk || page.instructionRisk,
              };
        };
        const fresh = found.map(withRead);
        state.sources = result.sources
          .slice(0, 60)
          .map(withRead)
          .map((one) => ({
            index: one.index,
            url: one.url,
            domain: one.domain,
            title: one.title?.slice(0, 400) ?? null,
            publishedAt: one.publishedAt,
            retrievedAt: one.retrievedAt,
            excerpt: knownIndex.has(one.index)
              ? ""
              : one.excerpt.slice(0, PAGE_CHARS),
            extracted: one.extracted,
            instructionRisk: one.instructionRisk,
            lanes: [...one.lanes],
          }));
        state.lanes = [...state.lanes, ...result.lanes].slice(0, 40);
        // A line the deadline or the search budget skipped never ran: it is
        // not asked, so the next round asks it as planned (a scripted case A
        // run lost INVESTMENT and OPPORTUNITIES this way, NO_NEW_QUERIES).
        const neverRan = new Set(
          result.lanes
            .filter(
              (lane) =>
                lane.status === "SKIPPED_DEADLINE" ||
                lane.status === "SKIPPED_BUDGET",
            )
            .map((lane) => lane.lane),
        );
        for (const question of state.current) {
          if (neverRan.has(question.lane)) continue;
          state.asked.push(question.query.toLowerCase());
          state.tries[question.lane] = (state.tries[question.lane] ?? 0) + 1;
        }
        for (const lane of result.lanes) {
          if (lane.query !== null) state.asked.push(lane.query.toLowerCase());
        }
        state.asked = [...new Set(state.asked)].slice(-80);
        addTerms(state.publicTerms, publicTermsOf(fresh));
        state.phase = "SEARCHED";
        await save();
        report({
          stage: "READING",
          sources: state.sources.length,
          read: readOf(state.sources),
        });
      }

      if (state.phase === "SEARCHED") {
        // 4. Facts from each line's new pages; code admits them.
        const answered = state.current.filter((question) =>
          state.lanes.some(
            (lane) => lane.lane === question.lane && lane.status === "OK",
          ),
        );
        const proposed: ProposedFact[] = [];
        const leads: { lane: string; query: string }[] = [];
        await mapLimit(answered, FACT_CALLS_AT_ONCE, async (question) => {
          const pages = pagesFor(question.lane, state.sources);
          if (pages.length === 0) return;
          if (
            now() >= started + deadlineMs ||
            modelCalls >= MODEL_CALLS_MAX ||
            !spend.canAfford(FACTS_CEILING_USD)
          ) {
            return;
          }
          modelCalls += 1;
          const read = await models.researchFacts(who, trace, {
            request,
            lane: question.lane.slice(0, 40),
            question: question.query.slice(0, 200),
            today,
            pages: [
              pagesText(pages).slice(0, 17_500),
              leadsText(question.lane, state.sources),
            ]
              .filter((part) => part.length > 0)
              .join("\n\n"),
          });
          spend.charge(read?.costUsd ?? null, FACTS_CEILING_USD);
          if (read === null) return;
          for (const fact of read.output.facts) {
            proposed.push({ ...fact, lane: question.lane });
          }
          for (const lead of read.output.followUps) {
            leads.push({ lane: laneOf(lead.lane), query: lead.query });
          }
        });
        const seen = new Set(
          state.facts.map((fact) => factKey(fact.statement)),
        );
        // Only pages actually read can stand behind a fact: a snippet of a
        // page that could not be read is a lead, never evidence.
        const { verified } = verifyFacts(
          proposed,
          state.sources
            .filter((one) => one.extracted)
            .map((one) => ({
              index: one.index,
              url: one.url,
              domain: one.domain,
              title: one.title,
              publishedAt: one.publishedAt,
              excerpt: one.excerpt,
            })),
          seen,
        );
        state.facts = [
          ...state.facts,
          ...verified.map((fact) => ({
            statement: fact.statement.slice(0, 400),
            figure: fact.figure?.slice(0, 80) ?? null,
            asOf: fact.asOf?.slice(0, 40) ?? null,
            source: fact.source,
            lane: fact.lane.slice(0, 40),
            kind: fact.kind,
            measure: fact.measure?.slice(0, 60) ?? null,
            entity: fact.entity?.slice(0, 60) ?? null,
            domain: fact.domain,
            title: fact.title?.slice(0, 400) ?? null,
            url: fact.url,
            publishedAt: fact.publishedAt,
          })),
        ].slice(0, 200);
        if (state.round === 1) state.followUps = leads.slice(0, 12);
        // Page text is not kept once read: the facts are.
        state.sources = state.sources.map((one) => ({ ...one, excerpt: "" }));
        state.phase = "READ";
        await save();
        report({
          stage: "CROSS_CHECKING",
          round: state.round,
          sources: state.sources.length,
          facts: state.facts.length,
        });
      }

      // Capital Q's own records, once, beside the web (never in a query).
      if (
        state.records === null &&
        state.internalQuery !== null &&
        dependencies.capitalQRecords !== undefined
      ) {
        const records = await dependencies
          .capitalQRecords(input.actor, { text: state.internalQuery })
          .catch(() => null);
        state.records = (records ?? []).slice(0, RECORDS_MAX);
        await save();
      }
    }

    if (state.sources.length === 0) {
      const unavailable = state.lanes.every(
        (lane) =>
          lane.status === "PROVIDER_UNAVAILABLE" || lane.status === "FAILED",
      );
      return {
        status: "UNAVAILABLE",
        message: unavailable
          ? "Public sources couldn't be checked just now."
          : "The searches found no public sources for this.",
        reason: unavailable ? "PUBLIC_UNAVAILABLE" : "NO_SOURCES",
      };
    }

    // 5. The dossier: cross-checked, ranked, both sides of every
    // contradiction kept, each source with its tier.
    const checked = checkedNow();
    const facts = dossierFacts(checked);
    const tierBySource = new Map(
      checked.map((fact) => [
        fact.source,
        { tier: fact.tier, tierKind: fact.tierKind },
      ]),
    );
    const couldNotRun = [
      ...new Set(
        state.plan
          .map((question) => question.lane)
          .filter(
            (lane) =>
              !state.lanes.some(
                (one) =>
                  one.lane === lane &&
                  (one.status === "OK" ||
                    one.status === "NOTHING_SAFE_TO_SEND"),
              ),
          ),
      ),
    ];
    const ms = Math.max(0, Math.round(now() - started));
    const searches = budget.limit - budget.remaining();
    report({
      stage: "CROSS_CHECKING",
      round: state.round,
      sources: state.sources.length,
      facts: facts.length,
    });
    logger?.info(
      {
        jobId: input.jobId,
        runId: input.runId,
        resumed: resumed !== null,
        rounds: state.round,
        stop,
        open: open.length,
        couldNotRun: couldNotRun.length,
        sources: state.sources.length,
        facts: facts.length,
        contradictory: facts.filter(
          (fact) => fact.lifecycleStatus === "CONTRADICTORY",
        ).length,
        records: state.records?.length ?? 0,
        searches,
        searchBudget: budget.limit,
        budgetLimited: budget.limited(),
        modelCalls,
        spentUsd: Number(spend.spent().toFixed(4)),
        ms,
      },
      "deep research finished",
    );
    const dossier: ResearchDossier = {
      version: 1,
      sources: state.sources.map((source) => {
        const tier =
          tierBySource.get(source.index) ??
          (() => {
            const own = sourceTier({
              url: source.url,
              domain: source.domain,
              title: source.title,
              countries: marketCountries,
            });
            return { tier: own.tier, tierKind: own.kind };
          })();
        return {
          index: source.index,
          url: source.url,
          domain: source.domain,
          title: source.title?.slice(0, 400) ?? null,
          publishedAt: source.publishedAt,
          tier: tier.tier,
          tierKind: tier.tierKind,
        };
      }),
      facts,
      lanes: state.lanes.slice(0, 40).map((lane) => ({
        lane: lane.lane.slice(0, 40),
        query: lane.query?.slice(0, 200) ?? null,
        status: lane.status,
        sources: lane.sources,
      })),
      ...(budget.limited() ? { budgetLimited: true } : {}),
      investigation: {
        rounds: state.round,
        stop: stop ?? "NO_GAPS",
        open: open.map((gap) => gapText(gap).slice(0, 300)).slice(0, 24),
        couldNotRun: couldNotRun.slice(0, 24),
        searches,
        modelCalls,
        ms,
        scope: scope.slice(0, 400),
        ...(state.reduced === undefined ? {} : { reduced: state.reduced }),
      },
      ...(state.records === null || state.records.length === 0
        ? {}
        : { records: state.records }),
      ...(brief === null
        ? {}
        : { brief: { summary: brief.summary, writer: brief.writer } }),
    };
    return {
      status: "OK",
      query: state.lanes.find((lane) => lane.query !== null)?.query ?? "",
      sources: state.sources.slice(0, 12).map((source) => ({
        url: source.url,
        title: source.title,
        domain: source.domain,
      })),
      dossier,
    };
  };
}
