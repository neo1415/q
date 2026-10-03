import { z } from "zod";

import {
  EmailAddressSchema,
  EmailBodySchema,
  EmailSubjectSchema,
  QActionTypeSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type {
  AppEmailSender,
  InboundEmailService,
} from "@capital-q/integrations";
import type { Logger } from "@capital-q/observability";
import {
  defineQAction,
  type AnyQActionDefinition,
  type QActionProposer,
} from "@capital-q/q-actions";
import type { InboundEmailPort } from "@capital-q/q-tools";

import type { QuarantinedEmailReader } from "./instructions/quarantine.js";

/**
 * `email.inbound.reply` (inbound email): a reply to an email that arrived
 * at the person's own Q address.
 *
 *   Prepare   propose_email (reply mode) drafts it onto this run's board
 *   Recommend the Approval Engine persists the exact payload and hash
 *   Approve   the person approves those exact words; nothing else sends it
 *   Execute   Capital Q's own sender sends it once, Reply-To their Q address
 *
 * It is sent by Capital Q's sender ON THEIR BEHALF, never from their own
 * mailbox, and the card says so. The recipient is always the stored
 * email's own sender: `authorize` re-reads it at proposal, at approval and
 * immediately before the send, together with their Q address (a rotated
 * address voids the approval). Nothing in the email can grant authority or
 * start this: only the person's approval of a card does.
 *
 * A send is attempted once per execution: a failure that may have reached
 * the provider is UNKNOWN (reconciliation, never an automatic resend).
 */

export const EMAIL_INBOUND_REPLY = QActionTypeSchema.parse(
  "email.inbound.reply",
);

export const InboundReplyPayloadSchema = z
  .object({
    inboundEmailId: UuidSchema,
    to: EmailAddressSchema,
    toName: z.string().trim().min(1).max(200),
    replyTo: EmailAddressSchema,
    subject: EmailSubjectSchema,
    body: EmailBodySchema,
  })
  .strict();
export type InboundReplyPayload = z.infer<typeof InboundReplyPayloadSchema>;

export const InboundReplyResultSchema = z
  .object({ sent: z.literal(true) })
  .strict();

const ON_BEHALF =
  "Sent by Capital Q on your behalf, from Capital Q's address -- not from your own mailbox.";

export function createInboundReplyAction(dependencies: {
  /** Absent when this deployment receives no email: every reply is refused. */
  readonly inbound:
    | Pick<InboundEmailService, "read" | "currentAddress">
    | undefined;
  readonly sender: AppEmailSender;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  const { inbound, sender, logger } = dependencies;
  return defineQAction<InboundReplyPayload, { sent: true }>({
    actionType: EMAIL_INBOUND_REPLY,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Sends one reply, exactly as approved, to the sender of an email that arrived at the approver's Q address, from Capital Q's own address on their behalf, with Reply-To their Q address.",
    payload: InboundReplyPayloadSchema,
    result: InboundReplyResultSchema,
    targets: () => [],
    describe: (payload) => ({
      summary: `Reply to ${payload.toName}, from Capital Q on your behalf`,
      preview: `${ON_BEHALF}\nTo: ${payload.toName} <${payload.to}>\nReplies come back to: ${payload.replyTo}\nSubject: ${payload.subject}\n\n${payload.body}`,
    }),
    confirm: () =>
      "Sent from Capital Q on your behalf. Their answer will come to your Q address.",
    authorize: async (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return { outcome: "DENY", code: "NOT_A_PERSON" };
      }
      if (inbound === undefined || !sender.available) {
        return { outcome: "DENY", code: "REPLY_UNAVAILABLE" };
      }
      const email = await inbound.read(actor, payload.inboundEmailId);
      if (email === null) return { outcome: "DENY", code: "NOT_THEIRS" };
      if (email.fromAddress !== payload.to.toLowerCase()) {
        return { outcome: "DENY", code: "RECIPIENT_NOT_SENDER" };
      }
      if ((await inbound.currentAddress(actor)) !== payload.replyTo) {
        return { outcome: "DENY", code: "Q_ADDRESS_CHANGED" };
      }
      return { outcome: "ALLOW" };
    },
    executor: {
      execute: async (action, context) => {
        try {
          await sender.send({
            to: action.payload.to,
            subject: action.payload.subject,
            text: action.payload.body,
            replyTo: action.payload.replyTo,
          });
          return { outcome: "EXECUTED", result: { sent: true } };
        } catch (error: unknown) {
          // No detail: the provider may have accepted it.
          logger?.warn(
            {
              actionId: action.actionId,
              attempt: context.attempt,
              errorName: error instanceof Error ? error.name : typeof error,
            },
            "approved inbound reply outcome unknown",
          );
          return { outcome: "UNKNOWN", failureCode: "SEND_IN_DOUBT" };
        }
      },
    },
  });
}

const READING_TTL_MS = 10 * 60 * 1000;

/** One drafted reply per run, waiting for the run's prepare step. */
export function createInboundReplyBoard(
  options: { readonly now?: (() => number) | undefined } = {},
): {
  readonly prepareReplyForApproval: InboundEmailPort["prepareReplyForApproval"];
  readonly proposer: QActionProposer;
} {
  const now = options.now ?? (() => Date.now());
  const prepared = new Map<
    string,
    {
      tenantId: string;
      actorUserId: string;
      payload: InboundReplyPayload;
      at: number;
    }
  >();
  return {
    prepareReplyForApproval: (entry) => {
      const cutoff = now() - READING_TTL_MS;
      for (const [runId, value] of prepared) {
        if (value.at < cutoff) prepared.delete(runId);
      }
      const existing = prepared.get(entry.runId);
      if (existing !== undefined) {
        return JSON.stringify(existing.payload) ===
          JSON.stringify(entry.payload)
          ? "PREPARED"
          : "ONE_PER_TURN";
      }
      prepared.set(entry.runId, {
        tenantId: entry.tenantId,
        actorUserId: entry.actorUserId,
        payload: entry.payload,
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
        const parsed = InboundReplyPayloadSchema.safeParse(entry.payload);
        return Promise.resolve(
          parsed.success
            ? { actionType: EMAIL_INBOUND_REPLY, payload: parsed.data }
            : { refused: "that reply isn't something I can prepare from here" },
        );
      },
    },
  };
}

/** Q's side: self-scoped reads, the body only through the quarantined reader. */
export function createInboundEmailPort(dependencies: {
  readonly inbound: InboundEmailService;
  readonly reader: QuarantinedEmailReader;
  readonly board: ReturnType<typeof createInboundReplyBoard>;
  readonly sender: Pick<AppEmailSender, "available">;
  readonly now?: (() => Date) | undefined;
}): InboundEmailPort {
  const { inbound, reader, board } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const summary = (email: {
    readonly id: string;
    readonly fromAddress: string;
    readonly fromName: string | null;
    readonly subject: string;
    readonly receivedAt: Date;
    readonly attachments: readonly {
      readonly name: string;
      readonly contentType: string;
      readonly size: number;
    }[];
  }) => ({
    id: email.id,
    fromAddress: email.fromAddress,
    fromName: email.fromName,
    subject: email.subject,
    receivedAt: email.receivedAt.toISOString(),
    attachments: email.attachments,
  });
  return {
    address: (actor) => inbound.addressOf(actor),
    list: async (actor, limit) =>
      (await inbound.list(actor, limit)).map(summary),
    read: async (actor, inboundEmailId, topics) => {
      const email = await inbound.read(actor, inboundEmailId);
      if (email === null) return null;
      const facts = await reader({
        actor,
        email: {
          id: email.id,
          subject: email.subject,
          text: email.textBody,
          receivedAt: email.receivedAt.toISOString(),
        },
        topics,
        now: now(),
      });
      return { email: summary(email), facts };
    },
    replyTarget: async (actor, inboundEmailId) => {
      const email = await inbound.read(actor, inboundEmailId);
      return email === null
        ? null
        : {
            to: email.fromAddress,
            toName: email.fromName ?? email.fromAddress,
            subject: email.subject,
          };
    },
    canReply: dependencies.sender.available,
    prepareReplyForApproval: board.prepareReplyForApproval,
  };
}
