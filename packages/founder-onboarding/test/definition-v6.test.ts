import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { validateOnboardingManifest } from "@capital-q/onboarding";

import {
  FOUNDER_DEFINITION_CURRENT,
  FOUNDER_DEFINITION_V5,
  FOUNDER_DEFINITION_V6,
  FOUNDER_PROFILE_SECTIONS,
  FOUNDER_PROFILE_STEPS,
  FOUNDER_REVISABLE_STEPS,
  renderOnboardingDefinitionMigration,
} from "../src/index.js";

/** Founder v6: v5 plus the owner's company profile sections (2026-10-16). */
const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261228180500_founder_onboarding_definition_v6.sql",
    import.meta.url,
  ),
);

describe("founder definition v6", () => {
  it("is valid, and superseded by v7 for new sessions", () => {
    expect(() =>
      validateOnboardingManifest(FOUNDER_DEFINITION_V6),
    ).not.toThrow();
    expect(FOUNDER_DEFINITION_CURRENT.version).toBe(8);
  });

  it("keeps every v5 step unchanged and in v5's relative order", () => {
    const v6 = new Map(FOUNDER_DEFINITION_V6.steps.map((s) => [s.stepKey, s]));
    const strip = ({ sequenceOrder: _, ...rest }: { sequenceOrder: number }) =>
      rest;
    for (const step of FOUNDER_DEFINITION_V5.steps) {
      const same = v6.get(step.stepKey);
      expect(same, step.stepKey).toBeDefined();
      if (same !== undefined) expect(strip(same)).toEqual(strip(step));
    }
    const order = FOUNDER_DEFINITION_V6.steps
      .map((s) => s.stepKey)
      .filter((key) =>
        FOUNDER_DEFINITION_V5.steps.some((s) => s.stepKey === key),
      );
    expect(order).toEqual(FOUNDER_DEFINITION_V5.steps.map((s) => s.stepKey));
  });

  it("holds every section of the profile: its own optional step, or the v5 steps", () => {
    const keys = new Set(FOUNDER_DEFINITION_V6.steps.map((s) => s.stepKey));
    for (const section of FOUNDER_PROFILE_SECTIONS) {
      for (const key of section.stepKeys)
        expect(keys, section.key).toContain(key);
    }
    for (const key of Object.values(FOUNDER_PROFILE_STEPS)) {
      const step = FOUNDER_DEFINITION_V6.steps.find((s) => s.stepKey === key);
      expect(step?.required, key).toBe(false);
      expect(step?.configuration.stepType, key).toBe("long_text");
      expect(FOUNDER_REVISABLE_STEPS.has(key), key).toBe(true);
    }
  });

  it("is committed exactly as rendered, publishing v6 for new sessions", () => {
    const rendered = renderOnboardingDefinitionMigration(
      FOUNDER_DEFINITION_V6,
      {
        packet: "OB1-PROFILE-SECTIONS",
      },
    );
    expect(readFileSync(MIGRATION, "utf8").endsWith(rendered)).toBe(true);
    expect(rendered).toContain("set current_version = 6");
  });
});
