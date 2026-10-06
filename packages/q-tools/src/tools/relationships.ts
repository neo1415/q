import { z } from "zod";

import {
  Q_TASK_CLASSES,
  RelationshipStateV2Schema,
  RELATIONSHIP_NEXT_STEPS,
  UtcTimestampSchema,
  UuidSchema,
  type PermittedContextPlan,
  type QTaskClass,
  type RelationshipStatusDto,
} from "@capital-q/contracts";
import { CompanyIdSchema } from "@capital-q/companies";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import { capability, type ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope, boundScopeFor } from "../plan.js";
import { findRecordByName } from "./client-actions.js";
import { createProposeConnectionRequestTool } from "./connection-request-send.js";
import {
  closestByName,
  createProposeConnectionRequestAnswerTool,
  listedNames,
} from "./connection-requests.js";
import type {
  InvestorFeedPort,
  OwnRelationships,
  QToolPorts,
  RelationshipIntelligencePort,
} from "../ports.js";

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
export const LIST_MY_RELATIONSHIPS = "relationship.own.list" as const;

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
export function admitted(
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

/**
 * The company an action may be taken on (R35: "save this", "pass", "I'm
 * interested"). When the run is about companies -- on screen, being
 * watched, or asked about by the client -- only one of those, and only if
 * the firewall bound it: a company neither on screen nor asked about is
 * never acted on, whatever id a model produces. With no company in the run
 * (Home: "save Northwind"), the one the person named in words, as
 * admitted() decides.
 */
export function actionTarget(
  plan: PermittedContextPlan,
  companyId: string,
): boolean {
  const companies = plan.subjects.filter(
    (subject) => subject.kind === "COMPANY",
  );
  if (companies.length === 0) {
    return admitted(plan, { kind: "COMPANY", id: companyId });
  }
  return (
    companies.some(
      (subject) =>
        subject.kind === "COMPANY" && subject.companyId === companyId,
    ) &&
    boundScopeFor(
      plan,
      "COMPANY_PROFILE",
      (filter) => filter.companyId === companyId,
    ) !== undefined
  );
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
  .object({ state: RelationshipStateV2Schema, at: UtcTimestampSchema })
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
        state: RelationshipStateV2Schema,
        stateSince: UtcTimestampSchema,
        milestones: z.array(MilestoneSchema).max(64),
        nextStep: z.enum(RELATIONSHIP_NEXT_STEPS),
      })
      .strict()
      .nullable(),
    /**
     * The diligence area, once diligence started (2026-10-02): what the
     * investor asked for, which requests are answered, what was shared.
     * Absent when there is none or it cannot be read.
     */
    diligence: z
      .object({
        openRequests: z.array(z.string().max(200)).max(50),
        answeredRequests: z.array(z.string().max(200)).max(50),
        sharedDocuments: z.array(z.string().max(300)).max(50),
      })
      .strict()
      .optional(),
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
    execute: async (_input, context, grant) => {
      const diligence =
        grant.status === null || relationships.diligence === undefined
          ? null
          : await relationships
              .diligence(context.actor, grant.status.relationshipId)
              .catch(() => null);
      return {
        yourSide: grant.side,
        counterpart: grant.counterpart,
        relationship: relationshipOut(grant.status),
        ...(diligence === null
          ? {}
          : {
              diligence: {
                openRequests: [...diligence.openRequests],
                answeredRequests: [...diligence.answeredRequests],
                sharedDocuments: [...diligence.sharedDocuments],
              },
            }),
        truthClass: "VERIFIED",
        source: "Capital Q relationship history",
      };
    },
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
    companyId: UuidSchema.optional().describe(
      "The company the person wants to express interest in, as given in the conversation context.",
    ),
    company: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Or the company's name as the person said it, from any page; Capital Q finds it among companies they can see.",
      ),
  })
  .strict()
  .refine(
    (input) =>
      (input.companyId === undefined) !== (input.company === undefined),
    { message: "name exactly one of companyId or company" },
  );
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
    { readonly companyId: string; readonly companyName: string }
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
      // By id: a company this run's plan targets. By name (action parity
      // 2026-10-02, from any page): one company they can already see, by
      // the same matcher open_page uses; never a guess among several.
      const companyId =
        input.companyId !== undefined
          ? actionTarget(plan, input.companyId)
            ? input.companyId
            : null
          : await findRecordByName(
              ports,
              actor,
              "COMPANY",
              input.company ?? "",
            );
      if (companyId === null) return deny("NOT_AVAILABLE");
      if (!(await relationships.mayExpressInterest(actor, companyId))) {
        return deny("NOT_AVAILABLE");
      }
      const profile = await ports.companies.findCanonicalCompanyProfile(
        CompanyIdSchema.parse(companyId),
      );
      if (profile === null) return deny("NOT_AVAILABLE");
      return allow("NETWORK_VISIBLE", {
        companyId,
        companyName: profile.canonicalName,
      });
    },
    execute: (_input, context, grant) => {
      const status = relationships.prepareForApproval({
        runId: context.runId,
        tenantId: context.actor.tenantId,
        actorUserId: context.actor.userId,
        actionType: "relationship.interest.express",
        payload: { companyId: grant.companyId, companyName: grant.companyName },
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
    investor: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .nullable()
      .default(null)
      .describe(
        "The investor organisation whose interest this answers, as the person named it (or its id). Null when they did not say which: with one interest waiting it is that one, with several the result names them to ask once.",
      ),
    companyId: UuidSchema.optional().describe(
      "Only when given in the conversation context: the person's own company's id. Otherwise their own company is used.",
    ),
    investorOrganisationId: UuidSchema.optional().describe(
      "Only an id from list_incoming_interest; otherwise name the investor.",
    ),
    decision: z
      .enum(["ACCEPTED", "DECLINED"])
      .describe(
        "ACCEPTED connects both sides; DECLINED does not take it forward.",
      ),
  })
  .strict();
export type ProposeInterestAnswerInput = z.output<
  typeof ProposeInterestAnswerInputSchema
>;

export const InterestAnswerOutputSchema = z
  .object({
    /**
     * PREPARED: shown for approval, nothing happened yet. ONE_PER_TURN:
     * another action waits in this answer. NO_PENDING_INTEREST /
     * NOT_FOUND / WHICH_ONE: nothing prepared; `awaitingApprovalOf` says
     * exactly why and names what is pending, to say as it is.
     */
    status: z.enum([
      "PREPARED",
      "ONE_PER_TURN",
      "NO_PENDING_INTEREST",
      "NOT_FOUND",
      "WHICH_ONE",
    ]),
    awaitingApprovalOf: z.string(),
  })
  .strict();
export type InterestAnswerOutput = z.infer<typeof InterestAnswerOutputSchema>;

type PendingInterest = {
  readonly interestId: string;
  readonly companyId: string;
  readonly investorOrganisationId: string;
  readonly investorName: string;
};

/** What an approval of this answer is called, for the card and for Q. */
export function interestAnswerSummary(
  investorName: string,
  decision: "ACCEPTED" | "DECLINED",
): string {
  return decision === "ACCEPTED"
    ? `Accept ${investorName}'s interest`
    : `Decline ${investorName}'s interest`;
}

/**
 * The one pending interest the words name, or exactly why not: none
 * waiting, none matching (with what is waiting), or several matching
 * (asked which). Never a guess among several.
 */
export function choosePendingInterest(
  pending: readonly PendingInterest[],
  said: string | null,
  decision: "ACCEPTED" | "DECLINED",
):
  | { readonly chosen: PendingInterest }
  | { readonly chosen: null; readonly output: InterestAnswerOutput } {
  const verb = decision === "ACCEPTED" ? "accept" : "decline";
  if (pending.length === 0) {
    return {
      chosen: null,
      output: {
        status: "NO_PENDING_INTEREST",
        awaitingApprovalOf: `No investor's interest is waiting for your answer, so there is nothing to ${verb}.`,
      },
    };
  }
  const names = pending.map((item) => item.investorName);
  if (said === null) {
    const only = pending.length === 1 ? pending[0] : undefined;
    return only !== undefined
      ? { chosen: only }
      : {
          chosen: null,
          output: {
            status: "WHICH_ONE",
            awaitingApprovalOf: `${String(pending.length)} investors' interest is waiting: ${listedNames(names)}. Which one should I ${verb}?`,
          },
        };
  }
  const byId = pending.find(
    (item) => item.investorOrganisationId === said.toLowerCase(),
  );
  const found =
    byId === undefined
      ? closestByName(
          pending,
          said,
          (item) => item.investorName,
          (item) => item.interestId,
        )
      : [byId];
  const only = found.length === 1 ? found[0] : undefined;
  if (only !== undefined) return { chosen: only };
  return found.length === 0
    ? {
        chosen: null,
        output: {
          status: "NOT_FOUND",
          awaitingApprovalOf: `"${said}" isn't one of the interests waiting for your answer; those are from ${listedNames(names)}.`,
        },
      }
    : {
        chosen: null,
        output: {
          status: "WHICH_ONE",
          awaitingApprovalOf: `More than one interest waiting matches "${said}": ${listedNames(found.map((item) => item.investorName))}. Which one should I ${verb}?`,
        },
      };
}

function createProposeInterestAnswerTool(
  relationships: RelationshipIntelligencePort,
): AnyQToolDefinition {
  return defineQTool<
    ProposeInterestAnswerInput,
    InterestAnswerOutput,
    { readonly pending: readonly PendingInterest[] }
  >({
    id: PROPOSE_INTEREST_ANSWER,
    version: 1,
    status: "ACTIVE",
    providerName: "propose_interest_answer",
    description:
      "Prepares the person's company's answer to an investor organisation's interest -- accept (both sides agree to connect) or decline (not taken forward, no reason shared) -- for their own approval, when they have said which. Name the investor as they did; it is matched against the interest waiting in their own inbox. It answers nothing by itself: the person approves or declines what is shown. If the result is not PREPARED, tell them its words as they are. For an investor answering a company's Connection Request (Company requests), use propose_connection_request_answer instead.",
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
    output: InterestAnswerOutputSchema,
    authorize: async (input, { actor, plan }) => {
      try {
        // Their own inbox only: the company the plan admits, or their own
        // company read by the Network context from their membership.
        let pending: readonly PendingInterest[];
        if (input.companyId !== undefined) {
          if (!admitted(plan, { kind: "COMPANY", id: input.companyId })) {
            return deny("NOT_AVAILABLE");
          }
          const companyId = input.companyId;
          pending = (await relationships.incomingInterest(actor, companyId))
            .filter((item) => item.response === "PENDING")
            .map((item) => ({
              interestId: item.interestId,
              companyId,
              investorOrganisationId: item.investorOrganisationId,
              investorName: item.investorName,
            }));
        } else if (relationships.pendingInterests !== undefined) {
          pending = await relationships.pendingInterests(actor);
        } else {
          return deny("NOT_AVAILABLE");
        }
        // An id from the inbox: exactly that interest, still waiting, or
        // nothing (an answered or another company's interest).
        if (input.investorOrganisationId !== undefined) {
          const exact = pending.find(
            (item) =>
              item.investorOrganisationId === input.investorOrganisationId,
          );
          if (exact === undefined) return deny("NOT_AVAILABLE");
          pending = [exact];
        }
        return allow("CONFIDENTIAL", { pending });
      } catch {
        return deny("NOT_AVAILABLE");
      }
    },
    execute: async (input, context, grant) => {
      const picked = choosePendingInterest(
        grant.pending,
        input.investorOrganisationId === undefined ? input.investor : null,
        input.decision,
      );
      if (picked.chosen === null) return picked.output;
      const chosen = picked.chosen;
      // The answer command's own question, before anything is shown.
      if (
        !(await relationships.mayAnswerInterest(
          context.actor,
          chosen.interestId,
        ))
      ) {
        return {
          status: "NOT_FOUND",
          awaitingApprovalOf: `${chosen.investorName}'s interest can't be answered from here.`,
        };
      }
      const status = relationships.prepareForApproval({
        runId: context.runId,
        tenantId: context.actor.tenantId,
        actorUserId: context.actor.userId,
        actionType: "relationship.interest.respond",
        payload: {
          interestId: chosen.interestId,
          companyId: chosen.companyId,
          decision: input.decision,
          investorName: chosen.investorName,
        },
      });
      return {
        status,
        awaitingApprovalOf: interestAnswerSummary(
          chosen.investorName,
          input.decision,
        ),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// list_my_relationships (R35)
// ---------------------------------------------------------------------------

/**
 * The person's own relationships, and for an investor their own Saves and
 * Passes: records of their OWN organisation, so always theirs to know,
 * whatever the turn is about ("have I expressed interest in anyone?",
 * "compare the companies I'm interested in"). Nothing here takes a
 * counterparty from input: the Network context resolves the actor's side
 * from their membership and folds each relationship over the history that
 * side may see, and the feed's decision read re-checks each saved or
 * passed company is still visible to them. Another organisation's
 * interests cannot be asked for, because there is no parameter to ask.
 */

const MY_RELATIONSHIPS_MAX = 100;
const MY_DECISIONS_MAX = 50;

export const ListMyRelationshipsInputSchema = z.object({}).strict();
export type ListMyRelationshipsInput = z.infer<
  typeof ListMyRelationshipsInputSchema
>;

const CompanyDecisionSchema = z
  .object({
    companyId: UuidSchema,
    name: z.string().max(200),
    stageCode: z.string().max(64).nullable(),
  })
  .strict();

export const ListMyRelationshipsOutputSchema = z
  .object({
    /** NONE: the person is on neither side of any relationship. */
    yourSide: z.enum(["INVESTOR", "COMPANY", "NONE"]),
    relationships: z
      .array(
        z
          .object({
            relationshipId: UuidSchema,
            counterpart: z
              .object({
                kind: z.enum(["COMPANY", "INVESTOR_ORGANISATION"]),
                id: UuidSchema,
                name: z.string().max(200),
              })
              .strict(),
            state: RelationshipStateV2Schema,
            stateSince: UtcTimestampSchema,
            milestones: z.array(MilestoneSchema).max(64),
            nextStep: z.enum(RELATIONSHIP_NEXT_STEPS),
          })
          .strict(),
      )
      .max(MY_RELATIONSHIPS_MAX),
    /** Investor only: companies they saved in Discover (not interest). */
    saved: z.array(CompanyDecisionSchema).max(MY_DECISIONS_MAX),
    /** Investor only: companies they passed on in Discover. */
    passed: z.array(CompanyDecisionSchema).max(MY_DECISIONS_MAX),
    truthClass: z.literal("VERIFIED"),
    source: z.literal("Capital Q relationship history"),
  })
  .strict();
export type ListMyRelationshipsOutput = z.infer<
  typeof ListMyRelationshipsOutputSchema
>;

function createListMyRelationshipsTool(
  own: (actor: ActorContext) => Promise<OwnRelationships | null>,
  feed: InvestorFeedPort | undefined,
): AnyQToolDefinition {
  return defineQTool<ListMyRelationshipsInput, ListMyRelationshipsOutput, null>(
    {
      id: LIST_MY_RELATIONSHIPS,
      version: 1,
      status: "ACTIVE",
      // Always on: their own relationships are theirs to ask about in any
      // turn, and a question about "the ones I'm interested in" names no
      // company for the purpose to narrow by.
      core: true,
      providerName: "list_my_relationships",
      description:
        "Lists the person's own relationships on Capital Q, with each counterparty's name and id: for an investor, every company they expressed interest in and whether it is still awaiting an answer (INTEREST_EXPRESSED), accepted (CONNECTED) or declined, plus the companies they saved or passed on in Discover; for a founder, every investor that expressed interest in their company and where each stands. Each has its state, since when, dated milestones and their next step. Call it whenever they ask about their interests, connections, pipeline, saved companies or 'the companies I'm interested in' -- never ask them for names these records already hold. Saving or passing is not interest.",
      classification: "READ_ONLY",
      riskClass: "SAFE_READ",
      requiredCapabilities: [],
      supportedPurposes: [...Q_TASK_CLASSES],
      requiredScopeKinds: ["OWN_Q_CONVERSATION"],
      approval: "NONE",
      idempotency: "SAFE_TO_REPEAT",
      owner: "q-tools",
      visibleStage: "REVIEWING_RELATIONSHIP",
      input: ListMyRelationshipsInputSchema,
      output: ListMyRelationshipsOutputSchema,
      authorize: (_input, { actor, plan }) => {
        // Their own conversation, as themselves: the scope the firewall
        // binds to this person only.
        const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
        return Promise.resolve(
          actor.actorType === "HUMAN" &&
            scope !== undefined &&
            scope.filter.userId === actor.userId
            ? allow<null>("CONFIDENTIAL", null)
            : deny<null>("NOT_AVAILABLE"),
        );
      },
      execute: async (_input, context) => {
        const mine = await own(context.actor).catch(() => null);
        const side = mine?.side ?? "NONE";
        const decisions =
          side === "COMPANY" || feed === undefined
            ? []
            : await feed
                .decisions(context.actor, MY_DECISIONS_MAX * 2)
                .catch(() => []);
        const pick = (decision: "SAVED" | "PASSED") =>
          decisions
            .filter((entry) => entry.decision === decision)
            .slice(0, MY_DECISIONS_MAX)
            .map((entry) => ({
              companyId: entry.companyId,
              name: entry.name.slice(0, 200),
              stageCode: entry.stageCode,
            }));
        const saved = pick("SAVED");
        const passed = pick("PASSED");
        return {
          yourSide: side === "NONE" && decisions.length > 0 ? "INVESTOR" : side,
          relationships: (mine?.items ?? [])
            .slice(0, MY_RELATIONSHIPS_MAX)
            .map((item) => ({
              relationshipId: item.relationshipId,
              counterpart: {
                kind: item.counterpart.kind,
                id: item.counterpart.id,
                name: item.counterpart.name.slice(0, 200),
              },
              state: item.state,
              stateSince: item.stateSince,
              milestones: item.milestones.slice(0, 64).map((m) => ({
                state: m.state,
                at: UtcTimestampSchema.parse(m.at),
              })),
              nextStep: item.nextStep,
            })),
          saved,
          passed,
          truthClass: "VERIFIED",
          source: "Capital Q relationship history",
        };
      },
    },
  );
}

export function createRelationshipTools(
  ports: QToolPorts,
  relationships: RelationshipIntelligencePort,
): readonly AnyQToolDefinition[] {
  const connectionAnswer =
    createProposeConnectionRequestAnswerTool(relationships);
  return [
    createGetRelationshipTool(ports, relationships),
    createListIncomingInterestTool(relationships),
    createProposeExpressInterestTool(ports, relationships),
    createProposeInterestAnswerTool(relationships),
    ...(connectionAnswer === null ? [] : [connectionAnswer]),
    // Action parity (2026-10-02): a founder's Connection Request by name.
    ...(relationships.mayRequestConnection === undefined
      ? []
      : [
          createProposeConnectionRequestTool(
            ports,
            relationships,
            relationships.mayRequestConnection,
          ),
        ]),
    ...(relationships.ownRelationships === undefined
      ? []
      : [
          createListMyRelationshipsTool(
            relationships.ownRelationships,
            ports.investorFeed,
          ),
        ]),
  ];
}
