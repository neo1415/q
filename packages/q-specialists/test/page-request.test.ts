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
  ["open my pipeline", "RELATIONSHIPS"],
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
