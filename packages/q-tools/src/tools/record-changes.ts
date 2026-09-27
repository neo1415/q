import { z } from "zod";

import {
  CAPITAL_OBJECTIVE_CLOSURE_REASONS,
  COMPANY_RELATIONSHIP_TYPES,
  DISCOVERY_MODES,
  QCardFieldSchema,
  QCardScopeSchema,
  type PermittedContextPlan,
  type QTaskClass,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  QToolArgumentError,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QToolPorts, RecordChange, RecordChangePort } from "../ports.js";
import { ownSubject } from "./q-card.js";

/**
 * R33: the app's own record forms, as Q changes (Prepare → Approve). Each
 * tool resolves WHOSE record from the actor and the plan (their own
 * company or investor organisation, bound in this run), never from the
 * model; the composition checks the fields against the route's own
 * request schema and holds the change for the person's approval, and the
 * Approval Engine authorises again at approval and at execution, where the
 * owning context's own service writes it. Nothing changes here.
 */

export const PROPOSE_RAISE_CHANGE = "capital.objective.propose" as const;
export const PROPOSE_MANDATE_CHANGE = "investor.mandate.propose" as const;
export const PROPOSE_TEAM_CHANGE = "team.propose" as const;
export const PROPOSE_Q_CARD_CHANGE = "q_card.propose" as const;
export const PROPOSE_INVESTOR_VISIBILITY =
  "investor.visibility.propose" as const;

const PURPOSES: readonly QTaskClass[] = [
  "GENERAL_QUESTION",
  "OWN_COMPANY_QUESTION",
  "INVESTOR_QUESTION",
  "ACTION_PREPARATION",
];

export const ProposeRecordChangeOutputSchema = z
  .object({
    status: z.enum(["PREPARED", "ONE_PER_TURN", "REFUSED"]),
    awaitingApprovalOf: z.string().max(400).nullable(),
    reason: z.string().max(400).nullable(),
  })
  .strict();
export type ProposeRecordChangeOutput = z.infer<
  typeof ProposeRecordChangeOutputSchema
>;

type Grant = { readonly subjectId: string };

