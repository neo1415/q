import { z } from "zod";

import {
  RelationshipStateV1Schema,
  RELATIONSHIP_NEXT_STEPS,
  UtcTimestampSchema,
  UuidSchema,
  type PermittedContextPlan,
  type QTaskClass,
  type RelationshipStatusDto,
} from "@capital-q/contracts";
import { CompanyIdSchema } from "@capital-q/companies";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import { capability } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope, boundScopeFor } from "../plan.js";
import type { QToolPorts, RelationshipIntelligencePort } from "../ports.js";

/**
 * Relationship intelligence (CQ-Q-030; doc 25 §122: "what happened with
 * Apex? what do they still need? prepare me for next step").
 *
 * Four tools over the Network context, never over its tables:
 *
 *   get_relationship          where are we with X -- the per-party fold of
 *                             the history (CQ-NET-012), for the actor's own
 *                             side only, with the dates it happened
 *   list_incoming_interest    the actor's own company's inbox
 *   propose_express_interest  prepare Express Interest for the person's
 *                             approval
 *   propose_interest_answer   prepare Accept / Decline for the person's
 *                             approval
 *
 * The firewall comes first: a counterparty the plan named but did not
 * admit stays refused whatever the Network service would allow, and
 * anything else is reachable only under the actor-wide network scope.
 * Then the Network service decides, with the same rules the screens use.
 *
 * The two proposal tools write one thing: a note to this run's Approval
 * Engine proposer. Nothing is sent, accepted or declined by a tool. The
 * person approves the exact payload; the approved action then runs
 * through the same command the button calls (relationship.interest.*).
 * Intent is the model's reading of what the person asked -- there is no
 * phrase list here -- and authority stays with the person and the code.
 */

export const GET_RELATIONSHIP = "relationship.get" as const;
export const LIST_INCOMING_INTEREST =
  "relationship.incoming_interest.list" as const;
export const PROPOSE_EXPRESS_INTEREST =
  "relationship.interest.express.propose" as const;
export const PROPOSE_INTEREST_ANSWER =
  "relationship.interest.answer.propose" as const;

const PURPOSES: readonly QTaskClass[] = [
  "OWN_COMPANY_QUESTION",
  "COUNTERPARTY_COMPANY_QUESTION",
  "INVESTOR_QUESTION",
  "RELATIONSHIP_QUESTION",
  "COMPARISON",
  "ACTION_PREPARATION",
  "GENERAL_QUESTION",
];

const SCOPES = [
  "RELATIONSHIP_CONTEXT",
  "COMPANY_PROFILE",
  "INVESTOR_PROFILE",
  "NETWORK_VISIBLE_DATA",
] as const;

/**
 * The firewall's word on a counterparty. Bound in the plan: admitted. Named
 * as a subject but not bound: the firewall refused it, so do we. Anything
 * else only under the actor-wide network scope.
 */
function admitted(
  plan: PermittedContextPlan,
  target:
    | { readonly kind: "COMPANY"; readonly id: string }
    | { readonly kind: "INVESTOR_ORGANISATION"; readonly id: string },
): boolean {
  const bound =
    target.kind === "COMPANY"
      ? boundScopeFor(
          plan,
          "COMPANY_PROFILE",
          (filter) => filter.companyId === target.id,
        )
      : boundScopeFor(
          plan,
          "INVESTOR_PROFILE",
          (filter) => filter.investorOrganisationId === target.id,
        );
  if (bound !== undefined) return true;
  const named = plan.subjects.some((subject) =>
    target.kind === "COMPANY"
      ? subject.kind === "COMPANY" && subject.companyId === target.id
      : subject.kind === "INVESTOR_ORGANISATION" &&
        subject.investorOrganisationId === target.id,
  );
  return !named && actorWideScope(plan, "NETWORK_VISIBLE_DATA") !== undefined;
}

// ---------------------------------------------------------------------------
// get_relationship
// ---------------------------------------------------------------------------

