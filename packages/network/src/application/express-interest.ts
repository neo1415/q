import { createHash, randomUUID } from "node:crypto";

import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import { CompanyIdSchema, type CompanyId } from "@capital-q/companies";
import type {
  CorrelationId,
  RelationshipSourceType,
} from "@capital-q/contracts";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import {
  ActorContextRequiredError,
  capability,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import { InterestIdSchema, type Interest } from "../contracts/index.js";
import {
  InterestCompanyNotFoundError,
  InterestIdempotencyConflictError,
  InterestNotPermittedError,
  RelationshipPartyNotFoundError,
} from "../domain/errors.js";
import { RELATIONSHIP_EVENT_INTEREST_EXPRESSED } from "../domain/event-registry.js";
import { relationshipInterestExpressedEvent } from "../events/index.js";
import { createRelationshipEventAppender } from "./append-event.js";
import type { NetworkServiceDependencies } from "./dependencies.js";
import {
  createEnsureRelationshipInTransaction,
  resolveRelationshipParties,
} from "./ensure-relationship.js";
import type {
  InterestRepository,
  InterestRequestStore,
  InterestResponseRepository,
  InterestResponseRequestStore,
} from "./ports.js";

export const INVESTOR_INTEREST_EXPRESS = capability(
  "investor.interest.express",
);

const ACTION_INTEREST_EXPRESSED = AuditActionTypeSchema.parse(
  "relationship.interest_expressed",
);
const RESOURCE_INTEREST = AuditResourceTypeSchema.parse("interest");

/**
 * Where the person was when they asked. Provenance for the history row,
 * never authority: every surface passes the same checks.
 */
export type InterestSurface =
  "RECOMMENDATION_FEED" | "COMPANY_PROFILE" | "Q_CONVERSATION";

const SOURCE_BY_SURFACE: Readonly<
  Record<InterestSurface, RelationshipSourceType>
> = {
  RECOMMENDATION_FEED: "RECOMMENDATION",
  COMPANY_PROFILE: "DISCOVER",
  Q_CONVERSATION: "Q",
};

export type ExpressInterestCommand = {
  /** Trusted, server-resolved. Supplies person, tenant and organisation. */
  readonly actor: ActorContext;
  /** Input, never proof: checked for existence and visibility below. */
  readonly companyId: string;
  readonly surface: InterestSurface;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

export type ExpressInterestResult = {
  readonly interest: Interest;
  /** True when nothing new was written: a replay, or interest already expressed. */
  readonly deduplicated: boolean;
};

/**
 * What Express Interest needs beyond the Network core. Both ports are the
 * composition root's, so the rule "who is this investor" and "may they see
 * this company" is the same one the feed and the company page already use,
 * not a second copy here.
 */
export type ExpressInterestDependencies = NetworkServiceDependencies & {
  readonly authorization: AuthorizationService;
  /** The actor's own investor organisation, from their active organisation. */
  readonly investorSubject: {
    readonly investorOrganisationFor: (
      actor: ActorContext,
    ) => Promise<{ readonly investorOrganisationId: string } | null>;
  };
  readonly companyVisibility: {
    /** The network preview's rule: network-visible or public to this actor. */
    readonly isVisibleToInvestor: (
      actor: ActorContext,
      companyId: CompanyId,
    ) => Promise<boolean>;
  };
  readonly interests: InterestRepository;
  readonly interestRequests: InterestRequestStore;
  /** The company's answer (CQ-NET-011). */
  readonly interestResponses: InterestResponseRepository;
  readonly interestResponseRequests: InterestResponseRequestStore;
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Namespaced so a key reused for another command can never collide. */
export function hashInterestIdempotencyKey(key: string): string {
  return sha256Hex(`network.interest.express:${key}`);
}

/**
 * The request fingerprint (doc 22 §43). The company is the whole meaning of
 * the command; the surface is provenance, so a retry that reports a
 * different surface is still the same request.
 */
export function hashExpressInterestRequest(companyId: string): string {
  return sha256Hex(JSON.stringify({ companyId }));
}

type Authorised = {
  readonly organisationId: string;
  readonly investorOrganisationId: ReturnType<
    typeof InvestorOrganisationIdSchema.parse
  >;
  readonly companyId: CompanyId;
};

/**
 * Who is asking, for which investor organisation, about which company —
 * each answered from trusted state. Shared by the command and the status
 * read so the two cannot disagree about who may see an interest.
 */
async function authorise(
  dependencies: ExpressInterestDependencies,
  actor: ActorContext,
  rawCompanyId: string,
): Promise<Authorised> {
  if (actor.organisationId === undefined) {
    throw new ActorContextRequiredError();
  }
  const subject =
    await dependencies.investorSubject.investorOrganisationFor(actor);
  if (subject === null) {
    throw new InterestNotPermittedError();
  }
  const investorOrganisationId = InvestorOrganisationIdSchema.parse(
    subject.investorOrganisationId,
  );
  await dependencies.authorization.requireCapability({
    actor,
    capability: INVESTOR_INTEREST_EXPRESS,
    resource: {
      kind: "RESOURCE",
      tenantId: actor.tenantId,
      organisationId: actor.organisationId,
      resourceType: "investor_organisation",
      resourceId: investorOrganisationId,
    },
  });

  const parsed = CompanyIdSchema.safeParse(rawCompanyId);
  if (!parsed.success) {
    throw new InterestCompanyNotFoundError();
  }
  // Absent and not-visible are one answer: the command must not become a
  // way to ask whether a private company exists.
  const visible = await dependencies.companyVisibility.isVisibleToInvestor(
    actor,
    parsed.data,
  );
  if (!visible) {
    throw new InterestCompanyNotFoundError();
  }
  return {
    organisationId: actor.organisationId,
    investorOrganisationId,
    companyId: parsed.data,
  };
}

/**
 * Express Interest (CQ-NET-010): an investor organisation tells a company
 * it would like to explore it.
 *
 *   investor organisation for the actor -> investor.interest.express ->
 *   company visible to this investor (network preview rule) -> parties ->
 *   transaction: idempotency lock/lookup -> pair lock -> resolve or create
 *   the ONE relationship (+ `discovered`, investor_private) -> open
 *   interest? (no-op) -> `interest_expressed` (relationship_shared) ->
 *   interest row -> audit -> network.relationship.interest_expressed ->
 *   idempotency record -> COMMIT
 *
 * Interest ≠ Match: no match, connection or state is written, and
 * `current_state` stays the projector's (CQ-NET-012). Expressing interest
 * twice is one interest and one history event. The transaction makes no
 * external call.
 */
export function createExpressInterest(
  dependencies: ExpressInterestDependencies,
) {
  const { transactions, audit, outbox, interests, interestRequests } =
    dependencies;
  const appender = createRelationshipEventAppender(dependencies);
  const ensureInTransaction =
    createEnsureRelationshipInTransaction(dependencies);

  return async (
    command: ExpressInterestCommand,
  ): Promise<ExpressInterestResult> => {
    const { actor } = command;
    const authorised = await authorise(dependencies, actor, command.companyId);

    let parties;
    try {
      parties = await resolveRelationshipParties(
        dependencies,
        authorised.companyId,
        authorised.investorOrganisationId,
      );
    } catch (error) {
      if (error instanceof RelationshipPartyNotFoundError) {
        throw new InterestCompanyNotFoundError();
      }
      throw error;
    }
    // An organisation does not court itself.
    if (parties.company.organisationId === authorised.organisationId) {
      throw new InterestNotPermittedError();
    }

    const keyHash = hashInterestIdempotencyKey(command.idempotencyKey);
    const requestHash = hashExpressInterestRequest(authorised.companyId);
    const source = { type: SOURCE_BY_SURFACE[command.surface] };

    return transactions.run(async (tx) => {
      await interestRequests.lock(
        tx,
        actor.userId,
        authorised.organisationId,
        keyHash,
      );
      const previous = await interestRequests.find(
        tx,
        actor.userId,
        authorised.organisationId,
        keyHash,
      );
      if (previous !== null) {
        if (previous.requestHash !== requestHash) {
          throw new InterestIdempotencyConflictError();
        }
        const replayed = await interests.findById(tx.sql, previous.interestId);
        if (replayed === null) {
          throw new InterestIdempotencyConflictError();
        }
        return { interest: replayed, deduplicated: true };
      }

      const remember = (interestId: Interest["id"]) =>
        interestRequests.record(tx, {
          userId: actor.userId,
          organisationId: authorised.organisationId,
          tenantId: actor.tenantId,
          idempotencyKeyHash: keyHash,
          requestHash,
          interestId,
        });

      // Holds the pair lock until commit, so two members of the same
      // organisation expressing at once still produce one interest.
      const { relationship } = await ensureInTransaction(
        tx,
        {
          actor,
          companyId: authorised.companyId,
          investorOrganisationId: authorised.investorOrganisationId,
          source,
          // The investor found the company; that alone is never shared.
          visibilityScope: "investor_private",
          correlationId: command.correlationId,
        },
        parties,
      );

      const open = await interests.findOpenByRelationship(
        tx.sql,
        relationship.id,
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
        // Interest is addressed to the founders: its only scope.
        visibilityScope: "relationship_shared",
        payload: { interestId },
        correlationId: command.correlationId,
      });
      const interest = await interests.insert(tx, {
        id: interestId,
        tenantId: relationship.tenantId,
        relationshipId: relationship.id,
        expressedByUserId: actor.userId,
        expressedInOrganisationId: authorised.organisationId,
        relationshipEventId: event.id,
      });
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION_INTEREST_EXPRESSED,
        resourceType: RESOURCE_INTEREST,
        resourceId: interest.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          relationshipId: relationship.id,
          companyId: relationship.companyId,
          investorOrganisationId: relationship.investorOrganisationId,
          sourceType: source.type,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        relationshipInterestExpressedEvent({
          tenantId: relationship.tenantId,
          organisationId: authorised.organisationId,
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
 * The command's own authorisation, and nothing else: true when this actor
 * could express interest in this company now. For Q's approval gate, which
 * must ask the same question the command will (at proposal, at decision
 * and before execution) without writing anything.
 */
export function createMayExpressInterest(
  dependencies: ExpressInterestDependencies,
) {
  return async (query: {
    readonly actor: ActorContext;
    readonly companyId: string;
  }): Promise<boolean> => {
    try {
      const authorised = await authorise(
        dependencies,
        query.actor,
        query.companyId,
      );
      const company = await dependencies.companies.findCanonicalCompany(
        authorised.companyId,
      );
      return (
        company !== null && company.organisationId !== authorised.organisationId
      );
    } catch {
      // Every refusal is the same "no" to the gate; the command itself
      // still says precisely why if it is ever called.
      return false;
    }
  };
}

/**
 * The caller's own investor organisation's open interest in a company, or
 * null. Same authorisation as the command: a company the investor may not
 * see answers not-found, never "no interest".
 */
export function createGetOwnInterest(
  dependencies: ExpressInterestDependencies,
) {
  return async (query: {
    readonly actor: ActorContext;
    readonly companyId: string;
  }): Promise<Interest | null> => {
    const authorised = await authorise(
      dependencies,
      query.actor,
      query.companyId,
    );
    const relationship =
      await dependencies.repositories.relationships.findByParties(
        dependencies.sql,
        authorised.companyId,
        authorised.investorOrganisationId,
      );
    if (relationship === null) return null;
    return dependencies.interests.findOpenByRelationship(
      dependencies.sql,
      relationship.id,
    );
  };
}
