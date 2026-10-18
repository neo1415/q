import {
  QWorkDtoSchema,
  WorkforceJobDetailDtoSchema,
  WorkforceOverviewDtoSchema,
  type QWorkDto,
  type WorkforceJobDetailDto,
  type WorkforceOverviewDto,
} from "@capital-q/contracts";

/**
 * Fictional workforce data for the design review page and the tests (J5):
 * the approved mockup's four jobs -- an intro whose first draft was sent
 * back and whose second passed and waits for approval, a reply being
 * written, an always-on mandate watch, and a booked call -- with the team
 * and the month's cost. Every name is fictional; nothing is read or sent.
 */

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const FIXTURE_IDS = {
  intro: id(1),
  introLead: id(2),
  introResearch: id(3),
  introWriter: id(4),
  introReviewer: id(5),
  introScheduler: id(6),
  draft1: id(7),
  draft2: id(8),
  approval: id(9),
  action: id(10),
  reply: id(11),
  watch: id(12),
  done: id(13),
} as const;

const BAR = { threshold: 80, maxRedrafts: 2, rubricVersion: "rubric/v1" };

const criteria = (scores: Record<string, number>) =>
  Object.entries(scores).map(([criterion, score]) => ({
    criterion,
    score,
    note: "",
  }));

const integrity = [
  { rule: "GROUNDED", ok: true, note: "" },
  { rule: "NO_COMMITMENTS", ok: true, note: "" },
  { rule: "NOTHING_PRIVATE", ok: true, note: "" },
  { rule: "HONEST_IDENTITY", ok: true, note: "" },
];

function run(
  runId: string,
  role: string,
  goal: string,
  status: string,
  summary: string | null,
  startedAt: string,
  spawnedBy: string | null,
) {
  return {
    id: runId,
    role,
    agentName: role === "LEAD" ? "Lead Q" : role,
    goal,
    tools: [],
    status,
    summary,
    spawnedByRunId: spawnedBy,
    spawned: false,
    budgetUsd: "0.1",
    costUsd: "0.01",
    startedAt,
    endedAt: status === "RUNNING" ? null : startedAt,
  };
}

function summary(
  jobId: string,
  goal: string,
  source: string,
  status: string,
  at: string,
) {
  return {
    id: jobId,
    goal,
    source,
    status,
    reviewBar: BAR,
    budgetUsd: "0.5",
    costUsd: "0.12",
    agents: 4,
    drafts: 2,
    held: 0,
    createdAt: at,
    updatedAt: at,
  };
}

