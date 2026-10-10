import { CompanyIdSchema } from "@capital-q/companies";
import {
  RelationshipBriefSchema,
  UtcTimestampSchema,
  type RelationshipBrief,
  type RelationshipBriefDecision,
  type RelationshipBriefMeeting,
  type RelationshipBriefMessage,
} from "@capital-q/contracts";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import type { ActorContext } from "@capital-q/security";

import { RelationshipIdSchema } from "../contracts/index.js";
import {
  MeetingActivityPayloadSchema,
  RELATIONSHIP_EVENT_MEETING_NO_SHOW,
  RELATIONSHIP_EVENT_MESSAGE_SENT,
} from "../domain/event-registry.js";
import {
  visibleToParty,
  type ProjectableEvent,
} from "../domain/state-projector.js";
import type { ExpressInterestDependencies } from "./express-interest.js";
import { readHistory } from "./relationship-projection.js";
import {
  createListRelationshipsForCompany,
  createListRelationshipsForInvestor,
  createRelationshipById,
  type RelationshipStatus,
} from "./relationship-status.js";

/**
 * The Relationship Brief (R1): one read of "where do we stand with X" for
 * the asking party, assembled here because the Network context owns the
 * relationship, its party resolution and its disclosure rule.
 *
 * Order matters for privacy. The party is resolved first, by the same
 * use case the screens call (`relationshipById`: the side comes from the
 * actor's own membership, a non-party gets null). Only then are the other
 * contexts' readers called, each as the actor, so every one of them
 * re-applies its own authorization. History is folded only over the
 * events that side may see, so an investor's private discovery or a
 * founder's private note never shapes the other side's brief.
 *
 * A reader that throws, or is not composed, yields UNAVAILABLE -- never
 * an empty list. TensorGate (2026-10-09) is why: a failed thread read was
 * reported to the person as "no message has been sent".
 */

/** One message as the thread reader returns it, for the asking actor. */
export type BriefThreadMessage = {
  readonly from: "YOU" | "YOUR_SIDE" | "OTHER_SIDE";
  readonly senderName: string;
  readonly kind: "TEXT" | "ATTACHMENT" | "VOICE_NOTE";
  readonly viaQ: boolean;
  readonly sentAt: string;
  /** The message as it stands now, bounded; absent: not read. */
  readonly preview?: string | null | undefined;
};

export type BriefMeetingRead = {
  readonly id: string;
  readonly status: "SCHEDULING" | "SCHEDULED" | "CANCELLED" | "FAILED";
  readonly startsAt: string;
  readonly endsAt: string;
  readonly organisedByYou: boolean;
};

export type BriefDiligenceRead = {
  readonly openRequests: readonly {
    readonly id: string;
    readonly title: string;
  }[];
  readonly answeredCount: number;
  readonly sharedDocuments: readonly {
    readonly id: string;
    readonly title: string;
    /** Investor side: opened by anyone on this side. Absent: not tracked. */
    readonly openedByYourSide?: boolean | null | undefined;
  }[];
};

/**
 * Readers owned by other contexts, composed by the app. Each is called as
 * the actor and must enforce its own party check; each throws when it
 * cannot answer. An empty result means "none", so a reader must never
 * swallow its own failure into one.
 */
export type RelationshipBriefSources = {
  readonly thread?:
    | ((
        actor: ActorContext,
        relationshipId: string,
      ) => Promise<readonly BriefThreadMessage[]>)
    | undefined;
  readonly meetings?:
    | ((
        actor: ActorContext,
        relationshipId: string,
      ) => Promise<readonly BriefMeetingRead[]>)
    | undefined;
  /** Null: no diligence area on the relationship (nothing outstanding). */
  readonly diligence?:
    | ((
        actor: ActorContext,
        relationshipId: string,
      ) => Promise<BriefDiligenceRead | null>)
    | undefined;
};

/** A thread's newest message, and the other side's newest, for one relationship. */
export type BriefThreadSummary = {
  readonly latest: BriefThreadMessage | null;
  readonly fromThem: BriefThreadMessage | null;
};

