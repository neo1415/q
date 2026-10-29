import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createPublicWebResearchService,
  type PublicWebResearchProvider,
} from "@capital-q/q-research";
import { ActorContextSchema } from "@capital-q/security";

import {
  analysisContent,
  investigationSections,
  mergeDossiers,
  recordsText,
  researchText,
  sourcesText,
} from "../src/composition/workforce/analysis.js";
import {
  InvestigationCheckpointSchema,
  workforceDeepResearch,
  type ResearchDossier,
} from "../src/composition/workforce/deep-research.js";
import type { LivePatch } from "../src/composition/workforce/live.js";
import type {
  ResearchFactsOutput,
  ResearchPlanInput,
  ResearchPlanOutput,
  WorkforceModels,
} from "../src/composition/workforce/models.js";
import { progressOf } from "../src/composition/workforce/progress.js";
import {
  checkpointKey,
  createInMemoryAgentWorkQueue,
} from "../src/composition/workforce/queue.js";

/**
 * Investigation-grade deep research (owner 2026-10-29), offline: a fake
 * search provider over synthetic pages about an invented market
 * ("Zedland widget payments"), fake models, no live call, no real company.
 */

const PRIVATE_MARKER = "Privmarkerco";
const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  actorType: "HUMAN",
});
const REQUEST =
  "Q, investigate the Zedland widget payments sector: market size, regulation and licences, competitors, news, and how it affects my fintech thesis. Give me an evidence-backed report.";

type Page = {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  /** Query words that surface it. */
  readonly topics: readonly string[];
  readonly publishedAt: string;
};

const PAGES: readonly Page[] = [
  {
    url: "https://alpha-news.test/zedland-widget-market",
    title: "Zedland widget payments market valued at USD 120 million",
    text: "The Zedland widget payments market was worth USD 120 million in 2025, according to analysts. The Zedland Central Bank circular on widget licences is expected soon.",
    topics: ["size"],
    publishedAt: "2026-02-01",
  },
  {
    url: "https://beta-research.test/zedland-widgets-2025",
    title: "Zedland widgets: an industry study",
    text: "Our study puts the Zedland widget payments market at USD 300 million in 2025.",
    topics: ["size", "report"],
    publishedAt: "2026-03-01",
  },
  {
    url: "https://alpha-news.test/widget-licence-rules",
    title: "Press: new widget licence rules coming",
    text: "Widget payment firms in Zedland will need a licence, the press reports, citing the Zedland Central Bank circular.",
    topics: ["regulation"],
    publishedAt: "2026-04-01",
  },
  {
    url: "https://www.zcb.gov.zz/circulars/widget-licensing",
    title: "Zedland Central Bank: widget licensing circular",
    text: "Circular: widget payment operators must hold a licence. 14 operators were licensed as of 2026.",
    topics: ["circular"],
    publishedAt: "2026-05-01",
  },
  {
    url: "https://gamma-blog.test/zedland-widget-competitors",
    title: "Who competes in Zedland widgets",
    text: "WidgetCo and PayZed are the largest widget payment firms in Zedland.",
    topics: ["competitors"],
    publishedAt: "2026-01-15",
  },
];

/** A search provider over the synthetic pages; records every query sent. */
function provider(sent: string[]): PublicWebResearchProvider {
  return {
    code: "brave",
    search: (request) => {
      sent.push(request.query);
      const words = request.query.toLowerCase().split(/\s+/u);
      return Promise.resolve({
        hits: PAGES.filter((page) =>
          page.topics.some((topic) => words.includes(topic)),
        ).map((page) => ({
          url: page.url,
          title: page.title,
          snippet: page.text.slice(0, 120),
          publishedAt: page.publishedAt,
          relevance: 0.8,
        })),
        latencyMs: 1,
      });
    },
    extract: (request) =>
      Promise.resolve({
        pages: request.urls.flatMap((url) => {
          const page = PAGES.find((one) => one.url === url);
          return page === undefined
            ? []
            : [{ url, title: page.title, text: page.text }];
        }),
        failedUrls: [],
        latencyMs: 1,
      }),
  };
}

