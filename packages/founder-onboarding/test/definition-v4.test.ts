import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  evaluateBranch,
  validateOnboardingManifest,
} from "@capital-q/onboarding";

import {
  FOUNDER_DEFINITION_CURRENT,
  FOUNDER_DEFINITION_V3,
  FOUNDER_DEFINITION_V4,
  FOUNDER_FINANCIAL_STEPS,
  FOUNDER_FINANCIAL_WRITE_TARGET,
  FOUNDER_REVISABLE_STEPS,
  FOUNDER_UTTERANCE_ALIASES,
  renderOnboardingDefinitionMigration,
} from "../src/index.js";

/**
 * Founder v4 (Q.01): v3 plus an adaptive, optional financials block. A
 * strict superset, so a v3 session reads correctly through it.
 */
const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261218100000_founder_onboarding_definition_v4.sql",
    import.meta.url,
  ),
);

const FINANCIAL = Object.values(FOUNDER_FINANCIAL_STEPS);
const step = (key: string) =>
  FOUNDER_DEFINITION_V4.steps.find((s) => s.stepKey === key);

describe("founder definition v4", () => {
  it("is valid, and current", () => {
    expect(() =>
      validateOnboardingManifest(FOUNDER_DEFINITION_V4),
    ).not.toThrow();
    expect(FOUNDER_DEFINITION_V4.version).toBe(4);
    expect(FOUNDER_DEFINITION_CURRENT).toBe(FOUNDER_DEFINITION_V4);
  });

  it("keeps every v3 step unchanged and in v3's relative order", () => {
    const v3Keys = FOUNDER_DEFINITION_V3.steps.map((s) => s.stepKey);
    const v4Keys = FOUNDER_DEFINITION_V4.steps
      .map((s) => s.stepKey)
      .filter((key) => !FINANCIAL.includes(key as never));
    expect(v4Keys).toEqual(v3Keys);
    for (const original of FOUNDER_DEFINITION_V3.steps) {
      const { sequenceOrder: _a, ...was } = original;
      const now = step(original.stepKey);
      expect(now).toBeDefined();
      const { sequenceOrder: _b, ...is } = now ?? original;
      expect(is).toEqual(was);
    }
  });

  it("asks the financials after growth and the cheque after use of funds, each optional", () => {
    const keys = FOUNDER_DEFINITION_V4.steps.map((s) => s.stepKey);
    expect(keys.indexOf("F5.fin_currency")).toBe(keys.indexOf("F5.growth") + 1);
    expect(keys.indexOf("F6.min_cheque")).toBe(
      keys.indexOf("F6.use_of_funds") + 1,
    );
    for (const key of FINANCIAL) {
      expect(step(key)?.required).toBe(false);
      expect(FOUNDER_REVISABLE_STEPS.has(key)).toBe(true);
    }
    // Sequence orders are dense and unique.
    expect(FOUNDER_DEFINITION_V4.steps.map((s) => s.sequenceOrder)).toEqual(
      FOUNDER_DEFINITION_V4.steps.map((_, index) => index),
    );
  });

  it("writes every figure through the financial claims target (not the currency pick)", () => {
    for (const key of FINANCIAL) {
      const targets = step(key)?.writesTo.map((w) => w.targetKey) ?? [];
      expect(targets).toEqual(
        key === FOUNDER_FINANCIAL_STEPS.currency
          ? []
          : [FOUNDER_FINANCIAL_WRITE_TARGET],
      );
    }
  });

  it("never asks a pre-revenue company about revenue or margin", () => {
    const branch = step(FOUNDER_FINANCIAL_STEPS.monthlyRevenue)?.branching;
    expect(branch).toBeTruthy();
    const answers = (entries: Record<string, unknown>) =>
      new Map(Object.entries(entries)) as never;
    const preRevenue = answers({
      "F1.stage": { type: "SINGLE_SELECT", optionKey: "seed" },
      "F5.signal": { type: "SINGLE_SELECT", optionKey: "waitlist" },
    });
    const paying = answers({
      "F1.stage": { type: "SINGLE_SELECT", optionKey: "seed" },
      "F5.signal": { type: "SINGLE_SELECT", optionKey: "paying" },
    });
    const seriesA = answers({
      "F1.stage": { type: "SINGLE_SELECT", optionKey: "series_a" },
      "F5.revenue_status": { type: "SINGLE_SELECT", optionKey: "recurring" },
    });
    if (branch === null || branch === undefined) throw new Error("no branch");
    expect(evaluateBranch(branch, preRevenue)).toBe(false);
    expect(evaluateBranch(branch, paying)).toBe(true);
    expect(evaluateBranch(branch, seriesA)).toBe(true);
    // Burn, cash and runway are asked of everyone.
    expect(step(FOUNDER_FINANCIAL_STEPS.cash)?.branching).toBeNull();
  });

  it("knows the new options in the alias table (voice and text)", () => {
    expect(
      Object.keys(FOUNDER_UTTERANCE_ALIASES["F5.revenue_trend"] ?? {}),
    ).toEqual(["growing", "flat", "declining", "lumpy"]);
    expect(
      Object.keys(FOUNDER_UTTERANCE_ALIASES["F5.fin_currency"] ?? {}),
    ).toContain("ngn");
  });

  it("is committed exactly as rendered, publishing v4 for new sessions", () => {
    const rendered = renderOnboardingDefinitionMigration(
      FOUNDER_DEFINITION_V4,
      { packet: "Q01-FINANCIALS" },
    );
    const committed = readFileSync(MIGRATION, "utf8");
    expect(committed.endsWith(rendered)).toBe(true);
    expect(rendered).toContain("set current_version = 4");
  });
});
