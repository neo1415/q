import { z } from "zod";

import {
  type PermittedContextPlan,
  type QTaskClass,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import {
  PROFILE_ANSWER_FIELDS,
  type QToolPorts,
  type RecordChange,
  type RecordChangePort,
} from "../ports.js";
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

export const PROPOSE_INVESTOR_VISIBILITY =
  "investor.visibility.propose" as const;
export const PROPOSE_PROFILE_ANSWER = "profile.answer.propose" as const;

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

// --- a profile fact first given during onboarding (ADR 0024) --------------

const PROFILE_ANSWER_FIELD_NAMES = [
  ...PROFILE_ANSWER_FIELDS.investor,
  ...PROFILE_ANSWER_FIELDS.founder,
] as const;

export const ProposeProfileAnswerInputSchema = z
  .object({
    field: z
      .enum(PROFILE_ANSWER_FIELD_NAMES)
      .describe(
        `Which profile fact. An investor's: ${PROFILE_ANSWER_FIELDS.investor.join(", ")}. A founder's company: ${PROFILE_ANSWER_FIELDS.founder.join(", ")}.`,
      ),
    value: z
      .union([z.string().max(8000), z.array(z.string().max(200)).max(40)])
      .describe(
        "The whole new answer in the person's words: option names or category names (a list replaces the list), a number as digits, or text. The result names the valid choices if a word doesn't fit.",
      ),
  })
  .strict();
export type ProposeProfileAnswerInput = z.infer<
  typeof ProposeProfileAnswerInputSchema
>;

export function createProposeProfileAnswerTool(
  ports: Pick<QToolPorts, "companies" | "investors">,
  port: RecordChangePort,
): AnyQToolDefinition {
  const prepare = prepareWith(port);
  const investor = subjectAuthorizer(ports, "INVESTOR_ORGANISATION");
  const company = subjectAuthorizer(ports, "COMPANY");
  const investorFields: ReadonlySet<string> = new Set(
    PROFILE_ANSWER_FIELDS.investor,
  );
  return defineQTool<
    ProposeProfileAnswerInput,
    ProposeRecordChangeOutput,
    Grant
  >({
    ...COMMON,
    id: PROPOSE_PROFILE_ANSWER,
    providerName: "propose_profile_answer_change",
    description: `Prepares a change to one fact on their own profile that they first gave during onboarding: an investor's sectors, geographies, business models, customer types, stages, cheque sizes, criteria, founder preferences, exclusions, discovery style or portfolio; a founder's company categories, team facts or traction. The change goes into the same records onboarding wrote (their mandate or company). ${RESULT_NOTE}`,
    requiredScopeKinds: [],
    input: ProposeProfileAnswerInputSchema,
    authorize: (input, context) =>
      investorFields.has(input.field)
        ? investor(input, context)
        : company(input, context),
    execute: (input, context) =>
      prepare(
        {
          kind: "PROFILE_ANSWER",
          journey: investorFields.has(input.field) ? "investor" : "founder",
          field: input.field,
          value: input.value,
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
    createProposeInvestorVisibilityTool(ports, port),
    createProposeProfileAnswerTool(ports, port),
  ];
}
