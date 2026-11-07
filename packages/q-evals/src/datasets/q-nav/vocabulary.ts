import {
  Q_NAVIGATE_DESTINATIONS,
  Q_RECORD_PAGES,
  audienceOf,
  Q_SITE_MAP,
  QNavigateTargetSchema,
  type QNavigateDestination,
  type QNavigateTarget,
  type QRecordPage,
  type QSiteMapPage,
} from "@capital-q/contracts";
import { targetToSitePlace } from "@capital-q/model-gateway/q";

import type { QNavSide } from "./contracts.js";

/**
 * Every place Q may move the page pane to, derived from W2's site map
 * (sides from each page's, tab's and section's own audience, 46e9a85)
 * (`Q_SITE_MAP`, feat/q-site-map a4027887) and W3's contract: each
 * QNavigateDestination and QRecordPage, the site-map page it lands on, who
 * may open it (the page's audience; a tab's own when it says so), its tabs
 * and its sections. Nothing here restates the app: only the phrasing banks
 * are written by hand, plus the sections W2 says are not built (PLANNED).
 *
 * A place the decision cannot name is listed as unreachable with its
 * reason (a page that only redirects, or no destination for a side), and
 * the coverage gate skips it; the reason is reported to W2/W3.
 *
 * Phrasings come in two banks written separately: `dev` (tuned against)
 * and `heldout` (only measured; never read while tuning).
 */

export type QNavPlaceStatus = "EXISTS" | "PLANNED";
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
  readonly route: string | null;
  readonly sides: readonly QNavSide[];
  readonly sections: readonly QNavSectionDef[];
  readonly dev: QNavBank;
  readonly heldout: QNavBank;
  /** Null when the decision can name it; otherwise why not. */
  readonly unreachable: string | null;
};

const bank = (names: readonly string[], asks: readonly string[]): QNavBank => ({
  names,
  asks,
});

