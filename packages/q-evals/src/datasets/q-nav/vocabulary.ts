import {
  Q_COMPANY_PROFILE_TABS,
  Q_NAVIGATE_DESTINATIONS,
  Q_RECORD_PAGES,
  Q_RELATIONSHIP_TABS,
  Q_SETTINGS_SECTIONS,
  Q_UI_COMPANY_SECTIONS,
  type QNavigateDestination,
  type QRecordPage,
} from "@capital-q/contracts";

import type { QNavSide } from "./contracts.js";

/**
 * Every place Q may move the page pane to, from the contracts as they
 * are (W3.1, feat/q-deep-links f14c5f6a9): every QNavigateDestination
 * and every QRecordPage, with who may open it, its tabs and its sections.
 * The coverage of the eval is generated from these lists, so a new
 * destination or record page fails CI until it has an access rule and
 * phrasings here (test/q-nav.test.ts).
 *
 * Sections are QSection ids (apps/web) and the settings sections, marked
 * EXISTS, or PROPOSED: the four the plan needs that W2/W3 have still to
 * name (relayed 6 Nov). The names change here, in one place.
 *
 * Phrasings come in two banks written separately: `dev` (tuned against)
 * and `heldout` (only measured; never read while tuning).
 */

export type QNavPlaceStatus = "EXISTS" | "PROPOSED";
export type QNavSectionDef = {
  readonly id: string;
  readonly status: QNavPlaceStatus;
  /** Its side, when only one side's page has it. */
  readonly side?: QNavSide;
};
export type QNavBank = {
  /** What they call the place ("my pipeline", "the pipeline view"). */
  readonly names: readonly string[];
  /** An ask whose answer lives there, said without naming the page. */
  readonly asks: readonly string[];
};
export type QNavDestinationDef = {
  readonly page: QNavigateDestination;
  readonly sides: readonly QNavSide[];
  readonly sections: readonly QNavSectionDef[];
  readonly dev: QNavBank;
  readonly heldout: QNavBank;
};

const BOTH: readonly QNavSide[] = ["INVESTOR", "FOUNDER"];
const I: readonly QNavSide[] = ["INVESTOR"];
const F: readonly QNavSide[] = ["FOUNDER"];
const bank = (names: readonly string[], asks: readonly string[]): QNavBank => ({
  names,
  asks,
});
const exists = (id: string, side?: QNavSide): QNavSectionDef => ({
  id,
  status: "EXISTS",
  ...(side === undefined ? {} : { side }),
});
const proposed = (id: string, side?: QNavSide): QNavSectionDef => ({
  id,
  status: "PROPOSED",
  ...(side === undefined ? {} : { side }),
});

