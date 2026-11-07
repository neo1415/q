import {
  DECK_SECTIONS,
  DECK_SECTION_LABELS,
  type QManifestSectionKind,
  type QSiteMapAudience,
  type QSiteMapInstanceKind,
  type QSiteMapSub,
} from "@capital-q/contracts";
import { FOUNDER_PROFILE_SECTIONS } from "@capital-q/founder-onboarding/profile-sections";

import { SETTINGS_PAGE_SECTIONS } from "@/features/settings/settings-sections";

/**
 * Q Workspace W2: what each page of the signed-in app is, in plain words --
 * the authored half of the site map (the build adds the destinations,
 * record pages and settings sections from the route tables). One entry per
 * route of `APP_ROUTE_PATTERNS`; the coverage test fails on a page with no
 * entry, and on a section here the page does not register (or one it
 * registers that is missing here).
 *
 * Section ids are the ids the page registers with its manifest (QSection);
 * titles are what the person sees. Tabs carry the query or path that opens
 * them. Nothing here is data about anyone.
 */

export type SiteMapTabEntry = {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly subs?: readonly QSiteMapSub[] | undefined;
  /** Narrower than the page: who the code renders this tab for. */
  readonly audience?: QSiteMapAudience | undefined;
  /** What the tab is for, when its title alone could be mistaken. */
  readonly purpose?: string | undefined;
};

export type SiteMapSectionEntry = {
  readonly id: string;
  readonly title: string;
  readonly kind: QManifestSectionKind;
  readonly tab?: string | undefined;
  /** Narrower than the page or tab: who the code renders it for. */
  readonly audience?: QSiteMapAudience | undefined;
  /** What it is for, in everyday words (usually in SITE_MAP_PURPOSES). */
  readonly purpose?: string | undefined;
};

export type SiteMapPageEntry = {
  readonly title: string;
  readonly purpose: string;
  readonly audience: QSiteMapAudience;
  readonly redirectsTo?: string | undefined;
  readonly shows?: readonly QSiteMapInstanceKind[] | undefined;
  readonly tabs?: readonly SiteMapTabEntry[] | undefined;
  readonly sections?: readonly SiteMapSectionEntry[] | undefined;
};

/** What a route parameter names, by its name. */
export const SITE_MAP_PARAMS: Readonly<Record<string, QSiteMapInstanceKind>> = {
  companyId: "COMPANY",
  investorOrganisationId: "INVESTOR_ORGANISATION",
  editionId: "DAILY_EDITION",
  delegationId: "WORK_ITEM",
  laneId: "WORK_REPORT",
  mediaAssetId: "PITCH_VIDEO",
  rehearsalId: "REHEARSAL",
  meetingId: "MEETING",
  externalPersonId: "EXTERNAL_PERSON",
  userId: "TEAM_MEMBER",
  token: "INVITATION",
  position: "FOUNDER",
  organisationId: "INVESTOR_ORGANISATION",
  runId: "WORK_ITEM",
  requestId: "WORK_ITEM",
};

/** The Overview's own sections, `?tab=overview&sub=<key>` (the founder profile's list). */
const OVERVIEW_SUBS: readonly QSiteMapSub[] = FOUNDER_PROFILE_SECTIONS.map(
  (section) => ({ id: section.key, title: section.title }),
);

/** The deck's sections, `?tab=deck&sub=<code>` (Q's reading of the deck). */
const DECK_SUBS: readonly QSiteMapSub[] = DECK_SECTIONS.map((code) => ({
  id: code.toLowerCase(),
  title: DECK_SECTION_LABELS[code],
}));

const COMPANY = "/company/[companyId]";

const RELATIONSHIP_SECTIONS: readonly SiteMapSectionEntry[] = [
  { id: "calls", title: "Calls", kind: "SCHEDULE" },
  { id: "diligence", title: "Diligence", kind: "DILIGENCE" },
];

function relationshipTabs(base: string): readonly SiteMapTabEntry[] {
  return [
    { id: "messages", title: "Messages", href: `${base}/messages` },
    { id: "calls", title: "Calls", href: `${base}/calls` },
    { id: "diligence", title: "Diligence", href: `${base}/diligence` },
    { id: "deal", title: "Deal and close", href: `${base}/deal` },
  ];
}

function relationshipPage(
  side: "company" | "investor",
  part: "record" | "messages" | "calls" | "diligence" | "deal",
): SiteMapPageEntry {
  const base =
    side === "company"
      ? "/relationships/company/[companyId]"
      : "/relationships/investor/[investorOrganisationId]";
  const who = side === "company" ? "a company" : "an investor";
  const words = {
    record: [
      "Relationship",
      `One ${side === "company" ? "company" : "investor"}: where it stands, fit, notes and next steps.`,
    ],
    messages: [
      "Messages",
      `Your conversation with ${who}; Q's drafts are sent only when you approve.`,
    ],
    calls: ["Calls", `Your calls and meetings with ${who}, booked and past.`],
    diligence: [
      "Diligence",
      `Diligence with ${who}: their questions, your answers and shared documents.`,
    ],
    deal: [
      "Deal and close",
      `Agreeing terms, commitments and closing the deal with ${who}.`,
    ],
  } as const;
  const [title, purpose] = words[part];
  return {
    title,
    purpose,
    audience: side === "company" ? "INVESTOR" : "FOUNDER",
    shows: part === "messages" ? ["RELATIONSHIP_THREAD"] : ["MEETING"],
    tabs: part === "record" ? relationshipTabs(base) : undefined,
    sections:
      part === "messages"
        ? [
            { id: "chat", title: "Messages", kind: "CHAT" },
            { id: "draft", title: "Your reply (Q's draft)", kind: "CHAT" },
            ...RELATIONSHIP_SECTIONS,
          ]
        : RELATIONSHIP_SECTIONS,
  };
}

