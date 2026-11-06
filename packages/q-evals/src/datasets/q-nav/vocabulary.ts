import type { QNavSide } from "./contracts.js";

/**
 * The places Q-NAV targets: the app's pages as they exist on 6 Nov 2026
 * (apps/web/app, voice/destinations.ts ROUTES, contracts ui-intent.ts
 * Q_NAVIGATE_DESTINATIONS, Q_RECORD_PAGES and their tabs, the QSection
 * manifests), under one name each. A destination that is a tab of a page
 * (WORK_NEEDS, CAPITAL_RAISE, OWN_DECK, CRM_PIPELINE, GATEQ_*) is that
 * page with its tab, so "the exact page" is one comparison.
 *
 * `status: "PROPOSED"` marks a tab or section the storyboard needs that
 * has no stable id yet (plan §3, "missing deep links"): W2 (site map) and
 * W3 (deep links) own the final names, and this file is where the eval
 * follows them when they publish -- one place, one rename.
 */

export type QNavPlaceStatus = "EXISTS" | "PROPOSED";

export type QNavSection = {
  readonly id: string;
  readonly status: QNavPlaceStatus;
  /** The tab the section lives on, when the page has tabs. */
  readonly tab?: string;
};

export type QNavPage = {
  readonly page: string;
  readonly route: string;
  /** Who may open it; a page of the other side is a forbidden move. */
  readonly sides: readonly QNavSide[];
  /** A record page shows one company or investor (`subject`). */
  readonly subject?: "COMPANY" | "INVESTOR" | "COMPANY_OR_INVESTOR";
  readonly tabs: readonly {
    readonly id: string;
    readonly status: QNavPlaceStatus;
  }[];
  readonly sections: readonly QNavSection[];
  /** In a few words, what it holds (the digest line). */
  readonly holds: string;
};

const BOTH: readonly QNavSide[] = ["INVESTOR", "FOUNDER"];
const INVESTOR: readonly QNavSide[] = ["INVESTOR"];
const FOUNDER: readonly QNavSide[] = ["FOUNDER"];
const exists = (id: string) => ({ id, status: "EXISTS" as const });
const proposed = (id: string) => ({ id, status: "PROPOSED" as const });

/** The company profile's overview sections (ui-intent Q_UI_COMPANY_SECTIONS). */
const COMPANY_OVERVIEW_SECTIONS: readonly QNavSection[] = [
  "overview",
  "team",
  "pitch",
  "financials",
  "capital-objective",
  "evidence",
  "documents",
].map((id) => ({ id, status: "EXISTS" as const, tab: "overview" }));

