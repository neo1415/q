import { describe, expect, it } from "vitest";

import {
  TURN_READER_V57,
  TURN_READER_V58,
  TurnReaderV58ResultSchema,
  V1_ABOUT_NAMED_OTHER,
  V58_FIT_MANDATE,
  V58_NAMED_OTHER,
  V58_RAISING,
  V58_RANKING_NAME,
  V58_SUITS_THEM,
  V49_TEAM_JOB,
  V58_MEETING_PREP,
  V46_DISCOVER,
  V58_INVESTOR_PROSPECTS,
  QuestionKindSchema,
  createDefaultPromptRegistry,
} from "../src/index.js";
import { DiscoverRequestSchema } from "../src/conversation/reading.js";

/**
 * Production 2026-10-23: "Yes", said to Q's offer about a company, was
 * searched and pictured as a company called "Yes". The reader now says
 * whom the turn is about, by meaning and from the conversation; code
 * guesses no name from capital letters or word lists.
 */
describe("TURN_READER v58: the reader names whom the turn is about", () => {
  it("v57 plus the NAMED OTHER rule (v60 is active) and Lane 4's two mandate sentences", () => {
    const active = createDefaultPromptRegistry().getActive("TURN_READER");
    expect(active.definition.version).toBe(61);
    expect(TURN_READER_V57.status).toBe("DEPRECATED");
    expect(TURN_READER_V58.template).toContain(
      `${V1_ABOUT_NAMED_OTHER}${V58_NAMED_OTHER}`,
    );
    expect(TURN_READER_V58.template).toContain(V58_SUITS_THEM);
    expect(TURN_READER_V58.template).toContain(V58_FIT_MANDATE);
  });

  it("reads which companies suit an investor by meaning (shared with Lane 4)", () => {
    expect(V58_SUITS_THEM).toMatch(/ranking FIT and mandateRelevant true/u);
    expect(V58_SUITS_THEM).toMatch(/whatever the words/u);
    expect(V58_FIT_MANDATE).toMatch(
      /and mandateRelevant, true when they ask to rank or score against their mandate/u,
    );
  });

  it("reads name order and 'raising now' by meaning (Lane 4, coordinator's investor journey)", () => {
    expect(TURN_READER_V58.template).toContain(V58_RANKING_NAME);
    expect(TURN_READER_V58.template).toContain(V58_RAISING);
    expect(V58_RANKING_NAME).toMatch(
      /NAME only when they ask for the list alphabetically or by name/u,
    );
    expect(V58_RAISING).toMatch(/in any words and any language/u);
    const read = DiscoverRequestSchema.parse({
      sectors: ["fintech"],
      countries: ["NG"],
      stages: ["seed"],
      ranking: "NAME",
      raising: true,
    });
    expect(read.ranking).toBe("NAME");
    expect(read.raising).toBe(true);
    // An older reading without the field is not a raising ask.
    expect(DiscoverRequestSchema.parse({}).raising).toBe(false);
  });

  it("asks for the subject from meaning and the recent turns, never from a reply word", () => {
    expect(V58_NAMED_OTHER).toMatch(/from the recent turns/u);
    expect(V58_NAMED_OTHER).toMatch(/a yes to Q's offer about them/u);
    expect(V58_NAMED_OTHER).toMatch(/never a word of a reply/u);
    expect(V58_NAMED_OTHER).toMatch(/"zino aviation" is "Zino Aviation"/u);
  });

  it("keeps aboutNamedOther, and a malformed subject costs only the subject", () => {
    const base = {
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      aboutNamedOther: true,
    };
    expect(
      TurnReaderV58ResultSchema.parse({
        ...base,
        namedOther: { name: "Zino Aviation", kind: "COMPANY" },
      }).namedOther,
    ).toEqual({ name: "Zino Aviation", kind: "COMPANY" });
    const malformed = TurnReaderV58ResultSchema.parse({
      ...base,
      namedOther: { name: "", kind: "ROBOT" },
    });
    expect(malformed.namedOther).toBeNull();
    expect(malformed.aboutNamedOther).toBe(true);
    expect(TurnReaderV58ResultSchema.parse(base).namedOther).toBeNull();
  });
});

/**
 * Lane 5 (owner 2026-10-23, live founder.maji-loop): "help me prepare for
 * a first call with Savanna Seed Partners" is prepared in the answer, not
 * planned as a team job.
 */
describe("TURN_READER v58: getting ready for a call is meetingPrep", () => {
  it("follows the TEAM JOB rule, in the same v58", () => {
    expect(TURN_READER_V58.template).toContain(
      `${V49_TEAM_JOB}${V58_MEETING_PREP}`,
    );
  });

  it("reads by meaning, keeps a handed-over job as teamJob", () => {
    expect(V58_MEETING_PREP).toMatch(/in any words and any language/u);
    expect(V58_MEETING_PREP).toMatch(/Then teamJob is false/u);
    expect(V58_MEETING_PREP).toMatch(/hand the work to your team/u);
  });

  it("meetingPrep is optional and lenient", () => {
    const shape = TurnReaderV58ResultSchema.shape.meetingPrep;
    expect(shape.parse(undefined)).toBeNull();
    expect(shape.parse({ counterpart: "Savanna Seed Partners" })).toEqual({
      counterpart: "Savanna Seed Partners",
    });
    expect(shape.parse({ counterpart: "" })).toBeNull();
    expect(shape.parse("Savanna")).toBeNull();
  });
});

/**
 * Founder investor matching (owner 2026-10-23, live founder.maji-loop):
 * "Which investors should I talk to first, and why?" is its own question
 * kind, read by meaning, answered by code from the investors already
 * interested and network-visible profiles.
 */
describe("TURN_READER v58: which investors a company should approach", () => {
  it("adds INVESTOR_PROSPECTS beside DISCOVER_COMPANIES in the shared v58", () => {
    expect(TURN_READER_V58.template).toContain(
      `${V46_DISCOVER}${V58_INVESTOR_PROSPECTS}`,
    );
  });

  it("is a question kind of v58's reading only; published kinds are unchanged", () => {
    const reading = TurnReaderV58ResultSchema.parse({
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: {
        kind: "INVESTOR_PROSPECTS",
        text: "Which investors should I talk to first, and why?",
        count: null,
      },
    });
    expect(reading.question?.kind).toBe("INVESTOR_PROSPECTS");
    expect(QuestionKindSchema.safeParse("INVESTOR_PROSPECTS").success).toBe(
      false,
    );
  });

  it("reads by meaning, over ADVICE, FIT and DISCOVER_COMPANIES, and leaves region asks alone", () => {
    expect(V58_INVESTOR_PROSPECTS).toMatch(
      /by what it means, in any words and any language/u,
    );
    expect(V58_INVESTOR_PROSPECTS).toMatch(
      /Over ADVICE, FIT and DISCOVER_COMPANIES/u,
    );
    expect(V58_INVESTOR_PROSPECTS).toContain(
      "which investors should I talk to first, and why?",
    );
    expect(V58_INVESTOR_PROSPECTS).toMatch(
      /not this kind when they ask about one named investor/u,
    );
  });
});