export const GetRelationshipInputSchema = z
  .object({
    companyId: UuidSchema.optional().describe(
      "Ask as an investor: the company's id, as given in the conversation context.",
    ),
    investorOrganisationId: UuidSchema.optional().describe(
      "Ask as a company: the investor organisation's id, as given in the conversation context.",
    ),
    relationshipId: UuidSchema.optional().describe(
      "When the conversation is about a relationship itself: its id, as given in the conversation context. Works for either side.",
    ),
  })
  .strict()
  .refine(
    (input) =>
      [
        input.companyId,
        input.investorOrganisationId,
        input.relationshipId,
      ].filter((id) => id !== undefined).length === 1,
    {
      message:
        "name exactly one of companyId, investorOrganisationId or relationshipId",
    },
  );
export type GetRelationshipInput = z.infer<typeof GetRelationshipInputSchema>;

const MilestoneSchema = z
  .object({ state: RelationshipStateV1Schema, at: UtcTimestampSchema })
  .strict();

export const GetRelationshipOutputSchema = z
  .object({
    /** Which side the answer is for; always the asker's own. */
    yourSide: z.enum(["INVESTOR", "COMPANY"]),
    counterpart: z
      .object({
        kind: z.enum(["COMPANY", "INVESTOR_ORGANISATION"]),
        id: UuidSchema,
        name: z.string().nullable(),
      })
      .strict(),
    /** Null: nothing on record that this side can see. Never "no relationship exists". */
    relationship: z
      .object({
        state: RelationshipStateV1Schema,
        stateSince: UtcTimestampSchema,
        milestones: z.array(MilestoneSchema).max(64),
        nextStep: z.enum(RELATIONSHIP_NEXT_STEPS),
      })
      .strict()
      .nullable(),
    /** Recorded by Capital Q as it happened: not a claim and not an inference. */
    truthClass: z.literal("VERIFIED"),
    source: z.literal("Capital Q relationship history"),
  })
  .strict();
export type GetRelationshipOutput = z.infer<typeof GetRelationshipOutputSchema>;

type RelationshipGrant = {
  readonly side: "INVESTOR" | "COMPANY";
  readonly counterpart: GetRelationshipOutput["counterpart"];
  readonly status: RelationshipStatusDto | null;
};

function relationshipOut(
  status: RelationshipStatusDto | null,
): GetRelationshipOutput["relationship"] {
  return status === null
    ? null
    : {
        state: status.state,
        stateSince: status.stateSince,
        milestones: status.milestones.map((m) => ({
          state: m.state,
          at: m.at,
        })),
        nextStep: status.nextStep,
      };
}

