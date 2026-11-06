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

  it("grounds a rate converted between two periods the sentence states", () => {
    // $85,000 a month is sourced; x12 is the sentence's own conversion.
    expect(check("$85,000 a month is $1.02M a year.").ungrounded).toEqual([]);
    expect(
      check("Burn of $85k per month is $1.02M annually.").ungrounded,
    ).toEqual([]);
    // A wrong product is still caught.
    expect(check("$85,000 a month is $1.4M a year.").ungrounded).toEqual([
      "MONEY",
    ]);
    // One period named: nothing to convert, the input is not shown.
    expect(check("Annual burn is $1.02M a year.").ungrounded).toEqual([
      "MONEY",
    ]);
    // The monthly input itself must be grounded.
    expect(check("$95,000 a month is $1.14M a year.").ungrounded).toContain(
      "MONEY",
    );
  });

  it("grounds the live NUM-106 derivations whose inputs the sentence shows (live 2026-11-06)", () => {
    // Live: "So what's that burn over a full year?" after "Silo Credit's
    // monthly burn is $180k" became "I don't have a sourced figure for
    // burn yet": a correct, visibly worked $2.16M was stripped.
    const silo = claimCorpus(
      [
        "Silo Credit net monthly burn is $180k. company profile and data room",
        "Silo Credit annual recurring revenue (ARR) is $2.4M.",
        "Silo Health annual recurring revenue (ARR) is $1.1M.",
      ],
      TODAY,
    );
    const at = (sentence: string) => checkSentence(sentence, silo);
    for (const sentence of [
      "At $180k a month, Silo Credit's burn over a full year is $2.16M.",
      "That's about $2.16M over a full year ($180k × 12).",
      "Silo Credit's annual burn would be $2.16M ($180k × 12 months).",
      "Silo Credit's burn over a full year is $2.16M, based on its reported $180k monthly burn × 12.",
    ]) {
      expect(at(sentence).ungrounded, sentence).toEqual([]);
    }
    // No input shown: the figure is not grounded by the sentence.
    expect(at("Over a full year, that's $2.16M.").ungrounded).toEqual([
      "MONEY",
    ]);
    // A wrong product, a non-calendar multiplier, an unsourced input.
    expect(
      at("At $180k a month, the burn over a full year is $2.5M.").ungrounded,
    ).toEqual(["MONEY"]);
    expect(at("That's $2.34M ($180k × 13).").ungrounded).toContain("NUMBER");
    expect(
      at("At $190k a month, the burn over a full year is $2.28M.").ungrounded,
    ).toContain("MONEY");
  });

  it("uses the figures of the sentence just before as a derivation's inputs (live NUM-106 #3)", () => {
    const silo = claimCorpus(
      [
        "Silo Credit annual recurring revenue (ARR) is $2.4M.",
        "Silo Health annual recurring revenue (ARR) is $1.1M.",
      ],
      TODAY,
    );
    const answer =
      "Silo Credit’s ARR is $1.3M higher than Silo Health’s: $2.4M versus $1.1M. That makes it about 2.2 times Silo Health’s ARR.";
    expect(checkAnswer(answer, silo).text).toBe(answer);
    const streamed = createClaimChecker(
      () => [
        "Silo Credit annual recurring revenue (ARR) is $2.4M.",
        "Silo Health annual recurring revenue (ARR) is $1.1M.",
      ],
      TODAY,
    );
    expect(
      streamed.sentence(
        "Silo Credit’s ARR is $1.3M higher than Silo Health’s: $2.4M versus $1.1M.",
      ).ungrounded,
    ).toEqual([]);
    expect(
      streamed.sentence("That makes it about 2.2 times Silo Health’s ARR.")
        .ungrounded,
    ).toEqual([]);
    // Only the sentence just before, and only its grounded figures.
    expect(
      checkAnswer(
        "Silo Credit’s ARR is $2.4M. Silo Health’s is $1.1M. Together that is $9.9M.",
        silo,
      ).text,
    ).not.toContain("$9.9M");
    expect(
      checkAnswer("Silo Credit’s ARR is $2.4M. That is 7.3 times more.", silo)
        .text,
    ).not.toContain("7.3");
  });

  it("keeps a sourced place and a sourced acronym, which name nobody (live ORD-016 #0, CMP-061 #0)", () => {
    // Live 2026-11-06 on 61b7a85: "Silo Credit is a Lagos-based SME
    // lender…" read "Lagos-based SME" as an invented name. A list lost
    // Silo Credit's whole line, and "Tell me what Silo Credit does" lost
    // the sentence that named it, leaving "It reports $2.4M…".
    const silo = claimCorpus(
      [
        "Silo Credit is a SME lending company based in Lagos, founded in 2021.",
        "Silo Credit annual recurring revenue (ARR) is $2.4M.",
        "Silo Credit has 38 lending partners.",
        "Kora Farms is a agritech company based in Tamale, founded in 2023.",
      ],
      TODAY,
    );
    const answer =
      "Silo Credit is a Lagos-based SME lender founded in 2021. It reports $2.4M in ARR and works with 38 lending partners.";
    expect(checkAnswer(answer, silo).text).toBe(answer);
    for (const sentence of [
      "Silo Credit — Lagos-based SME lender founded in 2021, reporting $2.4M ARR.",
      "Silo Credit — Lagos SME lending company, founded in 2021.",
    ]) {
      expect(checkSentence(sentence, silo).ungrounded, sentence).toEqual([]);
    }
    // Still names: parts of two sourced names put together, a place
    // beside an unsourced word, an acronym the sources never write.
    expect(
      checkSentence("Kora Credit lends in Lagos.", silo).ungrounded,
    ).toEqual(["NAME"]);
    expect(
      checkSentence("Silo Credit works with Lagos Brightstone.", silo)
        .ungrounded,
    ).toEqual(["NAME"]);
    expect(
      checkSentence("Silo Credit is backed by Lagos KPX.", silo).ungrounded,
    ).toEqual(["NAME"]);
  });

  it("ends a name at a bold label's colon (live ORD-016 #0 on 7a41ff4)", () => {
    // "- **Silo Health:** Nairobi clinic software…" was read as the name
    // "Silo Health Nairobi" (the colon sat inside the closing "**"), and
    // the claim check removed the whole line: the list kept only Silo
    // Credit, whose next word ("SME") a source writes.
    const world = claimCorpus(
      [
        "Silo Health is a clinic software company based in Nairobi, founded in 2022.",
        "Silo Health annual recurring revenue (ARR) is $1.1M.",
        "Brightpath Logistics is a freight logistics company based in Kigali, founded in 2021.",
        "Brightpath Logistics annual recurring revenue (ARR) is $2M.",
      ],
      TODAY,
    );
    const list =
      "- **Silo Health:** Nairobi clinic software company founded in 2022; $1.1M ARR.\n- **Brightpath Logistics** — Kigali freight logistics company founded in 2021; $2M ARR.\n- __Silo Health__: Nairobi clinic software.";
    expect(checkAnswer(list, world).text).toBe(list);
    // A name still runs on inside the bold, and an invented one is caught.
    expect(
      checkSentence("- **Silo Health Nairobi:** clinic software.", world)
        .ungrounded,
    ).toEqual(["NAME"]);
    expect(
      checkSentence("- **Kora Credit:** Nairobi lender.", world).ungrounded,
    ).toEqual(["NAME"]);
  });

  it("uses a sourced short duration as an input, never as a claim", () => {
    const withRunway = claimCorpus(
      ["Ledgerline: monthly burn $120,000; runway 9 months."],
      TODAY,
    );
    const at = (sentence: string) => checkSentence(sentence, withRunway);
    expect(
      at("9 months at $120,000 a month implies about $1.08M of cash.")
        .ungrounded,
    ).toEqual([]);
    // A duration the sources do not state grounds nothing.
    expect(
      at("7 months at $120,000 a month implies about $840k of cash.")
        .ungrounded,
    ).toEqual(["MONEY"]);
    // The lone digit is still not itself checked as a claim.
    expect(at("Check back in 3 weeks.").ungrounded).toEqual([]);
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
