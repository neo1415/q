import { describe, expect, it } from "vitest";

import {
  isAboutSubjectCompany,
  readAboutCompany,
} from "../src/company/about-company.js";

/**
 * Which questions the company specialist may take.
 *
 * The cases in the first two blocks are verbatim from a live session in
 * which every one of them was sent to the specialist and answered "that
 * falls outside the scope of the company data I have".
 */
describe("whether a question is about the company in the conversation", () => {
  it("sends small talk and general questions elsewhere", () => {
    for (const said of [
      "whats up?",
      "how are you?",
      "cn you hear me?",
      "who is the president of Nigeria?",
      "what is a SAFE note?",
      "thanks",
    ]) {
      const read = readAboutCompany(said);
      expect(read.about, said).toBe(false);
    }
  });

  it("sends a question about somebody else elsewhere", () => {
    expect(readAboutCompany("who is the current CEO of paystack")).toEqual({
      about: false,
      reason: "OTHER_ENTITY",
    });
    expect(isAboutSubjectCompany("tell me about Flutterwave")).toBe(false);
    expect(isAboutSubjectCompany("Compare Paystack and Flutterwave")).toBe(
      false,
    );
  });

  it("sends the outside world elsewhere, even with a first-person phrasing", () => {
    expect(readAboutCompany("you can just search online, bro")).toEqual({
      about: false,
      reason: "OUTSIDE_WORLD",
    });
    expect(isAboutSubjectCompany("search online for our competitors")).toBe(
      false,
    );
    expect(isAboutSubjectCompany("what is the latest news in fintech")).toBe(
      false,
    );
  });

  it("keeps the person's own company for the specialist", () => {
    for (const said of [
      "what is our runway",
      "how much are we raising",
      "tell me about my deck",
      "are we ready to raise",
      "how do we look to an investor",
      "what does the company do",
      "what's our business model",
      // The person measuring themselves against somebody else: "me" on
      // their own company's page is the company (live, 2026-09-17).
      "hey, what sthe difference between me and paystack and what can i do to be as big as them",
      "how do I compare to Flutterwave?",
      "what can we do to grow faster than Moniepoint",
      // An analysis asked for outright is the specialist's whole purpose,
      // whatever the person calls their company.
      "Analyse Northstar.",
      "assess the company",
      "run diligence on this",
    ]) {
      expect(isAboutSubjectCompany(said), said).toBe(true);
    }
  });

  it("says why, so a wrong reading can be seen rather than guessed at", () => {
    expect(readAboutCompany("what is our runway").reason).toBe("FIRST_PERSON");
    expect(readAboutCompany("describe the business model").reason).toBe(
      "DIMENSION",
    );
    expect(readAboutCompany("Analyse Northstar.").reason).toBe("ANALYSIS");
    expect(readAboutCompany("").reason).toBe("NOTHING_IN_PARTICULAR");
  });
});
