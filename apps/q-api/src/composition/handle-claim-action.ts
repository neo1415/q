import { z } from "zod";

import {
  CorrelationIdSchema,
  HandleSchema,
  QActionTypeSchema,
  QCardSubjectTypeSchema,
  UuidSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  HANDLE_MANAGE,
  HandleUnavailableError,
  type PublicIdentityService,
  type SubjectDirectory,
} from "@capital-q/public-identity";
import { defineQAction, type AnyQActionDefinition } from "@capital-q/q-actions";
import type { AuthorizationService } from "@capital-q/security";

/**
 * `handle.claim` (BIZ-004): claim or change the organisation's public
 * handle, which also makes its Q Card the first time.
 *
 * A handle is a public representation of the organisation, so this is
 * CONFIRM_REQUIRED: the person sees the exact handle and approves it. The
 * approved action executes through the public-identity service's own
 * `claimHandle` -- the command the profile page's `PUT .../handle` calls
 * -- under the approver's authority. One write path, two front doors.
 */

export const HANDLE_CLAIM = QActionTypeSchema.parse("handle.claim");

export const HandleClaimPayloadSchema = z
  .object({
    subjectType: QCardSubjectTypeSchema,
    subjectId: UuidSchema,
    handle: HandleSchema,
  })
  .strict();
export type HandleClaimPayload = z.infer<typeof HandleClaimPayloadSchema>;

export const HandleClaimResultSchema = z
  .object({
    handle: HandleSchema,
    publicCode: z.string(),
  })
  .strict();
export type HandleClaimResult = z.infer<typeof HandleClaimResultSchema>;

export function describeHandleClaim(payload: HandleClaimPayload): {
  readonly summary: string;
  readonly preview: string;
} {
  return {
    summary: `Set your public handle to @${payload.handle}. Your Q Card will be at /@${payload.handle}.`,
    preview: `Handle: @${payload.handle}`,
  };
}

export type HandleClaimActionDependencies = {
  readonly publicIdentity: PublicIdentityService;
  readonly subjects: SubjectDirectory;
  readonly authorization: AuthorizationService;
  readonly logger?: Logger | undefined;
};

export function createHandleClaimAction(
  dependencies: HandleClaimActionDependencies,
): AnyQActionDefinition {
  const { publicIdentity, subjects, authorization, logger } = dependencies;
  return defineQAction<HandleClaimPayload, HandleClaimResult>({
    actionType: HANDLE_CLAIM,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Claims or changes the approver's organisation's public handle (its Q Card address), exactly as approved.",
    payload: HandleClaimPayloadSchema,
    result: HandleClaimResultSchema,
    targets: (payload): readonly QSubjectRef[] => [
      payload.subjectType === "COMPANY"
        ? { kind: "COMPANY", companyId: payload.subjectId }
        : {
            kind: "INVESTOR_ORGANISATION",
            investorOrganisationId: payload.subjectId,
          },
    ],
    describe: describeHandleClaim,
    confirm: (payload) =>
      `Done. Your handle is @${payload.handle}, and your Q Card is live at /@${payload.handle}.`,
    authorize: async (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return { outcome: "DENY", code: "NOT_A_PERSON" };
      }
      const facts = await subjects.find({
        subjectType: payload.subjectType,
        subjectId: payload.subjectId,
      });
      // Absent, another tenant's and another organisation's: one answer.
      if (
        facts === null ||
        facts.tenantId !== actor.tenantId ||
        actor.organisationId === undefined ||
        facts.organisationId !== actor.organisationId
      ) {
        return { outcome: "DENY", code: "NOT_AVAILABLE" };
      }
      const decision = await authorization.authorize({
        actor,
        capability: HANDLE_MANAGE,
        resource: {
          kind: "RESOURCE",
          tenantId: actor.tenantId,
          organisationId: actor.organisationId,
          resourceType:
            payload.subjectType === "COMPANY"
              ? "company"
              : "investor_organisation",
          resourceId: payload.subjectId,
        },
      });
      return decision.outcome === "ALLOW"
        ? { outcome: "ALLOW" }
        : { outcome: "DENY", code: "NOT_PERMITTED" };
    },
    executor: {
      execute: async (action, context) => {
        try {
          const card = await publicIdentity.claimHandle({
            actor: context.approver,
            subject: {
              subjectType: action.payload.subjectType,
              subjectId: action.payload.subjectId,
            },
            handle: action.payload.handle,
            correlationId: CorrelationIdSchema.parse(context.correlationId),
          });
          return {
            outcome: "EXECUTED",
            result: {
              handle: card.handle ?? action.payload.handle,
              publicCode: card.publicCode,
            },
          };
        } catch (error: unknown) {
          logger?.warn(
            { err: error, actionId: action.actionId, attempt: context.attempt },
            "handle claim was not applied",
          );
          return {
            outcome: "FAILED",
            // Taken between approval and execution: said as such.
            failureCode:
              error instanceof HandleUnavailableError
                ? `HANDLE_${error.reason}`
                : "HANDLE_CLAIM_REFUSED",
            retryable: false,
          };
        }
      },
    },
  });
}