/**
 * The batch readers (R1 batching): one call each for a page of the
 * viewer's relationships, never a read per relationship. They are called
 * only with relationship ids the viewer's own list already returned, as
 * the actor, and must still scope by the actor themselves. A relationship
 * missing from the returned map was not read: it is UNAVAILABLE, never
 * "none" -- a reader states "none" with an entry (null latest, []).
 */
export type RelationshipBriefBatchSources = {
  readonly threads?:
    | ((
        actor: ActorContext,
        relationshipIds: readonly string[],
      ) => Promise<ReadonlyMap<string, BriefThreadSummary>>)
    | undefined;
  readonly meetings?:
    | ((
        actor: ActorContext,
        relationshipIds: readonly string[],
      ) => Promise<ReadonlyMap<string, readonly BriefMeetingRead[]>>)
    | undefined;
  /** Called only for relationships that reached diligence. */
  readonly diligence?:
    | ((
        actor: ActorContext,
        relationshipIds: readonly string[],
      ) => Promise<ReadonlyMap<string, BriefDiligenceRead | null>>)
    | undefined;
};

type Read<T> =
  | ({ readonly status: "OK" } & T)
  | {
      readonly status: "UNAVAILABLE";
      readonly reason: "READ_FAILED" | "NOT_COMPOSED";
    };

async function read<T, R>(
  call: (() => Promise<T>) | undefined,
  shape: (value: T) => R,
): Promise<Read<R>> {
  if (call === undefined) {
    return { status: "UNAVAILABLE", reason: "NOT_COMPOSED" };
  }
  try {
    return { status: "OK", ...shape(await call()) };
  } catch {
    return { status: "UNAVAILABLE", reason: "READ_FAILED" };
  }
}

function newest<T extends { readonly sentAt: string }>(
  items: readonly T[],
): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (best === null || Date.parse(item.sentAt) > Date.parse(best.sentAt)) {
      best = item;
    }
  }
  return best;
}

function toMessage(message: BriefThreadMessage): RelationshipBriefMessage {
  return {
    from: message.from,
    senderName: message.senderName.slice(0, 200),
    kind: message.kind,
    delivery: "SENT",
    viaQ: message.viaQ,
    sentAt: UtcTimestampSchema.parse(new Date(message.sentAt).toISOString()),
    preview:
      message.preview === undefined || message.preview === null
        ? null
        : message.preview.slice(0, 240),
  };
}

function toMeeting(
  meeting: BriefMeetingRead,
  now: number,
  noShows: ReadonlySet<string>,
): RelationshipBriefMeeting {
  return {
    id: meeting.id,
    status: meeting.status,
    startsAt: UtcTimestampSchema.parse(
      new Date(meeting.startsAt).toISOString(),
    ),
    endsAt: UtcTimestampSchema.parse(new Date(meeting.endsAt).toISOString()),
    timing: Date.parse(meeting.endsAt) > now ? "UPCOMING" : "PAST",
    organisedByYou: meeting.organisedByYou,
    noShow: noShows.has(meeting.id),
  };
}