function ownConversation(
  actor: ActorContext,
  plan: PermittedContextPlan,
): boolean {
  if (actor.actorType !== "HUMAN") return false;
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

/** Only defined values: an absent field is not a change. */
function defined(
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}

const COMMON = {
  version: 1,
  status: "ACTIVE",
  classification: "SIDE_EFFECT",
  riskClass: "LOW_RISK_INTERNAL",
  // Bound where it matters: the action's authorize step at approval and
  // execution, with the owning service's own capability check.
  requiredCapabilities: [],
  supportedPurposes: [...PURPOSES],
  approval: "NONE",
  idempotency: "SAFE_TO_REPEAT",
  owner: "q-tools",
  visibleStage: "WAITING_FOR_APPROVAL",
  output: ProposeRecordChangeOutputSchema,
} as const;

const RESULT_NOTE =
  "It changes nothing by itself: they see exactly what will change and approve or decline it. Result: PREPARED, ONE_PER_TURN, or REFUSED with the reason.";

function subjectAuthorizer(
  ports: Pick<QToolPorts, "companies" | "investors">,
  kind: "COMPANY" | "INVESTOR_ORGANISATION",
) {
  return async (
    _input: unknown,
    { actor, plan }: { actor: ActorContext; plan: PermittedContextPlan },
  ) => {
    if (!ownConversation(actor, plan)) return deny<Grant>("NOT_AVAILABLE");
    const subjectId = await ownSubject(ports, actor, plan, kind);
    return subjectId === null
      ? deny<Grant>("NOT_AVAILABLE")
      : allow<Grant>("CONFIDENTIAL", { subjectId });
  };
}

function prepareWith(port: RecordChangePort) {
  return async (
    change: RecordChange,
    context: { actor: ActorContext; runId: string },
  ): Promise<ProposeRecordChangeOutput> => {
    const result = await port.prepare({
      runId: context.runId,
      actor: context.actor,
      change,
    });
    return {
      status: result.status,
      awaitingApprovalOf: result.awaitingApprovalOf,
      reason: result.reason,
    };
  };
}

// --- the raise ------------------------------------------------------------

const TargetSchema = z
  .object({
    amount: z
      .string()
      .max(32)
      .describe("A positive decimal amount, as digits (e.g. 1500000)."),
    currency: z.string().max(3).describe("ISO 4217 code, e.g. USD, GBP, NGN."),
  })
  .strict();

export const ProposeRaiseChangeInputSchema = z
  .object({
    operation: z
      .enum(["CREATE", "UPDATE", "CLOSE", "REPLACE"])
      .describe(
        "CREATE a raise when they have none; UPDATE the current one's fields; CLOSE it (with closureReason); REPLACE it with a deliberately new raise.",
      ),
    target: TargetSchema.optional(),
    targetStage: z
      .string()
      .max(64)
      .optional()
      .describe("lower_snake_case stage code, e.g. seed, series_a."),
    instrumentCode: z
      .string()
      .max(64)
      .optional()
      .describe("lower_snake_case instrument code, e.g. safe, equity."),
    targetCloseDate: z.string().max(10).optional().describe("YYYY-MM-DD"),
    useOfFundsSummary: z.string().max(2000).optional(),
    closureReason: z.enum(CAPITAL_OBJECTIVE_CLOSURE_REASONS).optional(),
  })
  .strict();
export type ProposeRaiseChangeInput = z.infer<
  typeof ProposeRaiseChangeInputSchema
>;

export function createProposeRaiseChangeTool(
  ports: Pick<QToolPorts, "companies" | "investors">,
  port: RecordChangePort,
): AnyQToolDefinition {
  const prepare = prepareWith(port);
  return defineQTool<ProposeRaiseChangeInput, ProposeRecordChangeOutput, Grant>(
    {
      ...COMMON,
      id: PROPOSE_RAISE_CHANGE,
      supportedPurposes: [
        "OWN_COMPANY_QUESTION",
        "ACTION_PREPARATION",
        "GENERAL_QUESTION",
      ],
      providerName: "propose_raise_change",
      description: `Prepares a change to their own company's raise (capital objective), exactly as the Capital page's form makes it: create one, update target (amount + currency), targetStage, instrumentCode, targetCloseDate or useOfFundsSummary, close it with a closureReason (ACHIEVED, CLOSED_BY_FOUNDER, DISCONTINUED), or replace it with a new raise. ${RESULT_NOTE}`,
      requiredScopeKinds: ["COMPANY_PROFILE"],
      input: ProposeRaiseChangeInputSchema,
      authorize: subjectAuthorizer(ports, "COMPANY"),
      execute: (input, context, grant) => {
        const { operation, closureReason, ...fields } = input;
        if (operation === "CLOSE" && closureReason === undefined) {
          throw new QToolArgumentError(
            "Closing a raise needs a closureReason.",
          );
        }
        return prepare(
          {
            kind: "CAPITAL_OBJECTIVE",
            companyId: grant.subjectId,
            operation,
            fields:
              operation === "CLOSE"
                ? { reason: closureReason }
                : defined(fields),
          },
          context,
        );
      },
    },
  );
}

// --- the mandate ----------------------------------------------------------

export const ProposeMandateChangeInputSchema = z
  .object({
    operation: z
      .enum(["CREATE", "UPDATE", "ACTIVATE", "CLOSE"])
      .describe(
        "CREATE a new mandate (needs name); UPDATE fields; ACTIVATE it so their feed uses it; CLOSE it.",
      ),
    mandateId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Which mandate, exactly as a tool gave it. Omit for their current one.",
      ),
    name: z.string().max(120).optional(),
    discoveryMode: z.enum(DISCOVERY_MODES).optional(),
    chequeRange: z
      .object({
        currency: z.string().max(3),
        min: z.string().max(32).optional(),
        typical: z.string().max(32).optional(),
        max: z.string().max(32).optional(),
      })
      .strict()
      .optional()
      .describe("Cheque sizes as decimal strings in one ISO currency."),
    minStageCode: z.string().max(64).optional(),
    maxStageCode: z.string().max(64).optional(),
    rawMandateText: z
      .string()
      .max(8000)
      .optional()
      .describe("Their mandate in their own words."),
  })
  .strict();
export type ProposeMandateChangeInput = z.infer<
  typeof ProposeMandateChangeInputSchema
>;

