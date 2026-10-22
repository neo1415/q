import { describe, expect, it } from "vitest";

import { CompanyAnalystV26ResultSchema } from "@capital-q/q-core";

import {
  EXTRAS_ELSEWHERE_NOTE,
  EXTRAS_ONLY_NOTE,
  extrasMessages,
  joinExtras,
  statedNumbers,
} from "../src/q/parallel-extras.js";

const answer = (fields: Record<string, unknown> = {}) =>
  CompanyAnalystV26ResultSchema.parse({
    answer: "Northwind's revenue is $1.2M.",
    responseShape: "CONCISE",
    insufficientEvidence: false,
    recommendation: null,
    ...fields,
  });
const finding = (statement: string) => ({
  type: "FACT" as const,
  statement,
  truthClass: "USER_CLAIM" as const,
  evidenceStatus: "SELF_REPORTED" as const,
  confidence: "MODERATE" as const,
  basis: [],
});
const cards = {
  shape: "SIDE_BY_SIDE" as const,
  title: "Two companies",
  cards: [
    {
      name: "Northwind",
      line: null,
      reasons: ["Seed stage."],
      measures: [],
      view: null,
      said: null,
      citations: [],
    },
  ],
  followUps: [],
};

describe("parallel extras: the pair checks", () => {
  it("reads numbers in the forms a source holds them", () => {
    expect(statedNumbers("Revenue $1.2M, up 45%, 1,200 staff")).toEqual([
      ["1.2", "1200000"],
      ["45"],
      ["1200"],
    ]);
    // A lone digit says nothing checkable.
    expect(statedNumbers("one of 3 companies")).toEqual([]);
  });

  it("swaps the note: the extras' writer never reads the answer's", () => {
    const base = [{ role: "USER" as const, content: "Tell me." }];
    expect(extrasMessages([...base, EXTRAS_ELSEWHERE_NOTE])).toEqual([
      ...base,
      EXTRAS_ONLY_NOTE,
    ]);
  });

  it("joins findings and cards grounded in what both writers read", () => {
    const joined = joinExtras(
      answer(),
      {
        findings: [
          finding("Revenue is 1,200,000 dollars."),
          finding("Revenue is $1.2 million."),
          finding("Burn is $90k a month."),
          finding("Founded by two engineers."),
        ],
        answerCards: cards,
        comparisonCards: null,
      },
      [
        {
          role: "TOOL",
          callId: "c",
          name: "get_company",
          content: '{"burn":90000}',
        },
      ],
    );
    expect(joined.join).toBe("JOINED");
    expect(joined.value.findings.map((f) => f.statement)).toEqual([
      "Revenue is 1,200,000 dollars.",
      "Revenue is $1.2 million.",
      "Burn is $90k a month.",
      "Founded by two engineers.",
    ]);
    expect(joined.value.answerCards?.title).toBe("Two companies");
    expect(joined.value.answer).toBe("Northwind's revenue is $1.2M.");
  });

  it("never mixes two writers' sets: the answer's own findings or cards stay", () => {
    const own = answer({ findings: [finding("Own.")] });
    const joined = joinExtras(
      own,
      {
        findings: [finding("Other.")],
        answerCards: cards,
        comparisonCards: null,
      },
      [],
    );
    expect(joined.join).toBe("ANSWER_OWN");
    expect(joined.value).toBe(own);
  });

  it("an answer that declined keeps nothing; no extras is no change", () => {
    const declined = answer({ declined: true });
    expect(
      joinExtras(
        declined,
        {
          findings: [finding("x y")],
          answerCards: null,
          comparisonCards: null,
        },
        [],
      ).join,
    ).toBe("ANSWER_UNCOMMITTED");
    expect(joinExtras(answer(), null, []).join).toBe("NO_EXTRAS");
  });

  it("counts the findings left out for an ungrounded number", () => {
    const joined = joinExtras(
      answer(),
      {
        findings: [finding("Revenue is $7.3M."), finding("Revenue is $1.2M.")],
        answerCards: null,
        comparisonCards: null,
      },
      [],
    );
    expect(joined.ungrounded).toBe(1);
    expect(joined.value.findings.map((f) => f.statement)).toEqual([
      "Revenue is $1.2M.",
    ]);
  });
});
