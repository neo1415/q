import { z } from "zod";

import type { PermittedContextPlan, QTaskClass } from "@capital-q/contracts";
import { CompanyIdSchema } from "@capital-q/companies";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { scopesOfKind } from "../plan.js";
import type { HandleClaimPort, QToolPorts } from "../ports.js";

/**
 * PROPOSE_HANDLE_CLAIM — `handle.claim.propose` v1 (BIZ-004).
 *
 * "Make me a Q card", "change our handle to kivu": the model reads the
 * handle the person asked for (or, when they asked for a card without
 * naming one, proposes one from the organisation's name) into the closed
 * shape below. Code decides whose organisation it is -- the company or
 * investor organisation the plan binds that belongs to the actor's own
 * organisation -- and hands it to the approval board. The person approves
 * the exact handle; the approved `handle.claim` runs through the same
 * command as the profile page.
 */
export const PROPOSE_HANDLE_CLAIM = "handle.claim.propose" as const;

export const ProposeHandleClaimInputSchema = z
  .object({
    profile: z
      .enum(["COMPANY", "INVESTOR_ORGANISATION"])
      .describe(
        "COMPANY for the person's own company, INVESTOR_ORGANISATION for their own investor organisation.",
      ),
    handle: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .describe(
        "The handle, without '@': 3-30 lowercase letters, digits or single hyphens. If they asked for a Q card without naming one, derive one from the organisation's name.",
      ),
  })
  .strict();
export type ProposeHandleClaimInput = z.infer<
  typeof ProposeHandleClaimInputSchema
>;

export const ProposeHandleClaimOutputSchema = z
  .object({
    status: z.enum(["PREPARED", "ONE_PER_TURN", "REFUSED"]),
    awaitingApprovalOf: z.string().nullable(),
    reason: z.string().max(400).nullable(),
  })
  .strict();
export type ProposeHandleClaimOutput = z.infer<
  typeof ProposeHandleClaimOutputSchema
>;

const PURPOSES: readonly QTaskClass[] = [
  "GENERAL_QUESTION",
  "OWN_COMPANY_QUESTION",
  "INVESTOR_QUESTION",
  "ACTION_PREPARATION",
];

type Grant = { readonly subjectId: string };

function boundIds(
  plan: PermittedContextPlan,
  kind: "COMPANY_PROFILE" | "INVESTOR_PROFILE",
): readonly string[] {
  const ids = new Set<string>();
  for (const scope of scopesOfKind(plan, kind)) {
    if (scope.subject === undefined) continue;
    const id =
      kind === "COMPANY_PROFILE"
        ? scope.filter.companyId
        : scope.filter.investorOrganisationId;
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}

export function createProposeHandleClaimTool(
  ports: QToolPorts,
  handles: HandleClaimPort,
): AnyQToolDefinition {
  return defineQTool<ProposeHandleClaimInput, ProposeHandleClaimOutput, Grant>({
    id: PROPOSE_HANDLE_CLAIM,
    version: 1,
    status: "ACTIVE",
    providerName: "propose_handle_claim",
    description:
      "Prepares the person's organisation's public handle -- the address of its Q Card, the shareable digital business card at /@handle -- for their approval, when they ask for a Q card or a handle, or to change it. Claiming a handle creates the Q Card. It changes nothing by itself: the person approves the exact handle. Result: PREPARED, ONE_PER_TURN, or REFUSED with the reason (reserved, taken, or the wrong shape).",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    // handle.manage is checked where it binds: by the action, at approval
    // and at execution.
    requiredCapabilities: [],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: ["COMPANY_PROFILE", "INVESTOR_PROFILE"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "WAITING_FOR_APPROVAL",
    input: ProposeHandleClaimInputSchema,
    output: ProposeHandleClaimOutputSchema,
    authorize: async (input, { actor, plan }) => {
      if (actor.actorType !== "HUMAN" || actor.organisationId === undefined) {
        return deny<Grant>("NOT_AVAILABLE");
      }
      const owned: string[] = [];
      if (input.profile === "COMPANY") {
        for (const id of boundIds(plan, "COMPANY_PROFILE")) {
          const profile = await ports.companies.findCanonicalCompanyProfile(
            CompanyIdSchema.parse(id),
          );
          if (
            profile !== null &&
            profile.tenantId === actor.tenantId &&
            profile.organisationId === actor.organisationId
          ) {
            owned.push(profile.id);
          }
        }
      } else {
        for (const id of boundIds(plan, "INVESTOR_PROFILE")) {
          const identity =
            await ports.investors.findCanonicalInvestorOrganisation(
              InvestorOrganisationIdSchema.parse(id),
            );
          if (
            identity !== null &&
            identity.tenantId === actor.tenantId &&
            identity.organisationId === actor.organisationId
          ) {
            owned.push(identity.id);
          }
        }
      }
      const [only] = owned;
      return owned.length === 1 && only !== undefined
        ? allow<Grant>("CONFIDENTIAL", { subjectId: only })
        : deny<Grant>("NOT_AVAILABLE");
    },
    execute: (input, context, grant) =>
      handles.prepareHandleClaim({
        runId: context.runId,
        tenantId: context.actor.tenantId,
        actorUserId: context.actor.userId,
        subjectType: input.profile,
        subjectId: grant.subjectId,
        handle: input.handle,
      }),
  });
}
