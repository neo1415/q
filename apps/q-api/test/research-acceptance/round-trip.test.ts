import { describe, expect, it } from "vitest";

import type { ModelGatewayResult } from "@capital-q/contracts";
import type {
  ModelGateway,
  ModelGatewayExecuteOptions,
} from "@capital-q/model-gateway";
import { createRecordingResearchProvider } from "@capital-q/q-research/providers/recorded";
import { createFakeResearchProvider } from "@capital-q/q-research/testing";

import { loadCases } from "./case.js";
import { checkCase } from "./expectations.js";
import { runCase } from "./pipeline.js";
import { createRecordingModelGateway } from "./recorded-gateway.js";
import { replayCase } from "./replay.js";

/**
 * The gate's machinery, proven without credits: a case is recorded over
 * scripted edges (a fake web, a scripted model) through the REAL
 * deep-research step and report assembly, then replayed from those
 * recordings alone. The replay must ask exactly what the recording held
 * -- the same queries, pages and model requests -- or the hashes and
 * keys this gate relies on are not deterministic.
 *
 * The scripted edges are not the acceptance cases' evidence: those are
 * recorded live (scripts/research-acceptance/record.mjs).
 */

const RECORDED_AT = "2026-10-29T12:00:00.000Z";

const PAGES = [
  {
    url: "https://www.cbn.gov.ng/out/2026/psp-licensing.html",
    title: "CBN: payment service provider licensing",
    snippet: "Payment service providers must be licensed by the CBN.",
    text: "Payment service providers in Nigeria must be licensed by the Central Bank of Nigeria. 14 PSPs were licensed in 2026.",
    publishedAt: "2026-05-01",
  },
  {
    url: "https://techcabal.com/2026/09/nigeria-b2b-payments",
    title: "Nigerian B2B payments in 2026",
    snippet: "Moniepoint and Paystack compete for business payments.",
    text: "Moniepoint and Paystack compete for Nigerian business payments.",
    publishedAt: "2026-09-10",
  },
];

const metadata = {
  providerCode: "fake",
  modelCode: "fake-model",
  taskClass: "EVIDENCE_SYNTHESIS",
  routingPolicyCode: "fake_policy.v1",
  usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
  latencyMs: 1,
  finish: "COMPLETE",
  cost: { currency: "USD", amount: 0, basis: "UNPRICED" },
  attempts: [
    {
      attempt: 1,
      providerCode: "fake",
      modelCode: "fake-model",
      outcome: "SUCCESS",
      latencyMs: 1,
      candidateIndex: 0,
    },
  ],
  fallbackUsed: false,
  route: {
    routingPolicyCode: "fake_policy.v1",
    routingPolicyVersion: 1,
    candidates: [],
    selectedCandidateIndex: 0,
    fallbackUsed: false,
  },
  completedAt: RECORDED_AT,
} satisfies Omit<ModelGatewayResult<never>, "output" | "taskClass"> & {
  taskClass: "EVIDENCE_SYNTHESIS";
};

