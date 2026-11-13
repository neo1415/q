import { describe, expect, it } from "vitest";

import {
  CHART_METRIC_LABELS,
  CHART_METRICS,
  createDefaultPromptRegistry,
  TURN_READER_V81,
  TURN_READER_V82,
  TurnChartIntentSchema,
  TurnReaderV82ResultSchema,
  TurnReaderV85ResultSchema,
  V82_CHART_ASK,
  V82_CHART_ASK_FROM,
} from "../src/index.js";

/**
 * TURN_READER v82 (A8, owner directive 13 Nov 2026): the chart ask is read
 * by meaning in the reader's one pass, as a typed intent -- never chosen by
 * code from capitalised words or a regex ranking with revenue first.
 */
describe("TURN_READER v82", () => {
  it("v81 with the asksForChart sentence replaced (v83 is active, on its schema)", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(85);
    expect(registry.get("TURN_READER", 81)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV85ResultSchema,
    );
    expect(TURN_READER_V82.variables).toEqual(TURN_READER_V81.variables);
    expect(TURN_READER_V81.template).toContain(V82_CHART_ASK_FROM);
    expect(TURN_READER_V82.template).not.toContain(V82_CHART_ASK_FROM);
    expect(
      TURN_READER_V82.template.replace(V82_CHART_ASK, V82_CHART_ASK_FROM),
    ).toBe(TURN_READER_V81.template);
  });

  it("reads the chart by meaning, names as said, and lists every canonical metric", () => {
    for (const said of [
      "however said and in any language, with or without those words",
      "written exactly as they referred to it (never completed, corrected or guessed",
      '"Open Field Analytics" or "Grow Bank"',
      "UNSPECIFIED when they did not say which figure",
      "never pick one for them",
      'never turn "the last few months" into dates',
      '"now do the same for Clinicrest"',
      "chart.wanted is true and asksForChart is true",
    ]) {
      expect(V82_CHART_ASK).toContain(said);
    }
    for (const metric of CHART_METRICS) {
      expect(V82_CHART_ASK).toContain(
        `${metric} (${CHART_METRIC_LABELS[metric]})`,
      );
    }
  });

  it("parses a full chart intent", () => {
    const parsed = TurnReaderV82ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      transcript: "CLEAR",
      confidence: "HIGH",
      asksForChart: true,
      chart: {
        wanted: true,
        companies: ["Ledgerline"],
        metric: "MRR",
        period: { from: "2026-06", to: null },
        sameAsBefore: false,
      },
    });
    expect(parsed.chart).toEqual({
      wanted: true,
      companies: ["Ledgerline"],
      metric: "MRR",
      period: { from: "2026-06", to: null },
      sameAsBefore: false,
    });
  });

  it("defaults safely: absent is null, and each malformed part costs only itself", () => {
    const base = {
      kind: "QUESTION_TO_Q",
      transcript: "CLEAR",
      confidence: "HIGH",
    };
    expect(TurnReaderV82ResultSchema.parse(base).chart).toBeNull();
    expect(TurnChartIntentSchema.parse({})).toEqual({
      wanted: false,
      companies: [],
      metric: "UNSPECIFIED",
      period: null,
      sameAsBefore: false,
    });
    const odd = TurnChartIntentSchema.parse({
      wanted: "yes",
      companies: ["A", "B", "C", "D", "E"],
      metric: "REVENUE_FIRST",
      period: { from: "June", to: "2026-13" },
      sameAsBefore: 1,
    });
    expect(odd).toEqual({
      wanted: false,
      companies: [],
      metric: "UNSPECIFIED",
      period: { from: null, to: null },
      sameAsBefore: false,
    });
    // A malformed chart never costs the reading.
    expect(
      TurnReaderV82ResultSchema.parse({ ...base, chart: "a chart please" })
        .chart,
    ).toBeNull();
  });
});