export function createProposeMandateChangeTool(
  ports: Pick<QToolPorts, "companies" | "investors">,
  port: RecordChangePort,
): AnyQToolDefinition {
  const prepare = prepareWith(port);
  return defineQTool<
    ProposeMandateChangeInput,
    ProposeRecordChangeOutput,
    Grant
  >({
    ...COMMON,
    id: PROPOSE_MANDATE_CHANGE,
    supportedPurposes: [
      "INVESTOR_QUESTION",
      "ACTION_PREPARATION",
      "GENERAL_QUESTION",
    ],
    providerName: "propose_mandate_change",
    description: `Prepares a change to their own investor organisation's mandate, as the mandate form makes it: create one, update name, discoveryMode, chequeRange, minStageCode, maxStageCode or rawMandateText, activate it, or close it. Sector and constraint preferences stay on the mandate form: offer to open their profile for those. ${RESULT_NOTE}`,
    requiredScopeKinds: ["INVESTOR_PROFILE", "INVESTOR_MANDATE"],
    input: ProposeMandateChangeInputSchema,
    authorize: subjectAuthorizer(ports, "INVESTOR_ORGANISATION"),
    execute: (input, context, grant) => {
      const { operation, mandateId, ...fields } = input;
      return prepare(
        {
          kind: "INVESTOR_MANDATE",
          investorOrganisationId: grant.subjectId,
          operation,
          mandateId: mandateId ?? null,
          fields:
            operation === "ACTIVATE" || operation === "CLOSE"
              ? {}
              : defined(fields),
        },
        context,
      );
    },
  });
}

// --- founder profile, team facts, their own role --------------------------

export const ProposeTeamChangeInputSchema = z
  .object({
    change: z
      .enum([
        "FOUNDER_PROFILE",
        "TEAM_FACTS",
        "MY_COMPANY_ROLE",
        "MY_INVESTOR_ROLE",
      ])
      .describe(
        "FOUNDER_PROFILE: their professionalSummary / backgroundSummary. TEAM_FACTS: founderCount, fullTimeFounderCount, teamSize. MY_COMPANY_ROLE: their relationshipType, businessTitle, isFounder at their company. MY_INVESTOR_ROLE: their businessTitle at their investor organisation.",
      ),
    professionalSummary: z.string().max(2000).optional(),
    backgroundSummary: z.string().max(2000).optional(),
    founderCount: z.number().int().min(0).max(100000).optional(),
    fullTimeFounderCount: z.number().int().min(0).max(100000).optional(),
    teamSize: z.number().int().min(0).max(10000000).optional(),
    relationshipType: z.enum(COMPANY_RELATIONSHIP_TYPES).optional(),
    businessTitle: z.string().max(120).optional(),
    isFounder: z.boolean().optional(),
  })
  .strict();
export type ProposeTeamChangeInput = z.infer<
  typeof ProposeTeamChangeInputSchema
>;

export function createProposeTeamChangeTool(
  ports: Pick<QToolPorts, "companies" | "investors">,
  port: RecordChangePort,
): AnyQToolDefinition {
  const prepare = prepareWith(port);
  const company = subjectAuthorizer(ports, "COMPANY");
  const investor = subjectAuthorizer(ports, "INVESTOR_ORGANISATION");
  return defineQTool<ProposeTeamChangeInput, ProposeRecordChangeOutput, Grant>({
    ...COMMON,
    id: PROPOSE_TEAM_CHANGE,
    providerName: "propose_team_change",
    description: `Prepares a change to their founder profile, their company's team facts, or their own role and title at their company or investor organisation, as the profile page's team section makes it. ${RESULT_NOTE}`,
    requiredScopeKinds: ["COMPANY_PROFILE", "INVESTOR_PROFILE"],
    input: ProposeTeamChangeInputSchema,
    authorize: (input, context) =>
      input.change === "MY_INVESTOR_ROLE"
        ? investor(input, context)
        : company(input, context),
    execute: (input, context, grant) => {
      const { change, ...rest } = input;
      const pick = (keys: readonly (keyof typeof rest)[]) =>
        defined(Object.fromEntries(keys.map((key) => [key, rest[key]])));
      switch (change) {
        case "FOUNDER_PROFILE":
          return prepare(
            {
              kind: "FOUNDER_PROFILE",
              companyId: grant.subjectId,
              fields: pick(["professionalSummary", "backgroundSummary"]),
            },
            context,
          );
        case "TEAM_FACTS":
          return prepare(
            {
              kind: "TEAM_FACTS",
              companyId: grant.subjectId,
              fields: pick([
                "founderCount",
                "fullTimeFounderCount",
                "teamSize",
              ]),
            },
            context,
          );
        case "MY_COMPANY_ROLE":
          return prepare(
            {
              kind: "COMPANY_MEMBERSHIP",
              companyId: grant.subjectId,
              fields: pick(["relationshipType", "businessTitle", "isFounder"]),
            },
            context,
          );
        case "MY_INVESTOR_ROLE":
          return prepare(
            {
              kind: "INVESTOR_REPRESENTATIVE",
              investorOrganisationId: grant.subjectId,
              fields: pick(["businessTitle"]),
            },
            context,
          );
      }
    },
  });
}

// --- Q Card details ------------------------------------------------------