const REHEARSAL: readonly SiteMapSectionEntry[] = [
  { id: "rehearsal", title: "Rehearsal", kind: "REHEARSAL" },
];

const WORK: readonly SiteMapSectionEntry[] = [
  { id: "work", title: "Q's work", kind: "WORK_LIST" },
];

const ADMIN = (title: string, purpose: string): SiteMapPageEntry => ({
  title,
  purpose,
  audience: "ADMIN",
});

export const SITE_MAP_PAGES: Readonly<Record<string, SiteMapPageEntry>> = {
  // --- the operations console (admins only; never in the model's digest) ---
  "/admin": ADMIN("Operations", "Capital Q's operations console."),
  "/admin/accounts": ADMIN("Accounts", "Accounts on the platform."),
  "/admin/accounts/[userId]": ADMIN("Account", "One account."),
  "/admin/analytics": ADMIN(
    "Analytics privacy",
    "Analytics privacy settings across the platform.",
  ),
  "/admin/audit": ADMIN("Audit", "The audit history."),
  "/admin/billing": ADMIN("Billing", "Plans and billing across accounts."),
  "/admin/brand": ADMIN("Brand", "Capital Q's brand settings."),
  "/admin/claims": ADMIN("Claims", "Verification claims to review."),
  "/admin/email": ADMIN("Email", "Outgoing email and templates."),
  "/admin/etiquette": ADMIN("Etiquette", "How Q speaks for people."),
  "/admin/flags": ADMIN("Flags", "Feature flags."),
  "/admin/organisations": ADMIN("Organisations", "Organisations."),
  "/admin/organisations/[organisationId]": ADMIN(
    "Organisation",
    "One organisation.",
  ),
  "/admin/q": ADMIN("Q runs", "Q's runs and costs."),
  "/admin/q/runs/[runId]": ADMIN("Q run", "One Q run."),
  "/admin/queue": ADMIN("Queue", "The review queue."),
  "/admin/reviews": ADMIN("Reviews", "Human reviews."),
  "/admin/safety": ADMIN("Safety", "Safety and break-glass."),
  "/admin/safety/break-glass/[requestId]": ADMIN(
    "Break-glass",
    "One break-glass request.",
  ),
  "/admin/team": ADMIN("Team", "The operations team."),
  "/admin/verification": ADMIN("Verification", "Verification to review."),

  // --- redirects (the page they send to is the place) ---
  "/capital": {
    title: "Capital",
    purpose: "Old address of Capital.",
    audience: "ANY",
    redirectsTo: "/relationships",
  },
  "/crm": {
    title: "Relationships",
    purpose: "Old address of Relationships.",
    audience: "ANY",
    redirectsTo: "/relationships",
  },
  "/results": {
    title: "Results",
    purpose: "Old address of Relationships' overview.",
    audience: "ANY",
    redirectsTo: "/relationships",
  },
  "/discover/yours": {
    title: "Your companies",
    purpose: "Old address of Discover's Your companies tab.",
    audience: "INVESTOR",
    redirectsTo: "/discover",
  },
  "/gateway": {
    title: "GateQ",
    purpose: "Old address of GateQ.",
    audience: "INVESTOR",
    redirectsTo: "/gateq",
  },
  "/find": {
    title: "Search",
    purpose: "Old address of people search.",
    audience: "ANY",
    redirectsTo: "/search",
  },
  "/company": {
    title: "Your company",
    purpose: "Opens your own company's profile.",
    audience: "FOUNDER",
    redirectsTo: COMPANY,
  },
  "/mandate": {
    title: "Your mandate",
    purpose: "Opens your mandate on your profile.",
    audience: "INVESTOR",
    redirectsTo: "/profile",
  },
  "/investors/[investorOrganisationId]/rehearse": {
    title: "Rehearse",
    purpose: "Old address of a rehearsal with an investor.",
    audience: "FOUNDER",
    redirectsTo: "/rehearsals/investor/[investorOrganisationId]",
  },
  "/settings/billing": {
    title: "Billing",
    purpose: "Old address of Plan and billing.",
    audience: "ANY",
    redirectsTo: "/settings/plan",
  },

  // --- Q and the day ---
  "/home": {
    title: "Q",
    purpose: "Talk to Q: ask anything; see answers, cards and documents.",
    audience: "ANY",
    sections: [
      // Workspace off: Home is Q itself. On: Q is the layout pane and
      // Home's page side is the work board (W1.2).
      { id: "q", title: "Ask Q (workspace off)", kind: "OTHER" },
      { id: "board", title: "Your board (workspace on)", kind: "WORK_LIST" },
      { id: "q-room-card", title: "Q's card", kind: "Q_ROOM_CARD" },
    ],
  },
  "/analytics": {
    title: "Analytics",
    purpose:
      "Who engaged with you: a founder's investor interest and deck views; an investor's visibility and activity.",
    audience: "ANY",
    shows: ["COMPANY"],
    sections: [
      {
        id: "intent",
        title: "Intent",
        kind: "INTEREST_LIST",
        audience: "FOUNDER",
      },
      {
        id: "deck-views",
        title: "Deck views",
        kind: "DECK",
        audience: "FOUNDER",
      },
      {
        id: "viewers",
        title: "Who viewed",
        kind: "OTHER",
        audience: "FOUNDER",
      },
      { id: "trend", title: "By week", kind: "OTHER", audience: "FOUNDER" },
      {
        id: "breakdown",
        title: "By investor type and geography",
        kind: "OTHER",
        audience: "FOUNDER",
      },
      {
        id: "documents",
        title: "Documents",
        kind: "DOCUMENT_LIST",
        audience: "FOUNDER",
      },
      {
        id: "visibility",
        title: "Your visibility",
        kind: "VISIBILITY",
        audience: "INVESTOR",
      },
      {
        id: "my-activity",
        title: "Companies you viewed",
        kind: "COMPANY_LIST",
        audience: "INVESTOR",
      },
      {
        id: "responses",
        title: "Founders' answers",
        kind: "OTHER",
        audience: "INVESTOR",
      },
    ],
  },
  "/board": {
    title: "Board",
    purpose: "Your to-do board: the tasks you and Q are working on, by column.",
    audience: "ANY",
    sections: [{ id: "board", title: "Your board", kind: "WORK_LIST" }],
  },
  "/daily": {
    title: "The Q Daily",
    purpose:
      "Today's Q Daily, Q's morning briefing for you, and past editions.",
    audience: "ANY",
    shows: ["DAILY_EDITION"],
    sections: [{ id: "daily", title: "The Q Daily", kind: "DAILY" }],
  },
  "/daily/[editionId]": {
    title: "Q Daily edition",
    purpose: "One edition of the Q Daily, story by story.",
    audience: "ANY",
    sections: [{ id: "daily", title: "The Q Daily", kind: "DAILY" }],
  },
  "/work": {
    title: "Work",
    purpose:
      "What Q is doing for you: what needs you, what is running or done, Q's team and its cost.",
    audience: "ANY",
    shows: ["WORK_ITEM"],
    tabs: [
      { id: "needs", title: "Needs you", href: "/work?view=needs" },
      { id: "progress", title: "In progress", href: "/work?view=progress" },
      { id: "done", title: "Done", href: "/work?view=done" },
      {
        id: "team",
        title: "Q's team",
        href: "/work?view=team",
      },
      { id: "cost", title: "Cost", href: "/work?view=cost" },
    ],
    sections: [
      { id: "work", title: "Q's work", kind: "WORK_LIST" },
      {
        id: "approvals",
        title: "Waiting for your approval",
        kind: "APPROVAL_LIST",
      },
      { id: "q-room-card", title: "Q's card", kind: "Q_ROOM_CARD" },
    ],
  },
  "/work/[delegationId]": {
    title: "Work item",
    purpose: "One task Q is doing: steps, results, what it needs.",
    audience: "ANY",
    sections: WORK,
  },
  "/work/[delegationId]/report/[laneId]": {
    title: "Work report",
    purpose: "The report on one part of a task.",
    audience: "ANY",
    sections: WORK,
  },

  // --- discovery ---
  "/discover": {
    title: "Discover",
    purpose:
      "New matches: companies picked for an investor's mandate; investors and founders' videos for a founder.",
    audience: "ANY",
    shows: ["COMPANY", "INVESTOR_ORGANISATION", "PITCH_VIDEO"],
    tabs: [
      { id: "for-you", title: "For you", href: "/discover" },
      {
        id: "yours",
        title: "Your companies",
        href: "/discover?tab=yours",
      },
      {
        id: "founders",
        title: "Founders' videos",
        href: "/discover?tab=founders",
      },
    ],
    sections: [
      { id: "feed", title: "Your feed", kind: "COMPANY_FEED" },
      { id: "investors", title: "Investors", kind: "INVESTOR_LIST" },
      { id: "q-room-card", title: "Q's card", kind: "Q_ROOM_CARD" },
    ],
  },
  "/discover/saved": {
    title: "Saved",
    purpose: "Companies you saved to look at again.",
    audience: "INVESTOR",
    shows: ["COMPANY"],
    sections: [
      { id: "saved", title: "Saved", kind: "COMPANY_LIST" },
      { id: "passed", title: "Passed", kind: "COMPANY_LIST" },
      { id: "compare", title: "Compare", kind: "COMPANY_LIST" },
    ],
  },
  "/discover/passed": {
    title: "Passed",
    purpose: "Companies you passed on.",
    audience: "INVESTOR",
    shows: ["COMPANY"],
    sections: [
      { id: "saved", title: "Saved", kind: "COMPANY_LIST" },
      { id: "passed", title: "Passed", kind: "COMPANY_LIST" },
      { id: "compare", title: "Compare", kind: "COMPANY_LIST" },
    ],
  },
  "/discover/saved/compare": {
    title: "Compare saved",
    purpose: "Your saved companies side by side.",
    audience: "INVESTOR",
    shows: ["COMPANY"],
    sections: [
      { id: "saved", title: "Saved", kind: "COMPANY_LIST" },
      { id: "passed", title: "Passed", kind: "COMPANY_LIST" },
      { id: "compare", title: "Compare", kind: "COMPANY_LIST" },
    ],
  },
  "/explore": {
    title: "Explore the network",
    purpose:
      "Search Capital Q's own network of companies and pitches; not the public web.",
    audience: "ANY",
    shows: ["COMPANY", "PITCH_VIDEO"],
    sections: [{ id: "explore", title: "Explore", kind: "EXPLORE" }],
  },
  "/search": {
    title: "People search (public web)",
    purpose:
      "Find people and organisations on the public web; not Capital Q's network.",
    audience: "ANY",
    shows: ["EXTERNAL_PERSON"],
    sections: [
      { id: "search", title: "Search results", kind: "SEARCH_RESULTS" },
    ],
  },
  "/investors": {
    title: "Investors",
    purpose:
      "Find new investors who fit your company, and requests to connect.",
    audience: "FOUNDER",
    shows: ["INVESTOR_ORGANISATION"],
  },
  "/investors/top": {
    title: "Top companies",
    purpose: "The companies that best fit your mandate right now.",
    audience: "INVESTOR",
    shows: ["COMPANY"],
    sections: [
      { id: "top", title: "Your top companies", kind: "COMPANY_LIST" },
    ],
  },
  "/investors/[investorOrganisationId]": {
    title: "Investor",
    purpose:
      "An investor firm's page: what they invest in, their team and how you fit.",
    audience: "ANY",
    sections: [{ id: "investor", title: "Investor", kind: "INVESTOR_PROFILE" }],
  },

  // --- companies ---
  [COMPANY]: {
    title: "Company profile",
    purpose:
      "A company's profile as others see it: story, figures, diligence, documents, deck, team.",
    audience: "ANY",
    shows: ["DATA_ROOM_DOCUMENT", "DECK"],
    tabs: [
      {
        id: "overview",
        title: "Overview",
        href: `${COMPANY}?tab=overview`,
        subs: OVERVIEW_SUBS,
      },
      {
        id: "diligence",
        title: "Diligence",
        href: `${COMPANY}?tab=diligence`,
      },
      {
        id: "elevator",
        title: "Elevator pitch",
        href: `${COMPANY}?tab=elevator`,
      },
      {
        id: "dataroom",
        title: "Data room",
        href: `${COMPANY}?tab=dataroom`,
      },
      {
        id: "deck",
        title: "Pitch deck",
        href: `${COMPANY}?tab=deck`,
        subs: DECK_SUBS,
      },
      {
        id: "team",
        title: "Team",
        href: `${COMPANY}?tab=team`,
      },
    ],
    sections: [
      { id: "profile", title: "Profile", kind: "COMPANY_PROFILE" },
      {
        id: "overview",
        title: "Overview",
        kind: "COMPANY_PROFILE",
        tab: "overview",
      },
      {
        id: "diligence",
        title: "Diligence",
        kind: "DILIGENCE",
        tab: "diligence",
      },
      {
        id: "elevator",
        title: "Elevator pitch",
        kind: "ELEVATOR",
        tab: "elevator",
      },
      {
        id: "data-room",
        title: "Data room",
        kind: "DATA_ROOM",
        tab: "dataroom",
      },
      {
        id: "missing",
        title: "Still to add",
        kind: "DATA_ROOM",
        tab: "dataroom",
      },
      { id: "deck", title: "Pitch deck", kind: "DECK", tab: "deck" },
      { id: "team", title: "Team", kind: "TEAM", tab: "team" },
    ],
  },
  "/company/[companyId]/founder/[position]": {
    title: "Founder",
    purpose: "One founder's background and track record.",
    audience: "ANY",
    sections: [{ id: "founder", title: "Founder", kind: "TEAM" }],
  },
  "/company/data-room": {
    title: "Your data room",
    purpose:
      "Your company's documents and deck for investors, and what is still missing.",
    audience: "FOUNDER",
    shows: ["DATA_ROOM_DOCUMENT", "DECK"],
    tabs: [
      { id: "dataroom", title: "Data room", href: "/company/data-room" },
      { id: "deck", title: "Pitch deck", href: "/company/data-room?tab=deck" },
    ],
    // A founder is sent on to their company's page at this tab, so its
    // data-room sections are the founder's here too (the coverage test
    // reads them there: OPENS_AS).
    sections: [
      { id: "data-room", title: "Data room", kind: "DATA_ROOM" },
      {
        id: "missing",
        title: "Still to add",
        kind: "DATA_ROOM",
        tab: "dataroom",
      },
    ],
  },
  "/company/interest": {
    title: "Interest",
    purpose: "Answer investors' interest: accept to connect, or decline.",
    audience: "FOUNDER",
    shows: ["INVESTOR_ORGANISATION"],
    sections: [{ id: "interest", title: "Interest", kind: "INTEREST_LIST" }],
  },
  "/company/visibility": {
    title: "Visibility",
    purpose: "Choose who can see which parts of your company.",
    audience: "FOUNDER",
    sections: [{ id: "visibility", title: "Visibility", kind: "VISIBILITY" }],
  },
  "/documents": {
    title: "Documents",
    purpose: "Memos, reports and spreadsheets Q wrote for you; your brand kit.",
    audience: "ANY",
    shows: ["OWN_DOCUMENT"],
    sections: [
      { id: "documents", title: "Your documents", kind: "DOCUMENT_LIST" },
    ],
  },
  "/documents/unavailable": {
    title: "Document unavailable",
    purpose: "Where a document link that can't open lands.",
    audience: "ANY",
  },

  // --- relationships ---
  "/relationships": {
    title: "Relationships",
    purpose:
      "Who you're in touch with and where each stands; Capital: a founder's raise, an investor's mandate and commitments.",
    audience: "ANY",
    shows: ["COMPANY", "INVESTOR_ORGANISATION", "CAPITAL_ROUND"],
    tabs: [
      {
        id: "overview",
        title: "Overview",
        href: "/relationships?view=overview",
      },
      {
        id: "pipeline",
        title: "Pipeline",
        href: "/relationships?view=pipeline",
      },
      {
        id: "capital",
        title: "Capital",
        href: "/relationships?view=capital",
      },
      {
        id: "capital-raise",
        title: "Capital: Raise",
        href: "/relationships?view=capital&tab=raise",
      },
      {
        id: "capital-readiness",
        title: "Capital: Readiness",
        href: "/relationships?view=capital&tab=readiness",
      },
      {
        id: "capital-action-plan",
        title: "Capital: Action plan",
        href: "/relationships?view=capital&tab=action-plan",
      },
      {
        id: "capital-plan",
        title: "Capital: Your plan",
        href: "/relationships?view=capital&tab=plan",
      },
      {
        id: "capital-investors",
        title: "Capital: Investors",
        href: "/relationships?view=capital&tab=investors",
      },
    ],
    sections: [
      {
        id: "hub-overview",
        title: "Overview",
        kind: "RELATIONSHIP_LIST",
        tab: "overview",
      },
      {
        id: "pipeline",
        title: "Pipeline",
        kind: "RELATIONSHIP_LIST",
        tab: "pipeline",
      },
      {
        id: "relationships",
        title: "Relationships",
        kind: "RELATIONSHIP_LIST",
      },
      { id: "mandate", title: "Your mandate", kind: "OTHER", tab: "capital" },
      {
        id: "commitments",
        title: "Your book (commitments)",
        kind: "CAPITAL_ROUNDS",
        tab: "capital",
      },
      {
        id: "capital-overview",
        title: "Capital overview",
        kind: "CAPITAL_ROUNDS",
        tab: "capital",
      },
      {
        id: "rounds",
        title: "Your raise",
        kind: "CAPITAL_ROUNDS",
        tab: "capital-raise",
      },
      {
        id: "readiness",
        title: "Readiness",
        kind: "OTHER",
        tab: "capital-readiness",
      },
      {
        id: "action-plan",
        title: "Action plan",
        kind: "OTHER",
        tab: "capital-action-plan",
      },
      { id: "plan", title: "Your plan", kind: "OTHER", tab: "capital-plan" },
      {
        id: "investors",
        title: "Investors",
        kind: "INVESTOR_LIST",
        tab: "capital-investors",
      },
    ],
  },
  "/relationships/company/[companyId]": relationshipPage("company", "record"),
  "/relationships/company/[companyId]/messages": relationshipPage(
    "company",
    "messages",
  ),
  "/relationships/company/[companyId]/calls": relationshipPage(
    "company",
    "calls",
  ),
  "/relationships/company/[companyId]/diligence": relationshipPage(
    "company",
    "diligence",
  ),
  "/relationships/company/[companyId]/deal": relationshipPage(
    "company",
    "deal",
  ),
  "/relationships/investor/[investorOrganisationId]": relationshipPage(
    "investor",
    "record",
  ),
  "/relationships/investor/[investorOrganisationId]/messages": relationshipPage(
    "investor",
    "messages",
  ),
  "/relationships/investor/[investorOrganisationId]/calls": relationshipPage(
    "investor",
    "calls",
  ),
  "/relationships/investor/[investorOrganisationId]/diligence":
    relationshipPage("investor", "diligence"),
  "/relationships/investor/[investorOrganisationId]/deal": relationshipPage(
    "investor",
    "deal",
  ),

  // --- GateQ ---
  "/gateq": {
    title: "GateQ",
    purpose:
      "Inbound pitches: an investor reviews applications and sets their gate; a founder applies and claims their company.",
    audience: "ANY",
    shows: ["GATEQ_APPLICATION"],
    tabs: [
      { id: "inbox", title: "Inbox", href: "/gateq?tab=inbox" },
      { id: "gate", title: "Your gate", href: "/gateq?tab=gate" },
      { id: "find", title: "Find", href: "/gateq?tab=find" },
      { id: "claim", title: "Claim", href: "/gateq?tab=claim" },
      {
        id: "applications",
        title: "Your applications",
        href: "/gateq?tab=applications",
      },
    ],
    sections: [
      { id: "inbox", title: "Inbox", kind: "GATEQ_INBOX", tab: "inbox" },
      {
        id: "gateq-inbox",
        title: "Applications",
        kind: "GATEQ_INBOX",
        tab: "inbox",
      },
      {
        id: "gateq-application",
        title: "Application",
        kind: "GATEQ_APPLICATION",
        tab: "inbox",
      },
      {
        id: "gateq-selection",
        title: "Selected applications",
        kind: "GATEQ_INBOX",
        tab: "inbox",
      },
      {
        id: "gateq-comparison",
        title: "Comparison",
        kind: "GATEQ_APPLICATION",
        tab: "inbox",
      },
    ],
  },

  // --- pitch and rehearsal ---
  "/pitch": {
    title: "Pitch",
    purpose: "Your recorded pitch videos.",
    audience: "FOUNDER",
    shows: ["PITCH_VIDEO"],
    sections: [{ id: "pitch", title: "Your pitch", kind: "PITCH" }],
  },
  "/pitch/new": {
    title: "New pitch",
    purpose: "Record or upload a new pitch video.",
    audience: "FOUNDER",
    sections: [{ id: "pitch", title: "Your pitch", kind: "PITCH" }],
  },
  "/pitch/[mediaAssetId]": {
    title: "Pitch video",
    purpose: "Watch or manage one of your pitch videos.",
    audience: "FOUNDER",
    sections: [{ id: "pitch", title: "Your pitch", kind: "PITCH" }],
  },
  "/q-pitch": {
    title: "Capital Q tour",
    purpose: "A guided tour of Capital Q, presented by Q.",
    audience: "ANY",
    sections: [{ id: "q-pitch", title: "The Capital Q tour", kind: "PITCH" }],
  },
  "/q-pitch/capital-q": {
    title: "Capital Q pitch",
    purpose: "Capital Q's own investor pitch.",
    audience: "ANY",
    sections: [
      { id: "capital-q-pitch", title: "The Capital Q pitch", kind: "PITCH" },
    ],
  },
  "/rehearsals": {
    title: "Rehearsals",
    purpose: "Practise with people played by Q, and past practice.",
    audience: "ANY",
    shows: ["REHEARSAL"],
    sections: [
      { id: "rehearsals", title: "Your rehearsals", kind: "REHEARSAL" },
    ],
  },
  "/rehearsals/company/[companyId]": {
    title: "Rehearse with a company",
    purpose:
      "Practise a meeting with a company you know, played by Q; no booking needed.",
    audience: "INVESTOR",
    sections: REHEARSAL,
  },
  "/rehearsals/investor/[investorOrganisationId]": {
    title: "Rehearse with an investor",
    purpose:
      "Practise a pitch or meeting with an investor played by Q; no booking needed.",
    audience: "FOUNDER",
    sections: REHEARSAL,
  },
  "/rehearsals/person/[externalPersonId]": {
    title: "Rehearse with a person",
    purpose: "Practise with a person or organisation Q researched.",
    audience: "ANY",
    sections: REHEARSAL,
  },
  "/rehearsals/meeting/[meetingId]": {
    title: "Rehearse a meeting",
    purpose: "Prepare for one booked meeting.",
    audience: "ANY",
    sections: REHEARSAL,
  },
  "/rehearsals/r/[rehearsalId]": {
    title: "Rehearsal",
    purpose: "One finished practice session, with Q's feedback.",
    audience: "ANY",
    sections: REHEARSAL,
  },
  "/rehearsals/live/[rehearsalId]": {
    title: "Live rehearsal",
    purpose: "A practice session in progress.",
    audience: "ANY",
    sections: REHEARSAL,
  },
  "/reviews": {
    title: "Reviews",
    purpose: "Expert human reviews you asked for, and their answers.",
    audience: "ANY",
    sections: [{ id: "reviews", title: "Reviews", kind: "REVIEW_LIST" }],
  },

  // --- you ---
  "/profile": {
    title: "Your profile",
    purpose:
      "Your own details, edited by you: a founder's company; an investor's firm, mandate and thesis. Not how others see you.",
    audience: "ANY",
    sections: [
      { id: "about", title: "In your words", kind: "OTHER" },
      { id: "company", title: "Company", kind: "OTHER" },
      { id: "traction", title: "Traction", kind: "OTHER" },
      { id: "team", title: "Team", kind: "OTHER" },
      { id: "mandate", title: "Mandate", kind: "OTHER" },
      { id: "thesis", title: "How Q reads your thesis", kind: "OTHER" },
      { id: "firm", title: "Firm", kind: "OTHER" },
      { id: "organisation", title: "Organisation", kind: "OTHER" },
      { id: "you", title: "You", kind: "OTHER" },
      { id: "found", title: "What Q found in public", kind: "OTHER" },
      { id: "verification", title: "Signals and verification", kind: "OTHER" },
      { id: "q-card", title: "Q Card", kind: "OTHER" },
      { id: "my-q-card", title: "Your own Q Card", kind: "OTHER" },
    ],
  },
  "/verification": {
    title: "Verification",
    purpose: "Get verified: what is confirmed about you and your organisation.",
    audience: "ANY",
    sections: [
      { id: "verification", title: "Verification", kind: "VERIFICATION" },
    ],
  },
  "/join/[token]": {
    title: "Invitation",
    purpose: "Accept an invitation to a team.",
    audience: "ANY",
    sections: [{ id: "invitation", title: "Invitation", kind: "OTHER" }],
  },
  "/onboarding/founder": {
    title: "Founder setup",
    purpose: "Set up your company with Q, by talking or typing.",
    audience: "FOUNDER",
  },
  "/onboarding/investor": {
    title: "Investor setup",
    purpose: "Set up your mandate with Q, by talking or typing.",
    audience: "INVESTOR",
  },
  "/welcome": {
    title: "Welcome",
    purpose: "The first page after sign-up: choose your side.",
    audience: "ANY",
  },

  // --- settings ---
  "/settings": {
    title: "Settings",
    purpose:
      "Your account, security, team, look, Q, notifications, connections, plan and privacy.",
    audience: "ANY",
    sections: [
      { id: "settings", title: "Settings", kind: "SETTINGS" },
      ...SETTINGS_PAGE_SECTIONS.map((section): SiteMapSectionEntry => ({
        id: section.id,
        title: section.label,
        kind: "SETTINGS",
      })),
    ],
  },
  "/settings/activity": {
    title: "Team activity",
    purpose: "What people on your team did, and when.",
    audience: "ANY",
    sections: [
      { id: "activity", title: "Your team's activity", kind: "OTHER" },
    ],
  },
  "/settings/memory": {
    title: "Memory",
    purpose: "What Q remembers about you, and making it forget.",
    audience: "ANY",
    sections: [{ id: "memory", title: "What Q remembers", kind: "MEMORY" }],
  },
  "/settings/plan": {
    title: "Plan and billing",
    purpose:
      "Your subscription and billing: your plan, what it allows, and payment.",
    audience: "ANY",
    sections: [{ id: "plan", title: "Your plan", kind: "BILLING" }],
  },
  "/settings/usage": {
    title: "Usage",
    purpose: "What Q did for you this month, in words; not a bill.",
    audience: "ANY",
    sections: [{ id: "usage", title: "Usage", kind: "BILLING" }],
  },
  "/settings/team": {
    title: "Team",
    purpose: "Your team, their roles, and inviting people.",
    audience: "ANY",
    sections: [{ id: "team", title: "Your team", kind: "TEAM" }],
  },
  "/settings/team/[userId]": {
    title: "Team member",
    purpose: "One teammate's role and activity.",
    audience: "ANY",
    sections: [{ id: "member", title: "Team member", kind: "TEAM" }],
  },
  "/settings/security": {
    title: "Security",
    purpose: "Turn on two-step sign-in.",
    audience: "ANY",
  },
  "/settings/reconnect/google": {
    title: "Reconnect Google",
    purpose: "Reconnect your Google calendar and mail.",
    audience: "ANY",
  },
};

