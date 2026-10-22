import {
  NotificationDtoSchema,
  QApprovalViewSchema,
  QPendingApprovalSchema,
  QWorkDetailDtoSchema,
  QWorkDtoSchema,
  WorkforceJobDetailDtoSchema,
  WorkforceOverviewDtoSchema,
  type MediaAssetDto,
  type NotificationDto,
  type PitchSectionFactDto,
  type QApprovalView,
  type QDailyEdition,
  type QDailyStory,
  type QPendingApproval,
  type QRehearsalDto,
  type QRehearsalListDto,
  type QRehearsalPartnersDto,
  type QRehearsalSummaryDto,
  type QWorkDetailDto,
  type QWorkDonePageDto,
  type QWorkDto,
  type QWorkReportDto,
  type QWorkSuggestionDto,
  type WorkforceJobDetailDto,
  type WorkforceOverviewDto,
} from "@capital-q/contracts";

/**
 * Fictional data for the Work design review page (/dev/work-review): the
 * redesigned Work tabs (Tasks, the plan, Cost, What Q did, the
 * notification rail, the first-stage report, Documents, Pitch, Rehearsals,
 * The Q Daily, the rehearsal review). Every company, person, figure and
 * message is fictional; nothing here is read from or written to a
 * service. Shapes follow the chosen-pages tests (test/work-designs,
 * test/work-chosen-pages) and are parsed by the real contracts, so a
 * fixture that drifts from them fails here, not on screen.
 *
 * Times are relative to the request's clock (`now`), so "2 h ago" and
 * "this month" read the same on any day the screenshots are taken.
 */

export const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const HOUR = 3_600_000;
const iso = (now: number, hoursAgo: number) =>
  new Date(now - hoursAgo * HOUR).toISOString();

/** The investor whose Work this is, and the founder for the founder tabs. */
export const HARBOURLINE = "Harbourline Ventures (fictional)";
export const KESTREL = "Kestrel Robotics (fictional)";

const TIDEWATER = {
  kind: "COMPANY" as const,
  id: uuid(101),
  photoUrl: null,
};
const CORVID = { kind: "COMPANY" as const, id: uuid(102), photoUrl: null };
const FERNHILL = { kind: "COMPANY" as const, id: uuid(103), photoUrl: null };
const QUILLON = {
  kind: "INVESTOR_ORGANISATION" as const,
  id: uuid(104),
  photoUrl: null,
};

// ---------------------------------------------------------------------------
// Work: Tasks inbox
// ---------------------------------------------------------------------------

const APPROVAL_REPLY = uuid(201);
const APPROVAL_INSTRUCTION = uuid(202);
const PLAN_JOB = uuid(301);
const HELD_JOB = uuid(302);

function approvalView(
  now: number,
  approvalId: string,
  over: {
    readonly actionType: string;
    readonly summary: string;
    readonly preview: string;
    readonly target: string;
  },
): QApprovalView {
  return QApprovalViewSchema.parse({
    contractVersion: 1,
    approvalId,
    runId: uuid(290),
    status: "PENDING",
    requestedAt: iso(now, 2),
    expiresAt: iso(now, -22),
    canDecide: true,
    action: {
      actionId: uuid(291),
      actionType: over.actionType,
      actionVersion: 1,
      actionClass: "CONFIRM_REQUIRED",
      actionStatus: "AWAITING_APPROVAL",
      targets: [{ kind: "COMPANY", companyId: over.target }],
      summary: over.summary,
      preview: over.preview,
    },
  });
}

export function inboxApprovals(now: number): readonly QPendingApproval[] {
  return [
    QPendingApprovalSchema.parse({
      approvalId: APPROVAL_REPLY,
      runId: uuid(290),
      conversationId: null,
      summary: "Reply to Tidewater Health with the pilot figures",
      requestedAt: iso(now, 2),
      expiresAt: iso(now, -22),
      named: TIDEWATER,
    }),
    QPendingApprovalSchema.parse({
      approvalId: APPROVAL_INSTRUCTION,
      runId: uuid(292),
      conversationId: null,
      summary: "Keep booking intro calls at $10 a month?",
      requestedAt: iso(now, 20),
      expiresAt: iso(now, -4),
    }),
  ];
}

