import type { RelationshipBrief } from "@capital-q/contracts";
import type { JobPlanResultV6 } from "@capital-q/q-core";
import type {
  RelationshipOverview,
  StepResult,
} from "@capital-q/q-orchestrator";

/**
 * Workforce intelligence scenarios (wf 2026-10-16): realistic multi-step
 * jobs, each with the situation Capital Q would read for the person, what
 * the job's agents would report, and what a good outcome looks like.
 *
 * Synthetic and fictional only (no production data). Each case is scored
 * on plan quality and task completion, not on which tools were called.
 * `scripted` is a strong plan of the kind JOB_PLAN v5 should produce: in
 * fake mode it drives the real engine (situation, grounding, bounding,
 * runner, progress); in live mode the real planner's own plan is graded
 * against the same expectations.
 */

export type WorkforceScenarioExpectation = {
  /** Executor roles the plan must include. */
  readonly roles: readonly string[];
  /** [before, after]: a step of `after` waits (transitively) on one of `before`. */
  readonly order: readonly (readonly [string, string])[];
  /** Roles that must be able to run side by side (neither waits on the other). */
  readonly parallel: readonly (readonly [string, string])[];
  /** Each must match a prerequisite the plan says is MISSING or UNKNOWN. */
  readonly gaps: readonly RegExp[];
  /** Each must match a next action after the run. */
  readonly next: readonly RegExp[];
  /** Tools that, as a next action, must be marked as needing approval. */
  readonly approvalFor: readonly string[];
  /** An outward step must be held because a contradiction was found. */
  readonly holdsOutward: boolean;
  /** A fallback must have stood in for a step that did not finish. */
  readonly usesFallback: boolean;
  /** How the job should end. */
  readonly jobStatus: "DONE" | "HELD";
};

export type WorkforceScenario = {
  readonly id: string;
  readonly title: string;
  readonly side: "INVESTOR" | "FOUNDER";
  /** The account a live run uses (fictional). */
  readonly account: string;
  readonly goal: string;
  readonly briefs: readonly RelationshipBrief[];
  readonly overview?: RelationshipOverview | null | undefined;
  readonly waiting?: readonly { readonly summary: string }[] | undefined;
  /** The goal names exactly one company on record (binds NAMED_COMPANY). */
  readonly namedCompanyId: string | null;
  readonly permitted: readonly string[];
  readonly scripted: JobPlanResultV6;
  /** What each step reports, by key; absent: DONE with no outputs. */
  readonly behaviour: Readonly<Record<string, StepResult>>;
  readonly expect: WorkforceScenarioExpectation;
};

const NOW = "2026-10-15T09:00:00.000Z";
const DAYS_AGO = (days: number) =>
  new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

const ID = {
  harbourline: "4f1c2a8e-0b7d-4e57-9a10-3c2b5d6e7f01",
  harbourlineRel: "4f1c2a8e-0b7d-4e57-9a10-3c2b5d6e7f02",
  savanna: "4f1c2a8e-0b7d-4e57-9a10-3c2b5d6e7f03",
  savannaRel: "4f1c2a8e-0b7d-4e57-9a10-3c2b5d6e7f04",
  ledgerfold: "4f1c2a8e-0b7d-4e57-9a10-3c2b5d6e7f05",
  ledgerfoldRel: "4f1c2a8e-0b7d-4e57-9a10-3c2b5d6e7f06",
  meeting: "4f1c2a8e-0b7d-4e57-9a10-3c2b5d6e7f07",
  request1: "4f1c2a8e-0b7d-4e57-9a10-3c2b5d6e7f08",
  request2: "4f1c2a8e-0b7d-4e57-9a10-3c2b5d6e7f09",
  document: "4f1c2a8e-0b7d-4e57-9a10-3c2b5d6e7f0a",
} as const;

const VERSIONS = {
  projector: "relationship-state.v2",
  historySequence: 12,
  brief: "relationship-brief.v1" as const,
};

