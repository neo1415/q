import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  INVESTOR_INBOUND_PREFERENCES,
  INVESTOR_TYPES,
  DISCOVERY_MODES,
  INVESTOR_DEPLOYMENT_STATES,
} from "@capital-q/contracts";
import {
  FOUNDER_BUSINESS_ATTRIBUTE_CODES,
  GREEN_FLAG_CODES,
  INVESTMENT_ROLE_CODES,
} from "@capital-q/investors";
import {
  hashOnboardingRequest,
  referencedStepKeys,
  renderOnboardingDefinitionMigration,
  validateOnboardingManifest,
  type ResponseValues,
} from "@capital-q/onboarding";

import {
  businessAttributeConstraints,
  createInvestorStepContextProviders,
  createInvestorWriteTargets,
  DEPLOYMENT_STATUS_OPTIONS,
  DISCOVERY_MODE_OPTIONS,
  exclusionConstraints,
  FOUNDER_PREFERENCE_OPTIONS,
  founderPreferenceConstraints,
  GREEN_FLAG_OPTIONS,
  greenFlagConstraints,
  INBOUND_PREFERENCE_OPTIONS,
  INVESTMENT_ROLE_OPTIONS,
  INVESTOR_DEFINITION_V1,
  INVESTOR_STEP_CONTEXTS,
  INVESTOR_STEPS,
  INVESTOR_TYPE_OPTIONS,
  INVESTOR_WRITE_TARGETS,
  organisationTypeFor,
  portfolioNames,
  stageChequePatch,
} from "../src/index.js";

const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20260905120000_investor_onboarding_v1.sql",
    import.meta.url,
  ),
);

const noDomain = {
  outbox: { enqueue: () => Promise.reject(new Error("unused")) },
  audit: { record: () => Promise.reject(new Error("unused")) },
};

const values = (entries: Record<string, unknown>): ResponseValues =>
  new Map(Object.entries(entries)) as unknown as ResponseValues;
const single = (optionKey: string) => ({ type: "SINGLE_SELECT", optionKey });
const multi = (optionKeys: string[]) => ({ type: "MULTI_SELECT", optionKeys });
const range = (value: string) => ({ type: "RANGE", value });
const text = (value: string) => ({ type: "TEXT", text: value });

