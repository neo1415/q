import { describe, expect, it } from "vitest";

import { fitRankingLaneOf } from "../src/fast-lane.js";

/**
 * S2: only a plain ranking of their own candidates is recognised by code;
 * anything asking for more (an action, an explanation, a record, a set
 * just shown, an exclusion, a name) is left to the readers.
 */
describe("fitRankingLaneOf", () => {
  it.each([
    "Show my top 3 companies against my mandate",
    "Rank my top five companies",
    "rank my companies",
    "Which three companies in my feed fit my mandate best?",
    "best companies for my mandate",
    "top 5 startups in Kenya for my mandate",
    "show me the strongest deals for our thesis",
  ])("%s is a fit ranking", (said) => {
    expect(fitRankingLaneOf(said)).toEqual({
      questionKind: "FIT",
      fitQuestion: { text: said, count: null, previous: false },
    });
  });

  it.each([
    "Show my top 3 companies with scores against my mandate and explain why.",
    "What does this company actually do and why does it fit my mandate?",
    "Compare Ledgerfold and F2 against my mandate",
    "draft an email to my top 3 companies",
    "rank them against my mandate",
    "top companies for my mandate except fintech",
    "is Ledgerfold one of my best companies for my mandate?",
    "best fintech companies in Nigeria",
    "what are the risks of my top companies?",
    "Rank my top five companies. Then book a call with the first.",
    "score companies against my mandate",
    "what is my mandate?",
    "",
  ])("%s is left to the readers", (said) => {
    expect(fitRankingLaneOf(said)).toBeNull();
  });
});
