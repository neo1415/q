import { describe, expect, it } from "vitest";

import {
  factsForVoice,
  requestedCount,
  SPOKEN_RANKED_MAX,
  spokenCount,
  spokenFactsOf,
  spokenFidelityIssues,
  type SpokenFacts,
} from "../src/index.js";
import { ZINO_ASKED, ZINO_RANKED_BLOCK } from "./fixtures/voice-9995dcca.js";
import {
  C10B_CARDS,
  C10B_FIT_BLOCKS,
  C10B_NAVIGATE_BLOCKS,
  C10B_OPEN_BLOCKS,
  C10B_TURNS,
} from "./fixtures/voice-c10b845f.js";

/**
 * Eval: founder live 2026-10-08 (c10b845f), replayed. Deterministic: the
 * invariants are code's to check, never a model's to judge.
 */

function topThree(): SpokenFacts {
  const facts = spokenFactsOf({
    asked: C10B_TURNS.topThree.asked,
    text: C10B_TURNS.topThree.said,
    blocks: C10B_FIT_BLOCKS,
  });
  if (facts === null) throw new Error("no facts for the fit sweep");
  return facts;
}

function third(): SpokenFacts {
  const facts = spokenFactsOf({
    asked: C10B_TURNS.third.asked,
    text: C10B_TURNS.third.said,
    blocks: C10B_OPEN_BLOCKS,
    shown: C10B_CARDS,
  });
  if (facts === null) throw new Error("no facts for the opened record");
  return facts;
}

describe("how many they asked for", () => {
  it.each([
    ["Show me the top three companies aligned against the mandate.", 3],
    ["top 5 please", 5],
    ["give me two companies", 2],
    ["which one is the best fit?", 1],
    ["what are my three strongest", 3],
    ["how do my companies fit my mandate?", null],
  ])("%s → %s", (asked, n) => {
    expect(requestedCount(asked)).toBe(n);
  });
});

describe("c10b845f turn 1: top three against the mandate", () => {
  it("names exactly the three asked for, with the tie and the four others level", () => {
    const facts = topThree();
    expect(facts.kind).toBe("RANKED");
    expect(facts.requested).toBe(3);
    expect(facts.items.map((item) => item.name)).toEqual([
      "Halyard Security",
      "Clearwater Assurance",
      "Tensorgate",
    ]);
    expect(facts.ties).toEqual([
      ["Halyard Security", "Clearwater Assurance", "Tensorgate"],
    ]);
    expect(facts.alsoLevel).toBe(4);
    expect(facts.mustSay).toEqual([
      "Halyard Security",
      "Clearwater Assurance",
      "Tensorgate",
      "8.8",
    ]);
    expect(facts.caveat).toBe("Cheque size isn't known for any of them yet.");
  });

  it("fails what Q actually said on every count the founder heard", () => {
    const issues = spokenFidelityIssues(C10B_TURNS.topThree.said, topThree());
    expect(issues).toEqual(
      expect.arrayContaining(["COUNT", "MUST_SAY", "TIE", "BANNED"]),
    );
  });

  it("passes its own fact-built fallback", () => {
    const facts = topThree();
    expect(spokenFidelityIssues(facts.fallback, facts)).toEqual([]);
    expect(facts.fallback).toMatch(
      /Halyard Security, Clearwater Assurance and Tensorgate/u,
    );
    expect(facts.fallback).not.toMatch(/fits best|out of 10|on screen\.$/u);
  });

  it("passes a natural line in the voice's own words", () => {
    const said =
      "So, your top three: Halyard, Clearwater and Tensorgate, all level at 8.8, and four others are right there with them. Cheque size isn't known for any yet. Want me to go through one?";
    expect(spokenFidelityIssues(said, topThree())).toEqual([]);
  });

  it("catches a tie said as a ranking, a fourth name, an invented number and length", () => {
    const facts = topThree();
    expect(
      spokenFidelityIssues(
        "Halyard Security fits best at 8.8, then Clearwater Assurance and Tensorgate.",
        facts,
      ),
    ).toContain("TIE");
    expect(
      spokenFidelityIssues(
        "Halyard Security, Clearwater Assurance, Tensorgate and Shiftwell are level at 8.8.",
        facts,
      ),
    ).toContain("COUNT");
    expect(
      spokenFidelityIssues(
        "Halyard Security, Clearwater Assurance and Tensorgate are level at 8.8, with 92% retention.",
        facts,
      ),
    ).toContain("NUMBER");
    expect(
      spokenFidelityIssues(
        `Halyard Security, Clearwater Assurance and Tensorgate are level at 8.8. ${"And there is more to say. ".repeat(12)}`,
        facts,
      ),
    ).toContain("LENGTH");
  });
});

