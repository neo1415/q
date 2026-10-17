import { CAPITAL_Q_PITCH, pitchSectionAnchor } from "./capital-q-pitch.js";
import type { TourActor } from "./scene-evidence.js";
import {
  CertificationLedgerSchema,
  TourScriptSchema,
  type ApprovedQuestion,
  type CertificationEntry,
  type CertificationLedger,
  type Chapter,
  type SceneLine,
  type SceneScript,
  type TourScript,
} from "./script.js";
import type { TourAction } from "./tour-action.js";

/**
 * Q Pitch v6, founder track (owner direction 16 Oct; plan §8, §10). Q
 * presents Capital Q itself, honestly (pre-seed, bootstrapping; no team
 * size, traction, customer or revenue claim), and walks a founder through
 * the app on whichever founder account is signed in. The live screens
 * show that account's own data; the narration never names what it cannot
 * know (which investors, which numbers): the page shows them, Q explains
 * what they mean.
 *
 * Every step is a scene `s.fdr.<NN>.<page>.<part>`; every section Q talks
 * about is an anchor `fdr.<NN>.<page>.<part>` lit while the line is said.
 * A line that states what the product does is a CLAIM bound to this
 * track's own certification ledger (built from the lines below, so the
 * wording and the ledger cannot drift). The ledger is CODE_VERIFIED until
 * a browser run on production promotes an entry with its receipt.
 *
 * Owner addendum (16 Oct): no onboarding screens. Q says in a line that it
 * interviews the founder from the start to learn the company, then moves on.
 */

/** The certification account: a fictional founder (Harbourline Cargo). */
export const FOUNDER_V6_ACTOR: TourActor = {
  role: "FOUNDER",
  account: "babatunde.tunde-cargo@fictional.capitalq.local",
};

/** Fictional investors the track opens (packages/q-pitch/src/demo-investors.ts). */
const GATEWAY_INVESTOR = "sahel-bridge-ventures";
const RECORD_INVESTOR = "savanna-seed-partners";

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
  readonly fallbackSceneId?: string;
  /** Where the feature is certified from (fixture), for the ledger. */
  readonly fixture: string;
  readonly forbidden: readonly string[];
};

const FALLBACK: SceneLine = {
  lineId: "l.fdr.fallback",
  kind: "CONNECTIVE",
  text: "That didn't open the way I expected, so I won't describe it. Let's go on to the next part.",
  claimIds: [],
  timing: "BEFORE_ACK",
  source: "founder track (SAFE_FALLBACK)",
};

const two = (n: number) => String(n).padStart(2, "0");

type Built = {
  readonly scene: SceneScript;
  readonly chapter: Chapter;
  readonly entry: CertificationEntry;
};

function step(input: StepInput): Built {
  const nn = two(input.n);
  const sceneId = `s.fdr.${nn}.${input.page}.${input.part}`;
  const claims: { claimId: string; text: string }[] = [];
  const lines: SceneLine[] = [
    ...(input.before ?? []).map((text, index): SceneLine => ({
      lineId: `l.fdr.${nn}.b${String(index + 1)}`,
      kind: "CONNECTIVE",
      text,
      claimIds: [],
      timing: "BEFORE_ACK",
      source: "founder track v6 (transition)",
    })),
    ...input.after.map((said, index): SceneLine => {
      const claimIds: string[] = [];
      if (said.claim === true) {
        const claimId = `${input.feature}.c${String(claims.length + 1)}`;
        claims.push({ claimId, text: said.text });
        claimIds.push(claimId);
      }
      return {
        lineId: `l.fdr.${nn}.a${String(index + 1)}`,
        kind: said.claim === true ? "CLAIM" : "CONNECTIVE",
        text: said.text,
        claimIds,
        timing: "AFTER_ACK",
        source:
          said.claim === true
            ? `CERTIFICATION ${input.feature} (founder track v6)`
            : "founder track v6",
        ...(said.anchor === undefined ? {} : { anchor: said.anchor }),
        ...(said.open === undefined ? {} : { open: said.open }),
      };
    }),
  ];
  if (claims.length === 0) {
    // Every ledger entry allows at least one claim: the page itself.
    claims.push({
      claimId: `${input.feature}.c1`,
      text: `${input.title} opens for the signed-in founder.`,
    });
  }
  return {
    scene: {
      sceneId,
      chapterId: `ch.fdr.${nn}`,
      title: input.title,
      featureIds: [input.feature],
      approvedClaimIds: claims.map((c) => c.claimId),
      actor: FOUNDER_V6_ACTOR,
      expectedRoute: input.route,
      actions: [...input.actions],
      lines,
      fallbackLines: [FALLBACK],
      fallbackSceneId: input.fallbackSceneId ?? null,
      ackTimeoutMs: input.ackTimeoutMs ?? 20_000,
    },
    chapter: {
      chapterId: `ch.fdr.${nn}`,
      title: input.title,
      atlasTab: input.atlasTab,
      sceneIds: [sceneId],
      ...(input.spokenNames === undefined
        ? {}
        : { spokenNames: [...input.spokenNames] }),
    },
    entry: {
      featureId: input.feature,
      status: "CODE_VERIFIED",
      actorContext: FOUNDER_V6_ACTOR,
      fixture: input.fixture,
      appCommit: "claude/qpf-oct16 (founder track v6)",
      verifiedAt: "2026-10-16 (Lane qpf, local vitest, provider keys disabled)",
      verifierType: "CODE",
      receipt:
        "packages/q-pitch/test/founder-v6.test.ts; apps/web/test/q-pitch-founder-anchors.test.ts",
      claimsAllowed: claims,
      claimsForbidden: [...input.forbidden],
      validUntil: {
        invalidatedBy: `Next change to the ${input.feature} surface`,
      },
    },
  };
}

