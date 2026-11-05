import { describe, expect, it } from "vitest";

import {
  createDefaultPromptRegistry,
  TURN_READER_V76,
  TURN_READER_V77,
  TurnReaderV75ResultSchema,
  TurnReaderV77ResultSchema,
  V76_CONVERSATION_STATE,
  V77_REFERENCES,
} from "../src/index.js";

/**
 * Q intelligence step 3: the reader says what the turn's pointing words
 * mean, as LEDGER refs, by meaning. v76 kept whole plus one REFERENCES rule;
 * code (q-specialists reference-binding) checks and binds.
 */
describe("TURN_READER v77", () => {
  const base = {
    kind: "QUESTION_TO_Q",
    transcript: "CLEAR",
    confidence: "HIGH",
  };

  it("is the active reader: v76 kept whole plus one REFERENCES rule", () => {
    const active =
      createDefaultPromptRegistry().getActive("TURN_READER").definition;
    expect(active.version).toBe(77);
    expect(active.output.kind === "STRUCTURED" && active.output.schema).toBe(
      TurnReaderV77ResultSchema,
    );
    expect(
      TURN_READER_V77.template.replace(
        `${V76_CONVERSATION_STATE}${V77_REFERENCES}`,
        V76_CONVERSATION_STATE,
      ),
    ).toBe(TURN_READER_V76.template);
    expect(TURN_READER_V77.variables.untrusted).toContain("conversationState");
    // The rule covers people, documents, places and sets, and two readings.
    for (const said of [
      "their CFO",
      "the other deck",
      "those two",
      "the second one",
      "two entries with the same phrase",
      "never a name, a record id or a ref you made up",
    ]) {
      expect(V77_REFERENCES).toContain(said);
    }
  });

  it("reads references as E refs with a word for confidence, none by default", () => {
    const read = TurnReaderV77ResultSchema.parse({
      ...TurnReaderV75ResultSchema.parse(base),
      references: [
        { phrase: "she", entityIds: ["E2"], confidence: "HIGH" },
        { phrase: "those two", entityIds: ["E1", "E3"] },
      ],
    });
    expect(read.references).toEqual([
      { phrase: "she", entityIds: ["E2"], confidence: "HIGH" },
      { phrase: "those two", entityIds: ["E1", "E3"], confidence: "MEDIUM" },
    ]);
    expect(
      TurnReaderV77ResultSchema.parse(TurnReaderV75ResultSchema.parse(base))
        .references,
    ).toEqual([]);
  });

  it("drops malformed references, never the reading: a record id or a percentage is no ref", () => {
    for (const references of [
      [{ phrase: "her", entityIds: ["0b8c5f1e-uuid"] }],
      [{ phrase: "her", entityIds: ["E2"], confidence: 0.9 }],
      "E2",
    ]) {
      const read = TurnReaderV77ResultSchema.parse({
        ...TurnReaderV75ResultSchema.parse(base),
        references,
      });
      expect(read.references).toEqual([]);
      expect(read.kind).toBe("QUESTION_TO_Q");
    }
  });
});
