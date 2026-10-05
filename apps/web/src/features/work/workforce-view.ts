import type {
  WorkforceAgentRunDto,
  WorkforceDraftDto,
  WorkforceJobDetailDto,
  WorkforceJobSummaryDto,
  WorkforceOverviewDto,
} from "@capital-q/contracts";

/**
 * Q's team on the Work page (founder brief J5, approved mockup
 * 2026-10-06 b/workforce): a job read as a run log. Code turns the
 * workforce record into lines in plain words -- the specialist that owns
 * each step by its role's name, never an internal id or a plan key; the
 * reviewer's score against the bar; a draft sent back and the one that
 * passed; and the approval that binds to the exact text. Nothing here
 * decides anything: it only reads what the server recorded.
 */

type Role = WorkforceAgentRunDto["role"];

/** The names the person sees for each specialist, and their monograms. */
export const ROLE_NAMES: Readonly<Record<Role, string>> = {
  LEAD: "Lead Q",
  OUTREACH: "Outreach",
  MANDATE_WATCHER: "Mandate watcher",
  CONVERSATION: "Conversation",
  WRITER: "Writer",
  REVIEWER: "Reviewer",
  SCHEDULER: "Scheduler",
  DOCUMENTS: "Documents",
  RESEARCH: "Research",
  AD_HOC: "Helper",
};

export const ROLE_MONOGRAMS: Readonly<Record<Role, string>> = {
  LEAD: "Q",
  OUTREACH: "Ou",
  MANDATE_WATCHER: "Mw",
  CONVERSATION: "Cv",
  WRITER: "Wr",
  REVIEWER: "Rv",
  SCHEDULER: "Sc",
  DOCUMENTS: "Dc",
  RESEARCH: "Re",
  AD_HOC: "Ag",
};

/** The roster's order: the lead first, then the specialists. */
export const ROSTER_ORDER: readonly Role[] = [
  "LEAD",
  "OUTREACH",
  "MANDATE_WATCHER",
  "CONVERSATION",
  "WRITER",
  "REVIEWER",
  "SCHEDULER",
  "DOCUMENTS",
  "RESEARCH",
];

/** What a specialist does, for a quiet day. */
const IDLE_LINES: Readonly<Record<Role, string>> = {
  LEAD: "No jobs open",
  OUTREACH: "Opens new relationships",
  MANDATE_WATCHER: "Watches for companies that fit",
  CONVERSATION: "Answers replies",
  WRITER: "Writes every message",
  REVIEWER: "Checks every message first",
  SCHEDULER: "Finds times and books calls",
  DOCUMENTS: "Finds what they ask for",
  RESEARCH: "Reads decks and the web",
  AD_HOC: "Helps with one step",
};

export type StepState = "done" | "run" | "back" | "you" | "wait";

export type JobLine =
  | {
      readonly kind: "step";
      readonly key: string;
      readonly state: StepState;
      /** The specialist (or "You"), in plain words. */
      readonly who: string;
      readonly mono: string;
      readonly tone: "lead" | "you" | "plain";
      readonly title: string;
      readonly what: string | null;
      readonly at: string | null;
      /** Score and bar out of 10, as the reviewer gave them. */
      readonly grade?:
        { readonly score: string; readonly bar: string | null } | undefined;
      readonly feedback?: string | undefined;
      /** The approval card this exact draft waits on. */
      readonly approval?:
        { readonly approvalId: string; readonly draftId: string } | undefined;
      /** A draft the person can read (held or offered). */
      readonly readDraftId?: string | undefined;
    }
  | { readonly kind: "handoff"; readonly key: string; readonly text: string };

const STATE_OF_RUN: Readonly<
  Record<WorkforceAgentRunDto["status"], StepState>
> = {
  RUNNING: "run",
  DONE: "done",
  HELD: "you",
  FAILED: "back",
  SKIPPED: "wait",
};

/** A score out of 100, shown out of 10 as the mockup reads it. */
export function outOfTen(score: number): string {
  return (Math.max(0, Math.min(100, score)) / 10).toFixed(1);
}

function nameOf(run: WorkforceAgentRunDto | undefined): string {
  if (run === undefined) return "Q";
  // An ad-hoc agent carries the short name the lead gave it.
  if (run.role === "AD_HOC") {
    const name = run.agentName.trim();
    return name.length > 0 && name.length <= 40 ? name : ROLE_NAMES.AD_HOC;
  }
  return ROLE_NAMES[run.role];
}