const q = (lane: string, query: string, primary = false) => ({
  lane,
  query,
  alsoQuery: null,
  recent: false,
  primary,
});

/** The S number the pages text gives a page, by its title. */
function sourceOf(pages: string, title: string): number | null {
  for (const line of pages.split("\n")) {
    const match = /^S(\d+) \| (.*?) \|/u.exec(line);
    if (match !== null && match[2] === title) return Number(match[1]);
  }
  return null;
}

/** Facts each page carries, as a reader would propose them. */
const FACTS_BY_TITLE: Readonly<
  Record<string, ResearchFactsOutput["facts"][number]>
> = {
  [PAGES[0]?.title ?? ""]: {
    statement:
      "The Zedland widget payments market was worth USD 120 million in 2025.",
    figure: "USD 120 million",
    asOf: "2025",
    source: 0,
    kind: "FIGURE",
    measure: "market size",
    entity: "Zedland widget payments",
  },
  [PAGES[1]?.title ?? ""]: {
    statement:
      "An industry study puts the Zedland widget payments market at USD 300 million in 2025.",
    figure: "USD 300 million",
    asOf: "2025",
    source: 0,
    kind: "FIGURE",
    measure: "market size",
    entity: "Zedland widget payments",
  },
  [PAGES[2]?.title ?? ""]: {
    statement:
      "The press reports Zedland will require widget payment licences.",
    figure: null,
    asOf: "2026",
    source: 0,
    kind: "REGULATION",
    measure: null,
    entity: null,
  },
  [PAGES[3]?.title ?? ""]: {
    statement:
      "The Zedland Central Bank requires widget operators to be licensed; 14 were licensed as of 2026.",
    figure: "14",
    asOf: "2026",
    source: 0,
    kind: "REGULATION",
    measure: "licensed operators",
    entity: "Zedland widget payments",
  },
  [PAGES[4]?.title ?? ""]: {
    statement:
      "WidgetCo and PayZed are the largest widget payment firms in Zedland.",
    figure: null,
    asOf: null,
    source: 0,
    kind: "COMPETITOR",
    measure: null,
    entity: null,
  },
};

function readerOf(calls: { lane: string }[]): WorkforceModels["researchFacts"] {
  return (_who, _trace, input) => {
    calls.push({ lane: input.lane });
    const facts = Object.entries(FACTS_BY_TITLE).flatMap(([title, fact]) => {
      const source = sourceOf(input.pages, title);
      return source === null ? [] : [{ ...fact, source }];
    });
    return Promise.resolve({
      costUsd: 0.01,
      output: { facts, followUps: [] },
    });
  };
}

function planner(
  rounds: readonly ResearchPlanOutput[],
  inputs: ResearchPlanInput[],
): WorkforceModels["planResearch"] {
  return (_who, _trace, input) => {
    inputs.push(input);
    const output = rounds[Math.min(inputs.length - 1, rounds.length - 1)];
    return Promise.resolve(
      output === undefined ? null : { costUsd: 0.01, output },
    );
  };
}

function research(options: {
  readonly sent: string[];
  readonly models: Pick<WorkforceModels, "planResearch" | "researchFacts">;
  readonly jobSearchBudget?: number;
  readonly now?: () => number;
  readonly records?: boolean;
}) {
  const run = workforceDeepResearch({
    service: createPublicWebResearchService({
      provider: provider(options.sent),
    }),
    models: options.models,
    jobSearchBudget: options.jobSearchBudget ?? 40,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.records === true
      ? {
          capitalQRecords: () =>
            Promise.resolve([
              {
                companyId: randomUUID(),
                name: `${PRIVATE_MARKER} Widgets`,
                stage: "seed",
                country: "ZZ",
                description: "A synthetic company on Capital Q.",
              },
            ]),
        }
      : {}),
  });
  if (run === undefined) throw new Error("not composed");
  return run;
}

