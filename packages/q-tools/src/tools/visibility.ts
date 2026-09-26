import { z } from "zod";

import {
  UtcTimestampSchema,
  UuidSchema,
  type PermittedContextPlan,
  type QTaskClass,
  type VisibilityStateDto,
} from "@capital-q/contracts";
import { capability } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { boundScopeFor } from "../plan.js";
import type { VisibilityIntelligencePort } from "../ports.js";
import { ProposalOutputSchema, type ProposalOutput } from "./relationships.js";

/**
 * Who can see what, for the person's own company (CQ-BIZ-003; business
 * research §6.2 "Q parity").
 *
 *   get_disclosure_state   "who can see our raise?" -- each object's
 *                          scope, in words, and the active shares, read
 *                          from the permissions context's own answer
 *   propose_share_raise    prepare sharing the raise with one investor
 *                          the company has a relationship with
 *   propose_revoke_share   prepare revoking one active share
 *
 * The firewall comes first: only a company the plan bound is asked about,
 * and the permissions context answers only its own organisation's members
 * holding disclosure.inspect. The proposal tools write one thing, a note
 * to the run's Approval Engine proposer; the person approves the exact
 * share or revoke, with what the investor will and will not receive, and
 * the approved action runs through the same centre the page calls.
 * Changing who can see the profile itself is company.visibility.set,
 * which already exists with its own approval.
 */

export const GET_DISCLOSURE_STATE = "disclosure.state.get" as const;
export const PROPOSE_SHARE_RAISE = "disclosure.raise.share.propose" as const;
export const PROPOSE_REVOKE_SHARE = "disclosure.share.revoke.propose" as const;

const PURPOSES: readonly QTaskClass[] = [
  "OWN_COMPANY_QUESTION",
  "ACTION_PREPARATION",
  "GENERAL_QUESTION",
];
const SCOPES = ["COMPANY_PROFILE"] as const;

/** Only the person's own company, as the firewall bound it for this run. */
function ownCompanyBound(
  plan: PermittedContextPlan,
  companyId: string,
): boolean {
  return (
    boundScopeFor(
      plan,
      "COMPANY_PROFILE",
      (filter) => filter.companyId === companyId,
    ) !== undefined
  );
}

const CompanyInput = z
  .object({
    companyId: UuidSchema.describe(
      "The person's own company's id, as given in the conversation context.",
    ),
  })
  .strict();
type CompanyInput = z.infer<typeof CompanyInput>;

const SCOPE_WORDS: Readonly<Record<string, string>> = {
  organisation_private: "only people in the company's own organisation",
  founder_private: "only the company's own side",
  network_visible:
    "organisations on Capital Q (not the public; not ranked or recommended by this alone)",
  public_external: "anyone with a link, including the public",
  relationship_shared: "the company and the investor it is shared with",
  specifically_shared: "only the recipients it is shared with",
  personal_private: "only the person themselves",
  investor_private: "only the investor's own side",
};

const OBJECT_NAMES: Readonly<Record<string, string>> = {
  COMPANY_PROFILE: "the company profile",
  CAPITAL_OBJECTIVE:
    "the raise (target, instrument, stage and close date; never the use of funds)",
};

export const GetDisclosureStateOutputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            what: z.string(),
            scope: z.string(),
            visibleTo: z.string(),
            sharedWith: z.array(z.string()),
          })
          .strict(),
      )
      .max(8),
    alwaysPrivate: z.string(),
    shares: z
      .array(
        z
          .object({
            shareId: UuidSchema,
            what: z.string(),
            with: z.string(),
            relationshipId: UuidSchema,
            since: UtcTimestampSchema,
          })
          .strict(),
      )
      .max(200),
    /** Investors the raise could be shared with: relationships the company can see. */
    shareableWith: z
      .array(
        z.object({ relationshipId: UuidSchema, name: z.string() }).strict(),
      )
      .max(200),
    truthClass: z.literal("VERIFIED"),
    source: z.literal("Capital Q disclosure settings"),
  })
  .strict();
export type GetDisclosureStateOutput = z.infer<
  typeof GetDisclosureStateOutputSchema
>;

function describeState(state: VisibilityStateDto): GetDisclosureStateOutput {
  const sharedNames = state.shares.map((s) => s.recipientName ?? "an investor");
  return {
    items: state.objects.map((object) => ({
      what: OBJECT_NAMES[object.object] ?? object.object,
      scope: object.scope,
      visibleTo: SCOPE_WORDS[object.scope] ?? object.scope,
      sharedWith: state.shares
        .filter((share) => share.object === object.object)
        .map((share) => share.recipientName ?? "an investor"),
    })),
    alwaysPrivate:
      "Setup answers, documents, what Q read from them, conversations with Q and the use of funds stay private to the company's own organisation, whatever is chosen.",
    shares: state.shares.map((share, index) => ({
      shareId: share.policyId,
      what: OBJECT_NAMES[share.object] ?? share.object,
      with: sharedNames[index] ?? "an investor",
      relationshipId: share.relationshipId,
      since: share.createdAt,
    })),
    shareableWith: state.relationships
      .filter(
        (r) => !state.shares.some((s) => s.relationshipId === r.relationshipId),
      )
      .map((r) => ({ relationshipId: r.relationshipId, name: r.name })),
    truthClass: "VERIFIED",
    source: "Capital Q disclosure settings",
  };
}

