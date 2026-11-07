import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { validateOnboardingManifest } from "@capital-q/onboarding";

import {
  FOUNDER_DEFINITION_CURRENT,
  FOUNDER_DEFINITION_V8,
  FOUNDER_DEFINITION_V9,
  FOUNDER_STEPS,
  renderOnboardingDefinitionMigration,
} from "../src/index.js";

/**
 * Founder v9 (owner 2026-11-07, DECISIONS 79): what the profile shows and
 * what matching and verification need is mandatory; "I don't know" answers
 * any of it.
 */
const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261231440000_founder_onboarding_definition_v9.sql",
    import.meta.url,
  ),
);

const required = (key: string): boolean | undefined =>
  FOUNDER_DEFINITION_V9.steps.find((s) => s.stepKey === key)?.required;

describe("founder definition v9", () => {
  it("is valid, and superseded by v10 for new sessions", () => {
    expect(() =>
      validateOnboardingManifest(FOUNDER_DEFINITION_V9),
    ).not.toThrow();
    expect(FOUNDER_DEFINITION_CURRENT.version).toBe(10);
  });

  it("makes the profile's, matching's and verification's fields mandatory", () => {
    for (const key of [
      FOUNDER_STEPS.companyName,
      FOUNDER_STEPS.website,
      FOUNDER_STEPS.country,
      FOUNDER_STEPS.stage,
      FOUNDER_STEPS.description,
      FOUNDER_STEPS.categories,
      FOUNDER_STEPS.founderRole,
      FOUNDER_STEPS.signal,
      FOUNDER_STEPS.pilots,
      FOUNDER_STEPS.revenueStatus,
      FOUNDER_STEPS.customers,
      FOUNDER_STEPS.growth,
      FOUNDER_STEPS.raising,
      FOUNDER_STEPS.currency,
      FOUNDER_STEPS.targetAmount,
      FOUNDER_STEPS.instrument,
      FOUNDER_STEPS.timeframe,
      FOUNDER_STEPS.useOfFunds,
    ]) {
      expect(required(key), key).toBe(true);
    }
    // Why they came writes nothing; the deck is encouraged, never blocking;
    // the founder's role is enough (owner), so the team counts are not.
    expect(required(FOUNDER_STEPS.intent)).toBe(false);
    expect(required(FOUNDER_STEPS.founderCount)).toBe(false);
    expect(required(FOUNDER_STEPS.fullTime)).toBe(false);
    expect(required(FOUNDER_STEPS.teamSize)).toBe(false);
    expect(required(FOUNDER_STEPS.materials)).toBe(false);
  });

  it("never calls a mandatory step optional", () => {
    for (const step of FOUNDER_DEFINITION_V9.steps) {
      if (!step.required) continue;
      expect(step.configuration.supportingText ?? "", step.stepKey).not.toMatch(
        /optional/iu,
      );
    }
  });

  it("changes nothing else: keys, order, types, branches and write targets are v8's", () => {
    expect(FOUNDER_DEFINITION_V9.steps.length).toBe(
      FOUNDER_DEFINITION_V8.steps.length,
    );
    FOUNDER_DEFINITION_V8.steps.forEach((before, index) => {
      const after = FOUNDER_DEFINITION_V9.steps[index];
      expect(after?.stepKey).toBe(before.stepKey);
      expect(after?.branching).toEqual(before.branching);
      expect(after?.writesTo).toEqual(before.writesTo);
      expect(after?.configuration.stepType).toBe(before.configuration.stepType);
    });
  });

  it("is committed exactly as rendered, publishing v9 for new sessions", () => {
    const rendered = renderOnboardingDefinitionMigration(
      FOUNDER_DEFINITION_V9,
      { packet: "OWNER-MANDATORY-SET" },
    );
    expect(readFileSync(MIGRATION, "utf8").endsWith(rendered)).toBe(true);
    expect(rendered).toContain("set current_version = 9");
  });
});