const BANKS: readonly {
  readonly page: QNavigateDestination;
  readonly dev: QNavBank;
  readonly heldout: QNavBank;
}[] = [
  {
    page: "HOME",
    dev: bank(["home", "the home page"], []),
    heldout: bank(["my start page"], []),
  },
  {
    page: "PROFILE",
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
    dev: bank(["Capital", "my Capital page"], []),
    heldout: bank(["the capital section"], []),
  },
  {
    page: "DISCOVER",
    dev: bank(["Discover", "the discovery feed"], ["What's new in my feed?"]),
    heldout: bank(
      ["the feed of new names"],
      ["Anything fresh to swipe through?"],
    ),
  },
  {
    page: "COMPANY_VISIBILITY",
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
    dev: bank(
      ["my relationships", "Relationships"],
      ["Which of my relationships are active right now?"],
    ),
    heldout: bank(["the CRM"], ["Which conversations do I have open?"]),
  },
  {
    page: "SETTINGS",
    dev: bank(["settings", "my settings"], []),
    heldout: bank(["preferences"], []),
  },
  {
    page: "VERIFICATION",
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
    dev: bank(["my saved companies", "Saved"], ["Which companies did I save?"]),
    heldout: bank(["my bookmarks"], ["What did I flag for later?"]),
  },
  {
    page: "INVESTORS",
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
    // Not bare "search": /search is People search, so it is open to a human.
    dev: bank(["search the network"], []),
    heldout: bank(["the search box page"], []),
  },
  {
    page: "GATEWAY",
    dev: bank(["GateQ", "the gateway"], []),
    heldout: bank(["Gate Q"], []),
  },
  {
    page: "MEMORY",
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
    dev: bank(
      ["my usage", "the usage page"],
      ["How much have I used Q this month?"],
    ),
    heldout: bank(["usage stats"], ["Am I close to my plan's limit?"]),
  },
  {
    page: "NEW_PITCH",
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
    dev: bank(
      ["rehearsals", "my rehearsals"],
      ["Where do I practise a meeting?"],
    ),
    heldout: bank(["the practice room"], ["I'd like to rehearse a call."]),
  },
  {
    page: "DOCUMENTS",
    dev: bank(
      ["my documents", "Documents"],
      ["Where are the files you made me?"],
    ),
    heldout: bank(["Q's documents"], ["Where did the reports you wrote go?"]),
  },
  {
    page: "DAILY",
    dev: bank(["Q Daily", "my Daily"], ["What was in my briefing?"]),
    heldout: bank(["the daily brief"], ["What did this morning's digest say?"]),
  },
  {
    page: "RESULTS",
    dev: bank(
      ["my results", "rehearsal results"],
      ["How did my last rehearsal go?"],
    ),
    heldout: bank(["the scores page"], ["What score did I get practising?"]),
  },
  {
    page: "PASSED",
    dev: bank(
      ["companies I passed on", "Passed"],
      ["Which companies did I pass on?"],
    ),
    heldout: bank(["my rejects"], ["What did I turn down?"]),
  },
  {
    page: "YOUR_COMPANIES",
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
    dev: bank(["Work", "my work page"], []),
    heldout: bank(["the work hub"], []),
  },
  {
    page: "EXPLORE",
    dev: bank(["Explore", "the explore page"], []),
    heldout: bank(["browse everything"], []),
  },
  {
    page: "PEOPLE_SEARCH",
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
    dev: bank(
      // Not "my to-dos": Board items are to-dos too (open to a human).
      ["what needs me", "what Q needs from me"],
      ["What needs my attention today?"],
    ),
    heldout: bank(["the needs-you list"], ["What's waiting on me?"]),
  },
  {
    page: "WORK_PROGRESS",
    dev: bank(
      ["work in progress", "what Q is doing"],
      ["What are you working on for me?"],
    ),
    heldout: bank(["the running jobs"], ["Is anything still cooking for me?"]),
  },
  {
    page: "WORK_DONE",
    dev: bank(
      ["finished work", "the done tab"],
      ["What did you finish for me this week?"],
    ),
    heldout: bank(["completed jobs"], ["What's wrapped up lately?"]),
  },
  {
    page: "WORK_TEAM",
    dev: bank(
      // Work's Team tab is Q's team map (its specialists), not their
      // colleagues (that is /settings/activity): the asks were wrong.
      ["Q's team map", "the team tab in Work"],
      ["Which of Q's specialists are on my work?"],
    ),
    heldout: bank(
      ["the map of Q's team"],
      ["Who on Q's side is handling my jobs?"],
    ),
  },
  {
    page: "WORK_COST",
    dev: bank(
      ["the cost tab", "what my work costs"],
      ["How much has Q's work cost me?"],
    ),
    heldout: bank(["spend on jobs"], ["What did the agents spend this month?"]),
  },
  {
    page: "OWN_DATA_ROOM",
    dev: bank(["my data room", "our data room"], ["What's in my data room?"]),
    heldout: bank(
      ["the room of our documents"],
      ["Which files have we put up for investors?"],
    ),
  },
  {
    page: "OWN_DECK",
    dev: bank(
      ["my deck", "our pitch deck"],
      ["What does my deck look like now?"],
    ),
    heldout: bank(["our slides"], ["Can I see the slides we send out?"]),
  },
  {
    page: "GATEQ_INBOX",
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
    // Reviews are human reviews they asked for, and the answers; what
    // waits for their own review is Work's approvals (the asks were wrong).
    dev: bank(
      ["reviews", "my reviews"],
      ["What did the reviewers I asked come back with?"],
    ),
    heldout: bank(
      ["the reviews I requested"],
      ["Has the expert I asked replied yet?"],
    ),
  },
  {
    page: "TOP_INVESTORS",
    dev: bank(["my top companies", "the top-fit companies page"], []),
    heldout: bank(["the best-fit companies page"], []),
  },
  {
    page: "CAPITAL_RAISE",
    dev: bank(
      ["my raise", "raise and rounds"],
      ["How much have we raised so far?"],
    ),
    heldout: bank(["our round page"], ["Where's the round at?"]),
  },
  {
    page: "CAPITAL_READINESS",
    dev: bank(
      ["my readiness", "the readiness tab"],
      ["How ready am I to raise?"],
    ),
    heldout: bank(["the readiness score page"], ["Are we investor-ready?"]),
  },
  {
    page: "CAPITAL_ACTION_PLAN",
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
    dev: bank(
      ["my pipeline", "the pipeline view"],
      ["Where do my deals stand?"],
    ),
    heldout: bank(["the deal funnel"], ["Which deals are moving forward?"]),
  },
  {
    page: "Q_PITCH",
    dev: bank(
      ["Q Pitch", "the Q Pitch tour"],
      ["Show me how Capital Q works."],
    ),
    heldout: bank(["the product tour"], ["Walk me through the product."]),
  },
  {
    page: "BOARD",
    dev: bank(["my board", "the work board"], ["What's on my board?"]),
    heldout: bank(["my kanban"], ["What cards do I have going?"]),
  },
  {
    page: "MANDATE",
    dev: bank(["my mandate", "the mandate page"], ["What's my mandate again?"]),
    heldout: bank(
      ["my investment thesis page"],
      ["What did I say I invest in?"],
    ),
  },
  // Q Workspace batch 2 (W3): Analytics, both sides.
  {
    page: "ANALYTICS",
    dev: bank(
      ["my analytics", "the analytics page"],
      ["Who looked at my deck this week?"],
    ),
    heldout: bank(
      ["my engagement stats"],
      ["How many people watched my video?"],
    ),
  },
];

