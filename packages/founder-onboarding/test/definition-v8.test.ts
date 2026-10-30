import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { validateOnboardingManifest } from "@capital-q/onboarding";
import { countryOfIso } from "@capital-q/taxonomy/countries";

import {
  COUNTRY_OPTIONS_V5,
  FOUNDER_DEFINITION_CURRENT,
  FOUNDER_DEFINITION_V7,
  FOUNDER_DEFINITION_V8,
  FOUNDER_STEPS,
  founderCountryAnswer,
  founderCountryOf,
  renderOnboardingDefinitionMigration,
} from "../src/index.js";
import { structuredValueFor } from "../src/intelligence/suggestions.js";

/**
 * Founder v8 (owner 2026-10-30): the country is chosen from the geography
 * taxonomy, the one canonical country list. "Copenhagen, Denmark" was saved
 * as "other" because the v1-v7 step offered twenty countries.
 */
const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261231190000_founder_onboarding_definition_v8.sql",
    import.meta.url,
  ),
);

const countryStep = FOUNDER_DEFINITION_V8.steps.find(
  (s) => s.stepKey === FOUNDER_STEPS.country,
);

describe("founder definition v8", () => {
  it("is valid and current", () => {
    expect(() =>
      validateOnboardingManifest(FOUNDER_DEFINITION_V8),
    ).not.toThrow();
    expect(FOUNDER_DEFINITION_CURRENT.version).toBe(8);
  });

  it("chooses one geography node for the country, with no option list", () => {
    expect(countryStep?.configuration).toMatchObject({
      stepType: "reference_select",
      resourceType: "TAXONOMY_NODE",
      vocabularyCodes: ["geography"],
      maxItems: 1,
      prompt: "Where is the company based?",
    });
    expect(countryStep?.configuration).not.toHaveProperty("options");
    expect(countryStep?.required).toBe(false);
  });

  it("changes only the country; every other v7 step is the same", () => {
    expect(FOUNDER_DEFINITION_V8.steps.map((s) => s.stepKey)).toEqual(
      FOUNDER_DEFINITION_V7.steps.map((s) => s.stepKey),
    );
    for (const step of FOUNDER_DEFINITION_V7.steps) {
      if (step.stepKey === FOUNDER_STEPS.country) continue;
      expect(
        FOUNDER_DEFINITION_V8.steps.find((s) => s.stepKey === step.stepKey),
        step.stepKey,
      ).toEqual(step);
    }
  });

  it("reads an older session's option answer as the same country", () => {
    for (const option of COUNTRY_OPTIONS_V5) {
      const read = founderCountryOf({
        type: "SINGLE_SELECT",
        optionKey: option.optionKey,
      });
      if (option.optionKey === "other") {
        expect(read).toBeNull();
        continue;
      }
      expect(read?.iso, option.optionKey).toBe(option.optionKey.toUpperCase());
    }
    // "Somewhere else" with a country's name is that country; other words
    // stay their words.
    expect(
      founderCountryOf({ type: "SINGLE_SELECT", optionKey: "other" }, "Denmark")
        ?.iso,
    ).toBe("DK");
    expect(
      founderCountryOf(
        { type: "SINGLE_SELECT", optionKey: "other" },
        "Copenhagen, Denmark",
      ),
    ).toBeNull();
  });

  it("reads a v8 answer as its country, and a region as none", () => {
    expect(founderCountryOf(founderCountryAnswer("DK"))?.iso).toBe("DK");
    expect(
      founderCountryOf({
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        // Not a country node (a random id): nothing.
        resourceIds: ["00000000-0000-4000-8000-000000000001"],
      }),
    ).toBeNull();
    expect(() => founderCountryAnswer("EU")).toThrow();
    expect(countryOfIso("DK")?.nodeId).toBeDefined();
  });

  it("is committed exactly as rendered, publishing v8 for new sessions", () => {
    const rendered = renderOnboardingDefinitionMigration(
      FOUNDER_DEFINITION_V8,
      { packet: "OWNER-ONE-COUNTRY-SOURCE" },
    );
    expect(readFileSync(MIGRATION, "utf8").endsWith(rendered)).toBe(true);
    expect(rendered).toContain("set current_version = 8");
  });

  it("proposes a reading's country as its geography node, and two countries as none", () => {
    expect(structuredValueFor("country", "Copenhagen, Denmark")).toEqual(
      founderCountryAnswer("DK"),
    );
    expect(structuredValueFor("country", "Nigeria")).toEqual(
      founderCountryAnswer("NG"),
    );
    expect(structuredValueFor("country", "Kenya, Nigeria")).toBeNull();
    expect(structuredValueFor("country", "West Africa")).toBeNull();
  });
});