export function inboxViews(
  now: number,
): Readonly<Record<string, QApprovalView>> {
  return {
    [APPROVAL_REPLY]: approvalView(now, APPROVAL_REPLY, {
      actionType: "chat.message.send",
      summary: "Reply to Tidewater Health with the pilot figures",
      preview:
        "Hi Ada, thanks for the deck. Before we book a call: of the four pilots you mention, which two are paying today, and from when?",
      target: TIDEWATER.id,
    }),
    [APPROVAL_INSTRUCTION]: approvalView(now, APPROVAL_INSTRUCTION, {
      actionType: "q.instruction.grant",
      summary: "Keep booking intro calls at $10 a month?",
      preview:
        'Your goal: "Book intro calls with founders I like"\n\nOn my own, within Mon-Fri 09:00-17:00:\n- offer call times (up to 3 per founder)\n\nI ask you first:\n- anything else\n\nBudget: $10.00 a month of Q\'s work; then I pause and ask.',
      target: FERNHILL.id,
    }),
  };
}

export function inboxSuggestions(): readonly QWorkSuggestionDto[] {
  return [
    {
      key: `stalled_reply:${uuid(401)}`,
      kind: "STALLED_REPLY",
      lead: 6,
      unit: "days",
      subject: "Saltmarsh Energy hasn’t replied",
      question: "Follow up?",
      prompt: "Follow up with Saltmarsh Energy",
      linkPath: "/relationships",
    },
    {
      key: "new_matches:feed",
      kind: "NEW_MATCHES",
      lead: 3,
      unit: "match",
      subject: "Founders fit your mandate",
      question: "Prepare intros?",
      prompt: "Prepare intros to the new matches",
      linkPath: "/discover",
    },
  ];
}

export function inboxWork(now: number): readonly QWorkDto[] {
  return [
    QWorkDtoSchema.parse({
      id: uuid(501),
      kind: "INVESTOR_OUTREACH",
      status: "ACTIVE",
      summary: "3 of 5 accepted",
      createdAt: iso(now, 48),
      expiresAt: iso(now, -300),
      lanes: [
        {
          id: uuid(511),
          counterpartName: "Lanternfish Labs",
          counterpart: { kind: "COMPANY", id: uuid(105), photoUrl: null },
          stage: "NEEDS_TIMES",
          lastStep: "Accepted; asked for a call",
          reasons: [],
          offered: [
            { start: iso(now, -26), label: "Tue 10:00" },
            { start: iso(now, -50), label: "Wed 14:30" },
            { start: iso(now, -74), label: "Thu 09:00" },
          ],
          report: null,
          chatPath: null,
          updatedAt: iso(now, 5),
        },
      ],
      goal: "Find 5 climate founders in Lagos",
      run: { state: "WAITING", pauseReason: null },
      lastStep: { words: "3 of 5 accepted", at: iso(now, 5) },
      spend: null,
    }),
    QWorkDtoSchema.parse({
      id: uuid(502),
      kind: "STANDING_INSTRUCTION",
      status: "ACTIVE",
      summary: null,
      createdAt: iso(now, 72),
      expiresAt: iso(now, -600),
      lanes: [],
      goal: "Keep my founder conversations moving",
      run: { state: "WORKING", pauseReason: null },
      lastStep: { words: "Replied to Fernhill Foods", at: iso(now, 2) },
      spend: { spentUsdMonth: "1.84", budgetUsdMonth: "5.00" },
    }),
    QWorkDtoSchema.parse({
      id: uuid(503),
      kind: "STANDING_INSTRUCTION",
      status: "ACTIVE",
      summary: null,
      createdAt: iso(now, 200),
      expiresAt: iso(now, -400),
      lanes: [],
      goal: "Book calls with founders I like",
      run: { state: "PAUSED", pauseReason: "BUDGET_EXHAUSTED" },
      lastStep: { words: "Booked Brackenridge Bio, Thu", at: iso(now, 30) },
      spend: { spentUsdMonth: "5.00", budgetUsdMonth: "5.00" },
    }),
  ];
}

export function inboxDone(now: number): QWorkDonePageDto {
  return {
    items: [
      {
        id: uuid(601),
        words: "Sent Fernhill Foods a reply",
        at: iso(now, 2),
        linkPath: "/relationships",
        named: FERNHILL,
        relationshipId: uuid(611),
        counterpartName: "Fernhill Foods",
      },
      {
        id: uuid(602),
        words: "Booked a call with Brackenridge Bio, Thursday 10:00",
        at: iso(now, 30),
        linkPath: "/relationships",
      },
      {
        id: uuid(603),
        words: "Wrote the first-stage report on Tidewater Health",
        at: iso(now, 52),
        linkPath: `/work/${uuid(701)}/report/${uuid(711)}`,
      },
    ],
    thisWeek: 9,
    nextCursor: null,
  };
}

