import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V8,
  TurnReaderV8ResultSchema,
} from "../src/index.js";

/**
 * TURN_READER v8 (founder live test 2026-09-27 #5): a screen Capital Q
 * does not have is NAVIGATE with destination null and unknownScreen, so
 * code says it doesn't exist and offers the nearest; never a silent move.
 */
const base = {
  kind: "TOOL_REQUEST",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: null,
  aboutNamedOther: false,
} as const;

describe("TURN_READER v8", () => {
  it("states the unknown-screen rule once, and the active reader (v13) keeps it", () => {
    const registry = createDefaultPromptRegistry();
    const active = registry.getActive("TURN_READER").definition;
    expect(active.version).toBe(25);
    for (const template of [TURN_READER_V8.template, active.template]) {
      expect(template.split("unknownScreen is set").length - 1).toBe(1);
      expect(template).toContain(
        "Never choose a destination for a screen that does not exist.",
      );
    }
  });

  it("NAVIGATE carries a destination or an unknown screen, never both, never neither", () => {
    const tool = (extra: Record<string, unknown>) =>
      TurnReaderV8ResultSchema.safeParse({
        ...base,
        tool: { kind: "NAVIGATE", ...extra },
      }).success;
    expect(tool({ destination: "DISCOVER" })).toBe(true);
    expect(
      tool({ unknownScreen: { named: "queue", nearest: "DISCOVER" } }),
    ).toBe(true);
    expect(
      tool({
        destination: "HOME",
        unknownScreen: { named: "queue", nearest: "DISCOVER" },
      }),
    ).toBe(false);
    expect(tool({})).toBe(false);
    // The nearest is a real destination, never free text.
    expect(tool({ unknownScreen: { named: "queue", nearest: "QUEUE" } })).toBe(
      false,
    );
  });

  it("no other tool carries an unknown screen", () => {
    expect(
      TurnReaderV8ResultSchema.safeParse({
        ...base,
        tool: {
          kind: "SET_VISIBILITY",
          visibility: "network_visible",
          unknownScreen: { named: "queue", nearest: "HOME" },
        },
      }).success,
    ).toBe(false);
  });
});
