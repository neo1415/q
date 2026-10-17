import type { TourActor } from "./scene-evidence.js";
import {
  CertificationLedgerSchema,
  TourScriptSchema,
  type CertificationEntry,
  type CertificationLedger,
  type Chapter,
  type SceneLine,
  type SceneScript,
  type TourScript,
} from "./script.js";
import type { TourAction } from "./tour-action.js";

/**
 * Q Pitch v6, investor track (owner direction 16 Oct; plan §8). Q presents
 * Capital Q to an investor on their own workspace, step by step, and every
 * section it talks about is lit while it says so. The demonstration
 * companies are fictional and labelled as demo data on screen; the
 * narration states what the product does (claims, ledger-bound) and never
 * a figure it cannot see. Capital Q itself: pre-seed, bootstrapping, no
 * traction claimed.
 *
 * Steps are scenes `s.inv.<NN>.<page>.<part>`; sections are anchors
 * `inv.<NN>.<page>.<part>`, placed on the page by stable existing markers
 * (apps/web/src/features/q-pitch/investor-anchors.ts), so page markup never
 * encodes a step number. Owner addendum: no onboarding screens; Q says in
 * a line that it interviews you from the start.
 */

/** The certification account: the fictional investor Savanna Seed Partners. */
export const INVESTOR_V6_ACTOR: TourActor = {
  role: "INVESTOR",
  account: "investor.savanna-seed@fictional.capitalq.local",
};

type Said = {
  readonly text: string;
  /** A statement of what the product does: certified as a claim. */
  readonly claim?: true;
  readonly anchor?: string;
  readonly open?: boolean;
};

type StepInput = {
  readonly n: number;
  readonly page: string;
  readonly part: string;
  readonly title: string;
  readonly feature: string;
  readonly route: string;
  readonly actions: readonly TourAction[];
  /** Said while the page opens (no anchors, no claims). */
  readonly before?: readonly string[];
  readonly after: readonly Said[];
  readonly atlasTab: Chapter["atlasTab"];
  readonly spokenNames?: readonly string[];
  readonly ackTimeoutMs?: number;
  readonly fixture: string;
  readonly forbidden: readonly string[];
};

const FALLBACK: SceneLine = {
  lineId: "l.inv.fallback",
  kind: "CONNECTIVE",
  text: "That didn't open the way I expected, so I won't describe it. Let's go on to the next part.",
  claimIds: [],
  timing: "BEFORE_ACK",
  source: "investor track (SAFE_FALLBACK)",
};

const two = (n: number) => String(n).padStart(2, "0");

type Built = {
  readonly scene: SceneScript;
  readonly chapter: Chapter;
  readonly entry: CertificationEntry;
};

