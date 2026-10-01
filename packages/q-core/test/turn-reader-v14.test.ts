import { describe, expect, it } from "vitest";

import { Q_NAVIGATE_DESTINATIONS } from "@capital-q/contracts";

import {
  createDefaultPromptRegistry,
  TURN_DOCUMENT_TYPES_V14,
  TURN_READER_V13,
  TURN_READER_V14,
  TurnReaderV14ResultSchema,
} from "../src/index.js";

/**
 * TURN_READER v14 (founder live 2026-09-28 #1): any answer can be a
 * document. v13's rules and destinations stay.
 */
describe("TURN_READER v14", () => {
  it("is the active reader and v13 is deprecated", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("TURN_READER").definition.version).toBe(22);
    expect(TURN_READER_V13.status).toBe("DEPRECATED");
    expect(TURN_READER_V14.template).toContain("SEQUENCE (null unless");
    expect(TURN_READER_V14.template).toContain("unknownScreen is set");
  });

  it("names every document type it can return, each once", () => {
    for (const type of TURN_DOCUMENT_TYPES_V14) {
      expect(TURN_READER_V14.template.split(`${type} (`).length - 1, type).toBe(
        1,
      );
    }
    expect(TURN_READER_V14.template).toContain(
      "For OWN_MANDATE, ANSWER_EXPORT and Q_REPORT, null.",
    );
  });

  it("still names every contract destination exactly once", () => {
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
    ];
    for (const destination of Q_NAVIGATE_DESTINATIONS.filter(
      (entry) => !V17_SCREENS.includes(entry),
    )) {
      expect(
        TURN_READER_V14.template.split(`${destination} (`).length - 1,
        destination,
      ).toBe(1);
    }
  });

  const reading = (tool: unknown, moreDocuments: unknown[] = []) =>
    TurnReaderV14ResultSchema.safeParse({
      kind: "TOOL_REQUEST",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
      tool,
      moreDocuments,
      sequence: null,
    });

  it.each(["ANSWER_EXPORT", "Q_REPORT"] as const)(
    "accepts PREPARE_DOCUMENT %s, alone or with another document",
    (documentType) => {
      const tool = { kind: "PREPARE_DOCUMENT", documentType };
      expect(reading(tool).success).toBe(true);
      expect(
        reading({ kind: "PREPARE_DOCUMENT", documentType: "OWN_MANDATE" }, [
          tool,
        ]).success,
      ).toBe(true);
    },
  );

  it("still refuses a document type nobody defined and a tool with another's parameters", () => {
    expect(
      reading({ kind: "PREPARE_DOCUMENT", documentType: "ANYTHING" }).success,
    ).toBe(false);
    expect(
      reading({
        kind: "PREPARE_DOCUMENT",
        documentType: "Q_REPORT",
        destination: "HOME",
      }).success,
    ).toBe(false);
  });
});
