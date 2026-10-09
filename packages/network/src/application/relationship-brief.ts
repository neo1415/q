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
import { RELATIONSHIP_EVENT_MESSAGE_SENT } from "../domain/event-registry.js";
import { visibleToParty } from "../domain/state-projector.js";
import type { ExpressInterestDependencies } from "./express-interest.js";
import { readHistory } from "./relationship-projection.js";
import { createRelationshipById } from "./relationship-status.js";

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
  };
}

function toMeeting(
  meeting: BriefMeetingRead,
  now: number,
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
  };
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
          (m) => m.status === "SCHEDULED" || m.status === "SCHEDULING",
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

    const visible = visibleToParty(
      await readHistory(dependencies, relationshipId),
      view.side,
    );
    const messageCount = visible.filter(
      (event) => event.eventType === RELATIONSHIP_EVENT_MESSAGE_SENT,
    ).length;
    const historySequence = visible.reduce(
      (max, event) => Math.max(max, event.sequence),
      0,
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
      read(bound(sources.thread), (thread) => {
        const message = newest(thread);
        const fromThem = newest(thread.filter((m) => m.from === "OTHER_SIDE"));
        return {
          message: message === null ? null : toMessage(message),
          fromThem: fromThem === null ? null : toMessage(fromThem),
        };
      }),
      read(bound(sources.meetings), (list) => {
        const items = list
          .slice(0, 50)
          .map((m) => toMeeting(m, now))
          .toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
        return {
          items,
          nextScheduled:
            items.find(
              (m) => m.status === "SCHEDULED" && m.timing === "UPCOMING",
            ) ?? null,
        };
      }),
      read(bound(sources.diligence), (area) => ({ area })),
    ]);

    const state = {
      state: view.status.projection.state,
      stateSince: UtcTimestampSchema.parse(view.status.projection.stateSince),
      milestones: view.status.projection.milestones.slice(0, 64).map((m) => ({
        state: m.state,
        at: UtcTimestampSchema.parse(m.at),
      })),
      nextStep: view.status.nextStep,
    };
    const messages = { count: messageCount, latest };
    const area = diligence.status === "OK" ? diligence.area : null;
    const brief: RelationshipBrief = {
      relationshipId,
      yourSide: view.side,
      counterparty: {
        kind: view.counterpart.kind,
        id: view.counterpart.id,
        name: name === null ? null : name.slice(0, 200),
      },
      generatedAt: UtcTimestampSchema.parse(new Date(now).toISOString()),
      state,
      messages,
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
              items: (area?.sharedDocuments ?? [])
                .slice(0, 50)
                .map((d) => ({ id: d.id, title: d.title.slice(0, 300) })),
            }
          : diligence,
      sourceVersions: {
        projector: view.status.projection.version,
        historySequence,
        brief: "relationship-brief.v1",
      },
    };
    // The contract is the boundary: a reader returning a malformed shape
    // fails here, loudly, rather than reaching Q or a screen.
    return RelationshipBriefSchema.parse(brief);
  };
}
