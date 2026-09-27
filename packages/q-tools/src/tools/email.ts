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
} from "../definition.js";
import type {
  EmailIntelligencePort,
  RelationshipIntelligencePort,
} from "../ports.js";
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
    recipientEmail: z
      .email()
      .max(320)
      .optional()
      .describe(
        "Only if the person named a specific person on the other side; otherwise leave it out.",
      ),
    subject: EmailSubjectSchema.describe("A short, plain subject line."),
    body: EmailBodySchema.describe(
      "The whole email, in the person's voice, signed with their name. Plain text. No claims the evidence does not support.",
    ),
  })
  .strict()
  .refine(
    (input) =>
      [
        input.relationshipId,
        input.companyId,
        input.investorOrganisationId,
      ].filter((id) => id !== undefined).length === 1,
    {
      message:
        "name exactly one of relationshipId, companyId or investorOrganisationId",
    },
  );
export type ProposeEmailInput = z.infer<typeof ProposeEmailInputSchema>;

export const ProposeEmailOutputSchema = z
  .object({
    /**
     * PREPARED: the draft will be shown for approval; nothing was sent.
     * ONE_PER_TURN: another action is being prepared in this answer.
     * MAILBOX_NOT_CONNECTED: the person must connect Gmail in Settings first.
     */
    status: z.enum(["PREPARED", "ONE_PER_TURN", "MAILBOX_NOT_CONNECTED"]),
    awaitingApprovalOf: z.string(),
  })
  .strict();
export type ProposeEmailOutput = z.infer<typeof ProposeEmailOutputSchema>;

type Grant = {
  readonly relationshipId: string;
  readonly counterpartName: string;
  readonly to: string;
  readonly toName: string;
  readonly mailbox: boolean;
};

export function createProposeEmailTool(
  email: EmailIntelligencePort,
  relationships: RelationshipIntelligencePort | undefined,
): AnyQToolDefinition {
  return defineQTool<ProposeEmailInput, ProposeEmailOutput, Grant>({
    id: PROPOSE_EMAIL,
    version: 1,
    status: "ACTIVE",
    providerName: "propose_email",
    description:
      "Drafts an email from the person to the other side of one of their relationships (a company's founders, or an investor organisation's people) for their own approval, when they ask for it or agree to Q's suggestion. It sends nothing: the person sees the exact email, may edit it, and approves it; it then goes from their own connected Gmail. Recipients can only be people on that relationship.",
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
      try {
        let relationshipId = input.relationshipId;
        if (relationshipId === undefined && relationships !== undefined) {
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
        const counterpart = await email.counterpart(actor, relationshipId);
        if (
          counterpart === null ||
          !admitted(plan, { kind: counterpart.kind, id: counterpart.id })
        ) {
          return deny("NOT_AVAILABLE");
        }
        const wanted = input.recipientEmail?.toLowerCase();
        const recipient =
          wanted === undefined
            ? counterpart.contacts[0]
            : counterpart.contacts.find((c) => c.email === wanted);
        if (recipient === undefined) {
          // Never an address that is not on the relationship.
          return deny(
            "NOT_AVAILABLE",
            "I can only email people on the other side of this relationship.",
          );
        }
        return allow("CONFIDENTIAL", {
          relationshipId,
          counterpartName: counterpart.name,
          to: recipient.email,
          toName: recipient.name,
          mailbox: (await email.mailbox(actor)) !== null,
        });
      } catch {
        return deny("NOT_AVAILABLE");
      }
    },
    execute: (input, context, grant) => {
      if (!grant.mailbox) {
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
      });
      return Promise.resolve({
        status,
        awaitingApprovalOf: `Email ${grant.toName} at ${grant.counterpartName}: "${input.subject}"`,
      });
    },
  });
}