/** A notice that needs the person, and two updates (the rail's too). */
export function reviewNotices(now: number): readonly NotificationDto[] {
  return [
    NotificationDtoSchema.parse({
      id: uuid(801),
      kind: "INTEREST_RECEIVED",
      title: "Corvid Analytics asked to connect",
      body: "They want to share their seed deck.",
      linkPath: "/relationships",
      read: false,
      createdAt: iso(now, 3),
      priority: "NEEDS_YOU",
      named: CORVID,
    }),
    NotificationDtoSchema.parse({
      id: uuid(802),
      kind: "Q_WORK",
      title: "Reply to Ada is ready for your yes",
      body: null,
      linkPath: "/work",
      read: false,
      createdAt: iso(now, 2),
      priority: "NEEDS_YOU",
      named: TIDEWATER,
    }),
    NotificationDtoSchema.parse({
      id: uuid(803),
      kind: "CHAT_MESSAGE",
      title: "Tidewater Health opened your questions",
      body: null,
      linkPath: "/relationships",
      read: true,
      createdAt: iso(now, 26),
      priority: "UPDATE",
      named: TIDEWATER,
    }),
    NotificationDtoSchema.parse({
      id: uuid(804),
      kind: "MEETING_SCHEDULED",
      title: "Call with Fernhill Foods booked, Thu 10:00",
      body: null,
      linkPath: "/relationships",
      read: false,
      createdAt: iso(now, 6),
      priority: "UPDATE",
      named: FERNHILL,
    }),
    NotificationDtoSchema.parse({
      id: uuid(805),
      kind: "COMMITMENT",
      title: "Quillon Capital moved their commitment to sent",
      body: null,
      linkPath: "/relationships",
      read: true,
      createdAt: iso(now, 50),
      priority: "UPDATE",
      named: QUILLON,
    }),
    NotificationDtoSchema.parse({
      id: uuid(806),
      kind: "Q_WORK",
      title: "Today’s Q Daily is ready",
      body: null,
      linkPath: "/daily",
      read: true,
      createdAt: iso(now, 9),
      priority: "UPDATE",
    }),
  ];
}

/** Who each notice names, from the person's own relationships. */
export const REVIEW_NOTICE_NAMES: Readonly<Record<string, string>> = {
  [TIDEWATER.id]: "Tidewater Health",
  [CORVID.id]: "Corvid Analytics",
  [FERNHILL.id]: "Fernhill Foods",
  [QUILLON.id]: "Quillon Capital",
};

// ---------------------------------------------------------------------------
// Q's team: the plan and the cost
// ---------------------------------------------------------------------------

const PLAN = {
  outcome: "Ada has the pilot figures she asked for, by Thursday.",
  done: 1,
  total: 3,
  steps: [
    {
      key: "s1",
      who: "Research",
      does: "Find the pilot figures",
      why: "Ada asked which pilots pay",
      status: "DONE",
      summary: "Two pilots pay; both are in the model, tabs 3 and 5.",
      dependsOn: [],
      fallbackFor: null,
      evidence: [
        {
          ref: "F1",
          kind: "MESSAGE_WAITING",
          text: "Ada’s message, yesterday",
          at: null,
        },
      ],
    },
    {
      key: "s2",
      who: "Writer",
      does: "Write the reply",
      why: null,
      status: "WAITING",
      summary: null,
      dependsOn: ["s1"],
      fallbackFor: null,
      evidence: [],
    },
    {
      key: "s3",
      who: "Scheduler",
      does: "Offer call times",
      why: null,
      status: "WAITING",
      summary: null,
      dependsOn: ["s2"],
      fallbackFor: null,
      evidence: [],
    },
  ],
  prerequisites: [
    {
      what: "Ada’s preferred call time",
      status: "UNKNOWN",
      blocking: false,
      evidence: [],
      resolvedBy: null,
    },
    {
      what: "The financial model",
      status: "MET",
      blocking: true,
      evidence: [],
      resolvedBy: null,
    },
  ],
  signals: [
    {
      kind: "CONTRADICTION",
      note: "The deck says 3 pilots, the model lists 4.",
      stepKey: "s1",
    },
  ],
  nextActions: [],
  situation: [],
};

function reviewBar() {
  return { threshold: 70, maxRedrafts: 2, rubricVersion: "r1" };
}

