import { describe, expect, it } from "vitest";

import { OnboardingSessionViewSchema } from "@capital-q/contracts";
import { INVESTOR_STEPS } from "@capital-q/investor-onboarding/definition";

import { OnboardingClientError } from "../src/features/investor-onboarding/adapters/client";
import {
  createInvestorFixtureRuntimePort,
  FIXTURE_STORAGE_KEY,
  type FixtureSeed,
} from "../src/features/investor-onboarding/adapters/fixture-port";
import {
  createRuntimeInvestorClient,
  type RuntimePort,
} from "../src/features/investor-onboarding/adapters/runtime-port";
import {
  GROUPS,
  planSubmissions,
  toPresentation,
} from "../src/features/investor-onboarding/models/journey";
import type { StepView } from "../src/features/investor-onboarding/models/presentation";

/**
 * The investor web journey over the runtime contract: the in-memory fixture
 * speaks exactly the session view the API returns, the mapper turns it into
 * the Context / Mandate / Preferences / Review screens, and the client turns
 * each composite screen back into ordered runtime submissions. The API
 * adapter runs the same code path; only the transport differs.
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

function client(storage: Storage | null = null, seed?: FixtureSeed) {
  return createRuntimeInvestorClient(
    createInvestorFixtureRuntimePort({ storage, seed }),
    SOURCE,
  );
}

/** Copy the mandate review and handoff must never carry (§I11, §I12). */
const FORBIDDEN_COPY =
  /Q understood|Q analysed|Q analyzed|Q recommends|matches found|personalised feed|personalized feed|\d+ (matches|opportunities)|\d+% match/i;