const HELD_WORDS: Readonly<Record<string, string>> = {
  BELOW_BAR: "It didn't reach your bar, so Q didn't send it.",
  INTEGRITY: "It would have said something Capital Q can't stand behind.",
  REVIEW_UNAVAILABLE: "It couldn't be checked just now, so it wasn't sent.",
  WRITER_GAVE_UP: "It couldn't be written honestly from what you approved.",
  CODE_CHECK: "A redraft broke a rule for this conversation.",
};

/** The drafts behind one message, oldest first (draft 1, its redrafts). */
export function draftChain(
  drafts: readonly WorkforceDraftDto[],
  last: WorkforceDraftDto,
): readonly WorkforceDraftDto[] {
  const byId = new Map(drafts.map((draft) => [draft.id, draft]));
  const chain: WorkforceDraftDto[] = [last];
  let at: WorkforceDraftDto | undefined = last;
  while (at?.parentDraftId != null && chain.length < 8) {
    at = byId.get(at.parentDraftId);
    if (at !== undefined) chain.unshift(at);
  }
  return chain;
}

/** The job's run log, oldest first. */
export function jobLines(detail: WorkforceJobDetailDto): readonly JobLine[] {
  const runs = new Map(detail.agents.map((run) => [run.id, run]));
  const atOf = (kind: string, draftId: string) =>
    detail.timeline.find(
      (entry) => entry.kind === kind && entry.draftId === draftId,
    )?.at ?? null;
  const lines: { line: JobLine; at: string; first: boolean }[] = [];
  const push = (line: JobLine, at: string | null, first = false) => {
    lines.push({ line, at: at ?? detail.job.updatedAt, first });
  };
  const planned = detail.agents.filter(
    (run) =>
      run.role !== "LEAD" && run.role !== "WRITER" && run.role !== "REVIEWER",
  ).length;

  for (const run of detail.agents) {
    // The writer and the reviewer are read from their drafts and grades.
    if (run.role === "WRITER" || run.role === "REVIEWER") continue;
    const lead = run.role === "LEAD";
    push(
      {
        kind: "step",
        key: `run:${run.id}`,
        state: STATE_OF_RUN[run.status],
        who: nameOf(run),
        mono: ROLE_MONOGRAMS[run.role],
        tone: lead ? "lead" : "plain",
        title: lead
          ? planned > 0
            ? "Planned the job"
            : "Took the job"
          : run.goal,
        what: lead ? run.goal : run.summary,
        // A step still waiting has not happened yet: no time.
        at: run.status === "SKIPPED" ? null : run.startedAt,
      },
      run.startedAt,
    );
  }

  for (const entry of detail.timeline) {
    if (entry.kind !== "HANDOFF" || entry.runId === null) continue;
    const from = runs.get(entry.runId);
    const to = entry.toRunId === null ? undefined : runs.get(entry.toRunId);
    // The lead assigning each step is the plan itself, and the writer and
    // reviewer passing drafts back and forth is the grade below: neither
    // is a hand-off the person needs to read.
    if (from === undefined || to === undefined || from.role === "LEAD") {
      continue;
    }
    if (
      (from.role === "WRITER" || from.role === "REVIEWER") &&
      (to.role === "WRITER" || to.role === "REVIEWER")
    ) {
      continue;
    }
    // Recorded just after the run it starts: shown just before it.
    const at =
      to.role === "WRITER" || to.startedAt > entry.at ? entry.at : to.startedAt;
    push(
      {
        kind: "handoff",
        key: `handoff:${entry.at}:${entry.runId}`,
        text: `Handed to ${nameOf(to)}`,
      },
      at,
      // Before the step it starts; after the writer's source, which the
      // writer's drafts follow.
      to.role !== "WRITER",
    );
  }

  const sortedDrafts = [...detail.drafts].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  for (const draft of sortedDrafts) {
    push(
      {
        kind: "step",
        key: `draft:${draft.id}`,
        state: "done",
        who: ROLE_NAMES.WRITER,
        mono: ROLE_MONOGRAMS.WRITER,
        tone: "plain",
        title: `Wrote draft ${String(draft.attempt)}`,
        what: null,
        at: draft.createdAt,
      },
      draft.createdAt,
    );
    const grade = draft.grade;
    if (grade !== null) {
      const next = detail.drafts.some((one) => one.parentDraftId === draft.id);
      const feedback = grade.feedback.trim();
      push(
        {
          kind: "step",
          key: `grade:${draft.id}`,
          state: grade.passed ? "done" : "back",
          who: ROLE_NAMES.REVIEWER,
          mono: ROLE_MONOGRAMS.REVIEWER,
          tone: "plain",
          title: grade.passed
            ? `Draft ${String(draft.attempt)} passed`
            : `Draft ${String(draft.attempt)} below the bar`,
          what: null,
          at: atOf("GRADE", draft.id) ?? draft.createdAt,
          grade: {
            score: outOfTen(grade.score),
            bar: grade.passed ? null : outOfTen(grade.threshold),
          },
          ...(grade.passed
            ? {}
            : {
                feedback: [feedback, next ? "Sent back to Writer." : null]
                  .filter((part) => part !== null && part.length > 0)
                  .join(" "),
              }),
        },
        atOf("GRADE", draft.id) ?? draft.createdAt,
      );
    }
    const outcome = draft.outcome;
    if (outcome === null) continue;
    const outcomeAt = atOf("OUTCOME", draft.id) ?? draft.createdAt;
    const to =
      draft.counterpartName === null ? null : `To ${draft.counterpartName}.`;
    if (outcome.outcome === "SENT") {
      push(
        {
          kind: "step",
          key: `sent:${draft.id}`,
          state: "done",
          who: "Lead Q",
          mono: ROLE_MONOGRAMS.LEAD,
          tone: "lead",
          title: `Sent draft ${String(draft.attempt)}`,
          what: to,
          at: outcomeAt,
        },
        outcomeAt,
      );
    } else if (outcome.outcome === "HELD") {
      push(
        {
          kind: "step",
          key: `held:${draft.id}`,
          state: "you",
          who: "You",
          mono: "You",
          tone: "you",
          title: "Held for you",
          what:
            HELD_WORDS[outcome.reason ?? ""] ??
            "Q didn't send it. Read it and decide.",
          at: outcomeAt,
          readDraftId: draft.id,
        },
        outcomeAt,
      );
    } else if (
      outcome.approvalId !== null &&
      outcome.approvalStatus === "PENDING"
    ) {
      push(
        {
          kind: "step",
          key: `offer:${draft.id}`,
          state: "you",
          who: "You",
          mono: "You",
          tone: "you",
          title: "Approve and send",
          what: "Nothing is sent until you approve this exact text.",
          at: null,
          approval: { approvalId: outcome.approvalId, draftId: draft.id },
          readDraftId: draft.id,
        },
        // Waiting now: after everything that led to it.
        "9999",
      );
    } else if (outcome.approvalStatus === "EXPIRED") {
      push(
        {
          kind: "step",
          key: `expired:${draft.id}`,
          state: "back",
          who: "You",
          mono: "You",
          tone: "you",
          title: "The approval expired",
          what: "Nothing was sent.",
          at: outcomeAt,
        },
        outcomeAt,
      );
    }
    for (const one of draft.feedback) {
      const words: Partial<Record<(typeof one)["kind"], string>> = {
        APPROVED: `Approved draft ${String(draft.attempt)}`,
        EDITED: `Edited draft ${String(draft.attempt)}`,
        REJECTED: "Said no to it",
        REPLIED: "They replied",
      };
      const title = words[one.kind];
      if (title === undefined) continue;
      push(
        {
          kind: "step",
          key: `feedback:${draft.id}:${one.kind}:${one.at}`,
          state: "done",
          who:
            one.kind === "REPLIED" ? (draft.counterpartName ?? "They") : "You",
          mono: one.kind === "REPLIED" ? "Re" : "You",
          tone: one.kind === "REPLIED" ? "plain" : "you",
          title,
          what: null,
          at: one.at,
        },
        one.at,
      );
    }
  }

  // Stable: equal times keep the order they were recorded in.
  return lines
    .map((entry, index) => ({ ...entry, index }))
    .sort(
      (a, b) =>
        a.at.localeCompare(b.at) ||
        Number(b.first) - Number(a.first) ||
        a.index - b.index,
    )
    .map((entry) => entry.line);
}

