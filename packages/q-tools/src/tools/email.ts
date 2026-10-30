import { z } from "zod";

import {
  EmailBodySchema,
  EmailSubjectSchema,
  UuidSchema,
  type QTaskClass,
} from "@capital-q/contracts";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
  type QToolAuthorization,
} from "../definition.js";
import type {
  EmailIntelligencePort,
  InboundEmailPort,
  RelationshipIntelligencePort,
} from "../ports.js";
import {
  agreedRelationship,
  DIFFERENT_COUNTERPARTS,
  onlyRelationship,
  refsGiven,
  SEVERAL_RELATIONSHIPS,
  TheirOnlyRelationshipSchema,
} from "./chat.js";
import { CardReasonSchema, reasonOf } from "./card-reason.js";
import { closestByName } from "./connection-requests.js";
import { admitted } from "./relationships.js";

/**
 * propose_email (BIZ-007; R9: "email the founder?" by text and by voice).
 *
 * Q drafts an email to the other side of ONE canonical relationship the
 * person is a party to, and hands it to the Approval Engine. It sends
 * nothing. The recipient is always one of the counterparty's own people:
 * an address that is not on the relationship is refused here, again when
 * the proposal is made, at approval and immediately before sending. The
 * person sees the exact draft, can edit the words (which voids the old
 * approval) and approves; the send runs from their own connected mailbox.
 *
 * Or a reply to an email that arrived at their Q address (inbound email):
 * the recipient is always that email's sender, read from the stored row,
 * never from the model. It is sent by Capital Q's own sender on their
 * behalf -- not from their mailbox, and the card says so -- with Reply-To
 * set to their Q address so the answer comes back to Q.
 */

export const PROPOSE_EMAIL = "relationship.email.propose" as const;

const PURPOSES: readonly QTaskClass[] = [
  "OWN_COMPANY_QUESTION",
  "COUNTERPARTY_COMPANY_QUESTION",
  "INVESTOR_QUESTION",
  "RELATIONSHIP_QUESTION",
  "ACTION_PREPARATION",
  "GENERAL_QUESTION",
];

export const ProposeEmailInputSchema = z
  .object({
    relationshipId: UuidSchema.optional().describe(
      "The relationship's id, when the conversation is about a relationship.",
    ),
    companyId: UuidSchema.optional().describe(
      "As an investor: the company whose people to email, as given in the conversation context.",
    ),
    investorOrganisationId: UuidSchema.optional().describe(
      "As a company: the investor organisation whose people to email.",
    ),
    inboundEmailId: UuidSchema.optional().describe(
      "To reply to an email that arrived at their Q address: its id from list_my_inbound_emails. The reply goes to that email's sender.",
    ),
    counterpartName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Or the other side's name as the person said it (from any page); Capital Q finds it among their own relationships.",
      ),
    theirOnlyRelationship: TheirOnlyRelationshipSchema,
    // Guard F-106 (2026-10-25): a name written here instead of an address
    // failed the whole email (INVALID_ARGUMENTS). Anything that is not an
    // address is no recipient named: the relationship's own contact is used.
    recipientEmail: z
      .preprocess(
        (value) =>
          typeof value === "string" && z.email().safeParse(value.trim()).success
            ? value.trim()
            : undefined,
        z.email().max(320).optional(),
      )
      .describe(
        "Only if the person named a specific person on the other side; otherwise leave it out.",
      ),
    subject: EmailSubjectSchema.describe("A short, plain subject line."),
    // Live a1db17ec (2026-10-26): the email turn's first call carried a
    // field this schema did not take (invalidCodes unrecognized_keys) and
    // cost two rounds. Every other proposal beside it takes the card's
    // "Why: …" reason; an email does too, carried to its card the same way.
    reason: CardReasonSchema,
    body: EmailBodySchema.describe(
      "The whole email, in the person's voice, signed with their name. Plain text. No claims the evidence does not support. A note to founders they are not yet connected with says why this investor is interested: their declared mandate (stage, sector, geography, cheque) against what the company does and its stage, from what you have read in this conversation. Never generic, never a claim you have not read.",
    ),
  })
  .strict()
  // Named more than once (live d3a197b4, 2026-10-26): resolved in authorize's
  // order -- a reply to an inbound email, then their name for the other
  // side, then the relationship, then a company or investor id -- each
  // found only among the reader's own or admitted relationships.
  .refine(
    (input) =>
      [
        input.relationshipId,
        input.companyId,
        input.investorOrganisationId,
        input.counterpartName,
        input.inboundEmailId,
      ].some((id) => id !== undefined) || input.theirOnlyRelationship === true,
    {
      message:
        "name the other side: counterpartName (their name as the person said it), or relationshipId, companyId or investorOrganisationId, or inboundEmailId to reply to an email",
    },
  );
export type ProposeEmailInput = z.infer<typeof ProposeEmailInputSchema>;