describe("Investor Definition v1", () => {
  const manifest = validateOnboardingManifest(INVESTOR_DEFINITION_V1);

  it("is a valid investor journey with the I0–I12 phases in order", () => {
    expect(manifest.journeyType).toBe("investor");
    expect(manifest.version).toBe(1);
    expect(manifest.schema.runtime).toEqual({
      subjectType: "INVESTOR_ORGANISATION",
      allowUnboundStart: true,
    });
    expect(manifest.schema.phases.map((p) => p.phaseKey)).toEqual(
      Array.from({ length: 13 }, (_, i) => `I${String(i)}`),
    );
    expect(manifest.steps.map((s) => s.stepKey)).toEqual(
      Object.values(INVESTOR_STEPS),
    );
  });

  it("uses canonical Investor vocabularies, never an onboarding-only enum", () => {
    expect(INVESTOR_TYPE_OPTIONS.map((o) => o.optionKey.toUpperCase())).toEqual(
      [...INVESTOR_TYPES],
    );
    expect(
      DEPLOYMENT_STATUS_OPTIONS.map((o) => o.optionKey.toUpperCase()),
    ).toEqual([...INVESTOR_DEPLOYMENT_STATES]);
    expect(
      DISCOVERY_MODE_OPTIONS.map((o) => o.optionKey.toUpperCase()),
    ).toEqual([...DISCOVERY_MODES]);
    expect(
      INBOUND_PREFERENCE_OPTIONS.map((o) => o.optionKey.toUpperCase()),
    ).toEqual([...INVESTOR_INBOUND_PREFERENCES]);
    expect(INVESTMENT_ROLE_OPTIONS.map((o) => o.optionKey)).toEqual([
      ...INVESTMENT_ROLE_CODES,
    ]);
    expect(GREEN_FLAG_OPTIONS.map((o) => o.optionKey)).toEqual([
      ...GREEN_FLAG_CODES,
    ]);
    // I5 offers exactly the approved founder allowlist: nothing personal.
    expect(FOUNDER_PREFERENCE_OPTIONS.map((o) => o.optionKey)).toEqual([
      ...FOUNDER_BUSINESS_ATTRIBUTE_CODES,
    ]);
  });

  it("only writes to targets a registered handler owns and names registered contexts", () => {
    const handlers = new Set(
      createInvestorWriteTargets(noDomain).map((h) => h.targetKey),
    );
    const providers = new Set(
      createInvestorStepContextProviders(noDomain).map((p) => p.key),
    );
    expect([...handlers].sort()).toEqual(
      Object.values(INVESTOR_WRITE_TARGETS).sort(),
    );
    expect([...providers].sort()).toEqual(
      Object.values(INVESTOR_STEP_CONTEXTS).sort(),
    );
    for (const step of manifest.steps) {
      for (const target of step.writesTo) {
        expect(handlers.has(target.targetKey)).toBe(true);
      }
      const c = step.configuration;
      if (
        (c.stepType === "confirmation" || c.stepType === "reference_select") &&
        c.contextKey !== undefined
      ) {
        expect(providers.has(c.contextKey)).toBe(true);
      }
    }
    // Branching references only earlier steps.
    const index = new Map(
      manifest.steps.map((s) => [s.stepKey, s.sequenceOrder]),
    );
    for (const step of manifest.steps) {
      if (step.branching === null) continue;
      for (const key of referencedStepKeys(step.branching)) {
        expect(index.get(key)).toBeLessThan(step.sequenceOrder);
      }
    }
  });

  it("keeps I10 and the revenue expectation onboarding-only, and I12 writes nothing", () => {
    const targets = new Map(
      manifest.steps.map((s) => [
        s.stepKey,
        s.writesTo.map((t) => t.targetKey),
      ]),
    );
    expect(targets.get(INVESTOR_STEPS.inboundPreference)).toEqual([]);
    expect(targets.get(INVESTOR_STEPS.revenueState)).toEqual([]);
    expect(targets.get(INVESTOR_STEPS.handoff)).toEqual([]);
    expect(targets.get(INVESTOR_STEPS.review)).toEqual([
      "investor.mandate.confirm",
    ]);
    expect(targets.get(INVESTOR_STEPS.deploymentStatus)).toEqual([
      "investor.deployment_status",
      "investor.mandate.ensure",
    ]);
  });

  it("copy never claims Q, GateQ or a feed exists, and Avoid is distinguished from Never show", () => {
    const copy = JSON.stringify(manifest);
    expect(copy).not.toMatch(
      /Q understood|Q analysed|Q recommends|GateQ is live|matches found|personalised feed/i,
    );
    const avoid = manifest.steps.find(
      (s) => s.stepKey === INVESTOR_STEPS.avoid,
    );
    const hard = manifest.steps.find(
      (s) => s.stepKey === INVESTOR_STEPS.hardExclusions,
    );
    expect(avoid?.configuration.supportingText).toMatch(/can still appear/);
    expect(hard?.configuration.supportingText).toMatch(/not shown/);
    expect(hard?.configuration.prompt).toBe("Never show me");
    const review = manifest.steps.find(
      (s) => s.stepKey === INVESTOR_STEPS.review,
    );
    expect(review?.configuration.prompt).toBe(
      "Here's the mandate you've defined",
    );
    const handoff = manifest.steps.find(
      (s) => s.stepKey === INVESTOR_STEPS.handoff,
    );
    expect(handoff?.configuration.supportingText).toContain(
      "structured criteria needed to generate your opportunities",
    );
  });

  it("the committed migration ends with the rendered manifest", () => {
    const rendered = renderOnboardingDefinitionMigration(
      INVESTOR_DEFINITION_V1,
      {
        packet: "CQ-ONB-003",
        source: "packages/investor-onboarding/src/definition",
      },
    );
    const committed = readFileSync(MIGRATION, "utf8");
    expect(committed.endsWith(rendered)).toBe(true);
    expect(committed).toContain("core.investor_portfolio_references");
    expect(rendered).toContain(`'${hashOnboardingRequest(manifest)}'`);
  });
});

