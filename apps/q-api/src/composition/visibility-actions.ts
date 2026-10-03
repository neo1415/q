import { z } from "zod";

import {
  QActionTypeSchema,
  UuidSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { VisibilityCentre } from "@capital-q/permissions";
import { defineQAction, type AnyQActionDefinition } from "@capital-q/q-actions";
import {
  capability,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

/**
 * Sharing, by Q (CQ-BIZ-003; business research §6.2 "Q parity").
 *
 * Two CONFIRM_REQUIRED actions over the permissions context's visibility
 * centre -- the same one the visibility page calls: share the raise with
 * one investor the company has a relationship with, and revoke one share.
 * Prepared by Q's proposal tools onto the board below, approved by the
 * person against this exact payload with the sharing preview ("will
 * receive ... will not receive ..."), executed under the approver's
 * authority. The centre checks disclosure.manage, the relationship's
 * coherence, audit and outbox again at execution; Q gains nothing because
 * it prepared it.
 */

export const DISCLOSURE_RAISE_SHARE = QActionTypeSchema.parse(
  "disclosure.raise.share",
);
export const DISCLOSURE_SHARE_REVOKE = QActionTypeSchema.parse(
  "disclosure.share.revoke",
);

export const ShareRaisePayloadSchema = z
  .object({
    companyId: UuidSchema,
    relationshipId: UuidSchema,
    /** Shown to the approver; the binding is the relationship id. */
    recipientName: z.string().trim().min(1).max(200),
  })
  .strict();
export type ShareRaisePayload = z.infer<typeof ShareRaisePayloadSchema>;

export const RevokeSharePayloadSchema = z
  .object({
    companyId: UuidSchema,
    policyId: UuidSchema,
    recipientName: z.string().trim().min(1).max(200),
  })
  .strict();
export type RevokeSharePayload = z.infer<typeof RevokeSharePayloadSchema>;

const ShareResultSchema = z
  .object({ outcome: z.enum(["CREATED", "EXISTING", "REDUNDANT"]) })
  .strict();
const RevokeResultSchema = z
  .object({ outcome: z.enum(["REVOKED", "ALREADY_REVOKED"]) })
  .strict();

/** What the approver is told, in Spec 8.9.7's "will receive / will not receive" form. */
export function shareRaisePreview(recipientName: string): string {
  return [
    `${recipientName} will receive: your raise's target, instrument, stage and target close date.`,
    `${recipientName} will not receive: the use of funds, your documents, your conversations with Q, or anything else about your company that is private.`,
    "You can revoke it at any time. Revoking removes future access; what they have already seen can't be recalled.",
  ].join("\n");
}

type Dependencies = {
  readonly visibility: VisibilityCentre;
  readonly authorization: AuthorizationService;
  readonly logger?: Logger | undefined;
};

/**
 * The approver's own company, their disclosure.manage on it, and the
 * centre's current state. Absent, another organisation's and not
 * permitted are one answer.
 */
async function managedState(
  dependencies: Dependencies,
  actor: ActorContext,
  companyId: string,
) {
  if (actor.actorType !== "HUMAN" || actor.organisationId === undefined) {
    return null;
  }
  const state = await dependencies.visibility
    .state({ actor, companyId })
    .catch(() => null);
  if (state === null) return null;
  const decision = await dependencies.authorization.authorize({
    actor,
    capability: capability("disclosure.manage"),
    resource: {
      kind: "RESOURCE",
      tenantId: actor.tenantId,
      organisationId: actor.organisationId,
      resourceType: "company",
      resourceId: companyId,
    },
  });
  return decision.outcome === "ALLOW" ? state : null;
}

export function createShareRaiseAction(
  dependencies: Dependencies,
): AnyQActionDefinition {
  const { visibility, logger } = dependencies;
  return defineQAction<ShareRaisePayload, z.infer<typeof ShareResultSchema>>({
    actionType: DISCLOSURE_RAISE_SHARE,
    supersedes: true,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Shares the approver's company's raise (structured, never the use of funds) with one investor organisation it has a relationship with, exactly as approved, through the permissions context's visibility centre.",
    payload: ShareRaisePayloadSchema,
    result: ShareResultSchema,
    targets: (payload): readonly QSubjectRef[] => [
      { kind: "COMPANY", companyId: payload.companyId },
      { kind: "RELATIONSHIP", relationshipId: payload.relationshipId },
    ],
    describe: (payload) => ({
      summary: `Share your raise with ${payload.recipientName}`,
      preview: shareRaisePreview(payload.recipientName),
    }),
    confirm: (payload, result) =>
      result.outcome === "CREATED"
        ? `Done. ${payload.recipientName} can now see your raise; nothing else was shared.`
        : `${payload.recipientName} could already see your raise; nothing new was shared.`,
    authorize: async (payload, actor) => {
      const state = await managedState(dependencies, actor, payload.companyId);
      if (state === null) return { outcome: "DENY", code: "NOT_AVAILABLE" };
      const known = state.relationships.some(
        (r) => r.relationshipId === payload.relationshipId,
      );
      const raise = state.objects.some(
        (o) => o.object === "CAPITAL_OBJECTIVE" && o.shareable,
      );
      return known && raise
        ? { outcome: "ALLOW" }
        : { outcome: "DENY", code: "NOT_AVAILABLE" };
    },
    executor: {
      execute: async (action, context) => {
        try {
          const result = await visibility.share({
            actor: context.approver,
            companyId: action.payload.companyId,
            object: "CAPITAL_OBJECTIVE",
            relationshipId: action.payload.relationshipId,
            correlationId: context.correlationId,
          });
          return { outcome: "EXECUTED", result: { outcome: result.outcome } };
        } catch (error: unknown) {
          logger?.warn(
            { err: error, actionId: action.actionId, attempt: context.attempt },
            "share was not applied",
          );
          return {
            outcome: "FAILED",
            failureCode: "SHARE_REFUSED",
            retryable: false,
          };
        }
      },
    },
  });
}

export function createRevokeShareAction(
  dependencies: Dependencies,
): AnyQActionDefinition {
  const { visibility, logger } = dependencies;
  return defineQAction<RevokeSharePayload, z.infer<typeof RevokeResultSchema>>({
    actionType: DISCLOSURE_SHARE_REVOKE,
    supersedes: true,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Revokes one share of the approver's company's raise, exactly as approved, through the permissions context's visibility centre. History is kept.",
    payload: RevokeSharePayloadSchema,
    result: RevokeResultSchema,
    targets: (payload): readonly QSubjectRef[] => [
      { kind: "COMPANY", companyId: payload.companyId },
    ],
    describe: (payload) => ({
      summary: `Stop sharing your raise with ${payload.recipientName}`,
      preview: `${payload.recipientName} will no longer be able to see your raise. This removes future access; what they have already seen can't be recalled.`,
    }),
    confirm: (payload) =>
      `Done. ${payload.recipientName} can no longer see your raise.`,
    authorize: async (payload, actor) => {
      const state = await managedState(dependencies, actor, payload.companyId);
      return state !== null &&
        state.shares.some((s) => s.policyId === payload.policyId)
        ? { outcome: "ALLOW" }
        : { outcome: "DENY", code: "NOT_AVAILABLE" };
    },
    executor: {
      execute: async (action, context) => {
        try {
          const result = await visibility.revoke({
            actor: context.approver,
            companyId: action.payload.companyId,
            policyId: action.payload.policyId,
            correlationId: context.correlationId,
          });
          return {
            outcome: "EXECUTED",
            result: { outcome: result.outcome },
          };
        } catch (error: unknown) {
          logger?.warn(
            {
              err: error,
              actionId: action.actionId,
              attempt: context.attempt,
            },
            "revoke was not applied",
          );
          return {
            outcome: "FAILED",
            failureCode: "REVOKE_REFUSED",
            retryable: false,
          };
        }
      },
    },
  });
}
