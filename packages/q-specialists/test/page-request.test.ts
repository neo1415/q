import { describe, expect, it } from "vitest";

import {
  Q_NAVIGATE_DESTINATIONS,
  type QAnswerCardsBlock,
} from "@capital-q/contracts";
import type { QConversationMessage } from "@capital-q/q-runtime";

import {
  cardAt,
  cardsOnScreen,
  ordinalOf,
  PAGE_NAMES,
  pageRequestOf,
  selfCorrected,
  takenBack,
  wordsNamePage,
  type PageTarget,
} from "../src/page-request.js";

/**
 * voice-cards: utterance -> page, for every page and tab. The web side's
 * destination -> route table is apps/web/test/destination-routes.test.ts;
 * together they are the utterance -> route table.
 */
const TABLE: readonly (readonly [string, string])[] = [
  // Zino, live 2026-10-08: Explore is never Discover.
  ["Take me to the explore page.", "EXPLORE"],
  ["take me to explore", "EXPLORE"],
  ["Open Explore", "EXPLORE"],
  ["go to the pitch grid", "EXPLORE"],
  ["Take me to Discover", "DISCOVER"],
  ["open my feed", "DISCOVER"],
  ["take me home", "HOME"],
  ["go to the home page", "HOME"],
  ["take me to the Q room", "HOME"],
  ["open my profile", "PROFILE"],
  ["take me to capital", "CAPITAL"],
  ["open my fundraising page", "CAPITAL"],
  ["take me to my relationships", "RELATIONSHIPS"],
  ["open the investment hub", "RELATIONSHIPS"],
  ["take me to my fundraising hub", "RELATIONSHIPS"],
  ["open relationship hub", "RELATIONSHIPS"],
  ["open the hub", "RELATIONSHIPS"],
  ["open my pipeline", "CRM_PIPELINE"],
  ["open Q Pitch", "Q_PITCH"],
  ["take me to the capital q tour", "Q_PITCH"],
  ["open my board", "BOARD"],
  ["Show me my fundraising pipeline.", "CRM_PIPELINE"],
  // QA 2026-10-24: "show my X" (no "me") is the same page request.
  ["Show my pipeline", "CRM_PIPELINE"],
  ["show our investors", "INVESTORS"],
  ["take me to my work board", "BOARD"],
  // Lane ov 2026-10-16: the CRM by its name and its tabs.
  ["open the CRM", "RELATIONSHIPS"],
  ["take me to the crm overview", "RELATIONSHIPS"],
  ["go to the pipeline in the CRM", "CRM_PIPELINE"],
  ["show me the CRM pipeline", "CRM_PIPELINE"],
  ["open the capital tab in the crm", "CAPITAL"],
  ["open settings", "SETTINGS"],
  ["go to verification", "VERIFICATION"],
  ["open Pitch & media", "PITCH"],
  ["take me to pitch and media", "PITCH"],
  ["open the investor interest page", "COMPANY_INTEREST"],
  ["show me my saved companies", "SAVED"],
  ["open passed", "PASSED"],
  ["take me to investors", "INVESTORS"],
  ["open search", "SEARCH"],
  ["take me to people search", "PEOPLE_SEARCH"],
  ["open GateQ", "GATEWAY"],
  ["take me to my gateway", "GATEWAY"],
  ["open the GateQ inbox", "GATEQ_INBOX"],
  ["open find on GateQ", "GATEQ_FIND"],
  ["open the claim tab on gateq", "GATEQ_CLAIM"],
  ["show me my applications", "GATEQ_APPLICATIONS"],
  ["open memory", "MEMORY"],
  ["open usage", "USAGE"],
  ["open a new pitch", "NEW_PITCH"],
  ["take me to rehearsals", "REHEARSALS"],
  ["open my documents", "DOCUMENTS"],
  ["open the brand kit", "DOCUMENTS"],
  ["open my data room", "OWN_DATA_ROOM"],
  ["take me to our data room", "OWN_DATA_ROOM"],
  ["open my pitch deck", "OWN_DECK"],
  ["show me my deck", "OWN_DECK"],
  ["open the Q Daily", "DAILY"],
  ["open The Q Daily", "DAILY"],
  ["take me to results", "RESULTS"],
  ["open your companies", "YOUR_COMPANIES"],
  ["take me to work", "WORK"],
  ["open the needs you tab", "WORK_NEEDS"],
  ["open in progress on work", "WORK_PROGRESS"],
  ["open the done tab on work", "WORK_DONE"],
  ["open the team tab on work", "WORK_TEAM"],
  ["open Q's team", "WORK_TEAM"],
  ["take me to the cost tab on work", "WORK_COST"],
  ["open compare", "SAVED_COMPARE"],
  ["take me to human review", "REVIEWS"],
  ["open my top investors", "TOP_INVESTORS"],
  // capital-tabs: Capital's own tabs
  ["open my action plan", "CAPITAL_ACTION_PLAN"],
  ["take me to the action plan tab on capital", "CAPITAL_ACTION_PLAN"],
  ["show me my readiness", "CAPITAL_READINESS"],
  ["open the readiness tab", "CAPITAL_READINESS"],
  ["show me what could stop my raise", "CAPITAL_READINESS"],
  ["open my rounds", "CAPITAL_RAISE"],
  ["take me to raise & rounds", "CAPITAL_RAISE"],
  ["show me my commitments", "CAPITAL_RAISE"],
  ["open my 12-month plan", "CAPITAL_PLAN"],
  ["open the readiness blueprint", "CAPITAL_PLAN"],
  ["open investors on capital", "CAPITAL_INVESTORS"],
  ["open the capital overview", "CAPITAL"],
  ["open my visibility settings", "COMPANY_VISIBILITY"],
  // Settings sections
  ["open billing", "settings:billing"],
  ["open my plan", "settings:plan"],
  ["take me to notifications", "settings:notifications"],
  ["open connected accounts", "settings:connections"],
  ["open the appearance section", "settings:appearance"],
  ["open privacy settings", "settings:privacy"],
  ["open account settings", "settings:account"],
  ["open team settings", "settings:team"],
];

