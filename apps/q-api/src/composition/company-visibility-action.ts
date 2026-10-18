import { z } from "zod";

import {
  CompanyVisibilityChoiceSchema,
  MARKETPLACE_READINESS_MARKETPLACE_READY,
  QActionTypeSchema,
  SetCompanyVisibilityRequestSchema,
  UuidSchema,
  type CompanyVisibilityChoice,
  type QSubjectRef,
} from "@capital-q/contracts";
import {
  CompanyIdSchema,
  type CompanyQueryPort,
  type CompanyService,
} from "@capital-q/companies";
import type { Logger } from "@capital-q/observability";
import { defineQAction, type AnyQActionDefinition } from "@capital-q/q-actions";
import { capability, type AuthorizationService } from "@capital-q/security";

/**
 * Who can see the company, changed by Q (CQ-QACT-001, acceptance F6).
 *
 * Exactly the two choices the Visibility & Discovery screen offers —
 * visible to investors on the network, or private to the organisation —
 * and exactly the capability that screen calls: the companies context's
 * `setCompanyVisibility`, the service behind `POST
 * /v1/companies/:id/visibility`, with its own `company.edit` check, its
 * version predicate, its audit, its outbox event and its readiness
 * reconciliation. Nothing here writes a row; nothing here decides
 * readiness.
 *
 * Prepared from the turn's reading (a TOOL_REQUEST the reader named
 * SET_VISIBILITY), approved by the person against this exact payload,
 * executed under the approver's authority. `public_external` is not a
 * choice: visible to Capital Q participants is not public on the web.
 */

export const COMPANY_VISIBILITY_SET = QActionTypeSchema.parse(
  "company.visibility.set",
);

export const CompanyVisibilitySetPayloadSchema = z
  .object({
    companyId: UuidSchema,
    visibility: CompanyVisibilityChoiceSchema,
  })
  .strict();
export type CompanyVisibilitySetPayload = z.infer<
  typeof CompanyVisibilitySetPayloadSchema
>;

export const CompanyVisibilitySetResultSchema = z
  .object({
    companyId: UuidSchema,
    version: z.number().int(),
    visibility: z.string().min(1).max(64),
    marketplaceReadinessState: z.string().min(1).max(64),
  })
  .strict();
export type CompanyVisibilitySetResult = z.infer<
  typeof CompanyVisibilitySetResultSchema
>;

/**
 * What the person is agreeing to, in the Visibility screen's own terms,
 * readiness included: being visible and being recommended are separate,
 * and saying otherwise would be a promise the platform does not make.
 */
const DESCRIPTIONS: Readonly<
  Record<CompanyVisibilityChoice, { summary: string; preview: string }>
> = {
  network_visible: {
    summary: "Make your company visible to investors on Capital Q",
    preview:
      "Investors on Capital Q can find your company by name and read its profile. Everything else you have shared with Q stays private.\nBeing visible does not put you in investor recommendations on its own: the marketplace requirements on your visibility page decide that.",
  },
  organisation_private: {
    summary: "Make your company private to your organisation",
    preview:
      "Only people in your organisation can see your company. Investors can no longer find it, and Q will not mention it to them.\nIf it is currently in investor recommendations, it leaves them until you make it visible again.",
  },
};

/** The readiness said after the change, from the record the service returned. */
export function visibilityConfirmation(
  result: CompanyVisibilitySetResult,
): string {
  if (result.visibility === "network_visible") {
    return result.marketplaceReadinessState ===
      MARKETPLACE_READINESS_MARKETPLACE_READY
      ? "Done. Investors on Capital Q can now find your company, and it meets the marketplace requirements, so it can appear in their recommendations."
      : "Done. Investors on Capital Q can now find your company by name. It isn't in their recommendations yet: the marketplace requirements on your visibility page decide that, separately.";
  }
  return "Done. Your company is private to your organisation again; investors can't find it until you say otherwise.";
}

export function createCompanyVisibilitySetAction(dependencies: {
  readonly profiles: CompanyQueryPort;
  readonly service: CompanyService;
  readonly authorization: AuthorizationService;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  const { profiles, service, authorization, logger } = dependencies;
  return defineQAction<CompanyVisibilitySetPayload, CompanyVisibilitySetResult>(
    {
      actionType: COMPANY_VISIBILITY_SET,
      supersedes: true,
      version: 1,
      riskClass: "CONFIRM_REQUIRED",
      owner: "q-api",
      description:
        "Sets who can see the approver's own company — visible to investors on the network, or private to the organisation — exactly as approved, through the companies context's visibility command.",
      payload: CompanyVisibilitySetPayloadSchema,
      result: CompanyVisibilitySetResultSchema,
      targets: (payload): readonly QSubjectRef[] => [
        { kind: "COMPANY", companyId: payload.companyId },
      ],
      describe: (payload) => DESCRIPTIONS[payload.visibility],
      confirm: (_payload, result) => visibilityConfirmation(result),
      authorize: async (payload, actor) => {
        if (actor.actorType !== "HUMAN") {
          return { outcome: "DENY", code: "NOT_A_PERSON" };
        }
        const profile = await profiles.findCanonicalCompanyProfile(
          CompanyIdSchema.parse(payload.companyId),
        );
        // Absent, another tenant's and another organisation's are one
        // answer, so nothing about any company's existence leaks.
        if (
          profile === null ||
          profile.tenantId !== actor.tenantId ||
          actor.organisationId === undefined ||
          profile.organisationId !== actor.organisationId
        ) {
          return { outcome: "DENY", code: "NOT_AVAILABLE" };
        }
        const decision = await authorization.authorize({
          actor,
          capability: capability("company.edit"),
          resource: {
            kind: "RESOURCE",
            tenantId: profile.tenantId,
            organisationId: profile.organisationId,
            resourceType: "company",
            resourceId: profile.id,
          },
        });
        return decision.outcome === "ALLOW"
          ? { outcome: "ALLOW" }
          : { outcome: "DENY", code: "NOT_PERMITTED" };
      },
      executor: {
        execute: async (action, context) => {
          // The approver's own authority, as the gate just verified it —
          // membership included, which roles hang on; the companies
          // context checks it again.
          const actor = context.approver;
          const companyId = CompanyIdSchema.parse(action.payload.companyId);
          try {
            const current = await service.getCompany({ actor, companyId });
            const updated = await service.setCompanyVisibility({
              actor,
              companyId,
              input: SetCompanyVisibilityRequestSchema.parse({
                visibility: action.payload.visibility,
                expectedVersion: current.version,
              }),
              correlationId: context.correlationId,
            });
            return {
              outcome: "EXECUTED",
              result: {
                companyId: updated.id,
                version: updated.version,
                visibility: updated.marketplaceVisibility,
                marketplaceReadinessState: updated.marketplaceReadinessState,
              },
            };
          } catch (error: unknown) {
            logger?.warn(
              {
                err: error,
                actionId: action.actionId,
                attempt: context.attempt,
              },
              "company visibility change was not applied",
            );
            return {
              outcome: "FAILED",
              failureCode: "COMPANY_VISIBILITY_REFUSED",
              retryable: false,
            };
          }
        },
      },
    },
  );
}
