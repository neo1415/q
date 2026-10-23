import { randomUUID } from "node:crypto";

import { CorrelationIdSchema } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  admitFacts,
  createDeepResearch,
  publicTermsOf,
  searchPhrase,
  type AdmittedFact,
  type DeepResearchLaneOutcome,
  type DeepResearchQuestion,
  type DeepResearchSource,
  type ProposedFact,
  type PublicWebResearchService,
} from "@capital-q/q-research";
import { z } from "zod";

import type { ResearchFound } from "./jobs.js";
import type { WorkforceModels } from "./models.js";
import type { WorkforcePortServices } from "./ports.js";

/**
 * A RESEARCH step as an analyst does it (owner 2026-10-23; production
 * 17:47 UTC ran ONE search for the keyword string "research kenya water
 * access and water kiosks market size competitors alternatives and to
 * maji growth" and found bottled-water reports and a how-to blog).
 *
 *   1. A model plans 6-12 focused questions from the request (market size,
 *      demand, competitors by name, alternatives, regulation, unit
 *      economics, news). It sees the person's request and the step's goal
 *      only -- nothing from their records -- so no private fact can be put
 *      in a query; every query is composed again by the egress policy.
 *   2. They run side by side over the configured providers (which fail
 *      over), each reading its best pages with the vetted page reader.
 *   3. A model reads each question's pages into dated, sourced facts and
 *      names what deserves a search of its own; one follow-up round runs
 *      those, with the first round's public words allowed to travel.
 *   4. Code admits a fact only when every number in it is on its page,
 *      deduplicates and ranks them (dossier.ts).
 *
 * Bounded by a wall-clock deadline and the step's budget; a question that
 * would not fit either is not started. Page text never leaves this step:
 * the dossier keeps facts, sources' addresses, titles and dates.
 */

export const DEEP_RESEARCH_DEADLINE_MS = 150_000;
const FACT_CALLS_AT_ONCE = 4;
const PAGES_PER_LANE = 4;
const PAGE_CHARS = 2_200;
const FOLLOW_UPS_MAX = 4;
const REQUEST_MAX = 4_000;

export const DossierSourceSchema = z
  .object({
    index: z.number().int().min(1),
    url: z.string().max(2_000),
    domain: z.string().max(300),
    title: z.string().max(400).nullable(),
    publishedAt: z.string().max(40).nullable(),
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
  })
  .strict();

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
      .max(24),
  })
  .strict();
export type ResearchDossier = z.infer<typeof ResearchDossierSchema>;

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

/** A lane's pages: those it found, read in full first. */
function pagesFor(
  lane: string,
  sources: readonly DeepResearchSource[],
): readonly DeepResearchSource[] {
  return sources
    .filter((source) => source.lanes.includes(lane))
    .sort((a, b) => Number(b.extracted) - Number(a.extracted))
    .slice(0, PAGES_PER_LANE);
}

export type DeepResearchInput = Parameters<
  NonNullable<WorkforcePortServices["research"]>
>[0];

