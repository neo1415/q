import { describe, expect, it } from "vitest";

import {
  checkAnswer,
  checkSentence,
  claimCorpus,
  createClaimChecker,
  extractClaims,
} from "../src/q/claim-check.js";

const TODAY = new Date("2026-11-05T12:00:00Z");

// What the run was given: an authorised fact, the conversation's turns
// and a tool result, as the model read them.
const FACT =
  "[F1] Northwind Analytics reported revenue of $1,200,000 for FY2025; " +
  "monthly burn is $85,000. Founded March 2021 by Ada Okafor.";
const USER_TURN =
  "We're raising $3M at a $12M pre-money. Our churn is 4.5% monthly.";
const TOOL_RESULT = JSON.stringify({
  ok: true,
  result: { company: "Yamfield Agro", customers: 1340, grossMargin: "38%" },
});

const corpus = claimCorpus([FACT, USER_TURN, TOOL_RESULT], TODAY);
const check = (sentence: string) => checkSentence(sentence, corpus);

describe("claim check: invented claims", () => {
  it("rewrites an invented ARR to an honest unknown, never to zero", () => {
    const out = check("Northwind's ARR is $4.8M, growing fast.");
    expect(out.ungrounded).toEqual(["MONEY"]);
    expect(out.text).toBe("I don't have a sourced figure for ARR yet.");
    expect(out.text).not.toMatch(/\b0\b|no ARR|zero/iu);
  });

  it("says a metric's unknown once per answer, then removes the rest", () => {
    const said = new Set<string>();
    expect(checkSentence("ARR is $4.8M.", corpus, said).text).toMatch(/ARR/u);
    expect(
      checkSentence("That ARR of $5.1M is strong.", corpus, said).text,
    ).toBeNull();
  });

  it("removes a sentence naming an invented customer", () => {
    const out = check("Their largest customer is Brightwater Logistics.");
    expect(out.ungrounded).toEqual(["NAME"]);
    expect(out.text).toBeNull();
  });

  it("removes an invented person", () => {
    expect(
      check("The CTO, Michael Brennan, joined last year.").text,
    ).toBeNull();
  });

  it("does not ground a figure in a different explicit currency", () => {
    expect(check("Revenue was ₦1.2M last year.").ungrounded).toEqual(["MONEY"]);
  });
});

describe("claim check: true claims pass untouched", () => {
  it("matches a correct figure written in another unit format", () => {
    for (const sentence of [
      "Revenue was $1.2M in FY2025.",
      "Revenue was 1.2m.",
      "Revenue was 1.2 million dollars.",
      "Revenue was USD 1,200,000.",
      "Burn is about $85k a month.",
    ]) {
      const out = check(sentence);
      expect(out.ungrounded, sentence).toEqual([]);
      expect(out.text).toBe(sentence);
    }
  });

  it("matches a figure from the person's own message", () => {
    const sentence = "You're raising $3 million at a $12m pre-money valuation.";
    expect(check(sentence)).toEqual({ text: sentence, ungrounded: [] });
    expect(check("Churn at 4.5% a month is high.").ungrounded).toEqual([]);
  });

  it("matches a figure and a name from a tool result", () => {
    const sentence =
      "Yamfield Agro has 1,340 customers and a 38% gross margin.";
    expect(check(sentence)).toEqual({ text: sentence, ungrounded: [] });
  });

  it("matches a rounded figure to its source", () => {
    expect(check("They serve roughly 1,300 customers.").ungrounded).toEqual([]);
  });

  it("matches a date in another format, and rejects an invented one", () => {
    expect(check("Northwind was founded in March 2021.").ungrounded).toEqual(
      [],
    );
    expect(check("It was founded in 2021.").ungrounded).toEqual([]);
    expect(check("It was founded in June 2019.").ungrounded).toContain("DATE");
    expect(check("It was founded in 2017.").ungrounded).toEqual(["DATE"]);
  });

  it("allows derived arithmetic only when both inputs are present", () => {
    // $1.2M revenue over $3M raise = 40%: both in the corpus, same sentence.
    expect(
      check("Revenue of $1.2M is 40% of the $3M raise.").ungrounded,
    ).toEqual([]);
    // Burn x 12 from one line: 85,000 is there, 12 is not stated with it.
    expect(check("Annual burn is $1.02M.").ungrounded).toEqual(["MONEY"]);
    // A growth rate between two of the sentence's own grounded figures.
    expect(
      check("Moving from $3M to $12M is a 300% step up.").ungrounded,
    ).toEqual([]);
  });

  it("lets incidental numbers through: list positions, times, planning spans", () => {
    for (const sentence of [
      "1. Confirm the deck.",
      "Let's speak at 3pm.",
      "Over the next 12 months, focus on retention.",
      "Here are the top 10 investors for you.",
    ]) {
      expect(check(sentence).ungrounded, sentence).toEqual([]);
    }
  });

  it("does not treat Capital Q vocabulary or title-case labels as names", () => {
    for (const sentence of [
      "Open the Data Room in Capital Q.",
      "## Key Gaps and Risks",
      "Gross Margin is the next thing to evidence.",
      "Investors in West Africa look at this.",
    ]) {
      expect(check(sentence).ungrounded, sentence).toEqual([]);
    }
  });

  it("treats today's date and year as grounded", () => {
    expect(
      check("As of November 2026, nothing has changed.").ungrounded,
    ).toEqual([]);
  });
});