const ALL_TOOLS = [
  "search_companies",
  "list_my_relationships",
  "relationship.interest.express",
  "list_messages",
  "chat.message.send",
  "find_meeting_times",
  "list_schedule",
  "schedule.meeting.book",
  "public_web.search",
  "documents.own.prepare",
  "diligence.questions.prepare",
];

/** An investor team preparing for diligence on a company they met. */
const DILIGENCE_PREP: WorkforceScenario = {
  id: "investor.diligence-prep",
  title: "Diligence preparation after a first meeting",
  side: "INVESTOR",
  account: "investor.savanna-seed@fictional.capitalq.local",
  goal: "We're going into diligence on Harbourline Cargo next week. Get the team ready.",
  briefs: [
    {
      relationshipId: ID.harbourlineRel,
      yourSide: "INVESTOR",
      counterparty: {
        kind: "COMPANY",
        id: ID.harbourline,
        name: "Harbourline Cargo",
      },
      generatedAt: NOW,
      state: {
        state: "MEETING_HELD",
        stateSince: DAYS_AGO(3),
        milestones: [],
        nextStep: "DECIDE_NEXT_STEP",
      },
      messages: {
        count: 9,
        latest: { status: "OK", message: null, fromThem: null },
      },
      noShows: [],
      meetings: {
        status: "OK",
        items: [
          {
            id: ID.meeting,
            status: "SCHEDULED",
            startsAt: DAYS_AGO(3),
            endsAt: DAYS_AGO(3),
            timing: "PAST",
            organisedByYou: true,
            noShow: false,
          },
        ],
        nextScheduled: null,
      },
      pendingDecisions: {
        items: [{ kind: "DECIDE_NEXT_STEP", owner: "YOU", since: DAYS_AGO(3) }],
        complete: true,
      },
      obligations: {
        status: "OK",
        openRequests: [
          { id: ID.request1, title: "Unit economics by lane" },
          {
            id: ID.request2,
            title: "Top ten customers and their share of revenue",
          },
        ],
        answeredCount: 1,
      },
      documents: {
        status: "OK",
        items: [
          { id: ID.document, title: "Seed deck", openedByYourSide: true },
        ],
      },
      sourceVersions: VERSIONS,
    },
  ],
  namedCompanyId: ID.harbourline,
  permitted: ALL_TOOLS,
  scripted: {
    summary:
      "Research the market, a memo critiqued by a second specialist, and founder questions on the open gaps.",
    outcome:
      "The team walks into Harbourline Cargo's diligence with a memo they can rely on and the open questions already asked.",
    prerequisites: [
      {
        what: "Unit economics by lane",
        status: "MISSING",
        blocking: true,
        evidence: ["F4"],
        resolvedBy: "questions",
      },
      {
        what: "Customer concentration (top ten customers' share)",
        status: "MISSING",
        blocking: true,
        evidence: ["F5"],
        resolvedBy: "questions",
      },
      {
        what: "Independent view of the freight-forwarding market",
        status: "UNKNOWN",
        blocking: false,
        evidence: [],
        resolvedBy: "market",
      },
    ],
    steps: [
      {
        key: "market",
        role: "RESEARCH",
        goal: "Public research on Harbourline Cargo's market and competitors, with sources",
        tools: ["public_web.search"],
        dependsOn: [],
        why: "An outside view to test the founder's claims against.",
        evidence: [],
        fallbackFor: null,
      },
      {
        key: "memo",
        role: "DOCUMENTS",
        goal: "Diligence memo on Harbourline Cargo from the research and the material shared",
        tools: ["documents.own.prepare"],
        // Diligence audit 2026-10-28: the memo is written from the research,
        // so it waits on it; it critiques and revises itself (no review step).
        dependsOn: ["market"],
        document: {
          operation: "PREPARE",
          kind: "MEMO",
          scope: "NAMED_COMPANY",
        },
        why: "The team needs one document to work from.",
        evidence: ["F1", "F7"],
        fallbackFor: null,
      },
      {
        key: "questions",
        role: "DILIGENCE",
        goal: "Founder questions on unit economics, concentration and the memo's gaps",
        tools: ["diligence.questions.prepare"],
        dependsOn: ["memo"],
        why: "Two diligence requests are still open.",
        evidence: ["F4", "F5"],
        fallbackFor: null,
      },
    ],
    nextActions: [
      {
        action: "Decide whether to move Harbourline Cargo into diligence",
        why: "The meeting was held and the next step is yours.",
        evidence: ["F2"],
        tool: null,
      },
      {
        action: "Approve the founder questions",
        why: "Nothing is sent until you do.",
        evidence: [],
        tool: "diligence.questions.prepare",
      },
    ],
    cannot: [],
  },
  behaviour: {
    memo: {
      status: "DONE",
      summary:
        'Wrote "Harbourline Cargo: diligence memo"; 1 reviewer point is still open and noted in it.',
      outputs: {
        artifactId: "artifact-memo",
        companyId: "company",
        signals: [
          {
            kind: "MISSING_INFORMATION",
            note: "Unit economics: margin by lane is not known",
            stepKey: "memo",
          },
        ],
      },
    },
  },
  expect: {
    roles: ["RESEARCH", "DOCUMENTS", "DILIGENCE"],
    order: [
      ["RESEARCH", "DOCUMENTS"],
      ["DOCUMENTS", "DILIGENCE"],
    ],
    parallel: [],
    gaps: [/unit economics|margin/iu, /customer|concentration/iu],
    next: [/decide|diligence/iu],
    approvalFor: ["diligence.questions.prepare"],
    holdsOutward: false,
    usesFallback: false,
    jobStatus: "DONE",
  },
};