export function workforceDeepResearch(dependencies: {
  readonly service: PublicWebResearchService | undefined;
  readonly models: Pick<WorkforceModels, "planResearch" | "researchFacts">;
  readonly now?: (() => number) | undefined;
  readonly deadlineMs?: number | undefined;
  readonly logger?: Logger | undefined;
}): WorkforcePortServices["research"] {
  const service = dependencies.service;
  if (service === undefined) return undefined;
  const now = dependencies.now ?? Date.now;
  const deep = createDeepResearch({
    service,
    clock: now,
    logger: dependencies.logger,
  });
  const { models, logger } = dependencies;

  return async (input): Promise<ResearchFound> => {
    const started = now();
    const deadlineMs = dependencies.deadlineMs ?? DEEP_RESEARCH_DEADLINE_MS;
    const who = { tenantId: input.actor.tenantId, userId: input.actor.userId };
    const trace =
      input.jobId === undefined
        ? null
        : { jobId: input.jobId, runId: input.runId };
    const spend = createSpend(input.budgetUsd ?? 0.6);
    const request = input.request.slice(0, REQUEST_MAX);
    const today = new Date(started).toISOString().slice(0, 10);
    const correlationId = CorrelationIdSchema.parse(`cor_${randomUUID()}`);

    // 1. The questions, planned by meaning from their request only.
    let questions: DeepResearchQuestion[] = [];
    const planned = await models.planResearch(who, trace, {
      request,
      purpose: input.query.slice(0, 600),
      subject: "Only what the request itself says.",
      today,
    });
    spend.charge(planned?.costUsd ?? null, 0.04);
    if (planned !== null) {
      questions = planned.output.questions.map((one) => ({
        lane: one.lane.toUpperCase().replace(/[^A-Z0-9]+/gu, "_"),
        query: one.query,
        ...(one.alsoQuery === null ? {} : { alsoQuery: one.alsoQuery }),
        recent: one.recent,
      }));
    }
    if (questions.length === 0) {
      // No plan: the person's own sentence, as one question, rather than
      // nothing. Honest, but it is the old single-search behaviour.
      const phrase = searchPhrase(request);
      if (phrase.length > 0)
        questions = [{ lane: "GENERAL", query: phrase.slice(0, 160) }];
    }
    if (questions.length === 0) {
      return {
        status: "UNAVAILABLE",
        message: "There was nothing in the request to research.",
      };
    }

    // 2. Round one, side by side.
    const first = await deep.run({
      actor: input.actor,
      runId: input.runId,
      correlationId,
      request,
      questions,
      deadlineAt: started + deadlineMs * 0.55,
      pagesPerQuestion: PAGES_PER_LANE,
    });
    if (first.sources.length === 0) {
      const unavailable = first.lanes.every(
        (lane) =>
          lane.status === "PROVIDER_UNAVAILABLE" || lane.status === "FAILED",
      );
      return {
        status: "UNAVAILABLE",
        message: unavailable
          ? "Public sources couldn't be checked just now."
          : "The searches found no public sources for this.",
      };
    }

    // 3. Facts from each question's pages; what to search next.
    const proposed: ProposedFact[] = [];
    const followUps: DeepResearchQuestion[] = [];
    const readFacts = async (
      lanes: readonly DeepResearchQuestion[],
      sources: readonly DeepResearchSource[],
    ) =>
      mapLimit(lanes, FACT_CALLS_AT_ONCE, async (question) => {
        const pages = pagesFor(question.lane, sources);
        if (pages.length === 0) return;
        if (
          now() >= started + deadlineMs ||
          !spend.canAfford(0.05)
        )
          return;
        const read = await models.researchFacts(who, trace, {
          request,
          lane: question.lane.slice(0, 40),
          question: question.query.slice(0, 200),
          today,
          pages: pagesText(pages),
        });
        spend.charge(read?.costUsd ?? null, 0.05);
        if (read === null) return;
        for (const fact of read.output.facts) {
          proposed.push({ ...fact, lane: question.lane });
        }
        for (const next of read.output.followUps) {
          followUps.push({
            lane: next.lane.toUpperCase().replace(/[^A-Z0-9]+/gu, "_"),
            query: next.query,
          });
        }
      });
    const answered = questions.filter((question) =>
      first.lanes.some(
        (lane) => lane.lane === question.lane && lane.status === "OK",
      ),
    );
    await readFacts(answered, first.sources);

    // 4. One follow-up round on what the pages named, while time allows.
    let sources: readonly DeepResearchSource[] = first.sources;
    let lanes: readonly DeepResearchLaneOutcome[] = first.lanes;
    const asked = new Set(questions.map((q) => q.query.toLowerCase()));
    const second = followUps
      .filter((one) => {
        const key = one.query.toLowerCase();
        if (asked.has(key)) return false;
        asked.add(key);
        return true;
      })
      .slice(0, FOLLOW_UPS_MAX);
    if (
      second.length > 0 &&
      now() < started + deadlineMs * 0.7 &&
      spend.canAfford(0.05 * second.length)
    ) {
      const more = await deep.run({
        actor: input.actor,
        runId: input.runId,
        correlationId,
        request,
        questions: second,
        publicTerms: publicTermsOf(first.sources),
        known: first.sources,
        deadlineAt: started + deadlineMs * 0.8,
        pagesPerQuestion: 3,
      });
      const fresh = more.sources.filter(
        (source) =>
          !first.sources.some((known) => known.index === source.index),
      );
      sources = more.sources;
      lanes = [...first.lanes, ...more.lanes];
      await readFacts(
        second.filter((question) =>
          fresh.some((source) => source.lanes.includes(question.lane)),
        ),
        fresh,
      );
    }

    // 5. Code's admission: every number on its page, deduplicated, ranked.
    const admitted = admitFacts(
      proposed,
      sources.map((source) => ({
        index: source.index,
        url: source.url,
        domain: source.domain,
        title: source.title,
        publishedAt: source.publishedAt,
        excerpt: source.excerpt,
      })),
    );
    logger?.info(
      {
        jobId: input.jobId,
        runId: input.runId,
        questions: questions.length,
        followUps: second.length,
        sources: sources.length,
        proposed: proposed.length,
        admitted: admitted.admitted.length,
        refused: admitted.refused.length,
        spentUsd: Number(spend.spent().toFixed(4)),
        ms: now() - started,
      },
      "deep research finished",
    );
    const dossier: ResearchDossier = {
      version: 1,
      sources: sources.map((source) => ({
        index: source.index,
        url: source.url,
        domain: source.domain,
        title: source.title?.slice(0, 400) ?? null,
        publishedAt: source.publishedAt,
      })),
      facts: admitted.admitted.map((fact: AdmittedFact) => ({
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
      })),
      lanes: lanes.slice(0, 24).map((lane) => ({
        lane: lane.lane.slice(0, 40),
        query: lane.query,
        status: lane.status,
        sources: lane.sources,
      })),
    };
    return {
      status: "OK",
      query: lanes.find((lane) => lane.query !== null)?.query ?? "",
      sources: sources.slice(0, 12).map((source) => ({
        url: source.url,
        title: source.title,
        domain: source.domain,
      })),
      dossier,
    };
  };
}
