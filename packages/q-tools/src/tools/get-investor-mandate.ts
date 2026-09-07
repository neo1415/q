import { z } from "zod";

import {
  DiscoveryModeSchema,
  InvestorMandateStatusSchema,
  MandateConstraintDimensionSchema,
  MandateConstraintOperatorSchema,
  MandateConstraintValueSchema,
  MandatePreferenceClassSchema,
  UuidSchema,
} from "@capital-q/contracts";
import {
  InvestorMandateIdSchema,
  InvestorOrganisationIdSchema,
  type InvestorMandateSnapshot,
  type InvestorOrganisationIdentity,
} from "@capital-q/investors";
import { capability } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { boundScopeFor } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * GET_INVESTOR_MANDATE — `investor_mandate.get` v1 (doc 12 §28.1
 * `getInvestorMandate`; packet §45-§49).
 *
 * The DECLARED mandate(s) of the actor's own investor organisation,
 * through the plan's INVESTOR_MANDATE scope, for a holder of
 * `investor.mandate.view`. Owner only: the scope catalogue names no
 * disclosure path for a mandate (doc 15 §23; CQ-Q-004), so a founder, a
 * counterparty or a network member is refused with the same answer as
 * for a mandate that does not exist. The raw mandate narrative is never
 * part of the snapshot this reads; what returns is typed policy —
 * cheque range, stages, constraints with their automated-use flag,
 * taxonomy preferences — as the investor declared it. Declared mandate
 * ≠ observed behaviour ≠ Q inference: nothing here is inferred.
 */

export const GET_INVESTOR_MANDATE = "investor_mandate.get" as const;

const MANDATES_MAX = 5;

export const GetInvestorMandateInputSchema = z
  .object({
    investorOrganisationId: UuidSchema.describe(
      "The canonical investor organisation identifier (UUID), as given in the conversation context.",
    ),
    mandateId: UuidSchema.optional().describe(
      "One mandate to return; omit for the organisation's active mandates.",
    ),
  })
  .strict();
export type GetInvestorMandateInput = z.infer<
  typeof GetInvestorMandateInputSchema
>;

const MandateProjectionSchema = z
  .object({
    mandateId: UuidSchema,
    status: InvestorMandateStatusSchema,
    version: z.number().int().min(1),
    discoveryMode: DiscoveryModeSchema.nullable(),
    cheque: z
      .object({
        currency: z.string(),
        min: z.string().optional(),
        typical: z.string().optional(),
        max: z.string().optional(),
      })
      .strict()
      .nullable(),
    stage: z
      .object({
        minStageCode: z.string().nullable(),
        maxStageCode: z.string().nullable(),
      })
      .strict(),
    constraints: z
      .array(
        z
          .object({
            dimension: MandateConstraintDimensionSchema,
            operator: MandateConstraintOperatorSchema,
            value: MandateConstraintValueSchema,
            importance: MandatePreferenceClassSchema,
            isHardExclusion: z.boolean(),
            /** MANUAL_ONLY constraints are never applied by automated discovery. */
            automatedUse: z.enum(["ELIGIBLE", "MANUAL_ONLY"]),
          })
          .strict(),
      )
      .max(200),
    taxonomyPreferences: z
      .array(
        z
          .object({
            vocabularyCode: z.string(),
            canonicalCode: z.string(),
            preferenceStrength: MandatePreferenceClassSchema,
            isExclusion: z.boolean(),
          })
          .strict(),
      )
      .max(200),
    truthClass: z.literal("USER_CLAIM"),
  })
  .strict();

export const GetInvestorMandateOutputSchema = z
  .object({
    investorOrganisationId: UuidSchema,
    displayName: z.string(),
    mandates: z.array(MandateProjectionSchema).max(MANDATES_MAX),
    /** True when more active mandates exist than were returned. */
    truncated: z.boolean(),
  })
  .strict();
export type GetInvestorMandateOutput = z.infer<
  typeof GetInvestorMandateOutputSchema
>;

type Grant = { readonly organisation: InvestorOrganisationIdentity };