/** A founder following up after a GateQ application was accepted. */
const GATEQ_FOLLOW_UP: WorkforceScenario = {
  id: "founder.gateq-follow-up",
  title: "Follow-up after a GateQ application",
  side: "FOUNDER",
  account: "babatunde.tunde-cargo@fictional.capitalq.local",
  goal: "Savanna Seed accepted my GateQ application. Follow up and get a first call booked.",
  briefs: [
    {
      relationshipId: ID.savannaRel,
      yourSide: "COMPANY",
      counterparty: {
        kind: "INVESTOR_ORGANISATION",
        id: ID.savanna,
        name: "Savanna Seed",
      },
      generatedAt: NOW,
      state: {
        state: "CONNECTED",
        stateSince: DAYS_AGO(2),
        milestones: [],
        nextStep: "SCHEDULE_MEETING",
      },
      messages: {
        count: 2,
        latest: {
          status: "OK",
          message: {
            from: "OTHER_SIDE",
            senderName: "Amara",
            kind: "TEXT",
            delivery: "SENT",
            viaQ: false,
            sentAt: DAYS_AGO(1),
            preview: null,
          },
          fromThem: {
            from: "OTHER_SIDE",
            senderName: "Amara",
            kind: "TEXT",
            delivery: "SENT",
            viaQ: false,
            sentAt: DAYS_AGO(1),
            preview: null,
          },
        },
      },
      noShows: [],
      meetings: { status: "OK", items: [], nextScheduled: null },
      pendingDecisions: {
        items: [
          { kind: "REPLY_TO_MESSAGE", owner: "YOU", since: DAYS_AGO(1) },
          { kind: "SCHEDULE_MEETING", owner: "YOU", since: DAYS_AGO(2) },
        ],
        complete: true,
      },
      obligations: { status: "OK", openRequests: [], answeredCount: 0 },
      documents: { status: "OK", items: [] },
      sourceVersions: VERSIONS,
    },
  ],
  namedCompanyId: null,
  permitted: ALL_TOOLS,
  scripted: {
    summary:
      "Reply to Savanna Seed, book a first call, and if booking fails offer times in the thread.",
    outcome:
      "A first call with Savanna Seed is set, and their message is answered.",
    prerequisites: [
      {
        what: "Savanna Seed has accepted the connection",
        status: "MET",
        blocking: true,
        evidence: ["F1"],
        resolvedBy: null,
      },
      {
        what: "Your calendar is connected so times can be checked",
        status: "UNKNOWN",
        blocking: false,
        evidence: [],
        resolvedBy: null,
      },
    ],
    steps: [
      {
        key: "reply",
        role: "CONVERSATION",
        goal: "Answer Savanna Seed's latest message warmly",
        tools: ["list_messages", "chat.message.send"],
        dependsOn: [],
        why: "They wrote last and are waiting.",
        evidence: ["F2", "F4"],
        fallbackFor: null,
      },
      {
        key: "book",
        role: "SCHEDULING",
        goal: "Book a first call at a free slot",
        tools: ["find_meeting_times", "schedule.meeting.book"],
        dependsOn: ["reply"],
        why: "The outcome is a booked call.",
        evidence: ["F3"],
        fallbackFor: null,
      },
      {
        key: "offer_times",
        role: "CONVERSATION",
        goal: "Offer three times in the thread instead",
        tools: ["list_messages", "chat.message.send"],
        dependsOn: [],
        why: "If a booking cannot be made, they can still pick a time.",
        evidence: ["F3"],
        fallbackFor: "book",
      },
    ],
    nextActions: [
      {
        action: "Prepare a one-pager for the call",
        why: "First calls go better with a short brief.",
        evidence: [],
        tool: "documents.own.prepare",
      },
    ],
    cannot: [],
  },
  behaviour: {
    book: {
      status: "FAILED",
      summary: "No free slot could be checked: the calendar is not connected.",
    },
  },
  expect: {
    roles: ["CONVERSATION", "SCHEDULING"],
    order: [["CONVERSATION", "SCHEDULING"]],
    parallel: [],
    gaps: [/calendar/iu],
    next: [/one-pager|brief|prepare/iu],
    approvalFor: ["documents.own.prepare"],
    holdsOutward: false,
    usesFallback: true,
    jobStatus: "DONE",
  },
};