export const Q_NAV_DESTINATIONS: readonly QNavDestinationDef[] = [
  {
    page: "HOME",
    sides: BOTH,
    sections: [],
    dev: bank(["home", "the home page"], []),
    heldout: bank(["my start page"], []),
  },
  {
    page: "PROFILE",
    sides: BOTH,
    sections: [],
    dev: bank(
      ["my profile", "my own profile page"],
      ["What does my profile say about me?"],
    ),
    heldout: bank(
      ["the page about me"],
      ["How do others see me on Capital Q?"],
    ),
  },
  {
    page: "CAPITAL",
    sides: BOTH,
    sections: [proposed("commitments", "INVESTOR")],
    dev: bank(["Capital", "my Capital page"], []),
    heldout: bank(["the capital section"], []),
  },
  {
    page: "DISCOVER",
    sides: BOTH,
    sections: [exists("feed")],
    dev: bank(["Discover", "the discovery feed"], ["What's new in my feed?"]),
    heldout: bank(
      ["the feed of new names"],
      ["Anything fresh to swipe through?"],
    ),
  },
  {
    page: "COMPANY_VISIBILITY",
    sides: F,
    sections: [exists("visibility")],
    dev: bank(
      ["my visibility settings", "company visibility"],
      ["Who can see my company?"],
    ),
    heldout: bank(
      ["the who-sees-us page"],
      ["Are we hidden from investors right now?"],
    ),
  },
  {
    page: "RELATIONSHIPS",
    sides: BOTH,
    sections: [exists("hub-overview"), exists("relationships")],
    dev: bank(
      ["my relationships", "Relationships"],
      ["Who am I talking to at the moment?"],
    ),
    heldout: bank(["the CRM"], ["Which conversations do I have open?"]),
  },
  {
    page: "SETTINGS",
    sides: BOTH,
    sections: Q_SETTINGS_SECTIONS.map((id) => exists(id)),
    dev: bank(["settings", "my settings"], []),
    heldout: bank(["preferences"], []),
  },
  {
    page: "VERIFICATION",
    sides: BOTH,
    sections: [exists("verification")],
    dev: bank(
      ["verification", "the verification page"],
      ["Am I verified yet?"],
    ),
    heldout: bank(
      ["the ID check page"],
      ["Has my identity check gone through?"],
    ),
  },
  {
    page: "PITCH",
    sides: F,
    sections: [exists("pitch")],
    dev: bank(
      ["my pitches", "my pitch videos"],
      ["Which pitch videos have I recorded?"],
    ),
    heldout: bank(
      ["the videos of me pitching"],
      ["Where are the recordings of my pitch?"],
    ),
  },
  {
    page: "COMPANY_INTEREST",
    sides: F,
    sections: [exists("interest"), proposed("deck-views")],
    dev: bank(
      ["my interest page", "investor interest"],
      ["Which investors are interested in us?"],
    ),
    heldout: bank(
      ["the page of who wants in"],
      ["Has anyone raised a hand for our round?"],
    ),
  },
  {
    page: "SAVED",
    sides: I,
    sections: [],
    dev: bank(["my saved companies", "Saved"], ["Which companies did I save?"]),
    heldout: bank(["my bookmarks"], ["What did I flag for later?"]),
  },
  {
    page: "INVESTORS",
    sides: F,
    sections: [exists("investors")],
    dev: bank(
      ["investors", "the investors page"],
      ["Which investors could fund us?"],
    ),
    heldout: bank(
      ["the investor directory"],
      ["Who's out there writing seed cheques for us?"],
    ),
  },
  {
    page: "SEARCH",
    sides: BOTH,
    sections: [],
    dev: bank(["search"], []),
    heldout: bank(["the search box page"], []),
  },
  {
    page: "GATEWAY",
    sides: BOTH,
    sections: [],
    dev: bank(["GateQ", "the gateway"], []),
    heldout: bank(["Gate Q"], []),
  },
  {
    page: "MEMORY",
    sides: BOTH,
    sections: [exists("memory")],
    dev: bank(
      ["what Q remembers", "Q's memory page"],
      ["What do you remember about me?"],
    ),
    heldout: bank(
      ["the memory page"],
      ["What have you kept on file about how I work?"],
    ),
  },
  {
    page: "USAGE",
    sides: BOTH,
    sections: [exists("usage")],
    dev: bank(
      ["my usage", "the usage page"],
      ["How much have I used Q this month?"],
    ),
    heldout: bank(["usage stats"], ["Am I close to my plan's limit?"]),
  },
  {
    page: "NEW_PITCH",
    sides: F,
    sections: [exists("pitch")],
    dev: bank(
      ["a new pitch", "the pitch recorder"],
      ["I want to record a pitch video."],
    ),
    heldout: bank(
      ["record a fresh pitch"],
      ["Let me film another take of my pitch."],
    ),
  },
  {
    page: "REHEARSALS",
    sides: BOTH,
    sections: [exists("rehearsals")],
    dev: bank(
      ["rehearsals", "my rehearsals"],
      ["Where do I practise a meeting?"],
    ),
    heldout: bank(["the practice room"], ["I'd like to rehearse a call."]),
  },
  {
    page: "DOCUMENTS",
    sides: BOTH,
    sections: [exists("documents")],
    dev: bank(
      ["my documents", "Documents"],
      ["Where are the files you made me?"],
    ),
    heldout: bank(["Q's documents"], ["Where did the reports you wrote go?"]),
  },
  {
    page: "DAILY",
    sides: BOTH,
    sections: [exists("daily")],
    dev: bank(["Q Daily", "my Daily"], ["What was in my briefing?"]),
    heldout: bank(["the daily brief"], ["What did this morning's digest say?"]),
  },
  {
    page: "RESULTS",
    sides: BOTH,
    sections: [],
    dev: bank(
      ["my results", "rehearsal results"],
      ["How did my last rehearsal go?"],
    ),
    heldout: bank(["the scores page"], ["What score did I get practising?"]),
  },
  {
    page: "PASSED",
    sides: I,
    sections: [],
    dev: bank(
      ["companies I passed on", "Passed"],
      ["Which companies did I pass on?"],
    ),
    heldout: bank(["my rejects"], ["What did I turn down?"]),
  },
  {
    page: "YOUR_COMPANIES",
    sides: I,
    sections: [],
    dev: bank(
      ["my companies in Discover", "your companies tab"],
      ["Which companies am I tracking in Discover?"],
    ),
    heldout: bank(
      ["the companies I follow"],
      ["Who's on my watch list in the feed?"],
    ),
  },
  {
    page: "WORK",
    sides: BOTH,
    sections: [exists("approvals"), exists("work")],
    dev: bank(["Work", "my work page"], []),
    heldout: bank(["the work hub"], []),
  },
  {
    page: "EXPLORE",
    sides: BOTH,
    sections: [exists("explore")],
    dev: bank(["Explore", "the explore page"], []),
    heldout: bank(["browse everything"], []),
  },
  {
    page: "PEOPLE_SEARCH",
    sides: BOTH,
    sections: [exists("search")],
    dev: bank(
      ["people search", "the people finder"],
      ["Find me a person on Capital Q."],
    ),
    heldout: bank(
      ["the directory of people"],
      ["I need to look someone up by name."],
    ),
  },
  {
    page: "WORK_NEEDS",
    sides: BOTH,
    sections: [],
    dev: bank(
      ["what needs me", "my to-dos"],
      ["What needs my attention today?"],
    ),
    heldout: bank(["the needs-you list"], ["What's waiting on me?"]),
  },
  {
    page: "WORK_PROGRESS",
    sides: BOTH,
    sections: [],
    dev: bank(
      ["work in progress", "what Q is doing"],
      ["What are you working on for me?"],
    ),
    heldout: bank(["the running jobs"], ["Is anything still cooking for me?"]),
  },
  {
    page: "WORK_DONE",
    sides: BOTH,
    sections: [],
    dev: bank(
      ["finished work", "the done tab"],
      ["What did you finish for me this week?"],
    ),
    heldout: bank(["completed jobs"], ["What's wrapped up lately?"]),
  },
  {
    page: "WORK_TEAM",
    sides: BOTH,
    sections: [],
    dev: bank(
      ["my team's work", "the team tab in Work"],
      ["What is my team working on?"],
    ),
    heldout: bank(
      ["the team board of work"],
      ["What are my colleagues busy with?"],
    ),
  },
  {
    page: "WORK_COST",
    sides: BOTH,
    sections: [],
    dev: bank(
      ["the cost tab", "what my work costs"],
      ["How much has Q's work cost me?"],
    ),
    heldout: bank(["spend on jobs"], ["What did the agents spend this month?"]),
  },
  {
    page: "OWN_DATA_ROOM",
    sides: F,
    sections: [exists("data-room"), proposed("missing")],
    dev: bank(["my data room", "our data room"], ["What's in my data room?"]),
    heldout: bank(
      ["the room of our documents"],
      ["Which files have we put up for investors?"],
    ),
  },
  {
    page: "OWN_DECK",
    sides: F,
    sections: [],
    dev: bank(
      ["my deck", "our pitch deck"],
      ["What does my deck look like now?"],
    ),
    heldout: bank(["our slides"], ["Can I see the slides we send out?"]),
  },
  {
    page: "GATEQ_INBOX",
    sides: I,
    sections: [exists("inbox")],
    dev: bank(
      ["my GateQ inbox", "the GateQ inbox"],
      ["Any new applications to my fund?"],
    ),
    heldout: bank(
      ["applications waiting at my gate"],
      ["Who knocked on my gate this week?"],
    ),
  },
  {
    page: "GATEQ_FIND",
    sides: I,
    sections: [],
    dev: bank(
      ["GateQ find", "the find tab in GateQ"],
      ["Find startups that pass my gate."],
    ),
    heldout: bank(
      ["gate search"],
      ["Which startups would get through my gate?"],
    ),
  },
  {
    page: "GATEQ_CLAIM",
    sides: F,
    sections: [],
    dev: bank(
      ["GateQ claim", "the claim tab"],
      ["I want to claim my company on GateQ."],
    ),
    heldout: bank(
      ["the claim-my-company page"],
      ["How do I take ownership of our listing?"],
    ),
  },
  {
    page: "GATEQ_APPLICATIONS",
    sides: F,
    sections: [],
    dev: bank(
      ["my GateQ applications", "the applications tab"],
      ["What came back from the gates I applied to?"],
    ),
    heldout: bank(
      ["my gate submissions"],
      ["Did any fund's gate let us through?"],
    ),
  },
  {
    page: "SAVED_COMPARE",
    sides: I,
    sections: [],
    dev: bank(
      ["the saved comparison", "saved compare"],
      ["Put my saved companies side by side."],
    ),
    heldout: bank(
      ["the compare page"],
      ["Line up my shortlist next to each other."],
    ),
  },
  {
    page: "REVIEWS",
    sides: BOTH,
    sections: [exists("reviews")],
    dev: bank(["reviews", "my reviews"], ["What's waiting for my review?"]),
    heldout: bank(
      ["things to check"],
      ["Is anything waiting for me to look over?"],
    ),
  },
  {
    page: "TOP_INVESTORS",
    sides: F,
    sections: [exists("top")],
    dev: bank(
      ["my top investors", "the top matches"],
      ["Who are my best-fit investors?"],
    ),
    heldout: bank(["the best investors page"], ["Which funds match us best?"]),
  },
  {
    page: "CAPITAL_RAISE",
    sides: F,
    sections: [exists("rounds")],
    dev: bank(
      ["my raise", "raise and rounds"],
      ["How much have we raised so far?"],
    ),
    heldout: bank(["our round page"], ["Where's the round at?"]),
  },
  {
    page: "CAPITAL_READINESS",
    sides: F,
    sections: [],
    dev: bank(
      ["my readiness", "the readiness tab"],
      ["How ready am I to raise?"],
    ),
    heldout: bank(["the readiness score page"], ["Are we investor-ready?"]),
  },
  {
    page: "CAPITAL_ACTION_PLAN",
    sides: F,
    sections: [],
    dev: bank(
      ["my action plan", "the raise action plan"],
      ["What are the next steps for my raise?"],
    ),
    heldout: bank(
      ["the to-do plan for the round"],
      ["What should I do next to close?"],
    ),
  },
  {
    page: "CAPITAL_PLAN",
    sides: F,
    sections: [],
    dev: bank(
      ["my 12-month plan", "the plan tab"],
      ["What's my plan for the year?"],
    ),
    heldout: bank(
      ["the yearly plan"],
      ["What did we commit to for the next twelve months?"],
    ),
  },
  {
    page: "CAPITAL_INVESTORS",
    sides: F,
    sections: [],
    dev: bank(
      ["the investors tab in Capital", "investors on my raise"],
      ["Which investors are in my round?"],
    ),
    heldout: bank(
      ["the round's investor list"],
      ["Who's actually in on this round?"],
    ),
  },
  {
    page: "CRM_PIPELINE",
    sides: BOTH,
    sections: [exists("pipeline")],
    dev: bank(
      ["my pipeline", "the pipeline view"],
      ["Where do my deals stand?"],
    ),
    heldout: bank(["the deal funnel"], ["Which deals are moving forward?"]),
  },
  {
    page: "Q_PITCH",
    sides: BOTH,
    sections: [exists("q-pitch")],
    dev: bank(
      ["Q Pitch", "the Q Pitch tour"],
      ["Show me how Capital Q works."],
    ),
    heldout: bank(["the product tour"], ["Walk me through the product."]),
  },
  {
    page: "BOARD",
    sides: BOTH,
    sections: [exists("board")],
    dev: bank(["my board", "the work board"], ["What's on my board?"]),
    heldout: bank(["my kanban"], ["What cards do I have going?"]),
  },
  {
    page: "MANDATE",
    sides: I,
    sections: [],
    dev: bank(["my mandate", "the mandate page"], ["What's my mandate again?"]),
    heldout: bank(
      ["my investment thesis page"],
      ["What did I say I invest in?"],
    ),
  },
];

