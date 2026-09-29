import { z } from "zod";

import {
  ChatMessageBodySchema,
  QActionTypeSchema,
  UuidSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import {
  ChatAttachmentUnavailableError,
  ChatBlockedError,
  ChatNotConnectedError,
  ChatNotFoundError,
  type ChatService,
} from "@capital-q/communication";
import type { Logger } from "@capital-q/observability";
import {
  defineQAction,
  type AnyQActionDefinition,
  type QActionProposer,
} from "@capital-q/q-actions";
import {
  CHAT_MESSAGE_SEND as CHAT_MESSAGE_SEND_NAME,
  ERRAND_START as ERRAND_START_NAME,
  MEETING_CANCEL as MEETING_CANCEL_NAME,
  MEETING_RESCHEDULE as MEETING_RESCHEDULE_NAME,
  MEETING_SCHEDULE as MEETING_SCHEDULE_NAME,
  REMINDER_CREATE as REMINDER_CREATE_NAME,
  type ChatIntelligencePort,
  type ChatProposal,
} from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

import {
  MeetingCancelPayloadSchema,
  MeetingReschedulePayloadSchema,
  MeetingSchedulePayloadSchema,
  ReminderCreatePayloadSchema,
} from "./schedule-actions.js";
import { ErrandStartPayloadSchema } from "./errands.js";

/**
 * Relationship chat actions (R34; ADR 0019), all Prepare → Approve.
 *
 *   chat.message.send  a message (optionally sharing one of the approver's
 *                      own scanned documents) posted as the approver, once
 *                      per execution identity
 *
 * Reminders and meetings (BIZ-008) live in ./schedule-actions.ts; they
 * share this run board.
 *
 * `authorize` runs at proposal, at approval and before execution: the
 * approver must be a person and still a party to the relationship (and,
 * for a message or a meeting, the relationship must be connected). Q gains
 * nothing because it drafted the words.
 */

export const CHAT_MESSAGE_SEND = QActionTypeSchema.parse(
  CHAT_MESSAGE_SEND_NAME,
);

const CounterpartNameSchema = z.string().trim().min(1).max(200);

export const ChatMessageSendPayloadSchema = z
  .object({
    relationshipId: UuidSchema,
    counterpartName: CounterpartNameSchema,
    body: ChatMessageBodySchema,
    documentId: UuidSchema.optional(),
  })
  .strict();
export type ChatMessageSendPayload = z.infer<
  typeof ChatMessageSendPayloadSchema
>;

const MessageResultSchema = z
  .object({ messageId: UuidSchema, alreadySent: z.boolean() })
  .strict();

type Party = { readonly connected: boolean; readonly blocked: boolean } | null;

async function partyOf(
  chat: ChatService,
  actor: ActorContext,
  relationshipId: string,
): Promise<Party> {
  if (actor.actorType !== "HUMAN") return null;
  return chat
    .readForQ({ actor, relationshipId, limit: 1 })
    .then((read) => ({ connected: read.connected, blocked: read.blocked }))
    .catch(() => null);
}

export function createChatMessageSendAction(dependencies: {
  readonly chat: ChatService;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  const { chat, logger } = dependencies;
  return defineQAction<
    ChatMessageSendPayload,
    z.infer<typeof MessageResultSchema>
  >({
    actionType: CHAT_MESSAGE_SEND,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Posts one chat message, exactly as approved, as the approver on a connected relationship's thread; optionally shares one of their own scanned documents.",
    payload: ChatMessageSendPayloadSchema,
    result: MessageResultSchema,
    targets: (payload): readonly QSubjectRef[] => [
      { kind: "RELATIONSHIP", relationshipId: payload.relationshipId },
    ],
    describe: (payload) => ({
      summary: `Message ${payload.counterpartName}`,
      preview:
        payload.documentId === undefined
          ? payload.body
          : `${payload.body}\n\n(shares one of your documents)`,
    }),
    confirm: (payload, result) =>
      result.alreadySent
        ? `That message to ${payload.counterpartName} was already sent; nothing was posted twice.`
        : `Sent to ${payload.counterpartName}.`,
    authorize: async (payload, actor) => {
      const party = await partyOf(chat, actor, payload.relationshipId);
      if (party === null) return { outcome: "DENY", code: "NOT_A_PARTY" };
      if (!party.connected) return { outcome: "DENY", code: "NOT_CONNECTED" };
      // A block stops approved messages too (R34 safety).
      if (party.blocked) return { outcome: "DENY", code: "BLOCKED" };
      return { outcome: "ALLOW" };
    },
    executor: {
      execute: async (action, context) => {
        try {
          const sent = await chat.send({
            actor: context.approver,
            relationshipId: action.payload.relationshipId,
            request:
              action.payload.documentId === undefined
                ? { kind: "TEXT", body: action.payload.body }
                : {
                    kind: "ATTACHMENT",
                    documentId: action.payload.documentId,
                    body: action.payload.body,
                  },
            idempotencyKey: `q-action:${action.idempotencyKey}`,
            qActionId: action.actionId,
          });
          return {
            outcome: "EXECUTED",
            result: {
              messageId: sent.message.messageId,
              alreadySent: sent.deduplicated,
            },
          };
        } catch (error) {
          if (error instanceof ChatNotFoundError) {
            return {
              outcome: "FAILED",
              failureCode: "NOT_A_PARTY",
              retryable: false,
            };
          }
          if (error instanceof ChatNotConnectedError) {
            return {
              outcome: "FAILED",
              failureCode: "NOT_CONNECTED",
              retryable: false,
            };
          }
          if (error instanceof ChatBlockedError) {
            return {
              outcome: "FAILED",
              failureCode: "BLOCKED",
              retryable: false,
            };
          }
          if (error instanceof ChatAttachmentUnavailableError) {
            return {
              outcome: "FAILED",
              failureCode: "ATTACHMENT_UNAVAILABLE",
              retryable: false,
            };
          }
          // The send is idempotent per execution identity: a retry cannot
          // post twice, so an unexpected failure is safe to retry.
          logger?.warn(
            { actionId: action.actionId, attempt: context.attempt },
            "approved chat message failed",
          );
          return {
            outcome: "FAILED",
            failureCode: "SEND_FAILED",
            retryable: true,
          };
        }
      },
    },
  });
}

const READING_TTL_MS = 10 * 60 * 1000;
function schemaFor(proposal: ChatProposal): z.ZodType {
  switch (proposal.actionType) {
    case CHAT_MESSAGE_SEND_NAME:
      return ChatMessageSendPayloadSchema;
    case REMINDER_CREATE_NAME:
      return ReminderCreatePayloadSchema;
    case MEETING_SCHEDULE_NAME:
      return MeetingSchedulePayloadSchema;
    case MEETING_RESCHEDULE_NAME:
      return MeetingReschedulePayloadSchema;
    case MEETING_CANCEL_NAME:
      return MeetingCancelPayloadSchema;
    case ERRAND_START_NAME:
      return ErrandStartPayloadSchema;
  }
}

/** One chat proposal per run, waiting for the run's prepare step. */
export function createChatActionBoard(
  options: { readonly now?: (() => number) | undefined } = {},
): {
  readonly prepareForApproval: ChatIntelligencePort["prepareForApproval"];
  readonly proposer: QActionProposer;
} {
  const now = options.now ?? (() => Date.now());
  const prepared = new Map<
    string,
    {
      tenantId: string;
      actorUserId: string;
      proposal: ChatProposal;
      at: number;
    }
  >();
  return {
    prepareForApproval: (entry) => {
      const cutoff = now() - READING_TTL_MS;
      for (const [runId, value] of prepared) {
        if (value.at < cutoff) prepared.delete(runId);
      }
      const existing = prepared.get(entry.runId);
      if (existing !== undefined) {
        return JSON.stringify(existing.proposal) ===
          JSON.stringify(entry.proposal)
          ? "PREPARED"
          : "ONE_PER_TURN";
      }
      prepared.set(entry.runId, {
        tenantId: entry.tenantId,
        actorUserId: entry.actorUserId,
        proposal: entry.proposal,
        at: now(),
      });
      return "PREPARED";
    },
    proposer: {
      propose: (context) => {
        const entry = prepared.get(context.runId);
        if (entry === undefined) return Promise.resolve(null);
        prepared.delete(context.runId);
        if (
          entry.tenantId !== context.actor.tenantId ||
          entry.actorUserId !== context.actor.userId
        ) {
          return Promise.resolve(null);
        }
        const actionType = QActionTypeSchema.parse(entry.proposal.actionType);
        const parsed = schemaFor(entry.proposal).safeParse(
          entry.proposal.payload,
        );
        return Promise.resolve(
          parsed.success
            ? { actionType, payload: parsed.data }
            : { refused: "that isn't something I can prepare from here" },
        );
      },
    },
  };
}

/** What Q's chat tools read and prepare through. */
export function createChatIntelligencePort(dependencies: {
  readonly chat: ChatService;
  readonly counterpartName: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<string | null>;
  readonly board: ReturnType<typeof createChatActionBoard>;
}): ChatIntelligencePort {
  return {
    thread: async (actor, relationshipId) => {
      const read = await dependencies.chat
        .readForQ({ actor, relationshipId })
        .catch(() => null);
      if (read === null) return null;
      return {
        connected: read.connected,
        blocked: read.blocked,
        counterpartName:
          (await dependencies.counterpartName(actor, relationshipId)) ??
          "the other side",
        messages: read.messages,
      };
    },
    prepareForApproval: dependencies.board.prepareForApproval,
  };
}
