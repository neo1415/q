import type { ActorContext } from "@capital-q/security";

import type {
  BriefAnsweredRequest,
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
  readonly requests: readonly DiligenceRequestRead[];
};

/** A request as the diligence view gives it; the newer fields optional. */
type DiligenceRequestRead = {
  readonly requestId: string;
  readonly title: string;
  readonly status: "OPEN" | "FULFILLED" | "DECLINED";
  readonly fulfilledAt?: string | null | undefined;
  readonly fulfilledBy?: { readonly title: string | null } | null | undefined;
  readonly about?: BriefAnsweredRequest["about"] | undefined;
  readonly questions?:
    | readonly {
        readonly answer: {
          readonly answeredAt: string;
          readonly evidenceStatus: "SELF_REPORTED" | "DOCUMENT_SUPPORTED";
        } | null;
      }[]
    | null
    | undefined;
};

/**
 * Addendum 14 Nov 2026 (slice 5): a request is answered when a document
 * fulfilled it or when any question it carried has the founder's answer.
 * Each keeps its date, each answer's evidence status, and what it was
 * asked to resolve.
 */
function answeredOf(
  requests: readonly DiligenceRequestRead[],
): readonly BriefAnsweredRequest[] {
  return requests.flatMap((r) => {
    const answers = (r.questions ?? []).flatMap((q) =>
      q.answer === null
        ? []
        : [
            {
              answeredAt: q.answer.answeredAt,
              evidenceStatus: q.answer.evidenceStatus,
            },
          ],
    );
    if (r.status !== "FULFILLED" && answers.length === 0) return [];
    return [
      {
        id: r.requestId,
        title: r.title,
        document:
          r.status === "FULFILLED" ? (r.fulfilledBy?.title ?? null) : null,
        fulfilledAt: r.fulfilledAt ?? null,
        answers,
        about: r.about ?? null,
      },
    ];
  });
}

function diligenceRead(
  view: DiligenceViewRead | null,
): BriefDiligenceRead | null {
  if (view === null) return null;
  return {
    openRequests: view.requests
      .filter((r) => r.status === "OPEN")
      .map((r) => ({ id: r.requestId, title: r.title })),
    answeredCount: view.requests.filter((r) => r.status === "FULFILLED").length,
    answered: answeredOf(view.requests),
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
          readonly requests: readonly DiligenceRequestRead[];
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
