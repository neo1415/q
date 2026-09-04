import { describe, expect, it } from "vitest";

import { OnboardingSessionViewSchema } from "@capital-q/contracts";
import { FOUNDER_STEPS } from "@capital-q/founder-onboarding/definition";

import { FounderOnboardingClientError } from "../src/features/founder-onboarding/adapters/client";
import {
  createFixtureRuntimePort,
  FIXTURE_STORAGE_KEY,
} from "../src/features/founder-onboarding/adapters/fixture-port";
import {
  createRuntimeFounderClient,
  type RuntimePort,
} from "../src/features/founder-onboarding/adapters/runtime-port";
import {
  GROUPS,
  planSubmissions,
  toPresentation,
} from "../src/features/founder-onboarding/models/journey";
import type { StepView } from "../src/features/founder-onboarding/models/presentation";

/**
 * The web journey over the runtime contract: the in-memory fixture speaks
 * exactly the session view the API returns, the mapper turns it into
 * screens, and the client turns composite screens back into ordered
 * runtime submissions. What passes here against the fixture is the same
 * code path the API adapter runs; only the transport differs.
 */

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
  step: StepView | undefined,
  kind: TKind,
): Extract<StepView, { kind: TKind }> {
  expect(step?.kind).toBe(kind);
  return step as Extract<StepView, { kind: TKind }>;
}

const SOURCE = { adapter: "test", synthetic: true };

function requireGroup(id: string) {
  const group = GROUPS.find((g) => g.id === id);
  if (group === undefined) {
    throw new Error(`no group ${id}`);
  }
  return group;
}

function client(
  storage: Storage | null = null,
  seed?: "reset" | "review" | "revenue" | "raise" | "snapshot" | "flaky",
) {
  return createRuntimeFounderClient(
    createFixtureRuntimePort({ storage, seed }),
    SOURCE,
  );
}