/**
 * Places the same route reaches: the same place, whichever name is used
 * (destinations.ts maps SEARCH and EXPLORE both to /explore; /gateq
 * opens each side's own GateQ tab). Graded as equal.
 */
export const Q_NAV_SAME_PLACE: Readonly<
  Record<QNavSide, readonly (readonly string[])[]>
> = {
  INVESTOR: [
    ["SEARCH", "EXPLORE"],
    ["GATEWAY", "GATEQ_INBOX"],
  ],
  FOUNDER: [
    ["SEARCH", "EXPLORE"],
    ["GATEWAY", "GATEQ_APPLICATIONS"],
  ],
};

export type QNavRecordPageDef = {
  readonly page: QRecordPage;
  readonly sides: readonly QNavSide[];
  /** Its tab keys (W3: a record page's tab is `tab`). */
  readonly tabs: readonly string[];
  readonly sections: readonly QNavSectionDef[];
  /**
   * The same place under another record page (COMPANY_DECK is COMPANY,
   * tab deck): graded as equal.
   */
  readonly sameAs?: { readonly page: QRecordPage; readonly tab?: string };
};

export const Q_NAV_RECORD_PAGES: readonly QNavRecordPageDef[] = [
  {
    page: "COMPANY",
    sides: BOTH,
    tabs: Q_COMPANY_PROFILE_TABS,
    sections: Q_UI_COMPANY_SECTIONS.map((s) =>
      exists(s.toLowerCase().replace(/_/gu, "-")),
    ),
  },
  // The thread is its own page (W3: RELATIONSHIP_*_MESSAGES, with
  // messageId and "latest"); the relationship's `messages` tab is that page.
  {
    page: "RELATIONSHIP_COMPANY",
    sides: I,
    tabs: Q_RELATIONSHIP_TABS.filter((t) => t !== "messages"),
    sections: [],
  },
  {
    page: "RELATIONSHIP_INVESTOR",
    sides: F,
    tabs: Q_RELATIONSHIP_TABS.filter((t) => t !== "messages"),
    sections: [],
  },
  {
    page: "RELATIONSHIP_COMPANY_MESSAGES",
    sides: I,
    tabs: [],
    sections: [exists("chat"), proposed("draft")],
  },
  {
    page: "RELATIONSHIP_INVESTOR_MESSAGES",
    sides: F,
    tabs: [],
    sections: [exists("chat"), proposed("draft")],
  },
  { page: "INVESTOR", sides: F, tabs: [], sections: [exists("investor")] },
  {
    page: "INVESTOR_REHEARSAL",
    sides: F,
    tabs: [],
    sections: [exists("rehearsal")],
  },
  {
    page: "COMPANY_REHEARSAL",
    sides: I,
    tabs: [],
    sections: [exists("rehearsal")],
  },
  {
    page: "EXTERNAL_REHEARSAL",
    sides: BOTH,
    tabs: [],
    sections: [exists("rehearsal")],
  },
  { page: "DOCUMENT", sides: BOTH, tabs: [], sections: [] },
  { page: "COMPANY_PITCH", sides: BOTH, tabs: [], sections: [exists("pitch")] },
  // One data-room document: the company profile's data room tab with that
  // document open (W3: COMPANY, tab dataroom, documentId) is the same place.
  {
    page: "DATA_ROOM_DOCUMENT",
    sides: BOTH,
    tabs: [],
    sections: [],
    sameAs: { page: "COMPANY", tab: "dataroom" },
  },
  {
    page: "COMPANY_ELEVATOR",
    sides: BOTH,
    tabs: [],
    sections: [],
    sameAs: { page: "COMPANY", tab: "elevator" },
  },
  {
    page: "COMPANY_DATA_ROOM",
    sides: BOTH,
    tabs: [],
    sections: [],
    sameAs: { page: "COMPANY", tab: "dataroom" },
  },
  {
    page: "COMPANY_DECK",
    sides: BOTH,
    tabs: [],
    sections: [],
    sameAs: { page: "COMPANY", tab: "deck" },
  },
  {
    page: "COMPANY_TEAM",
    sides: BOTH,
    tabs: [],
    sections: [],
    sameAs: { page: "COMPANY", tab: "team" },
  },
  { page: "WORK_ITEM", sides: BOTH, tabs: [], sections: [exists("work")] },
  { page: "CAPITAL_ROUND", sides: F, tabs: [], sections: [exists("rounds")] },
  { page: "GATEQ_APPLICATION", sides: BOTH, tabs: [], sections: [] },
  { page: "DAILY_EDITION", sides: BOTH, tabs: [], sections: [exists("daily")] },
];

