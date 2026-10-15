import type { ActorContext } from "@capital-q/security";

import type {
  BriefDiligenceRead,
  BriefMeetingRead,
  BriefThreadMessage,
  RelationshipBriefBatchSources,
  RelationshipBriefSources,
} from "./relationship-brief.js";

/**
 * The Relationship Brief's readers (R1), over the services the screens
 * use, each called as the actor so each applies its own party check.
 * Nothing here catches: a failure must reach the brief, which reports the
 * source UNAVAILABLE instead of an empty history.
 */
type DiligenceViewRead = {
  readonly side?: "INVESTOR" | "COMPANY" | undefined;
  readonly shares: readonly {
    readonly documentId: string;
    readonly title: string;
    readonly viewedAt?: string | null | undefined;
  }[];
  readonly requests: readonly {
    readonly requestId: string;
    readonly title: string;
    readonly status: "OPEN" | "FULFILLED" | "DECLINED";
  }[];
};

function diligenceRead(
  view: DiligenceViewRead | null,
): BriefDiligenceRead | null {
  if (view === null) return null;
  return {
    openRequests: view.requests
      .filter((r) => r.status === "OPEN")
      .map((r) => ({ id: r.requestId, title: r.title })),
    answeredCount: view.requests.filter((r) => r.status === "FULFILLED").length,
    sharedDocuments: view.shares.map((s) => ({
      id: s.documentId,
      title: s.title,
      // Views are tracked for the receiving (investor) side only.
      openedByYourSide:
        view.side === "INVESTOR" && s.viewedAt !== undefined
          ? s.viewedAt !== null
          : null,
    })),
  };
}

export function createRelationshipBriefSources(services: {
  readonly chat: {
    readonly readForQ: (query: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly limit?: number | undefined;
    }) => Promise<{
      readonly messages: readonly {
        readonly from: "YOU" | "YOUR_SIDE" | "OTHER_SIDE";
        readonly senderName: string;
        readonly kind: "TEXT" | "ATTACHMENT" | "VOICE_NOTE";
        readonly viaQ: boolean;
        readonly sentAt: string;
      }[];
    }>;
  };
  readonly schedule: {
    readonly listMeetings: (
      actor: ActorContext,
      relationshipId: string,
    ) => Promise<
      | readonly {
          readonly id: string;
          readonly status: "SCHEDULING" | "SCHEDULED" | "CANCELLED" | "FAILED";
          readonly startsAt: string;
          readonly endsAt: string;
          readonly organisedByYou: boolean;
        }[]
      | null
    >;
  };
  readonly diligence?:
    | {
        readonly view: (query: {
          readonly actor: ActorContext;
          readonly relationshipId: string;
        }) => Promise<{
          readonly side?: "INVESTOR" | "COMPANY" | undefined;
          readonly shares: readonly {
            readonly documentId: string;
            readonly title: string;
            readonly viewedAt?: string | null | undefined;
          }[];
          readonly requests: readonly {
            readonly requestId: string;
            readonly title: string;
            readonly status: "OPEN" | "FULFILLED" | "DECLINED";
          }[];
        } | null>;
      }
    | undefined;
}): RelationshipBriefSources {
  const { chat, schedule, diligence } = services;
  return {
    thread: async (actor, relationshipId) =>
      (await chat.readForQ({ actor, relationshipId })).messages.map((m) => ({
        from: m.from,
        senderName: m.senderName,
        kind: m.kind,
        viaQ: m.viaQ,
        sentAt: m.sentAt,
      })),
    meetings: async (actor, relationshipId) => {
      const list = await schedule.listMeetings(actor, relationshipId);
      // The brief already resolved the actor as a party; a null here is
      // the schedule disagreeing, which is a failure, not "no calls".
      if (list === null) throw new Error("meetings not readable");
      return list.map((m) => ({
        id: m.id,
        status: m.status,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        organisedByYou: m.organisedByYou,
      }));
    },
    ...(diligence === undefined
      ? {}
      : {
          diligence: async (actor, relationshipId) =>
            diligenceRead(await diligence.view({ actor, relationshipId })),
        }),
  };
}

/**
 * The batch readers (R1 batching) over the same services: one chat read
 * and one schedule read per page, each scoped in SQL to the actor's own
 * organisation. Diligence stays the service's own per-relationship read,
 * asked only for relationships that reached diligence.
 */
export function createRelationshipBriefBatchSources(services: {
  readonly chat: {
    readonly latestForRelationships: (
      actor: ActorContext,
      relationshipIds: readonly string[],
    ) => Promise<
      ReadonlyMap<
        string,
        {
          readonly latest: BriefThreadMessage | null;
          readonly fromThem: BriefThreadMessage | null;
        }
      >
    >;
  };
  readonly schedule: {
    readonly listMeetingsForRelationships: (
      actor: ActorContext,
      relationshipIds: readonly string[],
    ) => Promise<ReadonlyMap<string, readonly BriefMeetingRead[]>>;
  };
  readonly diligence?:
    | {
        readonly view: (query: {
          readonly actor: ActorContext;
          readonly relationshipId: string;
        }) => Promise<DiligenceViewRead | null>;
      }
    | undefined;
}): RelationshipBriefBatchSources {
  const { chat, schedule, diligence } = services;
  return {
    threads: (actor, ids) => chat.latestForRelationships(actor, ids),
    meetings: (actor, ids) => schedule.listMeetingsForRelationships(actor, ids),
    ...(diligence === undefined
      ? {}
      : {
          diligence: async (actor, ids) =>
            new Map(
              await Promise.all(
                ids.map(
                  async (id) =>
                    [
                      id,
                      diligenceRead(
                        await diligence.view({ actor, relationshipId: id }),
                      ),
                    ] as const,
                ),
              ),
            ),
        }),
  };
}
