import { describe, expect, it } from "vitest";

import { adviceOnCapitalQRecord, recordAudienceTool } from "../src/answer.js";

/**
 * Q intelligence step 4: what was asked is the reader's (TURN_READER v78
 * and earlier fields), never a word list over what they said. With no
 * reading (FAKE mode, a failed reading) each lane takes its neutral
 * default.
 */
describe("advice answered from Capital Q's record (S7) reads the reader's asksForWeb", () => {
  const advice = { turnKind: "QUESTION_TO_Q", questionKind: "ADVICE" } as const;

  it("advice without a web ask stays on the record, whatever the words say", () => {
    expect(
      adviceOnCapitalQRecord(advice, "What are the main risks? Check the news."),
    ).toBe(true);
  });

  it("the reader's asksForWeb researches, in any words", () => {
    expect(
      adviceOnCapitalQRecord(
        { ...advice, asksForWeb: true },
        "Qu'en dit la presse ?",
      ),
    ).toBe(false);
  });

  it("a web address still researches; a non-advice turn is never held back", () => {
    expect(
      adviceOnCapitalQRecord(advice, "What does ledgerfold.com say about it?"),
    ).toBe(false);
    expect(
      adviceOnCapitalQRecord(
        { turnKind: "QUESTION_TO_Q", questionKind: "PUBLIC_FACTS" },
        "Who are they?",
      ),
    ).toBe(false);
  });
});

describe("a record's audience is the reader's askedAction", () => {
  it("only a record-audience action the reader named", () => {
    expect(recordAudienceTool("set_deck_audience")).toBe("set_deck_audience");
    expect(recordAudienceTool("set_pitch_sharing")).toBe("set_pitch_sharing");
    expect(recordAudienceTool("set_visibility")).toBeNull();
    expect(recordAudienceTool(null)).toBeNull();
    expect(recordAudienceTool(undefined)).toBeNull();
  });
});
