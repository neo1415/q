import { describe, expect, it } from "vitest";

import {
  FIXTURE_STORAGE_KEY,
  createFounderOnboardingFixtureClient,
} from "../src/features/founder-onboarding/adapters/fixture-client";
import { FounderOnboardingClientError } from "../src/features/founder-onboarding/adapters/client";
import type { StepView } from "../src/features/founder-onboarding/models/presentation";

/** A minimal Storage double so resume behaviour is exercised without a browser. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function expectKind<TKind extends StepView["kind"]>(
  step: StepView,
  kind: TKind,
): Extract<StepView, { kind: TKind }> {
  expect(step.kind).toBe(kind);
  return step as Extract<StepView, { kind: TKind }>;
}

describe("FounderOnboardingFixtureClient", () => {
  it("starts at intent, labels itself synthetic, and advances on save", async () => {
    const client = createFounderOnboardingFixtureClient({ storage: null });
    const start = await client.getSession();
    expect(start.currentStepId).toBe("intent");
    expect(start.source).toEqual({
      adapter: "FounderOnboardingFixtureClient",
      synthetic: true,
    });
    expect(start.steps.map((step) => step.section)).toEqual([
      "company",
      "company",
      "company",
      "company",
      "company",
      "company",
      "business",
      "business",
      "business",
      "raise",
      "review",
      "review",
    ]);

    const next = await client.saveResponse({
      stepId: "intent",
      response: { kind: "choice", value: "raising" },
    });
    expect(next.currentStepId).toBe("company_basics");
    expect(next.steps[0]?.status).toBe("completed");
  });

  it("goes back without losing the previous answer, and forward again keeps the later one", async () => {
    const client = createFounderOnboardingFixtureClient({
      storage: null,
      seed: "clarify",
    });
    const atCapital = await client.goBack({ stepId: "clarification" });
    const capital = expectKind(atCapital.step, "capital_objective");
    expect(capital.response?.targetAmount).toEqual({
      amount: "2500000",
      currency: "USD",
    });

    const atTraction = await client.goBack({ stepId: "capital_objective" });
    const traction = expectKind(atTraction.step, "traction");
    expect(traction.response?.metrics["pilots"]).toEqual({ value: "4" });

    const forward = await client.saveResponse({
      stepId: "traction",
      response: { kind: "traction", metrics: { signal: { value: "lois" } } },
    });
    const capitalAgain = expectKind(forward.step, "capital_objective");
    expect(capitalAgain.response?.targetAmount?.amount).toBe("2500000");
  });

  it("records a skipped optional step as skipped, never as an empty answer", async () => {
    const client = createFounderOnboardingFixtureClient({
      storage: null,
      seed: "review",
    });
    await client.saveResponse({
      stepId: "understanding",
      response: { kind: "understanding_review", facts: [], taxonomy: [] },
    });
    await client.saveResponse({
      stepId: "team",
      response: {
        kind: "team",
        founders: "2",
        fullTime: "all",
        role: "ceo",
        functions: [],
        teamSize: "2_5",
      },
    });
    const skipped = await client.skipStep({ stepId: "edge" });
    expect(skipped.steps.find((step) => step.id === "edge")?.status).toBe(
      "skipped",
    );
    expect(skipped.currentStepId).toBe("traction");
    const back = await client.goBack({ stepId: "traction" });
    const edge = expectKind(back.step, "narrative");
    expect(edge.skipped).toBe(true);
    expect(edge.response).toBeUndefined();
    await expect(client.skipStep({ stepId: "intent" })).rejects.toBeInstanceOf(
      FounderOnboardingClientError,
    );
  });

  it("adapts the traction step to the stage answer", async () => {
    const preRevenue = createFounderOnboardingFixtureClient({
      storage: null,
      seed: "clarify",
    });
    const a = expectKind(
      (await preRevenue.openStep({ stepId: "traction" })).step,
      "traction",
    );
    expect(a.variant).toBe("pre_revenue");
    expect(a.metrics.map((metric) => metric.id)).toContain("pilots");

    const revenue = createFounderOnboardingFixtureClient({
      storage: null,
      seed: "revenue",
    });
    const b = expectKind((await revenue.getSession()).step, "traction");
    expect(b.variant).toBe("revenue");
    expect(b.metrics.map((metric) => metric.id)).toContain("arr");
    expect(b.metrics.map((metric) => metric.id)).not.toContain("pilots");
  });

  it("keeps money as exact strings and rejects malformed amounts", async () => {
    const client = createFounderOnboardingFixtureClient({
      storage: null,
      seed: "clarify",
    });
    await client.openStep({ stepId: "capital_objective" });
    const saved = await client.saveResponse({
      stepId: "capital_objective",
      response: {
        kind: "capital_objective",
        raisingStatus: "active",
        targetAmount: { amount: "500000", currency: "USD" },
      },
    });
    const capital = expectKind(
      (await client.openStep({ stepId: "capital_objective" })).step,
      "capital_objective",
    );
    expect(capital.response?.targetAmount).toEqual({
      amount: "500000",
      currency: "USD",
    });
    expect(typeof capital.response?.targetAmount?.amount).toBe("string");
    expect(saved.currentStepId).toBe("clarification");

    await expect(
      client.saveResponse({
        stepId: "capital_objective",
        response: {
          kind: "capital_objective",
          raisingStatus: "active",
          targetAmount: { amount: "5e5", currency: "USD" },
        },
      }),
    ).rejects.toMatchObject({ kind: "REJECTED" });
  });

  it("feeds the clarification answer into the first-value snapshot", async () => {
    const client = createFounderOnboardingFixtureClient({
      storage: null,
      seed: "clarify",
    });
    const done = await client.saveResponse({
      stepId: "clarification",
      response: { kind: "clarification", choice: "45" },
    });
    const snapshot = expectKind(done.step, "intelligence_snapshot");
    expect(done.status).toBe("complete");
    expect(JSON.stringify(snapshot.sections)).toContain("45 paying insurers");
    expect(JSON.stringify(snapshot)).not.toMatch(
      /\d+% (good|match)|investment quality|investors for you/i,
    );
  });

  it("never jumps ahead to first-value intelligence before the steps that feed it", async () => {
    const client = createFounderOnboardingFixtureClient({ storage: null });
    await expect(
      client.openStep({ stepId: "intelligence" }),
    ).rejects.toMatchObject({ kind: "REJECTED" });
    expect((await client.getSession()).currentStepId).toBe("intent");
  });

  it("resumes from storage after a reload and clears with the reset seed", async () => {
    const storage = memoryStorage();
    const first = createFounderOnboardingFixtureClient({ storage });
    await first.saveResponse({
      stepId: "intent",
      response: { kind: "choice", value: "preparing" },
    });
    await first.saveResponse({
      stepId: "company_basics",
      response: { kind: "company_basics", name: "NexaRail Technologies" },
    });
    expect(storage.getItem(FIXTURE_STORAGE_KEY)).not.toBeNull();

    const resumed = createFounderOnboardingFixtureClient({ storage });
    const session = await resumed.getSession();
    expect(session.currentStepId).toBe("stage");
    const basics = expectKind(
      (await resumed.goBack({ stepId: "stage" })).step,
      "company_basics",
    );
    expect(basics.response?.name).toBe("NexaRail Technologies");

    const reset = createFounderOnboardingFixtureClient({
      storage,
      seed: "reset",
    });
    expect((await reset.getSession()).currentStepId).toBe("intent");
  });

  it("simulates one network failure with the flaky seed, then recovers", async () => {
    const client = createFounderOnboardingFixtureClient({
      storage: null,
      seed: "flaky",
    });
    const attempt = client.saveResponse({
      stepId: "intent",
      response: { kind: "choice", value: "raising" },
    });
    await expect(attempt).rejects.toMatchObject({
      kind: "NETWORK",
      retryable: true,
    });
    expect((await client.getSession()).currentStepId).toBe("intent");
    const retried = await client.saveResponse({
      stepId: "intent",
      response: { kind: "choice", value: "raising" },
    });
    expect(retried.currentStepId).toBe("company_basics");
  });

  it("represents file selection states without uploading anything, and blocks progress on a failed file until resolved", async () => {
    const client = createFounderOnboardingFixtureClient({
      storage: null,
      seed: "review",
    });
    await client.goBack({ stepId: "understanding" });
    const withFile = await client.attachFile({
      stepId: "assets",
      file: { name: "deck.pdf", sizeBytes: 1200, type: "application/pdf" },
    });
    const assets = expectKind(withFile.step, "asset_selection");
    expect(assets.files.at(-1)).toMatchObject({
      name: "deck.pdf",
      kind: "PDF",
      state: "ready",
    });

    const bad = expectKind(
      (
        await client.attachFile({
          stepId: "assets",
          file: {
            name: "unreadable-scan.pdf",
            sizeBytes: 900,
            type: "application/pdf",
          },
        })
      ).step,
      "asset_selection",
    );
    const failed = bad.files.at(-1);
    expect(failed?.state).toBe("failed");
    await expect(
      client.saveResponse({
        stepId: "assets",
        response: { kind: "asset_selection", assetTypes: ["pitch_deck"] },
      }),
    ).rejects.toMatchObject({ kind: "REJECTED" });

    const removed = expectKind(
      (await client.removeFile({ stepId: "assets", fileId: failed?.id ?? "" }))
        .step,
      "asset_selection",
    );
    expect(removed.files.some((file) => file.state === "failed")).toBe(false);
    const unsupported = expectKind(
      (
        await client.attachFile({
          stepId: "assets",
          file: { name: "model.xlsx", sizeBytes: 100, type: "" },
        })
      ).step,
      "asset_selection",
    );
    expect(unsupported.files.at(-1)?.failureReason).toMatch(
      /isn't supported yet/,
    );
  });

  it("changes the review and clarification content when no document exists", async () => {
    const client = createFounderOnboardingFixtureClient({ storage: null });
    await client.saveResponse({
      stepId: "intent",
      response: { kind: "choice", value: "exploring" },
    });
    await client.saveResponse({
      stepId: "company_basics",
      response: { kind: "company_basics", name: "NexaRail Technologies" },
    });
    await client.saveResponse({
      stepId: "stage",
      response: { kind: "choice", value: "pre_seed" },
    });
    await client.skipStep({ stepId: "description" });
    const review = expectKind(
      (
        await client.saveResponse({
          stepId: "assets",
          response: { kind: "asset_selection", assetTypes: ["nothing"] },
        })
      ).step,
      "understanding_review",
    );
    expect(review.facts.some((fact) => fact.verdict === "missing")).toBe(true);
    expect(
      review.facts.every((fact) => fact.evidence !== "from_document"),
    ).toBe(true);
  });
});
