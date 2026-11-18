import { describe, expect, it } from "vitest";

import {
  commitmentLevelOf,
  itemParts,
  meetingDigestOf,
  readMeetingOutcomes,
  spokenFigure,
} from "../src/index.js";

/**
 * S5 (meetings design R7, owner 2026-11-18): commitments read after the
 * call, balanced -- not so strict that a clear commitment is missed, not
 * so loose that "we might" becomes one. Amount, currency, share and
 * condition stay apart; unknown stays unknown.
 */
describe("the commitment level a line's words commit to", () => {
  it("reads an unhedged first-person figure as HARD", () => {
    expect(commitmentLevelOf("We will put in $500k.")).toBe("HARD");
    expect(
      commitmentLevelOf("We're in for two hundred thousand dollars."),
    ).toBe("HARD");
    expect(commitmentLevelOf("I commit 50,000 euros to the round.")).toBe(
      "HARD",
    );
  });

  it("keeps any hedge SOFT, and any first-person figure at least SOFT", () => {
    expect(
      commitmentLevelOf("We'd probably come in around $300k if the IC agrees."),
    ).toBe("SOFT");
    expect(commitmentLevelOf("We might invest 100k.")).toBe("SOFT");
    expect(commitmentLevelOf("We invest 250k in rounds like this.")).toBe(
      "SOFT",
    );
    expect(commitmentLevelOf("We could take half the round.")).toBe("SOFT");
  });

  it("reads interest without money, a question, a refusal or the other side as nothing", () => {
    expect(commitmentLevelOf("We might invest.")).toBeNull();
    expect(commitmentLevelOf("Would you put in 200k?")).toBeNull();
    expect(
      commitmentLevelOf("We won't invest 200k at this valuation."),
    ).toBeNull();
    expect(
      commitmentLevelOf("Our revenue is 42,000 dollars a month."),
    ).toBeNull();
    expect(commitmentLevelOf("They will put in a million.")).toBeNull();
  });
});

describe("a spoken figure", () => {
  it("reads words and digits exactly, with a currency only when said", () => {
    expect(spokenFigure("around two hundred and fifty thousand")).toEqual({
      amount: "250000",
      currencyCode: null,
    });
    expect(spokenFigure("$1.5m")).toEqual({
      amount: "1500000",
      currencyCode: "USD",
    });
    expect(spokenFigure("250k naira")).toEqual({
      amount: "250000",
      currencyCode: "NGN",
    });
    // Two different figures: unknown, never the favourable one.
    expect(spokenFigure("between 200k and 300k").amount).toBeNull();
  });
});

describe("the post-call reading", () => {
  const parties = [
    { name: "Ada Obi", side: "FOUNDER" as const, userId: "u-founder" },
    { name: "Tunde Ola", side: "INVESTOR" as const, userId: "u-investor" },
  ];
  const lines = [
    {
      speaker: "Tunde Ola",
      text: "Can you send me the data room link by Monday?",
      at: 10,
    },
    { speaker: "Ada Obi", text: "Sure, will do.", at: 14 },
    {
      speaker: "Ada Obi",
      text: "Could you introduce us to your portfolio CFO?",
      at: 30,
    },
    { speaker: "Tunde Ola", text: "We will put in $400k.", at: 45 },
    { speaker: "Q", text: "I'll note that.", at: 46 },
  ];

  it("ties each item to its line, speaker and side, and keeps who asked whom", () => {
    const o = readMeetingOutcomes({ meetingId: "m-1", lines, parties });
    expect(
      o.requests.map((r) => [r.askerSide, r.askedSide, r.diligence, r.item]),
    ).toEqual([
      ["INVESTOR", "FOUNDER", true, "the data room link"],
      [
        "FOUNDER",
        "INVESTOR",
        false,
        "Could you introduce us to your portfolio CFO",
      ],
    ]);
    expect(o.requests[0]?.accepted?.speakerUserId).toBe("u-founder");
    expect(o.promises[0]).toMatchObject({
      ownerUserId: "u-founder",
      dueText: "monday",
      refersToRequest: o.requests[0]?.id,
    });
    expect(o.commitments).toHaveLength(1);
    expect(o.commitments[0]).toMatchObject({
      level: "HARD",
      amount: "400000",
      currencyCode: "USD",
      truthClass: "Q_INFERENCE",
      evidenceStatus: "SELF_REPORTED",
    });
    expect(o.commitments[0]?.evidence).toMatchObject({
      line: 3,
      at: 45,
      side: "INVESTOR",
    });
  });

  it("drops a model signal no line says, and never lets a model harden a hedge", () => {
    const o = readMeetingOutcomes({
      meetingId: "m-2",
      lines: [
        {
          speaker: "Tunde Ola",
          text: "We'd look at roughly 150k if the numbers hold.",
        },
      ],
      parties,
      noted: [
        {
          party: "Tunde Ola",
          amount: "$150k",
          firmness: "FIRM",
          quote: "We'd look at roughly 150k",
        },
        {
          party: "Tunde Ola",
          amount: "$2m",
          firmness: "FIRM",
          quote: "two million is committed",
        },
      ],
    });
    expect(o.ungrounded).toBe(1);
    expect(
      o.commitments.map((c) => [
        c.level,
        c.amount,
        c.currencyCode,
        c.readBy,
        c.condition,
      ]),
    ).toEqual([["SOFT", "150000", null, "MODEL", "if the numbers hold"]]);
  });

  it("never reads a founder's figure about the company as a commitment", () => {
    const o = readMeetingOutcomes({
      meetingId: "m-3",
      lines: [
        { speaker: "Ada Obi", text: "We will come in at 50k MRR next month." },
      ],
      parties,
      noted: [
        {
          party: "Ada Obi",
          amount: "50k",
          firmness: "FIRM",
          quote: "We will come in at 50k MRR",
        },
      ],
    });
    expect(o.commitments).toEqual([]);
  });

  it("keeps the digest to counts and figures", () => {
    const o = readMeetingOutcomes({ meetingId: "m-1", lines, parties });
    const digest = meetingDigestOf({
      meetingId: "m-1",
      relationshipId: "r-1",
      startsAt: new Date("2026-11-20T10:00:00Z"),
      outcomes: o,
      lineTimes: lines.map((l) => l.at),
      nextStep: "Ada sends the data room link",
    });
    expect(digest).toMatchObject({
      durationSeconds: 46,
      softSignals: 0,
      hardSignals: 1,
      requests: 2,
    });
    expect(JSON.stringify(digest)).not.toContain("We will put in");
  });

  it("splits an item into the documents it names", () => {
    expect(itemParts("the cohort retention data and the cap table")).toEqual([
      "the cohort retention data",
      "the cap table",
    ]);
  });
});