/**
 * Sections not built yet, listed so the lint refuses them as a target.
 * None now: deck views live on Analytics (batch 2, W3 8bbd707).
 */
const PLANNED_SECTIONS: readonly (readonly [
  string,
  string,
  QNavSide | undefined,
])[] = [];

const BOTH: readonly QNavSide[] = ["INVESTOR", "FOUNDER"];
const sidesOfAudience = (audience: string): readonly QNavSide[] =>
  audience === "FOUNDER"
    ? ["FOUNDER"]
    : audience === "INVESTOR"
      ? ["INVESTOR"]
      : audience === "ANY"
        ? BOTH
        : [];

const sitePage = (route: string): QSiteMapPage | undefined =>
  Q_SITE_MAP.pages.find((page) => page.route === route);

function sectionsOf(
  page: string,
  site: QSiteMapPage | undefined,
  tab: string | null,
): readonly QNavSectionDef[] {
  const existing: QNavSectionDef[] = (site?.sections ?? [])
    .filter((s) => s.tab === undefined || tab === null || s.tab === tab)
    .map((s) => {
      // Who sees it: its own audience, else its tab's, else the page's.
      const audience =
        site === undefined
          ? "ANY"
          : audienceOf(
              site,
              site.tabs.find((t) => t.id === s.tab),
              s,
            );
      return {
        id: s.id,
        status: "EXISTS" as const,
        ...(audience === "INVESTOR" || audience === "FOUNDER"
          ? { side: audience }
          : {}),
      };
    });
  for (const [onPage, id, side] of PLANNED_SECTIONS) {
    if (onPage === page && !existing.some((s) => s.id === id))
      existing.push({
        id,
        status: "PLANNED",
        ...(side === undefined ? {} : { side }),
      });
  }
  return existing;
}

/** A placeholder record id: only the page decides where it lands. */
const ANY_RECORD = "00000000-0000-4000-8000-000000000000";

function placeOf(page: QNavigateDestination | QRecordPage): {
  readonly site: QSiteMapPage | undefined;
  readonly route: string | null;
  readonly tab: string | null;
} {
  const target: QNavigateTarget = (
    Q_RECORD_PAGES as readonly string[]
  ).includes(page)
    ? QNavigateTargetSchema.parse({ page, recordId: ANY_RECORD })
    : QNavigateTargetSchema.parse({ page });
  const place = targetToSitePlace(target);
  const site = place === null ? undefined : sitePage(place.route);
  return { site, route: place?.route ?? null, tab: place?.tab ?? null };
}