function step(input: StepInput): Built {
  const nn = two(input.n);
  const sceneId = `s.inv.${nn}.${input.page}.${input.part}`;
  const claims: { claimId: string; text: string }[] = [];
  const lines: SceneLine[] = [
    ...(input.before ?? []).map((text, index): SceneLine => ({
      lineId: `l.inv.${nn}.b${String(index + 1)}`,
      kind: "CONNECTIVE",
      text,
      claimIds: [],
      timing: "BEFORE_ACK",
      source: "investor track v6 (transition)",
    })),
    ...input.after.map((said, index): SceneLine => {
      const claimIds: string[] = [];
      if (said.claim === true) {
        const claimId = `${input.feature}.c${String(claims.length + 1)}`;
        claims.push({ claimId, text: said.text });
        claimIds.push(claimId);
      }
      return {
        lineId: `l.inv.${nn}.a${String(index + 1)}`,
        kind: said.claim === true ? "CLAIM" : "CONNECTIVE",
        text: said.text,
        claimIds,
        timing: "AFTER_ACK",
        source:
          said.claim === true
            ? `CERTIFICATION ${input.feature} (investor track v6)`
            : "investor track v6",
        ...(said.anchor === undefined ? {} : { anchor: said.anchor }),
        ...(said.open === undefined ? {} : { open: said.open }),
      };
    }),
  ];
  if (claims.length === 0) {
    claims.push({
      claimId: `${input.feature}.c1`,
      text: `${input.title} opens for the signed-in investor.`,
    });
  }
  return {
    scene: {
      sceneId,
      chapterId: `ch.inv.${nn}`,
      title: input.title,
      featureIds: [input.feature],
      approvedClaimIds: claims.map((c) => c.claimId),
      actor: INVESTOR_V6_ACTOR,
      expectedRoute: input.route,
      actions: [...input.actions],
      lines,
      fallbackLines: [FALLBACK],
      fallbackSceneId: null,
      ackTimeoutMs: input.ackTimeoutMs ?? 20_000,
    },
    chapter: {
      chapterId: `ch.inv.${nn}`,
      title: input.title,
      atlasTab: input.atlasTab,
      sceneIds: [sceneId],
      ...(input.spokenNames === undefined
        ? {}
        : { spokenNames: [...input.spokenNames] }),
    },
    entry: {
      featureId: input.feature,
      // Promoted from production browser receipts (17 Oct, Lane P):
      // CERTIFICATION_MANIFEST.md, "Q Pitch v6 certification".
      status: "PRODUCTION_LIVE_VERIFIED",
      actorContext: INVESTOR_V6_ACTOR,
      fixture: input.fixture,
      appCommit:
        "web c1b90393 (straight run); web/q-api 7161cedb (trigger run)",
      verifiedAt: "2026-10-17 06:20-07:30 UTC",
      verifierType: "BROWSER",
      receipt:
        "Lane P scratchpad v6/inv5 (all 22 steps lit) and v6/c-inv-en (trigger, step commands, bank); CERTIFICATION_MANIFEST.md",
      claimsAllowed: claims,
      claimsForbidden: [...input.forbidden],
      validUntil: {
        invalidatedBy: `Next change to the ${input.feature} surface`,
      },
    },
  };
}

const DEMO = [
  "That a demonstration company is real",
  "Any figure on screen as a Capital Q result",
];
const NO_TRACTION = [
  "Any traction, customer, revenue or investor figure for Capital Q",
  "A team size for Capital Q",
];

const HARBOURLINE = "harbourline-cargo";
const RECORD = "clinicrest";
const APPLICATION = "maji-loop-application";

