import { z } from "zod";

import {
  Q_TASK_CLASSES,
  QAttentionReportSchema,
  type PermittedContextPlan,
  type QActivitySummary,
  type QAttentionItem,
  type QAttentionReport,
  type QAttentionSource,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type {
  ApprovalInboxPort,
  OwnRelationship,
  RelationshipIntelligencePort,
} from "../ports.js";
import type { QWorkIntelligencePort } from "./q-work.js";
import type { ScheduleIntelligencePort } from "./schedule.js";

/**
 * RECOVERY-2026-10 B1: "what needs me", read from every source the
 * person's own surfaces read, in one place (live T3, 2026-10-08: Q said
 * "nothing is waiting" while an investor's message had waited 21 hours,
 * because each surface read a different subset and a failed read looked
 * like an empty one).
 *
 * The rule this file exists for: a source that could not be read is
 * reported in `unread`, never as empty. A source with no reader composed
 * is unread too -- Capital Q does not know, so it does not say "nothing".
 * Every read is the person's own, as the actor, through the same services
 * their pages use; nothing here takes a user id from input.
 */

export const READ_ATTENTION = "attention.read" as const;
export const READ_ATTENTION_PROVIDER_NAME = "what_needs_me" as const;
/** The route lives in contracts (approved by the lead); kept here as a re-export. */
export { Q_ATTENTION_PATH } from "@capital-q/contracts";

/** Each source gets this long; a slower one is reported unread. */
export const ATTENTION_SOURCE_DEADLINE_MS = 2_500;
/** Items kept per source, so no source can crowd another out of the 50. */
export const ATTENTION_ITEMS_PER_SOURCE = 8;
const REPORT_ITEMS_MAX = 50;

/** The order a person hears them in: someone waiting on them first. */
const SOURCE_ORDER: readonly QAttentionSource[] = [
  "UNANSWERED_MESSAGE",
  "APPROVAL",
  "INTEREST_REQUEST",
  "MEETING",
  "DOCUMENT_REQUEST",
  "AGENT_BLOCKED",
  "HELD_DRAFT",
  "REMINDER",
  "NOTICE",
  "NEW_MATCHES",
];

export type AttentionReadContext = {
  readonly now: Date;
  /** Their last visit, for NEW_MATCHES and the activity summary. */
  readonly since: Date;
};

/** One source's reader: its items, or a throw when it could not be read. */
export type AttentionSourceReader = (
  actor: ActorContext,
  context: AttentionReadContext,
) => Promise<readonly QAttentionItem[]>;

export type AttentionSources = Partial<
  Record<QAttentionSource, readonly AttentionSourceReader[]>
>;

/**
 * The reads no tool port already holds (held drafts, workforce jobs,
 * notices, slate deltas, data-room requests, what Q did), composed by the
 * app over its own stores. Absent members leave their source unread.
 */
export type AttentionPort = {
  /** Absent or partial: the missing sources are reported unread. */
  readonly sources?: AttentionSources | undefined;
  readonly activity?:
    | ((
        actor: ActorContext,
        context: AttentionReadContext,
      ) => Promise<QActivitySummary>)
    | undefined;
};

export type AttentionReader = (
  actor: ActorContext,
  options?: { readonly now?: Date; readonly since?: Date | null },
) => Promise<QAttentionReport>;

const DAY_MS = 24 * 3_600_000;
const UUID = z.string().uuid();

class AttentionDeadline extends Error {}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AttentionDeadline()), ms);
  });
  return Promise.race([work, late]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

const iso = (value: string | Date): string | null => {
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/**
 * Reads every source side by side and folds them into one report. A
 * source's readers are all required: if any one of them fails, the source
 * is unread (a partial read is not a complete one), while the items the
 * others returned are still listed.
 */
export async function readAttention(
  port: AttentionPort,
  actor: ActorContext,
  options: {
    readonly now?: Date | undefined;
    readonly since?: Date | null | undefined;
    readonly deadlineMs?: number | undefined;
  } = {},
): Promise<QAttentionReport> {
  const now = options.now ?? new Date();
  const since = options.since ?? new Date(now.getTime() - DAY_MS);
  const deadline = options.deadlineMs ?? ATTENTION_SOURCE_DEADLINE_MS;
  const context: AttentionReadContext = { now, since };

  const results = await Promise.all(
    SOURCE_ORDER.map(async (source) => {
      const readers = port.sources?.[source] ?? [];
      if (readers.length === 0) {
        return { source, items: [] as QAttentionItem[], read: false };
      }
      const settled = await Promise.allSettled(
        readers.map((reader) => withDeadline(reader(actor, context), deadline)),
      );
      const items: QAttentionItem[] = [];
      let read = true;
      for (const one of settled) {
        if (one.status === "rejected") read = false;
        else items.push(...one.value);
      }
      return { source, items, read };
    }),
  );

  const activity =
    port.activity === undefined
      ? null
      : await withDeadline(port.activity(actor, context), deadline).catch(
          () => null,
        );

  const unread: QAttentionSource[] = [];
  const items: QAttentionItem[] = [];
  const seen = new Set<string>();
  for (const { source, items: found, read } of results) {
    if (!read) unread.push(source);
    const fresh = found
      .filter((item) => item.source === source && !seen.has(item.key))
      .sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
    for (const item of fresh.slice(0, ATTENTION_ITEMS_PER_SOURCE)) {
      seen.add(item.key);
      items.push(item);
    }
    // More than a source's share: the last one says how many more, so a
    // cap never reads as "that's all".
    const more = fresh.length - ATTENTION_ITEMS_PER_SOURCE;
    if (more > 0) {
      const last = items[items.length - 1];
      if (last !== undefined) {
        items[items.length - 1] = {
          ...last,
          detail: clip(
            `${last.detail === undefined ? "" : `${last.detail} `}(and ${String(more)} more like this)`,
            600,
          ),
        };
      }
    }
  }

  return QAttentionReportSchema.parse({
    items: items.slice(0, REPORT_ITEMS_MAX),
    activity,
    unread,
    readAt: now.toISOString(),
  });
}

// --- sources from the ports the tools already hold ------------------------

type AttentionToolPorts = {
  readonly relationships?: RelationshipIntelligencePort | undefined;
  readonly approvalInbox?: ApprovalInboxPort | undefined;
  readonly schedule?: ScheduleIntelligencePort | undefined;
  readonly work?: QWorkIntelligencePort | undefined;
  readonly attention?: AttentionPort | undefined;
};

/** How many of their relationships' diligence areas are read per report. */
const DILIGENCE_READS_MAX = 6;
const MEETING_HORIZON_MS = 36 * 3_600_000;

function relationshipEntity(item: OwnRelationship) {
  return { kind: "RELATIONSHIP" as const, id: item.relationshipId };
}

/**
 * One read per report, shared by every source it feeds (the relationship
 * list feeds four): keyed by the report's own read context, so nothing is
 * cached across reports, and one failure marks all of them unread.
 */
function oncePerReport<T>(
  read: (actor: ActorContext) => Promise<T>,
): (actor: ActorContext, context: AttentionReadContext) => Promise<T> {
  const reads = new WeakMap<AttentionReadContext, Promise<T>>();
  return (actor, context) => {
    const known = reads.get(context);
    if (known !== undefined) return known;
    const fresh = read(actor);
    reads.set(context, fresh);
    return fresh;
  };
}

/**
 * Every source that the tool ports can answer, read as the actor through
 * the same services the tools call; the app's own `attention` port adds
 * the rest. A port that is not composed contributes no reader, so its
 * source stays unread.
 */
export function attentionSourcesFromPorts(
  ports: AttentionToolPorts,
): AttentionPort {
  const sources: Record<QAttentionSource, AttentionSourceReader[]> = {
    UNANSWERED_MESSAGE: [],
    APPROVAL: [],
    HELD_DRAFT: [],
    AGENT_BLOCKED: [],
    DOCUMENT_REQUEST: [],
    INTEREST_REQUEST: [],
    MEETING: [],
    REMINDER: [],
    NEW_MATCHES: [],
    NOTICE: [],
  };

  const relationships = ports.relationships;
  const ownRelationships = relationships?.ownRelationships;
  if (relationships !== undefined && ownRelationships !== undefined) {
    const own = oncePerReport(
      async (actor): Promise<readonly OwnRelationship[]> =>
        (await ownRelationships(actor))?.items ?? [],
    );
    sources.UNANSWERED_MESSAGE.push(async (actor, context) => {
      const items = await own(actor, context);
      return items.flatMap((item): QAttentionItem[] => {
        const last = item.lastMessage;
        if (last === undefined || last === null || last.from !== "THEM") {
          return [];
        }
        const since = iso(last.at);
        if (since === null) return [];
        return [
          {
            key: `msg:${item.relationshipId}:${since}`,
            source: "UNANSWERED_MESSAGE",
            title: clip(
              `${item.counterpart.name} is waiting for your reply`,
              200,
            ),
            detail: clip(`They wrote: "${last.preview}"`, 600),
            entity: relationshipEntity(item),
            counterpart: clip(item.counterpart.name, 120),
            since,
            decidable: true,
          },
        ];
      });
    });
    sources.INTEREST_REQUEST.push(async (actor, context) => {
      const items = await own(actor, context);
      return items.flatMap((item): QAttentionItem[] => {
        if (item.nextStep !== "ANSWER_INTEREST") return [];
        const since = iso(item.stateSince);
        if (since === null) return [];
        return [
          {
            key: `interest:${item.relationshipId}`,
            source: "INTEREST_REQUEST",
            title: clip(
              `${item.counterpart.name} wants to connect and is waiting for your answer`,
              200,
            ),
            entity: relationshipEntity(item),
            counterpart: clip(item.counterpart.name, 120),
            since,
            decidable: true,
          },
        ];
      });
    });
    sources.MEETING.push(async (actor, context) => {
      const items = await own(actor, context);
      return items.flatMap((item): QAttentionItem[] => {
        if (item.nextStep !== "SCHEDULE_MEETING") return [];
        const since = iso(item.stateSince);
        if (since === null) return [];
        return [
          {
            key: `schedule:${item.relationshipId}`,
            source: "MEETING",
            title: clip(
              `You're connected with ${item.counterpart.name}; a call is not booked yet`,
              200,
            ),
            entity: relationshipEntity(item),
            counterpart: clip(item.counterpart.name, 120),
            since,
            decidable: false,
          },
        ];
      });
    });
    const diligence = relationships.diligence;
    if (diligence !== undefined) {
      sources.DOCUMENT_REQUEST.push(async (actor, context) => {
        const items = await own(actor, context);
        // Requests addressed to them: only a company answers diligence
        // requests; an investor's own open requests wait on the company.
        const inDiligence = items
          .filter((item) => item.state === "IN_DILIGENCE")
          .filter((item) => item.counterpart.kind === "INVESTOR_ORGANISATION")
          .slice(0, DILIGENCE_READS_MAX);
        const areas = await Promise.all(
          inDiligence.map(
            async (item) =>
              [item, await diligence(actor, item.relationshipId)] as const,
          ),
        );
        return areas.flatMap(([item, area]): QAttentionItem[] => {
          if (area === null || area.openRequests.length === 0) return [];
          const since = iso(item.stateSince);
          if (since === null) return [];
          const asked = area.openRequests.slice(0, 3).join("; ");
          return [
            {
              key: `diligence:${item.relationshipId}`,
              source: "DOCUMENT_REQUEST",
              title: clip(
                `${item.counterpart.name} asked for ${String(area.openRequests.length)} diligence item${area.openRequests.length === 1 ? "" : "s"}`,
                200,
              ),
              detail: clip(`Open: ${asked}`, 600),
              entity: relationshipEntity(item),
              counterpart: clip(item.counterpart.name, 120),
              since,
              decidable: false,
            },
          ];
        });
      });
    }
  }

  const inbox = ports.approvalInbox;
  if (inbox !== undefined) {
    sources.APPROVAL.push(async (actor) => {
      const pending = await inbox.pending(actor);
      return pending.flatMap((item): QAttentionItem[] => {
        const since = iso(item.requestedAt);
        if (since === null) return [];
        return [
          {
            key: `approval:${item.approvalId}`,
            source: "APPROVAL",
            title: clip(item.summary, 200),
            ...(item.summary.length > 200
              ? { detail: clip(item.summary, 600) }
              : {}),
            ...(UUID.safeParse(item.approvalId).success
              ? { entity: { kind: "APPROVAL" as const, id: item.approvalId } }
              : {}),
            since,
            decidable: true,
          },
        ];
      });
    });
  }

  const schedule = ports.schedule;
  if (schedule !== undefined) {
    const read = oncePerReport((actor) => schedule.upcoming(actor));
    sources.MEETING.push(async (actor, context) => {
      const { now } = context;
      const { meetings } = await read(actor, context);
      const until = now.getTime() + MEETING_HORIZON_MS;
      return meetings.flatMap((meeting): QAttentionItem[] => {
        const startsAt = Date.parse(meeting.startsAt);
        if (Number.isNaN(startsAt)) return [];
        if (startsAt < now.getTime() - 10 * 60_000 || startsAt > until) {
          return [];
        }
        const who = meeting.attendees.slice(0, 3).join(", ");
        return [
          {
            key: `meeting:${meeting.id}`,
            source: "MEETING",
            title: clip(
              `${meeting.purpose || "Call"}${who.length > 0 ? ` with ${who}` : ""}`,
              200,
            ),
            detail: clip(
              `Starts ${new Date(startsAt).toISOString()}${meeting.hasBrief ? "; a brief is ready" : ""}`,
              600,
            ),
            ...(UUID.safeParse(meeting.id).success
              ? { entity: { kind: "MEETING" as const, id: meeting.id } }
              : {}),
            since: new Date(startsAt).toISOString(),
            decidable: false,
          },
        ];
      });
    });
    sources.REMINDER.push(async (actor, context) => {
      const { now } = context;
      const { reminders } = await read(actor, context);
      // Due by the end of their day (UTC when their zone is unknown here;
      // the answer says the time as given).
      const endOfDay = now.getTime() + DAY_MS;
      return reminders.flatMap((reminder): QAttentionItem[] => {
        const due = Date.parse(reminder.dueAt);
        if (Number.isNaN(due) || due > endOfDay) return [];
        return [
          {
            key: `reminder:${reminder.id}`,
            source: "REMINDER",
            title: clip(reminder.title, 200),
            detail: `Due ${new Date(due).toISOString()}`,
            since: new Date(due).toISOString(),
            decidable: true,
          },
        ];
      });
    });
  }

  const work = ports.work;
  if (work !== undefined) {
    const read = oncePerReport((actor) => work.list(actor));
    sources.MEETING.push(async (actor, context) => {
      const items = await read(actor, context);
      return items.flatMap((job) =>
        job.lanes
          .filter((lane) => lane.stage === "NEEDS_TIMES")
          .map((lane): QAttentionItem => ({
            key: `times:${lane.id}`,
            source: "MEETING",
            title: clip(
              `Pick a time for a call with ${lane.counterpartName}`,
              200,
            ),
            ...(lane.offered.length > 0
              ? {
                  detail: clip(
                    `Q offered: ${lane.offered.map((slot) => slot.label).join(", ")}`,
                    600,
                  ),
                }
              : {}),
            entity: { kind: "JOB", id: job.id },
            counterpart: clip(lane.counterpartName, 120),
            since: job.lastStep?.at ?? job.createdAt,
            decidable: true,
          })),
      );
    });
    sources.AGENT_BLOCKED.push(async (actor, context) => {
      const items = await read(actor, context);
      return items.flatMap((job): QAttentionItem[] => {
        const stalled =
          job.status === "FAILED" ||
          (job.run?.state === "PAUSED" &&
            job.run.pauseReason !== null &&
            job.run.pauseReason !== "PAUSED_BY_YOU");
        if (!stalled) return [];
        const goal = job.goal ?? job.summary ?? "Q's work";
        return [
          {
            key: `work:${job.id}:${job.status}`,
            source: "AGENT_BLOCKED",
            title: clip(
              job.status === "FAILED"
                ? `Q's work stopped: ${goal}`
                : `Q's work is paused and needs you: ${goal}`,
              200,
            ),
            ...(job.run?.pauseReason == null
              ? {}
              : { detail: `Reason: ${job.run.pauseReason}` }),
            entity: { kind: "JOB", id: job.id },
            since: job.lastStep?.at ?? job.createdAt,
            decidable: true,
          },
        ];
      });
    });
  }

  const extra = ports.attention;
  for (const source of SOURCE_ORDER) {
    sources[source].push(...(extra?.sources?.[source] ?? []));
  }
  return {
    sources,
    ...(extra?.activity === undefined ? {} : { activity: extra.activity }),
  };
}

/** The one reader the tool and the HTTP route both use. */
export function createAttentionReader(
  ports: AttentionToolPorts,
): AttentionReader {
  const port = attentionSourcesFromPorts(ports);
  return (actor, options = {}) =>
    readAttention(port, actor, {
      now: options.now,
      since: options.since ?? null,
    });
}

// --- the tool ---------------------------------------------------------------

export const ReadAttentionInputSchema = z
  .object({
    since: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe(
        "Only for what Q did: since when (their last visit). Omit for the last day.",
      ),
  })
  .strict();
export type ReadAttentionInput = z.infer<typeof ReadAttentionInputSchema>;

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

export function createReadAttentionTool(
  reader: AttentionReader,
): AnyQToolDefinition {
  return defineQTool<ReadAttentionInput, QAttentionReport, null>({
    id: READ_ATTENTION,
    version: 1,
    status: "ACTIVE",
    // Always on: "anything need me?" can come mid-anything.
    core: true,
    providerName: READ_ATTENTION_PROVIDER_NAME,
    description:
      "Lists everything waiting on the person across Capital Q, from every source: messages where the other side wrote last, approvals (including agents' drafts), held drafts, stopped agents, document and diligence requests, interest and connection requests, calls and times to pick, reminders due, notices, and for an investor new matches; plus what Q did since a moment. Call it when they ask what needs them, what is waiting, what they missed or what is new. Mention every item. `unread` lists sources that could not be checked: say so, and never say nothing is waiting while any source is unread.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [...Q_TASK_CLASSES],
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: null,
    input: ReadAttentionInputSchema,
    output: QAttentionReportSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      ),
    execute: (input, context) =>
      reader(context.actor, {
        ...(input.since === undefined ? {} : { since: new Date(input.since) }),
      }),
  });
}