export const ProposeEmailOutputSchema = z
  .object({
    /**
     * PREPARED: the draft will be shown for approval; nothing was sent.
     * ONE_PER_TURN: another action is being prepared in this answer.
     * MAILBOX_NOT_CONNECTED: the person must connect Gmail in Settings first.
     * REPLY_UNAVAILABLE: Capital Q cannot send replies on this deployment.
     * NO_RECIPIENT: the relationship holds no email address for them.
     */
    status: z.enum([
      "PREPARED",
      "ONE_PER_TURN",
      "MAILBOX_NOT_CONNECTED",
      "REPLY_UNAVAILABLE",
      "NO_RECIPIENT",
    ]),
    awaitingApprovalOf: z.string(),
  })
  .strict();
export type ProposeEmailOutput = z.infer<typeof ProposeEmailOutputSchema>;

type Grant =
  | {
      readonly kind: "RELATIONSHIP";
      readonly relationshipId: string;
      readonly counterpartName: string;
      /** Null: the relationship has no email address for anyone. */
      readonly to: string | null;
      readonly toName: string;
      readonly mailbox: boolean;
    }
  | {
      readonly kind: "REPLY";
      readonly inboundEmailId: string;
      readonly to: string;
      readonly toName: string;
      /** Their Q address; null when it could not be read. */
      readonly replyTo: string | null;
    };

