import { describe, expect, it } from "vitest";

import type { ModelGatewayResult } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";

import { loadCases } from "./case.js";
import { checkCase, governmentCountry } from "./expectations.js";
import type { CaseRun } from "./pipeline.js";
import {
  createRecordingModelGateway,
  createReplayModelGateway,
  RecordedModelMiss,
} from "./recorded-gateway.js";
import { loadFixtures, replayCase } from "./replay.js";

/**
 * The research acceptance gate (owner 2026-10-29). Each golden case is
 * replayed through the real deep-research step and report assembly with
 * its recorded web pages and model answers: no network, no provider.
 * Every expectation is asserted by code. A recorded case that drifts
 * (a query, page or prompt the recording does not hold) fails loudly.
 *
 * A case with no recording yet is skipped with its reason. To record:
 * scripts/research-acceptance/record.mjs (credits, once per case).
 */

const cases = loadCases();

describe("research acceptance: the golden cases", () => {
  it("are valid situation dossiers with code-checkable expectations", () => {
    expect(cases.length).toBeGreaterThanOrEqual(7);
    for (const one of cases) {
      // Real markets, our own people: every account is fictional.
      expect(JSON.stringify(one.situation)).not.toMatch(/@(?!fictional)/u);
    }
  });

  for (const one of cases) {
    const fixtures = loadFixtures(one.id);
    if (fixtures === null) {
      it.skip(`${one.id}: not recorded yet -- run scripts/research-acceptance/record.mjs once the egress fixes are deployed`, () => {
        // Skipped until its web and model recordings are committed.
      });
      continue;
    }
    it(`${one.id} replays through the real code and meets every expectation`, async () => {
      const outcome = await replayCase(one, fixtures);
      expect(outcome.misses, "requests the recordings do not hold").toEqual([]);
      const failed = outcome.checks.filter((check) => !check.ok);
      expect(
        failed.map((check) => `${check.id}: ${check.detail}`),
        `queries sent: ${outcome.queries.join(" | ")}`,
      ).toEqual([]);
    }, 120_000);
  }
});

/** A run shaped like live run A (2026-10-29), which scored 4/10. */
function liveRunA(): CaseRun {
  const source = (
    index: number,
    domain: string,
    tier: "PRIMARY" | "OTHER",
  ) => ({
    index,
    url: `https://www.${domain}/page`,
    domain,
    title: null,
    publishedAt: null,
    tier,
    tierKind: tier === "PRIMARY" ? ("GOVERNMENT_OR_REGULATOR" as const) : null,
  });
  const sources = [
    source(1, "irs.gov", "PRIMARY"),
    source(2, "straitsresearch.com", "OTHER"),
  ];
  return {
    found: {
      status: "OK",
      query: "b2b payments market size 2025",
      sources: [],
    },
    dossier: {
      version: 1,
      sources,
      facts: [
        {
          id: "F1",
          statement:
            "The global B2B payments market was $1,609.98 billion in 2026.",
          figure: "$1,609.98 billion",
          asOf: "2026",
          source: 2,
          lane: "MARKET_SIZE",
          kind: "FIGURE",
          domain: "straitsresearch.com",
          title: null,
          url: "https://www.straitsresearch.com/page",
          publishedAt: null,
          evidenceStatus: "SELF_REPORTED",
          lifecycleStatus: "CURRENT",
          corroboratedBy: [],
          contradicts: [],
        },
      ],
      lanes: [],
    },
    sources,
    draft: {
      title: "Report",
      summary: "Global payments grow [S2]. LedgerBridge leads the market [S2].",
      sections: [
        { heading: "Executive summary", body: "Global payments [S9]." },
      ],
      topRecommendations: [],
      gaps: [],
    },
    content: {
      sections: [
        {
          heading: "Executive summary",
          body: "Global payments [S9].",
          findings: [],
        },
      ],
      gaps: [],
    },
  };
}