export type JobStatusView = {
  readonly label: string;
  readonly tone: "needs" | "plain";
  readonly icon: "hand" | "refresh" | "check" | "stop";
};

/** Whether the person is needed: a held draft, or a card waiting. */
export function needsYou(detail: WorkforceJobDetailDto): boolean {
  return (
    detail.job.status === "HELD" ||
    detail.drafts.some(
      (draft) =>
        draft.outcome?.outcome === "HELD" ||
        (draft.outcome?.outcome === "OFFERED" &&
          draft.outcome.approvalStatus === "PENDING"),
    )
  );
}

export function jobStatus(
  job: WorkforceJobSummaryDto,
  needs: boolean,
): JobStatusView {
  if (needs) return { label: "Needs you", tone: "needs", icon: "hand" };
  switch (job.status) {
    case "DONE":
      return { label: "Done", tone: "plain", icon: "check" };
    case "STOPPED":
      return { label: "Stopped", tone: "plain", icon: "stop" };
    case "FAILED":
      return { label: "Didn't finish", tone: "plain", icon: "stop" };
    case "PLANNING":
      return { label: "Planning", tone: "plain", icon: "refresh" };
    case "RUNNING":
    case "HELD":
      return { label: "Running", tone: "plain", icon: "refresh" };
  }
}

