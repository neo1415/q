import { z } from "zod";

import type { QTaskClass } from "@capital-q/contracts";

import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  QToolArgumentError,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import {
  PROPOSAL_PLAIN_STATUSES,
  type ConversationProposal,
  type PendingProposalPort,
} from "../ports.js";

/**
 * APPROVE_PENDING_PROPOSAL — `proposal.pending.approve` v1 (live test
 * 2026-09-27 #1).
 *
 * The person said "approved, go ahead" to a change Q had prepared and Q
 * answered that nothing clearly approved it: approval existed only as a tap
 * on the card. Whether a sentence approves the change is meaning, so the
 * MODEL decides it and names the proposal it was shown (ADR 0011). Every
 * check that makes the approval real is code's, here and in the Approval
 * Engine:
 *
 * - the proposal is in this run's conversation and addressed to this
 *   person (the port reads it as them; anything else is not listed);
 * - it is the ONE change waiting for their decision: none waiting, several
 *   waiting, or a different one named, and nothing is approved;
 * - the engine's own approve, the call the card's Approve button makes,
 *   authorises the approver, recomputes the payload hash, checks expiry and
 *   is idempotent on a repeat; the paused run then executes it through the
 *   execution gate.
 *
 * A change the person wants altered is not this tool: the altered version
 * is a new proposal, with its own approval.
 */
export const APPROVE_PENDING_PROPOSAL = "proposal.pending.approve" as const;

export const ApprovePendingProposalInputSchema = z
  .object({
    proposalId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .describe(
        "The id of the change waiting for their decision, as listed among what you already produced in this conversation.",
      ),
    approvalId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .describe(
        "Instead of proposalId: the approvalId of an item list_pending_approvals returned (a change prepared in another conversation), when they clearly mean that listed item.",
      ),
  })
  .strict();
export type ApprovePendingProposalInput = z.infer<
  typeof ApprovePendingProposalInputSchema
>;

const ProposalViewSchema = z
  .object({
    proposalId: z.string(),
    summary: z.string().max(400),
    status: z.enum(PROPOSAL_PLAIN_STATUSES),
  })
  .strict();

export const APPROVE_PENDING_OUTCOMES = [
  /** Approved and applied. */
  "SAVED",
  /** Approved; still being applied. */
  "SAVING",
  /** Approved, but the change did not go through. */
  "NOT_SAVED",
  /** The stored change no longer matches what was proposed: not approved. */
  "CHANGED",
  /** It lapsed before the approval: not approved. */
  "EXPIRED",
  /** The named change was already decided; `proposal` carries its status. */
  "ALREADY_DECIDED",
  /** Nothing is waiting for their decision in this conversation. */
  "NONE_PENDING",
  /** More than one change is waiting: ask which, listing `pending`. */
  "SEVERAL_PENDING",
  /** The approvalId is not one waiting for them: nothing was approved. */
  "NOT_FOUND",
  /** The named id is not the change waiting; `pending` lists the one that is. */
  "NOT_THE_PENDING_ONE",
] as const;

export const ApprovePendingProposalOutputSchema = z
  .object({
    outcome: z.enum(APPROVE_PENDING_OUTCOMES),
    proposal: ProposalViewSchema.nullable(),
    pending: z.array(ProposalViewSchema).max(6),
  })
  .strict();
export type ApprovePendingProposalOutput = z.infer<
  typeof ApprovePendingProposalOutputSchema
>;

const PURPOSES: readonly QTaskClass[] = [
  "GENERAL_QUESTION",
  "OWN_COMPANY_QUESTION",
  "INVESTOR_QUESTION",
  "ACTION_PREPARATION",
  "COUNTERPARTY_COMPANY_QUESTION",
  "RELATIONSHIP_QUESTION",
  "COMPARISON",
];

function view(proposal: ConversationProposal) {
  return {
    proposalId: proposal.proposalId,
    summary: proposal.summary.slice(0, 400),
    status: proposal.status,
  };
}

/** Exactly one of the two ids; anything else is the model's mistake to fix. */
function oneId(input: ApprovePendingProposalInput): void {
  if ((input.proposalId === undefined) === (input.approvalId === undefined)) {
    throw new QToolArgumentError(
      "Give exactly one of proposalId (this conversation) or approvalId (from list_pending_approvals).",
    );
  }
}

/**
 * An inbox item (lead decision 2026-09-27): the approval the person
 * referred to from list_pending_approvals, read as them; the same engine
 * decision follows, payload-bound and idempotent.
 */