export function teamJobs(now: number): readonly WorkforceJobDetailDto[] {
  return [
    WorkforceJobDetailDtoSchema.parse({
      job: {
        id: PLAN_JOB,
        goal: "Answer Tidewater Health’s diligence questions",
        source: "JOB",
        status: "RUNNING",
        reviewBar: reviewBar(),
        budgetUsd: "2",
        costUsd: "1.42",
        agents: 2,
        drafts: 1,
        held: 0,
        createdAt: iso(now, 4),
        updatedAt: iso(now, 2),
      },
      agents: [
        {
          id: uuid(321),
          role: "RESEARCH",
          agentName: "Research",
          goal: "Find the pilot figures",
          tools: [],
          status: "DONE",
          summary: "Two pilots pay; both are in the model, tabs 3 and 5.",
          spawnedByRunId: null,
          spawned: false,
          budgetUsd: "0.5",
          costUsd: "0.38",
          startedAt: iso(now, 4),
          endedAt: iso(now, 3.5),
        },
        {
          id: uuid(322),
          role: "WRITER",
          agentName: "Writer",
          goal: "Write the reply",
          tools: [],
          status: "DONE",
          summary: "Drafted the reply; the reviewer passed it at 84.",
          spawnedByRunId: null,
          spawned: false,
          budgetUsd: "0.8",
          costUsd: "0.61",
          startedAt: iso(now, 3),
          endedAt: iso(now, 2),
        },
      ],
      drafts: [
        {
          id: uuid(331),
          attempt: 1,
          parentDraftId: null,
          channel: "CHAT",
          counterpartName: "Tidewater Health",
          body: "Hi Ada, thanks for the deck. Before we book a call: of the four pilots you mention, which two are paying today, and from when?",
          grade: null,
          outcome: {
            outcome: "OFFERED",
            reason: null,
            qActionId: uuid(291),
            approvalId: APPROVAL_REPLY,
            approvalStatus: "PENDING",
          },
          feedback: [],
          createdAt: iso(now, 2),
        },
      ],
      timeline: [],
      approvals: [inboxViews(now)[APPROVAL_REPLY]],
      plan: PLAN,
    }),
    WorkforceJobDetailDtoSchema.parse({
      job: {
        id: HELD_JOB,
        goal: "Follow up with founders who went quiet",
        source: "JOB",
        status: "HELD",
        reviewBar: reviewBar(),
        budgetUsd: "1",
        costUsd: "0.44",
        agents: 2,
        drafts: 2,
        held: 1,
        createdAt: iso(now, 9),
        updatedAt: iso(now, 5),
      },
      agents: [
        {
          id: uuid(341),
          role: "WRITER",
          agentName: "Writer",
          goal: "Write a short follow-up",
          tools: [],
          status: "HELD",
          summary: "Two drafts; neither reached your bar.",
          spawnedByRunId: null,
          spawned: false,
          budgetUsd: "0.5",
          costUsd: "0.29",
          startedAt: iso(now, 8),
          endedAt: iso(now, 5),
        },
      ],
      drafts: [
        {
          id: uuid(351),
          attempt: 1,
          parentDraftId: null,
          channel: "CHAT",
          counterpartName: "Corvid Analytics",
          body: "Hi Tomas, just checking in on the data room.",
          grade: {
            score: 58,
            passed: false,
            threshold: 70,
            maxRedrafts: 2,
            rubricVersion: "r1",
            criteria: [],
            integrity: [],
            feedback: "It doesn't answer what Tomas last asked.",
          },
          outcome: null,
          feedback: [],
          createdAt: iso(now, 6),
        },
        {
          id: uuid(352),
          attempt: 2,
          parentDraftId: uuid(351),
          channel: "CHAT",
          counterpartName: "Corvid Analytics",
          body: "Hi Tomas, thanks for the churn numbers. Could you share the cohort split by customer size before Friday?",
          grade: {
            score: 64,
            passed: false,
            threshold: 70,
            maxRedrafts: 2,
            rubricVersion: "r1",
            criteria: [],
            integrity: [],
            feedback: "Closer; still asks for something already sent.",
          },
          outcome: {
            outcome: "HELD",
            reason: "BELOW_BAR",
            qActionId: null,
            approvalId: null,
            approvalStatus: null,
          },
          feedback: [],
          createdAt: iso(now, 5),
        },
      ],
      timeline: [],
    }),
  ];
}

