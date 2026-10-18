import { describe, expect, it } from "vitest";

import type { QAnswerCard, QResultBlock } from "@capital-q/contracts";

import {
  BANNED_SPOKEN_PHRASES,
  movePhaseLine,
  naturalPlaceLine,
  pendingPlaceOf,
  spokenFactsOf,
  spokenFidelityIssues,
} from "../src/index.js";
import { C10B_CARDS, C10B_FIT_BLOCKS } from "./fixtures/voice-c10b845f.js";

/**
 * Typed answers that code builds (fit sweeps, a record opened, a page
 * moved to) come from the same facts as the spoken ones (founder live
 * 2026-10-08: "Tell me about the third company on the list." came back as
 * `Opening "Tensorgate".`, and "Q still sounds like a robot").
 */

const TENSORGATE: QAnswerCard = {
  ...(C10B_CARDS[2] as QAnswerCard),
  about: "Runtime security for AI agents in regulated banks.",
  raise: "$2 million",
  subject: {
    kind: "COMPANY",
    companyId: "00000000-0000-4000-8000-000000000003",
  },
};

const OPENED: readonly QResultBlock[] = [
  {
    kind: "UI_INTENT",
    intent: {
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY",
      id: "00000000-0000-4000-8000-000000000003",
    },
  },
];

function noTemplates(text: string): void {
  for (const pattern of BANNED_SPOKEN_PHRASES)
    expect(text).not.toMatch(pattern);
  expect(text).not.toMatch(/Opening "|Taking you|fits best, at|Pros and cons/u);
}

describe("typed: tell me about the third company on the list", () => {
  it("describes them from the card -- what they do, stage, raise, fit and why, one unknown -- and opens the page", () => {
    const facts = spokenFactsOf({
      asked: "Tell me about the third company on the list.",
      // Natural words already: the card is found by the opened id.
      text: "",
      blocks: OPENED,
      shown: [TENSORGATE],
    });
    expect(facts?.kind).toBe("RECORD");
    const text = facts?.fallback ?? "";
    expect(text).toMatch(/^Tensorgate, /u);
    expect(text).toContain("Runtime security for AI agents in regulated banks");
    expect(text).toContain("seed-stage company in the United States");
    expect(text).toContain("raising $2 million");
    expect(text).toMatch(/8\.8 on your mandate: stage and sector line up/u);
    expect(text).toMatch(/cheque size isn't known yet/u);
    expect(text).toMatch(/page|pulled them up/u);
    noTemplates(text);
    if (facts !== null) expect(spokenFidelityIssues(text, facts)).toEqual([]);
  });

  it("without a raise or a line it says only what is known", () => {
    const bare: QAnswerCard = { ...TENSORGATE, about: null, raise: null };
    const text =
      spokenFactsOf({
        asked: "tell me about the third one",
        text: "",
        blocks: OPENED,
        shown: [bare],
      })?.fallback ?? "";
    expect(text).not.toMatch(/raising|In a line|What they do/u);
    expect(text).toMatch(/8\.8/u);
  });
});

describe("typed: ties are said as ties", () => {
  it("names the three asked for as level, never 'best… then'", () => {
    const facts = spokenFactsOf({
      asked:
        "Show me the top three companies that are aligned against the mandate.",
      text: "",
      blocks: C10B_FIT_BLOCKS,
    });
    const text = facts?.fallback ?? "";
    expect(text).toMatch(
      /Halyard Security, Clearwater Assurance and Tensorgate, (?:all level|tied|all on the same score) at 8\.8/u,
    );
    expect(text).not.toMatch(/Shiftwell/u);
    noTemplates(text);
  });
});

describe("typed: page moves", () => {
  it("never says 'Taking you to', and never claims arrival before the browser verifies (R3)", () => {
    const said = new Set(
      [
        "take me to the explore page",
        "go to discover",
        "open discover please",
        "show me discover",
        "discover",
        "can we look at discover",
      ].map((asked) => naturalPlaceLine("Taking you to Discover.", asked)),
    );
    // One pending line: "opened" is the VERIFIED receipt's to say.
    expect([...said]).toEqual(["Opening Discover…"]);
    expect(naturalPlaceLine("Taking you home now.", "home")).toBe(
      "Heading home…",
    );
    expect(naturalPlaceLine("Opening your profile.", "my profile")).toMatch(
      /your profile|Your profile/u,
    );
    // Not a page line: left as it is.
    expect(naturalPlaceLine('Opening "Tensorgate".', "x")).toBe(
      'Opening "Tensorgate".',
    );
  });

  it("a natural page line still gives the voice its facts", () => {
    const facts = spokenFactsOf({
      asked: "go to discover",
      text: naturalPlaceLine("Taking you to Discover.", "go to discover"),
      blocks: [
        {
          kind: "UI_INTENT",
          intent: { kind: "NAVIGATE", destination: "DISCOVER" },
        },
      ],
    });
    expect(facts?.kind).toBe("NAVIGATE");
    expect(facts?.mustSay).toEqual(["Discover"]);
  });
});

describe("R3: one source for what Q says about a move, by lifecycle phase", () => {
  it("pending, then confirmed only on VERIFIED, plainly on FAILED", () => {
    expect(movePhaseLine("PENDING", "Capital")).toBe("Opening Capital…");
    expect(movePhaseLine("VERIFIED", "Capital")).toBe("Opened Capital.");
    expect(movePhaseLine("FAILED", "your relationships")).toBe(
      "Your relationships didn't open.",
    );
    expect(movePhaseLine("PENDING", "home")).toBe("Heading home…");
    expect(movePhaseLine("VERIFIED", "home")).toBe("You're home.");
    expect(movePhaseLine("ASKED", "Capital")).toBe("Asked to open Capital.");
  });

  it("reads the place back from a pending line, and nothing else", () => {
    expect(
      pendingPlaceOf("Opening Tensorgate… Want me to run through them?"),
    ).toBe("Tensorgate");
    expect(pendingPlaceOf("Heading home…")).toBe("home");
    expect(pendingPlaceOf("Here's Capital.")).toBeNull();
    expect(pendingPlaceOf('Opening "Tensorgate".')).toBeNull();
  });

  it("no record or page line Q composes claims arrival", () => {
    for (const asked of ["open tensorgate", "take me to capital", "x", "y"]) {
      const line = naturalPlaceLine("Taking you to Capital.", asked);
      expect(line).not.toMatch(
        /\b(?:Here's|Up now|Over to|is up|opened|pulled them up)\b/iu,
      );
    }
  });
});