/** A job's title: the first line of its goal, short. */
export function jobTitle(goal: string): string {
  const line = goal.split(/\n/u)[0]?.trim() ?? "";
  return line.length <= 80 ? line : `${line.slice(0, 79)}…`;
}

const SOURCE_WORDS: Readonly<Record<WorkforceJobSummaryDto["source"], string>> =
  {
    JOB: "You asked",
    INSTRUCTION: "From your standing instruction",
    DELEGATED_WORK: "Work you handed to Q",
    ERRAND: "An errand you asked for",
    MEETING_FOLLOW_UP: "After your meeting",
    EMAIL_DRAFT: "An email Q drafted for you",
  };

/** The line under a job's title, in plain words. */
export function jobSubtitle(
  detail: WorkforceJobDetailDto,
  time: (iso: string) => string,
): string {
  const { job } = detail;
  if (job.status === "DONE") return `Done at ${time(job.updatedAt)}.`;
  const planned = detail.agents.filter(
    (run) =>
      run.role !== "LEAD" && run.role !== "WRITER" && run.role !== "REVIEWER",
  ).length;
  const source =
    job.source === "JOB"
      ? `You asked at ${time(job.createdAt)}.`
      : `${SOURCE_WORDS[job.source]}.`;
  return planned > 0
    ? `${source} Lead Q planned ${String(planned)} ${planned === 1 ? "step" : "steps"}.`
    : source;
}

export type TeamMember = {
  readonly role: Role;
  readonly name: string;
  readonly mono: string;
  readonly line: string;
  readonly state: "on" | "you" | "idle";
  readonly label: string;
};

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** Who's on it: every specialist, what they did today, in plain words. */
export function teamMembers(
  overview: WorkforceOverviewDto,
): readonly TeamMember[] {
  const byRole = new Map(overview.team.map((row) => [row.role, row]));
  const roles: Role[] = [...ROSTER_ORDER];
  if (byRole.has("AD_HOC")) roles.push("AD_HOC");
  return roles.map((role) => {
    const row = byRole.get(role);
    let line = IDLE_LINES[role];
    if (role === "LEAD") {
      if (overview.jobs.open > 0) {
        line = `Planning ${plural(overview.jobs.open, "job", "jobs")} for you`;
      }
    } else if (role === "WRITER" && row !== undefined && row.drafts > 0) {
      line = `${plural(row.drafts, "draft", "drafts")} today`;
    } else if (role === "REVIEWER" && row !== undefined && row.drafts > 0) {
      line = `${plural(row.drafts, "draft", "drafts")} today, ${String(row.sentBack)} sent back`;
    } else if (row?.latest != null) {
      line = row.latest;
    }
    const state =
      row?.state === "NEEDS_YOU"
        ? "you"
        : row?.state === "WORKING" ||
            (role === "LEAD" && overview.jobs.open > 0)
          ? "on"
          : "idle";
    return {
      role,
      name: ROLE_NAMES[role],
      mono: ROLE_MONOGRAMS[role],
      line,
      state,
      label:
        state === "you" ? "Needs you" : state === "on" ? "Working" : "Idle",
    };
  });
}