function createGetRelationshipTool(
  ports: QToolPorts,
  relationships: RelationshipIntelligencePort,
): AnyQToolDefinition {
  return defineQTool<
    GetRelationshipInput,
    GetRelationshipOutput,
    RelationshipGrant
  >({
    id: GET_RELATIONSHIP,
    version: 1,
    status: "ACTIVE",
    providerName: "get_relationship",
    description:
      "Where the person's own side stands with one counterparty on Capital Q: the relationship's state (discovered, interest expressed, connected, declined), when it got there, what happened in order with dates, and the next step for them. Pass companyId when the person is an investor asking about a company, investorOrganisationId when they are a company asking about an investor, or relationshipId when the conversation is about a relationship itself. Call it whenever a question touches their dealings with a specific counterparty. A null relationship means nothing is on record that they can see.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [
      capability("investor.view"),
      capability("company.interest.view"),
    ],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: [...SCOPES],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_RELATIONSHIP",
    input: GetRelationshipInputSchema,
    output: GetRelationshipOutputSchema,
    authorize: async (input, { actor, plan }) => {
      try {
        if (input.relationshipId !== undefined) {
          // Only a relationship the firewall bound for this run: it has
          // already decided the actor is a party. The Network context then
          // answers for the actor's own side, whatever the id names.
          const id = input.relationshipId;
          if (
            boundScopeFor(
              plan,
              "RELATIONSHIP_CONTEXT",
              (filter) => filter.relationshipIds?.includes(id) === true,
            ) === undefined
          ) {
            return deny("NOT_AVAILABLE");
          }
          const view = await relationships.byRelationship(actor, id);
          if (view === null) return deny("NOT_AVAILABLE");
          if (view.counterpart.kind === "COMPANY") {
            const profile = await ports.companies.findCanonicalCompanyProfile(
              CompanyIdSchema.parse(view.counterpart.id),
            );
            return allow("CONFIDENTIAL", {
              side: view.side,
              counterpart: {
                kind: "COMPANY",
                id: view.counterpart.id,
                name: profile?.canonicalName ?? null,
              },
              status: view.status,
            });
          }
          // The same naming rule as below: an investor is named to a
          // company only when the company can see something of them.
          const investor =
            view.status === null
              ? null
              : await ports.investors.findCanonicalInvestorOrganisation(
                  InvestorOrganisationIdSchema.parse(view.counterpart.id),
                );
          return allow("CONFIDENTIAL", {
            side: view.side,
            counterpart: {
              kind: "INVESTOR_ORGANISATION",
              id: view.counterpart.id,
              name: investor?.displayName ?? null,
            },
            status: view.status,
          });
        }
        if (input.companyId !== undefined) {
          if (!admitted(plan, { kind: "COMPANY", id: input.companyId })) {
            return deny("NOT_AVAILABLE");
          }
          const status = await relationships.withCompany(
            actor,
            input.companyId,
          );
          const profile = await ports.companies.findCanonicalCompanyProfile(
            CompanyIdSchema.parse(input.companyId),
          );
          return allow("CONFIDENTIAL", {
            side: "INVESTOR",
            counterpart: {
              kind: "COMPANY",
              id: input.companyId,
              name: profile?.canonicalName ?? null,
            },
            status,
          });
        }
        const investorId = input.investorOrganisationId ?? "";
        if (
          !admitted(plan, { kind: "INVESTOR_ORGANISATION", id: investorId })
        ) {
          return deny("NOT_AVAILABLE");
        }
        const status = await relationships.withInvestor(actor, investorId);
        // A name only for a counterparty the company can see a relationship
        // with: expressing interest is addressed to the company, so it is
        // theirs to know; an investor with nothing shared stays unnamed.
        const investor =
          status === null
            ? null
            : await ports.investors.findCanonicalInvestorOrganisation(
                InvestorOrganisationIdSchema.parse(investorId),
              );
        return allow("CONFIDENTIAL", {
          side: "COMPANY",
          counterpart: {
            kind: "INVESTOR_ORGANISATION",
            id: investorId,
            name: investor?.displayName ?? null,
          },
          status,
        });
      } catch {
        // Not an investor, not this company's member, a company this
        // investor may not see: one answer for all of them.
        return deny("NOT_AVAILABLE");
      }
    },
    execute: (_input, _context, grant) =>
      Promise.resolve({
        yourSide: grant.side,
        counterpart: grant.counterpart,
        relationship: relationshipOut(grant.status),
        truthClass: "VERIFIED",
        source: "Capital Q relationship history",
      }),
  });
}

// ---------------------------------------------------------------------------
// list_incoming_interest
// ---------------------------------------------------------------------------

export const ListIncomingInterestInputSchema = z
  .object({
    companyId: UuidSchema.describe(
      "The person's own company's id, as given in the conversation context.",
    ),
  })
  .strict();
export type ListIncomingInterestInput = z.infer<
  typeof ListIncomingInterestInputSchema
>;

export const ListIncomingInterestOutputSchema = z
  .object({
    interests: z
      .array(
        z
          .object({
            investorOrganisationId: UuidSchema,
            investorName: z.string(),
            investorType: z.string(),
            expressedAt: UtcTimestampSchema,
            answer: z.enum(["PENDING", "ACCEPTED", "DECLINED"]),
            answeredAt: UtcTimestampSchema.nullable(),
          })
          .strict(),
      )
      .max(200),
    truthClass: z.literal("VERIFIED"),
  })
  .strict();
