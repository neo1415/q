import { describe, expect, it } from "vitest";

import {
  FIT_PARAMETERS,
  type FitParameterResultDto,
  type FitProfileDto,
} from "@capital-q/contracts";
import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
  createSyntheticDemoRoutingAllowance,
  type FakeBehaviour,
} from "@capital-q/model-gateway";
import type { FitQViewResult } from "@capital-q/q-core";

import {
  createFitQViewer,
  fitQViewGroundingFailure,
} from "../src/recommendation/fit-q-view.js";
import { narratorCatalog } from "./support/narrator-catalog.js";

/**
 * Q's view beside a computed fit (B4; ADR 0052): a labelled inference
 * from the reader's own fit rows only; it never changes the fit; every
 * failure is an in-band UNAVAILABLE.
 */

const COMPANY = "00000000-0000-4000-8000-000000000001";

function profile(band: FitProfileDto["band"] = "GOOD_FIT"): FitProfileDto {
  const parameters: FitParameterResultDto[] = FIT_PARAMETERS.map(
    (parameter) => ({
      parameter,
      outcome:
        parameter === "TRACTION"
          ? "PARTIAL"
          : parameter === "ROUND_TERMS"
            ? "UNKNOWN"
            : "STRONG",
      reason:
        parameter === "TRACTION"
          ? "$31k a month, below your $50k minimum."
          : "Fits.",
      evidenceStatus: null,
      stale: false,
      applicable: true,
    }),
  );
  return {
    companyId: COMPANY,
    configVersion: "ranking-config.v4",
    configLabel: "4",
    band,
    confidence: "MEDIUM",
    parameters,
    topReasons: [],
    mainMismatch: null,
    hardRule:
      band === "OUTSIDE_MANDATE"
        ? { code: "DECLARED_EXCLUSION", label: "Outside a rule you set." }
        : null,
    computedAt: "2026-10-05T21:40:00.000Z",
  };
}

const REQUEST = {
  tenantId: "11111111-0000-4000-8000-000000000001",
  userId: "11111111-0000-4000-8000-000000000003",
  correlationId: "cor_11111111-0000-4000-8000-000000000009",
  companyName: "Kora Health",
  companyLine: "Gets clinics paid for insurance claims in weeks, not months.",
};

const view = (overrides: Partial<FitQViewResult> = {}): FakeBehaviour => ({
  kind: "JSON",
  value: {
    verdict: "WORTH_A_LOOK",
    summary:
      "Revenue is real at $31k a month and the team fits. Ask how they compare with other claims tools.",
    mainRisk: "Revenue is below the minimum you set.",
    unknowns: ["Round terms"],
    ...overrides,
  },
});

function build(script: readonly FakeBehaviour[]) {
  const provider = createFakeModelProvider({ code: "beta", script });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(narratorCatalog()),
    registry: createModelProviderRegistry([provider]),
    usage: createInMemoryModelUsageRepository(),
    // Invented data only: the fake provider, never a live call.
    syntheticDemo: createSyntheticDemoRoutingAllowance({
      operatorEnabled: true,
      environment: "test",
      databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    }),
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });
  return {
    viewer: createFitQViewer({ gateway, dataPosture: "SYNTHETIC_DEMO" }),
    provider,
    gateway,
  };
}

describe("Q's view beside a fit", () => {
  it("is a labelled inference formed from the reader's own rows only", async () => {
    const { viewer, provider } = build([view()]);
    const result = await viewer.view({ ...REQUEST, profile: profile() });
    expect(result).toMatchObject({
      status: "READY",
      verdict: "WORTH_A_LOOK",
      truthClass: "Q_INFERENCE",
      configVersion: "ranking-config.v4",
    });
    const sent = JSON.stringify(provider.calls[0]?.request);
    expect(sent).toContain("Kora Health");
    expect(sent).toContain("below your $50k minimum");
    // The internal value never crosses: there is none in the profile to send.
    expect(sent).not.toMatch(/confidenceScore|coverage|weight\b|0\.94/);
  });

  it("an outside-mandate company is not asked of a model", async () => {
    const { viewer, provider } = build([view()]);
    expect(
      await viewer.view({ ...REQUEST, profile: profile("OUTSIDE_MANDATE") }),
    ).toEqual({ status: "UNAVAILABLE", companyId: COMPANY });
    expect(provider.calls).toHaveLength(0);
  });

  it("a percentage, a score or an invented figure is refused", async () => {
    for (const summary of [
      "A 90% chance they raise.",
      "Scores well overall.",
      "They have $2M in revenue.",
    ]) {
      const { viewer } = build([view({ summary })]);
      expect(
        (await viewer.view({ ...REQUEST, profile: profile() })).status,
      ).toBe("UNAVAILABLE");
    }
    expect(
      fitQViewGroundingFailure(
        {
          verdict: "MAYBE",
          summary: "Ask about $31k.",
          mainRisk: null,
          unknowns: [],
        },
        "$31k a month",
      ),
    ).toBeNull();
  });

  it("reads what the company stated (pitch, confirmed deck) and may cite it; an unstated figure is still refused (Tensorgate, 2026-10-12)", async () => {
    const evidence = [
      { label: "Pitch · Raise", value: "$4M" },
      { label: "The ask · Instrument", value: "Post-money SAFE" },
      { label: "The ask · Valuation cap", value: "$30m" },
      { label: "The ask · Committed investors", value: null },
    ];
    const cited = view({
      summary:
        "In your sector at seed; the deck states $4m on a post-money SAFE with a $30m cap.",
      unknowns: [
        "Does the round still need a lead? The deck names no committed investors.",
      ],
    });
    const { viewer, provider } = build([cited]);
    const result = await viewer.view({
      ...REQUEST,
      profile: profile(),
      evidence,
    });
    expect(result.status).toBe("READY");
    const sent = JSON.stringify(provider.calls[0]?.request);
    expect(sent).toContain("Post-money SAFE");
    expect(sent).toContain("Committed investors");
    expect(sent).toContain("STATED");

    const { viewer: again } = build([
      view({ summary: "The deck states a $75m cap." }),
    ]);
    expect(
      (await again.view({ ...REQUEST, profile: profile(), evidence })).status,
    ).toBe("UNAVAILABLE");
  });

  it("a deck reached through a grant is sent at CONFIDENTIAL", async () => {
    const { gateway } = build([view()]);
    const seen: unknown[] = [];
    const spying: typeof gateway = {
      ...gateway,
      execute: (request, options) => {
        seen.push(request.sensitivity);
        return gateway.execute(request, options);
      },
    };
    await createFitQViewer({
      gateway: spying,
      dataPosture: "SYNTHETIC_DEMO",
    }).view({
      ...REQUEST,
      profile: profile(),
      evidence: [{ label: "The ask · Instrument", value: "SAFE" }],
      sensitivity: "CONFIDENTIAL",
    });
    expect(seen).toEqual(["CONFIDENTIAL"]);
  });

  it("an outage is in-band and never throws", async () => {
    const { viewer } = build([
      { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
    ]);
    expect((await viewer.view({ ...REQUEST, profile: profile() })).status).toBe(
      "UNAVAILABLE",
    );
  });
});