/**
 * W4 access STAYs (integration 2026-11-07): who the code renders each tab
 * and section for, where narrower than its page. Audited against the code
 * that renders it; `site-map-audience.test.ts` re-derives what it can from
 * that code. Absent: the page's (or the tab's) audience.
 */
export const SITE_MAP_AUDIENCES: Readonly<
  Record<
    string,
    {
      readonly tabs?: Readonly<Record<string, QSiteMapAudience>>;
      readonly sections?: Readonly<Record<string, QSiteMapAudience>>;
    }
  >
> = {
  // discover/page.tsx: the investor's two tabs; a founder's videos tab.
  "/discover": {
    tabs: { "for-you": "INVESTOR", yours: "INVESTOR", founders: "FOUNDER" },
    sections: { feed: "INVESTOR", investors: "FOUNDER" },
  },
  // capital-screen.tsx: both sides have Capital (the investor's mandate and
  // book; the founder's overview); its own tabs are FounderTab's, founder-only.
  "/relationships": {
    tabs: {
      "capital-raise": "FOUNDER",
      "capital-readiness": "FOUNDER",
      "capital-action-plan": "FOUNDER",
      "capital-plan": "FOUNDER",
      "capital-investors": "FOUNDER",
    },
    sections: {
      mandate: "INVESTOR",
      commitments: "INVESTOR",
      "capital-overview": "FOUNDER",
    },
  },
  // gateq/page.tsx: an investor has inbox, gate and find; anyone else the
  // founder's claim and applications.
  "/gateq": {
    tabs: {
      inbox: "INVESTOR",
      gate: "INVESTOR",
      find: "INVESTOR",
      claim: "FOUNDER",
      applications: "FOUNDER",
    },
  },
  // data-room.tsx: the stage checklist is the owner's (their own company).
  [COMPANY]: { sections: { missing: "FOUNDER" } },
  // own-profile-view.tsx: company branch, investor branch.
  "/profile": {
    sections: {
      company: "FOUNDER",
      traction: "FOUNDER",
      mandate: "INVESTOR",
      firm: "INVESTOR",
      thesis: "INVESTOR",
    },
  },
};