/** A founder preparing a round, naming no one. */
const ROUND_PREP: WorkforceScenario = {
  id: "founder.round-prep",
  title: "Fundraising round preparation",
  side: "FOUNDER",
  account: "babatunde.tunde-cargo@fictional.capitalq.local",
  goal: "Help me get ready to raise our seed round.",
  briefs: [],
  overview: {
    items: [
      {
        name: "Savanna Seed",
        state: "CONNECTED",
        stateSince: DAYS_AGO(2),
        nextStep: "SCHEDULE_MEETING",
        lastFrom: "THEM",
        lastAt: DAYS_AGO(1),
      },
      {
        name: "Kestrel Ventures",
        state: "MEETING_HELD",
        stateSince: DAYS_AGO(8),
        nextStep: "FOLLOW_UP",
        lastFrom: "YOU",
        lastAt: DAYS_AGO(7),
      },
      {
        name: "Baobab Partners",
        state: "INTEREST_EXPRESSED",
        stateSince: DAYS_AGO(4),
        nextStep: "ANSWER_INTEREST",
        lastFrom: null,
        lastAt: null,
      },
    ],
  },
  namedCompanyId: null,
  permitted: ALL_TOOLS,
  scripted: {
    summary:
      "A pitch deck and one-pager critiqued by a second specialist, and replies to investors waiting on you.",
    outcome:
      "Materials an investor can rely on, and every investor already talking to you answered.",
    prerequisites: [
      {
        what: "How much you are raising and on what terms",
        status: "UNKNOWN",
        blocking: true,
        evidence: [],
        resolvedBy: null,
      },
      {
        what: "An up-to-date pitch deck",
        status: "UNKNOWN",
        blocking: true,
        evidence: [],
        resolvedBy: "deck",
      },
    ],
    steps: [
      {
        key: "deck",
        role: "DOCUMENTS",
        goal: "Prepare the pitch deck from your company's material",
        tools: ["documents.own.prepare"],
        dependsOn: [],
        document: {
          operation: "PREPARE",
          kind: "PITCH_DECK",
          scope: "OWN_COMPANY",
        },
        why: "Investors will ask for it first.",
        evidence: [],
        fallbackFor: null,
      },
      {
        key: "deck_review",
        role: "DOCUMENTS",
        goal: "Second specialist critiques and revises the deck",
        tools: ["documents.own.prepare"],
        dependsOn: ["deck"],
        document: { operation: "CRITIQUE_AND_REVISE", sourceStep: "deck" },
        why: "Claims should read as claims before investors see them.",
        evidence: [],
        fallbackFor: null,
      },
      {
        key: "replies",
        role: "CONVERSATION",
        goal: "Reply to investors waiting on you",
        tools: ["list_messages", "chat.message.send"],
        dependsOn: [],
        why: "Savanna Seed wrote last and is waiting.",
        evidence: ["F3"],
        fallbackFor: null,
      },
    ],
    nextActions: [
      {
        action: "Tell Q the round size and terms you are aiming for",
        why: "The materials and outreach depend on it, and it is not on record.",
        evidence: [],
        tool: null,
      },
      {
        action: "Answer Baobab Partners' interest",
        why: "They expressed interest four days ago.",
        evidence: ["F4"],
        tool: "relationship.interest.respond",
      },
    ],
    cannot: [],
  },
  behaviour: {},
  expect: {
    roles: ["DOCUMENTS", "CONVERSATION"],
    order: [],
    parallel: [["DOCUMENTS", "CONVERSATION"]],
    gaps: [/rais|round|terms|amount/iu],
    next: [/round size|terms/iu, /baobab/iu],
    approvalFor: ["relationship.interest.respond"],
    holdsOutward: false,
    usesFallback: false,
    jobStatus: "DONE",
  },
};