function memoryCheckpoint() {
  let held: unknown = null;
  const saves: unknown[] = [];
  return {
    saves,
    held: () => held,
    port: {
      load: () => Promise.resolve(held),
      save: (value: unknown) => {
        held = JSON.parse(JSON.stringify(value)) as unknown;
        saves.push(held);
        return Promise.resolve();
      },
    },
  };
}

const ROUND_ONE: ResearchPlanOutput = {
  questions: [
    q("MARKET_SIZE", "zedland widget payments market size"),
    q("REGULATION", "zedland widget payments regulation", true),
    q("COMPETITORS", "zedland widget payments competitors"),
  ],
  internalQuery: "widget payments seed",
};
const ROUND_TWO: ResearchPlanOutput = {
  questions: [
    q("REGULATION", "zedland central bank widget circular", true),
    q("MARKET_SIZE", "zedland widget payments industry report"),
    // Not an open question's line: dropped by code.
    q("UNRELATED", "zedland widget payments unrelated"),
  ],
  internalQuery: null,
};

describe("an investigation (owner 2026-10-29)", () => {
  it("plans, searches in rounds on code's open questions, tiers and cross-checks, and keeps both sides", async () => {
    const sent: string[] = [];
    const planInputs: ResearchPlanInput[] = [];
    const reads: { lane: string }[] = [];
    const stages: LivePatch[] = [];
    const run = research({
      sent,
      records: true,
      models: {
        planResearch: planner(
          [ROUND_ONE, ROUND_TWO, { questions: [] }],
          planInputs,
        ),
        researchFacts: readerOf(reads),
      },
    });
    const found = await run({
      actor,
      runId: randomUUID(),
      jobId: randomUUID(),
      request: REQUEST,
      query: "Investigate the Zedland widget payments sector",
      budgetUsd: 2,
      progress: (patch) => stages.push(patch),
    });
    expect(found.status).toBe("OK");
    if (found.status !== "OK" || found.dossier === undefined) return;
    const dossier = found.dossier;

    // Round two asked only for the open questions: the regulator's own
    // circular and a third market source; the unrelated line was dropped.
    expect(planInputs[1]?.gaps).toMatch(/REGULATION: no primary source yet/u);
    expect(planInputs[1]?.gaps).toMatch(/MARKET_SIZE: sources disagree/u);
    expect(planInputs[1]?.asked).toContain(
      "zedland widget payments market size",
    );
    expect(sent.some((query) => query.includes("unrelated"))).toBe(false);
    expect(sent.some((query) => query.includes("circular"))).toBe(true);
    // No query was sent twice.
    expect(new Set(sent).size).toBe(sent.length);

    // The regulator's page is primary, the press secondary or other.
    const regulator = dossier.sources.find((one) =>
      one.domain.endsWith("gov.zz"),
    );
    expect(regulator?.tier).toBe("PRIMARY");
    expect(regulator?.tierKind).toBe("GOVERNMENT_OR_REGULATOR");

    // Both market sizes kept, each CONTRADICTORY, each naming the other.
    const sizes = dossier.facts.filter((fact) => fact.lane === "MARKET_SIZE");
    expect(sizes.map((fact) => fact.figure).sort()).toEqual([
      "USD 120 million",
      "USD 300 million",
    ]);
    for (const fact of sizes) {
      expect(fact.lifecycleStatus).toBe("CONTRADICTORY");
      expect(fact.contradicts).toHaveLength(1);
    }
    // Primary first within its line.
    const regulation = dossier.facts.filter(
      (fact) => fact.lane === "REGULATION",
    );
    expect(regulation[0]?.tier).toBe("PRIMARY");
    expect(
      dossier.facts.every((fact) => fact.evidenceStatus !== undefined),
    ).toBe(true);

    // The investigation is summarised by code.
    expect(dossier.investigation?.rounds).toBeGreaterThanOrEqual(2);
    expect(dossier.investigation?.searches).toBe(sent.length);
    expect(dossier.investigation?.modelCalls).toBe(
      planInputs.length + reads.length,
    );

    // Capital Q records are kept apart and never reached a query or the planner.
    expect(dossier.records?.[0]?.name).toContain(PRIVATE_MARKER);
    expect(sent.join(" ").toLowerCase()).not.toContain(
      PRIVATE_MARKER.toLowerCase(),
    );
    expect(JSON.stringify(planInputs)).not.toContain(PRIVATE_MARKER);

    // The person sees each round in plain stages.
    expect(stages[0]).toEqual({ stage: "PLANNING_RESEARCH", round: 1 });
    expect(stages).toContainEqual(
      expect.objectContaining({ stage: "SEARCHING", round: 2 }),
    );
    expect(stages.some((one) => one.stage === "CROSS_CHECKING")).toBe(true);
  });

  it("stops when nothing is open", async () => {
    const sent: string[] = [];
    const inputs: ResearchPlanInput[] = [];
    const found = await research({
      sent,
      models: {
        planResearch: planner(
          [
            {
              questions: [
                q("COMPETITORS", "zedland widget payments competitors"),
              ],
            },
          ],
          inputs,
        ),
        researchFacts: readerOf([]),
      },
    })({
      actor,
      runId: randomUUID(),
      request: REQUEST,
      query: "x",
      budgetUsd: 2,
    });
    expect(found.status === "OK" && found.dossier?.investigation).toMatchObject(
      {
        rounds: 1,
        stop: "NO_GAPS",
      },
    );
    expect(inputs).toHaveLength(1);
  });

  it("stops at the round cap", async () => {
    const sent: string[] = [];
    let n = 0;
    const found = await research({
      sent,
      models: {
        planResearch: (_who, _trace, input) => {
          n += 1;
          // Round one: three lines nothing answers; later rounds a fresh
          // query for the first open line only.
          const first = /^([A-Z_]+):/u.exec(input.gaps)?.[1];
          return Promise.resolve({
            costUsd: 0.01,
            output:
              input.gaps === ""
                ? {
                    questions: [
                      q("LINE_A", "zedland widget payments nothing alpha"),
                      q("LINE_B", "zedland widget payments nothing beta"),
                      q("LINE_C", "zedland widget payments nothing gamma"),
                    ],
                  }
                : {
                    questions: [
                      q(
                        first ?? "LINE_A",
                        `zedland widget payments again ${String(n)}`,
                      ),
                    ],
                  },
          });
        },
        researchFacts: readerOf([]),
      },
    })({
      actor,
      runId: randomUUID(),
      request: REQUEST,
      query: "x",
      budgetUsd: 2,
    });
    expect(found.status).toBe("UNAVAILABLE");
    // No page answered anything: honest, not fabricated. Three rounds ran.
    expect(n).toBe(3);
  });

  it("stops on the job's search budget, the deadline, the model budget, and nothing new to ask", async () => {
    const zero = (stop: string) => ({ stop });
    // Search budget: two searches, both spent in round one.
    const budget = await research({
      sent: [],
      jobSearchBudget: 2,
      models: {
        planResearch: planner([ROUND_ONE], []),
        researchFacts: readerOf([]),
      },
    })({
      actor,
      runId: randomUUID(),
      jobId: randomUUID(),
      request: REQUEST,
      query: "x",
      budgetUsd: 2,
    });
    expect(
      budget.status === "OK" && budget.dossier?.investigation,
    ).toMatchObject(zero("SEARCH_BUDGET"));
    expect(budget.status === "OK" && budget.dossier?.budgetLimited).toBe(true);

    // Deadline: the reading of round one takes past two-thirds of it.
    let clock = 0;
    const late = await research({
      sent: [],
      now: () => clock,
      models: {
        planResearch: planner([ROUND_ONE], []),
        researchFacts: (who, trace, input) => {
          clock = 100_000;
          return readerOf([])(who, trace, input);
        },
      },
    })({
      actor,
      runId: randomUUID(),
      request: REQUEST,
      query: "x",
      budgetUsd: 2,
    });
    expect(late.status === "OK" && late.dossier?.investigation).toMatchObject(
      zero("DEADLINE"),
    );

    // Model budget: the step's dollars cannot carry another round.
    const poor = await research({
      sent: [],
      models: {
        planResearch: planner([ROUND_ONE], []),
        researchFacts: readerOf([]),
      },
    })({
      actor,
      runId: randomUUID(),
      request: REQUEST,
      query: "x",
      budgetUsd: 0.08,
    });
    expect(poor.status === "OK" && poor.dossier?.investigation).toMatchObject(
      zero("MODEL_BUDGET"),
    );

    // Nothing new: the planner repeats what was sent.
    const sent: string[] = [];
    const stale = await research({
      sent,
      models: {
        planResearch: planner([ROUND_ONE, ROUND_ONE], []),
        researchFacts: readerOf([]),
      },
    })({
      actor,
      runId: randomUUID(),
      request: REQUEST,
      query: "x",
      budgetUsd: 2,
    });
    expect(stale.status === "OK" && stale.dossier?.investigation).toMatchObject(
      zero("NO_NEW_QUERIES"),
    );
    expect(new Set(sent).size).toBe(sent.length);
  });

  it("resumes after a restart from its checkpoint, sending no query twice", async () => {
    const checkpoint = memoryCheckpoint();
    const jobId = randomUUID();
    const firstSent: string[] = [];
    let reads = 0;
    // The first worker dies while reading round two's pages.
    const first = research({
      sent: firstSent,
      models: {
        planResearch: planner([ROUND_ONE, ROUND_TWO, { questions: [] }], []),
        researchFacts: (who, trace, input) => {
          reads += 1;
          if (reads > 3) return Promise.reject(new Error("worker restarted"));
          return readerOf([])(who, trace, input);
        },
      },
    });
    await expect(
      first({
        actor,
        runId: randomUUID(),
        jobId,
        request: REQUEST,
        query: "x",
        budgetUsd: 2,
        checkpoint: checkpoint.port,
      }),
    ).rejects.toThrow("worker restarted");
    const kept = InvestigationCheckpointSchema.parse(checkpoint.held());
    expect(kept).toMatchObject({ round: 2, phase: "SEARCHED" });
    // Page text is kept only for the round still to be read.
    expect(kept.sources.some((one) => one.excerpt !== "")).toBe(true);

    // A new process: a fresh research composition and budget.
    const secondSent: string[] = [];
    const planInputs: ResearchPlanInput[] = [];
    const second = research({
      sent: secondSent,
      models: {
        planResearch: planner([{ questions: [] }], planInputs),
        researchFacts: readerOf([]),
      },
    });
    const found = await second({
      actor,
      runId: randomUUID(),
      jobId,
      request: REQUEST,
      query: "x",
      budgetUsd: 2,
      checkpoint: checkpoint.port,
    });
    expect(found.status).toBe("OK");
    // Round one was never planned again, and no query went out twice.
    expect(planInputs.every((input) => input.gaps !== "")).toBe(true);
    const all = [...firstSent, ...secondSent];
    expect(new Set(all).size).toBe(all.length);
    expect(secondSent.filter((query) => firstSent.includes(query))).toEqual([]);
    if (found.status !== "OK" || found.dossier === undefined) return;
    // Round two's pages were read after the restart: the circular's fact.
    expect(
      found.dossier.facts.some((fact) =>
        fact.statement.includes("14 were licensed"),
      ),
    ).toBe(true);
    // Resuming the same finished checkpoint again sends nothing more.
    const thirdSent: string[] = [];
    await research({
      sent: thirdSent,
      models: {
        planResearch: planner([{ questions: [] }], []),
        researchFacts: readerOf([]),
      },
    })({
      actor,
      runId: randomUUID(),
      jobId,
      request: REQUEST,
      query: "x",
      budgetUsd: 2,
      checkpoint: checkpoint.port,
    });
    expect(thirdSent).toEqual([]);
  });

  it("keeps a checkpoint on the job's row that no reader of results mistakes for a step", async () => {
    const queue = createInMemoryAgentWorkQueue();
    const owner = { tenantId: actor.tenantId, userId: actor.userId };
    const jobId = randomUUID();
    await queue.enqueue(owner, { jobId, plan: {}, trace: {} });
    await queue.claim("worker-1", 60_000, 1);
    await queue.recordCheckpoint?.(jobId, "worker-1", "research", {
      status: "CHECKPOINT",
      round: 1,
    });
    // Another worker's write is refused.
    await queue.recordCheckpoint?.(jobId, "worker-2", "research", { round: 9 });
    const [row] = await queue.forOwner(owner, [jobId]);
    expect(row?.results[checkpointKey("research")]).toEqual({
      status: "CHECKPOINT",
      round: 1,
    });
    expect(progressOf(row)).toBeUndefined();
  });
});

