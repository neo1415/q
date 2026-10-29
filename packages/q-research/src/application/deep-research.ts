import type { CorrelationId } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import type { PublicWebFreshness } from "../contracts.js";
import { normaliseWebAddress } from "../domain/url-safety.js";
import type {
  PublicWebResearchService,
  ResearchedSource,
} from "./research-service.js";

/**
 * Deep research (owner 2026-10-23): a set of focused questions a model
 * planned from the person's request -- market size, demand, competitors by
 * name, alternatives, regulation, unit economics, recent news -- run side
 * by side through the one research service, so every question goes
 * through the same egress composition, URL safety, page reading and
 * instruction scanning as any other search. Nothing here decides WHAT is
 * researched (the planner does) and nothing here reads a page itself.
 *
 * Bounded three ways: the number of questions, a wall-clock deadline (a
 * question that has not started by then is skipped, never queued), and the
 * pages read per question. Sources found by several questions are kept
 * once, with every question that found them.
 */

export type DeepResearchQuestion = {
  /** The planner's label for the line of enquiry (e.g. MARKET_SIZE). */
  readonly lane: string;
  /** The planned query. Untrusted: composed before egress like any query. */
  readonly query: string;
  /** One other phrasing of the same question, composed the same way. */
  readonly alsoQuery?: string | undefined;
  /** Recent coverage matters for this question (news, funding, policy). */
  readonly recent?: boolean | undefined;
};

export type DeepResearchSource = {
  /** S1, S2 ... in the order first found. */
  readonly index: number;
  readonly url: string;
  readonly domain: string;
  readonly title: string | null;
  readonly publishedAt: string | null;
  readonly retrievedAt: string;
  /** Bounded, cleaned, instruction-scanned page text (or the snippet). */
  readonly excerpt: string;
  /** Read in full (true) or known from the search snippet only. */
  readonly extracted: boolean;
  /** Instruction-shaped text was found in it: data, never instruction. */
  readonly instructionRisk: boolean;
  readonly lanes: readonly string[];
};

export type DeepResearchLaneOutcome = {
  readonly lane: string;
  /** The query that left Capital Q; null when nothing was safe to send. */
  readonly query: string | null;
  readonly status:
    | "OK"
    | "NOTHING_SAFE_TO_SEND"
    | "PROVIDER_UNAVAILABLE"
    | "SKIPPED_DEADLINE"
    /** The job's search budget was spent before it started. */
    | "SKIPPED_BUDGET"
    | "FAILED";
  readonly sources: number;
};

/**
 * One job's searches across every provider and research step (diligence
 * audit 2026-10-28: planned questions bypassed the per-run budget, up to
 * ~32 searches a step). A question reserves what it may send before it
 * starts, and gives back what it did not use.
 */
export type SearchBudget = {
  readonly limit: number;
  readonly remaining: () => number;
  /** Reserves up to `wanted`; how many were granted (0: none left). */
  readonly reserve: (wanted: number) => number;
  readonly refund: (unused: number) => void;
  /** Whether any question was skipped or narrowed for it. */
  readonly limited: () => boolean;
  readonly markLimited: () => void;
};

export function createSearchBudget(limit: number): SearchBudget {
  const cap = Math.max(0, Math.floor(limit));
  let used = 0;
  let limited = false;
  return {
    limit: cap,
    remaining: () => cap - used,
    reserve: (wanted) => {
      const granted = Math.max(0, Math.min(Math.floor(wanted), cap - used));
      used += granted;
      return granted;
    },
    refund: (unused) => {
      used = Math.max(0, used - Math.max(0, Math.floor(unused)));
    },
    limited: () => limited,
    markLimited: () => {
      limited = true;
    },
  };
}

export type DeepResearchResult = {
  readonly sources: readonly DeepResearchSource[];
  readonly lanes: readonly DeepResearchLaneOutcome[];
};

