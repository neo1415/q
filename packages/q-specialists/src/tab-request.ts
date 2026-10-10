import type {
  DeckSectionCode,
  QRecordPage,
  QRecordTab,
  QScreenContext,
} from "@capital-q/contracts";

import { plausibleName } from "./named-record-request.js";
import { selfCorrected, withoutLeadIn } from "./page-request.js";

/**
 * N2 (founder 2026-10-10): everything a page can do, Q home can do. A tab
 * or sub-tab of a page, asked for by its own name, read by code before any
 * model -- "open their team tab", "go to diligence", "show the calls tab",
 * "open Nixo's pitch deck", "the traction section of the deck".
 *
 * Only a closed list of tabs (`QRecordTab`) and deck sections is ever
 * produced; the words are matched, never passed through. Who the ask is
 * about -- a name, or the company on screen when none is said -- is the
 * caller's to resolve and authorise (open_page's own authorize step): this
 * file decides nothing about access.
 */

export type TabAsk = {
  readonly tab: QRecordTab;
  /** One section of Q's read of the deck ("the traction section of the deck"). */
  readonly subTab: DeckSectionCode | null;
  /**
   * The record as said ("Nixo"); null for a pronoun or no one -- the
   * company or investor on screen.
   */
  readonly name: string | null;
  /** The deck itself was asked for: it opens in its viewer at once. */
  readonly viewer: boolean;
};

const TAB_WORDS: readonly (readonly [QRecordTab, string])[] = [
  ["dataroom", "data\\s*room|diligence\\s+room"],
  ["deck", "(?:pitch\\s+)?deck"],
  ["elevator", "elevator(?:\\s+pitch)?"],
  ["team", "team"],
  ["diligence", "diligence"],
  ["calls", "calls?|call\\s+log"],
  ["messages", "messages|chat|conversation"],
  ["overview", "overview"],
];

const ANY_TAB = TAB_WORDS.map(([, words]) => `(?:${words})`).join("|");

const SECTION_WORDS: readonly (readonly [DeckSectionCode, string])[] = [
  ["VALUE_PROPOSITION", "value\\s+prop(?:osition)?"],
  ["GO_TO_MARKET", "go[\\s-]*to[\\s-]*market|gtm"],
  ["BUSINESS_MODEL", "business\\s+model"],
  ["COMPETITION", "competition|competitors|competitive\\s+landscape"],
  ["FINANCIALS", "financials?"],
  ["THE_ASK", "(?:the\\s+)?ask"],
  ["FOUNDERS", "founders?"],
  ["TRACTION", "traction"],
  ["PROBLEM", "problem"],
  ["SOLUTION", "solution"],
  ["MARKET", "market(?:\\s+size)?"],
  ["TEAM", "team"],
];
const ANY_SECTION = SECTION_WORDS.map(([, words]) => `(?:${words})`).join("|");

/**
 * The verbs that go to a place. "draft", "make", "create", "build" are not
 * among them, so "draft a deck" is never "open the deck".
 */
