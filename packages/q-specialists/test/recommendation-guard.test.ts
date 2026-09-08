import { describe, expect, it } from "vitest";

import {
  claimsRecommendationExplanation,
  RECOMMENDATION_UNAVAILABLE_MESSAGE,
  withoutRecommendationClaims,
} from "@capital-q/q-core";

import { assertsForbiddenClaim } from "../src/index.js";

/**
 * The recommendation-explanation guard (CQ-Q-023 §7, §17, §20-§22, §30).
 *
 * Capital Q has no deterministic recommendation factor model yet. Until one
 * exists — the versioned feature snapshot, ranking configuration and reason
 * codes that Wave 6 owns — there is no such thing as a true answer to "why
 * was this recommended to me". Any sentence that answers it is invented.
 *
 * The prompt already forbids this, and a compliant model obeys. That is not
 * enough: the prompt is not the security boundary, and the thing standing
 * between a fluent model and a fabricated "91% fit" reaching an investor
 * cannot be the instruction not to write one.
 *
 * So the guard sits on the last surface before a person reads the text. It
 * is deliberately blunt — it removes the sentence rather than rewriting it,
 * because a rewritten explanation is one nobody wrote and Capital Q would
 * still be the author of a claim it cannot support.
 *
 * When the factor model lands, this guard is not deleted. It becomes the
 * check that an explanation cites factors the ranker actually produced.
 */

describe("QREC-001 · a factor-less recommendation explanation never reaches a person", () => {
  it.each([
    "This is a 91% fit for Apex Ventures because of strong enterprise traction.",
    "Capital Q recommended this company because it matches your stage and sector.",
    "You rank highly for Apex because of your payments infrastructure.",
    "This company was surfaced to you because of your mandate alignment.",
    "Overall fit score: 8.4 out of 10.",
    "This is ranked third in your feed.",
    "Excellent 94% fit because of founder quality and market leadership.",
    "Why we matched you: your sector and cheque size line up.",
  ])("recognises %s as a claim Capital Q cannot support", (sentence) => {
    expect(claimsRecommendationExplanation(sentence)).toBe(true);
  });

  it.each([
    "Annual recurring revenue reached USD 2.4m in August 2026.",
    "The company describes an industrial market across several African countries.",
    "One customer accounts for 64 percent of contracted revenue.",
    "Your mandate covers Seed and Series A B2B software across Africa.",
    "I don't have enough evidence about retention to say anything useful.",
    "The deck and the management accounts disagree about ARR.",
  ])("leaves an honest sentence alone: %s", (sentence) => {
    expect(claimsRecommendationExplanation(sentence)).toBe(false);
  });

  it("removes only the offending sentences and keeps the rest of the answer", () => {
    const answer = [
      "Northstar sells B2B infrastructure software to enterprise manufacturers.",
      "This is a 91% fit for your mandate because of the sector overlap.",
      "Annual recurring revenue is recorded at USD 2.4m for August 2026.",
    ].join(" ");
    const cleaned = withoutRecommendationClaims(answer);
    expect(cleaned.text).toContain("B2B infrastructure software");
    expect(cleaned.text).toContain("USD 2.4m");
    expect(cleaned.text).not.toContain("91%");
    expect(cleaned.removed).toBe(1);
  });

  it("says plainly that it cannot explain a recommendation when nothing is left", () => {
    // A model that answered only with invented reasons leaves nothing
    // honest behind. Capital Q says so rather than returning silence.
    const cleaned = withoutRecommendationClaims(
      "You were recommended because you match Apex's thesis. It's a 94% fit.",
    );
    expect(cleaned.text).toBe(RECOMMENDATION_UNAVAILABLE_MESSAGE);
    expect(cleaned.removed).toBe(2);
  });

  it("uses plain language with no implementation jargon (§17)", () => {
    expect(RECOMMENDATION_UNAVAILABLE_MESSAGE).not.toMatch(
      /factor|snapshot|ranker|ranking version|feature version|deterministic/i,
    );
    expect(RECOMMENDATION_UNAVAILABLE_MESSAGE.toLowerCase()).toContain(
      "recommend",
    );
  });

  it("leaves an answer with nothing to remove untouched", () => {
    const answer = "Northstar is a Seed-stage B2B infrastructure company.";
    const cleaned = withoutRecommendationClaims(answer);
    expect(cleaned.text).toBe(answer);
    expect(cleaned.removed).toBe(0);
  });
});

describe("QREC-002 · the finding-level guard and the prose guard agree", () => {
  it("both refuse a fit score", () => {
    const sentence = "Investor fit is strong and this is a top 10% company.";
    expect(assertsForbiddenClaim(sentence)).toBe(true);
    expect(claimsRecommendationExplanation(sentence)).toBe(true);
  });

  it("the prose guard additionally catches 'why you were shown this'", () => {
    // A sentence with no number and no comparative still asserts a
    // recommendation reason, which is the thing that does not exist yet.
    const sentence =
      "Capital Q surfaced this company to you because of your sector focus.";
    expect(assertsForbiddenClaim(sentence)).toBe(false);
    expect(claimsRecommendationExplanation(sentence)).toBe(true);
  });
});
