import { createHash, randomUUID } from "node:crypto";

import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type { CompanyIdentity } from "@capital-q/companies";
import type { CorrelationId } from "@capital-q/contracts";
import {
  InvestorOrganisationIdSchema,
  type InvestorOrganisationId,
} from "@capital-q/investors";
import {
  ActorContextRequiredError,
  capability,
  type ActorContext,
} from "@capital-q/security";

import {
  InterestIdSchema,
  type Interest,
  type InterestDecision,
} from "../contracts/index.js";
import {
  ConnectionNotAcceptedError,
  ConnectionNotPermittedError,
  InterestCompanyNotFoundError,
  InterestIdempotencyConflictError,
  InterestNotFoundError,
  RelationshipPartyNotFoundError,
} from "../domain/errors.js";
import { RELATIONSHIP_EVENT_INTEREST_EXPRESSED } from "../domain/event-registry.js";
import { relationshipInterestExpressedEvent } from "../events/index.js";
import { createRelationshipEventAppender } from "./append-event.js";
import {
  createEnsureRelationshipInTransaction,
  resolveRelationshipParties,
} from "./ensure-relationship.js";
import type { ExpressInterestDependencies } from "./express-interest.js";
import {
  answerInterest,
  type InterestResponseSurface,
} from "./respond-to-interest.js";

/**
 * Founder Connection Requests (ADR 0023; PADL #98; GateQ specification
 * items 11-13): a founder asks an investor organisation to connect, on the
 * ONE canonical relationship, and the investor accepts or declines.
 *
 * Only investors who allow it can be reached, by their own declared inbound
 * preference: OPEN takes requests from any founder; QUALIFIED only from a
 * company that passes the investor's declared mandate rules; CLOSED and not
 * stated take none. The request is an interest expressed by the COMPANY
 * party, so its history, match and relationship state are the same ones an
 * investor's interest produces, never a parallel record.
 */

export const COMPANY_CONNECTION_REQUEST = capability(
  "company.connection.request",
);
export const INVESTOR_CONNECTION_VIEW = capability("investor.connection.view");
export const INVESTOR_CONNECTION_RESPOND = capability(
  "investor.connection.respond",
);

const ACTION_CONNECTION_REQUESTED = AuditActionTypeSchema.parse(
  "relationship.connection_requested",
);
const RESOURCE_INTEREST = AuditResourceTypeSchema.parse("interest");
const INBOX_LIMIT = 200;

/** An investor's declared inbound preference; null is not stated. */
export type InboundPreference = "CLOSED" | "QUALIFIED" | "OPEN" | null;

export type ConnectionRequestDependencies = ExpressInterestDependencies & {
  /** The actor's own active company, from their active organisation. */
  readonly founderSubject: {
    readonly companyFor: (
      actor: ActorContext,
    ) => Promise<{ readonly companyId: string } | null>;
  };
  readonly investorReach: {
    /**
     * The investor as this founder may see it (network-visible, admitted by
     * disclosure), with their inbound preference; null when not visible.
     */
    readonly visibleInvestor: (
      actor: ActorContext,
      investorOrganisationId: string,
    ) => Promise<{ readonly inboundPreference: InboundPreference } | null>;
    /**
     * QUALIFIED only: whether this company passes the investor's declared
     * mandate hard rules (the Recommendation context's eligibility).
     */
    readonly companyQualifies: (
      companyId: string,
      investorOrganisationId: string,
    ) => Promise<boolean>;
  };
};