async function inboxProposal(
  port: PendingProposalPort,
  at: { actor: ActorContext; runId: string; correlationId: string },
  approvalId: string,
): Promise<ConversationProposal | null> {
  if (port.inboxItem === undefined) return null;
  return port.inboxItem(at, approvalId).catch(() => null);
}

export function createApprovePendingProposalTool(
  port: PendingProposalPort,
): AnyQToolDefinition {
  return defineQTool<
    ApprovePendingProposalInput,
    ApprovePendingProposalOutput,
    null
  >({
    id: APPROVE_PENDING_PROPOSAL,
    version: 1,
    status: "ACTIVE",
    providerName: "approve_pending_proposal",
    description:
      "Approves the one change you prepared earlier in this conversation that is still waiting for the person's decision, when they have now clearly approved it themselves (by voice or text). Pass that change's id, or the approvalId of an item list_pending_approvals returned when they clearly mean that item. Do not call it when they want the change altered first (prepare the altered version instead: it needs its own approval), when they are only asking about it, or on your own initiative. The result's outcome is the only basis for saying whether the change is saved: SAVED, SAVING, NOT_SAVED, CHANGED or EXPIRED after an approval; ALREADY_DECIDED with its current status; NONE_PENDING; SEVERAL_PENDING (ask which, from the list); NOT_THE_PENDING_ONE.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    // The approver's authority is the Approval Engine's to check
    // (q.action.approve plus the action's own approver policy).
    requiredCapabilities: [],
    supportedPurposes: [...PURPOSES],
    // Always on (R33): a person decides whatever the turn is about.
    core: true,
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: null,
    input: ApprovePendingProposalInputSchema,
    output: ApprovePendingProposalOutputSchema,
    authorize: (_input, { actor, plan }) => {
      // Only a person approves, and only in their own conversation.
      const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
      if (
        actor.actorType !== "HUMAN" ||
        scope === undefined ||
        scope.filter.userId !== actor.userId
      ) {
        return Promise.resolve(deny<null>("NOT_AVAILABLE"));
      }
      return Promise.resolve(allow<null>("CONFIDENTIAL", null));
    },
    execute: async (input, context) => {
      oneId(input);
      const at = {
        actor: context.actor,
        runId: context.runId,
        correlationId: context.correlationId,
      };
      if (input.approvalId !== undefined) {
        const item = await inboxProposal(port, at, input.approvalId);
        if (item === null) {
          return { outcome: "NOT_FOUND", proposal: null, pending: [] };
        }
        if (item.status !== "PENDING") {
          return {
            outcome: "ALREADY_DECIDED",
            proposal: view(item),
            pending: [],
          };
        }
        const approved = await port.approve(at, item.proposalId);
        return {
          outcome:
            approved.status === "CHANGED" ||
            approved.status === "SAVED" ||
            approved.status === "SAVING" ||
            approved.status === "NOT_SAVED" ||
            approved.status === "EXPIRED"
              ? approved.status
              : "ALREADY_DECIDED",
          proposal: {
            ...view(item),
            status: approved.status === "CHANGED" ? "PENDING" : approved.status,
          },
          pending: [],
        };
      }
      const proposals = await port.inConversation(at);
      const pending = proposals.filter(
        (proposal) => proposal.status === "PENDING",
      );
      const named = proposals.find(
        (proposal) => proposal.proposalId === input.proposalId,
      );
      const listed = pending.slice(-6).map(view);
      if (named !== undefined && named.status !== "PENDING") {
        // A repeat of an approval already given, or a change already
        // declined: its real status, and nothing approved twice.
        return {
          outcome: "ALREADY_DECIDED",
          proposal: view(named),
          pending: listed,
        };
      }
      if (pending.length === 0) {
        return { outcome: "NONE_PENDING", proposal: null, pending: [] };
      }
      if (pending.length > 1) {
        return { outcome: "SEVERAL_PENDING", proposal: null, pending: listed };
      }
      const [only] = pending;
      if (only === undefined || only.proposalId !== input.proposalId) {
        return {
          outcome: "NOT_THE_PENDING_ONE",
          proposal: null,
          pending: listed,
        };
      }
      const approved = await port.approve(at, only.proposalId);
      const status =
        approved.status === "CHANGED" ? "PENDING" : approved.status;
      return {
        outcome:
          approved.status === "CHANGED"
            ? "CHANGED"
            : approved.status === "SAVED" ||
                approved.status === "SAVING" ||
                approved.status === "NOT_SAVED" ||
                approved.status === "EXPIRED"
              ? approved.status
              : // DECLINED or PENDING after an approve: decided elsewhere
                // meanwhile, reported as it now stands.
                "ALREADY_DECIDED",
        proposal: { ...view(only), status },
        pending: [],
      };
    },
  });
}

