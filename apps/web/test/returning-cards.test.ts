import { describe, expect, it } from "vitest";

import {
  arrivalFor,
  chooseReturningCards,
  firstName,
  MAX_RETURNING_CARDS,
  returningGreeting,
  type ReturningCard,
  type ReturningFacts,
} from "../src/features/home/returning";

/**
 * The returning person (CQ-WEB-030): who is back, what Q says, and which
 * cards it offers, as a pure function of what Capital Q knows.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const INVESTOR_ORG = "22222222-2222-4222-8222-222222222222";
const ARTIFACT = "33333333-3333-4333-8333-333333333333";

const founder: ReturningFacts = {
  context: { kind: "FOUNDER", companyId: COMPANY, label: "Northbank" },
  unfinished: null,
  name: "Ada Lovelace",
  feed: "UNKNOWN",
  pitch: "YES",
  deck: { kind: "NONE" },
};

const investor: ReturningFacts = {
  context: {
    kind: "INVESTOR",
    investorOrganisationId: INVESTOR_ORG,
    label: "Harbour Capital",
  },
  unfinished: null,
  name: "Grace Hopper",
  feed: "YES",
  pitch: "UNKNOWN",
  deck: { kind: "UNKNOWN" },
};

const ids = (cards: readonly ReturningCard[]) => cards.map((card) => card.id);
const card = (cards: readonly ReturningCard[], id: string) =>
  cards.find((candidate) => candidate.id === id);

describe("arrivalFor: first time or back", () => {
  it("a person with a company or an investor organisation is back", () => {
    expect(arrivalFor(founder.context, null)).toBe("RETURNING");
    expect(arrivalFor(investor.context, null)).toBe("RETURNING");
  });

  it("a setup left part-way is back, before it names a company", () => {
    expect(arrivalFor({ kind: "NONE" }, "founder")).toBe("RETURNING");
    expect(arrivalFor({ kind: "NONE" }, "investor")).toBe("RETURNING");
  });

  it("a person Capital Q knows nothing about is new, and keeps the first-run welcome", () => {
    expect(arrivalFor({ kind: "NONE" }, null)).toBe("FIRST_TIME");
  });

  it("when Capital Q could not be asked, it is not known which", () => {
    expect(arrivalFor({ kind: "NONE", unavailable: true }, null)).toBe(
      "UNKNOWN",
    );
  });
});

describe("the greeting", () => {
  it("welcomes them back by first name", () => {
    expect(returningGreeting(founder).headline).toBe("Welcome back, Ada.");
    expect(firstName("  Grace   Brewster Hopper ")).toBe("Grace");
  });

  it("without a name, says nothing it does not know", () => {
    expect(returningGreeting({ ...founder, name: null }).headline).toBe(
      "Welcome back.",
    );
    expect(returningGreeting({ ...founder, name: "   " }).headline).toBe(
      "Welcome back.",
    );
  });

  it("asks about the unfinished setup first", () => {
    expect(
      returningGreeting({ ...investor, unfinished: "investor" }).question,
    ).toMatch(/mandate is part-way through/);
    expect(
      returningGreeting({ ...founder, unfinished: "founder" }).question,
    ).toMatch(/setup is part-way through/);
  });

  it("says where an unfinished setup left off, from its own state", () => {
    const greeting = returningGreeting({
      ...investor,
      unfinished: "investor",
      setup: {
        covered: ["Mandate", "Stage"],
        pending: "What's a typical cheque for you? Just the number is fine.",
      },
    });
    expect(greeting.question).toMatch(/covered mandate and stage/);
    // Q's own last question, verbatim, never paraphrased into the greeting.
    expect(greeting.leftOff).toBe(
      "What's a typical cheque for you? Just the number is fine.",
    );
    expect(greeting.question).not.toContain("typical cheque");
  });

  it("claims nothing about progress it was not given", () => {
    const greeting = returningGreeting({ ...investor, unfinished: "investor" });
    expect(greeting.question).not.toMatch(/covered/);
    expect(greeting.leftOff).toBeNull();
  });

  it("a completed setup has no left-off line, even if one was read", () => {
    expect(
      returningGreeting({
        ...investor,
        setup: { covered: ["Mandate"], pending: "Anything else?" },
      }).leftOff,
    ).toBeNull();
  });

  it("is one welcome, said the same way aloud", () => {
    const greeting = returningGreeting(investor);
    expect(greeting.spoken).toBe(`${greeting.headline} ${greeting.question}`);
    expect(greeting.spoken.match(/welcome back/gi)).toHaveLength(1);
  });

  it("a completed investor with nothing matching hears that, not a generic question", () => {
    expect(returningGreeting({ ...investor, feed: "NO" }).question).toMatch(
      /nothing on Capital Q matches it yet/,
    );
  });

  it("mentions the feed only when it has something in it", () => {
    expect(returningGreeting(investor).question).toMatch(/in your feed/);
    for (const feed of ["NO", "UNKNOWN"] as const) {
      expect(returningGreeting({ ...investor, feed }).question).not.toMatch(
        /feed/,
      );
    }
  });

  it("mentions the pitch only when it is known to be missing", () => {
    expect(returningGreeting({ ...founder, pitch: "NO" }).question).toMatch(
      /record yours/,
    );
    expect(
      returningGreeting({ ...founder, pitch: "UNKNOWN" }).question,
    ).not.toMatch(/pitch/);
  });
});

describe("chooseReturningCards", () => {
  it("an investor: the feed, the mandate, and who can see them", () => {
    const cards = chooseReturningCards(investor);
    expect(ids(cards)).toEqual(["feed", "mandate", "visibility"]);
    expect(card(cards, "visibility")?.action).toEqual({
      kind: "NAVIGATE",
      href: "/company/visibility",
    });
    expect(card(cards, "feed")?.action).toEqual({
      kind: "NAVIGATE",
      href: "/discover",
    });
    expect(card(cards, "mandate")?.action).toEqual({
      kind: "ASK_Q",
      prompt: "What is my mandate?",
    });
  });

  it("an empty feed is described as empty, an unknown one claims nothing", () => {
    expect(
      card(chooseReturningCards({ ...investor, feed: "NO" }), "feed")
        ?.description,
    ).toMatch(/Nothing matches/);
    expect(
      card(chooseReturningCards({ ...investor, feed: "UNKNOWN" }), "feed")
        ?.description,
    ).not.toMatch(/Nothing|reasons/);
  });

  it("an unfinished mandate comes first", () => {
    const cards = chooseReturningCards({ ...investor, unfinished: "investor" });
    expect(ids(cards)).toEqual([
      "continue-setup",
      "talk-setup",
      "feed",
      "mandate",
    ]);
    // Both tell the setup screen Q has already welcomed them here, so it
    // goes to the question rather than welcoming them a second time.
    expect(cards[0]?.action).toEqual({
      kind: "NAVIGATE",
      href: "/onboarding/investor?from=home",
    });
    expect(cards[1]?.action).toEqual({
      kind: "NAVIGATE",
      href: "/onboarding/investor?talk=1",
    });
  });

  it("a founder: company, pitch, deck and investors", () => {
    const cards = chooseReturningCards(founder);
    expect(ids(cards)).toEqual(["company", "pitch", "deck", "investors"]);
    expect(card(cards, "company")?.action).toEqual({
      kind: "NAVIGATE",
      href: `/company/${COMPANY}`,
    });
    expect(card(cards, "pitch")).toMatchObject({
      title: "Your pitch video",
      action: { kind: "NAVIGATE", href: "/pitch" },
    });
  });

  it("no pitch on record: the card offers to record one", () => {
    expect(
      card(chooseReturningCards({ ...founder, pitch: "NO" }), "pitch")?.title,
    ).toBe("Record your pitch");
  });

  it("no deck anywhere: asks Q to draft one, through Q", () => {
    expect(card(chooseReturningCards(founder), "deck")).toMatchObject({
      title: "Create your investor deck",
      action: {
        kind: "ASK_Q",
        prompt: "Create an investor deck for my company.",
      },
    });
  });

  it("an uploaded deck is something to ask Q about", () => {
    const deck = card(
      chooseReturningCards({ ...founder, deck: { kind: "UPLOADED" } }),
      "deck",
    );
    expect(deck?.title).toBe("Your deck");
    expect(deck?.action.kind).toBe("ASK_Q");
  });

  it("a deck Q prepared opens beside the conversation, not as a page", () => {
    const deck = card(
      chooseReturningCards({
        ...founder,
        deck: { kind: "PREPARED", artifactId: ARTIFACT },
      }),
      "deck",
    );
    expect(deck).toMatchObject({
      title: "Your investor deck",
      action: { kind: "OPEN_ARTIFACT", artifactId: ARTIFACT },
    });
  });

  it("when it is not known whether a deck exists, no deck card claims either", () => {
    const cards = chooseReturningCards({
      ...founder,
      deck: { kind: "UNKNOWN" },
    });
    expect(card(cards, "deck")).toBeUndefined();
  });

  it("never more than four, with an unfinished setup kept first", () => {
    const cards = chooseReturningCards({ ...founder, unfinished: "founder" });
    expect(cards).toHaveLength(MAX_RETURNING_CARDS);
    expect(ids(cards)).toEqual([
      "continue-setup",
      "talk-setup",
      "company",
      "pitch",
    ]);
    expect(cards[0]?.action).toEqual({
      kind: "NAVIGATE",
      href: "/onboarding/founder?from=home",
    });
  });

  it("part-way through, before a company exists: continue, or ask Q", () => {
    const cards = chooseReturningCards({
      ...founder,
      context: { kind: "NONE" },
      unfinished: "founder",
      pitch: "UNKNOWN",
      deck: { kind: "UNKNOWN" },
    });
    expect(ids(cards)).toEqual(["continue-setup", "talk-setup", "ask"]);
  });

  it("a first-time person gets no cards: they are choosing a side", () => {
    expect(
      chooseReturningCards({
        ...founder,
        context: { kind: "NONE" },
        unfinished: null,
      }),
    ).toEqual([]);
  });

  it("every card is a real route or a real question -- never an empty action", () => {
    const everyShape: ReturningFacts[] = [
      founder,
      investor,
      { ...founder, unfinished: "founder", pitch: "NO" },
      { ...investor, unfinished: "investor", feed: "NO" },
      { ...founder, deck: { kind: "PREPARED", artifactId: ARTIFACT } },
    ];
    for (const facts of everyShape) {
      for (const each of chooseReturningCards(facts)) {
        if (each.action.kind === "NAVIGATE") {
          expect(each.action.href).toMatch(/^\/[a-z]/);
        } else if (each.action.kind === "ASK_Q") {
          expect(each.action.prompt.trim().length).toBeGreaterThan(0);
        } else {
          expect(each.action.artifactId).toBe(ARTIFACT);
        }
      }
    }
  });
});