const STEPS: readonly Built[] = [
  step({
    n: 1,
    page: "home",
    part: "intro",
    title: "Q, for investors",
    feature: "INV6-HOME-INTRO",
    route: "/home",
    atlasTab: "INVESTOR",
    spokenNames: ["introduction", "intro", "start"],
    actions: [
      { actionId: "ta_inv-home", kind: "openRoute", destination: "HOME" },
    ],
    after: [
      {
        text: "Hello, I'm Q, the investment analyst inside Capital Q. Let me show you Capital Q, as an investor uses it.",
      },
      {
        text: "From the start, I interview you to learn your mandate, as much as I can about what you invest in and how. Then the opportunities that fit come to you.",
        claim: true,
      },
      {
        text: "Everything you'll see is the real product. The companies are demonstration companies, labelled as such. Say next, go back, or go to any step, whenever you like.",
      },
    ],
    fixture: "Savanna Seed Partners' Home (fictional investor)",
    forbidden: NO_TRACTION,
  }),
  step({
    n: 2,
    page: "discover",
    part: "match",
    title: "Companies that match your mandate",
    feature: "INV6-MATCH-CARDS",
    route: "/discover",
    atlasTab: "INVESTOR",
    spokenNames: ["matches", "matching", "top three", "best fits"],
    ackTimeoutMs: 30_000,
    actions: [
      {
        actionId: "ta_inv-discover",
        kind: "openRoute",
        destination: "DISCOVER",
      },
      {
        actionId: "ta_inv-top-three",
        kind: "askApprovedQuestion",
        question: "q.top-three",
      },
    ],
    before: ["With Capital Q, you find the companies that match your mandate."],
    after: [
      {
        text: "These are the three that fit yours best, ranked by fit, never by who paid.",
        claim: true,
        anchor: "inv.02.match.card-1",
        open: true,
      },
      {
        text: "Each card carries two scores, never blended. Suitability is how well the company fits your mandate. Investability is how investable it is on its own evidence, the same for every investor.",
        claim: true,
        anchor: "inv.02.match.card-1",
      },
      {
        text: "The second card. Where a company trails, the card says why: a criterion it misses, or one that isn't known yet.",
        claim: true,
        anchor: "inv.02.match.card-2",
        open: true,
      },
      {
        text: "And the third. When too little is known there's no number at all: unknown stays unknown, and is never read as a weakness.",
        claim: true,
        anchor: "inv.02.match.card-3",
        open: true,
      },
    ],
    fixture:
      "Savanna's own top-three answer cards (fictional and network companies, scored live)",
    forbidden: [...DEMO, "A score as a measure of quality alone"],
  }),
  step({
    n: 3,
    page: "discover",
    part: "feed",
    title: "Discover: pitches, one at a time",
    feature: "INV6-DISCOVER-FEED",
    route: "/discover",
    atlasTab: "INVESTOR",
    spokenNames: ["discover", "feed", "pitches"],
    actions: [
      {
        actionId: "ta_inv-feed",
        kind: "openRoute",
        destination: "DISCOVER",
      },
      {
        actionId: "ta_inv-feed-next",
        kind: "uiAct",
        act: "NEXT",
        target: "carousel.feed",
      },
      {
        actionId: "ta_inv-feed-next-2",
        kind: "uiAct",
        act: "NEXT",
        target: "carousel.feed",
      },
    ],
    before: ["There are two places to browse. The first is Discover."],
    after: [
      {
        text: "A feed of pitches, one company at a time, chosen for your mandate. I keep it muted while I present.",
        claim: true,
        anchor: "inv.03.discover.card",
      },
      {
        text: "Beside each pitch: why it's here, and the facts that matter, in the same structure for every company.",
        claim: true,
        anchor: "inv.03.discover.why",
      },
    ],
    fixture: "Savanna's Discover feed",
    forbidden: [...DEMO, "That a presenter is the real founder"],
  }),
  step({
    n: 4,
    page: "profile",
    part: "overview",
    title: "A company profile: the Overview",
    feature: "INV6-PROFILE-OVERVIEW",
    route: "/company/[companyId]",
    atlasTab: "INVESTOR",
    spokenNames: ["profile", "overview", "company profile"],
    actions: [
      {
        actionId: "ta_inv-open-company",
        kind: "openCompany",
        company: HARBOURLINE,
      },
      {
        actionId: "ta_inv-tab-overview",
        kind: "selectTab",
        target: "tab.overview",
      },
    ],
    before: ["Open any company, and its profile has everything in one place."],
    after: [
      {
        text: "The Overview is built from the founder's own deck and pitch, in the same sections for every company, so you can compare like with like.",
        claim: true,
        anchor: "inv.04.profile.overview",
      },
      {
        text: "The problem, in the founder's words.",
        anchor: "inv.04.profile.problem",
      },
      {
        text: "Their solution.",
        anchor: "inv.04.profile.solution",
      },
      {
        text: "How they make money.",
        anchor: "inv.04.profile.business-model",
      },
      {
        text: "What they say protects them.",
        anchor: "inv.04.profile.moats",
      },
      {
        text: "And their ask. Everything here is their claim, labelled as theirs, until evidence says otherwise.",
        claim: true,
        anchor: "inv.04.profile.ask",
      },
    ],
    fixture: "Harbourline Cargo's profile (fictional demo company)",
    forbidden: DEMO,
  }),
  step({
    n: 5,
    page: "profile",
    part: "diligence",
    title: "Diligence",
    feature: "INV6-PROFILE-DILIGENCE",
    route: "/company/[companyId]",
    atlasTab: "INVESTOR",
    spokenNames: ["diligence"],
    actions: [
      {
        actionId: "ta_inv-tab-diligence",
        kind: "selectTab",
        target: "tab.diligence",
      },
    ],
    after: [
      {
        text: "Diligence starts with the questions worth investigating: the key claims, and which of them aren't known yet.",
        claim: true,
        anchor: "inv.05.profile.questions",
        open: true,
      },
      {
        text: "The raise, as they said it, with the moment in their pitch.",
        anchor: "inv.05.profile.raise",
        open: true,
      },
      {
        text: "Risks and unknowns, said in words. Missing evidence lowers confidence; it never counts against them.",
        claim: true,
        anchor: "inv.05.profile.unknowns",
        open: true,
      },
      {
        text: "And what is known, with how well each fact is supported.",
        claim: true,
        anchor: "inv.05.profile.evidence",
        open: true,
      },
    ],
    fixture: "Harbourline Cargo's diligence tab (fictional)",
    forbidden: DEMO,
  }),
  step({
    n: 6,
    page: "profile",
    part: "elevator",
    title: "The elevator pitch",
    feature: "INV6-PROFILE-ELEVATOR",
    route: "/company/[companyId]",
    atlasTab: "INVESTOR",
    spokenNames: ["elevator", "elevator pitch", "video"],
    actions: [
      {
        actionId: "ta_inv-tab-elevator",
        kind: "selectTab",
        target: "tab.elevator",
      },
    ],
    after: [
      {
        text: "The elevator pitch: the founders' own video. An AI presenter is always labelled as one.",
        claim: true,
        anchor: "inv.06.profile.elevator",
      },
    ],
    fixture: "Harbourline Cargo's elevator tab (fictional)",
    forbidden: [...DEMO, "That a presenter is the real founder"],
  }),
  step({
    n: 7,
    page: "profile",
    part: "dataroom",
    title: "The data room",
    feature: "INV6-PROFILE-DATAROOM",
    route: "/company/[companyId]",
    atlasTab: "INVESTOR",
    spokenNames: ["data room", "documents"],
    actions: [
      {
        actionId: "ta_inv-tab-dataroom",
        kind: "selectTab",
        target: "tab.dataroom",
      },
    ],
    after: [
      {
        text: "The data room, in folders. You see only what the founder has shared with you.",
        claim: true,
        anchor: "inv.07.profile.dataroom",
      },
      {
        text: "What isn't open yet, you can request; the founder decides.",
        claim: true,
        anchor: "inv.07.profile.requestable",
      },
    ],
    fixture:
      "Harbourline Cargo's data room, as shared with Savanna (fictional)",
    forbidden: DEMO,
  }),
  step({
    n: 8,
    page: "profile",
    part: "deck",
    title: "The pitch deck",
    feature: "INV6-PROFILE-DECK",
    route: "/company/[companyId]",
    atlasTab: "INVESTOR",
    spokenNames: ["deck", "pitch deck"],
    actions: [
      { actionId: "ta_inv-tab-deck", kind: "selectTab", target: "tab.deck" },
    ],
    after: [
      {
        text: "The pitch deck, with my reading of it: which sections it covers, and what it leaves out.",
        claim: true,
        anchor: "inv.08.profile.deck-read",
        open: true,
      },
      {
        text: "Then the deck itself, section by section.",
        anchor: "inv.08.profile.deck",
      },
    ],
    fixture: "Harbourline Cargo's deck (fictional)",
    forbidden: DEMO,
  }),
  step({
    n: 9,
    page: "profile",
    part: "team",
    title: "The team",
    feature: "INV6-PROFILE-TEAM",
    route: "/company/[companyId]",
    atlasTab: "INVESTOR",
    spokenNames: ["team"],
    actions: [
      { actionId: "ta_inv-tab-team", kind: "selectTab", target: "tab.team" },
    ],
    after: [
      {
        text: "And the team: who they are, and what the deck says about them.",
        claim: true,
        anchor: "inv.09.profile.team",
      },
    ],
    fixture: "Harbourline Cargo's team tab (fictional people)",
    forbidden: DEMO,
  }),
  step({
    n: 10,
    page: "explore",
    part: "mosaic",
    title: "Explore",
    feature: "INV6-EXPLORE",
    route: "/explore",
    atlasTab: "INVESTOR",
    spokenNames: ["explore", "mosaic", "search"],
    actions: [
      {
        actionId: "ta_inv-explore",
        kind: "openRoute",
        destination: "EXPLORE",
      },
    ],
    before: ["The second place to browse is Explore."],
    after: [
      {
        text: "A mosaic of companies, each with why it's shown to you: your mandate, or companies like the ones you saved.",
        claim: true,
        anchor: "inv.10.explore.mosaic",
      },
      {
        text: "When one interests you, you express interest from its profile. Viewing is never interest: the founder hears only when you choose.",
        claim: true,
        anchor: "inv.10.explore.tile",
      },
      {
        text: "Once the founder accepts, they appear in your CRM, as a relationship.",
        claim: true,
        anchor: "inv.10.explore.tile",
      },
    ],
    fixture: "Savanna's Explore mosaic",
    forbidden: DEMO,
  }),
  step({
    n: 11,
    page: "relationship",
    part: "record",
    title: "One relationship",
    feature: "INV6-RELATIONSHIP-RECORD",
    route: "/relationships/company/[companyId]",
    atlasTab: "INVESTOR",
    spokenNames: ["relationship", "record"],
    actions: [
      {
        actionId: "ta_inv-relationship",
        kind: "openRecord",
        record: "RELATIONSHIP",
        key: RECORD,
      },
    ],
    after: [
      {
        text: "Each relationship has one record: where it stands, and the step it reached.",
        claim: true,
        anchor: "inv.11.relationship.hero",
      },
      {
        text: "Everything that happened, in order, each entry marked with who can see it.",
        claim: true,
        anchor: "inv.11.relationship.history",
      },
      {
        text: "Your private notes, only ever seen by your firm.",
        claim: true,
        anchor: "inv.11.relationship.notes",
      },
      {
        text: "And the one next step.",
        anchor: "inv.11.relationship.next",
      },
    ],
    fixture: "Savanna's relationship with Clinicrest (fictional, connected)",
    forbidden: DEMO,
  }),
  step({
    n: 12,
    page: "relationship",
    part: "messages",
    title: "Messages",
    feature: "INV6-RELATIONSHIP-MESSAGES",
    route: "/relationships/company/[companyId]/messages",
    atlasTab: "INVESTOR",
    spokenNames: ["messages", "chat"],
    actions: [
      {
        actionId: "ta_inv-messages",
        kind: "openRecord",
        record: "RELATIONSHIP_MESSAGES",
        key: RECORD,
      },
    ],
    after: [
      {
        text: "You chat with the founder right here, in the relationship, so the conversation and the record stay together.",
        claim: true,
        anchor: "inv.12.relationship.chat",
      },
    ],
    fixture: "Savanna's messages with Clinicrest (fictional)",
    forbidden: DEMO,
  }),
  step({
    n: 13,
    page: "relationship",
    part: "calls",
    title: "Calls and meetings",
    feature: "INV6-RELATIONSHIP-CALLS",
    route: "/relationships/company/[companyId]/calls",
    atlasTab: "MEETINGS",
    spokenNames: ["calls", "meetings", "book a call"],
    actions: [
      {
        actionId: "ta_inv-calls",
        kind: "openRecord",
        record: "RELATIONSHIP_SCHEDULE",
        key: RECORD,
      },
    ],
    after: [
      {
        text: "Calls are booked from the relationship, on your free times. Nothing is sent until you confirm.",
        claim: true,
        anchor: "inv.13.relationship.schedule",
      },
      {
        text: "You can have me join the call, to take notes. After the meeting, I ask you to confirm any commitment before it's recorded.",
        claim: true,
        anchor: "inv.13.relationship.schedule",
      },
    ],
    fixture: "Savanna's calls with Clinicrest (fictional)",
    forbidden: [...DEMO, "That a call was booked or sent"],
  }),
  step({
    n: 14,
    page: "capital",
    part: "commitments",
    title: "Capital",
    feature: "INV6-CAPITAL",
    route: "/relationships",
    atlasTab: "INVESTOR",
    spokenNames: ["capital", "commitments"],
    actions: [
      {
        actionId: "ta_inv-capital",
        kind: "openRoute",
        destination: "CAPITAL",
      },
    ],
    before: ["Capital is where the business actually happens."],
    after: [
      {
        text: "Your commitments appear here, once both sides confirm them.",
        claim: true,
        anchor: "inv.14.capital.commitments",
      },
      {
        text: "What needs you, so nothing waits on a forgotten step.",
        anchor: "inv.14.capital.needs-you",
      },
      {
        text: "And your mandate, the declared one I match against.",
        claim: true,
        anchor: "inv.14.capital.mandate",
      },
    ],
    fixture: "Savanna's Capital tab (fictional seed data)",
    forbidden: DEMO,
  }),
  step({
    n: 15,
    page: "crm",
    part: "overview",
    title: "The CRM",
    feature: "INV6-CRM-OVERVIEW",
    route: "/relationships",
    atlasTab: "INVESTOR",
    spokenNames: ["crm", "investment hub", "overview"],
    actions: [
      {
        actionId: "ta_inv-crm",
        kind: "openRoute",
        destination: "RELATIONSHIPS",
      },
    ],
    before: ["The CRM is where you monitor everything."],
    after: [
      {
        text: "What needs you, first.",
        claim: true,
        anchor: "inv.15.crm.needs-you",
      },
      {
        text: "Your portfolio.",
        anchor: "inv.15.crm.portfolio",
      },
      {
        text: "And this period at a glance: activity, pipeline, funnel and commitments.",
        anchor: "inv.15.crm.period",
      },
    ],
    fixture: "Savanna's Investment Hub (fictional seed data)",
    forbidden: DEMO,
  }),
  step({
    n: 16,
    page: "crm",
    part: "pipeline",
    title: "The pipeline",
    feature: "INV6-CRM-PIPELINE",
    route: "/relationships",
    atlasTab: "INVESTOR",
    spokenNames: ["pipeline"],
    actions: [
      {
        actionId: "ta_inv-pipeline",
        kind: "openRoute",
        destination: "CRM_PIPELINE",
      },
    ],
    after: [
      {
        text: "The pipeline: every relationship, by stage, as a list, a table or a board.",
        claim: true,
        anchor: "inv.16.crm.pipeline",
      },
    ],
    fixture: "Savanna's pipeline (fictional)",
    forbidden: DEMO,
  }),
  step({
    n: 17,
    page: "work",
    part: "agents",
    title: "Q Work: I act for you",
    feature: "INV6-WORK",
    route: "/work",
    atlasTab: "Q_WORK",
    spokenNames: ["work", "agents", "q work"],
    actions: [
      { actionId: "ta_inv-work", kind: "openRoute", destination: "WORK" },
    ],
    before: ["You can also tell me to act for you."],
    after: [
      {
        text: "Watch your mandate, express interest, reply, book meetings: I do the work within your approval rules.",
        claim: true,
        anchor: "inv.17.work.running",
      },
      {
        text: "Anything that needs your decision waits here. Nothing below is sent until you decide.",
        claim: true,
        anchor: "inv.17.work.needs-you",
      },
      {
        text: "And what I've done for you this week.",
        anchor: "inv.17.work.done",
      },
    ],
    fixture: "Savanna's Q Work (fictional)",
    forbidden: DEMO,
  }),
  step({
    n: 18,
    page: "work",
    part: "team",
    title: "Q's team at work",
    feature: "INV6-WORK-TEAM",
    route: "/work",
    atlasTab: "Q_WORK",
    spokenNames: ["team map", "qs team"],
    actions: [
      {
        actionId: "ta_inv-work-team",
        kind: "openRoute",
        destination: "WORK_TEAM",
      },
    ],
    after: [
      {
        text: "Behind me, a team: a planner sets the steps, specialists research and draft, and a reviewer checks the work before it reaches you.",
        claim: true,
        anchor: "inv.18.work.team",
      },
      {
        text: "Here's one job's plan, step by step.",
        anchor: "inv.18.work.plan",
        open: true,
      },
    ],
    fixture: "Savanna's team map (fictional jobs)",
    forbidden: DEMO,
  }),
  step({
    n: 19,
    page: "daily",
    part: "edition",
    title: "The Q Daily",
    feature: "INV6-DAILY",
    route: "/daily",
    atlasTab: "DAILY",
    spokenNames: ["daily", "news", "q daily"],
    actions: [
      { actionId: "ta_inv-daily", kind: "openRoute", destination: "DAILY" },
    ],
    after: [
      {
        text: "The Q Daily: news and stories chosen for your mandate and interests.",
        claim: true,
        anchor: "inv.19.daily.lead",
      },
      {
        text: "With my take on what matters for you.",
        anchor: "inv.19.daily.take",
      },
    ],
    fixture: "Savanna's Q Daily edition",
    forbidden: ["Any story as Capital Q's own news"],
  }),
  step({
    n: 20,
    page: "gateq",
    part: "application",
    title: "GateQ: your front door",
    feature: "INV6-GATEQ",
    route: "/gateq",
    atlasTab: "GATEQ",
    spokenNames: ["gateq", "gate", "inbox", "applications"],
    ackTimeoutMs: 25_000,
    actions: [
      {
        actionId: "ta_inv-gateq",
        kind: "openRecord",
        record: "GATEQ_APPLICATION",
        key: APPLICATION,
      },
    ],
    before: [
      "GateQ is your front door: founders who meet your bar apply, and I interview them first.",
    ],
    after: [
      {
        text: "Every application arrives in the same structure. The brief is frozen from what the founder sent.",
        claim: true,
        anchor: "inv.20.gateq.brief",
      },
      {
        text: "The founder's own words: the interview, exactly as given.",
        claim: true,
        anchor: "inv.20.gateq.transcript",
        open: true,
      },
      {
        text: "And what they shared with it. The decision always stays with your team.",
        claim: true,
        anchor: "inv.20.gateq.shared",
      },
    ],
    fixture: "Maji Loop's application in Savanna's GateQ inbox (fictional)",
    forbidden: [
      ...DEMO,
      "A live interview",
      "That the founder's statements are verified",
    ],
  }),
  step({
    n: 21,
    page: "documents",
    part: "library",
    title: "Your documents",
    feature: "INV6-DOCUMENTS",
    route: "/documents",
    atlasTab: "INVESTOR",
    spokenNames: ["documents", "memos"],
    actions: [
      {
        actionId: "ta_inv-documents",
        kind: "openRoute",
        destination: "DOCUMENTS",
      },
    ],
    after: [
      {
        text: "And when my work turns into paper, a memo or a brief, it lands in your documents, marked with who can see it.",
        claim: true,
        anchor: "inv.21.documents.list",
      },
    ],
    fixture: "Savanna's documents (Q-made memos on fictional companies)",
    forbidden: [...DEMO, "That a Q-made memo is verified analysis"],
  }),
  step({
    n: 22,
    page: "home",
    part: "close",
    title: "Your move",
    feature: "INV6-HOME-CLOSE",
    route: "/home",
    atlasTab: "INVESTOR",
    spokenNames: ["end", "close", "questions"],
    actions: [
      { actionId: "ta_inv-close", kind: "openRoute", destination: "HOME" },
    ],
    after: [
      {
        text: "That's Capital Q, as an investor uses it: the right companies come to you, everything comparable and labelled for what it is, and I do the work while you decide.",
      },
      {
        text: "Capital Q itself is pre-seed and bootstrapping, and I've shown only what works today. Ask me anything about it now.",
      },
    ],
    fixture: "Savanna's Home",
    forbidden: NO_TRACTION,
  }),
];

export const INVESTOR_V6_SCRIPT: TourScript = TourScriptSchema.parse({
  scriptId: "tour.investor-v6",
  scriptVersion: "6.0.0-draft",
  status: "DRAFT",
  reviewNote:
    "Investor track v6 (Lane P, 17 Oct): owner review of wording; browser receipts on production promote ledger entries from CODE_VERIFIED.",
  chapters: STEPS.map((s) => s.chapter),
  scenes: STEPS.map((s) => s.scene),
  questions: [
    {
      questionId: "q.top-three",
      text: "Show my top 3 companies with scores against my mandate and explain why.",
    },
  ],
});

export const INVESTOR_V6_LEDGER: CertificationLedger =
  CertificationLedgerSchema.parse(STEPS.map((s) => s.entry));
