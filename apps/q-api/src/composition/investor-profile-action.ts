import { z } from "zod";

import {
  INVESTOR_EDITABLE_FIELDS,
  QActionTypeSchema,
  UpdateInvestorOrganisationRequestSchema,
  UuidSchema,
  type InvestorEditableField,
  type QSubjectRef,
} from "@capital-q/contracts";
import {
  InvestorOrganisationIdSchema,
  type InvestorService,
} from "@capital-q/investors";
import type { Logger } from "@capital-q/observability";
import { defineQAction, type AnyQActionDefinition } from "@capital-q/q-actions";
import { capability, type AuthorizationService } from "@capital-q/security";
import { savedReadsLine } from "./saved-line.js";

/**
 * A change to the approver's own investor organisation profile (BIZ-002).
 *
 * The investor twin of `company.profile.update`: the model reads what the
 * person asked into the closed shape below, the Approval Engine binds the
 * exact payload, and the approved change executes through the investors
 * context's own `updateInvestorOrganisation` -- the command the profile
 * page's `PATCH /v1/investors/:id` calls -- under the approver's authority.
 * One write path, two front doors. Verification state, visibility and
 * anything mandate-shaped are not reachable from here.
 */

export const INVESTOR_PROFILE_UPDATE = QActionTypeSchema.parse(
  "investor.profile.update",
);

const { expectedVersion: _expectedVersion, ...editableShape } =
  UpdateInvestorOrganisationRequestSchema.shape;
const ChangesSchema = z
  .object(editableShape)
  .strict()
  .refine(
    (value) =>
      INVESTOR_EDITABLE_FIELDS.some((field) => value[field] !== undefined),
    { message: "expected at least one field to change" },
  );

export const InvestorProfileUpdatePayloadSchema = z
  .object({
    investorOrganisationId: UuidSchema,
    changes: ChangesSchema,
  })
  .strict();
export type InvestorProfileUpdatePayload = z.infer<
  typeof InvestorProfileUpdatePayloadSchema
>;

export const InvestorProfileUpdateResultSchema = z
  .object({
    investorOrganisationId: UuidSchema,
    version: z.number().int(),
    fields: z.array(z.enum(INVESTOR_EDITABLE_FIELDS)),
  })
  .strict();
export type InvestorProfileUpdateResult = z.infer<
  typeof InvestorProfileUpdateResultSchema
>;

export const INVESTOR_FIELD_LABELS: Readonly<
  Record<InvestorEditableField, string>
> = {
  investorType: "Investor type",
  displayName: "Name",
  websiteUrl: "Website",
  hqCountry: "Country",
  publicDescription: "Description",
  deploymentState: "Deploying capital",
  inboundPreference: "How founders can reach you",
};

function changedFields(
  changes: InvestorProfileUpdatePayload["changes"],
): InvestorEditableField[] {
  return INVESTOR_EDITABLE_FIELDS.filter(
    (field) => changes[field] !== undefined,
  );
}

export function describeInvestorProfileChanges(
  changes: InvestorProfileUpdatePayload["changes"],
): {
  readonly summary: string;
  readonly preview: string;
} {
  const lines = changedFields(changes).map((field) => {
    const value = changes[field];
    return value === null || value === undefined
      ? `${INVESTOR_FIELD_LABELS[field]}: cleared`
      : `${INVESTOR_FIELD_LABELS[field]}: ${value}`;
  });
  const brief = lines
    .map((line) => (line.length > 120 ? `${line.slice(0, 117)}…` : line))
    .join("; ");
  return {
    summary: `Update your investor profile. ${brief}`.slice(0, 1000),
    preview: lines.join("\n").slice(0, 4000),
  };
}

export type InvestorProfileUpdateActionDependencies = {
  readonly investors: InvestorService;
  readonly authorization: AuthorizationService;
  readonly logger?: Logger | undefined;
};

export function createInvestorProfileUpdateAction(
  dependencies: InvestorProfileUpdateActionDependencies,
): AnyQActionDefinition {
  const { investors, authorization, logger } = dependencies;
  return defineQAction<
    InvestorProfileUpdatePayload,
    InvestorProfileUpdateResult
  >({
    actionType: INVESTOR_PROFILE_UPDATE,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Changes declared fields of the approver's own investor organisation profile, exactly as approved.",
    payload: InvestorProfileUpdatePayloadSchema,
    result: InvestorProfileUpdateResultSchema,
    targets: (payload): readonly QSubjectRef[] => [
      {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: payload.investorOrganisationId,
      },
    ],
    describe: (payload) => describeInvestorProfileChanges(payload.changes),
    confirm: (payload) =>
      savedReadsLine(
        "Your investor profile",
        describeInvestorProfileChanges(payload.changes).preview,
      ),
    authorize: async (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return { outcome: "DENY", code: "NOT_A_PERSON" };
      }
      if (actor.organisationId === undefined) {
        return { outcome: "DENY", code: "NOT_AVAILABLE" };
      }
      const investorOrganisationId = InvestorOrganisationIdSchema.parse(
        payload.investorOrganisationId,
      );
      try {
        // The investors context's own read: absent, another tenant's and
        // another organisation's are one "not found".
        await investors.getInvestorOrganisation({
          actor,
          investorOrganisationId,
        });
      } catch {
        return { outcome: "DENY", code: "NOT_AVAILABLE" };
      }
      const decision = await authorization.authorize({
        actor,
        capability: capability("investor.edit"),
        resource: {
          kind: "RESOURCE",
          tenantId: actor.tenantId,
          organisationId: actor.organisationId,
          resourceType: "investor_organisation",
          resourceId: investorOrganisationId,
        },
      });
      return decision.outcome === "ALLOW"
        ? { outcome: "ALLOW" }
        : { outcome: "DENY", code: "NOT_PERMITTED" };
    },
    executor: {
      execute: async (action, context) => {
        const actor = context.approver;
        const investorOrganisationId = InvestorOrganisationIdSchema.parse(
          action.payload.investorOrganisationId,
        );
        try {
          const current = await investors.getInvestorOrganisation({
            actor,
            investorOrganisationId,
          });
          const updated = await investors.updateInvestorOrganisation({
            actor,
            investorOrganisationId,
            input: UpdateInvestorOrganisationRequestSchema.parse({
              expectedVersion: current.version,
              ...action.payload.changes,
            }),
            correlationId: context.correlationId,
          });
          return {
            outcome: "EXECUTED",
            result: {
              investorOrganisationId: updated.id,
              version: updated.version,
              fields: changedFields(action.payload.changes),
            },
          };
        } catch (error: unknown) {
          logger?.warn(
            {
              err: error,
              actionId: action.actionId,
              attempt: context.attempt,
            },
            "investor profile update was not applied",
          );
          return {
            outcome: "FAILED",
            failureCode: "INVESTOR_UPDATE_REFUSED",
            retryable: false,
          };
        }
      },
    },
  });
}