export function createProposeEmailTool(
  email: EmailIntelligencePort | undefined,
  relationships: RelationshipIntelligencePort | undefined,
  inbound?: InboundEmailPort,
): AnyQToolDefinition {
  return defineQTool<ProposeEmailInput, ProposeEmailOutput, Grant>({
    id: PROPOSE_EMAIL,
    version: 1,
    status: "ACTIVE",
    providerName: "propose_email",
    description:
      "Drafts an email from the person to the other side of one of their relationships (a company's founders, or an investor organisation's people) for their own approval, only when they ask for an email or agree to Q's suggestion of one; to send a note, reply or message to a relationship on Capital Q (\"send it to them\"), use propose_chat_message, its Capital Q conversation. It sends nothing: the person sees the exact email, may edit it, and approves it; it then goes from their own connected Gmail. Recipients can only be people on that relationship. Or, with inboundEmailId, a reply to an email that arrived at their Q address: it goes only to that email's sender, from Capital Q's own address on their behalf (not their mailbox), with replies coming back to their Q address.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: [
      "RELATIONSHIP_CONTEXT",
      "COMPANY_PROFILE",
      "INVESTOR_PROFILE",
      "NETWORK_VISIBLE_DATA",
    ],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "WAITING_FOR_APPROVAL",
    input: ProposeEmailInputSchema,
    output: ProposeEmailOutputSchema,
    authorize: async (input, { actor, plan }) => {
      // A reply goes to that email's sender; a relationship named beside it
      // may be someone else, so the two are never combined (#550).
      if (input.inboundEmailId !== undefined && refsGiven(input) > 0) {
        return deny("NOT_AVAILABLE", DIFFERENT_COUNTERPARTS);
      }
      if (input.inboundEmailId !== undefined) {
        // A reply: only to the sender of an email that came to THEM.
        if (inbound === undefined) return deny("NOT_AVAILABLE");
        try {
          const target = await inbound.replyTarget(actor, input.inboundEmailId);
          if (target === null) return deny("NOT_AVAILABLE");
          if (
            input.recipientEmail !== undefined &&
            input.recipientEmail.toLowerCase() !== target.to
          ) {
            return deny(
              "NOT_AVAILABLE",
              "A reply goes only to the person who sent that email.",
            );
          }
          return allow("CONFIDENTIAL", {
            kind: "REPLY" as const,
            inboundEmailId: input.inboundEmailId,
            to: target.to,
            toName: target.toName,
            replyTo: await inbound.address(actor).catch(() => null),
          });
        } catch {
          return deny("NOT_AVAILABLE");
        }
      }
      if (email === undefined) return deny("NOT_AVAILABLE");
      try {
        /**
         * The relationship's own people, as the grant: byName when it was
         * found among their own relationships (by name, or an id from that
         * list), otherwise the plan must admit its counterpart.
         */
        const prepared = async (
          relationshipId: string,
          byName: boolean,
        ): Promise<QToolAuthorization<Grant>> => {
          const counterpart = await email.counterpart(actor, relationshipId);
          if (
            counterpart === null ||
            (!byName &&
              !admitted(plan, { kind: counterpart.kind, id: counterpart.id }))
          ) {
            return deny("NOT_AVAILABLE");
          }
          const wanted = input.recipientEmail?.toLowerCase();
          const recipient =
            wanted === undefined
              ? counterpart.contacts[0]
              : counterpart.contacts.find((c) => c.email === wanted);
          if (recipient === undefined && wanted !== undefined) {
            // Never an address that is not on the relationship.
            return deny(
              "NOT_AVAILABLE",
              "I can only email people on the other side of this relationship.",
            );
          }
          // No address on the relationship at all: said as it stands
          // (NO_RECIPIENT), so the same words can go as a Capital Q message.
          return allow("CONFIDENTIAL", {
            kind: "RELATIONSHIP" as const,
            relationshipId,
            counterpartName: counterpart.name,
            to: recipient?.email ?? null,
            toName: recipient?.name ?? counterpart.name,
            mailbox: (await email.mailbox(actor)) !== null,
          });
        };
        // Named more than once: every reference must be the same one of
        // their relationships, or nothing is prepared (#550).
        if (refsGiven(input) > 1) {
          if (relationships === undefined) return deny("NOT_AVAILABLE");
          const agreed = await agreedRelationship(
            input,
            actor,
            plan,
            relationships,
          );
          if (agreed.kind === "DIFFERENT" || agreed.relationshipId === null) {
            return deny("NOT_AVAILABLE", DIFFERENT_COUNTERPARTS);
          }
          return await prepared(agreed.relationshipId, true);
        }
        // Sweep 2026-10-29: "an update email to my investors" with one
        // investor -- their one relationship, from their own list.
        if (refsGiven(input) === 0 && input.theirOnlyRelationship === true) {
          if (relationships === undefined) return deny("NOT_AVAILABLE");
          const only = await onlyRelationship(actor, relationships);
          if (only.kind === "SEVERAL") {
            return deny("NOT_AVAILABLE", SEVERAL_RELATIONSHIPS);
          }
          if (only.kind === "NONE") return deny("NOT_AVAILABLE");
          return await prepared(only.relationshipId, true);
        }
        let relationshipId = input.relationshipId;
        // A name (action parity 2026-10-02, "email Nixo" from any page):
        // one of their OWN relationships; the counterpart read below is the
        // party check, as for the page. An id from that same list is theirs
        // too (guard run 2026-10-25, run 7eebd402: "needs its existing
        // connection reference").
        const ownList =
          relationships === undefined
            ? null
            : await relationships.ownRelationships?.(actor).catch(() => null);
        const ownId =
          relationshipId !== undefined &&
          (ownList?.items ?? []).some(
            (item) => item.relationshipId === relationshipId,
          );
        const byName = input.counterpartName !== undefined || ownId;
        if (
          input.counterpartName !== undefined &&
          relationships !== undefined
        ) {
          const found = closestByName(
            ownList?.items ?? [],
            input.counterpartName ?? "",
            (item) => item.counterpart.name,
          );
          relationshipId =
            found.length === 1 ? found[0]?.relationshipId : undefined;
        } else if (
          relationshipId === undefined &&
          relationships !== undefined
        ) {
          const status =
            input.companyId !== undefined
              ? await relationships.withCompany(actor, input.companyId)
              : input.investorOrganisationId !== undefined
                ? await relationships.withInvestor(
                    actor,
                    input.investorOrganisationId,
                  )
                : null;
          relationshipId = status?.relationshipId;
        }
        if (relationshipId === undefined) return deny("NOT_AVAILABLE");
        return await prepared(relationshipId, byName);
      } catch {
        return deny("NOT_AVAILABLE");
      }
    },
    execute: (input, context, grant) => {
      if (grant.kind === "REPLY") {
        if (
          inbound === undefined ||
          !inbound.canReply ||
          grant.replyTo === null
        ) {
          return Promise.resolve({
            status: "REPLY_UNAVAILABLE" as const,
            awaitingApprovalOf:
              "Capital Q can't send replies on this deployment yet.",
          });
        }
        const status = inbound.prepareReplyForApproval({
          runId: context.runId,
          tenantId: context.actor.tenantId,
          actorUserId: context.actor.userId,
          payload: {
            inboundEmailId: grant.inboundEmailId,
            to: grant.to,
            toName: grant.toName,
            replyTo: grant.replyTo,
            subject: input.subject,
            body: input.body,
          },
        });
        return Promise.resolve({
          status,
          awaitingApprovalOf: `Reply to ${grant.toName}, sent by Capital Q on your behalf (not from your own mailbox): "${input.subject}"`,
        });
      }
      if (grant.to === null) {
        return Promise.resolve({
          status: "NO_RECIPIENT" as const,
          awaitingApprovalOf: `I don't have an email address for ${grant.counterpartName}.`,
        });
      }
      if (email === undefined || !grant.mailbox) {
        return Promise.resolve({
          status: "MAILBOX_NOT_CONNECTED" as const,
          awaitingApprovalOf:
            "Connect Gmail in Settings, then I can prepare this email for you to approve.",
        });
      }
      const status = email.prepareForApproval({
        runId: context.runId,
        tenantId: context.actor.tenantId,
        actorUserId: context.actor.userId,
        payload: {
          relationshipId: grant.relationshipId,
          to: grant.to,
          toName: grant.toName,
          counterpartName: grant.counterpartName,
          subject: input.subject,
          body: input.body,
        },
        reason: reasonOf(input),
      });
      return Promise.resolve({
        status,
        awaitingApprovalOf: `Email ${grant.toName} at ${grant.counterpartName}: "${input.subject}"`,
      });
    },
  });
}
