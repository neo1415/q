import { randomUUID } from "node:crypto";

import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import type { OpenConversation, WorkforcePorts } from "./jobs.js";
import type { Owner } from "./store.js";

/**
 * The app's own services for the workforce's agents (founder brief J1,
 * J4, J9), as the person who approved the job. Every call runs as that
 * person through the same authorized service a screen or a Q tool uses;
 * the agents never get a wider path. An owner that is not the approver is
 * refused: a job runs only for whoever approved it.
 *
 * Booking needs a connected calendar: without one the scheduler finds no
 * times and books nothing, and the person is told on the job.
 */

export type WorkforcePortServices = {
  readonly feed: (
    actor: ActorContext,
    limit: number,
  ) => Promise<
    readonly { readonly companyId: string; readonly name: string }[] | null
  >;
  readonly expressInterest: (input: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly surface: "Q_CONVERSATION";
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }) => Promise<unknown>;
  readonly relationships: (actor: ActorContext) => Promise<
    readonly {
      readonly relationshipId: string;
      readonly name: string;
    }[]
  >;
  readonly readChat: (input: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
    readonly limit: number;
  }) => Promise<{
    readonly blocked: boolean;
    readonly messages: readonly {
      readonly id: string;
      readonly from: "YOU" | "YOUR_SIDE" | "OTHER_SIDE";
      readonly senderName: string;
      readonly text: string | null;
    }[];
  }>;
  readonly sendChat: (input: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
    readonly body: string;
    readonly idempotencyKey: string;
  }) => Promise<unknown>;
  /** The writer's first draft of a reply (null: nothing honest to say). */
  readonly writeReply: (input: {
    readonly actor: ActorContext;
    readonly principalName: string;
    readonly counterpartName: string;
    readonly thread: string;
    readonly callComing: boolean;
    readonly correlationId: string | undefined;
  }) => Promise<string | null>;
  readonly findSlots: (input: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
    readonly from: Date;
    readonly to: Date;
    readonly durationMinutes: number;
  }) => Promise<readonly Date[]>;
  readonly book: (input: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
    readonly startsAt: Date;
    readonly durationMinutes: number;
    readonly purpose: string;
    readonly idempotencyKey: string;
  }) => Promise<string | null>;
  readonly nameOf: (userId: string) => Promise<string | null>;
  readonly now?: (() => Date) | undefined;
};

const CALL_MINUTES = 30;
const LEAD_MS = 24 * 3_600_000;
const HORIZON_MS = 10 * 24 * 3_600_000;
const MAX_RELATIONSHIPS = 25;

/** The person's own Q notice on their Work page. */
export function workforceNotifier(sql: DatabaseExecutor) {
  return async (
    owner: Owner,
    notice: {
      readonly key: string;
      readonly title: string;
      readonly body: string;
    },
  ): Promise<void> => {
    await sql`
      insert into communication.notifications
        (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
      values (${owner.tenantId}, ${owner.userId}, 'Q_WORK',
              ${notice.title.slice(0, 200)}, ${notice.body.slice(0, 1000)}, '/work',
              ${notice.key.slice(0, 200)}, 'NEEDS_YOU')
      on conflict (user_id, dedupe_key) do nothing`;
  };
}

export function createWorkforcePorts(
  services: WorkforcePortServices,
  notify: WorkforcePorts["notify"],
) {
  const now = services.now ?? (() => new Date());
  /** The ports for one job, as the person who approved it. */
  return (actor: ActorContext): WorkforcePorts => {
    const mine = (owner: Owner) =>
      owner.userId === actor.userId && owner.tenantId === actor.tenantId;
    const conversations = new Map<string, OpenConversation>();

    return {
      principalName: async () =>
        (await services.nameOf(actor.userId).catch(() => null)) ?? "the person",

      mandateMatches: async (owner) => {
        if (!mine(owner)) return [];
        // The person's own feed is their mandate, ranked by fit (ADR 0019).
        const items = (await services.feed(actor, 25).catch(() => null)) ?? [];
        return items.map((item) => ({
          companyId: item.companyId,
          name: item.name,
        }));
      },

      expressInterest: async (owner, companyId, idempotencyKey) => {
        if (!mine(owner)) return { ok: false };
        await services.expressInterest({
          actor,
          companyId,
          surface: "Q_CONVERSATION",
          idempotencyKey: idempotencyKey.slice(0, 200),
          correlationId: `cor_${randomUUID()}`,
        });
        return { ok: true };
      },

      openConversations: async (owner) => {
        if (!mine(owner)) return [];
        const own = (await services.relationships(actor).catch(() => [])).slice(
          0,
          MAX_RELATIONSHIPS,
        );
        const open: OpenConversation[] = [];
        for (const one of own) {
          const read = await services
            .readChat({ actor, relationshipId: one.relationshipId, limit: 12 })
            .catch(() => null);
          if (read === null || read.blocked) continue;
          const last = read.messages.at(-1);
          const thread = read.messages
            .map((message) => `${message.senderName}: ${message.text ?? ""}`)
            .join("\n");
          const conversation: OpenConversation = {
            relationshipId: one.relationshipId,
            counterpartName: one.name,
            thread,
            latest:
              last !== undefined &&
              last.from === "OTHER_SIDE" &&
              last.text !== null &&
              last.text.trim().length > 0
                ? { id: last.id, text: last.text }
                : null,
            // Only what both sides already said is stated as fact.
            material: "",
          };
          conversations.set(one.relationshipId, conversation);
          if (conversation.latest !== null) open.push(conversation);
        }
        return open;
      },

      writeReply: async (owner, conversation, intent, correlationId) => {
        if (!mine(owner)) return null;
        return services.writeReply({
          actor,
          principalName:
            (await services.nameOf(actor.userId).catch(() => null)) ??
            "the person",
          counterpartName: conversation.counterpartName,
          thread: conversation.thread.slice(-4_000),
          callComing: intent === "PROPOSE_TIMES",
          correlationId,
        });
      },

      send: async (owner, relationshipId, idempotencyKey, body) => {
        if (!mine(owner)) return false;
        await services.sendChat({
          actor,
          relationshipId,
          body: body.slice(0, 4_000),
          idempotencyKey: idempotencyKey.slice(0, 200),
        });
        return true;
      },

      freeSlots: async (owner, relationshipId) => {
        if (!mine(owner)) return [];
        const current = now().getTime();
        const slots = await services
          .findSlots({
            actor,
            relationshipId,
            from: new Date(current + LEAD_MS),
            to: new Date(current + HORIZON_MS),
            durationMinutes: CALL_MINUTES,
          })
          .catch(() => []);
        return slots.slice(0, 3).map((slot) => slot.toISOString());
      },

      book: async (owner, relationshipId, idempotencyKey, startsAt) => {
        if (!mine(owner)) return { ok: false, meetingId: null };
        const at = new Date(startsAt);
        if (Number.isNaN(at.getTime()) || at.getTime() < now().getTime()) {
          return { ok: false, meetingId: null };
        }
        const meetingId = await services.book({
          actor,
          relationshipId,
          startsAt: at,
          durationMinutes: CALL_MINUTES,
          purpose: `Call with ${conversations.get(relationshipId)?.counterpartName ?? "them"}`,
          idempotencyKey: idempotencyKey.slice(0, 200),
        });
        return { ok: meetingId !== null, meetingId };
      },

      notify: (owner, notice) =>
        mine(owner) ? notify(owner, notice) : Promise.resolve(),
    };
  };
}
