import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  FOUNDER_DEFINITION_CURRENT,
  FOUNDER_DEFINITION_V2,
  FOUNDER_DEFINITION_V3,
  FOUNDER_UTTERANCE_ALIASES,
  renderOnboardingDefinitionMigration,
} from "../src/index.js";

/**
 * Founder v3 (harden spec §3): v2 plus the early signals founders actually
 * have. A strict superset, so a v2 session reads correctly through it.
 */
const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261110010000_founder_onboarding_definition_v3.sql",
    import.meta.url,
  ),
);

const signalOptions = (definition: typeof FOUNDER_DEFINITION_V3) => {
  const step = definition.steps.find((s) => s.stepKey === "F5.signal");
  return step?.configuration.stepType === "single_select"
    ? step.configuration.options.map((o) => o.optionKey)
    : [];
};

describe("founder definition v3", () => {
  it("adds paying customers and partnerships to the early signal, keeping 'nothing' last", () => {
    expect(signalOptions(FOUNDER_DEFINITION_V3)).toEqual([
      "pilots",
      "lois",
      "waitlist",
      "users",
      "paying",
      "partnerships",
      "none",
    ]);
  });

  it("changes nothing else: every other step is v2's, in v2's order", () => {
    expect(FOUNDER_DEFINITION_V3.version).toBe(3);
    expect(FOUNDER_DEFINITION_V3.steps.map((s) => s.stepKey)).toEqual(
      FOUNDER_DEFINITION_V2.steps.map((s) => s.stepKey),
    );
    for (const [index, step] of FOUNDER_DEFINITION_V3.steps.entries()) {
      if (step.stepKey === "F5.signal") continue;
      expect(step).toEqual(FOUNDER_DEFINITION_V2.steps[index]);
    }
    for (const key of signalOptions(FOUNDER_DEFINITION_V2)) {
      expect(signalOptions(FOUNDER_DEFINITION_V3)).toContain(key);
    }
  });

  it("is superseded by v4 for new sessions, which keeps every v3 step", () => {
    const current = FOUNDER_DEFINITION_CURRENT.steps.map((s) => s.stepKey);
    for (const step of FOUNDER_DEFINITION_V3.steps) {
      expect(current).toContain(step.stepKey);
    }
    expect(FOUNDER_DEFINITION_CURRENT.version).toBe(4);
  });

  it("is committed exactly as rendered, publishing v3 for new sessions", () => {
    const rendered = renderOnboardingDefinitionMigration(
      FOUNDER_DEFINITION_V3,
      { packet: "HARDEN" },
    );
    const committed = readFileSync(MIGRATION, "utf8");
    expect(committed.endsWith(rendered)).toBe(true);
    expect(rendered).toContain("set current_version = 3");
  });

  it("knows the new options in the alias table", () => {
    const aliases = FOUNDER_UTTERANCE_ALIASES["F5.signal"] ?? {};
    expect(Object.keys(aliases)).toEqual(
      expect.arrayContaining(["paying", "partnerships"]),
    );
  });
});