function project(
  snapshot: InvestorMandateSnapshot,
): z.infer<typeof MandateProjectionSchema> {
  return {
    mandateId: snapshot.mandateId,
    status: snapshot.status,
    version: snapshot.version,
    discoveryMode: snapshot.discoveryMode,
    cheque:
      snapshot.cheque === null
        ? null
        : {
            currency: snapshot.cheque.currency,
            ...(snapshot.cheque.min === undefined
              ? {}
              : { min: snapshot.cheque.min }),
            ...(snapshot.cheque.typical === undefined
              ? {}
              : { typical: snapshot.cheque.typical }),
            ...(snapshot.cheque.max === undefined
              ? {}
              : { max: snapshot.cheque.max }),
          },
    stage: snapshot.stage,
    constraints: snapshot.constraints.map((constraint) => ({
      dimension: constraint.dimension,
      operator: constraint.operator,
      value: constraint.value,
      importance: constraint.importance,
      isHardExclusion: constraint.isHardExclusion,
      automatedUse: constraint.automatedUse,
    })),
    taxonomyPreferences: snapshot.taxonomyPreferences.map((preference) => ({
      vocabularyCode: preference.vocabularyCode,
      canonicalCode: preference.canonicalCode,
      preferenceStrength: preference.preferenceStrength,
      isExclusion: preference.isExclusion,
    })),
    truthClass: "USER_CLAIM",
  };
}

export function createGetInvestorMandateTool(
  ports: QToolPorts,
): AnyQToolDefinition {
  return defineQTool<GetInvestorMandateInput, GetInvestorMandateOutput, Grant>({
    id: GET_INVESTOR_MANDATE,
    version: 1,
    status: "ACTIVE",
    providerName: "get_investor_mandate",
    description:
      "Returns the declared investment mandate(s) of an investor organisation — cheque range, stages, constraints and taxonomy preferences — when they are available in this conversation (only the investor's own organisation can read its mandates). Call it when the answer depends on declared investment criteria.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [capability("investor.mandate.view")],
    supportedPurposes: [
      "INVESTOR_QUESTION",
      "RELATIONSHIP_QUESTION",
      "COMPARISON",
    ],
    requiredScopeKinds: ["INVESTOR_MANDATE"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_INVESTOR_CRITERIA",
    input: GetInvestorMandateInputSchema,
    output: GetInvestorMandateOutputSchema,
    authorize: async (input, context) => {
      const { actor, plan } = context;
      const investorOrganisationId = InvestorOrganisationIdSchema.parse(
        input.investorOrganisationId,
      );
      const bound = boundScopeFor(
        plan,
        "INVESTOR_MANDATE",
        (filter) => filter.investorOrganisationId === investorOrganisationId,
      );
      if (bound === undefined) {
        return deny("NOT_AVAILABLE");
      }
      const organisation =
        await ports.investors.findCanonicalInvestorOrganisation(
          investorOrganisationId,
        );
      if (organisation === null) {
        return deny("NOT_AVAILABLE");
      }
      const owner =
        actor.organisationId !== undefined &&
        actor.tenantId === organisation.tenantId &&
        actor.organisationId === organisation.organisationId;
      if (!owner) {
        // Investor-private: no shared path exists for a mandate.
        return deny("NOT_AVAILABLE");
      }
      const decision = await ports.authorization.authorize({
        actor,
        capability: capability("investor.mandate.view"),
        resource: {
          kind: "RESOURCE",
          tenantId: organisation.tenantId,
          organisationId: organisation.organisationId,
          resourceType: "investor_organisation",
          resourceId: organisation.id,
        },
      });
      return decision.outcome === "ALLOW"
        ? allow(bound.sensitivity, { organisation })
        : deny("NOT_AVAILABLE");
    },
    execute: async (input, _context, grant) => {
      const { organisation } = grant;
      if (input.mandateId !== undefined) {
        const one = await ports.mandates.getMandate(
          organisation.tenantId,
          organisation.id,
          InvestorMandateIdSchema.parse(input.mandateId),
        );
        return {
          investorOrganisationId: organisation.id,
          displayName: organisation.displayName,
          mandates: one === null ? [] : [project(one)],
          truncated: false,
        };
      }
      const summaries = await ports.mandates.listActiveMandates(
        organisation.tenantId,
        organisation.id,
      );
      const snapshots = await Promise.all(
        summaries
          .slice(0, MANDATES_MAX)
          .map((summary) =>
            ports.mandates.getMandate(
              organisation.tenantId,
              organisation.id,
              summary.id,
            ),
          ),
      );
      return {
        investorOrganisationId: organisation.id,
        displayName: organisation.displayName,
        mandates: snapshots
          .filter(
            (snapshot): snapshot is InvestorMandateSnapshot =>
              snapshot !== null,
          )
          .map(project),
        truncated: summaries.length > MANDATES_MAX,
      };
    },
  });
}