describe("research acceptance: the checks bite on the live failure", () => {
  const caseA = cases.find((one) => one.id.startsWith("A-"));
  if (caseA === undefined) throw new Error("case A is missing");

  it("fails run A's queries, sources, sections, citations and records", () => {
    const failed = checkCase({
      case: caseA,
      run: liveRunA(),
      // Run A's real sent queries, after egress dropped "Nigeria".
      queries: [
        "b2b payments market size 2025",
        "payments regulation",
        "nigeria cbn payments regulation circular",
      ],
      web: {
        version: 2,
        providerCode: "brave",
        recordedAt: "2026-10-29T12:00:00.000Z",
        searches: [
          {
            key: "nigeria cbn payments regulation circular",
            query: "nigeria cbn payments regulation circular",
            includeDomains: [],
            hits: [
              {
                url: "https://www.cbn.gov.ng/circulars/psp",
                title: "Circular",
                snippet: "Payment service providers",
                publishedAt: null,
                relevance: null,
              },
            ],
            failure: null,
          },
        ],
        pages: [
          {
            url: "https://www.straitsresearch.com/page",
            title: null,
            text: "The market was $1609.98 billion in 2026.",
          },
        ],
        failedUrls: [],
        extractFailures: [],
        extracts: [],
        schedule: null,
      },
      modelCalls: [],
    })
      .filter((check) => !check.ok)
      .map((check) => check.id);
    expect(failed).toEqual(
      expect.arrayContaining([
        "PLACE_IN_EVERY_QUERY",
        "BRIEF_WRITTEN",
        "PRIMARY_FROM_PLACE",
        "FOREIGN_GOVERNMENT_NOT_PRIMARY",
        "REPORT_SECTIONS",
        "CITATIONS_RESOLVE",
        "CAPITAL_Q_RECORDS_APART",
        "THESIS_QUOTES_MANDATE",
      ]),
    );
    // A number formatted differently on its page still counts as on it.
    expect(failed).not.toContain("FACT_NUMBERS_ON_PAGE");
    expect(failed).not.toContain("NO_PRIVATE_IN_QUERIES");
  });

  it("knows whose government a domain is", () => {
    expect(governmentCountry("www.irs.gov")).toBe("US");
    expect(governmentCountry("www.cbn.gov.ng")).toBe("NG");
    expect(governmentCountry("www.centralbank.go.ke")).toBe("KE");
    expect(governmentCountry("www.gov.uk")).toBe("GB");
    expect(governmentCountry("techcabal.com")).toBeNull();
  });
});

/** A web recording holding only what is given (no primary publisher). */
function webOf(
  queries: readonly string[],
  urls: readonly string[],
): Parameters<typeof checkCase>[0]["web"] {
  return {
    version: 2,
    providerCode: "brave",
    recordedAt: "2026-10-29T12:00:00.000Z",
    searches: queries.map((query) => ({
      key: query.toLowerCase(),
      query,
      includeDomains: [],
      hits: urls.map((url) => ({
        url,
        title: null,
        snippet: "Payments",
        publishedAt: null,
        relevance: null,
      })),
      failure: null,
    })),
    pages: urls.map((url) => ({ url, title: null, text: "Payments." })),
    failedUrls: [],
    extractFailures: [],
    extracts: [],
    schedule: null,
  };
}