export type ConnectionRequestResult = {
  readonly interest: Interest;
  readonly deduplicated: boolean;
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Namespaced apart from Express Interest's keys. */
export function hashConnectionRequestIdempotencyKey(key: string): string {
  return sha256Hex(`network.connection.request:${key}`);
}

type Sender = {
  readonly company: CompanyIdentity;
  readonly investorOrganisationId: InvestorOrganisationId;
  readonly inboundPreference: InboundPreference;
};

/** Who is sending, for which company, to which visible investor. */
async function authoriseSender(
  dependencies: ConnectionRequestDependencies,
  actor: ActorContext,
  rawInvestorOrganisationId: string,
): Promise<Sender> {
  if (actor.organisationId === undefined) {
    throw new ActorContextRequiredError();
  }
  const own = await dependencies.founderSubject.companyFor(actor);
  const company =
    own === null
      ? null
      : await dependencies.companies.getCanonicalCompany(
          actor.tenantId,
          own.companyId as CompanyIdentity["id"],
        );
  if (company === null || company.organisationId !== actor.organisationId) {
    throw new ConnectionNotPermittedError();
  }
  try {
    await dependencies.authorization.requireCapability({
      actor,
      capability: COMPANY_CONNECTION_REQUEST,
      resource: {
        kind: "RESOURCE",
        tenantId: company.tenantId,
        organisationId: company.organisationId,
        resourceType: "company",
        resourceId: company.id,
      },
    });
  } catch {
    throw new ConnectionNotPermittedError();
  }
  const parsed = InvestorOrganisationIdSchema.safeParse(
    rawInvestorOrganisationId,
  );
  if (!parsed.success) throw new InterestNotFoundError();
  // Absent and not visible are one answer.
  const investor = await dependencies.investorReach.visibleInvestor(
    actor,
    parsed.data,
  );
  if (investor === null) throw new InterestNotFoundError();
  return {
    company,
    investorOrganisationId: parsed.data,
    inboundPreference: investor.inboundPreference,
  };
}

/** The investor's own rule, applied; throws when they do not take this request. */
async function requireReachable(
  dependencies: ConnectionRequestDependencies,
  sender: Sender,
): Promise<void> {
  switch (sender.inboundPreference) {
    case "OPEN":
      return;
    case "QUALIFIED":
      if (
        await dependencies.investorReach.companyQualifies(
          sender.company.id,
          sender.investorOrganisationId,
        )
      ) {
        return;
      }
      throw new ConnectionNotAcceptedError("NOT_QUALIFIED");
    case "CLOSED":
      throw new ConnectionNotAcceptedError("CLOSED");
    case null:
      throw new ConnectionNotAcceptedError("NOT_STATED");
  }
}

/**
 * Send a Connection Request.
 *
 *   founder's own company -> company.connection.request -> investor visible
 *   to them -> the investor's inbound rule -> transaction: idempotency ->
 *   pair lock -> resolve or create the ONE relationship -> open request?
 *   (no-op) -> `interest_expressed` (relationship_shared) -> interest row
 *   (COMPANY party) -> audit -> outbox -> idempotency record -> COMMIT
 */
export function createRequestConnection(
  dependencies: ConnectionRequestDependencies,
) {
  const { transactions, audit, outbox, interests, interestRequests } =
    dependencies;
  const appender = createRelationshipEventAppender(dependencies);
  const ensureInTransaction =
    createEnsureRelationshipInTransaction(dependencies);

  return async (command: {
    readonly actor: ActorContext;
    readonly investorOrganisationId: string;
    readonly idempotencyKey: string;
    readonly correlationId: CorrelationId;
  }): Promise<ConnectionRequestResult> => {
    const { actor } = command;
    const sender = await authoriseSender(
      dependencies,
      actor,
      command.investorOrganisationId,
    );
    await requireReachable(dependencies, sender);

    let parties;
    try {
      parties = await resolveRelationshipParties(
        dependencies,
        sender.company.id,
        sender.investorOrganisationId,
      );
    } catch (error) {
      if (error instanceof RelationshipPartyNotFoundError) {
        throw new InterestCompanyNotFoundError();
      }
      throw error;
    }
    const organisationId = sender.company.organisationId;
    const keyHash = hashConnectionRequestIdempotencyKey(command.idempotencyKey);
    const requestHash = sha256Hex(
      JSON.stringify({ investorOrganisationId: sender.investorOrganisationId }),
    );
    const source = { type: "DISCOVER" as const };

    return transactions.run(async (tx) => {
      await interestRequests.lock(tx, actor.userId, organisationId, keyHash);
      const previous = await interestRequests.find(
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
        return { interest: replayed, deduplicated: true };
      }
      const remember = (interestId: Interest["id"]) =>
        interestRequests.record(tx, {
          userId: actor.userId,
          organisationId,
          tenantId: actor.tenantId,
          idempotencyKeyHash: keyHash,
          requestHash,
          interestId,
        });

      const { relationship } = await ensureInTransaction(
        tx,
        {
          actor,
          companyId: sender.company.id,
          investorOrganisationId: sender.investorOrganisationId,
          source,
          // The founder found the investor; that alone is never shared.
          visibilityScope: "founder_private",
          correlationId: command.correlationId,
        },
        parties,
      );
      const open = await interests.findOpenByRelationship(
        tx.sql,
        relationship.id,
        "COMPANY",
      );
      if (open !== null) {
        await remember(open.id);
        return { interest: open, deduplicated: true };
      }

      const interestId = InterestIdSchema.parse(randomUUID());
      const event = await appender.append(tx, {
        relationshipId: relationship.id,
        eventType: RELATIONSHIP_EVENT_INTEREST_EXPRESSED,
        actor: { type: actor.actorType, id: actor.userId },
        source,
        // Addressed to the investor: its only scope.
        visibilityScope: "relationship_shared",
        payload: { interestId, expressedByParty: "COMPANY" },
        correlationId: command.correlationId,
      });
      const interest = await interests.insert(tx, {
        id: interestId,
        tenantId: relationship.tenantId,
        relationshipId: relationship.id,
        expressedByParty: "COMPANY",
        expressedByUserId: actor.userId,
        expressedInOrganisationId: organisationId,
        relationshipEventId: event.id,
      });
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION_CONNECTION_REQUESTED,
        resourceType: RESOURCE_INTEREST,
        resourceId: interest.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          relationshipId: relationship.id,
          companyId: relationship.companyId,
          investorOrganisationId: relationship.investorOrganisationId,
          inboundPreference: sender.inboundPreference ?? "NOT_STATED",
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        relationshipInterestExpressedEvent({
          tenantId: relationship.tenantId,
          organisationId,
          actorUserId: actor.userId,
          correlationId: command.correlationId,
          relationshipId: relationship.id,
          interestId: interest.id,
          companyId: relationship.companyId,
          investorOrganisationId: relationship.investorOrganisationId,
        }),
      );
      await remember(interest.id);
      return { interest, deduplicated: false };
    });
  };
}

