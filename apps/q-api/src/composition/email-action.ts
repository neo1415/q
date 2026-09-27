import { z } from "zod";

import {
  EmailAddressSchema,
  EmailBodySchema,
  EmailSubjectSchema,
  QActionTypeSchema,
  UuidSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import type {
  CounterpartDirectory,
  IntegrationsService,
} from "@capital-q/integrations";
import type { InterestService } from "@capital-q/network";
import type { Logger } from "@capital-q/observability";
import {
  defineQAction,
  type AnyQActionDefinition,
  type QActionProposer,
} from "@capital-q/q-actions";
import type { EmailIntelligencePort } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

/**
 * `email.send` (BIZ-007; R9): an email from the approver's own connected
 * Gmail to a person on the other side of one canonical relationship.
 *
 *   Prepare   propose_email drafts it onto this run's board
 *   Recommend the Approval Engine persists the exact payload and hash
 *   Approve   the person approves those exact words; an edit is a
 *             revision (`revisable`: words only), which voids the old
 *             approval and binds the new payload
 *   Execute   the integrations context sends once per execution identity
 *             and records `outreach_sent` on the relationship
 *
 * `authorize` runs at proposal, at approval and immediately before the
 * send: the approver must still be a party to the relationship, the
 * recipient must still be one of the counterparty's own people, and the
 * mailbox must still be connected. Q gains nothing because it drafted it.
 */

export const EMAIL_SEND = QActionTypeSchema.parse("email.send");

export const EmailSendPayloadSchema = z
  .object({
    relationshipId: UuidSchema,
    to: EmailAddressSchema,
    toName: z.string().trim().min(1).max(200),
    counterpartName: z.string().trim().min(1).max(200),
    subject: EmailSubjectSchema,
    body: EmailBodySchema,
  })
  .strict();
export type EmailSendPayload = z.infer<typeof EmailSendPayloadSchema>;

export const EmailSendResultSchema = z
  .object({ emailMessageId: UuidSchema, alreadySent: z.boolean() })
  .strict();
export type EmailSendResult = z.infer<typeof EmailSendResultSchema>;

export type RelationshipCounterparts = {
  /** The actor's counterparty on one relationship, or null if not a party. */
  readonly of: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<{
    readonly kind: "COMPANY" | "INVESTOR_ORGANISATION";
    readonly id: string;
    readonly name: string;
    readonly contacts: readonly {
      readonly name: string;
      readonly email: string;
    }[];
  } | null>;
};

/** Party check through the Network context as the actor; people from the directory. */
export function createRelationshipCounterparts(dependencies: {
  readonly interests: InterestService;
  readonly directory: CounterpartDirectory;
  readonly nameOf: (
    kind: "COMPANY" | "INVESTOR_ORGANISATION",
    id: string,
  ) => Promise<string | null>;
}): RelationshipCounterparts {
  return {
    of: async (actor, relationshipId) => {
      const parsed = UuidSchema.safeParse(relationshipId);
      if (!parsed.success) return null;
      const view = await dependencies.interests
        .relationshipById({ actor, relationshipId: parsed.data })
        .catch(() => null);
      if (view === null) return null;
      const contacts = await dependencies.directory.contacts({
        relationshipId: parsed.data,
        counterpart: view.counterpart.kind,
      });
      return {
        kind: view.counterpart.kind,
        id: view.counterpart.id,
        name:
          (await dependencies.nameOf(
            view.counterpart.kind,
            view.counterpart.id,
          )) ?? "the other side",
        contacts,
      };
    },
  };
}

export function createEmailSendAction(dependencies: {
  readonly integrations: IntegrationsService;
  readonly counterparts: RelationshipCounterparts;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  const { integrations, counterparts, logger } = dependencies;
  return defineQAction<EmailSendPayload, EmailSendResult>({
    actionType: EMAIL_SEND,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Sends one email, exactly as approved, from the approver's own connected Gmail to a person on the other side of one relationship, and records it on the relationship.",
    payload: EmailSendPayloadSchema,
    result: EmailSendResultSchema,
    targets: (payload): readonly QSubjectRef[] => [
      { kind: "RELATIONSHIP", relationshipId: payload.relationshipId },
    ],
    describe: (payload) => ({
      summary: `Email ${payload.toName} at ${payload.counterpartName}`,
      preview: `To: ${payload.toName} <${payload.to}>\nSubject: ${payload.subject}\n\n${payload.body}`,
    }),
    confirm: (payload, result) =>
      result.alreadySent
        ? `That email to ${payload.toName} had already gone; nothing was sent twice.`
        : `Sent. Your email to ${payload.toName} is on its way, and I'll tell you when they reply.`,
    // Only the words may change; the recipient and relationship never do.
    revisable: (previous, next) =>
      previous.relationshipId === next.relationshipId &&
      previous.to === next.to &&
      previous.toName === next.toName &&
      previous.counterpartName === next.counterpartName,
    authorize: async (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return { outcome: "DENY", code: "NOT_A_PERSON" };
      }
      const counterpart = await counterparts.of(actor, payload.relationshipId);
      if (counterpart === null) {
        return { outcome: "DENY", code: "NOT_A_PARTY" };
      }
      if (
        !counterpart.contacts.some((c) => c.email === payload.to.toLowerCase())
      ) {
        return { outcome: "DENY", code: "RECIPIENT_NOT_ON_RELATIONSHIP" };
      }
      if ((await integrations.mailboxOf(actor.userId)) === null) {
        return { outcome: "DENY", code: "MAILBOX_NOT_CONNECTED" };
      }
      return { outcome: "ALLOW" };
    },
    executor: {
      execute: async (action, context) => {
        try {
          const sent = await integrations.sendApprovedEmail({
            tenantId: context.approver.tenantId,
            approverUserId: context.approver.userId,
            relationshipId: action.payload.relationshipId,
            qActionId: action.actionId,
            idempotencyKey: `q-action:${action.idempotencyKey}`,
            to: action.payload.to,
            toName: action.payload.toName,
            subject: action.payload.subject,
            body: action.payload.body,
            correlationId: context.correlationId,
          });
          switch (sent.outcome) {
            case "SENT":
              return {
                outcome: "EXECUTED",
                result: {
                  emailMessageId: sent.emailMessageId,
                  alreadySent: sent.alreadySent,
                },
              };
            case "NOT_CONNECTED":
              return {
                outcome: "FAILED",
                failureCode: "MAILBOX_NOT_CONNECTED",
                retryable: false,
              };
            case "FAILED":
              return {
                outcome: "FAILED",
                failureCode: sent.code,
                retryable: sent.retryable,
              };
            case "UNKNOWN":
              return { outcome: "UNKNOWN", failureCode: sent.code };
          }
        } catch {
          // No detail: whatever failed may have touched a provider.
          logger?.warn(
            { actionId: action.actionId, attempt: context.attempt },
            "approved email outcome unknown",
          );
          return { outcome: "UNKNOWN", failureCode: "SEND_IN_DOUBT" };
        }
      },
    },
  });
}

const READING_TTL_MS = 10 * 60 * 1000;

/** One drafted email per run, waiting for the run's prepare step. */
export function createEmailActionBoard(
  options: { readonly now?: (() => number) | undefined } = {},
): {
  readonly prepareForApproval: EmailIntelligencePort["prepareForApproval"];
  readonly proposer: QActionProposer;
} {
  const now = options.now ?? (() => Date.now());
  const prepared = new Map<
    string,
    {
      tenantId: string;
      actorUserId: string;
      payload: EmailSendPayload;
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
        const parsed = EmailSendPayloadSchema.safeParse(entry.payload);
        return Promise.resolve(
          parsed.success
            ? { actionType: EMAIL_SEND, payload: parsed.data }
            : { refused: "that email isn't something I can prepare from here" },
        );
      },
    },
  };
}

export function createEmailIntelligencePort(dependencies: {
  readonly counterparts: RelationshipCounterparts;
  readonly integrations: IntegrationsService;
  readonly board: ReturnType<typeof createEmailActionBoard>;
}): EmailIntelligencePort {
  return {
    counterpart: (actor, relationshipId) =>
      dependencies.counterparts.of(actor, relationshipId),
    mailbox: (actor) => dependencies.integrations.mailboxOf(actor.userId),
    prepareForApproval: dependencies.board.prepareForApproval,
  };
}