describe("claim check: extraction and the whole answer", () => {
  it("extracts every kind of claim from one sentence", () => {
    const kinds = extractClaims(
      "Acme Robotics hit $2.5M ARR, up 40%, with 120 staff on 12 March 2024.",
    ).map((claim) => claim.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["NAME", "MONEY", "PERCENT", "NUMBER", "DATE"]),
    );
  });

  it("checks a stored answer sentence by sentence, keeping its layout", () => {
    const out = checkAnswer(
      "Revenue was $1.2M.\n\n- Burn is $85k a month. ARR is $7.4M.\n- Valued by Sequoia Capital Partners.",
      corpus,
    );
    expect(out.text).toBe(
      "Revenue was $1.2M.\n\n- Burn is $85k a month. I don't have a sourced figure for ARR yet.",
    );
    expect(out.ungrounded).toEqual(["MONEY", "NAME"]);
  });

  it("rebuilds the corpus when a tool round adds results", () => {
    const sources = [FACT];
    const checker = createClaimChecker(() => sources, TODAY);
    expect(
      checker.sentence("Yamfield Agro has 1,340 customers.").ungrounded,
    ).not.toEqual([]);
    sources.push(TOOL_RESULT);
    expect(
      checker.sentence("Yamfield Agro has 1,340 customers.").ungrounded,
    ).toEqual([]);
  });
});

describe("claim check: CI 42015449549 regressions", () => {
  // apps/q-api/test/chat-card-turn.test.ts: a chat message read by a tool
  // carries an ISO timestamp; the answer says its date and time.
  const thread = JSON.stringify({
    ok: true,
    result: {
      messages: [
        {
          senderName: "Amara Diallo-Benson",
          text: "QA double-send 1",
          sentAt: "2026-10-03T08:56:00.000Z",
        },
      ],
    },
  });
  const chat = claimCorpus([thread], TODAY);

  it("grounds a date and time from a tool result's ISO timestamp", () => {
    const sentence =
      'Amara Diallo-Benson wrote at 2026-10-03 08:56 UTC: "QA double-send 1".';
    expect(checkSentence(sentence, chat)).toEqual({
      text: sentence,
      ungrounded: [],
    });
    expect(
      checkSentence("She wrote on 3 October 2026 at 09:56 BST.", chat)
        .ungrounded,
    ).toEqual([]);
  });

  it("still catches an invented time", () => {
    expect(
      checkSentence("She wrote at 14:12 on 3 October 2026.", chat).ungrounded,
    ).toEqual(["DATE"]);
  });

  it("knows countries from the canonical list, not a copy", () => {
    expect(
      checkSentence("Most of the pipeline is in South Africa.", chat)
        .ungrounded,
    ).toEqual([]);
    expect(
      checkSentence("Expansion into Saudi Arabia is planned.", chat).ungrounded,
    ).toEqual([]);
  });
});
