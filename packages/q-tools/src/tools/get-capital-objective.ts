import { z } from "zod";

import {
  CapitalObjectiveIdSchema,
  type CapitalObjectiveSnapshot,
} from "@capital-q/capital";
import { CompanyIdSchema, type CompanyIdentity } from "@capital-q/companies";
import {
  CapitalObjectiveStatusSchema,
  CapitalObjectiveTypeSchema,
  CapitalTargetSchema,
  UuidSchema,
} from "@capital-q/contracts";
import { actorPrincipal } from "@capital-q/permissions";
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
 * GET_CAPITAL_OBJECTIVE — `capital_objective.get` v1 (doc 12 §28.1
 * `getCapitalObjective`; packet §40-§44).
 *
 * The company's CURRENT capital objective — or the fact that there is
 * none — through the plan's COMPANY_CAPITAL_OBJECTIVE scope for that
 * company. The owning side must hold `capital_objective.view`; anyone
 * else must be granted view by disclosure on the objective itself. Money
 * travels as the exact decimal string and ISO currency the domain stores.
 * No use-of-funds narrative, no history, no financial model: the raise is
 * structured state (doc 13), founder-private by default.
 */

export const GET_CAPITAL_OBJECTIVE = "capital_objective.get" as const;

export const GetCapitalObjectiveInputSchema = z
  .object({
    companyId: UuidSchema.describe(
      "The canonical company identifier (UUID), as given in the conversation context.",
    ),
  })
  .strict();
export type GetCapitalObjectiveInput = z.infer<
  typeof GetCapitalObjectiveInputSchema
>;

export const GetCapitalObjectiveOutputSchema = z
  .object({
    companyId: UuidSchema,
    /** Null means the company has no current objective — unknown stays unknown. */
    objective: z
      .object({
        capitalObjectiveId: UuidSchema,
        objectiveType: CapitalObjectiveTypeSchema,
        status: CapitalObjectiveStatusSchema,
        target: CapitalTargetSchema,
        targetStage: z.string().nullable(),
        instrumentCode: z.string().nullable(),
        targetCloseDate: z.string().nullable(),
        startedAt: z.string(),
        truthClass: z.literal("USER_CLAIM"),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type GetCapitalObjectiveOutput = z.infer<
  typeof GetCapitalObjectiveOutputSchema
>;

type Grant = {
  readonly company: CompanyIdentity;
  readonly snapshot: CapitalObjectiveSnapshot | null;
};

export function createGetCapitalObjectiveTool(
  ports: QToolPorts,
): AnyQToolDefinition {
  return defineQTool<
    GetCapitalObjectiveInput,
    GetCapitalObjectiveOutput,
    Grant
  >({
    id: GET_CAPITAL_OBJECTIVE,
    version: 1,
    status: "ACTIVE",
    providerName: "get_capital_objective",
    description:
      "Returns a company's current capital objective (raise type, target amount and currency, target stage, instrument, target close date, status), or null when the company has none, when it is available in this conversation. Call it when the answer depends on how much the company is raising.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [capability("capital_objective.view")],
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "RELATIONSHIP_QUESTION",
      "COMPARISON",
    ],
    requiredScopeKinds: ["COMPANY_CAPITAL_OBJECTIVE"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_COMPANY",
    input: GetCapitalObjectiveInputSchema,
    output: GetCapitalObjectiveOutputSchema,
    authorize: async (input, context) => {
      const { actor, plan } = context;
      const companyId = CompanyIdSchema.parse(input.companyId);
      const bound = boundScopeFor(
        plan,
        "COMPANY_CAPITAL_OBJECTIVE",
        (filter) => filter.companyId === companyId,
      );
      if (bound === undefined) {
        return deny("NOT_AVAILABLE");
      }
      const company = await ports.companies.findCanonicalCompany(companyId);
      if (company === null) {
        return deny("NOT_AVAILABLE");
      }
      const snapshot = await ports.capital.getCurrentForCompany(
        company.tenantId,
        company.id,
      );
      const owner =
        actor.organisationId !== undefined &&
        actor.tenantId === company.tenantId &&
        actor.organisationId === company.organisationId;
      if (owner) {
        const decision = await ports.authorization.authorize({
          actor,
          capability: capability("capital_objective.view"),
          resource: {
            kind: "RESOURCE",
            tenantId: company.tenantId,
            organisationId: company.organisationId,
            resourceType: "capital_objective",
            resourceId: snapshot?.id ?? company.id,
          },
        });
        return decision.outcome === "ALLOW"
          ? allow(bound.sensitivity, { company, snapshot })
          : deny("NOT_AVAILABLE");
      }
      // A non-owner learns nothing about an objective that does not exist.
      if (snapshot === null) {
        return deny("NOT_AVAILABLE");
      }
      const disclosed = await ports.disclosure.canDisclose({
        principal: actorPrincipal(actor),
        resource: {
          type: "capital_objective",
          id: CapitalObjectiveIdSchema.parse(snapshot.id),
        },
        requestedAccess: "view",
      });
      return disclosed.outcome === "ALLOW"
        ? allow(bound.sensitivity, { company, snapshot })
        : deny("NOT_AVAILABLE");
    },
    execute: (_input, _context, grant) =>
      Promise.resolve({
        companyId: grant.company.id,
        objective:
          grant.snapshot === null
            ? null
            : {
                capitalObjectiveId: grant.snapshot.id,
                objectiveType: grant.snapshot.objectiveType,
                status: grant.snapshot.status,
                target: grant.snapshot.target,
                targetStage: grant.snapshot.targetStage,
                instrumentCode: grant.snapshot.instrumentCode,
                targetCloseDate: grant.snapshot.targetCloseDate,
                startedAt: grant.snapshot.startedAt,
                truthClass: "USER_CLAIM",
              },
      }),
  });
}
