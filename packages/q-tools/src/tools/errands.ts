import { z } from "zod";

import { ChatMessageBodySchema, UuidSchema } from "@capital-q/contracts";
import { CompanyIdSchema } from "@capital-q/companies";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import type { QToolPorts, RelationshipIntelligencePort } from "../ports.js";
import {
  ChatProposalOutputSchema,
  ERRAND_START,
  exactlyOne,
  ONE_REF,
  PURPOSES,
  RelationshipRef,
  resolveRelationship,
  SCOPES,
  type ChatIntelligencePort,
  type ChatProposalOutput,
  type ErrandPlan,
} from "./chat.js";
import { actionTarget } from "./relationships.js";

/**
 * Errands for Q (founder direction 2026-09-29): "express interest; when
 * they accept, chat with them, answer their questions, book a call, send me
 * the link". One tool prepares the whole plan for ONE approval; the plan is
 * the exact payload approved -- the opening message word for word, the
 * brief Q may answer from word for word, the call's purpose and length.
 * Q adds nothing to it afterwards, and every step runs as the person
 * through the same commands their own buttons use.
 */

export const PROPOSE_ERRAND = "relationship.errand.propose" as const;

/** An errand's stage, as the person reads it. */
export function errandStageWords(stage: string): string {
  switch (stage) {
    case "WAITING_CONNECTION":
      return "waiting for them to accept";
    case "CONVERSING":
      return "in the chat with them";
    case "CALL_BOOKED":
      return "the call is booked";
    case "FINISHED":
      return "finished";
    default:
      return "under way";
  }
}

export const ProposeErrandInputSchema = z
  .object({
    ...RelationshipRef,
    expressInterest: z
      .boolean()
      .default(false)
      .describe(
        "As an investor, not yet connected: express interest in the company first. Only when they asked for it.",
      ),
    openingMessage: ChatMessageBodySchema.nullable()
      .default(null)
      .describe(
        "The first message, in the person's voice, posted (marked as sent by Q) once both sides are connected. Null: none.",
      ),
    brief: z
      .string()
      .trim()
      .min(20)
      .max(2_000)
      .nullable()
      .default(null)
      .describe(
        "Only when they asked Q to answer the other side's questions: everything Q may say, drafted from what the person told you or their own profile, as plain statements they will approve word for word. Never private numbers they have not agreed to share. Null: Q answers nothing and passes questions to them.",
      ),
    callPurpose: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .nullable()
      .default(null)
      .describe(
        "When they asked Q to book a call: its purpose, as the invite title. Null: no call.",
      ),
    callMinutes: z.number().int().min(15).max(120).default(30),
  })
  .strict()
  .refine(exactlyOne, ONE_REF);
export type ProposeErrandInput = z.input<typeof ProposeErrandInputSchema>;
type ParsedInput = z.output<typeof ProposeErrandInputSchema>;

type ErrandGrant = {
  readonly relationshipId: string | null;
  readonly companyId: string | null;
  readonly counterpartName: string;
  readonly connected: boolean;
  readonly blocked: boolean;
};

export function createErrandTools(
  ports: QToolPorts,
  chat: ChatIntelligencePort,
  relationships: RelationshipIntelligencePort,
): readonly AnyQToolDefinition[] {
  return [
    defineQTool<ParsedInput, ChatProposalOutput, ErrandGrant>({
      id: PROPOSE_ERRAND,
      version: 1,
      status: "ACTIVE",
      providerName: "propose_errand",
      description:
        "Prepares an errand -- several steps Q then carries out on its own as things happen, for ONE approval: express interest (investor), open the chat when they're connected, answer the other side's questions from an approved brief, book a call at the first free time on the person's calendar, and tell the person with the link. Use it when they hand Q a multi-step job about one company or investor ('express interest, and when they accept chat with them and book a call'). It does nothing until they approve exactly what is shown; they can stop it at any time.",
      classification: "SIDE_EFFECT",
      riskClass: "LOW_RISK_INTERNAL",
      requiredCapabilities: [],
      supportedPurposes: [...PURPOSES],
      requiredScopeKinds: [...SCOPES],
      approval: "NONE",
      idempotency: "SAFE_TO_REPEAT",
      owner: "q-tools",
      visibleStage: "WAITING_FOR_APPROVAL",
      input: ProposeErrandInputSchema,
      output: ChatProposalOutputSchema,
      authorize: async (input, { actor, plan }) => {
        try {
          const relationshipId = await resolveRelationship(
            input,
            actor,
            plan,
            relationships,
          );
          if (relationshipId !== null) {
            const thread = await chat.thread(actor, relationshipId);
            if (thread === null) return deny("NOT_AVAILABLE");
            return allow("CONFIDENTIAL", {
              relationshipId,
              companyId: null,
              counterpartName: thread.counterpartName,
              connected: thread.connected,
              blocked: thread.blocked === true,
            });
          }
          // Not related yet: only an investor expressing interest starts here.
          const companyId = input.companyId;
          if (
            companyId === undefined ||
            !input.expressInterest ||
            !actionTarget(plan, companyId) ||
            !(await relationships.mayExpressInterest(actor, companyId))
          ) {
            return deny("NOT_AVAILABLE");
          }
          const profile = await ports.companies.findCanonicalCompanyProfile(
            CompanyIdSchema.parse(companyId),
          );
          if (profile === null) return deny("NOT_AVAILABLE");
          return allow("NETWORK_VISIBLE", {
            relationshipId: null,
            companyId,
            counterpartName: profile.canonicalName,
            connected: false,
            blocked: false,
          });
        } catch {
          return deny("NOT_AVAILABLE");
        }
      },
      execute: async (input, context, grant) => {
        if (grant.blocked) {
          return {
            status: "BLOCKED" as const,
            awaitingApprovalOf:
              "You can't message this relationship right now.",
          };
        }
        // One errand per subject (QA 2026-10-01: a second card was
        // prepared for a company Q was already looking after). What Q is
        // already doing is said from the errand's real state.
        const running =
          chat.activeErrand === undefined
            ? null
            : await chat
                .activeErrand(context.actor, {
                  relationshipId: grant.relationshipId,
                  companyId: grant.companyId,
                })
                .catch(() => null);
        if (running !== null) {
          return {
            status: "ALREADY_ACTIVE" as const,
            awaitingApprovalOf: `Q is already looking after ${running.counterpartName} for you (${errandStageWords(running.stage)})${running.lastStep === null ? "." : `: ${running.lastStep}`}`,
          };
        }
        const plan: ErrandPlan = {
          ...(grant.relationshipId === null
            ? { companyId: UuidSchema.parse(grant.companyId) }
            : { relationshipId: grant.relationshipId }),
          counterpartName: grant.counterpartName,
          // Interest is expressed only where it can still be.
          expressInterest: input.expressInterest && !grant.connected,
          openingMessage: input.openingMessage,
          brief: input.brief,
          bookCall:
            input.callPurpose === null
              ? null
              : {
                  purpose: input.callPurpose,
                  durationMinutes: input.callMinutes,
                },
        };
        const status = chat.prepareForApproval({
          runId: context.runId,
          tenantId: context.actor.tenantId,
          actorUserId: context.actor.userId,
          proposal: { actionType: ERRAND_START, payload: plan },
        });
        return {
          status,
          awaitingApprovalOf: `Q looks after ${grant.counterpartName} for you`,
        };
      },
    }),
  ];
}
