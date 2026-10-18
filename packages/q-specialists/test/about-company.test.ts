import { describe, expect, it } from "vitest";

import { readsAsAboutSubjectCompany } from "../src/company/about-company.js";
import { createCompanyIntelligenceSpecialist } from "../src/company/specialist.js";

/**
 * Which questions the company specialist may take: decided from Q's turn
 * reader (a model reading, ADR 0011/0016), never from patterns over the
 * person's words.
 */
const reading = (
  kind: string,
  questionKind: string | null = null,
  aboutNamedOther = false,
) => ({ kind, questionKind, aboutNamedOther });

describe("whether a question is about the company in the conversation", () => {
  it("takes a request for Q's judgement about the subject", () => {
    expect(readsAsAboutSubjectCompany(reading("QUESTION_TO_Q", "ADVICE"))).toBe(
      true,
    );
    expect(readsAsAboutSubjectCompany(reading("CORRECTION"))).toBe(true);
  });

  it("sends small talk, requests, other subjects and the outside world elsewhere", () => {
    for (const read of [
      reading("SMALL_TALK"),
      reading("OFF_TOPIC"),
      reading("TOOL_REQUEST"),
      reading("RESEARCH_REQUEST", "PUBLIC_FACTS"),
      reading("QUESTION_TO_Q", "PUBLIC_FACTS"),
      reading("QUESTION_TO_Q", "REAL_WORLD_EXAMPLE"),
      reading("QUESTION_TO_Q", "ABOUT_CAPITAL_Q"),
      reading("QUESTION_TO_Q", "ADVICE", true),
      reading("CORRECTION", null, true),
    ]) {
      expect(readsAsAboutSubjectCompany(read), JSON.stringify(read)).toBe(
        false,
      );
    }
  });

  it("sends a turn the reader could not read to the conversational path", () => {
    expect(readsAsAboutSubjectCompany(null)).toBe(false);
  });

  it("routes on the reading, not on the words", () => {
    const specialist = createCompanyIntelligenceSpecialist({} as never);
    const subjects = [
      { kind: "COMPANY", companyId: "11111111-1111-4111-8111-111111111111" },
    ] as never;
    // Words no pattern would have recognised, read as advice: taken.
    expect(
      specialist.supports({
        capability: "ANSWER",
        subjects,
        question: "be honest, would you put money in?",
        reading: reading("QUESTION_TO_Q", "ADVICE"),
      }),
    ).toBe(true);
    // First-person words read as small talk: not taken.
    expect(
      specialist.supports({
        capability: "ANSWER",
        subjects,
        question: "how are we doing today, Q?",
        reading: reading("SMALL_TALK"),
      }),
    ).toBe(false);
  });
});
