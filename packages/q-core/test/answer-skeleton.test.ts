import { describe, expect, it } from "vitest";

import {
  answerSkeletons,
  localisedAnswer,
  skeletonOf,
} from "../src/ui-text/public.js";

/**
 * Code-written answers in any language: the sentence's own words are
 * translated (and cached); names, figures, codes and quotes are lifted out
 * and put back exactly.
 */
describe("an answer's skeleton carries no data", () => {
  it("lifts names, figures, currency codes and quotes", () => {
    const { skeleton, values } = skeletonOf(
      'Here is one Gulf investor who could fit: AlRayan Investment LLC, raising USD 1.5m by 7 October; they said "maybe next week".',
    );
    expect(skeleton).toBe(
      "Here is one {v1} investor who could fit: {v2}, raising {v3} {v4} by {v5} October; they said {v6}.",
    );
    expect(values).toEqual([
      "Gulf",
      "AlRayan Investment LLC",
      "USD",
      "1.5m",
      "7",
      '"maybe next week"',
    ]);
  });

  it("keeps product names and ordinary sentence words in the text", () => {
    expect(
      skeletonOf("Nothing in Capital Q needs you right now.").skeleton,
    ).toBe("Nothing in Capital Q needs you right now.");
    expect(skeletonOf("Q found 3 matches.").skeleton).toBe(
      "Q found {v1} matches.",
    );
  });

  it("the same sentence shape gives the same key for different people", () => {
    const a = answerSkeletons("Zino Aviation is waiting for your reply.");
    const b = answerSkeletons(
      "Halyard Security Ltd is waiting for your reply.",
    );
    expect(a).toEqual(b);
    expect(a).toEqual(["{v1} is waiting for your reply."]);
  });
});

describe("the answer in another language", () => {
  const french = new Map([
    ["{v1} is waiting for your reply.", "{v1} attend votre réponse."],
    ["You have {v1} messages.", "Vous avez {v1} messages."],
  ]);

  it("puts each sentence's data back exactly, line structure kept", () => {
    expect(
      localisedAnswer(
        "You have 3 messages.\n- Zino Aviation is waiting for your reply.",
        french,
      ),
    ).toBe("Vous avez 3 messages.\n- Zino Aviation attend votre réponse.");
  });

  it("is null when any sentence has no translation: never half one language", () => {
    expect(
      localisedAnswer("You have 3 messages. Something else happened.", french),
    ).toBeNull();
  });

  it("keeps a line of data only, untouched", () => {
    expect(localisedAnswer("USD 1.5m", new Map())).toBe("USD 1.5m");
  });
});

describe("lists of names keep the language's own joining word", () => {
  it("lifts each name, leaving 'and' to be translated", () => {
    expect(
      skeletonOf(
        "Here are three: Zino Aviation, Atlas Health and Kilima Angel Network.",
      ).skeleton,
    ).toBe("Here are three: {v1}, {v2} and {v3}.");
  });

  it("never runs a name into the next sentence", () => {
    expect(
      answerSkeletons(
        "It fits AlRayan Investment LLC. Rimal Freight raised 2m.",
      ),
    ).toEqual(["It fits {v1}.", "{v1} raised {v2}."]);
  });
});