const NO_TRACTION = [
  "Any traction, customer, revenue or investor figure for Capital Q",
  "A team size for Capital Q",
];

const pitchLines: Said[] = CAPITAL_Q_PITCH.map((section) => {
  // One strong line per section (lead, 17 Oct: the board ran about 160 s
  // of narration; the highlight carries the detail, the line the point).
  const said: Record<string, string> = {
    opportunity:
      "Private capital runs on fragmented information; Capital Q turns it into intelligence both sides can compare.",
    problem:
      "The problem isn't finding opportunities; it's finding the right ones, comparably.",
    solution:
      "The solution: an investment intelligence system, with me as its analyst. Evidence first.",
    "how-it-works":
      "I learn each mandate, interview each founder, and assess every company on its evidence.",
    "business-model":
      "Diagnosis at the core, deeper intelligence paid, and ranking never for sale.",
    vision:
      "The system both sides of private capital work in, built for relationships.",
    team: "The team isn't my subject here, and I make no claim about its size.",
    "go-to-market":
      "Offered through FDN Capital Partners, with a waitlist and demos.",
    competition:
      "CRMs and AI assistants summarise; none holds a trusted, permissioned record.",
    moats:
      "The moat is the trusted structure: one canonical record, evidence on every fact.",
    roadmap: "The whole system is specified; what you see is its working core.",
    "why-now":
      "AI can now read a data room like an analyst, at a cost every founder can reach.",
    ask: "Their ask, as they state it: USD two million. Pre-seed, and bootstrapped so far.",
    closing: "Evidence before opinion, and trust over engagement.",
  };
  const text = said[section.key];
  if (text === undefined) {
    throw new Error(`founder track: no line for pitch section ${section.key}`);
  }
  return { text, anchor: pitchSectionAnchor(section.key), open: true };
});