/**
 * Where this founder stands with an investor: whether they may send a
 * request (and if not, why), and their open request with its answer.
 * Same authorisation as sending; an investor they may not see is
 * not-found, never "closed".
 */
export function createGetConnectionStatus(
  dependencies: ConnectionRequestDependencies,
) {
  return async (query: {
    readonly actor: ActorContext;
    readonly investorOrganisationId: string;
  }): Promise<{
    readonly canRequest: boolean;
    readonly notAccepted: ConnectionNotAcceptedError["reason"] | null;
    readonly request: Interest | null;
  }> => {
    const sender = await authoriseSender(
      dependencies,
      query.actor,
      query.investorOrganisationId,
    );
    let notAccepted: ConnectionNotAcceptedError["reason"] | null = null;
    try {
      await requireReachable(dependencies, sender);
    } catch (error) {
      if (!(error instanceof ConnectionNotAcceptedError)) throw error;
      notAccepted = error.reason;
    }
    const relationship =
      await dependencies.repositories.relationships.findByParties(
        dependencies.sql,
        sender.company.id,
        sender.investorOrganisationId,
      );
    const request =
      relationship === null
        ? null
        : await dependencies.interests.findOpenByRelationship(
            dependencies.sql,
            relationship.id,
            "COMPANY",
          );
    return {
      canRequest: notAccepted === null && request === null,
      notAccepted,
      request,
    };
  };
}

