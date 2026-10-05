import {
  WorkforceJobDetailDtoSchema,
  WorkforceOverviewDtoSchema,
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