export function workforceFixtures(now: number): {
  readonly overview: WorkforceOverviewDto;
  readonly jobs: readonly WorkforceJobDetailDto[];
} {
  const at = (minutesAgo: number) =>
    new Date(now - minutesAgo * 60_000).toISOString();
  const I = FIXTURE_IDS;

  const intro = WorkforceJobDetailDtoSchema.parse({
    job: summary(I.intro, "Intro to Kestrel Heat", "JOB", "RUNNING", at(9)),
    agents: [
      run(
        I.introLead,
        "LEAD",
        "Read your guide first: warm start, no meeting ask in the first email.",
        "DONE",
        "Planned 3 steps.",
        at(9),
        null,
      ),
      run(
        I.introResearch,
        "RESEARCH",
        "Read Kestrel’s deck and install log",
        "DONE",
        "Found the founders’ last company and 310 installs.",
        at(8),
        I.introLead,
      ),
      run(
        I.introWriter,
        "WRITER",
        "Email to Priya Shah",
        "DONE",
        "Wrote it in 2 drafts.",
        at(7),
        I.introLead,
      ),
      run(
        I.introReviewer,
        "REVIEWER",
        "Grade: Email to Priya Shah",
        "DONE",
        "Scored 87 against a bar of 80.",
        at(7),
        I.introLead,
      ),
      run(
        I.introScheduler,
        "SCHEDULER",
        "Offer three times when they reply",
        "SKIPPED",
        "Waits for the reply.",
        at(1),
        I.introLead,
      ),
    ],
    drafts: [
      {
        id: I.draft1,
        attempt: 1,
        parentDraftId: null,
        channel: "EMAIL",
        counterpartName: "Priya Shah, co-founder",
        body: "Could we get 30 minutes this week? I lead climate investing at Harbour Lane.",
        grade: {
          score: 62,
          passed: false,
          ...BAR,
          criteria: criteria({
            WARM_OPENING: 2,
            ASK_TIMING: 1,
            CONCISE_AND_CALM: 4,
          }),
          integrity,
          feedback:
            "Asks for a meeting in the first line; your guide says start warm.",
        },
        outcome: null,
        feedback: [],
        createdAt: at(7),
      },
      {
        id: I.draft2,
        attempt: 2,
        parentDraftId: I.draft1,
        channel: "EMAIL",
        counterpartName: "Priya Shah, co-founder",
        body: "Priya, 310 installs in a year, with a day’s fitting time, is rare. I lead climate investing at Harbour Lane, and home heat is where we want to back more teams.\n\nHappy to share what we’ve seen work for installers, if useful.",
        grade: {
          score: 87,
          passed: true,
          ...BAR,
          criteria: criteria({
            WARM_OPENING: 5,
            ASK_TIMING: 5,
            PERSONAL_STYLE: 4,
          }),
          integrity,
          feedback: "",
        },
        outcome: {
          outcome: "OFFERED",
          reason: null,
          qActionId: I.action,
          approvalId: I.approval,
          approvalStatus: "PENDING",
        },
        feedback: [],
        createdAt: at(6),
      },
    ],
    timeline: [
      {
        at: at(8),
        kind: "HANDOFF",
        runId: I.introResearch,
        toRunId: I.introWriter,
        draftId: null,
        text: "Research to Writer: 4 facts.",
      },
      {
        at: at(7),
        kind: "GRADE",
        runId: I.introReviewer,
        toRunId: null,
        draftId: I.draft1,
        text: "",
      },
      {
        at: at(6),
        kind: "GRADE",
        runId: I.introReviewer,
        toRunId: null,
        draftId: I.draft2,
        text: "",
      },
    ],
  });

  const reply = WorkforceJobDetailDtoSchema.parse({
    job: summary(
      I.reply,
      "Reply to Morrow Pay",
      "DELEGATED_WORK",
      "RUNNING",
      at(18),
    ),
    agents: [
      run(
        id(20),
        "LEAD",
        "They asked for your fund’s terms.",
        "DONE",
        null,
        at(19),
        null,
      ),
      run(
        id(21),
        "DOCUMENTS",
        "Found your standard term sheet",
        "DONE",
        "Shared with you, not with them yet.",
        at(18),
        id(20),
      ),
      run(
        id(22),
        "CONVERSATION",
        "Writing the reply",
        "RUNNING",
        null,
        at(17),
        id(20),
      ),
    ],
    drafts: [],
    timeline: [
      {
        at: at(17),
        kind: "HANDOFF",
        runId: id(21),
        toRunId: id(22),
        draftId: null,
        text: "",
      },
    ],
  });

  const watch = WorkforceJobDetailDtoSchema.parse({
    job: summary(
      I.watch,
      "Watch for new matches",
      "INSTRUCTION",
      "RUNNING",
      at(2),
    ),
    agents: [
      run(
        id(30),
        "MANDATE_WATCHER",
        "Checking new companies against your mandate",
        "RUNNING",
        "Expresses interest only with your approval.",
        at(2),
        null,
      ),
    ],
    drafts: [],
    timeline: [],
  });

  const done = WorkforceJobDetailDtoSchema.parse({
    job: summary(
      I.done,
      "Book a call with Norrland Grid",
      "ERRAND",
      "DONE",
      at(140),
    ),
    agents: [],
    drafts: [],
    timeline: [],
  });

  const overview = WorkforceOverviewDtoSchema.parse({
    month: new Date(now).toISOString().slice(0, 7),
    spentUsd: "41.8",
    limitUsd: "60",
    paused: false,
    byRole: [
      { role: "RESEARCH", usd: "14.2" },
      { role: "WRITER", usd: "9.6" },
      { role: "REVIEWER", usd: "6.1" },
      { role: "CONVERSATION", usd: "5.3" },
      { role: "MANDATE_WATCHER", usd: "3.9" },
      { role: "SCHEDULER", usd: "1.5" },
      { role: "DOCUMENTS", usd: "1.2" },
    ],
    team: [
      {
        role: "LEAD",
        state: "WORKING",
        runs: 4,
        drafts: 0,
        sentBack: 0,
        latest: null,
      },
      {
        role: "OUTREACH",
        state: "NEEDS_YOU",
        runs: 1,
        drafts: 0,
        sentBack: 0,
        latest: "1 intro waiting for you",
      },
      {
        role: "MANDATE_WATCHER",
        state: "WORKING",
        runs: 3,
        drafts: 0,
        sentBack: 0,
        latest: "214 companies watched",
      },
      {
        role: "CONVERSATION",
        state: "WORKING",
        runs: 1,
        drafts: 0,
        sentBack: 0,
        latest: "Replying to Morrow Pay",
      },
      {
        role: "WRITER",
        state: "IDLE",
        runs: 3,
        drafts: 6,
        sentBack: 0,
        latest: "Wrote it in 2 drafts.",
      },
      {
        role: "REVIEWER",
        state: "IDLE",
        runs: 3,
        drafts: 6,
        sentBack: 2,
        latest: null,
      },
      {
        role: "SCHEDULER",
        state: "IDLE",
        runs: 1,
        drafts: 0,
        sentBack: 0,
        latest: "Waiting on 1 reply",
      },
      {
        role: "DOCUMENTS",
        state: "IDLE",
        runs: 1,
        drafts: 0,
        sentBack: 0,
        latest: "Found 2 files today",
      },
      {
        role: "RESEARCH",
        state: "IDLE",
        runs: 3,
        drafts: 0,
        sentBack: 0,
        latest: "Read 3 decks today",
      },
    ],
    jobs: { open: 4, needsYou: 1 },
  });

  return { overview, jobs: [intro, reply, watch, done] };
}