/** A contradiction the critic finds halfway through. */
const CONTRADICTION: WorkforceScenario = {
  id: "investor.contradiction-mid-task",
  title: "A contradiction found mid-task",
  side: "INVESTOR",
  account: "investor.savanna-seed@fictional.capitalq.local",
  goal: "Write up Ledgerfold for the partners, have it checked, then thank the founder and send our follow-up questions.",
  briefs: [
    {
      relationshipId: ID.ledgerfoldRel,
      yourSide: "INVESTOR",
      counterparty: { kind: "COMPANY", id: ID.ledgerfold, name: "Ledgerfold" },
      generatedAt: NOW,
      state: {
        state: "IN_DILIGENCE",
        stateSince: DAYS_AGO(5),
        milestones: [],
        nextStep: "NONE",
      },
      messages: {
        count: 14,
        latest: { status: "OK", message: null, fromThem: null },
      },
      noShows: [],
      meetings: { status: "UNAVAILABLE", reason: "READ_FAILED" },
      pendingDecisions: { items: [], complete: false },
      obligations: { status: "OK", openRequests: [], answeredCount: 3 },
      documents: {
        status: "OK",
        items: [
          {
            id: ID.document,
            title: "Financial model FY26",
            openedByYourSide: true,
          },
        ],
      },
      sourceVersions: VERSIONS,
    },
  ],
  namedCompanyId: ID.ledgerfold,
  permitted: ALL_TOOLS,
  scripted: {
    summary:
      "Research Ledgerfold, write a diligence memo that checks its claims, founder questions from its gaps, then a thank-you to the founder.",
    outcome:
      "The partners get a memo they can rely on, and the founder is thanked with the questions that remain.",
    prerequisites: [
      {
        what: "Whether a call is already booked with Ledgerfold",
        status: "UNKNOWN",
        blocking: false,
        evidence: ["F3"],
        resolvedBy: null,
      },
    ],
    steps: [
      // Diligence audit 2026-10-28: research first, then the memo, which
      // critiques and revises itself (no CRITIQUE_AND_REVISE step).
      {
        key: "dig",
        role: "RESEARCH",
        goal: "Ledgerfold's founders and team, customers, litigation and regulatory record, prior funding, reported revenue, competitors and market",
        tools: ["public_web.search"],
        dependsOn: [],
        why: "The memo must test Ledgerfold's figures against public evidence.",
        evidence: [],
        fallbackFor: null,
      },
      {
        key: "memo",
        role: "DOCUMENTS",
        goal: "Diligence memo on Ledgerfold",
        tools: ["documents.own.prepare"],
        dependsOn: ["dig"],
        document: {
          operation: "PREPARE",
          kind: "MEMO",
          scope: "NAMED_COMPANY",
        },
        why: "The partners asked for a write-up.",
        evidence: ["F1", "F5"],
        fallbackFor: null,
      },
      {
        key: "questions",
        role: "DILIGENCE",
        goal: "Founder questions from the memo's gaps",
        tools: ["diligence.questions.prepare"],
        dependsOn: ["memo"],
        why: "What is not known should be asked, not guessed.",
        evidence: [],
        fallbackFor: null,
      },
      {
        key: "thanks",
        role: "CONVERSATION",
        goal: "Thank the founder and say questions follow",
        tools: ["list_messages", "chat.message.send"],
        dependsOn: ["memo"],
        why: "The person asked for it.",
        evidence: [],
        fallbackFor: null,
      },
    ],
    nextActions: [
      {
        action: "Share the memo with the partners once you have read it",
        why: "Sharing is yours to do.",
        evidence: [],
        tool: null,
      },
    ],
    cannot: ["Sharing the memo with the partners outside Capital Q."],
  },
  behaviour: {
    memo: {
      status: "DONE",
      summary:
        'Wrote "Ledgerfold: diligence memo"; a second analyst reviewed it and it passed.',
      outputs: {
        artifactId: "artifact-memo",
        companyId: "company",
        signals: [
          {
            kind: "CONTRADICTION",
            note: "Revenue: the deck says $1.2M ARR, the FY26 model says $0.8M",
            stepKey: "memo",
          },
        ],
      },
    },
  },
  expect: {
    roles: ["RESEARCH", "DOCUMENTS", "DILIGENCE", "CONVERSATION"],
    order: [
      ["RESEARCH", "DOCUMENTS"],
      ["DOCUMENTS", "DILIGENCE"],
      ["DOCUMENTS", "CONVERSATION"],
    ],
    parallel: [],
    gaps: [],
    next: [/reconcile/iu],
    approvalFor: [],
    holdsOutward: true,
    usesFallback: false,
    jobStatus: "HELD",
  },
};