export type ListIncomingInterestOutput = z.infer<
  typeof ListIncomingInterestOutputSchema
>;

function createListIncomingInterestTool(
  relationships: RelationshipIntelligencePort,
): AnyQToolDefinition {
  return defineQTool<
    ListIncomingInterestInput,
    ListIncomingInterestOutput,
    ListIncomingInterestOutput
  >({
    id: LIST_INCOMING_INTEREST,
    version: 1,
    status: "ACTIVE",
    providerName: "list_incoming_interest",
    description:
      "The investor organisations that have expressed interest in the person's own company, when each did, and whether the company has accepted, declined or not yet answered. Call it when a founder asks who is interested, or before preparing an answer to an interest.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [capability("company.interest.view")],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: [...SCOPES],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_RELATIONSHIP",
    input: ListIncomingInterestInputSchema,
    output: ListIncomingInterestOutputSchema,
    authorize: async (input, { actor, plan }) => {
      if (!admitted(plan, { kind: "COMPANY", id: input.companyId })) {
        return deny("NOT_AVAILABLE");
      }
      try {
        const items = await relationships.incomingInterest(
          actor,
          input.companyId,
        );
        return allow("CONFIDENTIAL", {
          interests: items.map((item) => ({
            investorOrganisationId: item.investorOrganisationId,
            investorName: item.investorName,
            investorType: item.investorType,
            expressedAt: item.expressedAt,
            answer: item.response,
            answeredAt: item.respondedAt,
          })),
          truthClass: "VERIFIED",
        });
      } catch {
        return deny("NOT_AVAILABLE");
      }
    },
    execute: (_input, _context, grant) => Promise.resolve(grant),
  });
}

// ---------------------------------------------------------------------------
// propose_express_interest / propose_interest_answer
// ---------------------------------------------------------------------------

export const ProposalOutputSchema = z
  .object({
    /**
     * PREPARED: an approval request will be shown to the person with this
     * answer; nothing has happened yet. ONE_PER_TURN: another action is
     * already being prepared in this answer; ask them to confirm that
     * first.
     */
    status: z.enum(["PREPARED", "ONE_PER_TURN"]),
    /** What the person will be asked to approve, in plain words. */
    awaitingApprovalOf: z.string(),
  })
  .strict();
export type ProposalOutput = z.infer<typeof ProposalOutputSchema>;

export const ProposeExpressInterestInputSchema = z
  .object({
    companyId: UuidSchema.describe(
      "The company the person wants to express interest in, as given in the conversation context.",
    ),
  })
  .strict();
export type ProposeExpressInterestInput = z.infer<
  typeof ProposeExpressInterestInputSchema
>;

function createProposeExpressInterestTool(
  ports: QToolPorts,
  relationships: RelationshipIntelligencePort,
): AnyQToolDefinition {
  return defineQTool<
    ProposeExpressInterestInput,
    ProposalOutput,
    { readonly companyName: string }
  >({
    id: PROPOSE_EXPRESS_INTEREST,
    version: 1,
    status: "ACTIVE",
    providerName: "propose_express_interest",
    description:
      "Prepares Express Interest in one company for the person's own approval, when they have asked for it -- telling the company's founders their organisation would like to explore it. It sends nothing: the person is shown exactly what will happen and approves or declines it. It is not a commitment to invest.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [capability("investor.interest.express")],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: [...SCOPES],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "WAITING_FOR_APPROVAL",
    input: ProposeExpressInterestInputSchema,
    output: ProposalOutputSchema,
    authorize: async (input, { actor, plan }) => {
      if (!admitted(plan, { kind: "COMPANY", id: input.companyId })) {
        return deny("NOT_AVAILABLE");
      }
      if (!(await relationships.mayExpressInterest(actor, input.companyId))) {
        return deny("NOT_AVAILABLE");
      }
      const profile = await ports.companies.findCanonicalCompanyProfile(
        CompanyIdSchema.parse(input.companyId),
      );
      if (profile === null) return deny("NOT_AVAILABLE");
      return allow("NETWORK_VISIBLE", { companyName: profile.canonicalName });
    },
    execute: (input, context, grant) => {
      const status = relationships.prepareForApproval({
        runId: context.runId,
        tenantId: context.actor.tenantId,
        actorUserId: context.actor.userId,
        actionType: "relationship.interest.express",
        payload: { companyId: input.companyId, companyName: grant.companyName },
      });
      return Promise.resolve({
        status,
        awaitingApprovalOf: `Express interest in ${grant.companyName}`,
      });
    },
  });
}