export const ProposeQCardChangeInputSchema = z
  .object({
    subject: z
      .enum(["COMPANY", "INVESTOR_ORGANISATION"])
      .describe("Whose card: their own company's or investor organisation's."),
    indexable: z
      .boolean()
      .optional()
      .describe("Whether search engines may find the card."),
    fieldScopes: z
      .array(
        z.object({ field: QCardFieldSchema, scope: QCardScopeSchema }).strict(),
      )
      .max(20)
      .optional()
      .describe("Which fields the card shows, and to whom."),
  })
  .strict();
export type ProposeQCardChangeInput = z.infer<
  typeof ProposeQCardChangeInputSchema
>;

export function createProposeQCardChangeTool(
  ports: Pick<QToolPorts, "companies" | "investors">,
  port: RecordChangePort,
): AnyQToolDefinition {
  const prepare = prepareWith(port);
  const company = subjectAuthorizer(ports, "COMPANY");
  const investor = subjectAuthorizer(ports, "INVESTOR_ORGANISATION");
  return defineQTool<ProposeQCardChangeInput, ProposeRecordChangeOutput, Grant>(
    {
      ...COMMON,
      id: PROPOSE_Q_CARD_CHANGE,
      providerName: "propose_q_card_change",
      description: `Prepares a change to their own Q Card's details, as the Q Card screen makes it: whether search engines may find it, and which fields it shows to whom. (A new handle is propose_handle_claim.) ${RESULT_NOTE}`,
      requiredScopeKinds: ["COMPANY_PROFILE", "INVESTOR_PROFILE"],
      input: ProposeQCardChangeInputSchema,
      authorize: (input, context) =>
        input.subject === "COMPANY"
          ? company(input, context)
          : investor(input, context),
      execute: (input, context, grant) => {
        if (input.indexable === undefined && input.fieldScopes === undefined) {
          throw new QToolArgumentError(
            "Say what to change: indexable or fieldScopes.",
          );
        }
        return prepare(
          {
            kind: "Q_CARD",
            subjectType: input.subject,
            subjectId: grant.subjectId,
            fields: defined({
              indexable: input.indexable,
              fieldScopes:
                input.fieldScopes === undefined
                  ? undefined
                  : Object.fromEntries(
                      input.fieldScopes.map((entry) => [
                        entry.field,
                        entry.scope,
                      ]),
                    ),
            }),
          },
          context,
        );
      },
    },
  );
}

// --- the investor organisation's visibility --------------------------------

export const ProposeInvestorVisibilityInputSchema = z
  .object({
    visibility: z
      .enum(["network_visible", "organisation_private"])
      .describe(
        "network_visible: founders on Capital Q can find the organisation. organisation_private: only its own people.",
      ),
  })
  .strict();
export type ProposeInvestorVisibilityInput = z.infer<
  typeof ProposeInvestorVisibilityInputSchema
>;

export function createProposeInvestorVisibilityTool(
  ports: Pick<QToolPorts, "companies" | "investors">,
  port: RecordChangePort,
): AnyQToolDefinition {
  const prepare = prepareWith(port);
  return defineQTool<
    ProposeInvestorVisibilityInput,
    ProposeRecordChangeOutput,
    Grant
  >({
    ...COMMON,
    id: PROPOSE_INVESTOR_VISIBILITY,
    supportedPurposes: [
      "INVESTOR_QUESTION",
      "ACTION_PREPARATION",
      "GENERAL_QUESTION",
    ],
    providerName: "propose_investor_visibility",
    description: `Prepares a change to who can see their own investor organisation on Capital Q (visible to founders on the network, or private), as the profile's visibility control makes it. ${RESULT_NOTE}`,
    requiredScopeKinds: ["INVESTOR_PROFILE"],
    input: ProposeInvestorVisibilityInputSchema,
    authorize: subjectAuthorizer(ports, "INVESTOR_ORGANISATION"),
    execute: (input, context, grant) =>
      prepare(
        {
          kind: "INVESTOR_VISIBILITY",
          investorOrganisationId: grant.subjectId,
          fields: { visibility: input.visibility },
        },
        context,
      ),
  });
}

export function createRecordChangeTools(
  ports: Pick<QToolPorts, "companies" | "investors">,
  port: RecordChangePort,
): readonly AnyQToolDefinition[] {
  return [
    createProposeRaiseChangeTool(ports, port),
    createProposeMandateChangeTool(ports, port),
    createProposeTeamChangeTool(ports, port),
    createProposeQCardChangeTool(ports, port),
    createProposeInvestorVisibilityTool(ports, port),
  ];
}