export const Q_NAV_PAGES: readonly QNavPage[] = [
  {
    page: "HOME",
    route: "/home",
    sides: BOTH,
    tabs: [],
    sections: [],
    holds: "Q's home",
  },
  {
    page: "WORK",
    route: "/work?view=<tab>",
    sides: BOTH,
    tabs: ["needs", "progress", "done", "team", "cost"].map(exists),
    sections: [exists("approvals")],
    holds: "what needs them, what Q is doing, approvals",
  },
  {
    page: "BOARD",
    route: "/board",
    sides: BOTH,
    tabs: [],
    sections: [exists("board")],
    holds: "their own work board",
  },
  {
    page: "CAPITAL",
    route: "/relationships?view=capital&tab=<tab>",
    sides: BOTH,
    // A founder's Capital tabs (capital-tabs.ts); an investor's Capital is
    // one page: what they invested and their commitments.
    tabs: [
      "overview",
      "raise",
      "readiness",
      "action-plan",
      "plan",
      "investors",
    ].map(exists),
    sections: [
      { id: "rounds", status: "EXISTS", tab: "raise" },
      proposed("commitments"),
    ],
    holds:
      "investor: commitments and portfolio; founder: the raise, rounds, readiness, plans",
  },
  {
    page: "RELATIONSHIPS",
    route: "/relationships?view=<tab>",
    sides: BOTH,
    tabs: ["overview", "pipeline"].map(exists),
    sections: [exists("hub-overview"), exists("pipeline")],
    holds: "every relationship and the pipeline",
  },
  {
    page: "RELATIONSHIP",
    route: "/relationships/{company|investor}/<id>/<tab>",
    sides: BOTH,
    subject: "COMPANY_OR_INVESTOR",
    tabs: ["messages", "calls", "diligence", "deal"].map(exists),
    sections: [
      { id: "chat", status: "EXISTS", tab: "messages" },
      { id: "draft", status: "PROPOSED", tab: "messages" },
    ],
    holds: "one relationship: its messages, calls, diligence and deal",
  },
  {
    page: "COMPANY",
    route: "/company/<id>?tab=<tab>",
    sides: BOTH,
    subject: "COMPANY",
    tabs: ["overview", "diligence", "elevator", "dataroom", "deck", "team"].map(
      exists,
    ),
    sections: COMPANY_OVERVIEW_SECTIONS,
    holds: "a company's profile: overview, deck, data room, team, diligence",
  },
  {
    page: "INVESTOR",
    route: "/investors/<id>",
    sides: FOUNDER,
    subject: "INVESTOR",
    tabs: [],
    sections: [exists("investor")],
    holds: "an investor's profile and mandate",
  },
  {
    page: "DISCOVER",
    route: "/discover?tab=<tab>",
    sides: BOTH,
    tabs: ["yours"].map(exists),
    sections: [exists("feed")],
    holds: "the feed of companies (investor) or investors (founder)",
  },
  {
    page: "SAVED",
    route: "/discover/saved",
    sides: INVESTOR,
    tabs: [],
    sections: [],
    holds: "companies they saved",
  },
  {
    page: "SAVED_COMPARE",
    route: "/discover/saved/compare",
    sides: INVESTOR,
    tabs: [],
    sections: [],
    holds: "their saved companies side by side",
  },
  {
    page: "PASSED",
    route: "/discover/passed",
    sides: INVESTOR,
    tabs: [],
    sections: [],
    holds: "companies they passed on",
  },
  {
    page: "MANDATE",
    route: "/mandate",
    sides: INVESTOR,
    tabs: [],
    sections: [],
    holds: "their declared mandate",
  },
  {
    page: "INVESTORS",
    route: "/investors",
    sides: FOUNDER,
    tabs: [],
    sections: [],
    holds: "investors for their raise",
  },
  {
    page: "TOP_INVESTORS",
    route: "/investors/top",
    sides: FOUNDER,
    tabs: [],
    sections: [exists("top")],
    holds: "the best-fitting investors",
  },
  {
    page: "OWN_DATA_ROOM",
    route: "/company/data-room?tab=<tab>",
    sides: FOUNDER,
    tabs: [exists("deck")],
    sections: [exists("data-room"), proposed("missing")],
    holds: "their own data room and deck, and what is missing",
  },
  {
    page: "COMPANY_INTEREST",
    route: "/company/interest",
    sides: FOUNDER,
    tabs: [],
    sections: [exists("interest"), proposed("deck-views")],
    holds: "investors interested in them and who viewed their deck",
  },
  {
    page: "COMPANY_VISIBILITY",
    route: "/company/visibility",
    sides: FOUNDER,
    tabs: [],
    sections: [exists("visibility")],
    holds: "who can see their company",
  },
  {
    page: "PITCH",
    route: "/pitch",
    sides: FOUNDER,
    tabs: [],
    sections: [exists("pitch")],
    holds: "their pitch videos",
  },
  {
    page: "NEW_PITCH",
    route: "/pitch/new",
    sides: FOUNDER,
    tabs: [],
    sections: [exists("pitch")],
    holds: "record a new pitch",
  },
  {
    page: "PROFILE",
    route: "/profile",
    sides: BOTH,
    tabs: [],
    sections: [],
    holds: "their own profile",
  },
  {
    page: "SETTINGS",
    route: "/settings#<section>",
    sides: BOTH,
    tabs: [],
    sections: [
      "account",
      "team",
      "appearance",
      "q",
      "speaking",
      "notifications",
      "connections",
      "billing",
      "privacy",
      "usage",
      "memory",
      "plan",
    ].map(exists),
    holds:
      "account, appearance, Q, notifications, connections, billing, privacy",
  },
  {
    page: "VERIFICATION",
    route: "/verification",
    sides: BOTH,
    tabs: [],
    sections: [exists("verification")],
    holds: "identity and organisation verification",
  },
  {
    page: "DOCUMENTS",
    route: "/documents?open=<id>",
    sides: BOTH,
    tabs: [],
    sections: [exists("documents")],
    holds: "documents Q made for them",
  },
  {
    page: "DAILY",
    route: "/daily/<id>",
    sides: BOTH,
    tabs: [],
    sections: [exists("daily")],
    holds: "Q Daily editions",
  },
  {
    page: "REHEARSALS",
    route: "/rehearsals",
    sides: BOTH,
    tabs: [],
    sections: [exists("rehearsals")],
    holds: "pitch and meeting rehearsals",
  },
  {
    page: "RESULTS",
    route: "/results",
    sides: BOTH,
    tabs: [],
    sections: [],
    holds: "their rehearsal results",
  },
  {
    page: "EXPLORE",
    route: "/explore",
    sides: BOTH,
    tabs: [],
    sections: [exists("explore")],
    holds: "search across Capital Q",
  },
  {
    page: "PEOPLE_SEARCH",
    route: "/search",
    sides: BOTH,
    tabs: [],
    sections: [exists("search")],
    holds: "people search",
  },
  {
    page: "GATEQ",
    route: "/gateq?tab=<tab>",
    sides: INVESTOR,
    tabs: ["inbox", "find", "claim", "applications"].map(exists),
    sections: [exists("inbox")],
    holds: "GateQ: applications to their fund",
  },
  {
    page: "REVIEWS",
    route: "/reviews",
    sides: BOTH,
    tabs: [],
    sections: [exists("reviews")],
    holds: "reviews waiting on them",
  },
  {
    page: "Q_PITCH",
    route: "/q-pitch?start=1",
    sides: BOTH,
    tabs: [],
    sections: [exists("q-pitch")],
    holds: "the Q Pitch tour",
  },
  // Never a Q move target for these people: admin pages.
  {
    page: "ADMIN",
    route: "/admin",
    sides: [],
    tabs: [],
    sections: [],
    holds: "staff administration",
  },
];

export function navPage(page: string): QNavPage {
  const found = Q_NAV_PAGES.find((p) => p.page === page);
  if (found === undefined) throw new Error(`unknown Q-NAV page ${page}`);
  return found;
}

/** Pages a side may never be moved to. */
export function pagesClosedTo(side: QNavSide): readonly string[] {
  return Q_NAV_PAGES.filter((p) => !p.sides.includes(side)).map((p) => p.page);
}
