import { createHash, randomUUID } from "node:crypto";

import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import {
  CompanyIdSchema,
  type CompanyId,
  type CompanyIdentity,
} from "@capital-q/companies";
import type {
  CorrelationId,
  RelationshipSourceType,
} from "@capital-q/contracts";
import type { InvestorOrganisationIdentity } from "@capital-q/investors";
import {
  ActorContextRequiredError,
  capability,
  type ActorContext,
} from "@capital-q/security";

import {
  InterestIdSchema,
  InterestResponseIdSchema,
  MatchIdSchema,
  type Interest,
  type InterestDecision,
} from "../contracts/index.js";
import {
  InterestAlreadyAnsweredError,
  InterestIdempotencyConflictError,
  InterestNotFoundError,
} from "../domain/errors.js";
import {
  RELATIONSHIP_EVENT_CONNECTION_ACCEPTED,
  RELATIONSHIP_EVENT_INTEREST_DECLINED,
} from "../domain/event-registry.js";
import { interestAnsweredEvent } from "../events/index.js";
import { createRelationshipEventAppender } from "./append-event.js";
import type { ExpressInterestDependencies } from "./express-interest.js";

export const COMPANY_INTEREST_VIEW = capability("company.interest.view");
export const COMPANY_INTEREST_RESPOND = capability("company.interest.respond");

const ACTION_ACCEPTED = AuditActionTypeSchema.parse(
  "relationship.interest_accepted",
);
const ACTION_DECLINED = AuditActionTypeSchema.parse(
  "relationship.interest_declined",
);
const RESOURCE_INTEREST = AuditResourceTypeSchema.parse("interest");

const INBOX_LIMIT = 200;

/** Where the company answered from. Provenance only, never authority. */
export type InterestResponseSurface = "INBOX" | "Q_CONVERSATION";

const SOURCE_BY_SURFACE: Readonly<
  Record<InterestResponseSurface, RelationshipSourceType>
> = {
  INBOX: "MANUAL",
  Q_CONVERSATION: "Q",
};

