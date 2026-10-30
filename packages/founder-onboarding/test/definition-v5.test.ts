import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { validateOnboardingManifest } from "@capital-q/onboarding";

import {
  COUNTRY_OPTIONS,
  FOUNDER_DEFINITION_CURRENT,
  FOUNDER_DEFINITION_V4,
  FOUNDER_DEFINITION_V5,
  FOUNDER_STEPS,
  FOUNDER_UTTERANCE_ALIASES,
  GCC_COUNTRY_OPTIONS,
  renderOnboardingDefinitionMigration,
} from "../src/index.js";

/** Founder v5: v4 with the Gulf on the country list. */
const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261227110000_founder_onboarding_definition_v5.sql",
    import.meta.url,
  ),
);

const countryOptions = (definition: typeof FOUNDER_DEFINITION_V5) => {
  const step = definition.steps.find(
    (s) => s.stepKey === FOUNDER_STEPS.country,
  );
  return step?.configuration.stepType === "single_select"
    ? step.configuration.options.map((o) => o.optionKey)
    : [];
};

describe("founder definition v5", () => {
  it("is valid, and superseded only by v6", () => {
    expect(() =>
      validateOnboardingManifest(FOUNDER_DEFINITION_V5),
    ).not.toThrow();
    expect(FOUNDER_DEFINITION_CURRENT.version).toBe(8);
  });

  it("adds Qatar and the other missing GCC countries before 'somewhere else'", () => {
    const keys = countryOptions(FOUNDER_DEFINITION_V5);
    for (const code of ["qa", "sa", "kw", "bh", "om", "ae"])
      expect(keys).toContain(code);
    expect(keys.at(-1)).toBe("other");
    expect(new Set(keys).size).toBe(keys.length);
    for (const o of GCC_COUNTRY_OPTIONS)
      expect(o.optionKey).toMatch(/^[a-z]{2}$/u);
  });

  it("changes nothing else: same steps, order, branches and mappings as v4", () => {
    const strip = (d: typeof FOUNDER_DEFINITION_V4) =>
      d.steps.map((s) =>
        s.stepKey === FOUNDER_STEPS.country
          ? { ...s, configuration: { ...s.configuration, options: [] } }
          : s,
      );
    expect(strip(FOUNDER_DEFINITION_V5)).toEqual(strip(FOUNDER_DEFINITION_V4));
    // v1-v4 stay as published.
    expect(countryOptions(FOUNDER_DEFINITION_V4)).toEqual(
      COUNTRY_OPTIONS.map((o) => o.optionKey),
    );
  });

  it("knows the new countries in the alias table", () => {
    const aliases = FOUNDER_UTTERANCE_ALIASES[FOUNDER_STEPS.country] ?? {};
    expect(aliases["qa"]).toContain("doha");
    for (const code of ["sa", "kw", "bh", "om"])
      expect(aliases[code]?.length).toBeGreaterThan(0);
  });

  it("is committed exactly as rendered, publishing v5 for new sessions", () => {
    const rendered = renderOnboardingDefinitionMigration(
      FOUNDER_DEFINITION_V5,
      {
        packet: "D-GULF-COUNTRIES",
      },
    );
    expect(readFileSync(MIGRATION, "utf8").endsWith(rendered)).toBe(true);
    expect(rendered).toContain("set current_version = 5");
  });
});
