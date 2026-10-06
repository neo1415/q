import type {
  QWorkDto,
  WorkforceAgentRunDto,
  WorkforceJobDetailDto,
  WorkforceOverviewDto,
} from "@capital-q/contracts";

import {
  HELD_WORDS,
  IDLE_LINES,
  ROLE_MONOGRAMS,
  ROLE_NAMES,
  ROSTER_ORDER,
  jobTitle,
} from "./workforce-view";

/**
 * Q's team as a map (P7, mockup docs/design/2026-10-06/workforce): one
 * node per specialist, each in exactly one state the person can read at a
 * glance. Code reads the state from what the server recorded -- runs,
 * drafts, approvals, the month's limit, live work's pause reason -- and
 * never guesses: no record today is "Idle", not "Done".
 *
 * Nine states, each with its own words, glyph and ring style, so meaning
 * never rests on colour alone.
 */

type Role = WorkforceAgentRunDto["role"];

export const AGENT_STATES = [
  "asking",
  "held",
  "failed",
  "working",
  "thinking",
  "waiting",
  "paused",
  "done",
  "idle",
] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export type PauseReason = "budget" | "hours" | "you";

export type AgentNode = {
  readonly role: Role;
  readonly name: string;
  readonly mono: string;
  readonly lead: boolean;
  readonly state: AgentState;
  readonly pause: PauseReason | null;
  /** What it is doing (or did, or waits on), in plain words. */
  readonly now: string;
  /** The job this state comes from; null for a quiet day. */
  readonly jobId: string | null;
  readonly job: string | null;
  /** When this state began (ISO); null when unknown. */
  readonly since: string | null;
  /** Runs today and this month's spend, from the overview. */
  readonly runs: number;
  readonly monthUsd: string;
  /** The approval card that binds to the exact text, when it asks. */
  readonly approval: {
    readonly approvalId: string;
    readonly draftId: string;
  } | null;
  /** A draft the person can read (asking or held). */
  readonly draftId: string | null;
  /** Who it waits on, when waiting. */
  readonly waitingOn: string | null;
};

/** The state's own word, as the chips and the legend show it. */
export const STATE_WORDS: Readonly<Record<AgentState, string>> = {
  asking: "Needs your OK",
  held: "Held for you",
  failed: "Didn’t finish",
  working: "Working",
  thinking: "Planning",
  waiting: "Waiting",
  paused: "Paused",
  done: "Done",
  idle: "Idle",
};

/** The node's label: the state, with the pause's reason or who it waits on. */
export function stateLabel(node: Pick<AgentNode, "state" | "pause" | "waitingOn">): string {
  if (node.state === "paused") {
    return node.pause === "budget"
      ? "Paused: monthly limit"
      : node.pause === "hours"
        ? "Paused: outside hours"
        : "Paused by you";
  }
  if (node.state === "waiting" && node.waitingOn !== null) {
    const first = node.waitingOn.trim().split(/\s+/u)[0] ?? "";
    return first.length > 0 ? `Waiting on ${first}` : "Waiting on them";
  }
  return STATE_WORDS[node.state];
}