describe("founder journey over the runtime contract", () => {
  it("the fixture emits a valid runtime session view and the mapper opens on intent", async () => {
    const port = createFixtureRuntimePort({ storage: null, seed: "reset" });
    const view = await port.start("00000000-0000-4000-8000-000000000001");
    expect(() => OnboardingSessionViewSchema.parse(view)).not.toThrow();
    expect(view.session.definitionVersion).toBe(1);
    expect(view.session.currentStepKey).toBe(FOUNDER_STEPS.intent);
    const presented = toPresentation(view, SOURCE);
    expect(presented.currentStepId).toBe("intent");
    expect(presented.steps.map((s) => s.id)).toEqual([
      "intent",
      "company_basics",
      "stage",
      "description",
      "categories",
      "materials",
      "review",
      "team",
      "capital_objective",
      "follow_up",
      "snapshot",
    ]);
    // Traction appears only once stage decides its variant.
    expect(presented.steps.find((s) => s.id === "traction")).toBeUndefined();
    const step = expectKind(presented.step, "choice");
    expect(step.options.map((o) => o.value)).toEqual([
      "raising_now",
      "preparing_to_raise",
      "exploring",
    ]);
  });

  it("F0 → F8 on the fixture: composite screens become ordered runtime steps and the snapshot is what was entered", async () => {
    const storage = memoryStorage();
    const founder = client(storage, "reset");
    let session = await founder.getSession();
    expect(session.status).toBe("in_progress");

    session = await founder.saveResponse({
      stepId: "intent",
      response: { kind: "choice", value: "raising_now" },
    });
    expect(session.currentStepId).toBe("company_basics");

    session = await founder.saveResponse({
      stepId: "company_basics",
      response: {
        kind: "company_basics",
        name: "NexaRail Technologies",
        website: "nexarail.example",
        countryCode: "NG",
      },
    });
    expect(session.currentStepId).toBe("stage");

    session = await founder.saveResponse({
      stepId: "stage",
      response: { kind: "choice", value: "seed" },
    });
    expect(session.currentStepId).toBe("description");
    // Seed stage: the pre-revenue traction screen is now on the path.
    expect(session.steps.find((s) => s.id === "traction")?.status).toBe(
      "pending",
    );

    session = await founder.saveResponse({
      stepId: "description",
      response: {
        kind: "narrative",
        text: "We automate claims handling for mid-sized insurers.",
      },
    });
    const categories = expectKind(session.step, "taxonomy_select");
    expect(categories.sourceText).toContain("claims");
    const candidates = await founder.findTaxonomyCandidates({
      text: categories.sourceText ?? "",
    });
    expect(candidates.map((c) => c.label)).toContain("Insurance Technology");
    session = await founder.saveResponse({
      stepId: "categories",
      response: {
        kind: "taxonomy_select",
        nodeIds: candidates.slice(0, 2).map((c) => c.nodeId),
      },
    });
    expect(session.currentStepId).toBe("materials");

    session = await founder.saveResponse({
      stepId: "materials",
      response: { kind: "multi_choice", values: ["pitch_deck"] },
    });
    const review = expectKind(session.step, "review");
    expect(review.items.find((i) => i.id === "name")?.value).toBe(
      "NexaRail Technologies",
    );
    expect(review.items.find((i) => i.id === "website")?.value).toBe(
      "https://nexarail.example",
    );
    expect(review.items.find((i) => i.id === "country")?.value).toBe("Nigeria");
    expect(review.categories).toHaveLength(2);
    expect(review.materials).toEqual(["Pitch deck"]);

    session = await founder.saveResponse({
      stepId: "review",
      response: { kind: "review", confirmed: true },
    });
    expect(session.currentStepId).toBe("team");
    expect(session.steps.find((s) => s.id === "review")?.status).toBe(
      "completed",
    );

    session = await founder.saveResponse({
      stepId: "team",
      response: {
        kind: "team",
        role: "ceo",
        founders: "2",
        fullTime: "all",
        teamSize: "6",
        functions: ["product"],
      },
    });
    const traction = expectKind(session.step, "traction");
    expect(traction.variant).toBe("pre_revenue");
    expect(traction.metrics.map((m) => m.id)).toEqual([FOUNDER_STEPS.signal]);

    session = await founder.saveResponse({
      stepId: "traction",
      response: {
        kind: "traction",
        metrics: { [FOUNDER_STEPS.signal]: { value: "pilots" } },
      },
    });
    // Answering "pilots" makes the pilots count eligible: still on traction.
    expect(session.currentStepId).toBe("traction");
    expect(
      expectKind(session.step, "traction").metrics.map((m) => m.id),
    ).toEqual([FOUNDER_STEPS.signal, FOUNDER_STEPS.pilots]);
    session = await founder.saveResponse({
      stepId: "traction",
      response: {
        kind: "traction",
        metrics: {
          [FOUNDER_STEPS.signal]: { value: "pilots" },
          [FOUNDER_STEPS.pilots]: { unknown: true },
        },
      },
    });
    expect(session.currentStepId).toBe("capital_objective");

    session = await founder.saveResponse({
      stepId: "capital_objective",
      response: {
        kind: "capital_objective",
        raisingStatus: "active",
        targetAmount: { amount: "500000", currency: "USD" },
        instrument: "safe",
        useOfFunds: ["product"],
      },
    });
    expect(session.currentStepId).toBe("follow_up");

    session = await founder.skipStep({ stepId: "follow_up" });
    const snapshot = expectKind(session.step, "snapshot");
    expect(snapshot.headline).toBe("Here's what we have so far.");
    const text = JSON.stringify(snapshot);
    expect(text).toContain("NexaRail Technologies");
    expect(text).toContain("Raising USD 500000");
    expect(text).toContain("2 founders, 2 full-time");
    expect(text).not.toMatch(/readiness|score|verified|Q inferred|match/i);
    expect(snapshot.nextSteps).toEqual([]);

    // Finishing: confirm the snapshot, complete, and the view says so.
    await founder.saveResponse({
      stepId: "snapshot",
      response: { kind: "snapshot", confirmed: true },
    });
    session = await founder.complete();
    expect(session.status).toBe("complete");
    expect(session.step).toBeUndefined();

    // Resume from storage (a refresh) lands on the completed session.
    const again = client(storage);
    expect((await again.getSession()).status).toBe("complete");
    expect(storage.getItem(FIXTURE_STORAGE_KEY)).not.toBeNull();
  });

  it("back reopens the previous screen with its answers, and re-saving unchanged answers moves forward again", async () => {
    const founder = client(null, "raise");
    let session = await founder.getSession();
    expect(session.currentStepId).toBe("capital_objective");
    session = await founder.goBack({ stepId: "capital_objective" });
    expect(session.currentStepId).toBe("traction");
    const traction = expectKind(session.step, "traction");
    expect(traction.response?.metrics[FOUNDER_STEPS.pilots]).toEqual({
      value: "4",
    });
    session = await founder.saveResponse({
      stepId: "traction",
      response: { kind: "traction", metrics: traction.response?.metrics ?? {} },
    });
    expect(session.currentStepId).toBe("capital_objective");
    await founder.goBack({ stepId: "capital_objective" });
    session = await founder.goBack({ stepId: "traction" });
    expect(session.currentStepId).toBe("team");
    expect(expectKind(session.step, "team").response).toMatchObject({
      founders: "2",
      teamSize: "8",
    });
  });

  it("the raise screen recalibrates an existing objective instead of creating another", async () => {
    const founder = client(null, "snapshot");
    let session = await founder.openStep({ stepId: "capital_objective" });
    const raise = expectKind(session.step, "capital_objective");
    expect(raise.response?.targetAmount).toEqual({
      amount: "2500000",
      currency: "USD",
    });
    session = await founder.saveResponse({
      stepId: "capital_objective",
      response: {
        kind: "capital_objective",
        raisingStatus: "active",
        targetAmount: { amount: "3000000", currency: "USD" },
        instrument: "safe",
        useOfFunds: ["product"],
      },
    });
    // Everything after was already visited: the client jumps forward.
    expect(session.currentStepId).toBe("snapshot");
    expect(JSON.stringify(session.step)).toContain("Raising USD 3000000");
  });

  it("revenue-stage companies get the revenue traction variant", async () => {
    const founder = client(null, "revenue");
    const session = await founder.getSession();
    const traction = expectKind(session.step, "traction");
    expect(traction.variant).toBe("revenue");
    expect(traction.metrics.map((m) => m.id)).toEqual([
      FOUNDER_STEPS.revenueStatus,
      FOUNDER_STEPS.customers,
      FOUNDER_STEPS.growth,
    ]);
  });

  it("a transient failure keeps the operation retryable and a stale version surfaces as CONFLICT", async () => {
    const flaky = client(null, "flaky");
    await flaky.getSession();
    await expect(
      flaky.saveResponse({
        stepId: "intent",
        response: { kind: "choice", value: "exploring" },
      }),
    ).rejects.toMatchObject({ kind: "NETWORK", retryable: true });
    const after = await flaky.saveResponse({
      stepId: "intent",
      response: { kind: "choice", value: "exploring" },
    });
    expect(after.currentStepId).toBe("company_basics");

    // Two clients over one stored session: the second write is stale.
    const storage = memoryStorage();
    const first = client(storage, "reset");
    const second = client(storage);
    await first.getSession();
    await second.getSession();
    await first.saveResponse({
      stepId: "intent",
      response: { kind: "choice", value: "raising_now" },
    });
    const stale = second.saveResponse({
      stepId: "intent",
      response: { kind: "choice", value: "exploring" },
    });
    await expect(stale).rejects.toBeInstanceOf(FounderOnboardingClientError);
    await expect(stale).rejects.toMatchObject({ kind: "CONFLICT" });
    // After the conflict the cached session is dropped: the next read is
    // fresh (the other tab's answer is visible) and a new save succeeds.
    const fresh = await second.getSession();
    expect(fresh.currentStepId).toBe("company_basics");
    const revised = await second.openStep({ stepId: "intent" });
    expect(expectKind(revised.step, "choice").response?.value).toBe(
      "raising_now",
    );
  });

  it("plans every composite screen onto its runtime steps in definition order", () => {
    const team = requireGroup("team");
    expect(
      planSubmissions(team, {
        kind: "team",
        role: "cto",
        founders: "3",
        fullTime: "some",
        teamSize: "12",
        functions: [],
      }).map((s) => [s.stepKey, s.action]),
    ).toEqual([
      [FOUNDER_STEPS.founderRole, "submit"],
      [FOUNDER_STEPS.founderCount, "submit"],
      [FOUNDER_STEPS.fullTime, "submit"],
      [FOUNDER_STEPS.teamSize, "submit"],
      [FOUNDER_STEPS.functions, "skip"],
    ]);
    const raise = requireGroup("capital_objective");
    expect(
      planSubmissions(raise, {
        kind: "capital_objective",
        raisingStatus: "not_now",
      }),
    ).toHaveLength(1);
    expect(() =>
      planSubmissions(raise, {
        kind: "capital_objective",
        raisingStatus: "active",
      }),
    ).toThrow(/target amount/);
    expect(
      planSubmissions(raise, {
        kind: "capital_objective",
        raisingStatus: "preparing",
        targetAmount: { amount: "750000", currency: "NGN" },
      }).map((s) => s.stepKey),
    ).toEqual([
      FOUNDER_STEPS.raising,
      FOUNDER_STEPS.currency,
      FOUNDER_STEPS.targetAmount,
      FOUNDER_STEPS.instrument,
      FOUNDER_STEPS.timeframe,
      FOUNDER_STEPS.useOfFunds,
      FOUNDER_STEPS.raiseConfirm,
    ]);
  });

  it("refuses a session pinned to a definition version this build cannot present", async () => {
    const port = createFixtureRuntimePort({ storage: null, seed: "reset" });
    const v2: RuntimePort = {
      ...port,
      current: async () => {
        const view = await port.current();
        return view === null
          ? null
          : { ...view, session: { ...view.session, definitionVersion: 2 } };
      },
    };
    await expect(
      createRuntimeFounderClient(v2, SOURCE).getSession(),
    ).rejects.toMatchObject({ kind: "UNAVAILABLE" });
  });
});