/**
 * DECLINE_PENDING_PROPOSAL — `proposal.pending.decline` v1 (R33).
 *
 * The other half of approval by conversation: "no, don't do that". Whether
 * a sentence declines is meaning, so the model decides and names the
 * change (ADR 0011). Declining changes nothing in the world, so any change
 * of this conversation that is still waiting for this person may be named;
 * the Approval Engine's own reject (the card's Decline) records it.
 */
export const DECLINE_PENDING_PROPOSAL = "proposal.pending.decline" as const;

export const DeclinePendingProposalInputSchema =
  ApprovePendingProposalInputSchema;
export type DeclinePendingProposalInput = ApprovePendingProposalInput;

export const DECLINE_PENDING_OUTCOMES = [
  /** Declined; nothing changed. */
  "DECLINED",
  /** Already decided; `proposal` carries its status. */
  "ALREADY_DECIDED",
  /** The named id is not a change waiting for them here; `pending` lists those that are. */
  "NOT_PENDING_HERE",
  /** The approvalId is not one waiting for them: nothing was declined. */
  "NOT_FOUND",
] as const;

export const DeclinePendingProposalOutputSchema = z
  .object({
    outcome: z.enum(DECLINE_PENDING_OUTCOMES),
    proposal: ProposalViewSchema.nullable(),
    pending: z.array(ProposalViewSchema).max(6),
  })
  .strict();
export type DeclinePendingProposalOutput = z.infer<
  typeof DeclinePendingProposalOutputSchema
>;

export function createDeclinePendingProposalTool(
  port: PendingProposalPort,
  decline: NonNullable<PendingProposalPort["decline"]>,
): AnyQToolDefinition {
  return defineQTool<
    DeclinePendingProposalInput,
    DeclinePendingProposalOutput,
    null
  >({
    id: DECLINE_PENDING_PROPOSAL,
    version: 1,
    status: "ACTIVE",
    providerName: "decline_pending_proposal",
    description:
      "Declines a change you prepared earlier in this conversation that is still waiting for the person's decision, when they have clearly said no to it themselves (by voice or text), exactly as the Decline button on its card does. Nothing is changed. Pass that change's id, or the approvalId of an item list_pending_approvals returned when they clearly mean that item. Not for a change they want altered (prepare the altered version instead) and never on your own initiative. Report only what the outcome says: DECLINED, ALREADY_DECIDED, or NOT_PENDING_HERE with the ones that are waiting.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    // The approver's authority is the Approval Engine's to check.
    requiredCapabilities: [],
    supportedPurposes: [...PURPOSES],
    // Always on (R33): a person decides whatever the turn is about.
    core: true,
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: null,
    input: DeclinePendingProposalInputSchema,
    output: DeclinePendingProposalOutputSchema,
    authorize: (_input, { actor, plan }) => {
      const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
      if (
        actor.actorType !== "HUMAN" ||
        scope === undefined ||
        scope.filter.userId !== actor.userId
      ) {
        return Promise.resolve(deny<null>("NOT_AVAILABLE"));
      }
      return Promise.resolve(allow<null>("CONFIDENTIAL", null));
    },
    execute: async (input, context) => {
      oneId(input);
      const at = {
        actor: context.actor,
        runId: context.runId,
        correlationId: context.correlationId,
      };
      const proposals = await port.inConversation(at);
      const pending = proposals.filter(
        (proposal) => proposal.status === "PENDING",
      );
      const named =
        input.approvalId !== undefined
          ? await inboxProposal(port, at, input.approvalId)
          : proposals.find(
              (proposal) => proposal.proposalId === input.proposalId,
            );
      const listed = pending.slice(-6).map(view);
      if (named === undefined || named === null) {
        if (input.approvalId !== undefined) {
          return { outcome: "NOT_FOUND", proposal: null, pending: listed };
        }
        return { outcome: "NOT_PENDING_HERE", proposal: null, pending: listed };
      }
      if (named.status !== "PENDING") {
        return {
          outcome: "ALREADY_DECIDED",
          proposal: view(named),
          pending: listed,
        };
      }
      const declined = await decline(at, named.proposalId);
      return {
        outcome:
          declined.status === "DECLINED" ? "DECLINED" : "ALREADY_DECIDED",
        proposal: { ...view(named), status: declined.status },
        pending: [],
      };
    },
  });
}