describe("investor journey over the runtime contract", () => {
  it("the fixture emits a valid runtime session view and the mapper opens on the role screen under four sections", async () => {
    const port = createInvestorFixtureRuntimePort({
      storage: null,
      seed: "reset",
    });
    const view = await port.start("00000000-0000-4000-8000-000000000001");
    expect(() => OnboardingSessionViewSchema.parse(view)).not.toThrow();
    expect(view.session.definitionVersion).toBe(1);
    expect(view.session.currentStepKey).toBe(INVESTOR_STEPS.investorType);
    const presented = toPresentation(view, SOURCE);
    expect(presented.sections.map((s) => s.id)).toEqual([
      "context",
      "mandate",
      "preferences",
      "review",
    ]);
    expect(presented.currentStepId).toBe("role");
    expect(presented.steps.map((s) => s.id)).toEqual([
      "role",
      "deployment",
      "mandate",
      "stage_cheque",
      "geography",
      "sectors",
      "attributes",
      "founder",
      "green_flags",
      "red_flags",
      "portfolio",
      "discovery",
      "inbound",
      "context",
      "review",
      "handoff",
    ]);
    const role = expectKind(presented.step, "investor_role");
    expect(role.personalWorkspaceName).toBe("Personal Investing");
    expect(role.typeOptions.map((o) => o.value)).toContain("angel");
  });

  it("I0 → I12 on the fixture: composite screens become ordered runtime steps and the review is what was declared", async () => {
    const storage = memoryStorage();
    const investor = client(storage, "reset");
    let session = await investor.getSession();
    expect(session.status).toBe("in_progress");

    session = await investor.saveResponse({
      stepId: "role",
      response: {
        kind: "investor_role",
        investorType: "vc",
        organisationName: "Northbank Capital",
        businessTitle: "Partner",
      },
    });
    expect(session.currentStepId).toBe("deployment");

    session = await investor.saveResponse({
      stepId: "deployment",
      response: { kind: "choice", value: "actively_investing" },
    });
    const mandate = expectKind(session.step, "mandate_select");
    expect(mandate.candidates).toHaveLength(1);
    expect(mandate.suggestedMandateId).toBe(mandate.candidates[0]?.mandateId);
    session = await investor.saveResponse({
      stepId: "mandate",
      response: {
        kind: "mandate_select",
        mandateId: mandate.candidates[0]?.mandateId ?? "",
      },
    });
    expect(session.currentStepId).toBe("stage_cheque");

    session = await investor.saveResponse({
      stepId: "stage_cheque",
      response: {
        kind: "stage_cheque",
        stages: ["seed", "series_a"],
        currency: "USD",
        min: "250000",
        typical: "1000000",
        max: "3000000",
        roles: ["lead"],
      },
    });
    expect(session.currentStepId).toBe("geography");

    const places = await investor.findTaxonomyCandidates({ text: "nigeria" });
    expect(places.map((c) => c.label)).toContain("Nigeria");
    session = await investor.saveResponse({
      stepId: "geography",
      response: {
        kind: "taxonomy_focus",
        nodeIds: places.slice(0, 1).map((c) => c.nodeId),
        strength: "must",
      },
    });
    expect(session.currentStepId).toBe("sectors");

    const sectors = await investor.findTaxonomyCandidates({ text: "fintech" });
    const gambling = await investor.findTaxonomyCandidates({
      text: "gambling",
    });
    session = await investor.saveResponse({
      stepId: "sectors",
      response: {
        kind: "taxonomy_focus",
        nodeIds: sectors.slice(0, 1).map((c) => c.nodeId),
        avoidNodeIds: [],
      },
    });
    const attributes = expectKind(session.step, "attributes");
    expect(attributes.businessModelOptions.map((o) => o.label)).toContain(
      "B2B SaaS",
    );
    session = await investor.saveResponse({
      stepId: "attributes",
      response: {
        kind: "attributes",
        businessModelIds: attributes.businessModelOptions
          .slice(0, 1)
          .map((o) => o.nodeId),
        customerTypeIds: [],
        capitalIntensity: "capital_light",
      },
    });
    expect(session.currentStepId).toBe("founder");

    session = await investor.skipStep({ stepId: "founder" });
    expect(session.currentStepId).toBe("green_flags");
    session = await investor.saveResponse({
      stepId: "green_flags",
      response: {
        kind: "flags",
        codes: ["capital_efficiency"],
        customText: "Founders who have sold into banks before.",
      },
    });
    expect(session.currentStepId).toBe("red_flags");

    session = await investor.saveResponse({
      stepId: "red_flags",
      response: {
        kind: "red_flags",
        avoid: ["hardware_heavy"],
        hard: ["gambling"],
        sectorExclusionIds: gambling.slice(0, 1).map((c) => c.nodeId),
      },
    });
    expect(session.currentStepId).toBe("portfolio");
    await investor.saveResponse({
      stepId: "portfolio",
      response: { kind: "narrative", text: "Paystack\nMoniepoint" },
    });
    await investor.saveResponse({
      stepId: "discovery",
      response: { kind: "choice", value: "balanced" },
    });
    await investor.saveResponse({
      stepId: "inbound",
      response: { kind: "choice", value: "qualified" },
    });
    session = await investor.skipStep({ stepId: "context" });

    // I11: a deterministic projection of what was declared, and nothing else.
    const review = expectKind(session.step, "mandate_review");
    expect(review.title).toBe("Here's the mandate you've defined");
    expect(review.review).toBeDefined();
    const r = review.review;
    if (r === undefined) throw new Error("review context missing");
    expect(r.investor.displayName).toBe("Northbank Capital");
    expect(r.mandate.status).toBe("DRAFT");
    expect(r.mandate.stages.map((s) => s.key)).toEqual(["seed", "series_a"]);
    expect(r.mandate.cheque).toEqual({
      currency: "USD",
      min: "250000",
      typical: "1000000",
      max: "3000000",
    });
    expect(r.mandate.geographies).toEqual([
      expect.objectContaining({ label: "Nigeria", strength: "MUST" }),
    ]);
    expect(r.mandate.greenFlags).toEqual([
      expect.objectContaining({
        code: "capital_efficiency",
        strength: "STRONG",
      }),
    ]);
    expect(r.mandate.customCriteria).toEqual([
      "Founders who have sold into banks before.",
    ]);
    // AVOID and HARD_EXCLUSION never blur into one list.
    expect(r.mandate.avoid).toEqual([
      expect.objectContaining({
        code: "hardware_heavy",
        strength: "AVOID",
        isExclusion: false,
      }),
    ]);
    expect(r.mandate.hardExclusions.map((h) => h.label).sort()).toEqual([
      "Gambling",
      "Gambling",
    ]);
    expect(r.mandate.hardExclusions.every((h) => h.isExclusion)).toBe(true);
    expect(r.portfolio.map((p) => p.companyName)).toEqual([
      "Paystack",
      "Moniepoint",
    ]);
    expect(r.onboardingOnly.inboundPreference?.key).toBe("qualified");
    expect(r.mandate.rawTextRecorded).toBe(false);
    expect(JSON.stringify(review)).not.toMatch(FORBIDDEN_COPY);

    // Confirming activates the draft: DRAFT → ACTIVE, version moves on.
    const draftVersion = r.mandate.version;
    session = await investor.saveResponse({
      stepId: "review",
      response: { kind: "mandate_review", confirmed: true },
    });
    const handoff = expectKind(session.step, "handoff");
    expect(handoff.title).toBe("Your mandate is ready");
    expect(handoff.handoff?.mandate.status).toBe("ACTIVE");
    expect(handoff.handoff?.mandate.version).toBe(draftVersion + 1);
    expect(handoff.handoff?.recommendation).toBe("NOT_AVAILABLE");
    expect(JSON.stringify(handoff)).not.toMatch(FORBIDDEN_COPY);

    await investor.saveResponse({
      stepId: "handoff",
      response: { kind: "handoff", confirmed: true },
    });
    session = await investor.complete();
    expect(session.status).toBe("complete");
    expect(session.step).toBeUndefined();

    // Resume from storage (a refresh) lands on the completed session.
    const again = client(storage);
    expect((await again.getSession()).status).toBe("complete");
    expect(storage.getItem(FIXTURE_STORAGE_KEY)).not.toBeNull();
  });

  it("editing the cheque from the review recalibrates the same mandate (version increments) instead of creating another", async () => {
    const investor = client(null, "review");
    let session = await investor.getSession();
    const before = expectKind(session.step, "mandate_review").review;
    if (before === undefined) throw new Error("review context missing");
    expect(before.mandate.status).toBe("DRAFT");

    session = await investor.openStep({ stepId: "stage_cheque" });
    const cheque = expectKind(session.step, "stage_cheque");
    expect(cheque.response?.typical).toBe("1000000");
    session = await investor.saveResponse({
      stepId: "stage_cheque",
      response: {
        kind: "stage_cheque",
        stages: ["seed"],
        currency: "USD",
        min: "250000",
        typical: "1500000",
        max: "3000000",
        roles: ["lead"],
      },
    });
    // Everything after was already visited: the client jumps forward.
    expect(session.currentStepId).toBe("review");
    const after = expectKind(session.step, "mandate_review").review;
    expect(after?.mandate.mandateId).toBe(before.mandate.mandateId);
    expect(after?.mandate.version).toBeGreaterThan(before.mandate.version);
    expect(after?.mandate.cheque?.typical).toBe("1500000");
    expect(after?.mandate.stages.map((s) => s.key)).toEqual(["seed"]);
  });

  it("back reopens the previous screen with its answers", async () => {
    const investor = client(null, "mandate");
    let session = await investor.getSession();
    expect(session.currentStepId).toBe("stage_cheque");
    session = await investor.goBack({ stepId: "stage_cheque" });
    expect(session.currentStepId).toBe("mandate");
    session = await investor.goBack({ stepId: "mandate" });
    expect(expectKind(session.step, "choice").response?.value).toBe(
      "actively_investing",
    );
    session = await investor.goBack({ stepId: "deployment" });
    expect(expectKind(session.step, "investor_role").response).toEqual({
      kind: "investor_role",
      investorType: "vc",
      organisationName: "Northbank Capital",
      businessTitle: "Partner",
    });
  });

  it("a transient failure keeps the operation retryable and a stale version surfaces as CONFLICT", async () => {
    const flaky = client(null, "flaky");
    await flaky.getSession();
    const role = {
      kind: "investor_role" as const,
      investorType: "angel",
      organisationName: "Personal Investing",
    };
    await expect(
      flaky.saveResponse({ stepId: "role", response: role }),
    ).rejects.toMatchObject({ kind: "NETWORK", retryable: true });
    const after = await flaky.saveResponse({ stepId: "role", response: role });
    expect(after.currentStepId).toBe("deployment");

    const storage = memoryStorage();
    const first = client(storage, "mandate");
    const second = client(storage);
    await first.getSession();
    await second.getSession();
    await first.saveResponse({
      stepId: "stage_cheque",
      response: {
        kind: "stage_cheque",
        stages: ["seed"],
        currency: "USD",
        roles: [],
      },
    });
    const stale = second.saveResponse({
      stepId: "stage_cheque",
      response: {
        kind: "stage_cheque",
        stages: ["series_b"],
        currency: "EUR",
        roles: [],
      },
    });
    await expect(stale).rejects.toBeInstanceOf(OnboardingClientError);
    await expect(stale).rejects.toMatchObject({ kind: "CONFLICT" });
    const fresh = await second.getSession();
    expect(fresh.currentStepId).toBe("geography");
  });

  it("plans every composite screen onto its runtime steps in definition order, leaving strength steps alone when their list is empty", () => {
    const stageCheque = requireGroup("stage_cheque");
    expect(
      planSubmissions(stageCheque, {
        kind: "stage_cheque",
        stages: ["seed"],
        currency: "NGN",
        max: "50000000",
        roles: [],
      }).map((s) => [s.stepKey, s.action]),
    ).toEqual([
      [INVESTOR_STEPS.stages, "submit"],
      [INVESTOR_STEPS.currency, "submit"],
      [INVESTOR_STEPS.chequeMin, "skip"],
      [INVESTOR_STEPS.chequeTypical, "skip"],
      [INVESTOR_STEPS.chequeMax, "submit"],
      [INVESTOR_STEPS.investmentRole, "skip"],
    ]);
    const sectors = requireGroup("sectors");
    expect(
      planSubmissions(sectors, {
        kind: "taxonomy_focus",
        nodeIds: [],
        avoidNodeIds: [],
      }).map((s) => [s.stepKey, s.action]),
    ).toEqual([
      [INVESTOR_STEPS.sectors, "skip"],
      [INVESTOR_STEPS.sectorStrength, "leave"],
      [INVESTOR_STEPS.sectorsAvoid, "skip"],
    ]);
    const redFlags = requireGroup("red_flags");
    expect(() =>
      planSubmissions(redFlags, {
        kind: "red_flags",
        avoid: ["gambling"],
        hard: ["gambling"],
        sectorExclusionIds: [],
      }),
    ).toThrow(/both/);
    const role = requireGroup("role");
    expect(
      planSubmissions(role, {
        kind: "investor_role",
        investorType: "angel",
        organisationName: "Personal Investing",
      }).map((s) => [s.stepKey, s.action]),
    ).toEqual([
      [INVESTOR_STEPS.investorType, "submit"],
      [INVESTOR_STEPS.organisationName, "submit"],
      [INVESTOR_STEPS.businessTitle, "skip"],
    ]);
  });

  it("refuses a session pinned to a definition version this build cannot present", async () => {
    const port = createInvestorFixtureRuntimePort({
      storage: null,
      seed: "reset",
    });
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
      createRuntimeInvestorClient(v2, SOURCE).getSession(),
    ).rejects.toMatchObject({ kind: "UNAVAILABLE" });
  });
});
