import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  TURN_READER_V12,
  TURN_READER_V13,
  TurnReaderV11ResultSchema,
} from "../src/index.js";

/**
 * TURN_READER v13 (R33): every destination the contracts name is one the
 * reader can choose, so "open my settings" navigates instead of falling to
 * an unknown screen. v12's rules stay.
 */
describe("TURN_READER v13", () => {
  it("extends v12, which is deprecated", () => {
    expect(TURN_READER_V12.status).toBe("DEPRECATED");
    expect(TURN_READER_V13.template.length).toBeGreaterThan(
      TURN_READER_V12.template.length,
    );
    expect(TURN_READER_V13.template).toContain("SEQUENCE (null unless");
    expect(TURN_READER_V13.template).toContain("unknownScreen is set");
  });

  it("names every contract destination exactly once", () => {
    // The screens v17 added are named from v17 on.
    const V17_SCREENS: readonly string[] = [
      "INVESTORS",
      "SEARCH",
      "GATEWAY",
      "MEMORY",
      "NEW_PITCH",
      // Named from v19 on (REHEARSE).
      "REHEARSALS",
      // DOCUMENTS arrived with v20.
      "DOCUMENTS",
      // DAILY arrived with v21.
      "DAILY",
      // RESULTS arrives with v24.
      "RESULTS",
    ];
    for (const destination of Q_NAVIGATE_DESTINATIONS.filter(
      (entry) => !V17_SCREENS.includes(entry),
    )) {
      expect(
        TURN_READER_V13.template.split(`${destination} (`).length - 1,
        destination,
      ).toBe(1);
    }
  });

  it.each(["SETTINGS", "VERIFICATION", "PITCH", "COMPANY_INTEREST"] as const)(
    "accepts NAVIGATE %s",
    (destination) => {
      expect(
        TurnReaderV11ResultSchema.safeParse({
          kind: "TOOL_REQUEST",
          confidence: "HIGH",
          transcript: "CLEAR",
          question: null,
          aboutNamedOther: false,
          tool: { kind: "NAVIGATE", destination },
          sequence: null,
        }).success,
      ).toBe(true);
    },
  );
});
