import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  computeActivePath,
  definitelyOffPath,
  validateOnboardingManifest,
  type OnboardingResponse,
  type OnboardingStepDefinition,
} from "@capital-q/onboarding";

import {
  FOUNDER_DEFINITION_CURRENT,
  FOUNDER_DEFINITION_V6,
  FOUNDER_DEFINITION_V7,
  FOUNDER_STEPS,
  renderOnboardingDefinitionMigration,
} from "../src/index.js";

/**
 * Founder v7 (live 25 Oct e2e, owner-approved): a seed company whose signal
 * is paying customers is asked how many, so a deck's "210 customers" can
 * settle on the step instead of a note.
 */
const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261231130000_founder_onboarding_definition_v7.sql",
    import.meta.url,
  ),
);

const steps =
  FOUNDER_DEFINITION_V7.steps as unknown as OnboardingStepDefinition[];
const customers = steps.find((s) => s.stepKey === FOUNDER_STEPS.customers);

function answered(values: Record<string, string>) {
  return new Map(
    Object.entries(values).map(([stepKey, optionKey]) => [
      stepKey,
      {
        stepKey,
        value: { type: "SINGLE_SELECT", optionKey },
      } as unknown as OnboardingResponse,
    ]),
  );
}

describe("founder definition v7", () => {
  it("is valid and current", () => {
    expect(() =>
      validateOnboardingManifest(FOUNDER_DEFINITION_V7),
    ).not.toThrow();
    expect(FOUNDER_DEFINITION_CURRENT.version).toBe(8);
  });

  it("changes only when paying customers is asked; every other v6 step is the same", () => {
    expect(FOUNDER_DEFINITION_V7.steps.map((s) => s.stepKey)).toEqual(
      FOUNDER_DEFINITION_V6.steps.map((s) => s.stepKey),
    );
    for (const step of FOUNDER_DEFINITION_V6.steps) {
      if (step.stepKey === FOUNDER_STEPS.customers) continue;
      expect(
        FOUNDER_DEFINITION_V7.steps.find((s) => s.stepKey === step.stepKey),
        step.stepKey,
      ).toEqual(step);
    }
  });

  it("asks paying customers of a seed company whose signal is paying customers, and from Series A", () => {
    if (customers === undefined) throw new Error("no customers step");
    const on = (values: Record<string, string>) =>
      computeActivePath(steps, answered(values)).eligibleKeys.has(
        customers.stepKey,
      );
    expect(
      on({ [FOUNDER_STEPS.stage]: "seed", [FOUNDER_STEPS.signal]: "paying" }),
    ).toBe(true);
    expect(on({ [FOUNDER_STEPS.stage]: "series_a" })).toBe(true);
    expect(
      on({ [FOUNDER_STEPS.stage]: "seed", [FOUNDER_STEPS.signal]: "pilots" }),
    ).toBe(false);
    // Still undecided until the signal is answered: an offer can wait for it.
    expect(on({ [FOUNDER_STEPS.stage]: "seed" })).toBe(false);
  });

  it("knows when the step is ruled out for good, and when it still waits on an answer", () => {
    if (customers === undefined) throw new Error("no customers step");
    const off = (values: Record<string, string>) =>
      definitelyOffPath(customers, computeActivePath(steps, answered(values)));
    expect(
      off({ [FOUNDER_STEPS.stage]: "seed", [FOUNDER_STEPS.signal]: "pilots" }),
    ).toBe(true);
    expect(off({ [FOUNDER_STEPS.stage]: "seed" })).toBe(false);
    expect(
      off({ [FOUNDER_STEPS.stage]: "seed", [FOUNDER_STEPS.signal]: "paying" }),
    ).toBe(false);
    expect(off({})).toBe(false);
  });

  it("is committed exactly as rendered, publishing v7 for new sessions", () => {
    const rendered = renderOnboardingDefinitionMigration(
      FOUNDER_DEFINITION_V7,
      {
        packet: "E2E-SEED-PAYING-CUSTOMERS",
      },
    );
    expect(readFileSync(MIGRATION, "utf8").endsWith(rendered)).toBe(true);
    expect(rendered).toContain("set current_version = 7");
  });
});
