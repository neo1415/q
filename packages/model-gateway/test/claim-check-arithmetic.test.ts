import { describe, expect, it } from "vitest";

import { checkAnswer, claimCorpus } from "../src/q/claim-check.js";

/**
 * A derived figure is grounded only when it is recomputed from sourced
 * figures (Q-IQ remaining-gaps lane, 6 Nov 2026: "a 33 percentage-point
 * difference" for 78% − 41% was published, grounded by 400k ÷ 1.2M × 100
 * on an unrelated deck line; an unsourced "45%" then rode on it, 78 − 33).
 * True arithmetic, with its label, stays published.
 */
const corpus = claimCorpus(
  [
    "Silo Credit annual recurring revenue (ARR) is $2.4M.",
    "Silo Credit net monthly burn is $180k.",
    "Silo Credit cash balance is $2.52M.",
    "Silo Credit gross margin is 62%.",
    "Silo Credit is raising a $6M Series A.",
    "Silo Health annual recurring revenue (ARR) is $1.1M.",
    "Ledgerfold gross margin is 78%.",
    "Tamarind Pay gross margin is 41%.",
    "The Silo Credit seed deck (dated March 2024) states ARR of $400k and asks for $1.2M.",
    "Households pay $3 to $5 per 20 litres of kiosk water.",
  ],
  new Date("2026-11-06T08:00:00Z"),
);
const kept = (reply: string): boolean =>
  checkAnswer(reply, corpus).text === reply;

describe("claim check: derived figures are recomputed, never matched by coincidence", () => {
  it.each([
    // Percentage points: a difference of two percentages.
    "Ledgerfold's 78% gross margin against Tamarind Pay's 41% is a 37-percentage-point difference.",
    "Tamarind Pay reports a 41% gross margin, compared with 78% for Ledgerfold, a 37 percentage-point gap.",
    // A relative difference of two percentages, as a percentage.
    "Ledgerfold's 78% margin is about 90% higher than Tamarind Pay's 41%.",
    // Runway = cash ÷ burn, k and M.
    "Silo Credit's $2.52M of cash at $180k a month of burn is 14 months of runway.",
    // A period conversion.
    "Silo Credit's $180k a month is $2.16M a year.",
    // A multiple.
    "Raising $6M on $2.4M of ARR is a 2.5x multiple.",
    // A difference of money, and the next sentence working from it.
    "Silo Credit's ARR of $2.4M is $1.3M more than Silo Health's $1.1M.",
    "Silo Credit's ARR is $2.4M against Silo Health's $1.1M. That is about 2.2 times.",
    // A share of money.
    "At a 62% gross margin, $2.4M of ARR is about $1.49M of gross profit.",
    // Growth from a sourced pair, both said.
    "Silo Credit's ARR went from $400k to $2.4M, growth of 500%.",
    // A sourced figure, as itself.
    "Silo Credit is raising $6M.",
    // The mid-point of a sourced range (the other end said).
    "Kiosk water costs $3 to $5 per 20 litres, so $4 is the mid-point.",
  ])("keeps %s", (reply) => {
    expect(kept(reply)).toBe(true);
  });

  it.each([
    // A wrong difference: 78 − 41 is 37.
    "Ledgerfold's 78% gross margin against Tamarind Pay's 41% is a 33-percentage-point difference.",
    // An unsourced percentage, and a difference built on it.
    "Tamarind Pay reports a 45% gross margin, compared with 78% for Ledgerfold, a 33 percentage-point difference.",
    // Percentage points written as a percentage (it is 90% higher).
    "Ledgerfold's 78% margin is 37% higher than Tamarind Pay's 41%.",
    // Wrong runway: $2.52M ÷ $180k is 14.
    "Silo Credit's $2.52M of cash at $180k a month of burn is 15 months of runway.",
    // Wrong multiple: $6M ÷ $2.4M is 2.5.
    "Raising $6M on $2.4M of ARR is a 3x multiple.",
    // Wrong money difference.
    "Silo Credit's ARR of $2.4M is $1.5M more than Silo Health's $1.1M.",
    // A figure no source states, "derivable" only from a deck line's two
    // figures that the sentence never says (400k ÷ 1.2M × 100).
    "Silo Credit's monthly churn is 33%.",
    // A multiple no source states ("March 2024" is not a 3).
    "Silo Credit's raise is a 3x multiple of its seed ask.",
  ])("removes %s", (reply) => {
    expect(kept(reply)).toBe(false);
  });
});
