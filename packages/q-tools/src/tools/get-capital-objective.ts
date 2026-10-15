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
  CompanyRaiseViewSchema,
  UuidSchema,
  type QSensitivityClass,
} from "@capital-q/contracts";
import { actorPrincipal } from "@capital-q/permissions";
import { capability } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope, boundScopeFor } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * GET_CAPITAL_OBJECTIVE — `capital_objective.get` v1 (doc 12 §28.1
 * `getCapitalObjective`; packet §40-§44).
 *
 * The company's CURRENT capital objective — or the fact that there is
 * none, or that it is not shared with this person. The owning side must
 * hold `capital_objective.view`; anyone else must be able to see the
 * company (the plan bound it, or the actor-wide network scope and the
 * disclosure engine admit it) and be granted view by disclosure on the
 * objective itself (R35: network_visible, or relationship_shared to their
 * relationship). Private and absent are one answer to a non-owner. Money
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
    /**
     * CURRENT: the objective below. NONE: their own company has no current
     * objective -- unknown stays unknown, never "not raising".
     * NOT_SHARED_WITH_YOU: the company has not shared a raise with this
     * person (private, or none: the two are one answer to a non-owner, so
     * a private raise's existence never leaks). Never "unknown".
     */
    availability: z.enum(["CURRENT", "NONE", "NOT_SHARED_WITH_YOU"]),
    /** Null unless availability is CURRENT. */
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
    /**
     * R2: the raise as this person sees it on every surface (`raiseFor`):
     * the Discover card and the profile say exactly this. PITCH_CLAIM is
     * the company's own words in a pitch they may play, where nothing is
     * disclosed to them. Absent where the deployment composes no reader.
     */
    raise: CompanyRaiseViewSchema.optional(),
  })
  .strict();
export type GetCapitalObjectiveOutput = z.infer<
  typeof GetCapitalObjectiveOutputSchema
>;

type Grant = {
  readonly company: CompanyIdentity;
  /** Null with `shared` false: nothing shared with this person. */
  readonly snapshot: CapitalObjectiveSnapshot | null;
  readonly shared: boolean;
};

function sensitivityOf(reasonCode: string): QSensitivityClass {
  return reasonCode === "PUBLIC_EXTERNAL"
    ? "PUBLIC"
    : reasonCode === "NETWORK_VISIBLE"
      ? "NETWORK_VISIBLE"
      : "CONFIDENTIAL";
}

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
      "Returns a company's current raise -- type, target amount and currency, target stage, instrument, target close date, status -- as far as the company has shared it with this person. Call it whenever the answer depends on how much a company is raising or on what terms, including for each company in a comparison. availability NOT_SHARED_WITH_YOU means the company has not shared its raise with them: say exactly that, never that it is unknown and never guess an amount -- unless raise.source is PITCH_CLAIM: then no raise is disclosed to them, but the company's own pitch video says the amount in raise.money; say it as what they say in their pitch (e.g. 'in their pitch they say they are raising $4M'), never as a disclosed, confirmed or verified figure. NONE (their own company only) means no current raise is recorded.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [capability("capital_objective.view")],
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "RELATIONSHIP_QUESTION",
      "COMPARISON",
      "ACTION_PREPARATION",
      "GENERAL_QUESTION",
    ],
    // The plan's capital scope for a named company, or the actor-wide
    // network scope for a company reached from their own records or the
    // feed; the disclosure engine decides the objective either way.
    requiredScopeKinds: ["COMPANY_CAPITAL_OBJECTIVE", "NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_COMPANY",
    input: GetCapitalObjectiveInputSchema,
    output: GetCapitalObjectiveOutputSchema,
    authorize: async (input, context) => {
      const { actor, plan } = context;
      const companyId = CompanyIdSchema.parse(input.companyId);
      const company = await ports.companies.findCanonicalCompany(companyId);
      if (company === null) {
        return deny("NOT_AVAILABLE");
      }
      const bound = boundScopeFor(
        plan,
        "COMPANY_CAPITAL_OBJECTIVE",
        (filter) => filter.companyId === companyId,
      );
      const snapshot = await ports.capital.getCurrentForCompany(
        company.tenantId,
        company.id,
      );
      const owner =
        actor.organisationId !== undefined &&
        actor.tenantId === company.tenantId &&
        actor.organisationId === company.organisationId;
      if (owner) {
        // Their own raise: the owning side's capability decides, whether
        // or not the firewall found an objective to bind.
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
          ? allow(bound?.sensitivity ?? "CONFIDENTIAL", {
              company,
              snapshot,
              shared: true,
            })
          : deny("NOT_AVAILABLE");
      }
      /**
       * Someone else's company. First, may they see the company at all?
       * Named in this run: only if the firewall bound its profile or its
       * capital. Otherwise: only under the actor-wide network scope, and
       * only if the disclosure engine shows them the company. A company
       * they may not see is NOT_AVAILABLE -- not even "not shared".
       */
      const named = plan.subjects.some(
        (subject) =>
          subject.kind === "COMPANY" && subject.companyId === company.id,
      );
      const profileBound =
        boundScopeFor(
          plan,
          "COMPANY_PROFILE",
          (filter) => filter.companyId === company.id,
        ) !== undefined;
      const principal = actorPrincipal(actor);
      if (!profileBound) {
        if (
          bound === undefined &&
          (named || actorWideScope(plan, "NETWORK_VISIBLE_DATA") === undefined)
        ) {
          return deny("NOT_AVAILABLE");
        }
        const visible = await ports.disclosure.canDisclose({
          principal,
          resource: { type: "company", id: company.id },
          requestedAccess: "view",
        });
        if (visible.outcome !== "ALLOW") {
          return deny("NOT_AVAILABLE");
        }
      }
      // Then the raise itself: the disclosure engine's answer on the
      // objective (network_visible, or relationship_shared to their
      // relationship), the same rule the company's audience preview uses.
      // Anything else, including no objective, is one answer.
      if (snapshot === null) {
        return allow("NETWORK_VISIBLE", {
          company,
          snapshot: null,
          shared: false,
        });
      }
      const disclosed = await ports.disclosure.canDisclose({
        principal,
        resource: {
          type: "capital_objective",
          id: CapitalObjectiveIdSchema.parse(snapshot.id),
        },
        requestedAccess: "view",
      });
      return disclosed.outcome === "ALLOW"
        ? allow(bound?.sensitivity ?? sensitivityOf(disclosed.reasonCode), {
            company,
            snapshot,
            shared: true,
          })
        : allow("NETWORK_VISIBLE", { company, snapshot: null, shared: false });
    },
    execute: async (_input, context, grant) => {
      // The one raise read, for the reader authorize already admitted.
      // A failed read says nothing more than the objective's own answer.
      const raise =
        ports.companyRaise === undefined
          ? undefined
          : await ports.companyRaise
              .raiseFor(context.actor, grant.company.id)
              .catch(() => undefined);
      return {
        ...(raise === undefined ? {} : { raise }),
        companyId: grant.company.id,
        availability: !grant.shared
          ? "NOT_SHARED_WITH_YOU"
          : grant.snapshot === null
            ? "NONE"
            : "CURRENT",
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
      };
    },
  });
}
