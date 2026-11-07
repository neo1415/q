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
};

export type SiteMapSectionEntry = {
  readonly id: string;
  readonly title: string;
  readonly kind: QManifestSectionKind;
  readonly tab?: string | undefined;
  /** Narrower than the page or tab: who the code renders it for. */
  readonly audience?: QSiteMapAudience | undefined;
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
      `Your relationship with ${who}: where it stands, fit, notes and next steps.`,
    ],
    messages: [
      "Messages",
      `The message thread with ${who}; drafts are sent only on your approval.`,
    ],
    calls: ["Calls", `Calls and meetings with ${who}, booked and past.`],
    diligence: [
      "Diligence",
      `Diligence with ${who}: questions, answers and shared documents.`,
    ],
    deal: ["Deal and close", `Terms, commitments and closing with ${who}.`],
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
    audience: "FOUNDER",
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
    purpose: "Talk to Q: answers, cards, documents and the Board.",
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
      "Intent and investor viewing of your company (deck by slide, who viewed, by week); an investor's own visibility and answers.",
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
    purpose: "Your work board: what Q and you are working on.",
    audience: "ANY",
    sections: [{ id: "board", title: "Your board", kind: "WORK_LIST" }],
  },
  "/daily": {
    title: "The Q Daily",
    purpose: "Your newspaper from Q, and its archive.",
    audience: "ANY",
    shows: ["DAILY_EDITION"],
    sections: [{ id: "daily", title: "The Q Daily", kind: "DAILY" }],
  },
  "/daily/[editionId]": {
    title: "Q Daily edition",
    purpose:
      "One edition; stories and sections by #story-<id> / #section-<code>.",
    audience: "ANY",
    sections: [{ id: "daily", title: "The Q Daily", kind: "DAILY" }],
  },
  "/work": {
    title: "Work",
    purpose: "What Q suggests, runs, needs from you and finished.",
    audience: "ANY",
    shows: ["WORK_ITEM"],
    tabs: [
      { id: "needs", title: "Needs you", href: "/work?view=needs" },
      { id: "progress", title: "In progress", href: "/work?view=progress" },
      { id: "done", title: "Done", href: "/work?view=done" },
      { id: "team", title: "Team", href: "/work?view=team" },
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
    purpose: "One piece of Q's work: its steps, results and what it needs.",
    audience: "ANY",
    sections: WORK,
  },
  "/work/[delegationId]/report/[laneId]": {
    title: "Work report",
    purpose: "The report of one lane of Q's work.",
    audience: "ANY",
    sections: WORK,
  },

  // --- discovery ---
  "/discover": {
    title: "Discover",
    purpose:
      "Investors: companies picked for your mandate. Founders: investors and founders' videos.",
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
    purpose: "Companies you saved.",
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
    purpose: "Saved companies side by side.",
    audience: "INVESTOR",
    shows: ["COMPANY"],
    sections: [
      { id: "saved", title: "Saved", kind: "COMPANY_LIST" },
      { id: "passed", title: "Passed", kind: "COMPANY_LIST" },
      { id: "compare", title: "Compare", kind: "COMPANY_LIST" },
    ],
  },
  "/explore": {
    title: "Explore",
    purpose: "Search the network and browse pitches.",
    audience: "ANY",
    shows: ["COMPANY", "PITCH_VIDEO"],
    sections: [{ id: "explore", title: "Explore", kind: "EXPLORE" }],
  },
  "/search": {
    title: "People search",
    purpose: "Find people, organisations and agencies in public.",
    audience: "ANY",
    shows: ["EXTERNAL_PERSON"],
    sections: [
      { id: "search", title: "Search results", kind: "SEARCH_RESULTS" },
    ],
  },
  "/investors": {
    title: "Investors",
    purpose: "Investors that fit your company, and requests to connect.",
    audience: "FOUNDER",
    shows: ["INVESTOR_ORGANISATION"],
  },
  "/investors/top": {
    title: "Top companies",
    purpose: "The companies that fit your mandate best.",
    audience: "INVESTOR",
    shows: ["COMPANY"],
    sections: [
      { id: "top", title: "Your top companies", kind: "COMPANY_LIST" },
    ],
  },
  "/investors/[investorOrganisationId]": {
    title: "Investor",
    purpose: "An investor organisation's page: thesis, team and fit.",
    audience: "ANY",
    sections: [{ id: "investor", title: "Investor", kind: "INVESTOR_PROFILE" }],
  },

  // --- companies ---
  [COMPANY]: {
    title: "Company profile",
    purpose:
      "A company's profile: overview, diligence, elevator pitch, data room, deck and team.",
    audience: "ANY",
    shows: ["DATA_ROOM_DOCUMENT", "DECK"],
    tabs: [
      {
        id: "overview",
        title: "Overview",
        href: `${COMPANY}?tab=overview`,
        subs: OVERVIEW_SUBS,
      },
      { id: "diligence", title: "Diligence", href: `${COMPANY}?tab=diligence` },
      {
        id: "elevator",
        title: "Elevator pitch",
        href: `${COMPANY}?tab=elevator`,
      },
      { id: "dataroom", title: "Data room", href: `${COMPANY}?tab=dataroom` },
      {
        id: "deck",
        title: "Pitch deck",
        href: `${COMPANY}?tab=deck`,
        subs: DECK_SUBS,
      },
      { id: "team", title: "Team", href: `${COMPANY}?tab=team` },
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
    purpose: "One founder's page at a company.",
    audience: "ANY",
    sections: [{ id: "founder", title: "Founder", kind: "TEAM" }],
  },
  "/company/data-room": {
    title: "Your data room",
    purpose: "Your own company's data room and deck.",
    audience: "FOUNDER",
    shows: ["DATA_ROOM_DOCUMENT", "DECK"],
    tabs: [
      { id: "dataroom", title: "Data room", href: "/company/data-room" },
      { id: "deck", title: "Pitch deck", href: "/company/data-room?tab=deck" },
    ],
    sections: [{ id: "data-room", title: "Data room", kind: "DATA_ROOM" }],
  },
  "/company/interest": {
    title: "Interest",
    purpose: "Investors' interest in your company, and your answers.",
    audience: "FOUNDER",
    shows: ["INVESTOR_ORGANISATION"],
    sections: [{ id: "interest", title: "Interest", kind: "INTEREST_LIST" }],
  },
  "/company/visibility": {
    title: "Visibility",
    purpose: "Who sees what of your company.",
    audience: "FOUNDER",
    sections: [{ id: "visibility", title: "Visibility", kind: "VISIBILITY" }],
  },
  "/documents": {
    title: "Documents",
    purpose: "Documents Q made for you, and your brand kit.",
    audience: "ANY",
    shows: ["OWN_DOCUMENT"],
    sections: [
      { id: "documents", title: "Your documents", kind: "DOCUMENT_LIST" },
    ],
  },
  "/documents/unavailable": {
    title: "Document unavailable",
    purpose: "Where a refused document link lands.",
    audience: "ANY",
  },

  // --- relationships ---
  "/relationships": {
    title: "Relationships",
    purpose: "Your relationships: overview, pipeline, and a founder's Capital.",
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
      "An investor's front door: inbox of applications, the gate, find and claim.",
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
    purpose: "Your pitch videos.",
    audience: "FOUNDER",
    shows: ["PITCH_VIDEO"],
    sections: [{ id: "pitch", title: "Your pitch", kind: "PITCH" }],
  },
  "/pitch/new": {
    title: "New pitch",
    purpose: "Record or upload a pitch video.",
    audience: "FOUNDER",
    sections: [{ id: "pitch", title: "Your pitch", kind: "PITCH" }],
  },
  "/pitch/[mediaAssetId]": {
    title: "Pitch video",
    purpose: "One pitch video.",
    audience: "FOUNDER",
    sections: [{ id: "pitch", title: "Your pitch", kind: "PITCH" }],
  },
  "/q-pitch": {
    title: "Capital Q tour",
    purpose: "Q presents Capital Q, a guided tour.",
    audience: "ANY",
    sections: [{ id: "q-pitch", title: "The Capital Q tour", kind: "PITCH" }],
  },
  "/q-pitch/capital-q": {
    title: "Capital Q pitch",
    purpose: "The Capital Q pitch.",
    audience: "ANY",
    sections: [
      { id: "capital-q-pitch", title: "The Capital Q pitch", kind: "PITCH" },
    ],
  },
  "/rehearsals": {
    title: "Rehearsals",
    purpose:
      "Rehearse with investors, companies and people Q plays; your history.",
    audience: "ANY",
    shows: ["REHEARSAL"],
    sections: [
      { id: "rehearsals", title: "Your rehearsals", kind: "REHEARSAL" },
    ],
  },
  "/rehearsals/company/[companyId]": {
    title: "Rehearse with a company",
    purpose: "Rehearse with a company you are connected to.",
    audience: "INVESTOR",
    sections: REHEARSAL,
  },
  "/rehearsals/investor/[investorOrganisationId]": {
    title: "Rehearse with an investor",
    purpose: "Rehearse your pitch with an investor, played by Q.",
    audience: "FOUNDER",
    sections: REHEARSAL,
  },
  "/rehearsals/person/[externalPersonId]": {
    title: "Rehearse with a person",
    purpose: "Rehearse with a researched person or organisation.",
    audience: "ANY",
    sections: REHEARSAL,
  },
  "/rehearsals/meeting/[meetingId]": {
    title: "Rehearse a meeting",
    purpose: "Rehearse for one booked meeting.",
    audience: "ANY",
    sections: REHEARSAL,
  },
  "/rehearsals/r/[rehearsalId]": {
    title: "Rehearsal",
    purpose: "One rehearsal and its feedback.",
    audience: "ANY",
    sections: REHEARSAL,
  },
  "/rehearsals/live/[rehearsalId]": {
    title: "Live rehearsal",
    purpose: "A rehearsal in progress.",
    audience: "ANY",
    sections: REHEARSAL,
  },
  "/reviews": {
    title: "Reviews",
    purpose: "Human reviews you asked for, and their answers.",
    audience: "ANY",
    sections: [{ id: "reviews", title: "Reviews", kind: "REVIEW_LIST" }],
  },

  // --- you ---
  "/profile": {
    title: "Your profile",
    purpose:
      "You and your company or firm, edited in place; an investor's mandate and thesis.",
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
    purpose:
      "What is verified about you and your organisation, and what is next.",
    audience: "ANY",
    sections: [
      { id: "verification", title: "Verification", kind: "VERIFICATION" },
    ],
  },
  "/join/[token]": {
    title: "Invitation",
    purpose: "An invitation to join a team.",
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
    purpose: "Account, appearance, Q, notifications, connections and privacy.",
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
    purpose: "What your team did.",
    audience: "ANY",
    sections: [
      { id: "activity", title: "Your team's activity", kind: "OTHER" },
    ],
  },
  "/settings/memory": {
    title: "Memory",
    purpose: "What Q remembers about you, and forgetting it.",
    audience: "ANY",
    sections: [{ id: "memory", title: "What Q remembers", kind: "MEMORY" }],
  },
  "/settings/plan": {
    title: "Plan and billing",
    purpose: "Your plan, its limits and billing.",
    audience: "ANY",
    sections: [{ id: "plan", title: "Your plan", kind: "BILLING" }],
  },
  "/settings/usage": {
    title: "Usage",
    purpose: "What Q used for you this month.",
    audience: "ANY",
    sections: [{ id: "usage", title: "Usage", kind: "BILLING" }],
  },
  "/settings/team": {
    title: "Team",
    purpose: "Your team: members, roles and invitations.",
    audience: "ANY",
    sections: [{ id: "team", title: "Your team", kind: "TEAM" }],
  },
  "/settings/team/[userId]": {
    title: "Team member",
    purpose: "One team member: role and activity.",
    audience: "ANY",
    sections: [{ id: "member", title: "Team member", kind: "TEAM" }],
  },
  "/settings/security": {
    title: "Security",
    purpose: "Two-step sign-in (Q is never told what it shows).",
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