const STEPS: readonly Built[] = [
  step({
    n: 1,
    page: "home",
    part: "intro",
    title: "Q, for founders",
    feature: "FDR-HOME-NEXT",
    route: "/home",
    atlasTab: "FOUNDER",
    spokenNames: ["introduction", "intro", "start"],
    actions: [
      { actionId: "ta_fdr-home", kind: "openRoute", destination: "HOME" },
    ],
    after: [
      {
        text: "Hello, I'm Q, the investment analyst inside Capital Q. Today I'll present Capital Q itself, from the founder's side.",
      },
      {
        text: "From the very beginning, I interview you to onboard you, and learn as much as I can about you and your company, from what you already have. Then I work first.",
      },
      {
        text: "Your home shows the next things worth doing for your raise.",
        claim: true,
        anchor: "fdr.01.home.next-actions",
      },
      {
        text: "And what could stop your raise, said plainly, so you can fix it before an investor finds it.",
        claim: true,
        anchor: "fdr.01.home.stop-raise",
      },
      {
        text: "Everything you'll see is the real product, on a demonstration account with fictional companies and investors.",
      },
    ],
    fixture: "The signed-in founder's own Home",
    forbidden: ["That a next action was completed by Q"],
  }),
  step({
    n: 2,
    page: "pitch",
    part: "capital-q",
    title: "Capital Q, in fourteen sections",
    feature: "FDR-PITCH-BOARD",
    route: "/q-pitch/capital-q",
    atlasTab: "FOUNDER",
    spokenNames: ["the pitch", "capital q pitch", "overview"],
    actions: [
      {
        actionId: "ta_fdr-pitch",
        kind: "openTourPage",
        page: "CAPITAL_Q_PITCH",
      },
    ],
    before: [
      "First, the company itself, on the same fourteen-section template every founder's overview uses.",
    ],
    after: pitchLines,
    fixture:
      "packages/q-pitch/src/capital-q-pitch.ts rendered at /q-pitch/capital-q",
    forbidden: NO_TRACTION,
  }),
  step({
    n: 3,
    page: "discover",
    part: "matches",
    title: "Investors whose bar you meet",
    feature: "FDR-DISCOVER-MATCHES",
    route: "/discover",
    atlasTab: "FOUNDER",
    spokenNames: ["matching investors", "matches", "discover"],
    actions: [
      {
        actionId: "ta_fdr-discover",
        kind: "openRoute",
        destination: "DISCOVER",
      },
    ],
    before: ["Now, finding investors. I find the ones whose bar you meet."],
    after: [
      {
        text: "Each investor here chose to be found. Where they publish a gate, I check your company against each of its criteria: met, not met, or not known yet. Their private mandates never shape this list.",
        claim: true,
        anchor: "fdr.03.discover.list",
      },
      {
        text: "This is the closest match on what they publish: the criteria you meet are marked, and so is anything still unknown.",
        anchor: "fdr.03.discover.match-1",
      },
      {
        text: "The next closest. Where a required criterion isn't met, it says which one, so you know before you apply.",
        anchor: "fdr.03.discover.match-2",
      },
      {
        text: "And the third. Not known yet is never read as a no: it means your profile doesn't say yet.",
        anchor: "fdr.03.discover.match-3",
      },
    ],
    fixture:
      "Discover's Investors tab for the signed-in founder, gates checked against their own company",
    forbidden: [
      "That meeting a gate is a promise of interest",
      "That an investor's private mandate was read",
    ],
  }),
  step({
    n: 4,
    page: "investor",
    part: "profile",
    title: "An investor's page",
    feature: "FDR-INVESTOR-PROFILE",
    route: "/investors/[investorOrganisationId]",
    atlasTab: "FOUNDER",
    spokenNames: ["investor profile", "investor page"],
    actions: [
      {
        actionId: "ta_fdr-investor",
        kind: "openInvestor",
        investor: GATEWAY_INVESTOR,
        page: "PROFILE",
      },
    ],
    before: ["Let's open one investor's page."],
    after: [
      {
        text: "An investor's page shows only what they chose to publish, with the ways forward at the top: apply through their gate, ask to connect, or rehearse a meeting with them.",
        claim: true,
        anchor: "fdr.04.investor.hero",
      },
      {
        text: "What this investor looks for, from their public profile and their published criteria, checked against your company one by one.",
        claim: true,
        anchor: "fdr.04.investor.looks-for",
      },
      {
        text: "How to connect, and whether they take requests right now.",
        anchor: "fdr.04.investor.connect",
      },
      {
        text: "And the facts at a glance: what kind of investor, where they're based, and whether they're deploying.",
        anchor: "fdr.04.investor.facts",
      },
    ],
    fixture:
      "Sahel Bridge Ventures (fictional), as the signed-in founder sees it",
    forbidden: ["That the investor's private thesis is shown"],
  }),
  step({
    n: 5,
    page: "explore",
    part: "pitches",
    title: "Other founders' pitches",
    feature: "FDR-EXPLORE-PITCHES",
    route: "/explore",
    atlasTab: "FOUNDER",
    spokenNames: ["explore", "other founders"],
    actions: [
      { actionId: "ta_fdr-explore", kind: "openRoute", destination: "EXPLORE" },
    ],
    before: ["Explore is the whole network."],
    after: [
      {
        text: "Here you can watch other founders' pitches, muted until you choose, and each AI presenter is labelled as one.",
        claim: true,
        anchor: "fdr.05.explore.mosaic",
      },
      {
        text: "As a founder you watch and learn here. Expressing interest is an investor's action, so founders don't have that button.",
        claim: true,
        anchor: "fdr.05.explore.mosaic",
      },
    ],
    fixture: "Explore for the signed-in founder",
    forbidden: ["That a presenter is the real founder"],
  }),
  step({
    n: 6,
    page: "crm",
    part: "hub",
    title: "Your fundraising hub",
    feature: "FDR-CRM-HUB",
    route: "/relationships",
    atlasTab: "FOUNDER",
    spokenNames: ["crm", "fundraising hub", "hub"],
    actions: [
      {
        actionId: "ta_fdr-hub",
        kind: "openRoute",
        destination: "RELATIONSHIPS",
      },
    ],
    before: [
      "Your CRM is a founder's fundraising hub, not an investor's pipeline.",
    ],
    after: [
      {
        text: "What needs you comes first.",
        anchor: "fdr.06.crm.needs-you",
      },
      {
        text: "Your round: the raise you're running and what investors have committed, which lives in Capital.",
        claim: true,
        anchor: "fdr.06.crm.raise",
      },
      {
        text: "What happened recently with investors.",
        anchor: "fdr.06.crm.activity",
      },
      {
        text: "Your pipeline: every investor relationship and the stage it's at.",
        claim: true,
        anchor: "fdr.06.crm.pipeline",
      },
      {
        text: "Your rehearsals, who has seen your company, and the documents I've prepared for you.",
        anchor: "fdr.06.crm.seen",
      },
    ],
    fixture: "The signed-in founder's CRM overview",
    forbidden: ["Any figure on screen as a Capital Q result"],
  }),
  step({
    n: 7,
    page: "crm",
    part: "pipeline",
    title: "Your investor pipeline",
    feature: "FDR-CRM-PIPELINE",
    route: "/relationships",
    atlasTab: "FOUNDER",
    spokenNames: ["pipeline"],
    actions: [
      {
        actionId: "ta_fdr-pipeline",
        kind: "openRoute",
        destination: "CRM_PIPELINE",
      },
    ],
    after: [
      {
        text: "The pipeline: one canonical relationship per investor, the same record they see from their side, with its stage derived from what actually happened.",
        claim: true,
        anchor: "fdr.07.crm.pipeline",
      },
    ],
    fixture: "The signed-in founder's pipeline",
    forbidden: ["That a stage was set by a model"],
  }),
  step({
    n: 8,
    page: "capital",
    part: "raise",
    title: "Capital: your raise",
    feature: "FDR-CAPITAL-RAISE",
    route: "/relationships",
    atlasTab: "FOUNDER",
    spokenNames: ["capital", "raise", "commitments"],
    actions: [
      {
        actionId: "ta_fdr-capital",
        kind: "openRoute",
        destination: "CAPITAL_RAISE",
      },
    ],
    before: ["Capital is where the business of the raise actually happens."],
    after: [
      {
        text: "Your round as you set it: what you're raising, on what terms, and how much is committed against it.",
        claim: true,
        anchor: "fdr.08.capital.round",
      },
      {
        text: "Commitments: money an investor commits, or that I hear agreed in a call and you confirm, lands here, each with its investor and status.",
        claim: true,
        anchor: "fdr.08.capital.commitments",
      },
      {
        text: "And your rounds over time: earlier, now and next.",
        anchor: "fdr.08.capital.rounds",
      },
    ],
    fixture: "The signed-in founder's Capital, Raise tab",
    forbidden: [
      "Any committed amount on screen as a Capital Q result",
      "That a commitment is a closed investment",
    ],
  }),
  step({
    n: 9,
    page: "gateq",
    part: "apply",
    title: "Applying through GateQ",
    feature: "FDR-GATEQ-DRAFT",
    route: "/investors/[investorOrganisationId]",
    atlasTab: "GATEQ",
    spokenNames: ["gateq", "apply", "application", "gateway"],
    actions: [
      {
        actionId: "ta_fdr-gateq",
        kind: "openInvestor",
        investor: GATEWAY_INVESTOR,
        page: "PROFILE",
      },
    ],
    before: ["Now GateQ, from your side: applying through an investor's gate."],
    after: [
      {
        text: "Their gate is their published bar. You can see where you stand before you apply.",
        anchor: "fdr.09.gateq.criteria",
      },
      {
        text: "I draft the application from your own profile. Watch it fill.",
        claim: true,
        anchor: "fdr.09.gateq.draft",
      },
      { text: "Your company.", anchor: "fdr.09.gateq.field-company" },
      { text: "Its one line.", anchor: "fdr.09.gateq.field-line" },
      { text: "Your stage.", anchor: "fdr.09.gateq.field-stage" },
      { text: "And where you're based.", anchor: "fdr.09.gateq.field-country" },
      {
        text: "Nothing is sent until you review it and press Send yourself. I prepare; you decide.",
        claim: true,
        anchor: "fdr.09.gateq.send",
      },
    ],
    fixture:
      "Sahel Bridge Ventures (fictional): the draft section, prefilled from the founder's own profile, never submitted",
    forbidden: ["That an application was sent"],
  }),
  step({
    n: 10,
    page: "gateq",
    part: "interview",
    title: "The GateQ interview",
    feature: "FDR-GATEQ-INTERVIEW",
    route: "/gateq",
    atlasTab: "GATEQ",
    spokenNames: ["interview", "gateq interview"],
    actions: [
      {
        actionId: "ta_fdr-gateq-apps",
        kind: "openRoute",
        destination: "GATEQ_APPLICATIONS",
      },
    ],
    after: [
      {
        text: "Once you apply, I interview you on the investor's behalf: a short conversation, by voice or video, about the things their gate cares about.",
        claim: true,
        anchor: "fdr.10.gateq.applications",
      },
      {
        text: "The investor then receives your application in the same structure as every other: your own words, my reading of them, and a dossier. Your claims stay labelled as your claims.",
        claim: true,
        anchor: "fdr.10.gateq.applications",
      },
      {
        text: "Your applications and their status live here. In a moment you'll hear me do the same kind of conversation for real, in a rehearsal.",
        anchor: "fdr.10.gateq.applications",
      },
    ],
    fixture: "GateQ, the signed-in founder's applications tab",
    forbidden: [
      "That a live interview ran in this step",
      "That the founder's statements are verified",
    ],
  }),
  step({
    n: 11,
    page: "relationship",
    part: "record",
    title: "A relationship, and a meeting",
    feature: "FDR-RELATIONSHIP-RECORD",
    route: "/relationships/investor/[investorOrganisationId]",
    atlasTab: "MEETINGS",
    spokenNames: ["relationship", "meeting", "record"],
    actions: [
      {
        actionId: "ta_fdr-record",
        kind: "openInvestor",
        investor: RECORD_INVESTOR,
        page: "RELATIONSHIP",
      },
    ],
    before: [
      "When an investor accepts, you're connected, and everything lives in one record.",
    ],
    after: [
      {
        text: "The deal, its stage and the next step.",
        anchor: "fdr.11.relationship.deal",
      },
      {
        text: "What happened, dated, each entry marked with who can see it.",
        claim: true,
        anchor: "fdr.11.relationship.history",
      },
      {
        text: "Your private notes stay yours.",
        anchor: "fdr.11.relationship.notes",
      },
      {
        text: "From here you chat with the investor and book a meeting through the record's own booking flow. I can join the call, take notes, and afterwards ask you to confirm any commitments.",
        claim: true,
        anchor: "fdr.11.relationship.next",
      },
    ],
    fixture:
      "The signed-in founder's relationship with Savanna Seed Partners (fictional)",
    forbidden: ["That a meeting was booked or a message sent"],
  }),
  step({
    n: 12,
    page: "notifications",
    part: "panel",
    title: "When something happens",
    feature: "FDR-NOTIFICATIONS",
    route: "/relationships/investor/[investorOrganisationId]",
    atlasTab: "MEETINGS",
    spokenNames: ["notifications"],
    actions: [
      {
        actionId: "ta_fdr-notifications",
        kind: "uiAct",
        act: "OPEN",
        target: "dialog.notifications",
      },
    ],
    after: [
      {
        text: "When a meeting is booked or an investor replies, the notification arrives here: what needs you first, then updates.",
        claim: true,
      },
    ],
    fixture: "The signed-in founder's notification panel",
    forbidden: ["Any notification as a result Capital Q produced"],
  }),
  step({
    n: 13,
    page: "rehearsal",
    part: "q2q",
    title: "A rehearsal: Q presents Capital Q",
    feature: "FDR-REHEARSAL-Q2Q",
    route: "/rehearsals/investor/[investorOrganisationId]",
    atlasTab: "REHEARSALS",
    spokenNames: ["rehearsal", "rehearse", "practice"],
    actions: [
      {
        actionId: "ta_fdr-rehearse-open",
        kind: "openInvestor",
        investor: RECORD_INVESTOR,
        page: "REHEARSE",
      },
    ],
    // Prepared, not live (16 Oct finding): a live persona rehearses the
    // SIGNED-IN founder's own company, so on any account but Capital Q's
    // it would question that company, not Capital Q. The owner allows a
    // precomputed exchange; it is said aloud that it is one.
    before: [
      "Before a real meeting, you rehearse with an investor persona. Here's a short prepared exchange: the persona's questions, and me presenting Capital Q as its founder. It's a demonstration, not a live session.",
    ],
    after: [
      {
        text: "The persona asks: thanks for making the time. What does Capital Q do, and why now?",
        anchor: "fdr.13.rehearsal.stage",
      },
      {
        text: "Presenting, I answer: thank you for having me. Capital Q is an investment intelligence system for private capital. Every company presents itself differently, so investors start from scratch and good companies are missed. We put every company in one standard, evidence-labelled structure, and AI can now read like an analyst at a cost every founder can reach.",
        anchor: "fdr.13.rehearsal.stage",
      },
      {
        text: "The persona presses: what can you show us today, and what is still an estimate?",
        anchor: "fdr.13.rehearsal.stage",
      },
      {
        text: "Presenting: everything you've seen today works on the real product, with demonstration companies labelled as such. We're pre-seed and bootstrapping, so we claim no traction, revenue or market size yet.",
        anchor: "fdr.13.rehearsal.stage",
      },
      {
        text: "The persona: and what are you raising?",
        anchor: "fdr.13.rehearsal.stage",
      },
      {
        text: "Presenting: a raise of USD two million, as we state it. What would you want to see from us before a next meeting?",
        anchor: "fdr.13.rehearsal.stage",
      },
      {
        text: "In a real rehearsal, you speak and I play the investor by voice, from a persona built only from what you may see about them. Afterwards I review the call: what went right, what to improve, tips for that meeting, and the full transcript.",
        claim: true,
        anchor: "fdr.13.rehearsal.stage",
      },
    ],
    fixture:
      "The rehearsal lobby for Savanna Seed Partners (fictional persona); the exchange is prepared narration, no session is started",
    forbidden: [
      "That the prepared exchange was a live session",
      "That the investor persona is the real investor",
    ],
  }),
  step({
    n: 14,
    page: "rehearsals",
    part: "home",
    title: "Your rehearsals",
    feature: "FDR-REHEARSALS-HOME",
    route: "/rehearsals",
    atlasTab: "REHEARSALS",
    spokenNames: ["rehearsals", "past rehearsals"],
    actions: [
      {
        actionId: "ta_fdr-rehearsals",
        kind: "openRoute",
        destination: "REHEARSALS",
      },
    ],
    after: [
      {
        text: "You pick who to practise with, I play them by voice, and every rehearsal is reviewed.",
        claim: true,
        anchor: "fdr.14.rehearsals.start",
      },
      {
        text: "Every rehearsal you run is saved here with its review and score, so you can see what improved from one to the next.",
        claim: true,
        anchor: "fdr.14.rehearsals.history",
      },
    ],
    fixture: "The signed-in founder's Rehearsals page",
    forbidden: ["That a rehearsal is a real meeting"],
  }),
  step({
    n: 15,
    page: "daily",
    part: "paper",
    title: "The Q Daily",
    feature: "FDR-DAILY",
    route: "/daily",
    atlasTab: "DAILY",
    spokenNames: ["daily", "q daily", "news"],
    actions: [
      { actionId: "ta_fdr-daily", kind: "openRoute", destination: "DAILY" },
    ],
    after: [
      {
        text: "The Q Daily is a newspaper written for you, on your sector and your raise, with every story's source named. It comes on the schedule you choose, and you can switch it off.",
        claim: true,
        anchor: "fdr.15.daily.paper",
      },
    ],
    fixture: "The signed-in founder's Q Daily (in whatever state it is)",
    forbidden: ["That a story is Capital Q's own reporting"],
  }),
  step({
    n: 16,
    page: "work",
    part: "team",
    title: "Q's team at work",
    feature: "FDR-WORK-TEAM",
    route: "/work",
    atlasTab: "Q_WORK",
    spokenNames: ["agents", "work", "team", "q work"],
    actions: [
      { actionId: "ta_fdr-work", kind: "openRoute", destination: "WORK_TEAM" },
    ],
    after: [
      {
        text: "And the work. You can ask me to act for you: follow up with an investor, prepare a document, keep your profile current. Behind me is a team of specialists, a planner, a drafter, a reviewer and others, each shown with what it's doing.",
        claim: true,
        anchor: "fdr.16.work.team",
      },
      {
        text: "Anything consequential waits for your approval, exactly as I prepared it.",
        claim: true,
        anchor: "fdr.16.work.team",
      },
    ],
    fixture: "The signed-in founder's Work, team view",
    forbidden: ["That an agent acted without approval"],
  }),
  step({
    n: 17,
    page: "home",
    part: "close",
    title: "Over to you",
    feature: "FDR-HANDOVER",
    route: "/home",
    atlasTab: "FOUNDER",
    spokenNames: ["end", "close", "questions"],
    actions: [
      { actionId: "ta_fdr-close", kind: "openRoute", destination: "HOME" },
    ],
    after: [
      {
        text: "That's Capital Q from the founder's side: I work first, I find the investors whose bar you meet, I prepare and you decide, and every claim stays labelled for what it is.",
      },
      {
        text: "Capital Q is pre-seed and bootstrapping, and I've shown only what works today. Ask me anything about it now.",
      },
    ],
    fixture: "The signed-in founder's Home",
    forbidden: NO_TRACTION,
  }),
];

