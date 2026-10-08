import {
  InterestNotPermittedError,
  toIncomingInterestDto,
  toRelationshipStatusDto,
  toRelationshipSummaryDto,
  type ConnectionService,
  type InterestService,
  type RelationshipListing,
} from "@capital-q/network";
import type { Logger } from "@capital-q/observability";
import type {
  QActionProposal,
  QActionProposer,
  QActionRefusal,
} from "@capital-q/q-actions";
import type {
  OwnRelationship,
  RelationshipIntelligencePort,
} from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

import {
  ConnectionRequestAnswerPayloadSchema,
  RELATIONSHIP_CONNECTION_REQUEST_RESPOND,
} from "./connection-request-answer-action.js";
import {
  ConnectionRequestSendPayloadSchema,
  RELATIONSHIP_CONNECTION_REQUEST_SEND,
} from "./connection-request-send-action.js";
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
    | "relationship.interest.express"
    | "relationship.interest.respond"
    | "relationship.connection_request.respond"
    | "relationship.connection_request.send";
  readonly payload: Readonly<Record<string, string | null>>;
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
            : entry.actionType === "relationship.connection_request.respond"
              ? ConnectionRequestAnswerPayloadSchema
              : entry.actionType === "relationship.connection_request.send"
                ? ConnectionRequestSendPayloadSchema
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
              : entry.actionType === "relationship.connection_request.respond"
                ? RELATIONSHIP_CONNECTION_REQUEST_RESPOND
                : entry.actionType === "relationship.connection_request.send"
                  ? RELATIONSHIP_CONNECTION_REQUEST_SEND
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

function ownRow(
  listing: RelationshipListing,
  side: "INVESTOR" | "COMPANY",
): OwnRelationship {
  return {
    ...toRelationshipSummaryDto(listing, side),
    milestones: toRelationshipStatusDto(listing).milestones,
  };
}

export function createRelationshipIntelligencePort(dependencies: {
  readonly interests: InterestService;
  readonly board: RelationshipActionBoard;
  /**
   * The actor's own company, resolved from their membership on the server
   * (CQ-QX-008); absent, a founder's own relationships are not listed.
   */
  readonly ownCompany?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
  /** An investor's own inbox of founders' Connection Requests (ADR 0023). */
  readonly connections?:
    | Pick<ConnectionService, "listConnectionRequests" | "connectionStatus">
    | undefined;
  /**
   * The latest chat message of each of these relationships (already the
   * actor's own, listed above), by side. Absent: not annotated.
   */
  readonly latestMessages?:
    | ((relationshipIds: readonly string[]) => Promise<
        ReadonlyMap<
          string,
          {
            readonly side: "INVESTOR" | "COMPANY";
            readonly at: string;
            readonly body: string;
          }
        >
      >)
    | undefined;
}): RelationshipIntelligencePort {
  const { interests, board, ownCompany, connections, latestMessages } =
    dependencies;
  // Who wrote last, from the actor's side: never fails the list.
  const withLatest = async (
    side: "INVESTOR" | "COMPANY",
    items: readonly OwnRelationship[],
  ): Promise<readonly OwnRelationship[]> => {
    if (latestMessages === undefined || items.length === 0) return items;
    const latest = await latestMessages(
      items.map((item) => item.relationshipId),
    ).catch(() => null);
    if (latest === null) return items;
    return items.map((item) => {
      const message = latest.get(item.relationshipId);
      return message === undefined
        ? item
        : {
            ...item,
            lastMessage: {
              from: message.side === side ? "YOU" : "THEM",
              at: message.at,
              preview: message.body.replace(/\s+/g, " ").trim().slice(0, 240),
            },
          };
    });
  };
  return {
    // Interest waiting in their own company's inbox, named so "accept
    // Kazikit's interest" can find it (lead 2026-10-03): the company from
    // their membership, the list from the Network context's own read.
    ...(ownCompany === undefined
      ? {}
      : {
          pendingInterests: async (actor: ActorContext) => {
            const companyId = await ownCompany(actor);
            if (companyId === null) return [];
            return (await interests.listIncomingInterest({ actor, companyId }))
              .filter(
                ({ interest }) =>
                  interest.status === "EXPRESSED" && interest.response === null,
              )
              .map(({ interest, investor }) => ({
                interestId: interest.id,
                companyId,
                investorOrganisationId: interest.investorOrganisationId,
                investorName: investor.displayName,
              }));
          },
        }),
    // A founder's Connection Request (action parity 2026-10-02): the
    // investor page's own check, as the person; writes nothing.
    ...(connections === undefined
      ? {}
      : {
          mayRequestConnection: async (
            actor: ActorContext,
            investorOrganisationId: string,
          ) =>
            (
              await connections
                .connectionStatus({ actor, investorOrganisationId })
                .catch(() => null)
            )?.canRequest === true,
        }),
    ...(connections === undefined
      ? {}
      : {
          pendingConnectionRequests: async (actor: ActorContext) =>
            (await connections.listConnectionRequests({ actor }))
              .filter(
                ({ interest }) =>
                  interest.status === "EXPRESSED" && interest.response === null,
              )
              .map(({ interest, company }) => ({
                interestId: interest.id,
                companyId: interest.companyId,
                companyName: company.canonicalName,
                relationshipId: interest.relationshipId,
              })),
        }),
    /**
     * R35: the same lists the relationships screen reads. An investor's
     * member first (the Network context resolves the organisation from the
     * membership and refuses anyone else); otherwise the member's own
     * company. Anything else -- no side at all -- is null.
     */
    ownRelationships: async (actor) => {
      try {
        const items = await interests.listRelationshipsForInvestor({ actor });
        return {
          side: "INVESTOR",
          items: await withLatest(
            "INVESTOR",
            items.map((item) => ownRow(item, "INVESTOR")),
          ),
        };
      } catch (error) {
        if (!(error instanceof InterestNotPermittedError)) throw error;
      }
      const companyId =
        ownCompany === undefined ? null : await ownCompany(actor);
      if (companyId === null) return null;
      const items = await interests.listRelationshipsForCompany({
        actor,
        companyId,
      });
      return {
        side: "COMPANY",
        items: await withLatest(
          "COMPANY",
          items.map((item) => ownRow(item, "COMPANY")),
        ),
      };
    },
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
