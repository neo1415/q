import {
  toIncomingInterestDto,
  toRelationshipStatusDto,
  type InterestService,
} from "@capital-q/network";
import type { Logger } from "@capital-q/observability";
import type {
  QActionProposal,
  QActionProposer,
  QActionRefusal,
} from "@capital-q/q-actions";
import type { RelationshipIntelligencePort } from "@capital-q/q-tools";

import {
  ExpressInterestPayloadSchema,
  RELATIONSHIP_INTEREST_EXPRESS,
} from "./express-interest-action.js";
import {
  RELATIONSHIP_INTEREST_RESPOND,
  RespondToInterestPayloadSchema,
} from "./respond-to-interest-action.js";

/**
 * Relationship intelligence for Q (CQ-Q-030), composed over the Network
 * context's InterestService -- the same service the screens call -- and
 * over a per-run board that hands a relationship action to the Approval
 * Engine.
 *
 * The board is the only thing a relationship tool writes. It holds one
 * prepared action per run, for the run's own person and tenant, until the
 * run's prepare step asks the proposer; the engine then persists the exact
 * payload and requests the person's approval. Nothing on the board can
 * execute: execution is the approved action's, through the same command
 * the button calls, under the approver's authority.
 */

const READING_TTL_MS = 10 * 60 * 1000;

type Prepared = {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly actionType:
    "relationship.interest.express" | "relationship.interest.respond";
  readonly payload: Readonly<Record<string, string>>;
  readonly at: number;
};

export type RelationshipActionBoard = {
  readonly prepareForApproval: RelationshipIntelligencePort["prepareForApproval"];
  readonly proposer: QActionProposer;
};

export function createRelationshipActionBoard(
  options: {
    readonly logger?: Logger | undefined;
    readonly now?: (() => number) | undefined;
  } = {},
): RelationshipActionBoard {
  const now = options.now ?? (() => Date.now());
  const prepared = new Map<string, Prepared>();
  const sweep = () => {
    const cutoff = now() - READING_TTL_MS;
    for (const [runId, entry] of prepared) {
      if (entry.at < cutoff) prepared.delete(runId);
    }
  };
  return {
    prepareForApproval: (entry) => {
      sweep();
      const existing = prepared.get(entry.runId);
      if (existing !== undefined) {
        // The same action asked for twice in one answer is one proposal;
        // a different one waits for the person to settle the first.
        return existing.actionType === entry.actionType &&
          JSON.stringify(existing.payload) === JSON.stringify(entry.payload)
          ? "PREPARED"
          : "ONE_PER_TURN";
      }
      prepared.set(entry.runId, { ...entry, at: now() });
      return "PREPARED";
    },
    proposer: {
      propose: (context) => {
        const entry = prepared.get(context.runId);
        if (entry === undefined) return Promise.resolve(null);
        prepared.delete(context.runId);
        // Bound to the person and tenant the tool ran for, and checked
        // against the action's own payload schema on the way out.
        if (
          entry.tenantId !== context.actor.tenantId ||
          entry.actorUserId !== context.actor.userId
        ) {
          return Promise.resolve(null);
        }
        const schema =
          entry.actionType === "relationship.interest.express"
            ? ExpressInterestPayloadSchema
            : RespondToInterestPayloadSchema;
        const parsed = schema.safeParse(entry.payload);
        if (!parsed.success) {
          options.logger?.warn(
            { qRunId: context.runId, actionType: entry.actionType },
            "a prepared relationship action did not fit its payload",
          );
          return Promise.resolve({
            refused: "that isn't something I can prepare from here",
          });
        }
        return Promise.resolve({
          actionType:
            entry.actionType === "relationship.interest.express"
              ? RELATIONSHIP_INTEREST_EXPRESS
              : RELATIONSHIP_INTEREST_RESPOND,
          payload: parsed.data,
        });
      },
    },
  };
}

/** Several proposers, asked in order; the first with something for this run wins. */
export function chainProposers(
  ...proposers: readonly QActionProposer[]
): QActionProposer {
  return {
    propose: async (
      context,
    ): Promise<QActionProposal | QActionRefusal | null> => {
      for (const proposer of proposers) {
        const proposal = await proposer.propose(context);
        if (proposal !== null) return proposal;
      }
      return null;
    },
  };
}

export function createRelationshipIntelligencePort(dependencies: {
  readonly interests: InterestService;
  readonly board: RelationshipActionBoard;
}): RelationshipIntelligencePort {
  const { interests, board } = dependencies;
  return {
    withCompany: async (actor, companyId) => {
      const status = await interests.relationshipForInvestor({
        actor,
        companyId,
      });
      return status === null ? null : toRelationshipStatusDto(status);
    },
    withInvestor: async (actor, investorOrganisationId) => {
      const status = await interests.relationshipForCompany({
        actor,
        investorOrganisationId,
      });
      return status === null ? null : toRelationshipStatusDto(status);
    },
    byRelationship: async (actor, relationshipId) => {
      const view = await interests.relationshipById({ actor, relationshipId });
      return view === null
        ? null
        : {
            side: view.side,
            counterpart: view.counterpart,
            status:
              view.status === null
                ? null
                : toRelationshipStatusDto(view.status),
          };
    },
    incomingInterest: async (actor, companyId) =>
      (await interests.listIncomingInterest({ actor, companyId })).map(
        ({ interest, investor }) => toIncomingInterestDto(interest, investor),
      ),
    mayExpressInterest: (actor, companyId) =>
      interests.mayExpressInterest({ actor, companyId }),
    mayAnswerInterest: (actor, interestId) =>
      interests.mayRespondToInterest({ actor, interestId }),
    prepareForApproval: board.prepareForApproval,
  };
}