/** The calls the history records as not having taken place, newest first. */
function noShowsOf(
  visible: readonly ProjectableEvent[],
): RelationshipBrief["noShows"] {
  const out: RelationshipBrief["noShows"][number][] = [];
  for (const event of visible) {
    if (event.eventType !== RELATIONSHIP_EVENT_MEETING_NO_SHOW) continue;
    const payload = MeetingActivityPayloadSchema.safeParse(event.payload);
    if (!payload.success) continue;
    out.push({
      meetingId: payload.data.meetingId,
      at: UtcTimestampSchema.parse(new Date(event.occurredAt).toISOString()),
    });
  }
  return out.toSorted((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
}

/**
 * Whose move it is, by code. A decision that depends on an UNAVAILABLE
 * source is left out and the list is marked incomplete, rather than
 * guessed.
 */
export function deriveBriefDecisions(
  brief: Pick<RelationshipBrief, "state" | "messages" | "meetings">,
): RelationshipBrief["pendingDecisions"] {
  const items: RelationshipBriefDecision[] = [];
  let complete = true;
  const state = brief.state;
  if (state === null) return { items, complete };

  const latest = brief.messages.latest;
  if (latest.status === "OK") {
    if (latest.message?.from === "OTHER_SIDE") {
      items.push({
        kind: "REPLY_TO_MESSAGE",
        owner: "YOU",
        since: latest.message.sentAt,
      });
    }
  } else {
    complete = false;
  }

  const meetings = brief.meetings;
  const next = meetings.status === "OK" ? meetings.nextScheduled : null;
  if (next !== null) {
    items.push({ kind: "ATTEND_MEETING", owner: "YOU", since: next.startsAt });
  }

  switch (state.nextStep) {
    case "NONE":
      break;
    case "AWAIT_ANSWER":
      items.push({
        kind: "AWAIT_ANSWER",
        owner: "THEM",
        since: state.stateSince,
      });
      break;
    case "SCHEDULE_MEETING":
      // The projector moves only on a meeting held; a call already booked
      // (or booked and past, not yet recorded as held) is not "schedule one".
      if (meetings.status !== "OK") {
        complete = false;
      } else if (
        !meetings.items.some(
          (m) =>
            (m.status === "SCHEDULED" || m.status === "SCHEDULING") &&
            m.noShow !== true,
        )
      ) {
        items.push({
          kind: "SCHEDULE_MEETING",
          owner: "YOU",
          since: state.stateSince,
        });
      }
      break;
    default:
      items.push({
        kind: state.nextStep,
        owner: "YOU",
        since: state.stateSince,
      });
  }
  return { items, complete };
}

type PartyView = {
  readonly side: "INVESTOR" | "COMPANY";
  readonly counterpart: {
    readonly kind: "COMPANY" | "INVESTOR_ORGANISATION";
    readonly id: string;
  };
  readonly status: RelationshipStatus;
};

/**
 * One brief from what was read. Pure: the party view (already authorized),
 * the history that side may see, and each source as read or not.
 */
function assembleBrief(input: {
  readonly view: PartyView;
  readonly visible: readonly ProjectableEvent[];
  readonly name: string | null;
  readonly latest: Read<{
    readonly message: RelationshipBriefMessage | null;
    readonly fromThem: RelationshipBriefMessage | null;
  }>;
  readonly meetings: Read<{ readonly list: readonly BriefMeetingRead[] }>;
  readonly diligence: Read<{ readonly area: BriefDiligenceRead | null }>;
  readonly now: number;
}): RelationshipBrief {
  const { view, visible, now, diligence } = input;
  const status = view.status;
  const messageCount = visible.filter(
    (event) => event.eventType === RELATIONSHIP_EVENT_MESSAGE_SENT,
  ).length;
  const historySequence = visible.reduce(
    (max, event) => Math.max(max, event.sequence),
    0,
  );
  const noShows = noShowsOf(visible);
  const noShowIds = new Set(noShows.map((n) => n.meetingId));
  const meetings: RelationshipBrief["meetings"] =
    input.meetings.status === "OK"
      ? (() => {
          const items = input.meetings.list
            .slice(0, 50)
            .map((m) => toMeeting(m, now, noShowIds))
            .toSorted(
              (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
            );
          return {
            status: "OK" as const,
            items,
            nextScheduled:
              items.find(
                (m) => m.status === "SCHEDULED" && m.timing === "UPCOMING",
              ) ?? null,
          };
        })()
      : input.meetings;
  const state = {
    state: status.projection.state,
    stateSince: UtcTimestampSchema.parse(status.projection.stateSince),
    milestones: status.projection.milestones.slice(0, 64).map((m) => ({
      state: m.state,
      at: UtcTimestampSchema.parse(m.at),
    })),
    nextStep: status.nextStep,
  };
  const messages = { count: messageCount, latest: input.latest };
  const area = diligence.status === "OK" ? diligence.area : null;
  const brief: RelationshipBrief = {
    relationshipId: status.relationship.id,
    yourSide: view.side,
    counterparty: {
      kind: view.counterpart.kind,
      id: view.counterpart.id,
      name: input.name === null ? null : input.name.slice(0, 200),
    },
    generatedAt: UtcTimestampSchema.parse(new Date(now).toISOString()),
    state,
    messages,
    noShows,
    meetings,
    pendingDecisions: deriveBriefDecisions({ state, messages, meetings }),
    obligations:
      diligence.status === "OK"
        ? {
            status: "OK",
            openRequests: (area?.openRequests ?? [])
              .slice(0, 50)
              .map((r) => ({ id: r.id, title: r.title.slice(0, 200) })),
            answeredCount: area?.answeredCount ?? 0,
          }
        : diligence,
    documents:
      diligence.status === "OK"
        ? {
            status: "OK",
            items: (area?.sharedDocuments ?? []).slice(0, 50).map((d) => ({
              id: d.id,
              title: d.title.slice(0, 300),
              openedByYourSide: d.openedByYourSide ?? null,
            })),
          }
        : diligence,
    sourceVersions: {
      projector: status.projection.version,
      historySequence,
      brief: "relationship-brief.v1",
    },
  };
  // The contract is the boundary: a reader returning a malformed shape
  // fails here, loudly, rather than reaching Q or a screen.
  return RelationshipBriefSchema.parse(brief);
}

function threadRead(thread: BriefThreadSummary) {
  return {
    message: thread.latest === null ? null : toMessage(thread.latest),
    fromThem: thread.fromThem === null ? null : toMessage(thread.fromThem),
  };
}

export function createRelationshipBrief(
  dependencies: ExpressInterestDependencies,
) {
  const byId = createRelationshipById(dependencies);
  return async (query: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
    readonly sources: RelationshipBriefSources;
    readonly now?: Date | undefined;
  }): Promise<RelationshipBrief | null> => {
    const { actor, sources } = query;
    const id = RelationshipIdSchema.safeParse(query.relationshipId);
    if (!id.success) return null;
    // Authorization first: the side from the actor's own membership.
    const view = await byId({ actor, relationshipId: id.data });
    if (view === null || view.status === null) return null;
    const relationshipId = id.data;
    const now = (query.now ?? new Date()).getTime();

    const visible =
      view.status.visibleHistory ??
      visibleToParty(
        await readHistory(dependencies, relationshipId),
        view.side,
      );

    const name = await (async () => {
      try {
        if (view.counterpart.kind === "COMPANY") {
          return (
            (
              await dependencies.companies.findCanonicalCompany(
                CompanyIdSchema.parse(view.counterpart.id),
              )
            )?.canonicalName ?? null
          );
        }
        return (
          (
            await dependencies.investors.findCanonicalInvestorOrganisation(
              InvestorOrganisationIdSchema.parse(view.counterpart.id),
            )
          )?.displayName ?? null
        );
      } catch {
        return null;
      }
    })();

    const bound = <T>(
      reader:
        | ((actor: ActorContext, relationshipId: string) => Promise<T>)
        | undefined,
    ) =>
      reader === undefined ? undefined : () => reader(actor, relationshipId);
    const [latest, meetings, diligence] = await Promise.all([
      read(bound(sources.thread), (thread) =>
        threadRead({
          latest: newest(thread),
          fromThem: newest(thread.filter((m) => m.from === "OTHER_SIDE")),
        }),
      ),
      read(bound(sources.meetings), (list) => ({ list })),
      read(bound(sources.diligence), (area) => ({ area })),
    ]);
    return assembleBrief({
      view: {
        side: view.side,
        counterpart: view.counterpart,
        status: view.status,
      },
      visible,
      name,
      latest,
      meetings,
      diligence,
      now,
    });
  };
}

/** Reads one batch reader; a failure or a missing entry is UNAVAILABLE. */
async function readBatch<V>(
  reader:
    | ((
        actor: ActorContext,
        relationshipIds: readonly string[],
      ) => Promise<ReadonlyMap<string, V>>)
    | undefined,
  actor: ActorContext,
  relationshipIds: readonly string[],
): Promise<ReadonlyMap<string, V> | "NOT_COMPOSED" | "READ_FAILED"> {
  if (reader === undefined) return "NOT_COMPOSED";
  if (relationshipIds.length === 0) return new Map();
  try {
    return await reader(actor, relationshipIds);
  } catch {
    return "READ_FAILED";
  }
}

function entry<V, R>(
  batch: ReadonlyMap<string, V> | "NOT_COMPOSED" | "READ_FAILED",
  relationshipId: string,
  shape: (value: V) => R,
): Read<R> {
  if (batch === "NOT_COMPOSED" || batch === "READ_FAILED") {
    return { status: "UNAVAILABLE", reason: batch };
  }
  if (!batch.has(relationshipId)) {
    return { status: "UNAVAILABLE", reason: "READ_FAILED" };
  }
  return { status: "OK", ...shape(batch.get(relationshipId) as V) };
}

/** At most this many briefs per call: one page of the list. */
export const RELATIONSHIP_BRIEFS_PAGE = 50;

/**
 * Every brief this viewer may read, for one page of their own list (R1
 * batching). Authorization and the per-side fold are the list use cases'
 * own; the thread, the calls and diligence are each one batched read for
 * the page. A requested id that is not on the viewer's own list is simply
 * not answered.
 */
export function createRelationshipBriefs(
  dependencies: ExpressInterestDependencies,
) {
  const forInvestor = createListRelationshipsForInvestor(dependencies);
  const forCompany = createListRelationshipsForCompany(dependencies);
  return async (query: {
    readonly actor: ActorContext;
    /** A founder's own company; absent: the actor's investor organisation. */
    readonly companyId?: string | undefined;
    readonly relationshipIds?: readonly string[] | undefined;
    readonly sources: RelationshipBriefBatchSources;
    readonly now?: Date | undefined;
  }): Promise<readonly RelationshipBrief[]> => {
    const { actor, sources } = query;
    const side = query.companyId === undefined ? "INVESTOR" : "COMPANY";
    const listings =
      query.companyId === undefined
        ? await forInvestor({ actor })
        : await forCompany({ actor, companyId: query.companyId });
    const wanted =
      query.relationshipIds === undefined
        ? null
        : new Set(query.relationshipIds);
    const page = listings
      .filter((l) => wanted === null || wanted.has(l.relationship.id))
      .slice(0, RELATIONSHIP_BRIEFS_PAGE);
    if (page.length === 0) return [];
    const now = (query.now ?? new Date()).getTime();
    const ids = page.map((l) => l.relationship.id);
    // Diligence is read only where the history reached it; before that
    // there is no area, which the projector's own milestones say.
    const inDiligence = new Set(
      page
        .filter((l) =>
          l.projection.milestones.some((m) => m.state === "IN_DILIGENCE"),
        )
        .map((l) => l.relationship.id),
    );
    const [threads, meetings, diligence] = await Promise.all([
      readBatch(sources.threads, actor, ids),
      readBatch(sources.meetings, actor, ids),
      readBatch(sources.diligence, actor, [...inDiligence]),
    ]);
    return Promise.all(
      page.map(async (listing) => {
        const id = listing.relationship.id;
        const visible =
          listing.visibleHistory ??
          visibleToParty(
            await readHistory(dependencies, listing.relationship.id),
            side,
          );
        return assembleBrief({
          view: {
            side,
            counterpart:
              side === "INVESTOR"
                ? { kind: "COMPANY", id: listing.relationship.companyId }
                : {
                    kind: "INVESTOR_ORGANISATION",
                    id: listing.relationship.investorOrganisationId,
                  },
            status: listing,
          },
          visible,
          name: listing.counterpartName,
          latest: entry(threads, id, threadRead),
          meetings: entry(meetings, id, (list) => ({ list })),
          diligence: inDiligence.has(id)
            ? entry(diligence, id, (area) => ({ area }))
            : { status: "OK", area: null },
          now,
        });
      }),
    );
  };
}
