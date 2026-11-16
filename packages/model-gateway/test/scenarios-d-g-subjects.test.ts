import { describe, expect, it } from "vitest";

import { claimCorpus, checkSentence } from "../src/q/claim-check.js";
import { withReadableSourceCounts } from "../src/q/fit-cards.js";
import { companyNameCandidates } from "../src/q/named-company-fact.js";
import { companiesNamedIn } from "../src/q/named-companies.js";
import {
  readableListed,
  type ListedDocument,
} from "../src/q/shared-documents.js";

/**
 * Replays of scenarios D4 and E (live 2026-11-16 on bab915357, runs
 * 7cef5d87 and 06de74f3), with unseen paraphrases.
 */

const SAVANNA_OWN = [
  "Basketari",
  "Brancheon Works",
  "Brightkloof Energy",
  "Harbourline Cargo",
  "Kivu Traceworks",
  "Laterra Bricks",
  "Ledgerfold",
  "Mizan",
  "Portside",
  "Rankpay",
  "Sahel Pumps",
  "Shambasense",
  "Silo Credit",
  "Tensorgate",
  "Umoja Cover",
  "Watchly",
].map((name, index) => ({ companyId: `c${String(index)}`, name }));

describe("a company named with the request's verb is still that company (E, 06de74f3)", () => {
  it("the live ask: Halyard Security, not 'Put Halyard Security'", () => {
    expect(
      companyNameCandidates(
        "Put Halyard Security, Tensorgate and Nixo side by side for me: how strong is each business on the evidence, and separately how well does each fit our mandate?",
        4,
        [],
      ),
    ).toEqual(["Halyard Security", "Tensorgate", "Nixo"]);
  });

  it.each([
    [
      "Line up Halyard Security, Tensorgate and Nixo",
      ["Halyard Security", "Tensorgate", "Nixo"],
    ],
    ["Compare Halyard Security with Nixo", ["Halyard Security", "Nixo"]],
    [
      "Rank Halyard Security and Nixo against our mandate.",
      ["Halyard Security", "Nixo"],
    ],
    [
      "Thanks. Stack Halyard Security against Tensorgate",
      ["Halyard Security", "Tensorgate"],
    ],
  ])("%s", (said, names) => {
    expect(companyNameCandidates(said, 4, [])).toEqual(names);
  });

  it("strips a word the reader heard the name without, and keeps a name heard whole", () => {
    expect(
      companyNameCandidates("Square Halyard Security up with Nixo", 4, [
        "Halyard Security",
        "Nixo",
      ]),
    ).toEqual(["Halyard Security", "Nixo"]);
    expect(
      companyNameCandidates("Match Group is raising?", 2, ["Match Group"]),
    ).toEqual(["Match Group"]);
  });
});

describe("their own companies are not read from Q's own words by a near match (D4, 7cef5d87)", () => {
  const greeting =
    "Welcome back, Amara. One thing needs you. 2 things wait for your approval. You're connected with Watchly. 8 pitches that match your mandate. There are companies in your feed, ranked against your mandate. Where would you like to start?";

  it("'ranked against' is not Rankpay when Q's text is matched exactly", () => {
    expect(
      companiesNamedIn(greeting, SAVANNA_OWN).map((one) => one.name),
    ).toContain("Rankpay");
    expect(
      companiesNamedIn(greeting, SAVANNA_OWN, 5, "EXACT").map(
        (one) => one.name,
      ),
    ).toEqual(["Watchly"]);
  });

  it("the person's own words still match as speech bends them", () => {
    expect(
      companiesNamedIn("how is tensor gate doing", SAVANNA_OWN).map(
        (one) => one.name,
      ),
    ).toEqual(["Tensorgate"]);
  });
});

describe("a comparison does not contradict itself (E, 06de74f3)", () => {
  it("never says the records hold no ARR when they hold one", () => {
    const corpus = claimCorpus(
      [
        "[F1] Tensorgate (company-stated): contracted ARR USD 360,000 at 30 Sep 2026.",
      ],
      new Date("2026-11-16T12:00:00Z"),
    );
    expect(
      checkSentence("Tensorgate has USD 360,000 of contracted ARR.", corpus)
        .text,
    ).toBe("Tensorgate has USD 360,000 of contracted ARR.");
    const ungrounded = checkSentence("Halyard's ARR is USD 852,000.", corpus);
    expect(ungrounded.text).toBeNull();
    // With nothing about ARR in the records, the honest unknown stands.
    expect(
      checkSentence(
        "Halyard's ARR is USD 852,000.",
        claimCorpus(["[F1] Halyard is a seed company."], new Date()),
      ).text,
    ).toBe(
      "Neither Capital Q's records nor the sources I read give a figure for ARR yet.",
    );
  });

  it("a card counts the documents shared with the asking investor", () => {
    const listed: ListedDocument[] = [
      ...Array.from({ length: 8 }, (_, index) => ({
        documentId: `00000000-0000-4000-8000-00000000000${String(index)}`,
        title: `Tensorgate document ${String(index)}`,
        folder: "Financials",
        access: index === 0 ? ("OPEN" as const) : ("SHARED" as const),
      })),
      {
        documentId: "00000000-0000-4000-8000-000000000009",
        title: "Bank statement",
        folder: "Financials",
        access: "REQUESTED" as const,
      },
    ];
    const tensorgate = "bf55d6e1-567a-470b-954d-054ae05990e2";
    const block = withReadableSourceCounts(
      {
        kind: "ANSWER_CARDS",
        shape: "RANKED",
        title: "Side by side",
        followUps: [],
        cards: [
          {
            key: "tensorgate",
            name: "Tensorgate",
            line: "Seed",
            hue: 1,
            fit: { score: 8, measured: 4, of: 6 },
            reasons: [],
            measures: [],
            sourceCount: 0,
            subject: { kind: "COMPANY", companyId: tensorgate.toUpperCase() },
          },
          {
            key: "nixo",
            name: "Nixo",
            line: "Seed",
            hue: 2,
            fit: { score: 7.5, measured: 3, of: 6 },
            reasons: [],
            measures: [],
            sourceCount: 0,
            subject: {
              kind: "COMPANY",
              companyId: "d48c26d2-5aca-4788-9033-073b0f9d08ec",
            },
          },
        ],
      } as never,
      new Map([[tensorgate, readableListed(listed).length]]),
    );
    expect(block.cards.map((card) => card.sourceCount)).toEqual([8, 0]);
  });
});