export const ProposeInterestAnswerInputSchema = z
  .object({
    companyId: UuidSchema.describe(
      "The person's own company's id, as given in the conversation context.",
    ),
    investorOrganisationId: UuidSchema.describe(
      "The investor organisation whose interest is being answered, from list_incoming_interest.",
    ),
    decision: z
      .enum(["ACCEPTED", "DECLINED"])
      .describe(
        "ACCEPTED connects both sides; DECLINED does not take it forward.",
      ),
  })
  .strict();
export type ProposeInterestAnswerInput = z.infer<
  typeof ProposeInterestAnswerInputSchema
>;

function createProposeInterestAnswerTool(
  relationships: RelationshipIntelligencePort,
): AnyQToolDefinition {
  return defineQTool<
    ProposeInterestAnswerInput,
    ProposalOutput,
    { readonly interestId: string; readonly investorName: string }
  >({
    id: PROPOSE_INTEREST_ANSWER,
    version: 1,
    status: "ACTIVE",
    providerName: "propose_interest_answer",
    description:
      "Prepares the person's company's answer to an investor organisation's interest -- accept (both sides agree to connect) or decline (not taken forward, no reason shared) -- for their own approval, when they have said which. It answers nothing by itself: the person approves or declines what is shown. Only an interest still awaiting an answer can be answered.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [capability("company.interest.respond")],
    supportedPurposes: [...PURPOSES],
    requiredScopeKinds: [...SCOPES],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "WAITING_FOR_APPROVAL",
    input: ProposeInterestAnswerInputSchema,
    output: ProposalOutputSchema,
    authorize: async (input, { actor, plan }) => {
      if (!admitted(plan, { kind: "COMPANY", id: input.companyId })) {
        return deny("NOT_AVAILABLE");
      }
      try {
        const pending = (
          await relationships.incomingInterest(actor, input.companyId)
        ).find(
          (item) =>
            item.investorOrganisationId === input.investorOrganisationId &&
            item.response === "PENDING",
        );
        if (
          pending === undefined ||
          !(await relationships.mayAnswerInterest(actor, pending.interestId))
        ) {
          return deny("NOT_AVAILABLE");
        }
        return allow("CONFIDENTIAL", {
          interestId: pending.interestId,
          investorName: pending.investorName,
        });
      } catch {
        return deny("NOT_AVAILABLE");
      }
    },
    execute: (input, context, grant) => {
      const status = relationships.prepareForApproval({
        runId: context.runId,
        tenantId: context.actor.tenantId,
        actorUserId: context.actor.userId,
        actionType: "relationship.interest.respond",
        payload: {
          interestId: grant.interestId,
          companyId: input.companyId,
          decision: input.decision,
          investorName: grant.investorName,
        },
      });
      return Promise.resolve({
        status,
        awaitingApprovalOf:
          input.decision === "ACCEPTED"
            ? `Accept ${grant.investorName}'s interest`
            : `Decline ${grant.investorName}'s interest`,
      });
    },
  });
}

export function createRelationshipTools(
  ports: QToolPorts,
  relationships: RelationshipIntelligencePort,
): readonly AnyQToolDefinition[] {
  return [
    createGetRelationshipTool(ports, relationships),
    createListIncomingInterestTool(relationships),
    createProposeExpressInterestTool(ports, relationships),
    createProposeInterestAnswerTool(relationships),
  ];
}
