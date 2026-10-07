import { describe, expect, it } from "vitest";

import {
  COMPANY_ANALYST_V19,
  COMPANY_ANALYST_V20,
  CONVERSATION_SECTION,
  createDefaultPromptRegistry,
  inFirstPerson,
  naturalRegisterIssues,
  V19_ANSWER_FORMAT_HEADING,
} from "../src/index.js";

/** Natural conversation (Zino live 2026-10-07). */
describe("COMPANY_ANALYST v20", () => {
  it("is active, adds only HOW YOU TALK before ANSWER FORMAT, and v19 is kept", () => {
    const registry = createDefaultPromptRegistry();
    expect(registry.getActive("COMPANY_ANALYST").definition.version).toBe(20);
    expect(COMPANY_ANALYST_V19.status).toBe("DEPRECATED");
    expect(
      COMPANY_ANALYST_V20.template.replace(`\n\n${CONVERSATION_SECTION}`, ""),
    ).toBe(COMPANY_ANALYST_V19.template);
    expect(COMPANY_ANALYST_V20.template).toContain(
      `${CONVERSATION_SECTION}${V19_ANSWER_FORMAT_HEADING}`,
    );
    for (const rule of [
      "first",
      "First person",
      "carries its name",
      "answerCards",
      "Caveat once",
      "register",
      "internal text",
      "clarifyingQuestions empty",
    ]) {
      expect(CONVERSATION_SECTION).toContain(rule);
    }
  });
});

describe("natural register in code", () => {
  it("says the founder's answer in first person", () => {
    const { text, rewritten } = inFirstPerson(
      "Capital Q records that you have expressed interest in Baridi and Portside. The record confirms interest.",
    );
    expect(text).toBe(
      "You've expressed interest in Baridi and Portside. I can confirm interest.",
    );
    expect(rewritten).toBe(2);
    expect(naturalRegisterIssues(text)).toEqual([]);
  });

  it("leaves a sentence it does not recognise exactly as written", () => {
    const plain = "Portside fits best; its round size isn't known yet.";
    expect(inFirstPerson(plain)).toEqual({ text: plain, rewritten: 0 });
  });

  it("names what still reads unnatural", () => {
    expect(
      naturalRegisterIssues(
        'Sure, got it. Pros: seed stage. I did 4 things for "Please set this up as a standing instruction for me: "Reply…"',
      ),
    ).toEqual(["REFLEX_OPENER", "ORPHAN_LIST_ITEM", "QUOTED_INTERNAL_TEXT"]);
    const long = Array.from({ length: 70 }, () => "word").join(" ");
    expect(naturalRegisterIssues(long, { spoken: true })).toContain(
      "TOO_LONG_TO_SAY",
    );
  });
});