/** Not a page of Capital Q (curveballs ask for them). */
export const Q_NAV_NO_SUCH_PAGES = [
  "the analytics dashboard",
  "the marketplace",
  "my wallet",
  "the leaderboard",
  "the forum",
  "the trading desk",
] as const;

export function destinationDef(page: string): QNavDestinationDef | undefined {
  return Q_NAV_DESTINATIONS.find((d) => d.page === page);
}

export function recordPageDef(page: string): QNavRecordPageDef | undefined {
  return Q_NAV_RECORD_PAGES.find((d) => d.page === page);
}

/** Who may open a page (destination or record page); none for an unknown. */
export function sidesOf(page: string): readonly QNavSide[] {
  return destinationDef(page)?.sides ?? recordPageDef(page)?.sides ?? [];
}

/** Every page a side may never be moved to. */
export function pagesClosedTo(side: QNavSide): readonly string[] {
  return [
    ...Q_NAVIGATE_DESTINATIONS.filter((p) => !sidesOf(p).includes(side)),
    ...Q_RECORD_PAGES.filter((p) => !sidesOf(p).includes(side)),
  ];
}

/** The contracts' lists, for the coverage test. */
export const Q_NAV_CONTRACT_PAGES = {
  destinations: Q_NAVIGATE_DESTINATIONS,
  recordPages: Q_RECORD_PAGES,
} as const;