/**
 * Every agent state at once (P7 team map review): the four jobs above plus
 * a draft held below the bar, a step that failed, a job being planned, a
 * message sent and waiting on a reply, and live work paused outside the
 * person's working hours. Fictional; nothing is read or sent.
 */
export function workforceAllStates(
  now: number,
  options: { readonly budgetPaused?: boolean; readonly hours?: boolean } = {},
): {
  readonly overview: WorkforceOverviewDto;
  readonly jobs: readonly WorkforceJobDetailDto[];
  readonly work: readonly QWorkDto[];
} {
  const base = workforceFixtures(now);
  const at = (minutesAgo: number) =>
    new Date(now - minutesAgo * 60_000).toISOString();
  const draft = (
    draftId: string,
    to: string,
    body: string,
    outcome: Record<string, unknown>,
    minutesAgo: number,
  ) => ({
    id: draftId,
    attempt: 2,
    parentDraftId: null,
    channel: "EMAIL",
    counterpartName: to,
    body,
    grade: null,
    outcome,
    feedback: [],
    createdAt: at(minutesAgo),
  });

  const held = WorkforceJobDetailDtoSchema.parse({
    job: summary(
      id(40),
      "Follow up Atlas Ventures",
      "INSTRUCTION",
      "RUNNING",
      at(12),
    ),
    agents: [
      run(
        id(41),
        "WRITER",
        "Follow-up to Atlas Ventures",
        "DONE",
        "Wrote 2 drafts.",
        at(13),
        null,
      ),
      run(
        id(42),
        "REVIEWER",
        "Grade: Follow-up to Atlas Ventures",
        "DONE",
        "68 against a bar of 75.",
        at(12),
        null,
      ),
    ],
    drafts: [
      draft(
        id(43),
        "Mara Lind",
        "Hi Mara, following up on our call. Could we lock a partner meeting this week?",
        { outcome: "HELD", reason: "BELOW_BAR", qActionId: null },
        12,
      ),
    ],
    timeline: [],
  });
  const failed = WorkforceJobDetailDtoSchema.parse({
    job: summary(
      id(50),
      "Read Fernhill Robotics’ deck",
      "JOB",
      "RUNNING",
      at(7),
    ),
    agents: [
      run(
        id(51),
        "DOCUMENTS",
        "Open Fernhill’s deck",
        "FAILED",
        "Couldn’t open the deck: the file is password protected.",
        at(7),
        null,
      ),
      run(
        id(52),
        "RESEARCH",
        "Read Fernhill’s site and press",
        "DONE",
        "4 findings, 1 open question.",
        at(9),
        null,
      ),
    ],
    drafts: [],
    timeline: [],
  });
  const planning = WorkforceJobDetailDtoSchema.parse({
    job: summary(
      id(60),
      "Meet three robotics founders this month",
      "JOB",
      "PLANNING",
      at(1),
    ),
    agents: [],
    drafts: [],
    timeline: [],
  });
  const waiting = WorkforceJobDetailDtoSchema.parse({
    job: summary(
      id(70),
      "Keep Kestrel Bio warm",
      "INSTRUCTION",
      "RUNNING",
      at(60 * 20),
    ),
    agents: [
      run(
        id(71),
        "CONVERSATION",
        "Note to Tom Reyes",
        "DONE",
        "Sent.",
        at(60 * 20),
        null,
      ),
    ],
    drafts: [
      draft(
        id(72),
        "Tom Reyes",
        "Hi Tom, congratulations on the Phase I readout.",
        { outcome: "SENT", reason: null, qActionId: null },
        60 * 20,
      ),
    ],
    timeline: [],
  });
  const asking = WorkforceJobDetailDtoSchema.parse({
    job: summary(
      id(90),
      "Introduce me to Fernhill Robotics",
      "JOB",
      "RUNNING",
      at(4),
    ),
    agents: [
      run(
        id(91),
        "OUTREACH",
        "First message to Nadia Okafor",
        "DONE",
        "Draft passed the bar.",
        at(4),
        null,
      ),
    ],
    drafts: [
      draft(
        id(92),
        "Nadia Okafor",
        "Hi Nadia, I read Fernhill’s note on picking cells for mid-size warehouses. The cut in re-slotting time is the kind of result we look for at seed. Would a 20-minute call next week be useful?",
        {
          outcome: "OFFERED",
          reason: null,
          qActionId: id(93),
          approvalId: id(94),
          approvalStatus: "PENDING",
        },
        4,
      ),
    ],
    timeline: [],
  });
  const work = [
    QWorkDtoSchema.parse({
      id: id(80),
      kind: "STANDING_INSTRUCTION",
      status: "ACTIVE",
      summary: null,
      createdAt: at(60 * 24 * 3),
      expiresAt: new Date(now + 30 * 86_400_000).toISOString(),
      lanes: [],
      goal: "Book calls with founders who reply",
      run: { state: "PAUSED", pauseReason: "OUTSIDE_HOURS" },
      lastStep: { words: "Waiting for 08:00", at: at(40) },
    }),
  ];
  return {
    overview: WorkforceOverviewDtoSchema.parse({
      ...base.overview,
      paused: options.budgetPaused === true,
      spentUsd: options.budgetPaused === true ? "60" : base.overview.spentUsd,
      jobs: { open: 7, needsYou: 2 },
    }),
    jobs:
      options.hours === true
        ? [asking, ...base.jobs.slice(2, 3), held, failed, waiting]
        : [planning, asking, ...base.jobs.slice(2, 3), held, failed, waiting],
    work,
  };
}