function key(target: PageTarget): string {
  return target.kind === "SETTINGS"
    ? `settings:${target.section}`
    : target.destination;
}

describe("a page asked for by name (voice-cards)", () => {
  it.each(TABLE)("%s -> %s", (said, expected) => {
    const asked = pageRequestOf(said);
    expect(asked?.kind).toBe("PAGE");
    if (asked?.kind !== "PAGE") return;
    expect(key(asked.target)).toBe(expected);
  });

  it("names every page Q can open, and the table covers each", () => {
    const named = new Set(
      Object.values(PAGE_NAMES).flatMap((target) =>
        target.kind === "DESTINATION" ? [target.destination] : [],
      ),
    );
    const tested = new Set(TABLE.map(([, expected]) => expected));
    for (const destination of Q_NAVIGATE_DESTINATIONS) {
      expect(named, destination).toContain(destination);
      expect(tested, destination).toContain(destination);
    }
  });

  it("says it cannot open a page Capital Q does not have", () => {
    expect(pageRequestOf("take me to the queue page")).toEqual({
      kind: "UNKNOWN",
      named: "queue",
    });
    expect(pageRequestOf("open the leaderboard screen")?.kind).toBe("UNKNOWN");
  });

  it("leaves records, questions and everything else to the normal path", () => {
    for (const said of [
      "Show me the top three companies that are aligned against the mandate.",
      "open Tensorgate",
      "open my chat with Young Field Agro",
      "take me to the Tensorgate page",
      "open Tensorgate's data room",
      "show me the top three",
      "What's on the explore page?",
      "Q, I wasn't talking to you. Take me to Discover.",
      "tell me about Discover",
      "show my latest metrics",
      "show my pipeline by stage",
      "show them my deck",
    ]) {
      expect(pageRequestOf(said), said).toBeNull();
    }
  });
});

const cards = (names: readonly string[]): QAnswerCardsBlock => ({
  kind: "ANSWER_CARDS",
  shape: "RANKED",
  title: "Fit against your mandate",
  cards: names.map((name, at) => ({
    key: name.toLowerCase(),
    subject: {
      kind: "COMPANY" as const,
      companyId: `00000000-0000-4000-8000-00000000000${String(at + 1)}`,
    },
    name,
    line: null,
    hue: (at % 7) + 1,
    reasons: [],
    measures: [],
    fit: null,
    view: null,
    said: null,
    sourceCount: 0,
  })),
  followUps: [],
});