const GO_VERB =
  /^(?:(?:hey|ok|okay)\s+q[,\s]+)?(?:(?:can|could|would|will)\s+you\s+|please\s+|q[,\s]+)*(?:take\s+me\s+(?:back\s+)?(?:to|into)|bring\s+me\s+to|go\s+(?:back\s+)?to|navigate\s+to|switch\s+to|jump\s+to|head\s+to|open(?:\s+up)?|pull\s+up|bring\s+up|show(?:\s+me)?|let\s+me\s+see|view|(?:i\s+(?:want|need|would\s+like|'d\s+like)\s+to\s+)?(?:see|view|go\s+to|open|look\s+at))\s+(.+)$/iu;

/** A pronoun or a generic noun in place of a name: the record on screen. */
const NOT_A_RECORD =
  /^(?:it|its|their|theirs|his|her|hers|them|this|that|the|this\s+(?:company|investor|one|page)|that\s+(?:company|investor|one|page)|the\s+(?:company|investor)|(?:this|that|the)\s+(?:company|investor)['’]s)$/iu;

function tidy(text: string): string {
  return text
    .replace(/[’]/gu, "'")
    .replace(/\s+/gu, " ")
    .replace(/\s+(?:please|for me|now|again|here)$/iu, "")
    .replace(/[.!?]+$/u, "")
    .trim();
}

/** The one record a possessive or "for X" names, or null (pronoun, no one). */
function ownerOf(raw: string | undefined): string | null | undefined {
  if (raw === undefined) return null;
  const said = tidy(raw)
    .replace(/^(?:the|a|an)\s+/iu, "")
    .replace(/'s$/iu, "")
    .trim();
  if (said.length === 0 || NOT_A_RECORD.test(said)) return null;
  // "my" and "our" are the person's own prepared work, not a company's tab.
  if (/^(?:my|our)\b/iu.test(said)) return undefined;
  return plausibleName(said) ? said : undefined;
}

function tabOf(word: string): QRecordTab | null {
  for (const [tab, words] of TAB_WORDS) {
    if (new RegExp(`^(?:${words})$`, "iu").test(word.trim())) return tab;
  }
  return null;
}

function sectionOf(word: string): DeckSectionCode | null {
  for (const [section, words] of SECTION_WORDS) {
    if (new RegExp(`^(?:${words})$`, "iu").test(word.trim())) return section;
  }
  return null;
}

const SUFFIX = "(?:\\s+(?:tab|page|section|view))?";

function fromObject(rawObject: string): TabAsk | null {
  const object = tidy(rawObject);
  // Indefinite: "a deck", "some team", "my deck" are not a record's tab.
  if (/^(?:a|an|some|another|my|our)\s/iu.test(object)) return null;

  // One section of the deck: "the traction section of the deck", "the ask
  // in Nixo's deck", "the deck's market section".
  const section =
    new RegExp(
      `^(?:the\\s+)?(${ANY_SECTION})\\s+(?:slide|section|part|page)s?\\s+(?:of|in|from|on)\\s+(.+)$`,
      "iu",
    ).exec(object) ??
    new RegExp(
      `^(?:the\\s+)?(${ANY_SECTION})\\s+(?:of|in|from|on)\\s+(.+?['’]s\\s+(?:pitch\\s+)?deck|(?:the|their|its)\\s+(?:pitch\\s+)?deck)$`,
      "iu",
    ).exec(object);
  if (section !== null) {
    const sub = sectionOf(section[1] ?? "");
    const deck = tidy(section[2] ?? "");
    const owned = /^(.+?)'s\s+(?:pitch\s+)?deck$/iu.exec(deck);
    const plain = /^(?:(?:the|their|its)\s+)?(?:pitch\s+)?deck$/iu.test(deck);
    const name = ownerOf(owned?.[1]);
    if (sub === null || name === undefined || (owned === null && !plain)) {
      return null;
    }
    return { tab: "deck", subTab: sub, name, viewer: false };
  }
  const possessive = new RegExp(
    `^(?:the\\s+)?(?:pitch\\s+)?deck'?s?\\s+(${ANY_SECTION})${SUFFIX}$`,
    "iu",
  ).exec(object);
  if (possessive !== null) {
    const sub = sectionOf(possessive[1] ?? "");
    return sub === null
      ? null
      : { tab: "deck", subTab: sub, name: null, viewer: false };
  }

  // "Nixo's team tab", "Nixo's pitch deck".
  const owned = new RegExp(`^(.+?)'s\\s+(${ANY_TAB})${SUFFIX}$`, "iu").exec(
    object,
  );
  if (owned !== null) {
    const tab = tabOf(owned[2] ?? "");
    const name = ownerOf(owned[1]);
    if (tab === null || name === undefined) return null;
    return { tab, subTab: null, name, viewer: tab === "deck" };
  }
  // "the team tab", "diligence", "the deck for Nixo", "the data room of Nixo".
  const plain = new RegExp(
    `^(?:(?:the|their|its|his|her)\\s+)?(${ANY_TAB})${SUFFIX}(?:\\s+(?:for|of|at|with|from)\\s+(.+))?$`,
    "iu",
  ).exec(object);
  if (plain !== null) {
    const tab = tabOf(plain[1] ?? "");
    const name = ownerOf(plain[2]);
    if (tab === null || name === undefined) return null;
    return { tab, subTab: null, name, viewer: tab === "deck" };
  }
  return null;
}

/**
 * The tab (or deck section) a navigation request names, or null when the
 * words are not one. The last sentence that asks to go somewhere decides,
 * as for a record by its name (named-record-request.ts).
 */
export function tabAskOf(text: string): TabAsk | null {
  const sentences = selfCorrected(text)
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => withoutLeadIn(sentence).replace(/[.!?]+$/u, ""))
    .filter((sentence) => sentence.length > 0 && sentence.length <= 160);
  for (const sentence of [...sentences].reverse()) {
    const object = GO_VERB.exec(sentence)?.[1]?.trim();
    if (object === undefined || object.length === 0) continue;
    const found = fromObject(object);
    if (found !== null) return found;
  }
  return null;
}

const COMPANY_TAB_PAGE: Readonly<
  Record<"overview" | "elevator" | "dataroom" | "deck" | "team", QRecordPage>
> = {
  overview: "COMPANY",
  elevator: "COMPANY_ELEVATOR",
  dataroom: "COMPANY_DATA_ROOM",
  deck: "COMPANY_DECK",
  team: "COMPANY_TEAM",
};

/**
 * The record page a tab ask means when no name was said: the company or
 * investor organisation the screen shows. A request, never authority --
 * the caller opens it through open_page, which refuses what the person
 * could not open by hand. Null: nothing on screen has that tab.
 */
export function screenTabTarget(
  screen: QScreenContext | undefined,
  ask: Pick<TabAsk, "tab">,
): { readonly page: QRecordPage; readonly id: string } | null {
  if (screen === undefined) return null;
  const companyRoute =
    screen.route === "COMPANY" ||
    screen.route === "RELATIONSHIP_COMPANY" ||
    screen.route === "PITCH";
  switch (ask.tab) {
    case "calls":
    case "diligence":
    case "messages":
      if (companyRoute && screen.companyId !== undefined) {
        return {
          page:
            ask.tab === "messages"
              ? "RELATIONSHIP_COMPANY_MESSAGES"
              : "RELATIONSHIP_COMPANY",
          id: screen.companyId,
        };
      }
      return screen.route === "RELATIONSHIP_INVESTOR" &&
        screen.investorOrganisationId !== undefined
        ? {
            page:
              ask.tab === "messages"
                ? "RELATIONSHIP_INVESTOR_MESSAGES"
                : "RELATIONSHIP_INVESTOR",
            id: screen.investorOrganisationId,
          }
        : null;
    default:
      return companyRoute && screen.companyId !== undefined
        ? { page: COMPANY_TAB_PAGE[ask.tab], id: screen.companyId }
        : null;
  }
}

/** Where Q says it is going: "the team tab", "diligence", "the deck". */
export function tabPlace(ask: TabAsk): string {
  if (ask.subTab !== null) return "that part of the deck";
  switch (ask.tab) {
    case "overview":
      return "the overview";
    case "elevator":
      return "the elevator pitch";
    case "dataroom":
      return "the data room";
    case "deck":
      return "the pitch deck";
    case "team":
      return "the team tab";
    case "messages":
      return "the chat";
    case "calls":
      return "the calls tab";
    case "diligence":
      return "diligence";
  }
}