/**
 * DECISIONS 75 (owner, 2026-11-07): Q understands which place a person
 * means from their own words, not keywords. Each tab and section says what
 * it is for -- what a person goes there to do or see -- in plain everyday
 * words. Never a keyword or synonym list. A test requires one for every tab
 * and section of every page Q can move to.
 */
export const SITE_MAP_PURPOSES: Readonly<
  Record<
    string,
    {
      readonly tabs?: Readonly<Record<string, string>>;
      readonly sections?: Readonly<Record<string, string>>;
    }
  >
> = {
  "/analytics": {
    sections: {
      intent:
        "investors saving you or asking for more, as it happens; nothing to answer here",
      "deck-views": "how far investors read your deck",
      viewers: "who viewed you, as each allows",
      trend: "attention week by week",
      breakdown: "kinds of investors and where",
      documents: "which documents investors opened",
      visibility: "how founders see you",
      "my-activity": "companies you viewed",
      responses: "founders' answers to you",
    },
  },
  "/board": { sections: { board: "your tasks by column" } },
  [COMPANY]: {
    tabs: {
      overview: "headline figures, the story and the raise",
      diligence: "questions to check, the evidence and the risks",
      elevator: "the short pitch",
      dataroom: "the company's documents",
      deck: "the deck and Q's reading of it",
      team: "the founders and the team",
    },
    sections: {
      profile: "the company",
      overview: "headline figures, the story and the raise",
      diligence: "questions, evidence and risks",
      elevator: "the short pitch",
      "data-room": "the list of documents",
      missing: "documents investors expect that are missing",
      deck: "the deck",
      team: "the founders and the team",
    },
  },
  "/company/[companyId]/founder/[position]": {
    sections: { founder: "the founder's background" },
  },
  "/company/data-room": {
    tabs: {
      dataroom: "your documents, and what is still missing",
      deck: "your pitch deck",
    },
    sections: {
      "data-room": "your documents to share with investors",
      missing: "documents investors expect, still missing",
    },
  },
  "/company/interest": {
    sections: { interest: "interest awaiting your answer" },
  },
  "/company/visibility": {
    sections: { visibility: "who sees what of your company" },
  },
  "/daily": { sections: { daily: "today's edition and the archive" } },
  "/daily/[editionId]": { sections: { daily: "the edition's stories" } },
  "/discover": {
    tabs: {
      "for-you": "new companies matched to your mandate",
      yours: "companies you follow: saved or in touch",
      founders: "other founders' pitch videos",
    },
    sections: {
      feed: "companies recommended to you",
      investors: "investors you could approach",
      "q-room-card": "Q's card",
    },
  },
  "/discover/saved": {
    sections: {
      saved: "the companies you saved",
      passed: "the companies you passed on",
      compare: "your saved companies side by side",
    },
  },
  "/discover/passed": {
    sections: {
      saved: "the companies you saved",
      passed: "the companies you passed on",
      compare: "your saved companies side by side",
    },
  },
  "/discover/saved/compare": {
    sections: {
      saved: "the companies you saved",
      passed: "the companies you passed on",
      compare: "your saved companies side by side",
    },
  },
  "/documents": {
    sections: { documents: "everything Q wrote for you" },
  },
  "/explore": { sections: { explore: "network search and pitches" } },
  "/gateq": {
    tabs: {
      inbox: "applications sent to you, to decide",
      gate: "who may apply, and how",
      find: "find companies by describing them",
      claim: "claim your company as yours",
      applications: "applications you sent, and their status",
    },
    sections: {
      inbox: "every application you received",
      "gateq-inbox": "those left after your search or folder",
      "gateq-application": "one application",
      "gateq-selection": "your picks",
      "gateq-comparison": "your picks side by side",
    },
  },
  "/home": {
    sections: {
      q: "talking with Q",
      board: "your board, beside Q",
      "q-room-card": "Q's card",
    },
  },
  "/investors/[investorOrganisationId]": {
    sections: { investor: "the firm, its thesis and team" },
  },
  "/investors/top": { sections: { top: "your best-fitting companies" } },
  "/join/[token]": { sections: { invitation: "the invitation to accept" } },
  "/pitch": { sections: { pitch: "your pitch videos" } },
  "/pitch/[mediaAssetId]": { sections: { pitch: "the video" } },
  "/pitch/new": { sections: { pitch: "recording or uploading" } },
  "/profile": {
    sections: {
      about: "about you, in your words",
      company: "your company's details",
      traction: "traction and numbers",
      team: "your team",
      mandate: "what you invest in",
      thesis: "how Q reads your thesis",
      firm: "your firm's details",
      organisation: "set up your organisation",
      you: "your name, photo and role",
      found: "what Q found in public",
      verification: "what is verified",
      "q-card": "your organisation's Q Card",
      "my-q-card": "your personal Q Card",
    },
  },
  "/q-pitch": { sections: { "q-pitch": "the tour" } },
  "/q-pitch/capital-q": { sections: { "capital-q-pitch": "the pitch" } },
  "/rehearsals": {
    sections: { rehearsals: "who to practise with, and past sessions" },
  },
  "/rehearsals/company/[companyId]": {
    sections: { rehearsal: "the practice session" },
  },
  "/rehearsals/investor/[investorOrganisationId]": {
    sections: { rehearsal: "the practice session" },
  },
  "/rehearsals/live/[rehearsalId]": {
    sections: { rehearsal: "the practice session" },
  },
  "/rehearsals/meeting/[meetingId]": {
    sections: { rehearsal: "the practice session" },
  },
  "/rehearsals/person/[externalPersonId]": {
    sections: { rehearsal: "the practice session" },
  },
  "/rehearsals/r/[rehearsalId]": {
    sections: { rehearsal: "the session and Q's feedback" },
  },
  "/relationships": {
    tabs: {
      overview: "all your relationships at a glance, whatever the stage",
      pipeline: "relationships by stage",
      capital: "a founder's raise; an investor's mandate and book",
      "capital-raise": "your current round and who is in it",
      "capital-readiness": "how ready your company looks to investors",
      "capital-action-plan": "the steps to get investor-ready",
      "capital-plan": "your 3, 6 and 12-month plan",
      "capital-investors": "investors already in touch about this raise",
    },
    sections: {
      "hub-overview": "the overview",
      pipeline: "relationships by stage",
      relationships: "everyone, as a list",
      mandate: "what you invest in",
      commitments: "what you committed and what was received",
      "capital-overview": "your raise at a glance",
      rounds: "your round",
      readiness: "by pillar",
      "action-plan": "your steps",
      plan: "by horizon",
      investors: "investors already in touch",
    },
  },
  ...Object.fromEntries(
    (["company", "investor"] as const).flatMap((side) => {
      const base =
        side === "company"
          ? "/relationships/company/[companyId]"
          : "/relationships/investor/[investorOrganisationId]";
      const sections = {
        calls: "your calls and meetings together",
        diligence: "their questions and the shared documents",
      };
      return [
        [
          base,
          {
            tabs: {
              messages: "your conversation",
              calls: "your calls and meetings",
              diligence: "questions, answers and shared documents",
              deal: "terms, commitments and closing",
            },
            sections,
          },
        ],
        [`${base}/calls`, { sections }],
        [`${base}/deal`, { sections }],
        [`${base}/diligence`, { sections }],
        [
          `${base}/messages`,
          {
            sections: {
              chat: "the messages so far",
              draft: "your reply; Q's draft waits here",
              ...sections,
            },
          },
        ],
      ];
    }),
  ),
  "/reviews": { sections: { reviews: "the reviews you asked for" } },
  "/search": { sections: { search: "the people and organisations found" } },
  "/settings": {
    sections: {
      settings: "everything",
      profile: "your photo",
      account: "name, email, sign out",
      security: "two-step sign-in",
      team: "your team and roles",
      appearance: "light, dark, motion",
      q: "Q's personality and language",
      speaking: "how Q speaks on your behalf",
      notifications: "emails and alerts",
      connections: "Google calendar and mail",
      billing: "your subscription and payment",
      privacy: "your data choices",
    },
  },
  "/settings/activity": { sections: { activity: "your team's actions" } },
  "/settings/memory": { sections: { memory: "what Q remembers" } },
  "/settings/plan": { sections: { plan: "your plan and what it allows" } },
  "/settings/team": { sections: { team: "members, roles and invitations" } },
  "/settings/team/[userId]": { sections: { member: "the teammate" } },
  "/settings/usage": { sections: { usage: "the work Q did, in words" } },
  "/verification": { sections: { verification: "your verification steps" } },
  "/work": {
    tabs: {
      needs: "what waits for you to decide or do",
      progress: "what Q is doing right now",
      done: "what Q finished",
      team: "the specialists Q uses for your work; not your colleagues",
      cost: "Q's spending day by day and by job, against your limit",
    },
    sections: {
      work: "Q's tasks for you",
      approvals: "what waits for your approval",
      "q-room-card": "Q's card",
    },
  },
  "/work/[delegationId]": {
    sections: { work: "the task's steps and results" },
  },
  "/work/[delegationId]/report/[laneId]": { sections: { work: "the report" } },
};