const message = (
  role: "USER" | "Q",
  blocks?: QConversationMessage["blocks"],
): QConversationMessage =>
  ({
    id: crypto.randomUUID(),
    tenantId: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    role,
    content: "x",
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
    ...(blocks === undefined ? {} : { blocks }),
  }) as unknown as QConversationMessage;

describe("the third company on the list (voice-cards)", () => {
  it("reads the position", () => {
    expect(ordinalOf("Tell me about the third company on the list.")).toBe(3);
    expect(ordinalOf("open the second one")).toBe(2);
    expect(ordinalOf("show me number five")).toBe(5);
    expect(ordinalOf("open the last company")).toBe(-1);
    expect(ordinalOf("take me to company number 2 on the screen")).toBe(2);
    expect(ordinalOf("what are the top three companies?")).toBeNull();
  });

  it("resolves against the newest cards on screen, not older ones", () => {
    const history = [
      message("Q", [cards(["Old A", "Old B", "Old C"])]),
      message("USER"),
      message("Q", [cards(["Haly", "Portside", "Tensorgate"])]),
      message("USER"),
      message("Q"),
    ];
    const block = cardsOnScreen(history);
    expect(block?.cards.map((card) => card.name)).toEqual([
      "Haly",
      "Portside",
      "Tensorgate",
    ]);
    if (block === null) return;
    expect(cardAt(block, 3)?.name).toBe("Tensorgate");
    expect(cardAt(block, -1)?.name).toBe("Tensorgate");
    expect(cardAt(block, 4)).toBeNull();
  });
});

describe("self-corrections (founder acceptance: 'Open Discover, no, actually Rehearsals')", () => {
  it("the answer path reads only the last page named", () => {
    expect(pageRequestOf("Open Discover, no, actually Rehearsals")).toEqual({
      kind: "PAGE",
      target: { kind: "DESTINATION", destination: "REHEARSALS" },
    });
    expect(selfCorrected("Open Discover... sorry, Rehearsals")).toBe(
      "Open Rehearsals",
    );
    expect(selfCorrected("Not Discover, Rehearsals")).toBe("Open Rehearsals");
    expect(selfCorrected("open discover")).toBe("open discover");
    expect(takenBack("Open Discover, no, actually Rehearsals")).toBe(false);
    expect(takenBack("open discover no wait")).toBe(true);
  });

  it("a model-read move is held to the last page named, never the first", () => {
    const said = "Open Discover, no, actually Rehearsals";
    const to = (destination: "DISCOVER" | "REHEARSALS") =>
      ({ kind: "DESTINATION", destination }) as const;
    expect(wordsNamePage(said, to("REHEARSALS"))).toBe(true);
    expect(wordsNamePage(said, to("DISCOVER"))).toBe(false);
    // A name that starts with "No" is not a correction.
    expect(selfCorrected("Take me to No Limits Capital")).toBe(
      "Take me to No Limits Capital",
    );
  });
});

describe("'no wait' turns a page request (live 2026-10-11)", () => {
  it("takes the last request after 'no wait' / 'wait'", () => {
    expect(selfCorrected("open discover... no wait, open rehearsals")).toBe(
      "open rehearsals",
    );
    expect(selfCorrected("go to capital, wait, take me to Q Daily")).toBe(
      "take me to Q Daily",
    );
  });
  it("a plain 'wait' with no new request is not a correction", () => {
    expect(selfCorrected("wait for them")).toBe("wait for them");
    expect(selfCorrected("open discover and wait there")).toBe(
      "open discover and wait there",
    );
  });
});

describe("a pointer is not a page name (live 2026-10-11)", () => {
  it("leaves 'that section' and 'this page' to the other readers", () => {
    expect(pageRequestOf("show me that section")).toBeNull();
    expect(pageRequestOf("open this page")).toBeNull();
    expect(pageRequestOf("take me to that section")).toBeNull();
  });
});