/** Money for the page: dollars and cents, never a float's tail. */
export function dollars(usd: string): string {
  const value = Number(usd);
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

export type CostRow = {
  readonly name: string;
  readonly usd: string;
  /** Width of its bar against the largest, 0-100. */
  readonly share: number;
};

/** This month by specialist: the five largest, then the rest together. */
export function costRows(overview: WorkforceOverviewDto): readonly CostRow[] {
  const micros = (usd: string) => Math.round(Number(usd) * 1_000_000) || 0;
  const top = overview.byRole.slice(0, 5).map((row) => ({
    name: ROLE_NAMES[row.role],
    micros: micros(row.usd),
  }));
  const rest = overview.byRole
    .slice(5)
    .reduce((sum, row) => sum + micros(row.usd), 0);
  if (rest > 0) top.push({ name: "Others", micros: rest });
  const max = Math.max(1, ...top.map((row) => row.micros));
  return top.map((row) => ({
    name: row.name,
    usd: (row.micros / 1_000_000).toFixed(6),
    share: Math.max(1, Math.round((row.micros / max) * 100)),
  }));
}

export type Marked = {
  readonly text: string;
  readonly mark: "cut" | "add" | null;
};

/** Words with their trailing space, so joined they are the text again. */
function words(text: string): readonly string[] {
  return text.match(/\s*\S+\s*/gu) ?? [];
}

/**
 * One draft's words, marked against the draft before or after it: what a
 * redraft cut from draft 1, or added in draft 2. A word-level longest
 * common subsequence; drafts are at most a few hundred words.
 */
export function markAgainst(
  body: string,
  other: string | null,
  mark: "cut" | "add",
): readonly Marked[] {
  if (other === null) return [{ text: body, mark: null }];
  const mine = words(body);
  const theirs = words(other);
  const key = (word: string) => word.trim().toLowerCase();
  const rows = mine.length;
  const cols = theirs.length;
  const table: number[] = new Array<number>((rows + 1) * (cols + 1)).fill(0);
  const at = (i: number, j: number) => table[i * (cols + 1) + j] ?? 0;
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i * (cols + 1) + j] =
        key(mine[i] ?? "") === key(theirs[j] ?? "")
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const kept: boolean[] = [];
  let i = 0;
  let j = 0;
  while (i < rows) {
    if (j < cols && key(mine[i] ?? "") === key(theirs[j] ?? "")) {
      kept.push(true);
      i += 1;
      j += 1;
    } else if (j < cols && at(i, j + 1) >= at(i + 1, j)) {
      j += 1;
    } else {
      kept.push(false);
      i += 1;
    }
  }
  const out: { text: string; mark: "cut" | "add" | null }[] = [];
  mine.forEach((word, index) => {
    const value = kept[index] === true ? null : mark;
    const last = out.at(-1);
    if (last !== undefined && last.mark === value) last.text += word;
    else out.push({ text: word, mark: value });
  });
  return out;
}

const CRITERION_WORDS: Readonly<
  Record<string, { readonly good: string; readonly bad: string }>
> = {
  WARM_OPENING: {
    good: "Starts warm, with something specific",
    bad: "Doesn't start warm",
  },
  ASK_TIMING: { good: "Asks at the right moment", bad: "Asks too soon" },
  ANSWERS_THEM: { good: "Answers what they said", bad: "Doesn't answer them" },
  CONCISE_AND_CALM: { good: "Short and plain", bad: "Too long or pushy" },
  READS_SIGNALS: { good: "Reads their signals", bad: "Misses their signals" },
  PERSONAL_STYLE: { good: "Your tone", bad: "Not your tone" },
};
const INTEGRITY_WORDS: Readonly<Record<string, string>> = {
  GROUNDED: "Says something that isn't in what you approved",
  NO_COMMITMENTS: "Commits you to something",
  NOTHING_PRIVATE: "Shares something private",
  HONEST_IDENTITY: "Isn't honest about who is writing",
};

/** The reviewer's notable marks on a draft, as ticks and crosses. */
export function gradeRules(
  grade: WorkforceDraftDto["grade"],
): readonly { readonly ok: boolean; readonly text: string }[] {
  if (grade === null) return [];
  const broken = grade.integrity
    .filter((rule) => !rule.ok)
    .map((rule) => ({
      ok: false,
      text: INTEGRITY_WORDS[rule.rule] ?? "Breaks one of Capital Q's rules",
    }));
  const bad = grade.criteria
    .filter((one) => one.score <= 2 && CRITERION_WORDS[one.criterion])
    .map((one) => ({
      ok: false,
      text: CRITERION_WORDS[one.criterion]?.bad ?? "",
    }));
  const good = grade.criteria
    .filter((one) => one.score >= 4 && CRITERION_WORDS[one.criterion])
    .map((one) => ({
      ok: true,
      text: CRITERION_WORDS[one.criterion]?.good ?? "",
    }));
  return [...broken, ...bad, ...good].slice(0, 3);
}