describe("c10b845f turn 2: tell me about the third company", () => {
  it("talks about Tensorgate from its card instead of only opening it", () => {
    const facts = third();
    expect(facts.kind).toBe("RECORD");
    expect(facts.talkAbout).toBe(true);
    expect(facts.mustSay).toEqual(["Tensorgate", "8.8"]);
    expect(facts.items[0]?.about).toBe(
      "a seed-stage company in the United States",
    );
    expect(spokenFidelityIssues(C10B_TURNS.third.said, facts)).toEqual(
      expect.arrayContaining(["MUST_SAY", "BANNED"]),
    );
    expect(spokenFidelityIssues(facts.fallback, facts)).toEqual([]);
    expect(facts.fallback).toMatch(/^Tensorgate, /u);
    expect(facts.fallback).toMatch(/8\.8 on your mandate/u);
    expect(facts.fallback).toMatch(/cheque size isn't known yet/u);
  });

  it("still says something true when the card is not to hand", () => {
    const facts = spokenFactsOf({
      asked: C10B_TURNS.third.asked,
      text: C10B_TURNS.third.said,
      blocks: C10B_OPEN_BLOCKS,
    });
    expect(facts?.mustSay).toEqual(["Tensorgate"]);
    expect(
      facts === null ? [""] : spokenFidelityIssues(facts.fallback, facts),
    ).toEqual([]);
  });
});

describe("c10b845f turn 3: take me to the explore page", () => {
  it("never says 'Taking you to'", () => {
    const facts = spokenFactsOf({
      asked: C10B_TURNS.explore.asked,
      text: C10B_TURNS.explore.said,
      blocks: C10B_NAVIGATE_BLOCKS,
    });
    expect(facts?.kind).toBe("NAVIGATE");
    expect(facts?.mustSay).toEqual(["Discover"]);
    expect(
      facts === null
        ? []
        : spokenFidelityIssues(C10B_TURNS.explore.said, facts),
    ).toContain("BANNED");
    expect(
      facts === null ? [""] : spokenFidelityIssues(facts.fallback, facts),
    ).toEqual([]);
  });
});

describe("answers a model wrote", () => {
  it("are not turned into facts", () => {
    expect(
      spokenFactsOf({
        asked: "how is Portside doing?",
        text: "Portside grew revenue last quarter.",
        blocks: [],
      }),
    ).toBeNull();
  });
});

/**
 * Replay: owner live 17 Nov 2026 (Zino, conversation 9995dcca). "Find the
 * strongest companies…" names no number; the stored cards had a four-way
 * tie at 10, and the voice said three names "and one more". With no number
 * asked, a tie is never cut: all four are said, and nothing is left as an
 * unnamed "one more".
 */
describe("9995dcca: the strongest companies, a four-way tie at the top", () => {
  const facts = (blocks = [ZINO_RANKED_BLOCK]) => {
    const made = spokenFactsOf({ asked: ZINO_ASKED, text: "", blocks });
    if (made === null) throw new Error("no facts for the ranking");
    return made;
  };
  const withScores = (scores: readonly number[]) => ({
    ...ZINO_RANKED_BLOCK,
    cards: ZINO_RANKED_BLOCK.cards.map((card, at) => ({
      ...card,
      fit:
        card.fit === null
          ? null
          : { ...card.fit, score: scores[at] ?? card.fit.score },
    })),
  });

  it("says every company in the tie, and none level beyond it", () => {
    const said = facts();
    expect(said.requested).toBeNull();
    expect(said.items.map((item) => item.name)).toEqual([
      "Nixo",
      "Halyard Security",
      "Tensorgate",
      "Shiftwell",
    ]);
    expect(said.ties).toEqual([
      ["Nixo", "Halyard Security", "Tensorgate", "Shiftwell"],
    ]);
    expect(said.alsoLevel).toBe(0);
    expect(factsForVoice(said)).not.toHaveProperty("moreOnTheSameScore");
  });

  it("its own fallback names all four, never 'one more', and passes every check", () => {
    const said = facts();
    expect(said.fallback).not.toMatch(/\bone more\b|\bmore is\b/iu);
    for (const name of said.items.map((item) => item.name)) {
      expect(said.fallback).toContain(name);
    }
    expect(spokenFidelityIssues(said.fallback, said)).toEqual([]);
  });

  it("a tie running past the cap by one names that one too", () => {
    const said = facts([
      withScores([10, 10, 10, 10, 10, 10, 10, 9.4, 9.4, 8.8]),
    ]);
    expect(said.items).toHaveLength(SPOKEN_RANKED_MAX + 1);
    expect(said.alsoLevel).toBe(0);
  });

  it("a tie running further past the cap says the rest are on screen, never a count of unnamed ones", () => {
    const said = facts([withScores([10, 10, 10, 10, 10, 10, 10, 10, 10, 8.8])]);
    expect(said.items).toHaveLength(SPOKEN_RANKED_MAX);
    expect(said.alsoLevel).toBe(3);
    expect(said.fallback).toContain("The others on that score are on screen");
    expect(said.fallback).not.toMatch(/\b(?:one|two|three) more\b/iu);
    expect(spokenFidelityIssues(said.fallback, said)).toEqual([]);
  });

  it("no tie at the cut: the usual three", () => {
    const said = facts([
      withScores([10, 9.6, 9.5, 9.4, 9.4, 9, 8.8, 8.6, 8.2, 8]),
    ]);
    expect(said.items).toHaveLength(3);
    expect(said.alsoLevel).toBe(0);
  });

  it("a number they asked for is still exactly that many", () => {
    expect(spokenCount(ZINO_RANKED_BLOCK.cards, 2)).toBe(2);
    expect(spokenCount(ZINO_RANKED_BLOCK.cards, null)).toBe(4);
  });
});