/** The month so far, split by day; `split: false` is an older server's. */
export function teamOverview(
  now: number,
  split: boolean,
): WorkforceOverviewDto {
  const today = new Date(now);
  const month = today.toISOString().slice(0, 7);
  const dayOfMonth = today.getUTCDate();
  const pattern = [0.42, 0, 1.6, 0.18, 0, 0, 0.9, 0.35, 0.05, 1.12, 0, 0.6];
  const byDay = Array.from({ length: dayOfMonth }, (_, index) => index + 1)
    .map((day) => ({ day, usd: pattern[(day - 1) % pattern.length] ?? 0 }))
    .filter((one) => one.usd > 0)
    .map((one) => {
      const writer = Math.round(one.usd * 0.5 * 100) / 100;
      const research = Math.round(one.usd * 0.3 * 100) / 100;
      const reviewer = Math.round((one.usd - writer - research) * 100) / 100;
      return {
        day: `${month}-${String(one.day).padStart(2, "0")}`,
        usd: one.usd.toFixed(2),
        byRole: [
          { role: "WRITER", usd: writer.toFixed(2) },
          { role: "RESEARCH", usd: research.toFixed(2) },
          ...(reviewer > 0
            ? [{ role: "REVIEWER", usd: reviewer.toFixed(2) }]
            : []),
        ],
      };
    });
  const spent = byDay.reduce((sum, one) => sum + Number(one.usd), 0);
  return WorkforceOverviewDtoSchema.parse({
    month,
    spentUsd: spent.toFixed(2),
    limitUsd: "40",
    paused: false,
    byRole: [
      { role: "WRITER", usd: (spent * 0.5).toFixed(2) },
      { role: "RESEARCH", usd: (spent * 0.3).toFixed(2) },
      { role: "REVIEWER", usd: (spent * 0.2).toFixed(2) },
    ],
    team: [],
    jobs: { open: 2, needsYou: 2 },
    ...(split ? { byDay } : {}),
    instructions: [
      {
        id: uuid(502),
        goal: "Keep my founder conversations moving",
        status: "ACTIVE",
        pauseReason: null,
        lastRunAt: iso(now, 2),
        nextRunAt: iso(now, -4),
        steps: [
          {
            action: "chat.message.send",
            status: "ASKED",
            reasonCode: null,
            words: "Asked you before replying to Tidewater Health",
            at: iso(now, 2),
            approvalId: APPROVAL_REPLY,
            approvalStatus: "PENDING",
          },
          {
            action: "chat.message.send",
            status: "DONE",
            reasonCode: "DELEGATED",
            words: "Answered Fernhill Foods on team size",
            at: iso(now, 3),
            approvalId: null,
            approvalStatus: null,
          },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// What Q did, and the first-stage report
// ---------------------------------------------------------------------------

export const AUDIT_DELEGATION = uuid(701);
export const AUDIT_LANE = uuid(711);

export function auditDetail(
  now: number,
  state: "outreach" | "instruction" | "paused" | "stopped",
): QWorkDetailDto {
  const instruction = state === "instruction" || state === "paused";
  return QWorkDetailDtoSchema.parse({
    work: {
      id: AUDIT_DELEGATION,
      kind: instruction ? "STANDING_INSTRUCTION" : "INVESTOR_OUTREACH",
      status: state === "stopped" ? "STOPPED" : "ACTIVE",
      summary: "2 talking, 1 report ready",
      createdAt: iso(now, 120),
      expiresAt: iso(now, -600),
      goal: instruction
        ? "Answer investors’ scheduling questions while I’m away."
        : "Find seed-stage digital health companies in the UK with paying NHS customers.",
      run:
        state === "paused"
          ? { state: "PAUSED", pauseReason: "PAUSED_BY_YOU" }
          : { state: "WORKING", pauseReason: null },
      lanes: [
        {
          id: AUDIT_LANE,
          counterpartName: instruction ? "Quillon Capital" : "Tidewater Health",
          stage: "REPORT_READY",
          lastStep: null,
          reasons: [
            instruction
              ? {
                  reason: "Writes seed cheques in health",
                  quote: "We lead seed rounds in digital health",
                }
              : {
                  reason: "Paying NHS customers",
                  quote: "Two NHS trusts pay us today",
                },
          ],
          offered: [],
          report: null,
          chatPath: null,
          updatedAt: iso(now, 4),
        },
        {
          id: uuid(712),
          counterpartName: instruction
            ? "Brackenridge Partners"
            : "Corvid Analytics",
          stage: "CHATTING",
          lastStep: "Asked for the cohort split",
          reasons: [
            {
              reason: instruction
                ? "Asked about our raise"
                : "Hospital data platform",
              quote: instruction
                ? "When does the round close?"
                : "We sell to hospital data teams",
            },
          ],
          offered: [],
          report: null,
          chatPath: null,
          updatedAt: iso(now, 6),
        },
      ],
    },
    steps: [
      {
        words: instruction
          ? "Q answered Quillon Capital’s question on timing."
          : "Q wrote the first-stage report on Tidewater Health: unsure.",
        at: iso(now, 4),
        by: "Q",
        laneId: AUDIT_LANE,
      },
      {
        words: "You approved Q’s questions to Corvid Analytics.",
        at: iso(now, 7),
        by: "YOU",
        laneId: uuid(712),
      },
      {
        words: instruction
          ? "Quillon Capital asked when the round closes."
          : "Tidewater Health accepted; Q sent your opening message.",
        at: iso(now, 50),
        by: "THEM",
        laneId: AUDIT_LANE,
      },
      ...(state === "stopped"
        ? [
            {
              words: "You stopped this work.",
              at: iso(now, 1),
              by: "YOU",
              laneId: null,
            },
          ]
        : []),
    ],
  });
}

export function firstStageReport(
  now: number,
  recommendation: QWorkReportDto["recommendation"],
  conversation: boolean,
): QWorkReportDto {
  return {
    counterpartName: "Tidewater Health",
    writtenAt: iso(now, 4),
    headline:
      recommendation === "PASS"
        ? "Strong team, outside your mandate"
        : "Paying NHS customers, thin on unit economics",
    howItWent:
      "Ada answered every question in Q’s first-stage interview and shared the pilot contracts.",
    strengths: [
      { point: "Paying customers in two NHS trusts", basis: "CLAIM" },
      { point: "A founder who has sold into hospitals before", basis: "CLAIM" },
    ],
    concerns: [
      { point: "Sales cycles may run past 12 months", basis: "INFERENCE" },
      {
        point: "The deck and the model disagree on pilots",
        basis: "INFERENCE",
      },
    ],
    openQuestions: [
      "What is your runway today?",
      "Which pilots convert to paid contracts, and when?",
    ],
    recommendation,
    why:
      recommendation === "PROCEED"
        ? "The traction is real and inside your mandate; a call settles the open numbers."
        : recommendation === "PASS"
          ? "They sell to pharma, which your mandate excludes."
          : "Two gaps are worth a call before deciding.",
    interview: [
      {
        question: "Who pays you today?",
        answer: "Two NHS trusts pay us; two more are on unpaid pilots.",
        byQ: false,
      },
      {
        question: "How long did the first contract take?",
        answer: "Nine months from first meeting to signature.",
        byQ: false,
      },
    ],
    relationshipId: conversation ? uuid(721) : null,
    companyId: TIDEWATER.id,
    laneOpen: true,
  };
}

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------

export const PITCH_COMPANY = uuid(901);

export function pitchVideo(over: Partial<MediaAssetDto> = {}): MediaAssetDto {
  return {
    mediaAssetId: uuid(911),
    purpose: "FOUNDER_PITCH",
    status: "READY",
    durationSeconds: 184,
    aspectRatio: "16:9",
    playbackPolicy: "AUTHORISED",
    captionState: "AVAILABLE",
    transcriptState: "AVAILABLE",
    moderationStatus: "ALLOWED",
    title: "Seed pitch",
    audience: "NETWORK",
    downloadable: false,
    live: true,
    replacesMediaAssetId: null,
    createdAt: "2026-10-12T09:00:00.000Z",
    readyAt: "2026-10-12T09:05:00.000Z",
    version: 3,
    ...over,
  };
}

export function pitchVideos(): readonly MediaAssetDto[] {
  return [
    pitchVideo(),
    pitchVideo({
      mediaAssetId: uuid(912),
      title: "Product demo",
      playbackPolicy: "PRIVATE",
      createdAt: "2026-10-01T00:00:00.000Z",
      version: 1,
    }),
  ];
}

function section(
  sectionKey: string,
  label: string,
  value: string,
  atSeconds: number,
): PitchSectionFactDto {
  return {
    sectionKey,
    label,
    value,
    pitchId: uuid(911),
    pitchTitle: "Seed pitch",
    atSeconds,
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    source: "PITCH_VIDEO",
  };
}

export function pitchSections(): readonly PitchSectionFactDto[] {
  return [
    section("problem", "Problem", "Warehouse picking is slow and manual", 0),
    section(
      "solution",
      "Solution",
      "Pick arms that learn a new SKU in a day",
      34,
    ),
    section("traction", "Traction", "Four paying warehouses, $38k MRR", 92),
    section("ask", "Raise", "$2.5M seed", 160),
  ];
}

/** Q read the pitch, but every part it heard falls past the video's end. */
export function pitchSectionsUnplaced(): readonly PitchSectionFactDto[] {
  return [section("traction", "Traction", "Four paying warehouses", 400)];
}

// ---------------------------------------------------------------------------
// Rehearsals
// ---------------------------------------------------------------------------

const NORTHMOOR = {
  kind: "INVESTOR_ORGANISATION" as const,
  id: uuid(1001),
  name: "Northmoor Capital (fictional)",
};
const QUILLON_COUNTERPART = {
  kind: "INVESTOR_ORGANISATION" as const,
  id: QUILLON.id,
  name: "Quillon Capital (fictional)",
};

export function rehearsalPartners(
  now: number,
  nobody: boolean,
): QRehearsalPartnersDto & { readonly role: "FOUNDER" } {
  if (nobody) return { role: "FOUNDER", upcoming: [], people: [] };
  return {
    role: "FOUNDER",
    upcoming: [
      {
        meetingId: uuid(1011),
        startsAt: iso(now, -50),
        purpose: "Intro call",
        counterpart: NORTHMOOR,
      },
    ],
    people: [
      {
        counterpart: QUILLON_COUNTERPART,
        relationshipId: uuid(1012),
        state: "CONNECTED",
        lastRehearsal: {
          id: uuid(1022),
          at: iso(now, 170),
          score: 68,
          outcome: "STRONG_LATER",
        },
      },
      {
        counterpart: {
          kind: "INVESTOR_ORGANISATION",
          id: uuid(1002),
          name: "Brackenridge Partners (fictional)",
        },
        relationshipId: uuid(1013),
        state: "CONNECTED",
        lastRehearsal: null,
      },
    ],
  };
}

export function rehearsalHistory(
  now: number,
  open: boolean,
): QRehearsalListDto {
  const rehearsals: QRehearsalSummaryDto[] = [
    ...(open
      ? [
          {
            id: uuid(1020),
            counterpart: NORTHMOOR,
            status: "ACTIVE" as const,
            outcome: null,
            score: null,
            exchanges: 1,
            createdAt: iso(now, 1),
          },
        ]
      : []),
    {
      id: uuid(1021),
      counterpart: NORTHMOOR,
      status: "FINISHED",
      outcome: "STRONG_LATER",
      score: 76,
      exchanges: 6,
      createdAt: iso(now, 26),
      review: {
        state: "READY",
        wentWell: "Calm and specific on margins.",
        workOn: "Say what the team does before the numbers.",
      },
    },
    {
      id: uuid(1023),
      counterpart: QUILLON_COUNTERPART,
      status: "FINISHED",
      outcome: null,
      score: null,
      exchanges: 4,
      createdAt: iso(now, 50),
      review: {
        state: "PROVISIONAL",
        wentWell: "A clear opening on the problem.",
        workOn: "Name the round size.",
      },
    },
    {
      id: uuid(1024),
      counterpart: QUILLON_COUNTERPART,
      status: "FINISHED",
      outcome: null,
      score: null,
      exchanges: 3,
      createdAt: iso(now, 96),
    },
    {
      id: uuid(1022),
      counterpart: QUILLON_COUNTERPART,
      status: "FINISHED",
      outcome: "STRONG_LATER",
      score: 68,
      exchanges: 7,
      createdAt: iso(now, 170),
      review: {
        state: "READY",
        wentWell: "Good answers on the sales cycle.",
        workOn: "Shorter answers; the longest ran past a minute.",
      },
    },
    {
      id: uuid(1025),
      counterpart: NORTHMOOR,
      status: "FINISHED",
      outcome: "LEFT_EARLY",
      score: null,
      exchanges: 0,
      createdAt: iso(now, 220),
    },
  ];
  return { rehearsals };
}

export function rehearsal(
  now: number,
  state: "ready" | "writing" | "first-notes" | "nothing",
): QRehearsalDto {
  const turns: QRehearsalDto["turns"] = [
    {
      from: "THEM",
      text: "Tell me what Kestrel does, in a sentence.",
      at: iso(now, 26),
      mood: null,
      sawScreen: false,
    },
    {
      from: "YOU",
      text: "We build pick arms for warehouses that learn a new product in a day.",
      at: iso(now, 25.98),
      mood: null,
      sawScreen: false,
    },
    {
      from: "THEM",
      text: "Who pays you today, and how much?",
      at: iso(now, 25.96),
      mood: null,
      sawScreen: false,
    },
    {
      from: "YOU",
      text: "Four warehouses pay us, about thirty-eight thousand a month together.",
      at: iso(now, 25.94),
      mood: null,
      sawScreen: false,
    },
    {
      from: "THEM",
      text: "Do you have a lead for the round?",
      at: iso(now, 25.92),
      mood: null,
      sawScreen: false,
    },
    {
      from: "YOU",
      text: "We’re raising a few million to hire sellers, and talking to a few funds.",
      at: iso(now, 25.9),
      mood: null,
      sawScreen: false,
    },
  ];
  const base: QRehearsalDto = {
    id: uuid(1021),
    counterpart: NORTHMOOR,
    userRole: "FOUNDER",
    status: "FINISHED",
    outcome: "STRONG_LATER",
    meetingId: null,
    voice: "FEMALE",
    difficulty: "REALISTIC",
    metrics: {
      yourShareOfWords: 58,
      longestAnswerWords: 41,
      exchanges: 3,
      minutes: 14,
    },
    previousScore: 68,
    persona: { summary: "", style: "", priorities: [], grounding: "SOME" },
    turns,
    review: {
      overall:
        "Clear on the product and the customers; the ask came late and vague.",
      score: 76,
      dimensions: [],
      wentRight: [
        {
          moment:
            "Four warehouses pay us, about thirty-eight thousand a month.",
          why: "A number, said plainly, answered the question asked.",
        },
      ],
      wentWrong: [
        {
          moment: "We’re raising a few million to hire sellers",
          why: "An investor hears no amount and no lead.",
          better: "Say the amount and who is leading: “$2.5M, lead in talks.”",
        },
        {
          moment: "Overall pacing.",
          why: "",
          better: "Slow down on the numbers.",
        },
      ],
      tips: [],
    },
    createdAt: iso(now, 26),
    endedAt: iso(now, 25.75),
  };
  switch (state) {
    case "ready":
      return base;
    case "writing":
      return { ...base, review: null };
    case "first-notes":
      return base.review === null
        ? base
        : { ...base, review: { ...base.review, provisional: true } };
    case "nothing":
      return {
        ...base,
        outcome: "LEFT_EARLY",
        review: null,
        turns: turns.slice(0, 1),
        metrics: { ...base.metrics, exchanges: 0 },
      };
  }
}

// ---------------------------------------------------------------------------
// The Q Daily
// ---------------------------------------------------------------------------

function story(
  id: string,
  over: Partial<QDailyStory> & Pick<QDailyStory, "headline">,
): QDailyStory {
  return {
    id,
    section: "YOUR_SECTOR",
    standfirst: "",
    paragraphs: [],
    quotes: [],
    sources: [
      {
        url: `https://news.example/${id}`,
        publisher: "Example Trade Weekly",
        title: over.headline,
        publishedAt: null,
      },
    ],
    image: null,
    deal: null,
    written: true,
    ...over,
  };
}

export function dailyEdition(date: string, number: number): QDailyEdition {
  return {
    id: uuid(1100 + number),
    number,
    editionDate: date,
    frequency: "DAILY",
    readerName: KESTREL,
    topics: ["Northmoor Capital (fictional)"],
    lead: story("lead", {
      headline: "Warehouse automation rounds held up through the quarter",
      standfirst:
        "Seed and Series A rounds in picking robotics closed at the pace of last year, by the count of three trade outlets.",
      paragraphs: [
        "Fourteen rounds in warehouse robotics closed this quarter, against thirteen a year ago.",
        "Most were led by funds that already hold a logistics company.",
      ],
    }),
    sections: [
      {
        code: "YOUR_SECTOR",
        title: "Your sector",
        stories: [
          story("s1", {
            headline: "A grocer pilots picking arms in two depots",
            paragraphs: ["The pilot runs for six months."],
          }),
          story("s2", {
            headline: "Labour costs in fulfilment rose again",
            paragraphs: ["Wages rose 4% year on year in the survey."],
          }),
        ],
      },
      {
        code: "DEALS",
        title: "Deals",
        stories: [
          story("d1", {
            section: "DEALS",
            headline: "Pickwise raises a seed round",
            deal: {
              company: "Pickwise (fictional)",
              amount: "$6M",
              amountUsd: 6_000_000,
              round: "seed",
              sourceIndex: 0,
            },
          }),
          story("d2", {
            section: "DEALS",
            headline: "Shelfline closes its Series A",
            deal: {
              company: "Shelfline (fictional)",
              amount: "$18M",
              amountUsd: 18_000_000,
              round: "Series A",
              sourceIndex: 0,
            },
          }),
        ],
      },
    ],
    briefs: [],
    chart: null,
    qTake: {
      paragraphs: [
        "Your raise sits where seed rounds in the sector held up; funds with a logistics company are the likeliest leads.",
      ],
      storyIds: ["lead"],
      truthClass: "Q_INFERENCE",
    },
    generatedAt: `${date}T06:00:00.000Z`,
  };
}

/** The month's editions for the calendar: most weekdays, some gaps. */
export function dailyCalendar(
  today: string,
  withToday: boolean,
): readonly { date: string; number: number; headline: string | null }[] {
  const month = today.slice(0, 7);
  const last = Number(today.slice(8, 10));
  const out: { date: string; number: number; headline: string | null }[] = [];
  let number = 40;
  for (let day = 1; day <= last; day += 1) {
    if (day === last && !withToday) continue;
    // A gap every few days: a day without an edition says so.
    if (day % 5 === 3) continue;
    number += 1;
    out.push({
      date: `${month}-${String(day).padStart(2, "0")}`,
      number,
      headline:
        day === last
          ? "Warehouse automation rounds held up through the quarter"
          : `Edition ${String(number)}`,
    });
  }
  return out;
}