function createGetDisclosureStateTool(
  visibility: VisibilityIntelligencePort,
): AnyQToolDefinition {
  return defineQTool<
    CompanyInput,
    GetDisclosureStateOutput,
    GetDisclosureStateOutput
  >({
    id: GET_DISCLOSURE_STATE,
    version: 1,
    status: "ACTIVE",
    providerName: "get_disclosure_state",
    description:
      "Who can see what of the person's own company on Capital Q: the company profile and the raise, each with who it is visible to, the investors each is shared with, and which investors it could still be shared with. Call it whenever the person asks who can see something, whether something is public, private or shared, or before preparing a share or a revoke.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [capability("disclosure.inspect")],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: [...SCOPES],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_COMPANY",
    input: CompanyInput,
    output: GetDisclosureStateOutputSchema,
    authorize: async (input, { actor, plan }) => {
      if (!ownCompanyBound(plan, input.companyId)) {
        return deny("NOT_AVAILABLE");
      }
      try {
        return allow(
          "CONFIDENTIAL",
          describeState(await visibility.state(actor, input.companyId)),
        );
      } catch {
        return deny("NOT_AVAILABLE");
      }
    },
    execute: (_input, _context, grant) => Promise.resolve(grant),
  });
}

const ShareRaiseInput = z
  .object({
    companyId: UuidSchema.describe(
      "The person's own company's id, as given in the conversation context.",
    ),
    relationshipId: UuidSchema.describe(
      "The investor to share with, from get_disclosure_state shareableWith.",
    ),
  })
  .strict();
type ShareRaiseInput = z.infer<typeof ShareRaiseInput>;

function createProposeShareRaiseTool(
  visibility: VisibilityIntelligencePort,
): AnyQToolDefinition {
  return defineQTool<
    ShareRaiseInput,
    ProposalOutput,
    { readonly name: string }
  >({
    id: PROPOSE_SHARE_RAISE,
    version: 1,
    status: "ACTIVE",
    providerName: "propose_share_raise",
    description:
      "Prepares sharing the company's raise (target, instrument, stage and close date; never the use of funds) with one investor the company has a relationship with, for the person's own approval, when they have asked for it. It shares nothing by itself: the person is shown exactly what that investor will and will not receive, and approves or declines.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [capability("disclosure.manage")],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: [...SCOPES],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "WAITING_FOR_APPROVAL",
    input: ShareRaiseInput,
    output: ProposalOutputSchema,
    authorize: async (input, { actor, plan }) => {
      if (!ownCompanyBound(plan, input.companyId)) {
        return deny("NOT_AVAILABLE");
      }
      try {
        const state = await visibility.state(actor, input.companyId);
        const raise = state.objects.some(
          (o) => o.object === "CAPITAL_OBJECTIVE" && o.shareable,
        );
        const relationship = state.relationships.find(
          (r) => r.relationshipId === input.relationshipId,
        );
        const already = state.shares.some(
          (s) =>
            s.object === "CAPITAL_OBJECTIVE" &&
            s.relationshipId === input.relationshipId,
        );
        if (!raise || relationship === undefined || already) {
          return deny("NOT_AVAILABLE");
        }
        return allow("CONFIDENTIAL", { name: relationship.name });
      } catch {
        return deny("NOT_AVAILABLE");
      }
    },
    execute: (input, context, grant) =>
      Promise.resolve({
        status: visibility.prepareForApproval({
          runId: context.runId,
          tenantId: context.actor.tenantId,
          actorUserId: context.actor.userId,
          actionType: "disclosure.raise.share",
          payload: {
            companyId: input.companyId,
            relationshipId: input.relationshipId,
            recipientName: grant.name,
          },
        }),
        awaitingApprovalOf: `Share your raise with ${grant.name}`,
      }),
  });
}

const RevokeShareInput = z
  .object({
    companyId: UuidSchema.describe(
      "The person's own company's id, as given in the conversation context.",
    ),
    shareId: UuidSchema.describe(
      "The share to revoke, from get_disclosure_state shares.",
    ),
  })
  .strict();
type RevokeShareInput = z.infer<typeof RevokeShareInput>;

function createProposeRevokeShareTool(
  visibility: VisibilityIntelligencePort,
): AnyQToolDefinition {
  return defineQTool<
    RevokeShareInput,
    ProposalOutput,
    { readonly name: string }
  >({
    id: PROPOSE_REVOKE_SHARE,
    version: 1,
    status: "ACTIVE",
    providerName: "propose_revoke_share",
    description:
      "Prepares revoking one active share of the company's raise with an investor, for the person's own approval, when they have asked for it. It revokes nothing by itself. Revoking removes future access; what the investor already saw cannot be recalled, and the person is told so.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [capability("disclosure.manage")],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: [...SCOPES],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "WAITING_FOR_APPROVAL",
    input: RevokeShareInput,
    output: ProposalOutputSchema,
    authorize: async (input, { actor, plan }) => {
      if (!ownCompanyBound(plan, input.companyId)) {
        return deny("NOT_AVAILABLE");
      }
      try {
        const state = await visibility.state(actor, input.companyId);
        const share = state.shares.find((s) => s.policyId === input.shareId);
        if (share === undefined) return deny("NOT_AVAILABLE");
        return allow("CONFIDENTIAL", {
          name: share.recipientName ?? "that investor",
        });
      } catch {
        return deny("NOT_AVAILABLE");
      }
    },
    execute: (input, context, grant) =>
      Promise.resolve({
        status: visibility.prepareForApproval({
          runId: context.runId,
          tenantId: context.actor.tenantId,
          actorUserId: context.actor.userId,
          actionType: "disclosure.share.revoke",
          payload: {
            companyId: input.companyId,
            policyId: input.shareId,
            recipientName: grant.name,
          },
        }),
        awaitingApprovalOf: `Stop sharing your raise with ${grant.name}`,
      }),
  });
}

export function createVisibilityTools(
  visibility: VisibilityIntelligencePort,
): readonly AnyQToolDefinition[] {
  return [
    createGetDisclosureStateTool(visibility),
    createProposeShareRaiseTool(visibility),
    createProposeRevokeShareTool(visibility),
  ];
}