describe("Investor canonical mappings", () => {
  it("derives the stage envelope, exact cheques and roles from I2 answers", () => {
    const patch = stageChequePatch(
      values({
        [INVESTOR_STEPS.stages]: multi(["series_a", "pre_seed", "seed"]),
        [INVESTOR_STEPS.currency]: single("usd"),
        [INVESTOR_STEPS.chequeMin]: range("0.10"),
        [INVESTOR_STEPS.chequeTypical]: range("123456789012.34"),
        [INVESTOR_STEPS.chequeMax]: range("999999999999.99"),
        [INVESTOR_STEPS.investmentRole]: multi(["lead", "co_invest"]),
      }),
    );
    expect(patch.minStageCode).toBe("pre_seed");
    expect(patch.maxStageCode).toBe("series_a");
    expect(patch.chequeRange).toEqual({
      currency: "USD",
      min: "0.10",
      typical: "123456789012.34",
      max: "999999999999.99",
    });
    expect(patch.constraints).toEqual([
      {
        dimension: "stage",
        operator: "IN",
        value: { kind: "codes", values: ["pre_seed", "seed", "series_a"] },
        importance: "MUST",
        isHardExclusion: false,
      },
      {
        dimension: "investment_role",
        operator: "IN",
        value: { kind: "codes", values: ["lead", "co_invest"] },
        importance: "STRONG",
        isHardExclusion: false,
      },
    ]);
    const unknown = stageChequePatch(
      values({ [INVESTOR_STEPS.stages]: multi(["seed"]) }),
    );
    expect(unknown.chequeRange).toBeNull();
    expect(unknown.minStageCode).toBe("seed");
  });

  it("maps I4/I5/I6 to explicit preference classes and refuses codes outside the allowlists", () => {
    expect(
      businessAttributeConstraints(
        values({
          [INVESTOR_STEPS.capitalIntensity]: single("avoid_hardware"),
          [INVESTOR_STEPS.regulatoryAppetite]: single("prefer_regulated"),
        }),
      ),
    ).toEqual([
      {
        dimension: "business.attribute",
        operator: "EQ",
        value: { kind: "codes", values: ["hardware"] },
        importance: "AVOID",
        isHardExclusion: false,
      },
      {
        dimension: "business.attribute",
        operator: "EQ",
        value: { kind: "codes", values: ["regulated"] },
        importance: "STRONG",
        isHardExclusion: false,
      },
    ]);
    expect(
      founderPreferenceConstraints(
        values({
          [INVESTOR_STEPS.founderPreferences]: multi([
            "repeat_founder_experience",
          ]),
          [INVESTOR_STEPS.founderStrength]: single("strong"),
        }),
      ),
    ).toEqual([
      {
        dimension: "founder.business_attribute",
        operator: "EQ",
        value: { kind: "codes", values: ["repeat_founder_experience"] },
        importance: "STRONG",
        isHardExclusion: false,
      },
    ]);
    // A protected or personal trait smuggled past the UI is refused outright.
    expect(() =>
      founderPreferenceConstraints(
        values({
          [INVESTOR_STEPS.founderPreferences]: multi(["founder_ethnicity"]),
        }),
      ),
    ).toThrow(/not available/);
    const green = greenFlagConstraints(
      values({
        [INVESTOR_STEPS.greenFlags]: multi([
          "capital_efficiency",
          "high_retention",
        ]),
        [INVESTOR_STEPS.customCriteria]: text("Founders who ship weekly"),
      }),
    );
    expect(green[0]).toMatchObject({
      dimension: "green_flag",
      importance: "STRONG",
    });
    expect(green[1]).toEqual({
      dimension: "custom.text",
      operator: "EQ",
      value: { kind: "text", text: "Founders who ship weekly" },
      importance: "NICE",
      isHardExclusion: false,
    });
  });

  it("keeps AVOID soft and HARD_EXCLUSION hard, and refuses the same flag in both", () => {
    expect(
      exclusionConstraints(
        values({
          [INVESTOR_STEPS.avoid]: multi(["hardware_heavy"]),
          [INVESTOR_STEPS.hardExclusions]: multi(["gambling", "weapons"]),
        }),
      ),
    ).toEqual([
      {
        dimension: "red_flag",
        operator: "EQ",
        value: { kind: "codes", values: ["hardware_heavy"] },
        importance: "AVOID",
        isHardExclusion: false,
      },
      {
        dimension: "red_flag",
        operator: "IN",
        value: { kind: "codes", values: ["gambling", "weapons"] },
        importance: "HARD_EXCLUSION",
        isHardExclusion: true,
      },
    ]);
    expect(() =>
      exclusionConstraints(
        values({
          [INVESTOR_STEPS.avoid]: multi(["gambling"]),
          [INVESTOR_STEPS.hardExclusions]: multi(["gambling"]),
        }),
      ),
    ).toThrow(/either something to avoid/);
  });

  it("parses up to five portfolio names and maps investor types to organisation types", () => {
    expect(
      portfolioNames(" Stripe \nStripe\n\nPaystack\r\nFlutterwave"),
    ).toEqual(["Stripe", "Paystack", "Flutterwave"]);
    expect(portfolioNames(null)).toEqual([]);
    expect(() => portfolioNames("a\nb\nc\nd\ne\nf")).toThrow(/Up to 5/);
    expect(organisationTypeFor("ANGEL")).toBe("investment_firm");
    expect(organisationTypeFor("FAMILY_OFFICE")).toBe("family_office");
    expect(organisationTypeFor("INSTITUTIONAL")).toBe("institution");
  });
});
