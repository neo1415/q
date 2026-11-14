import {
  ACCOUNT_DIGEST_MEETING_DAYS,
  ACCOUNT_DIGEST_MEETINGS_MAX,
  ACCOUNT_DIGEST_RECENT_DAYS,
  ACCOUNT_DIGEST_RECENT_MAX,
  ACCOUNT_DIGEST_RELATIONSHIPS_MAX,
  ACCOUNT_DIGEST_REQUESTS_MAX,
  ACCOUNT_DIGEST_WAITING_MAX,
  ACCOUNT_DIGEST_WORK_MAX,
  ACCOUNT_DIGEST_APPLICATIONS_MAX,
  QAccountDigestSchema,
  type AccountDigestEvent,
  type AccountDigestGateq,
  type AccountDigestInbox,
  type AccountDigestMeeting,
  type AccountDigestRelationship,
  type AccountDigestRequest,
  type AccountDigestSection,
  type AccountDigestWork,
  type QAccountDigest,
  type QAttentionReport,
  type RelationshipStateV2,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import type {
  ApprovalInboxPort,
  OwnRelationship,
  OwnRelationships,
  RelationshipIntelligencePort,
} from "../ports.js";
import {
  createAttentionReader,
  type AttentionPort,
  type AttentionReader,
} from "./attention.js";
import type { QWorkIntelligencePort } from "./q-work.js";
import type { ScheduleIntelligencePort } from "./schedule.js";

/**
 * Owner requirement 14 Nov 2026 (audit P0 #2, D1): the account digest --
 * what is happening, has happened and is about to happen in the asking
 * person's account -- assembled by code for every Q turn and for the resume
 * opening. It reuses the reads their pages and Q's tools already make
 * (their relationships screen, the attention report, their schedule, Q's
 * work, the GateQ pages), each as the resolved actor, each answering for
 * the actor's own side only: the same projection a page shows them, so the
 * digest can hold nothing the person could not already see. No model call,
 * no new table. Every read is bounded and on a deadline; a read that fails
 * or runs late is named in `unread`, never reported as nothing.
 *
 * One digest read reads each source once: the attention report is composed
 * over the same memoised reads (relationships, schedule, work, approvals).
 */

/** GateQ, composed by the app over GateQ's own reads and authority. */
export type AccountDigestGateqPort = {
  /** A founder's own submitted applications (their GateQ page's read). */
  readonly founderApplications?:
    | ((actor: ActorContext) => Promise<{
        readonly applications: AccountDigestGateq["applications"];
        readonly total: number;
      }>)
    | undefined;
  /** An investor's own gateway inbox, counted; null: no gateway. */
  readonly investorInbox?:
    | ((actor: ActorContext) => Promise<AccountDigestInbox | null>)
    | undefined;
};

export type AccountDigestPorts = {
  readonly relationships?: RelationshipIntelligencePort | undefined;
  readonly approvalInbox?: ApprovalInboxPort | undefined;
  readonly schedule?: ScheduleIntelligencePort | undefined;
  readonly work?: QWorkIntelligencePort | undefined;
  readonly attention?: AttentionPort | undefined;
  readonly gateqDigest?: AccountDigestGateqPort | undefined;
};

export type AccountDigestReader = (
  actor: ActorContext,
  options?: { readonly now?: Date | undefined },
) => Promise<QAccountDigest>;

const DAY_MS = 24 * 3_600_000;
/**
 * One section's wait. A Q turn starts the digest with its other reads; a
 * slow source is left unread rather than holding the answer.
 */
export const ACCOUNT_DIGEST_SECTION_DEADLINE_MS = 1_500;

class DigestDeadline extends Error {}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DigestDeadline()), ms);
  });
  return Promise.race([work, late]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** One read per digest, shared by every section that needs it. */
function once<T>(read: () => Promise<T>): () => Promise<T> {
  let started: Promise<T> | undefined;
  return () => (started ??= read());
}

const iso = (value: string | Date | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

const clip = (text: string, max: number): string =>
  text.replace(/\s+/gu, " ").trim().slice(0, max);

const STAGE_WORDS: Readonly<Record<RelationshipStateV2, string>> = {
  DISCOVERED: "discovered",
  INTEREST_EXPRESSED: "interest expressed",
  CONNECTED: "connected",
  DECLINED: "declined",
  MEETING_HELD: "meeting held",
  IN_DILIGENCE: "in diligence",
  PAUSED: "paused",
  PASSED: "passed",
  INVESTED: "invested",
};

/** What the person owes, or waits for, in one relationship. */
export function owedIn(
  item: OwnRelationship,
): AccountDigestRelationship["owed"] {
  const last = item.lastMessage;
  if (last !== undefined && last !== null) {
    return last.from === "THEM" ? "YOU_OWE_REPLY" : "AWAITING_THEM";
  }
  // Interest they expressed and the other side has not answered yet.
  return item.nextStep === "AWAIT_ANSWER" ? "AWAITING_THEM" : null;
}

/** A step that is the person's to take now, by consequence. */
const ACTION_RANK: Readonly<Record<string, number>> = {
  ANSWER_INTEREST: 1,
  SCHEDULE_MEETING: 2,
  DECIDE_NEXT_STEP: 3,
  FOLLOW_UP: 3,
  RESUME: 5,
};

/** Closed relationships go last: nothing is moving there. */
const CLOSED: ReadonlySet<RelationshipStateV2> = new Set([
  "DECLINED",
  "PASSED",
]);

/**
 * Most relevant first: a reply they owe, then a step that is theirs, then
 * one they wait on, then the rest by how recently it moved; closed last.
 */
export function relationshipOrder(
  a: AccountDigestRelationship,
  b: AccountDigestRelationship,
): number {
  const rank = (row: AccountDigestRelationship): number =>
    CLOSED.has(row.stage)
      ? 9
      : row.owed === "YOU_OWE_REPLY"
        ? 0
        : (ACTION_RANK[row.nextStep] ??
          (row.owed === "AWAITING_THEM" ? 6 : 7));
  return (
    rank(a) - rank(b) ||
    Date.parse(b.lastMessageAt ?? b.stageSince) -
      Date.parse(a.lastMessageAt ?? a.stageSince)
  );
}

export function digestRelationships(own: OwnRelationships | null): {
  readonly listed: readonly AccountDigestRelationship[];
  readonly total: number;
  readonly byStage: Partial<Record<RelationshipStateV2, number>>;
  readonly counterpartIds: readonly string[];
} {
  const rows = (own?.items ?? []).flatMap(
    (item): AccountDigestRelationship[] => {
      const stageSince = iso(item.stateSince);
      if (stageSince === null) return [];
      return [
        {
          relationshipId: item.relationshipId,
          counterpart: {
            kind: item.counterpart.kind,
            id: item.counterpart.id,
            name: clip(item.counterpart.name, 120) || "Unnamed",
          },
          stage: item.state,
          stageSince,
          nextStep: item.nextStep,
          owed: owedIn(item),
          lastMessageAt: iso(item.lastMessage?.at),
        },
      ];
    },
  );
  const byStage: Partial<Record<RelationshipStateV2, number>> = {};
  for (const row of rows) byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
  return {
    listed: [...rows]
      .sort(relationshipOrder)
      .slice(0, ACCOUNT_DIGEST_RELATIONSHIPS_MAX),
    total: rows.length,
    byStage,
    counterpartIds: [...new Set(rows.map((row) => row.counterpart.id))].slice(
      0,
      200,
    ),
  };
}

/** Milestones of the last few days, newest first. */
export function recentEvents(
  own: OwnRelationships | null,
  report: QAttentionReport | null,
  now: Date,
): readonly AccountDigestEvent[] {
  const from = now.getTime() - ACCOUNT_DIGEST_RECENT_DAYS * DAY_MS;
  const events: AccountDigestEvent[] = [];
  for (const item of own?.items ?? []) {
    for (const milestone of item.milestones) {
      const at = iso(milestone.at);
      if (at === null) continue;
      const when = Date.parse(at);
      if (when < from || when > now.getTime()) continue;
      events.push({
        at,
        text: clip(
          `${item.counterpart.name}: ${STAGE_WORDS[milestone.state]}`,
          200,
        ),
        relationshipId: item.relationshipId,
      });
    }
    const last = item.lastMessage;
    const lastAt = iso(last?.at);
    if (last !== undefined && last !== null && lastAt !== null) {
      const when = Date.parse(lastAt);
      if (when >= from && when <= now.getTime()) {
        events.push({
          at: lastAt,
          text: clip(
            last.from === "THEM"
              ? `${item.counterpart.name} wrote to you`
              : `You wrote to ${item.counterpart.name}`,
            200,
          ),
          relationshipId: item.relationshipId,
        });
      }
    }
  }
  const activity = report?.activity ?? null;
  if (activity !== null) {
    const done = [
      activity.repliesSent > 0
        ? `${String(activity.repliesSent)} repl${activity.repliesSent === 1 ? "y" : "ies"} sent`
        : null,
      activity.messagesSent > 0
        ? `${String(activity.messagesSent)} message${activity.messagesSent === 1 ? "" : "s"} sent`
        : null,
      activity.callsBooked > 0
        ? `${String(activity.callsBooked)} call${activity.callsBooked === 1 ? "" : "s"} booked`
        : null,
      activity.interestExpressed > 0
        ? `interest expressed ${String(activity.interestExpressed)} time${activity.interestExpressed === 1 ? "" : "s"}`
        : null,
      activity.jobsCompleted > 0
        ? `${String(activity.jobsCompleted)} piece${activity.jobsCompleted === 1 ? "" : "s"} of work finished`
        : null,
    ].filter((part): part is string => part !== null);
    const at = iso(report?.readAt);
    if (done.length > 0 && at !== null) {
      events.push({
        at,
        text: clip(`Q for you since ${activity.since.slice(0, 10)}: ${done.join(", ")}`, 200),
        relationshipId: null,
      });
    }
  }
  return events
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, ACCOUNT_DIGEST_RECENT_MAX);
}

type Upcoming = Awaited<ReturnType<ScheduleIntelligencePort["upcoming"]>>;

/** Calls from ten minutes ago to fourteen days ahead, soonest first. */
export function upcomingMeetings(
  upcoming: Upcoming,
  now: Date,
): readonly AccountDigestMeeting[] {
  const from = now.getTime() - 10 * 60_000;
  const until = now.getTime() + ACCOUNT_DIGEST_MEETING_DAYS * DAY_MS;
  return upcoming.meetings
    .flatMap((meeting): AccountDigestMeeting[] => {
      const startsAt = iso(meeting.startsAt);
      if (startsAt === null) return [];
      const when = Date.parse(startsAt);
      if (when < from || when > until) return [];
      return [
        {
          id: clip(meeting.id, 80),
          relationshipId: meeting.relationshipId || null,
          purpose: clip(meeting.purpose || "Call", 160),
          startsAt,
          timeZone: meeting.timeZone ? clip(meeting.timeZone, 64) : null,
          with: meeting.attendees.slice(0, 4).map((name) => clip(name, 120)),
          hasBrief: meeting.hasBrief,
        },
      ];
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, ACCOUNT_DIGEST_MEETINGS_MAX);
}

const LANE_CLOSED = new Set(["DECLINED", "DONE", "STOPPED", "FAILED"]);

type WorkItems = Awaited<ReturnType<QWorkIntelligencePort["list"]>>;
type Errands = Awaited<
  ReturnType<NonNullable<QWorkIntelligencePort["errands"]>>
>;

/** Q's work for them: running first, then what finished in the last days. */
export function digestWork(
  items: WorkItems,
  errands: Errands,
  now: Date,
): readonly AccountDigestWork[] {
  const from = now.getTime() - ACCOUNT_DIGEST_RECENT_DAYS * DAY_MS;
  const rows: AccountDigestWork[] = [];
  for (const job of items) {
    const updatedAt = iso(job.lastStep?.at ?? job.createdAt);
    if (updatedAt === null) continue;
    if (job.status !== "ACTIVE" && Date.parse(updatedAt) < from) continue;
    rows.push({
      id: job.id,
      kind: job.kind,
      status: job.status,
      goal: clip(job.goal ?? job.summary ?? job.kind, 160),
      open: Math.min(
        job.lanes.filter((lane) => !LANE_CLOSED.has(lane.stage)).length,
        100,
      ),
      updatedAt,
    });
  }
  for (const errand of errands) {
    if (!/^[0-9a-f-]{36}$/iu.test(errand.errandId)) continue;
    const running = !/^(DONE|STOPPED|FAILED|CANCELLED|EXPIRED|COMPLETED)$/iu.test(
      errand.status,
    );
    if (!running) continue;
    rows.push({
      id: errand.errandId,
      kind: "ERRAND",
      status: clip(errand.status, 20),
      goal: clip(
        `Errand with ${errand.counterpartName}${errand.lastStep === null ? "" : `: ${errand.lastStep}`}`,
        160,
      ),
      open: 0,
      updatedAt: now.toISOString(),
    });
  }
  return rows
    .sort(
      (a, b) =>
        Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    )
    .slice(0, ACCOUNT_DIGEST_WORK_MAX);
}

/** The digest reader the Q turn and the HTTP route share. */
export function createAccountDigestReader(
  ports: AccountDigestPorts,
): AccountDigestReader {
  return async (actor, options = {}) => {
    const now = options.now ?? new Date();
    const unread = new Set<AccountDigestSection>();
    const section = async <T>(
      name: AccountDigestSection,
      read: () => Promise<T>,
      fallback: T,
    ): Promise<T> => {
      try {
        return await withDeadline(read(), ACCOUNT_DIGEST_SECTION_DEADLINE_MS);
      } catch {
        unread.add(name);
        return fallback;
      }
    };

    // Each source once per digest; the attention report reads the same.
    const ownRelationships = ports.relationships?.ownRelationships;
    const relationshipsOnce =
      ownRelationships === undefined
        ? null
        : once(() => ownRelationships(actor));
    const upcoming = ports.schedule?.upcoming;
    const scheduleOnce =
      upcoming === undefined ? null : once(() => upcoming(actor));
    const workList = ports.work?.list;
    const workOnce = workList === undefined ? null : once(() => workList(actor));
    const pending = ports.approvalInbox?.pending;
    const approvalsOnce =
      pending === undefined ? null : once(() => pending(actor));
    // The attention report over the same once-per-digest reads.
    const attention: AttentionReader = createAttentionReader({
      ...(ports.relationships === undefined
        ? {}
        : {
            relationships:
              relationshipsOnce === null
                ? ports.relationships
                : { ...ports.relationships, ownRelationships: relationshipsOnce },
          }),
      ...(ports.approvalInbox === undefined || approvalsOnce === null
        ? {}
        : {
            approvalInbox: { ...ports.approvalInbox, pending: approvalsOnce },
          }),
      ...(ports.schedule === undefined || scheduleOnce === null
        ? {}
        : { schedule: { ...ports.schedule, upcoming: scheduleOnce } }),
      ...(ports.work === undefined || workOnce === null
        ? {}
        : { work: { ...ports.work, list: workOnce } }),
      ...(ports.attention === undefined ? {} : { attention: ports.attention }),
    });
    /** A source with no port composed: unread, never empty. */
    const notComposed = <T>(name: AccountDigestSection, value: T): Promise<T> => {
      unread.add(name);
      return Promise.resolve(value);
    };
    const errandsOf = ports.work?.errands;

    const [own, report, schedule, work, errands, gateq] = await Promise.all([
      relationshipsOnce === null
        ? notComposed<OwnRelationships | null>("RELATIONSHIPS", null)
        : section("RELATIONSHIPS", relationshipsOnce, null),
      section<QAttentionReport | null>(
        "WAITING",
        () => attention(actor, { now }),
        null,
      ),
      scheduleOnce === null
        ? notComposed<Upcoming | null>("MEETINGS", null)
        : section<Upcoming | null>("MEETINGS", scheduleOnce, null),
      workOnce === null
        ? notComposed<WorkItems>("WORK", [])
        : section<WorkItems>("WORK", workOnce, []),
      errandsOf === undefined
        ? Promise.resolve<Errands>([])
        : section<Errands>("WORK", () => errandsOf(actor), []),
      readGateq(ports.gateqDigest, actor, section),
    ]);
    // A report with sources it could not check is not the whole picture.
    if (report !== null && report.unread.length > 0) unread.add("WAITING");

    const relationships = digestRelationships(own);
    const requests = await section(
      "REQUESTS",
      () => openRequests(ports.relationships, actor, own),
      [] as readonly AccountDigestRequest[],
    );
    const digest: QAccountDigest = {
      side: own?.side ?? null,
      relationships: [...relationships.listed],
      relationshipsTotal: relationships.total,
      byStage: relationships.byStage,
      relationshipCounterpartIds: [...relationships.counterpartIds],
      waiting: (report?.items ?? []).slice(0, ACCOUNT_DIGEST_WAITING_MAX),
      waitingTotal: report?.items.length ?? 0,
      meetings: schedule === null ? [] : [...upcomingMeetings(schedule, now)],
      work: [...digestWork(work, errands, now)],
      requests: [...requests],
      gateq,
      recent: [...recentEvents(own, report, now)],
      unread: [...unread].sort(),
      readAt: now.toISOString(),
    };
    // The contract is the boundary: a malformed read never reaches Q.
    return QAccountDigestSchema.parse(digest);
  };
}

/** Diligence requests open in their relationships, either way. */
async function openRequests(
  relationships: RelationshipIntelligencePort | undefined,
  actor: ActorContext,
  own: OwnRelationships | null,
): Promise<readonly AccountDigestRequest[]> {
  const diligence = relationships?.diligence;
  if (diligence === undefined || own === null) return [];
  const inDiligence = own.items
    .filter((item) => item.state === "IN_DILIGENCE")
    .slice(0, ACCOUNT_DIGEST_REQUESTS_MAX);
  const areas = await Promise.all(
    inDiligence.map(
      async (item) =>
        [item, await diligence(actor, item.relationshipId)] as const,
    ),
  );
  return areas.flatMap(([item, area]): AccountDigestRequest[] => {
    if (area === null) return [];
    if (area.openRequests.length === 0 && area.answeredRequests.length === 0) {
      return [];
    }
    return [
      {
        relationshipId: item.relationshipId,
        counterpart: clip(item.counterpart.name, 120) || "Unnamed",
        // Investors ask, companies answer (the diligence area's own rule).
        direction: own.side === "INVESTOR" ? "FROM_YOU" : "TO_YOU",
        open: area.openRequests.slice(0, 3).map((text) => clip(text, 160)),
        openCount: Math.min(area.openRequests.length, 500),
        answeredCount: Math.min(area.answeredRequests.length, 500),
      },
    ];
  });
}

async function readGateq(
  port: AccountDigestGateqPort | undefined,
  actor: ActorContext,
  section: <T>(
    name: AccountDigestSection,
    read: () => Promise<T>,
    fallback: T,
  ) => Promise<T>,
): Promise<AccountDigestGateq | null> {
  if (port === undefined) return null;
  const founder = port.founderApplications;
  const investor = port.investorInbox;
  const [applications, inbox] = await Promise.all([
    founder === undefined
      ? Promise.resolve(null)
      : section("GATEQ", () => founder(actor), null),
    investor === undefined
      ? Promise.resolve(null)
      : section("GATEQ", () => investor(actor), null),
  ]);
  if (
    inbox === null &&
    (applications === null || applications.applications.length === 0)
  ) {
    return null;
  }
  return {
    applications: (applications?.applications ?? []).slice(
      0,
      ACCOUNT_DIGEST_APPLICATIONS_MAX,
    ),
    applicationsTotal: applications?.total ?? 0,
    inbox,
  };
}
