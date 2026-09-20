import { describe, expect, it } from "vitest";

import {
  claimsRecommendationExplanation,
  RECOMMENDATION_UNAVAILABLE_MESSAGE,
  withoutRecommendationClaims,
  type RecommendationGrounds,
} from "../src/communication/recommendation-guard.js";

/**
 * The recommendation guard, before and after the factor model
 * (CQ-Q-023; CQ-REC-007R B; doc 19 §56, §59).
 *
 * The guard was written when nothing in Capital Q could say why something
 * was recommended, so it removed every sentence that claimed to. Wave 6
 * built the thing it was waiting for. The properties below are the two
 * halves of that change, and the second is the one that matters: being
 * able to explain a recommendation is not permission to quantify it.
 */

const GROUNDS: RecommendationGrounds = {
  dimensions: ["STAGE", "GEOGRAPHY", "TAXONOMY"],
};

describe("without grounds, nothing has changed", () => {
  it("removes the claim that a recommendation happened", () => {
    const answer =
      "Northwind builds industrial sensors. This company was surfaced to you because of your mandate.";
    const guarded = withoutRecommendationClaims(answer);
    expect(guarded.removed).toBe(1);
    expect(guarded.text).toBe("Northwind builds industrial sensors.");
  });

  it("says so plainly when nothing honest survives", () => {
    const guarded = withoutRecommendationClaims(
      "Capital Q recommended this company to you.",
    );
    expect(guarded.text).toBe(RECOMMENDATION_UNAVAILABLE_MESSAGE);
  });

  it("leaves an honest statement about a declared mandate alone", () => {
    // The vocabulary is not the offence: this asserts no comparison.
    const answer = "Your mandate covers Seed and Series A in the UK.";
    expect(withoutRecommendationClaims(answer)).toEqual({
      text: answer,
      removed: 0,
    });
  });

  it("leaves small talk alone", () => {
    const answer = "Morning. What would you like to look at today?";
    expect(withoutRecommendationClaims(answer)).toEqual({
      text: answer,
      removed: 0,
    });
  });
});

describe("with the ranker's own factors in hand", () => {
  it("permits the explanation the factors support", () => {
    const answer =
      "This company was surfaced to you because your mandate declares Seed and this company is Seed. The sector could not be established.";
    expect(withoutRecommendationClaims(answer, GROUNDS)).toEqual({
      text: answer,
      removed: 0,
    });
  });

  it("still removes a fit stated as a quantity", () => {
    // REC-005 produces no percentage and the explanation contract carries
    // none, so no factor can ever support this.
    const guarded = withoutRecommendationClaims(
      "It was surfaced to you on stage. Overall it is a 91% match for your mandate.",
      GROUNDS,
    );
    expect(guarded.removed).toBe(1);
    expect(guarded.text).toBe("It was surfaced to you on stage.");
  });

  it("still removes a position in an ordering and a place in a distribution", () => {
    for (const sentence of [
      "It ranked first among your recommendations.",
      "This company is top-quartile for your mandate.",
      "It compares favourably with its peers.",
      "Stage alignment is strong.",
    ]) {
      expect(claimsRecommendationExplanation(sentence, GROUNDS)).toBe(true);
    }
  });

  it("does not claim Capital Q cannot explain when it just did", () => {
    // Everything was arithmetic, so nothing survives -- but the "I can't
    // explain this yet" message would now be false. The caller falls back
    // to the deterministic explanation it already holds instead.
    const guarded = withoutRecommendationClaims(
      "This is a 91% match. It is top-decile.",
      GROUNDS,
    );
    expect(guarded.removed).toBe(2);
    expect(guarded.text).toBe("");
    expect(guarded.text).not.toBe(RECOMMENDATION_UNAVAILABLE_MESSAGE);
  });

  it("treats empty grounds as no grounds", () => {
    // A tool that ran and produced nothing licenses nothing.
    const sentence = "This company was surfaced to you.";
    expect(claimsRecommendationExplanation(sentence, { dimensions: [] })).toBe(
      true,
    );
    expect(claimsRecommendationExplanation(sentence, null)).toBe(true);
    expect(claimsRecommendationExplanation(sentence, GROUNDS)).toBe(false);
  });
});