/** "4 min ago" from an ISO time and the reader's clock; null if unknown. */
export function sinceWords(iso: string | null, now: number): string | null {
  if (iso === null) return null;
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${String(Math.floor(seconds / 3600))} h ago`;
  return `${String(Math.floor(seconds / 86_400))} d ago`;
}

/** Lower is louder: what the person must see first. */
export function stateRank(state: AgentState): number {
  return AGENT_STATES.indexOf(state);
}

/** Work that is live now (the map's lines carry it). */
export function isLive(state: AgentState): boolean {
  return state === "working" || state === "thinking";
}

/** Live work's pause reason code, read as the person's words. */
export function pauseOf(code: string | null): PauseReason {
  if (code === null) return "you";
  if (code.includes("BUDGET") || code.includes("LIMIT")) return "budget";
  if (code.includes("HOURS")) return "hours";
  return "you";
}

type Candidate = {
  readonly state: AgentState;
  readonly pause?: PauseReason | undefined;
  readonly now: string;
  readonly job: WorkforceJobDetailDto | null;
  readonly title?: string | undefined;
  readonly since: string | null;
  readonly approval?: AgentNode["approval"] | undefined;
  readonly draftId?: string | undefined;
  readonly waitingOn?: string | undefined;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The specialist who speaks for the job when a message waits on a yes. */
function speaker(job: WorkforceJobDetailDto): Role {
  const roles = new Set(job.agents.map((run) => run.role));
  if (roles.has("OUTREACH")) return "OUTREACH";
  if (roles.has("CONVERSATION")) return "CONVERSATION";
  return "LEAD";
}

function better(a: Candidate | undefined, b: Candidate): Candidate {
  if (a === undefined) return b;
  const byRank = stateRank(b.state) - stateRank(a.state);
  if (byRank !== 0) return byRank < 0 ? b : a;
  // Same state: the most recent wins.
  return (b.since ?? "") > (a.since ?? "") ? b : a;
}

function candidatesOf(
  job: WorkforceJobDetailDto,
  now: number,
): readonly (readonly [Role, Candidate])[] {
  const out: (readonly [Role, Candidate])[] = [];
  const recent = (iso: string | null) =>
    iso !== null && now - Date.parse(iso) < DAY_MS;
  const ended = job.job.status === "DONE" || job.job.status === "STOPPED";

  for (const run of job.agents) {
    const words = (run.summary ?? run.goal).trim();
    switch (run.status) {
      case "RUNNING":
        if (ended) break;
        out.push([
          run.role,
          {
            state:
              run.role === "LEAD" && job.job.status === "PLANNING"
                ? "thinking"
                : "working",
            now: run.goal.trim() || words,
            job,
            since: run.startedAt,
          },
        ]);
        break;
      case "FAILED":
        if (!recent(run.endedAt ?? run.startedAt)) break;
        out.push([
          run.role,
          {
            state: "failed",
            now: run.summary?.trim() || "It couldn’t finish this step.",
            job,
            since: run.endedAt ?? run.startedAt,
          },
        ]);
        break;
      case "DONE":
        if (!recent(run.endedAt ?? run.startedAt)) break;
        out.push([
          run.role,
          { state: "done", now: words, job, since: run.endedAt ?? run.startedAt },
        ]);
        break;
      case "HELD":
      case "SKIPPED":
        // A held run is read from its draft below; a skipped one has not
        // started: neither is the specialist's state on its own.
        break;
    }
  }

  if (job.job.status === "PLANNING" && !job.agents.some((r) => r.role === "LEAD" && r.status === "RUNNING")) {
    out.push([
      "LEAD",
      {
        state: "thinking",
        now: `Planning “${jobTitle(job.job.goal)}”`,
        job,
        since: job.job.createdAt,
      },
    ]);
  }
  if (job.job.status === "FAILED" && recent(job.job.updatedAt)) {
    out.push([
      "LEAD",
      {
        state: "failed",
        now: "The job didn’t finish.",
        job,
        since: job.job.updatedAt,
      },
    ]);
  }

  for (const draft of job.drafts) {
    const outcome = draft.outcome;
    if (outcome === null) continue;
    if (outcome.outcome === "HELD" && !ended) {
      const replied = draft.feedback.some(
        (one) => one.kind === "APPROVED" || one.kind === "REJECTED" || one.kind === "EDITED",
      );
      if (replied) continue;
      out.push([
        "REVIEWER",
        {
          state: "held",
          now:
            HELD_WORDS[outcome.reason ?? ""] ??
            "Q didn’t send it. Read it and decide.",
          job,
          since: draft.createdAt,
          draftId: draft.id,
        },
      ]);
    } else if (
      outcome.outcome === "OFFERED" &&
      outcome.approvalStatus === "PENDING" &&
      outcome.approvalId !== null
    ) {
      const to = draft.counterpartName;
      out.push([
        speaker(job),
        {
          state: "asking",
          now:
            to === null
              ? "Wants to send a message. Nothing is sent until you approve it."
              : `Wants to send a message to ${to}. Nothing is sent until you approve it.`,
          job,
          since: draft.createdAt,
          approval: { approvalId: outcome.approvalId, draftId: draft.id },
          draftId: draft.id,
        },
      ]);
    } else if (outcome.outcome === "SENT" && !ended) {
      const replied = draft.feedback.some((one) => one.kind === "REPLIED");
      if (replied || draft.counterpartName === null) continue;
      out.push([
        speaker(job) === "LEAD" ? "CONVERSATION" : speaker(job),
        {
          state: "waiting",
          now: `Sent to ${draft.counterpartName}. Waiting for a reply.`,
          job,
          since: draft.createdAt,
          waitingOn: draft.counterpartName,
        },
      ]);
    }
  }
  return out;
}

/** Live work (standing instructions, outreach) that waits or is paused. */
function workCandidates(
  work: readonly QWorkDto[],
): readonly (readonly [Role, Candidate])[] {
  const out: (readonly [Role, Candidate])[] = [];
  for (const item of work) {
    if (item.status !== "ACTIVE" || item.run === null) continue;
    const title = jobTitle(item.goal ?? item.summary ?? "Q’s work");
    const since = item.lastStep?.at ?? item.createdAt;
    if (item.run.state === "PAUSED") {
      const pause = pauseOf(item.run.pauseReason);
      out.push([
        "LEAD",
        {
          state: "paused",
          pause,
          now:
            pause === "budget"
              ? `Paused at your monthly limit: ${title}`
              : pause === "hours"
                ? `Outside your working hours: ${title}`
                : `You paused it: ${title}`,
          job: null,
          title,
          since,
        },
      ]);
    } else if (item.run.state === "WAITING") {
      const lane = item.lanes.find(
        (one) => one.stage === "WAITING_ACCEPTANCE" || one.stage === "CHATTING",
      );
      const name = lane?.counterpartName ?? null;
      out.push([
        item.kind === "INVESTOR_OUTREACH" ? "OUTREACH" : "CONVERSATION",
        {
          state: "waiting",
          now:
            name === null
              ? `Waiting on the other side: ${title}`
              : `Waiting for ${name} to reply`,
          job: null,
          title,
          since,
          waitingOn: name ?? undefined,
        },
      ]);
    }
  }
  return out;
}

/**
 * Every specialist on the roster with one state each, the lead first.
 * `now` is the reader's clock (ms), so "today" means the last 24 hours.
 */
export function agentNodes(input: {
  readonly overview: WorkforceOverviewDto;
  readonly jobs: readonly WorkforceJobDetailDto[];
  readonly work?: readonly QWorkDto[] | null | undefined;
  readonly now: number;
}): readonly AgentNode[] {
  const { overview, jobs, now } = input;
  const best = new Map<Role, Candidate>();
  const offer = (role: Role, candidate: Candidate) => {
    best.set(role, better(best.get(role), candidate));
  };
  for (const job of jobs) {
    for (const [role, candidate] of candidatesOf(job, now)) offer(role, candidate);
  }
  for (const [role, candidate] of workCandidates(input.work ?? [])) {
    offer(role, candidate);
  }

  const team = new Map(overview.team.map((row) => [row.role, row]));
  const spend = new Map(overview.byRole.map((row) => [row.role, row.usd]));
  const roles: Role[] = [...ROSTER_ORDER];
  if (best.has("AD_HOC") || team.has("AD_HOC")) roles.push("AD_HOC");

  return roles.map((role): AgentNode => {
    let candidate = best.get(role);
    const row = team.get(role);
    if (candidate === undefined && row !== undefined && row.state !== "IDLE") {
      // The overview knows it is on something the recent jobs don't show.
      candidate = {
        state: row.state === "NEEDS_YOU" ? "held" : "working",
        now:
          row.latest ??
          (row.state === "NEEDS_YOU" ? "Waiting for you." : IDLE_LINES[role]),
        job: null,
        since: null,
      };
    }
    // The month's limit pauses whatever would be running.
    if (
      overview.paused &&
      candidate !== undefined &&
      isLive(candidate.state)
    ) {
      candidate = {
        ...candidate,
        state: "paused",
        pause: "budget",
        now: `Paused at your monthly limit. ${candidate.now}`,
      };
    }
    const base = {
      role,
      name: ROLE_NAMES[role],
      mono: ROLE_MONOGRAMS[role],
      lead: role === "LEAD",
      runs: row?.runs ?? 0,
      monthUsd: spend.get(role) ?? "0",
    };
    if (candidate === undefined) {
      return {
        ...base,
        state: "idle",
        pause: null,
        now:
          role === "LEAD" && overview.jobs.open === 0
            ? IDLE_LINES.LEAD
            : IDLE_LINES[role],
        jobId: null,
        job: null,
        since: null,
        approval: null,
        draftId: null,
        waitingOn: null,
      };
    }
    return {
      ...base,
      state: candidate.state,
      pause: candidate.state === "paused" ? (candidate.pause ?? "you") : null,
      now: candidate.now,
      jobId: candidate.job?.job.id ?? null,
      job:
        candidate.job === null
          ? (candidate.title ?? null)
          : jobTitle(candidate.job.job.goal),
      since: candidate.since,
      approval: candidate.approval ?? null,
      draftId: candidate.draftId ?? null,
      waitingOn: candidate.waitingOn ?? null,
    };
  });
}

/** How many specialists are in each state, loudest first; empty states left out. */
export function stateCounts(
  nodes: readonly AgentNode[],
): readonly { readonly state: AgentState; readonly count: number }[] {
  return AGENT_STATES.map((state) => ({
    state,
    count: nodes.filter((node) => node.state === state).length,
  })).filter((one) => one.count > 0);
}

/** The lines on the map: lead to each specialist, writer to reviewer. */
export type MapLink = {
  readonly from: Role;
  readonly to: Role;
  readonly kind: "live" | "ask" | "peer" | "plain";
};

export function mapLinks(nodes: readonly AgentNode[]): readonly MapLink[] {
  const links: MapLink[] = nodes
    .filter((node) => !node.lead)
    .map((node) => ({
      from: "LEAD" as const,
      to: node.role,
      kind: isLive(node.state)
        ? "live"
        : node.state === "asking"
          ? "ask"
          : "plain",
    }));
  links.push({ from: "WRITER", to: "REVIEWER", kind: "peer" });
  return links;
}

export type Point = { readonly x: number; readonly y: number };

/**
 * Where each node sits: the lead in the middle, the specialists on one
 * ellipse in roster order (so the writer and the reviewer are neighbours).
 * Deterministic: nothing moves on its own.
 */
export function mapLayout(
  roles: readonly Role[],
  compact: boolean,
): {
  readonly width: number;
  readonly height: number;
  readonly at: ReadonlyMap<Role, Point>;
} {
  const width = compact ? 720 : 1240;
  const height = compact ? 960 : 740;
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2 - (compact ? 100 : 150);
  const ry = height / 2 - (compact ? 90 : 78);
  const ring = roles.filter((role) => role !== "LEAD");
  const at = new Map<Role, Point>([["LEAD", { x: cx, y: cy }]]);
  ring.forEach((role, index) => {
    const t = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, ring.length);
    at.set(role, {
      x: Math.round(cx + rx * Math.cos(t)),
      y: Math.round(cy + ry * Math.sin(t)),
    });
  });
  return { width, height, at };
}

/** Zoom limits, and the scale at which the map shows less or more. */
export const ZOOM = { min: 0.4, max: 1.8, far: 0.72, near: 1.3 } as const;

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(ZOOM.max, Math.max(ZOOM.min, scale));
}

export type View = { readonly scale: number; readonly x: number; readonly y: number };

/** Zoom about a point in the viewport, keeping that point still. */
export function zoomAbout(view: View, next: number, px: number, py: number): View {
  const scale = clampZoom(next);
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

/** The view that shows the whole map, centred. */
export function fitView(
  viewport: { readonly width: number; readonly height: number },
  world: { readonly width: number; readonly height: number },
): View {
  const scale = clampZoom(
    Math.min(viewport.width / (world.width + 40), viewport.height / (world.height + 30)),
  );
  return {
    scale,
    x: (viewport.width - world.width * scale) / 2,
    y: (viewport.height - world.height * scale) / 2,
  };
}

/** Semantic zoom: far shows rings and names, near shows the details. */
export function zoomLevel(scale: number): "far" | "mid" | "near" {
  return scale < ZOOM.far ? "far" : scale >= ZOOM.near ? "near" : "mid";
}