/**
 * A decision stated with the work (live 2026-10-16): the team prepares the
 * diligence, and recording "into diligence" is the person's first next
 * action, needing their approval -- never done instead of the work.
 */
const DECISION_WITH_WORK: WorkforceScenario = {
  ...DILIGENCE_PREP,
  id: "investor.decision-with-work",
  title: "A relationship decision stated with preparation work",
  goal: "We're going into diligence on Harbourline Cargo next week. Get the team ready.",
  scripted: {
    ...DILIGENCE_PREP.scripted,
    nextActions: [
      {
        action: "Record that Harbourline Cargo has moved into diligence",
        why: "You stated the decision; recording it is yours to approve.",
        evidence: ["F2"],
        tool: "relationship.outcome.change",
      },
      ...DILIGENCE_PREP.scripted.nextActions.filter((one) => one.tool !== null),
    ],
  },
  expect: {
    ...DILIGENCE_PREP.expect,
    next: [/moved into diligence/iu],
    approvalFor: ["relationship.outcome.change", "diligence.questions.prepare"],
  },
};

export const WORKFORCE_SCENARIOS: readonly WorkforceScenario[] = [
  DILIGENCE_PREP,
  GATEQ_FOLLOW_UP,
  ROUND_PREP,
  CONTRADICTION,
  DECISION_WITH_WORK,
];
