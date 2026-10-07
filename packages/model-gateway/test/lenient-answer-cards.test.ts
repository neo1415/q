import { describe, expect, it } from "vitest";
import { z } from "zod";

import { acceptStructuredOutput } from "../src/policy/structured.js";
import { ANALYST_LENIENT_FIELDS } from "../src/q/index.js";

/**
 * Zino live 2026-10-07 (run 1d4f4c27): "dropped:
 * answerCards.cards.0.reasons:invalid_type" -- one card's reasons came back
 * as a string and all eight cards were lost, so no card appeared for a
 * request that was literally a list with scores.
 */
const Cards = z
  .object({
    answer: z.string(),
    answerCards: z
      .object({
        title: z.string(),
        cards: z
          .array(
            z
              .object({
                name: z.string(),
                reasons: z.array(z.string().min(1)).min(1).max(3),
              })
              .strict(),
          )
          .min(1),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();

describe("answer cards with one malformed card", () => {
  it("reads a lone reason string as a one-item list instead of losing every card", () => {
    const accepted = acceptStructuredOutput(
      JSON.stringify({
        answer: "Eight of them.",
        answerCards: {
          title: "Reached out",
          cards: [
            { name: "Baridi", reasons: "Seed, Kenya, in sector." },
            { name: "Portside", reasons: ["Series A, B2B SaaS."] },
          ],
        },
      }),
      Cards,
      { lenientFields: ANALYST_LENIENT_FIELDS },
    );

    expect(accepted.ok).toBe(true);
    const cards = accepted.ok ? (accepted.value.answerCards?.cards ?? []) : [];
    expect(cards.map((card) => card.name)).toEqual(["Baridi", "Portside"]);
    expect(cards[0]?.reasons).toEqual(["Seed, Kenya, in sector."]);
    expect(accepted.ok ? accepted.value.answer : "").toBe("Eight of them.");
  });

  it("drops only the card that cannot be read", () => {
    const accepted = acceptStructuredOutput(
      JSON.stringify({
        answer: "Two of them.",
        answerCards: {
          title: "Reached out",
          cards: [
            { name: "Baridi", reasons: { pros: 1 } },
            { name: "Portside", reasons: ["Series A."] },
          ],
        },
      }),
      Cards,
      { lenientFields: ANALYST_LENIENT_FIELDS },
    );
    expect(accepted.ok).toBe(true);
    expect(
      accepted.ok
        ? accepted.value.answerCards?.cards.map((card) => card.name)
        : [],
    ).toEqual(["Portside"]);
  });

  it("still loses the field, never the answer, when no card survives", () => {
    const accepted = acceptStructuredOutput(
      JSON.stringify({
        answer: "One.",
        answerCards: { title: "x", cards: [{ name: "A", reasons: 3 }] },
      }),
      Cards,
      { lenientFields: ANALYST_LENIENT_FIELDS },
    );
    expect(accepted.ok).toBe(true);
    expect(accepted.ok ? accepted.value.answerCards : "x").toBeNull();
  });

  it("never repairs a field that is not auxiliary", () => {
    expect(
      acceptStructuredOutput(JSON.stringify({ answer: ["x"] }), Cards, {
        lenientFields: ANALYST_LENIENT_FIELDS,
      }).ok,
    ).toBe(false);
  });
});