/**
 * The presenter's side of a LIVE Q-to-Q rehearsal (runShortRehearsal): Q
 * speaks as the founder of Capital Q presenting to the investor persona.
 * Prepared lines only, in character as presenting; nothing invented.
 * Coherent only on Capital Q's own founder account, because the persona
 * rehearses the signed-in founder's company (live run, 16 Oct: on a demo
 * founder it asked about that company). The default track uses the
 * prepared exchange in step thirteen instead.
 */
export const FOUNDER_V6_PRESENTER_LINES: readonly ApprovedQuestion[] = [
  {
    questionId: "q.fdr-present-open",
    text: "Thank you for having me. I'm presenting Capital Q, an investment intelligence system for private capital. We're pre-seed and bootstrapping, so I'll keep to what we can show you working today.",
  },
  {
    questionId: "q.fdr-present-problem",
    text: "The problem we solve is information asymmetry. Every company presents itself differently, so investors start from scratch and good companies are missed. Capital Q puts every company in one standard, evidence-labelled structure, and our analyst, Q, matches it to declared mandates.",
  },
  {
    questionId: "q.fdr-present-ask",
    text: "Our ask, as we state it, is a USD 2 million raise. We have no traction figures to claim yet, and we won't invent any. What would you want to see from us before a next meeting?",
  },
];

export const FOUNDER_V6_SCRIPT: TourScript = TourScriptSchema.parse({
  scriptId: "tour.founder-v6",
  scriptVersion: "6.0.0-draft",
  status: "DRAFT",
  reviewNote:
    "Founder track v6 (Lane qpf, 16 Oct): owner review of wording; browser receipts on production promote ledger entries from CODE_VERIFIED.",
  chapters: STEPS.map((s) => s.chapter),
  scenes: STEPS.map((s) => s.scene),
  questions: [...FOUNDER_V6_PRESENTER_LINES],
});

export const FOUNDER_V6_LEDGER: CertificationLedger =
  CertificationLedgerSchema.parse(STEPS.map((s) => s.entry));