export const Q_NAV_DESTINATIONS: readonly QNavDestinationDef[] =
  Q_NAVIGATE_DESTINATIONS.map((page) => {
    const words = BANKS.find((b) => b.page === page);
    const { site, route, tab } = placeOf(page);
    const sides = sidesOfAudience(
      site === undefined
        ? ""
        : audienceOf(
            site,
            site.tabs.find((t) => t.id === tab),
          ),
    );
    const unreachable =
      site === undefined
        ? "not in the site map"
        : site.redirectsTo !== undefined
          ? `its page only redirects (to ${site.redirectsTo}), so the decision cannot name it`
          : null;
    return {
      page,
      route,
      sides,
      sections: sectionsOf(page, site, tab),
      dev: words?.dev ?? bank([], []),
      heldout: words?.heldout ?? bank([], []),
      unreachable,
    };
  });

/**
 * Same-route and same-place names, graded as equal: destinations.ts sends
 * SEARCH and EXPLORE to /explore; /gateq opens each side's own GateQ tab;
 * /mandate redirects to the profile's mandate section.
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
  readonly route: string | null;
  readonly sides: readonly QNavSide[];
  readonly tabs: readonly string[];
  readonly sections: readonly QNavSectionDef[];
  /** The same place under another record page: graded as equal. */
  readonly sameAs?: { readonly page: QRecordPage; readonly tab?: string };
  readonly unreachable: string | null;
};

/** Record pages that are a profile tab (W3 round-trips both names). */
const RECORD_ALIASES: Readonly<
  Partial<
    Record<QRecordPage, { readonly page: QRecordPage; readonly tab?: string }>
  >
> = {
  COMPANY_ELEVATOR: { page: "COMPANY", tab: "elevator" },
  COMPANY_DATA_ROOM: { page: "COMPANY", tab: "dataroom" },
  COMPANY_DECK: { page: "COMPANY", tab: "deck" },
  COMPANY_TEAM: { page: "COMPANY", tab: "team" },
  DATA_ROOM_DOCUMENT: { page: "COMPANY", tab: "dataroom" },
};

export const Q_NAV_RECORD_PAGES: readonly QNavRecordPageDef[] =
  Q_RECORD_PAGES.map((page) => {
    const { site, route } = placeOf(page);
    const isThread = page.endsWith("_MESSAGES");
    const tabs = (site?.tabs ?? [])
      .map((t) => t.id)
      // The thread is its own page: a relationship's messages tab is it.
      .filter((t) => !(t === "messages" && page.startsWith("RELATIONSHIP_")));
    const sameAs = RECORD_ALIASES[page];
    return {
      page,
      route,
      sides: sidesOfAudience(site?.audience ?? ""),
      tabs: isThread ? [] : tabs,
      sections: sectionsOf(page, site, null),
      ...(sameAs === undefined ? {} : { sameAs }),
      unreachable:
        site === undefined
          ? "not in the site map"
          : site.redirectsTo !== undefined
            ? `its page only redirects (to ${site.redirectsTo}), so the decision cannot name it`
            : null,
    };
  });

/** Not a page of Capital Q (curveballs ask for them). */
export const Q_NAV_NO_SUCH_PAGES = [
  // Not "the analytics dashboard": Analytics exists since batch 2.
  "the token exchange",
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

/** Who may open a page; none for an unknown or unreachable one. */
export function sidesOf(page: string): readonly QNavSide[] {
  const def = destinationDef(page) ?? recordPageDef(page);
  return def === undefined || def.unreachable !== null ? [] : def.sides;
}

/** Every page a side may never be moved to (or that Q cannot name). */
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