describe("research acceptance: every expected check always reports", () => {
  const caseA = cases.find((one) => one.id.startsWith("A-"));
  if (caseA === undefined) throw new Error("case A is missing");
  const nothing: CaseRun = {
    found: { status: "UNAVAILABLE", message: "x" },
    dossier: null,
    sources: [],
    draft: null,
    content: null,
  };

  it("reports the same checks whatever evidence is missing, and missing evidence fails", () => {
    const full = checkCase({
      case: caseA,
      run: liveRunA(),
      queries: ["nigeria payments"],
      web: webOf(["nigeria payments"], []),
      modelCalls: [],
    });
    const empty = checkCase({
      case: caseA,
      run: nothing,
      queries: [],
      web: webOf([], []),
      modelCalls: [],
    });
    expect(empty.map((check) => check.id)).toEqual(
      full.map((check) => check.id),
    );
    expect(empty.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "PRIMARY_FROM_PLACE",
        "BRIEF_MARKET",
        "REPORT_SECTIONS",
        "FACT_NUMBERS_ON_PAGE",
        "INVESTIGATION_PLANNED",
        "LINES_OF_ENQUIRY",
      ]),
    );
    const passed = empty.filter((check) => check.ok).map((check) => check.id);
    // Only the checks that nothing sent can satisfy pass on nothing.
    expect(passed.sort()).toEqual(
      [
        "CAPITAL_Q_RECORDS_NOT_SENT",
        "FOREIGN_GOVERNMENT_NOT_PRIMARY",
        "NO_PRIVATE_IN_QUERIES",
        "PLACE_IN_EVERY_QUERY",
        "QUERY_TERMS_TRACE",
      ].sort(),
    );
  });

  // The degraded live recording (2026-10-29): OpenAI TRANSIENT failures,
  // the plan fell back to ONE query (the request), 4 pages, no primary
  // source -- and it passed 17/17.
  it("fails a degraded investigation that fell back to one generic search", () => {
    const urls = [
      "https://straitsresearch.com/b2b",
      "https://techcabal.com/b2b",
      "https://www.irs.gov/payments",
      "https://example-news.com/b2b",
    ];
    const run = liveRunA();
    const dossier = run.dossier;
    if (dossier === null) throw new Error("run A has a dossier");
    const degraded: CaseRun = {
      ...run,
      dossier: {
        ...dossier,
        lanes: [
          {
            lane: "GENERAL",
            query: caseA.request.slice(0, 160),
            status: "OK",
            sources: 4,
          },
        ],
        investigation: {
          rounds: 1,
          stop: "NO_NEW_QUERIES",
          open: [],
          couldNotRun: [],
          searches: 1,
          modelCalls: 6,
          ms: 40_000,
          reduced:
            "This investigation ran in a reduced form: the research plan could not be written because the model service failed with a temporary error, twice, so it searched the request's own words as a single query instead of planned lines of enquiry. Ask again for the full investigation.",
        },
      },
    };
    const failed = checkCase({
      case: caseA,
      run: degraded,
      queries: [caseA.request.slice(0, 160)],
      web: webOf([caseA.request.slice(0, 160)], urls),
      modelCalls: [],
    })
      .filter((check) => !check.ok)
      .map((check) => check.id);
    expect(failed).toEqual(
      expect.arrayContaining([
        "QUERIES_SENT",
        "INVESTIGATION_PLANNED",
        "LINES_OF_ENQUIRY",
        "PRIMARY_FROM_PLACE",
      ]),
    );
  });
});

describe("research acceptance: the recorded model gateway", () => {
  const request = {
    taskClass: "EVIDENCE_SYNTHESIS" as const,
    sensitivity: "CONFIDENTIAL" as const,
    messages: [
      { role: "USER" as const, content: "Plan research on Nigerian payments." },
    ],
    output: { kind: "TEXT" as const },
    budget: {
      maxAttempts: 1,
      maxEstimatedCostUsd: 0.01,
      maxOutputTokens: 100,
      attemptTimeoutMs: 1_000,
    },
  };
  const attribution = (correlationId: string) => ({
    purpose: "DELEGATED_WORK" as const,
    tenantId: "00000000-0000-4000-8000-000000000001",
    correlationId,
  });
  const result: ModelGatewayResult<never> = {
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
    completedAt: "2026-10-29T12:00:00.000Z",
    output: { kind: "TEXT", text: "a plan" },
  };
  const live: ModelGateway = { execute: () => Promise.resolve(result) };

  it("replays by request hash, ignoring the random correlation id, and fails loudly on a new request", async () => {
    const recording = createRecordingModelGateway({ gateway: live });
    await recording.execute({ ...request, attribution: attribution("cor_a") });
    const replay = createReplayModelGateway({ fixture: recording.fixture() });
    const again = await replay.execute({
      ...request,
      attribution: attribution("cor_b"),
    });
    expect(again.output).toEqual({ kind: "TEXT", text: "a plan" });
    await expect(
      replay.execute({
        ...request,
        messages: [{ role: "USER", content: "Plan research on payments." }],
        attribution: attribution("cor_c"),
      }),
    ).rejects.toBeInstanceOf(RecordedModelMiss);
    expect(replay.misses).toEqual([
      expect.objectContaining({ reason: "NOT_RECORDED" }),
    ]);
    expect(replay.seen.map((call) => call.output)).toEqual(["a plan", null]);
  });
});