describe("the investigation report", () => {
  const dossier: ResearchDossier = {
    version: 1,
    sources: [
      {
        index: 1,
        url: PAGES[0]?.url ?? "",
        domain: "alpha-news.test",
        title: PAGES[0]?.title ?? null,
        publishedAt: "2026-02-01",
        tier: "OTHER",
        tierKind: null,
      },
      {
        index: 2,
        url: PAGES[1]?.url ?? "",
        domain: "beta-research.test",
        title: PAGES[1]?.title ?? null,
        publishedAt: "2026-03-01",
        tier: "OTHER",
        tierKind: null,
      },
      {
        index: 3,
        url: PAGES[3]?.url ?? "",
        domain: "www.zcb.gov.zz",
        title: PAGES[3]?.title ?? null,
        publishedAt: "2026-05-01",
        tier: "PRIMARY",
        tierKind: "GOVERNMENT_OR_REGULATOR",
      },
    ],
    facts: [
      {
        id: "F1",
        statement:
          "The Zedland widget payments market was worth USD 120 million in 2025.",
        figure: "USD 120 million",
        asOf: "2025",
        source: 1,
        lane: "MARKET_SIZE",
        kind: "FIGURE",
        domain: "alpha-news.test",
        title: null,
        url: PAGES[0]?.url ?? "",
        publishedAt: "2026-02-01",
        measure: "market size",
        entity: "Zedland widget payments",
        tier: "OTHER",
        tierKind: null,
        evidenceStatus: "DOCUMENT_SUPPORTED",
        lifecycleStatus: "CONTRADICTORY",
        corroboratedBy: [],
        contradicts: ["F2"],
      },
      {
        id: "F2",
        statement:
          "An industry study puts the market at USD 300 million in 2025.",
        figure: "USD 300 million",
        asOf: "2025",
        source: 2,
        lane: "MARKET_SIZE",
        kind: "FIGURE",
        domain: "beta-research.test",
        title: null,
        url: PAGES[1]?.url ?? "",
        publishedAt: "2026-03-01",
        measure: "market size",
        entity: "Zedland widget payments",
        tier: "OTHER",
        tierKind: null,
        evidenceStatus: "DOCUMENT_SUPPORTED",
        lifecycleStatus: "CONTRADICTORY",
        corroboratedBy: [],
        contradicts: ["F1"],
      },
      {
        id: "F3",
        statement: "14 widget operators were licensed as of 2026.",
        figure: "14",
        asOf: "2026",
        source: 3,
        lane: "REGULATION",
        kind: "REGULATION",
        domain: "www.zcb.gov.zz",
        title: null,
        url: PAGES[3]?.url ?? "",
        publishedAt: "2026-05-01",
        measure: null,
        entity: null,
        tier: "PRIMARY",
        tierKind: "GOVERNMENT_OR_REGULATOR",
        evidenceStatus: "DOCUMENT_SUPPORTED",
        lifecycleStatus: "CURRENT",
        corroboratedBy: [],
        contradicts: [],
      },
    ],
    lanes: [],
    investigation: {
      rounds: 2,
      stop: "NO_NEW_QUERIES",
      open: ["MARKET_SIZE: sources disagree"],
      couldNotRun: ["NEWS"],
      searches: 5,
      modelCalls: 6,
      ms: 1000,
    },
    records: [
      {
        companyId: randomUUID(),
        name: "Synthetic Widgets",
        stage: "seed",
        country: "ZZ",
        description: null,
      },
    ],
  };

  it("has the writer's sections, code's Contradictions and limits, tiered sources and per-fact status", () => {
    // Two research steps' dossiers: the second's ids are renumbered with
    // their cross-references.
    const merged = mergeDossiers([dossier, dossier]);
    expect(merged.facts[3]?.contradicts).toEqual(["F5"]);
    const research = researchText(merged.facts);
    expect(research.startsWith("INVESTIGATION")).toBe(true);
    expect(research).toMatch(/CONTRADICTORY: disagrees with F2/u);
    expect(research).toMatch(/primary: official/u);
    expect(sourcesText(merged.sources)).toMatch(/primary: official source/u);
    expect(recordsText(merged.records)).toMatch(/CAPITAL Q RECORDS/u);

    const headings = [
      "Executive summary",
      "Key developments",
      "Regulatory risks",
      "Competitive landscape",
      "Opportunities",
      "Implications for your thesis",
      "Gaps and next actions",
    ];
    const one = mergeDossiers([dossier]);
    const content = analysisContent({
      draft: {
        title: "Zedland widget payments: an investigation",
        summary: "Sources disagree on the market's size [S1] [S2].",
        sections: headings.map((heading) => ({
          heading,
          body:
            heading === "Regulatory risks"
              ? "The central bank licenses operators: 14 as of 2026 [S3]."
              : `${heading} (Q's inference).`,
        })),
        topRecommendations: ["Ask for the licence list."],
        gaps: [],
      },
      review: { passes: true, score: 85, drafts: 1, found: [], open: [] },
      sources: one.sources,
      facts: one.facts,
      seed: "job:step",
      codeSections: investigationSections({
        facts: one.facts,
        investigations: one.investigations,
      }),
    });
    const names = content.sections.map((section) => section.heading);
    for (const heading of [
      ...headings,
      "Contradictions",
      "What public sources cannot establish",
      "Sources",
    ]) {
      expect(names).toContain(heading);
    }
    const contradictions = content.sections.find(
      (s) => s.heading === "Contradictions",
    );
    expect(contradictions?.body).toMatch(/\[S1\].*against.*\[S2\]/u);
    const limits = content.sections.find(
      (s) => s.heading === "What public sources cannot establish",
    );
    expect(limits?.body).toMatch(/Beneficial ownership/u);
    expect(limits?.body).toMatch(/NEWS/u);
    const sources = content.sections.find((s) => s.heading === "Sources");
    // Both sides are cited by code's section, so both are listed, tiered.
    expect(sources?.body).toMatch(/\[S1\]/u);
    expect(sources?.body).toMatch(/\[S2\]/u);
    expect(sources?.body).toMatch(/\[S3\].*primary: official source/u);
    // Findings carry code's evidence and lifecycle, no percentages.
    const findings = content.sections.flatMap((s) => s.findings);
    expect(
      findings.find((f) => f.statement.includes("[S3]"))?.lifecycleStatus,
    ).toBe("CURRENT");
    expect(
      content.sections.every((s) => !/\d+\s?% confiden/u.test(s.body)),
    ).toBe(true);
  });
});