export type DeepResearchCommand = {
  readonly actor: ActorContext;
  readonly runId: string;
  readonly correlationId: CorrelationId;
  /** The person's request, in their words (the egress allowlist). */
  readonly request: string;
  readonly questions: readonly DeepResearchQuestion[];
  /** Words from public pages an earlier round read (egress.ts). */
  readonly publicTerms?: readonly string[] | undefined;
  /**
   * The person's own earlier messages in the conversation that asked
   * (owner 2026-10-29: "Lagos" said a turn before places the question in
   * Nigeria). Their words, never Q's.
   */
  readonly earlierUserText?: readonly string[] | undefined;
  /** Epoch ms after which no new question starts. */
  readonly deadlineAt: number;
  readonly signal?: AbortSignal | undefined;
  /** Questions in flight at once. */
  readonly concurrency?: number | undefined;
  /** Pages read per question. */
  readonly pagesPerQuestion?: number | undefined;
  /** Sources kept over the whole set. */
  readonly maxSources?: number | undefined;
  /** Sources an earlier round already holds: never repeated, numbered on. */
  readonly known?: readonly DeepResearchSource[] | undefined;
  /** The job's search budget, shared by every round and step of it. */
  readonly searchBudget?: SearchBudget | undefined;
};

export const DEEP_RESEARCH_BOUNDS = {
  maxQuestions: 12,
  concurrency: 4,
  pagesPerQuestion: 4,
  maxSources: 48,
} as const;

export function createDeepResearch(dependencies: {
  readonly service: Pick<PublicWebResearchService, "research">;
  readonly clock?: (() => number) | undefined;
  readonly logger?: Logger | undefined;
}) {
  const now = dependencies.clock ?? Date.now;

  return {
    run: async (command: DeepResearchCommand): Promise<DeepResearchResult> => {
      const questions = command.questions.slice(
        0,
        DEEP_RESEARCH_BOUNDS.maxQuestions,
      );
      const concurrency = Math.max(
        1,
        Math.min(
          command.concurrency ?? DEEP_RESEARCH_BOUNDS.concurrency,
          DEEP_RESEARCH_BOUNDS.concurrency,
        ),
      );
      const pages = Math.max(
        1,
        Math.min(
          command.pagesPerQuestion ?? DEEP_RESEARCH_BOUNDS.pagesPerQuestion,
          6,
        ),
      );
      const outcomes: (DeepResearchLaneOutcome | undefined)[] = new Array<
        DeepResearchLaneOutcome | undefined
      >(questions.length).fill(undefined);
      const found: (readonly ResearchedSource[])[] = new Array<
        readonly ResearchedSource[]
      >(questions.length).fill([]);
      let next = 0;
      const aborted = () => command.signal?.aborted === true;
      const budget = command.searchBudget;
      // A budget too tight for two phrasings a question: one each, so more
      // lines of enquiry are searched rather than fewer twice.
      const onePhrasing =
        budget !== undefined && budget.remaining() < questions.length * 2;

      const worker = async () => {
        for (;;) {
          const position = next;
          next += 1;
          const question = questions[position];
          if (question === undefined) return;
          if (now() >= command.deadlineAt || aborted()) {
            outcomes[position] = {
              lane: question.lane,
              query: null,
              status: "SKIPPED_DEADLINE",
              sources: 0,
            };
            continue;
          }
          const wanted =
            question.alsoQuery === undefined || onePhrasing ? 1 : 2;
          const granted =
            budget === undefined ? wanted : budget.reserve(wanted);
          if (granted === 0) {
            budget?.markLimited();
            outcomes[position] = {
              lane: question.lane,
              query: null,
              status: "SKIPPED_BUDGET",
              sources: 0,
            };
            continue;
          }
          if (
            budget !== undefined &&
            granted < (question.alsoQuery === undefined ? 1 : 2)
          ) {
            budget.markLimited();
          }
          // What the call really sent; until it answers, all it was granted.
          let sent = granted;
          try {
            const freshness: PublicWebFreshness =
              question.recent === true ? "PAST_YEAR" : "ANY";
            const outcome = await dependencies.service.research({
              actor: command.actor,
              runId: command.runId,
              correlationId: command.correlationId,
              requestedQuery: question.query,
              ...(question.alsoQuery === undefined || granted < 2
                ? {}
                : { alsoQueries: [question.alsoQuery] }),
              ...(budget === undefined ? {} : { maxSearches: granted }),
              userText: command.request,
              ...(command.earlierUserText === undefined
                ? {}
                : { earlierUserText: command.earlierUserText }),
              subject: null,
              freshness,
              extractCount: pages,
              focused: true,
              planned: true,
              researchVocabulary: true,
              ...(command.publicTerms === undefined
                ? {}
                : { publicTerms: command.publicTerms }),
              ...(command.signal === undefined
                ? {}
                : { signal: command.signal }),
            });
            if (outcome.status === "OK") {
              sent = outcome.budget.searchCalls;
              found[position] = outcome.sources;
              outcomes[position] = {
                lane: question.lane,
                query: outcome.query,
                status: "OK",
                sources: outcome.sources.length,
              };
            } else {
              // Nothing safe to send sent nothing; a provider failure did.
              if (outcome.status === "NO_PUBLIC_IDENTITY") sent = 0;
              outcomes[position] = {
                lane: question.lane,
                query: null,
                status:
                  outcome.status === "NO_PUBLIC_IDENTITY"
                    ? "NOTHING_SAFE_TO_SEND"
                    : "PROVIDER_UNAVAILABLE",
                sources: 0,
              };
            }
          } catch (error: unknown) {
            if (aborted()) throw error;
            dependencies.logger?.warn(
              { err: error, runId: command.runId, lane: question.lane },
              "a deep research question failed",
            );
            outcomes[position] = {
              lane: question.lane,
              query: null,
              status: "FAILED",
              sources: 0,
            };
          } finally {
            budget?.refund(granted - Math.min(granted, Math.max(0, sent)));
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, questions.length) }, () =>
          worker(),
        ),
      );

      const sources = mergeSources(
        command.known ?? [],
        questions.map((question, position) => ({
          lane: question.lane,
          sources: found[position] ?? [],
        })),
        command.maxSources ?? DEEP_RESEARCH_BOUNDS.maxSources,
      );
      const lanes = outcomes.map(
        (outcome, position): DeepResearchLaneOutcome =>
          outcome ?? {
            lane: questions[position]?.lane ?? "UNKNOWN",
            query: null,
            status: "FAILED",
            sources: 0,
          },
      );
      dependencies.logger?.info(
        {
          runId: command.runId,
          questions: questions.length,
          answered: lanes.filter((lane) => lane.status === "OK").length,
          sources: sources.length,
        },
        "deep research round finished",
      );
      return { sources, lanes };
    },
  };
}