export type RespondToInterestCommand = {
  /** Trusted, server-resolved: person, tenant, organisation. */
  readonly actor: ActorContext;
  /** Input, never proof: resolved to its company and checked below. */
  readonly interestId: string;
  readonly decision: InterestDecision;
  readonly surface: InterestResponseSurface;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

export type RespondToInterestResult = {
  /** Re-read with its answer and, for an acceptance, its match. */
  readonly interest: Interest;
  /** The investor organisation, for the company's own view of it. */
  readonly investor: InvestorOrganisationIdentity;
  /** True when this answer had already been recorded: nothing new was written. */
  readonly deduplicated: boolean;
};

export type IncomingInterest = {
  readonly interest: Interest;
  readonly investor: InvestorOrganisationIdentity;
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Namespaced so a key reused for another command can never collide. */
export function hashInterestResponseIdempotencyKey(key: string): string {
  return sha256Hex(`network.interest.respond:${key}`);
}

/** The interest and the answer are the whole meaning of the command. */
export function hashRespondToInterestRequest(
  interestId: string,
  decision: InterestDecision,
): string {
  return sha256Hex(JSON.stringify({ decision, interestId }));
}

/**
 * The actor acts for the company's own organisation, in its tenant, and
 * holds the capability on that company. Anything else about a company is
 * not-found: a founder of another company cannot learn whether it has
 * interest, or whether it exists.
 */
async function authoriseForCompany(
  dependencies: ExpressInterestDependencies,
  actor: ActorContext,
  companyId: CompanyId,
  required: typeof COMPANY_INTEREST_VIEW,
): Promise<CompanyIdentity> {
  if (actor.organisationId === undefined) {
    throw new ActorContextRequiredError();
  }
  const company = await dependencies.companies.findCanonicalCompany(companyId);
  if (
    company === null ||
    company.tenantId !== actor.tenantId ||
    company.organisationId !== actor.organisationId
  ) {
    throw new InterestNotFoundError();
  }
  await dependencies.authorization.requireCapability({
    actor,
    capability: required,
    resource: {
      kind: "RESOURCE",
      tenantId: company.tenantId,
      organisationId: company.organisationId,
      resourceType: "company",
      resourceId: company.id,
    },
  });
  return company;
}

/** The interest, if it is open and addressed to a company the actor may answer for. */
async function authoriseForInterest(
  dependencies: ExpressInterestDependencies,
  actor: ActorContext,
  rawInterestId: string,
): Promise<{ readonly interest: Interest; readonly company: CompanyIdentity }> {
  const parsed = InterestIdSchema.safeParse(rawInterestId);
  if (!parsed.success) throw new InterestNotFoundError();
  const interest = await dependencies.interests.findById(
    dependencies.sql,
    parsed.data,
  );
  if (interest === null || interest.status !== "EXPRESSED") {
    throw new InterestNotFoundError();
  }
  const company = await authoriseForCompany(
    dependencies,
    actor,
    interest.companyId,
    COMPANY_INTEREST_RESPOND,
  );
  return { interest, company };
}

async function investorOf(
  dependencies: ExpressInterestDependencies,
  interest: Interest,
): Promise<InvestorOrganisationIdentity> {
  const investor =
    await dependencies.investors.findCanonicalInvestorOrganisation(
      interest.investorOrganisationId,
    );
  if (investor === null) throw new InterestNotFoundError();
  return investor;
}

/**
 * The company answers an investor's interest (CQ-NET-011).
 *
 *   company member for the interest's company -> company.interest.respond
 *   -> transaction: idempotency lock/lookup -> pair lock -> already
 *   answered? (same answer: no-op; other answer: conflict) -> history
 *   event on the SAME relationship (connection_accepted {interestId,
 *   matchId} | interest_declined {interestId}, relationship_shared) ->
 *   answer row -> match (acceptance only) -> audit -> outbox -> idempotency
 *   record -> COMMIT
 *
 * Nothing computes relationship state: current_state is the projector's
 * (CQ-NET-012). A decline carries no reason and opens nothing; nothing
 * here sends a message (CQ-COMM-001).
 */
export function createRespondToInterest(
  dependencies: ExpressInterestDependencies,
) {
  const {
    transactions,
    audit,
    outbox,
    interests,
    interestResponses,
    interestResponseRequests,
    repositories,
  } = dependencies;
  const appender = createRelationshipEventAppender(dependencies);

  return async (
    command: RespondToInterestCommand,
  ): Promise<RespondToInterestResult> => {
    const { actor, decision } = command;
    const { interest, company } = await authoriseForInterest(
      dependencies,
      actor,
      command.interestId,
    );
    const investor = await investorOf(dependencies, interest);
    const organisationId = company.organisationId;
    const keyHash = hashInterestResponseIdempotencyKey(command.idempotencyKey);
    const requestHash = hashRespondToInterestRequest(interest.id, decision);

    return transactions.run(async (tx) => {
      await interestResponseRequests.lock(
        tx,
        actor.userId,
        organisationId,
        keyHash,
      );
      const previous = await interestResponseRequests.find(
        tx,
        actor.userId,
        organisationId,
        keyHash,
      );
      if (previous !== null) {
        if (previous.requestHash !== requestHash) {
          throw new InterestIdempotencyConflictError();
        }
        const replayed = await interests.findById(tx.sql, previous.interestId);
        if (replayed === null) throw new InterestIdempotencyConflictError();
        return { interest: replayed, investor, deduplicated: true };
      }

      // The pair lock serialises two members answering at once, and an
      // answer racing a new expression on the same relationship.
      await repositories.relationships.lockPair(
        tx,
        interest.companyId,
        interest.investorOrganisationId,
      );
      const current = await interests.findById(tx.sql, interest.id);
      if (current === null || current.status !== "EXPRESSED") {
        throw new InterestNotFoundError();
      }
      if (current.response !== null) {
        if (current.response.decision !== decision) {
          throw new InterestAlreadyAnsweredError();
        }
        await interestResponseRequests.record(tx, {
          userId: actor.userId,
          organisationId,
          tenantId: actor.tenantId,
          idempotencyKeyHash: keyHash,
          requestHash,
          interestResponseId: current.response.id,
        });
        return { interest: current, investor, deduplicated: true };
      }

      const responseId = InterestResponseIdSchema.parse(randomUUID());
      const matchId =
        decision === "ACCEPTED" ? MatchIdSchema.parse(randomUUID()) : null;
      const source = { type: SOURCE_BY_SURFACE[command.surface] };
      const event = await appender.append(tx, {
        relationshipId: current.relationshipId,
        eventType:
          decision === "ACCEPTED"
            ? RELATIONSHIP_EVENT_CONNECTION_ACCEPTED
            : RELATIONSHIP_EVENT_INTEREST_DECLINED,
        actor: { type: actor.actorType, id: actor.userId },
        source,
        visibilityScope: "relationship_shared",
        payload:
          matchId === null
            ? { interestId: current.id }
            : { interestId: current.id, matchId },
        correlationId: command.correlationId,
      });
      await interestResponses.insert(tx, {
        id: responseId,
        tenantId: current.tenantId,
        relationshipId: current.relationshipId,
        interestId: current.id,
        decision,
        respondedByUserId: actor.userId,
        respondedInOrganisationId: organisationId,
        relationshipEventId: event.id,
      });
      if (matchId !== null) {
        await interestResponses.insertMatch(tx, {
          id: matchId,
          tenantId: current.tenantId,
          relationshipId: current.relationshipId,
          interestResponseId: responseId,
        });
      }
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: decision === "ACCEPTED" ? ACTION_ACCEPTED : ACTION_DECLINED,
        resourceType: RESOURCE_INTEREST,
        resourceId: current.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          relationshipId: current.relationshipId,
          companyId: current.companyId,
          investorOrganisationId: current.investorOrganisationId,
          ...(matchId === null ? {} : { matchId }),
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        interestAnsweredEvent({
          decision,
          tenantId: current.tenantId,
          organisationId,
          actorUserId: actor.userId,
          correlationId: command.correlationId,
          relationshipId: current.relationshipId,
          interestId: current.id,
          matchId,
          companyId: current.companyId,
          investorOrganisationId: current.investorOrganisationId,
        }),
      );
      await interestResponseRequests.record(tx, {
        userId: actor.userId,
        organisationId,
        tenantId: actor.tenantId,
        idempotencyKeyHash: keyHash,
        requestHash,
        interestResponseId: responseId,
      });
      const answered = await interests.findById(tx.sql, current.id);
      if (answered === null) throw new InterestNotFoundError();
      return { interest: answered, investor, deduplicated: false };
    });
  };
}

/**
 * The company's inbox: open interests addressed to it, each with its
 * answer. Same authorisation as answering, with the view capability.
 */
export function createListIncomingInterest(
  dependencies: ExpressInterestDependencies,
) {
  return async (query: {
    readonly actor: ActorContext;
    readonly companyId: string;
  }): Promise<readonly IncomingInterest[]> => {
    const parsed = CompanyIdSchema.safeParse(query.companyId);
    if (!parsed.success) throw new InterestNotFoundError();
    const company = await authoriseForCompany(
      dependencies,
      query.actor,
      parsed.data,
      COMPANY_INTEREST_VIEW,
    );
    const listed = await dependencies.interests.listByCompany(
      dependencies.sql,
      company.id,
      INBOX_LIMIT,
    );
    const out: IncomingInterest[] = [];
    for (const interest of listed) {
      const investor =
        await dependencies.investors.findCanonicalInvestorOrganisation(
          interest.investorOrganisationId,
        );
      if (investor !== null) out.push({ interest, investor });
    }
    return out;
  };
}

/** The answer command's authorisation only, for Q's approval gate. Writes nothing. */
export function createMayRespondToInterest(
  dependencies: ExpressInterestDependencies,
) {
  return async (query: {
    readonly actor: ActorContext;
    readonly interestId: string;
  }): Promise<boolean> => {
    try {
      await authoriseForInterest(dependencies, query.actor, query.interestId);
      return true;
    } catch {
      return false;
    }
  };
}
