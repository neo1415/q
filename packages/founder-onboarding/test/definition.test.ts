import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  hashOnboardingRequest,
  referencedStepKeys,
  validateOnboardingManifest,
} from "@capital-q/onboarding";

import {
  capitalObjectiveInput,
  CATEGORY_VOCABULARIES,
  createFounderStepContextProviders,
  createFounderWriteTargets,
  FOUNDER_DEFINITION_V1,
  FOUNDER_STEP_CONTEXTS,
  FOUNDER_STEPS,
  FOUNDER_WRITE_TARGETS,
  normaliseWebsite,
  onboardingDefinitionIds,
  renderOnboardingDefinitionMigration,
  teamFactsInput,
  type ResponseValues,
} from "../src/index.js";

const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20260905090000_founder_onboarding_definition_v1.sql",
    import.meta.url,
  ),
);

const noDomain = {
  outbox: { enqueue: () => Promise.reject(new Error("unused")) },
  audit: { record: () => Promise.reject(new Error("unused")) },
};

describe("Founder Definition v1", () => {
  const manifest = validateOnboardingManifest(FOUNDER_DEFINITION_V1);

  it("is a valid founder journey with the F0–F8 phases in order", () => {
    expect(manifest.journeyType).toBe("founder");
    expect(manifest.version).toBe(1);
    expect(manifest.schema.runtime).toEqual({
      subjectType: "COMPANY",
      allowUnboundStart: true,
    });
    expect(manifest.schema.phases.map((phase) => phase.phaseKey)).toEqual([
      "F0",
      "F1",
      "F2",
      "F3",
      "F4",
      "F5",
      "F6",
      "F7",
      "F8",
    ]);
  });

  it("declares exactly the step keys the integration layer knows, in sequence", () => {
    const keys = manifest.steps.map((step) => step.stepKey);
    expect(keys).toEqual(Object.values(FOUNDER_STEPS));
    expect(manifest.steps.map((step) => step.sequenceOrder)).toEqual(
      keys.map((_, index) => index),
    );
    // Phases never go backwards along the sequence.
    const phaseOrder = manifest.schema.phases.map((p) => p.phaseKey);
    let last = -1;
    for (const step of manifest.steps) {
      const index = phaseOrder.indexOf(step.configuration.phaseKey ?? "");
      expect(index).toBeGreaterThanOrEqual(last);
      last = index;
    }
  });

  it("only writes to targets a registered handler owns, and only names registered contexts", () => {
    const handlers = new Set(
      createFounderWriteTargets(noDomain).map((h) => h.targetKey),
    );
    const providers = new Set(
      createFounderStepContextProviders(noDomain).map((p) => p.key),
    );
    expect([...handlers].sort()).toEqual(
      Object.values(FOUNDER_WRITE_TARGETS).sort(),
    );
    expect([...providers].sort()).toEqual(
      Object.values(FOUNDER_STEP_CONTEXTS).sort(),
    );
    for (const step of manifest.steps) {
      for (const target of step.writesTo) {
        expect(handlers.has(target.targetKey)).toBe(true);
      }
      if (
        step.configuration.stepType === "confirmation" &&
        step.configuration.contextKey !== undefined
      ) {
        expect(providers.has(step.configuration.contextKey)).toBe(true);
      }
    }
  });

  it("maps the canonical writes onto the steps the spec names", () => {
    const targets = new Map(
      manifest.steps.map((step) => [
        step.stepKey,
        step.writesTo.map((t) => t.targetKey),
      ]),
    );
    expect(targets.get(FOUNDER_STEPS.companyName)).toEqual([
      "company.bootstrap",
    ]);
    expect(targets.get(FOUNDER_STEPS.categories)).toEqual(["company.taxonomy"]);
    expect(targets.get(FOUNDER_STEPS.founderRole)).toEqual([
      "founder.membership",
    ]);
    expect(targets.get(FOUNDER_STEPS.teamSize)).toEqual(["company.team_facts"]);
    expect(targets.get(FOUNDER_STEPS.raiseConfirm)).toEqual([
      "capital.objective",
    ]);
    // Onboarding-only: no canonical field exists for these.
    for (const key of [
      FOUNDER_STEPS.intent,
      FOUNDER_STEPS.materials,
      FOUNDER_STEPS.functions,
      FOUNDER_STEPS.signal,
      FOUNDER_STEPS.pilots,
      FOUNDER_STEPS.revenueStatus,
      FOUNDER_STEPS.customers,
      FOUNDER_STEPS.growth,
      FOUNDER_STEPS.timeframe,
      FOUNDER_STEPS.followUp,
      FOUNDER_STEPS.snapshot,
    ]) {
      expect(targets.get(key)).toEqual([]);
    }
  });

  it("branches traction on stage and the raise on the raising answer, referencing only earlier steps", () => {
    const index = new Map(
      manifest.steps.map((s) => [s.stepKey, s.sequenceOrder]),
    );
    for (const step of manifest.steps) {
      if (step.branching === null) continue;
      for (const referenced of referencedStepKeys(step.branching)) {
        expect(index.get(referenced)).toBeLessThan(step.sequenceOrder);
      }
    }
    const branch = (key: string) =>
      manifest.steps.find((s) => s.stepKey === key)?.branching;
    expect(branch(FOUNDER_STEPS.signal)).toEqual({
      op: "IN",
      stepKey: FOUNDER_STEPS.stage,
      values: ["pre_seed", "seed", "unsure"],
    });
    expect(branch(FOUNDER_STEPS.revenueStatus)).toEqual({
      op: "IN",
      stepKey: FOUNDER_STEPS.stage,
      values: ["series_a", "series_b", "series_c_plus"],
    });
    expect(branch(FOUNDER_STEPS.raiseConfirm)).toEqual({
      op: "IN",
      stepKey: FOUNDER_STEPS.raising,
      values: ["active", "preparing"],
    });
    expect(branch(FOUNDER_STEPS.intent)).toBeNull();
  });

  it("offers taxonomy confirmation as an optional reference selection over the company vocabularies", () => {
    const step = manifest.steps.find(
      (s) => s.stepKey === FOUNDER_STEPS.categories,
    );
    expect(step?.required).toBe(false);
    expect(step?.configuration).toMatchObject({
      stepType: "reference_select",
      resourceType: "TAXONOMY_NODE",
      vocabularyCodes: [...CATEGORY_VOCABULARIES],
      minItems: 1,
      maxItems: 8,
    });
    expect(step?.configuration.supportingText).toContain(
      "Suggested categories",
    );
    expect(JSON.stringify(manifest)).not.toMatch(/Q analysis/);
  });

  it("keeps F2 a declaration, F7 founder-private and F8 free of analysis language", () => {
    const materials = manifest.steps.find(
      (s) => s.stepKey === FOUNDER_STEPS.materials,
    );
    expect(materials?.configuration.stepType).toBe("multi_select");
    expect(materials?.configuration).toMatchObject({
      exclusiveOptionKeys: ["nothing_yet"],
    });
    const followUp = manifest.steps.find(
      (s) => s.stepKey === FOUNDER_STEPS.followUp,
    );
    expect(followUp?.required).toBe(false);
    expect(followUp?.writesTo).toEqual([]);
    expect(followUp?.configuration.supportingText).toContain("Private to you");
    const snapshot = manifest.steps.find(
      (s) => s.stepKey === FOUNDER_STEPS.snapshot,
    );
    expect(snapshot?.configuration.prompt).toBe("Here's what we have so far");
    expect(JSON.stringify(snapshot)).not.toMatch(
      /readiness|score|verified|discoverab|investor match/i,
    );
  });

  it("renders deterministic ids and the committed migration is exactly the rendered manifest", () => {
    const ids = onboardingDefinitionIds("founder", 1);
    const again = onboardingDefinitionIds("founder", 1);
    expect([ids.definitionId, ids.versionId, ids.stepId("F0.intent")]).toEqual([
      again.definitionId,
      again.versionId,
      again.stepId("F0.intent"),
    ]);
    expect(ids.versionId).not.toBe(
      onboardingDefinitionIds("founder", 2).versionId,
    );
    expect(ids.stepId("F0.intent")).not.toBe(ids.stepId("F1.stage"));

    const rendered = renderOnboardingDefinitionMigration(
      FOUNDER_DEFINITION_V1,
      {
        packet: "CQ-ONB-002",
      },
    );
    const committed = readFileSync(MIGRATION, "utf8");
    expect(committed.endsWith(rendered)).toBe(true);
    expect(committed).toContain("'reference_select'");
    expect(rendered).toContain(`'${hashOnboardingRequest(manifest)}'`);
    // Republishing the same manifest must be idempotent: same hash, same rows.
    expect(rendered).toContain(`'${ids.versionId}'`);
    expect(rendered.match(/\n {2}\('[0-9a-f-]{36}', '/g)).toHaveLength(
      manifest.steps.length,
    );
  });
});

describe("Founder canonical mappings", () => {
  const values = (entries: Record<string, unknown>): ResponseValues =>
    new Map(Object.entries(entries)) as unknown as ResponseValues;

  it("normalises a bare domain into an https URL and keeps explicit schemes", () => {
    expect(normaliseWebsite("example.com")).toBe("https://example.com");
    expect(normaliseWebsite("http://example.com/x")).toBe(
      "http://example.com/x",
    );
    expect(normaliseWebsite("  HTTPS://Example.com ")).toBe(
      "HTTPS://Example.com",
    );
  });

  it("records team facts exactly and never turns 'some' into a number", () => {
    expect(
      teamFactsInput(
        values({
          [FOUNDER_STEPS.founderCount]: { type: "RANGE", value: "3" },
          [FOUNDER_STEPS.fullTime]: { type: "SINGLE_SELECT", optionKey: "all" },
          [FOUNDER_STEPS.teamSize]: { type: "RANGE", value: "12" },
        }),
      ),
    ).toEqual({ founderCount: 3, fullTimeFounderCount: 3, teamSize: 12 });
    expect(
      teamFactsInput(
        values({
          [FOUNDER_STEPS.founderCount]: { type: "RANGE", value: "2" },
          [FOUNDER_STEPS.fullTime]: {
            type: "SINGLE_SELECT",
            optionKey: "some",
          },
        }),
      ),
    ).toEqual({ founderCount: 2 });
    expect(
      teamFactsInput(
        values({
          [FOUNDER_STEPS.fullTime]: {
            type: "SINGLE_SELECT",
            optionKey: "none",
          },
        }),
      ),
    ).toEqual({ fullTimeFounderCount: 0 });
    expect(teamFactsInput(values({}))).toBeNull();
  });

  it("builds the capital objective from exact strings and drops unknowns", () => {
    expect(
      capitalObjectiveInput(
        values({
          [FOUNDER_STEPS.stage]: { type: "SINGLE_SELECT", optionKey: "seed" },
          [FOUNDER_STEPS.currency]: { type: "SINGLE_SELECT", optionKey: "usd" },
          [FOUNDER_STEPS.targetAmount]: { type: "RANGE", value: "500000" },
          [FOUNDER_STEPS.instrument]: {
            type: "SINGLE_SELECT",
            optionKey: "safe",
          },
          [FOUNDER_STEPS.useOfFunds]: {
            type: "MULTI_SELECT",
            optionKeys: ["product", "hiring"],
          },
        }),
      ),
    ).toEqual({
      target: { amount: "500000", currency: "USD" },
      instrumentCode: "safe",
      useOfFundsSummary: "Product and engineering; Key hires",
      targetStage: "seed",
    });
    expect(
      capitalObjectiveInput(
        values({
          [FOUNDER_STEPS.stage]: { type: "SINGLE_SELECT", optionKey: "unsure" },
          [FOUNDER_STEPS.currency]: { type: "SINGLE_SELECT", optionKey: "ngn" },
          [FOUNDER_STEPS.targetAmount]: { type: "RANGE", value: "2500000" },
          [FOUNDER_STEPS.instrument]: {
            type: "SINGLE_SELECT",
            optionKey: "unsure",
          },
        }),
      ),
    ).toEqual({
      target: { amount: "2500000", currency: "NGN" },
      instrumentCode: null,
      useOfFundsSummary: null,
      targetStage: null,
    });
    expect(() => capitalObjectiveInput(values({}))).toThrow(
      /Currency and target amount/,
    );
  });
});