export type DeepResearch = ReturnType<typeof createDeepResearch>;

/**
 * Every question's sources as one numbered list: a page several questions
 * found is kept once, with each question that found it. Earlier rounds'
 * sources keep their numbers; new ones are numbered on from them.
 */
export function mergeSources(
  known: readonly DeepResearchSource[],
  byLane: readonly {
    readonly lane: string;
    readonly sources: readonly ResearchedSource[];
  }[],
  maxSources: number,
): readonly DeepResearchSource[] {
  const merged = new Map<string, DeepResearchSource>();
  for (const source of known) {
    merged.set(keyOf(source.url), source);
  }
  let index = known.reduce((max, source) => Math.max(max, source.index), 0);
  // Round-robin over the questions, so a question that found many pages
  // does not crowd out the one that found the only regulator's page.
  const longest = Math.max(0, ...byLane.map((lane) => lane.sources.length));
  for (let rank = 0; rank < longest; rank += 1) {
    for (const lane of byLane) {
      const source = lane.sources[rank];
      if (source === undefined) continue;
      const key = keyOf(source.url);
      const existing = merged.get(key);
      if (existing !== undefined) {
        if (!existing.lanes.includes(lane.lane)) {
          merged.set(key, {
            ...existing,
            lanes: [...existing.lanes, lane.lane],
          });
        }
        continue;
      }
      if (merged.size >= maxSources) continue;
      index += 1;
      merged.set(key, {
        index,
        url: source.url,
        domain: source.domain,
        title: source.title,
        publishedAt: source.publishedAt,
        retrievedAt: source.retrievedAt,
        excerpt: source.excerpt,
        extracted: source.extracted,
        instructionRisk: source.instructionRisk.length > 0,
        lanes: [lane.lane],
      });
    }
  }
  return [...merged.values()].sort((a, b) => a.index - b.index);
}

function keyOf(url: string): string {
  return (normaliseWebAddress(url)?.url ?? url)
    .toLowerCase()
    .replace(/#.*$/u, "")
    .replace(/\/+$/u, "");
}

/**
 * What an earlier round's public pages said, as egress allowance for the
 * next round (titles and excerpts only; figures never pass egress).
 */
export function publicTermsOf(
  sources: readonly DeepResearchSource[],
  maxChars = 24_000,
): readonly string[] {
  const terms: string[] = [];
  let used = 0;
  for (const source of sources) {
    for (const text of [source.title ?? "", source.excerpt]) {
      if (text.length === 0 || used >= maxChars) continue;
      const kept = text.slice(0, maxChars - used);
      terms.push(kept);
      used += kept.length;
    }
  }
  return terms;
}
