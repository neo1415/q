import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V84,
  TURN_READER_V85,
  TurnNavigationIntentV85Schema,
  TurnReaderV85ResultSchema,
  V84_NAVIGATION,
  V85_NAVIGATION_DESTINATION,
} from "../src/index.js";

/**
 * TURN_READER v85 (C10, live 13 Nov 2026 on 12baf142c): "Who should I
 * follow up with this week?" stayed on Work. The reading now names the
 * screen it means (navigation.destination) and working through the
 * pipeline is CONTEXT with destination CRM_PIPELINE.
 */
describe("TURN_READER v85", () => {
  it("is active: v84 with one NAVIGATION DESTINATION paragraph after NAVIGATION, on v85's schema", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(85);
    expect(registry.get("TURN_READER", 84)?.definition.status).toBe(
      "DEPRECATED",
    );
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV85ResultSchema,
    );
    expect(TURN_READER_V85.variables).toEqual(TURN_READER_V84.variables);
    expect(
      TURN_READER_V85.template.replace(`\n${V85_NAVIGATION_DESTINATION}`, ""),
    ).toBe(TURN_READER_V84.template);
    expect(TURN_READER_V85.template).toContain(
      `${V84_NAVIGATION}\n${V85_NAVIGATION_DESTINATION}`,
    );
  });

  it("names the pipeline cases as CONTEXT with destination CRM_PIPELINE, and leaves record pages null", () => {
    for (const said of [
      "with mode GO or CONTEXT",
      "also write navigation.destination",
      "leave it null for a particular record's page",
      '"who should I follow up with this week?"',
      '"which of my deals are stalled?"',
      '"where do my conversations stand?"',
      "is mode CONTEXT with destination CRM_PIPELINE",
    ]) {
      expect(V85_NAVIGATION_DESTINATION).toContain(said);
    }
  });

  it("parses a destination; an unknown one is none, never a lost intent", () => {
    expect(
      TurnNavigationIntentV85Schema.parse({
        mode: "CONTEXT",
        destination: "CRM_PIPELINE",
      }),
    ).toEqual({ mode: "CONTEXT", negated: false, destination: "CRM_PIPELINE" });
    expect(
      TurnNavigationIntentV85Schema.parse({
        mode: "CONTEXT",
        destination: "THE_MOON",
      }),
    ).toEqual({ mode: "CONTEXT", negated: false, destination: null });
    expect(TurnNavigationIntentV85Schema.parse({}).destination).toBeNull();
  });
});
