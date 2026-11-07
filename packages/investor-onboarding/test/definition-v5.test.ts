import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  evaluateBranch,
  NONE_ANSWER_TEXT,
  renderOnboardingDefinitionMigration,
  validateOnboardingManifest,
} from "@capital-q/onboarding";

import {
  INVESTOR_DEFINITION_CURRENT,
  INVESTOR_DEFINITION_V4,
  INVESTOR_DEFINITION_V5,
  INVESTOR_NONE_STEPS,
  INVESTOR_PUBLIC_DESCRIPTION_STEP,
  INVESTOR_PUBLIC_DESCRIPTION_WRITE_TARGET,
  INVESTOR_STEPS,
} from "../src/index.js";

/**
 * Investor v5 (DECISIONS 79, batch 7): every field the profile shows is
 * mandatory, "None" answers each preference list, and the firm describes
 * itself.
 */
const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261231470000_investor_onboarding_definition_v5.sql",
    import.meta.url,
  ),
);

const stepOf = (key: string) =>
  INVESTOR_DEFINITION_V5.steps.find((s) => s.stepKey === key);

describe("Investor Definition v5", () => {
  it("is valid and current", () => {
    expect(() =>
      validateOnboardingManifest(INVESTOR_DEFINITION_V5),
    ).not.toThrow();
    expect(INVESTOR_DEFINITION_CURRENT).toBe(INVESTOR_DEFINITION_V5);
  });

  it("asks the firm's description just before the thesis, mandatory", () => {
    const keys = INVESTOR_DEFINITION_V5.steps.map((s) => s.stepKey);
    expect(keys.indexOf(INVESTOR_PUBLIC_DESCRIPTION_STEP)).toBe(
      keys.indexOf(INVESTOR_STEPS.additionalContext) - 1,
    );
    expect(stepOf(INVESTOR_PUBLIC_DESCRIPTION_STEP)).toMatchObject({
      required: true,
      configuration: { stepType: "long_text" },
      writesTo: [{ targetKey: INVESTOR_PUBLIC_DESCRIPTION_WRITE_TARGET }],
    });
  });

  it("makes every step the profile shows mandatory; only the discovery style and the closing screens stay as they were", () => {
    const optional = INVESTOR_DEFINITION_V5.steps
      .filter((s) => !s.required)
      .map((s) => s.stepKey);
    expect(optional).toEqual([INVESTOR_STEPS.discoveryMode]);
  });

  it('"None" answers each list, and no "how firm is that?" follows it', () => {
    for (const key of INVESTOR_NONE_STEPS) {
      expect(stepOf(key)?.required, key).toBe(true);
    }
    for (const [list, strength] of [
      [INVESTOR_STEPS.founderPreferences, INVESTOR_STEPS.founderStrength],
      [INVESTOR_STEPS.greenFlags, INVESTOR_STEPS.greenFlagStrength],
    ] as const) {
      const branch = stepOf(strength)?.branching;
      expect(branch, strength).toEqual({ op: "EXISTS", stepKey: list });
      if (branch === null || branch === undefined) continue;
      expect(
        evaluateBranch(
          branch,
          new Map([[list, { type: "TEXT", text: NONE_ANSWER_TEXT }]]),
        ),
      ).toBe(false);
    }
  });

  it("never calls a mandatory step optional", () => {
    for (const step of INVESTOR_DEFINITION_V5.steps) {
      if (!step.required) continue;
      expect(step.configuration.supportingText ?? "", step.stepKey).not.toMatch(
        /optional|leave (it )?empty/iu,
      );
    }
  });

  it("changes nothing else: every v4 step keeps its key, order, type, branch and target", () => {
    const v5 = INVESTOR_DEFINITION_V5.steps.filter(
      (s) => s.stepKey !== INVESTOR_PUBLIC_DESCRIPTION_STEP,
    );
    expect(v5.map((s) => s.stepKey)).toEqual(
      INVESTOR_DEFINITION_V4.steps.map((s) => s.stepKey),
    );
    INVESTOR_DEFINITION_V4.steps.forEach((before, index) => {
      const after = v5[index];
      expect(after?.branching).toEqual(before.branching);
      expect(after?.writesTo).toEqual(before.writesTo);
      expect(after?.configuration.stepType).toBe(before.configuration.stepType);
    });
  });

  it("is committed exactly as rendered, publishing v5 for new sessions", () => {
    const rendered = renderOnboardingDefinitionMigration(
      INVESTOR_DEFINITION_V5,
      {
        packet: "OWNER-PROFILE-FIELDS",
        source: "packages/investor-onboarding/src/definition",
      },
    );
    const committed = readFileSync(MIGRATION, "utf8");
    expect(committed.endsWith(rendered)).toBe(true);
    expect(rendered).toContain("set current_version = 5");
    expect(committed).not.toMatch(
      /^\s*(drop|alter|grant|revoke|create|delete|truncate)\b/imu,
    );
  });
});