/** A scripted model: one answer per schema, the plan once then nothing. */
function scriptedGateway(): ModelGateway {
  let plans = 0;
  const answer = (schemaName: string | null): unknown => {
    switch (schemaName ?? "TEXT") {
      // The research brief, from the case's situation dossier: the market
      // from the mandate, the regulator by its full public name.
      case "ResearchBriefResult":
        return {
          question:
            "The Nigerian B2B payments sector against their seed fintech mandate.",
          market: {
            places: [{ name: "Nigeria", from: '"Nigerian"' }],
            sectors: [{ name: "B2B payments", from: "F13" }],
            stage: null,
            subjects: [{ name: "Central Bank of Nigeria", from: "F2" }],
          },
          relevant: [
            { ref: "F13", why: "Their mandate." },
            { ref: "F11", why: "A Nigerian payments company they watch." },
          ],
          unknowns: [],
          angles: ["payment service provider licensing"],
          irrelevant: ["agritech in Kenya"],
          summary: "Nigerian B2B payments against your fintech mandate.",
        };
      case "ResearchPlanResult":
        plans += 1;
        return plans > 1
          ? { questions: [], internalQuery: null }
          : {
              questions: [
                {
                  lane: "REGULATION",
                  query: "Nigeria CBN payment service provider licensing",
                  alsoQuery: null,
                  recent: true,
                  primary: true,
                },
                {
                  lane: "COMPETITORS",
                  query: "Nigerian B2B payments competitors",
                  alsoQuery: null,
                  recent: true,
                  primary: false,
                },
              ],
              internalQuery: "B2B payments",
            };
      case "ResearchFactsResult":
        return {
          facts: [
            {
              statement:
                "Payment service providers in Nigeria must be licensed by the Central Bank of Nigeria.",
              figure: null,
              asOf: "2026",
              source: 1,
              kind: "REGULATION",
              measure: null,
              entity: null,
            },
          ],
          followUps: [],
        };
      case "AnalysisDocumentResult":
        return {
          title: "Nigerian B2B payments",
          summary: "Licensing is the gate to the market [S1].",
          sections: [
            {
              heading: "Regulatory risks",
              body: "Payment service providers must be licensed [S1].",
            },
            {
              heading: "Competitive landscape",
              body: "Public sources name established players; on Capital Q, LedgerBridge is a declared profile.",
            },
            {
              heading: "Implications for the thesis",
              body: "The mandate's Nigeria seed fintech focus makes licensing the first diligence question.",
            },
          ],
          topRecommendations: ["Ask LedgerBridge for its licence status."],
          gaps: ["Market size is not known."],
        };
      case "AnalysisCritiqueResult":
        return { passes: true, score: 90, issues: [], strengths: [] };
      default:
        return null;
    }
  };
  return {
    execute: <T>(
      request: Parameters<ModelGateway["execute"]>[0],
      options?: ModelGatewayExecuteOptions<T>,
    ): Promise<ModelGatewayResult<T>> => {
      const schemaName =
        request.output.kind === "STRUCTURED" ? request.output.schemaName : null;
      const parsed = options?.schema?.safeParse(answer(schemaName));
      if (parsed?.success !== true)
        return Promise.reject(
          new Error(`no scripted answer for ${String(schemaName)}`),
        );
      return Promise.resolve({
        ...metadata,
        taskClass: request.taskClass,
        output: { kind: "STRUCTURED", value: parsed.data },
      });
    },
  };
}

describe("research acceptance: record, then replay", () => {
  const caseA = loadCases().find((one) => one.id.startsWith("A-"));
  if (caseA === undefined) throw new Error("case A is missing");

  it("replays a recording through the real code with no miss and the same queries", async () => {
    const web = createRecordingResearchProvider({
      provider: createFakeResearchProvider({ pages: PAGES }),
      clock: () => new Date(RECORDED_AT),
    });
    const models = createRecordingModelGateway({
      gateway: scriptedGateway(),
      clock: () => new Date(RECORDED_AT),
    });
    const started = Date.now();
    const recorded = await runCase({
      case: caseA,
      provider: web,
      gateway: models,
      now: () => Date.parse(RECORDED_AT) + (Date.now() - started),
    });
    expect(recorded.content).not.toBeNull();
    const fixtures = { web: web.fixture(), models: models.fixture() };
    expect(fixtures.web.searches.length).toBeGreaterThan(0);
    expect(fixtures.models.calls.length).toBeGreaterThan(0);

    const replayed = await replayCase(caseA, fixtures);
    expect(replayed.misses).toEqual([]);
    expect(replayed.queries.map((query) => query.toLowerCase()).sort()).toEqual(
      fixtures.web.searches.map((search) => search.key).sort(),
    );
    // The checks run over the replay: the brief was written, and the
    // planned regulator query left whole (live run A sent it without its
    // place).
    const ids = replayed.checks.map((check) => check.id);
    expect(ids).toContain("PLACE_IN_EVERY_QUERY");
    expect(
      replayed.checks.find((check) => check.id === "BRIEF_WRITTEN")?.ok,
    ).toBe(true);
    expect(fixtures.web.searches.map((search) => search.query)).toContain(
      "nigeria cbn payment service provider licensing",
    );
    expect(
      replayed.checks.find((check) => check.id === "NO_PRIVATE_IN_QUERIES")?.ok,
    ).toBe(true);
    expect(
      checkCase({
        case: caseA,
        run: recorded,
        queries: fixtures.web.searches.map((search) => search.query),
        web: fixtures.web,
        modelCalls: models.seen,
      }).find((check) => check.id === "CITATIONS_RESOLVE")?.ok,
    ).toBe(true);
  }, 60_000);
});