/** The investor organisation the actor acts for, with the capability checked. */
async function authoriseInvestor(
  dependencies: ConnectionRequestDependencies,
  actor: ActorContext,
  required: typeof INVESTOR_CONNECTION_VIEW,
): Promise<InvestorOrganisationId> {
  if (actor.organisationId === undefined) {
    throw new ActorContextRequiredError();
  }
  const subject =
    await dependencies.investorSubject.investorOrganisationFor(actor);
  if (subject === null) throw new InterestNotFoundError();
  const investorOrganisationId = InvestorOrganisationIdSchema.parse(
    subject.investorOrganisationId,
  );
  await dependencies.authorization.requireCapability({
    actor,
    capability: required,
    resource: {
      kind: "RESOURCE",
      tenantId: actor.tenantId,
      organisationId: actor.organisationId,
      resourceType: "investor_organisation",
      resourceId: investorOrganisationId,
    },
  });
  return investorOrganisationId;
}

/** The investor's inbox: open Connection Requests, newest first, with answers. */
export function createListConnectionRequests(
  dependencies: ConnectionRequestDependencies,
) {
  return async (query: {
    readonly actor: ActorContext;
  }): Promise<
    readonly {
      readonly interest: Interest;
      readonly company: CompanyIdentity;
    }[]
  > => {
    const investorOrganisationId = await authoriseInvestor(
      dependencies,
      query.actor,
      INVESTOR_CONNECTION_VIEW,
    );
    const listed = await dependencies.interests.listByInvestor(
      dependencies.sql,
      investorOrganisationId,
      INBOX_LIMIT,
    );
    const out: { interest: Interest; company: CompanyIdentity }[] = [];
    for (const interest of listed) {
      const company = await dependencies.companies.findCanonicalCompany(
        interest.companyId,
      );
      if (company !== null) out.push({ interest, company });
    }
    return out;
  };
}

/** The investor answers a founder's request: the same answer path as a company's. */
export function createRespondToConnectionRequest(
  dependencies: ConnectionRequestDependencies,
) {
  return async (command: {
    readonly actor: ActorContext;
    readonly interestId: string;
    readonly decision: InterestDecision;
    readonly surface: InterestResponseSurface;
    readonly idempotencyKey: string;
    readonly correlationId: CorrelationId;
  }): Promise<
    ConnectionRequestResult & { readonly company: CompanyIdentity }
  > => {
    const investorOrganisationId = await authoriseInvestor(
      dependencies,
      command.actor,
      INVESTOR_CONNECTION_RESPOND,
    );
    const parsed = InterestIdSchema.safeParse(command.interestId);
    if (!parsed.success) throw new InterestNotFoundError();
    const interest = await dependencies.interests.findById(
      dependencies.sql,
      parsed.data,
    );
    // Only a founder's request to THIS investor is theirs to answer. An
    // answered one still reaches answerInterest: a replay returns the
    // recorded answer, a second decision is refused there.
    if (
      interest === null ||
      interest.expressedByParty !== "COMPANY" ||
      interest.investorOrganisationId !== investorOrganisationId
    ) {
      throw new InterestNotFoundError();
    }
    const organisationId = command.actor.organisationId;
    if (organisationId === undefined) throw new ActorContextRequiredError();
    const company = await dependencies.companies.findCanonicalCompany(
      interest.companyId,
    );
    if (company === null) throw new InterestNotFoundError();
    const answered = await answerInterest(dependencies, {
      actor: command.actor,
      interest,
      responderOrganisationId: organisationId,
      respondedByParty: "INVESTOR",
      decision: command.decision,
      surface: command.surface,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
    });
    return {
      interest: answered.interest,
      deduplicated: answered.deduplicated,
      company,
    };
  };
}
