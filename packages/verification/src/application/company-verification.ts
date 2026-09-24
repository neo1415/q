import { createHash } from "node:crypto";

import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import {
  CompanyIdSchema,
  CompanyNotFoundError,
  type CompanyIdentity,
  type CompanyQueryPort,
} from "@capital-q/companies";
import {
  COMPANY_VERIFICATION_CLAIM_TYPES,
  UtcTimestampSchema,
  type CompanyVerificationDto,
  type CorrelationId,
  type VerificationClaimType,
  type VerificationStandingDto,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import {
  capability,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  describeStanding,
  founderIdentityOf,
  isRequestable,
  organisationIdentityOf,
  standingOf,
  SUBJECT_TYPE_OF,
  type VerificationClaim,
} from "../domain/claims.js";
import { verificationClaimRecordedEvent } from "../events/index.js";
import type { VerificationClaimRepository } from "./ports.js";

/**
 * The founder side of verification: ask, and read where it stands.
 *
 * A founder can REQUEST. Nothing here can VERIFY: there is no input in
 * which a caller names a status, a method or a decision, and the only
 * rows this file writes are PENDING. Capital Q decides elsewhere, under
 * its own proof (decide-synthetic.ts).
 */

export const COMPANY_EDIT = capability("company.edit");
export const VERIFICATION_REQUEST = capability("verification.request");
export const VERIFICATION_VIEW = capability("verification.view");

const RESOURCE = AuditResourceTypeSchema.parse("verification_claim");
const REQUESTED = AuditActionTypeSchema.parse("verification.claim.requested");

export type CompanyVerificationDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly companies: Pick<CompanyQueryPort, "getCanonicalCompany">;
  readonly repository: VerificationClaimRepository;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly clock: () => Date;
};

export type GetCompanyVerificationQuery = {
  readonly actor: ActorContext;
  readonly companyId: string;
};

export type RequestCompanyVerificationCommand = {
  readonly actor: ActorContext;
  readonly companyId: string;
  /** Required by the route; hashed into the audit record for attribution. */
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

export type RequestCompanyVerificationResult = {
  readonly verification: CompanyVerificationDto;
  /** The claim types this call asked for; empty on a replay. */
  readonly requested: readonly VerificationClaimType[];
};

/**
 * The company as the actor may know it: in the actor's tenant AND owned by
 * the actor's active organisation. Anything else is "not found", before
 * any authorisation detail could differ.
 */
async function ownedCompany(
  dependencies: CompanyVerificationDependencies,
  actor: ActorContext,
  rawCompanyId: string,
) {
  const parsed = CompanyIdSchema.safeParse(rawCompanyId);
  if (!parsed.success || actor.organisationId === undefined) {
    throw new CompanyNotFoundError();
  }
  const company = await dependencies.companies.getCanonicalCompany(
    actor.tenantId,
    parsed.data,
  );
  if (company?.organisationId !== actor.organisationId) {
    throw new CompanyNotFoundError();
  }
  return company;
}

function companyScope(actor: ActorContext, company: CompanyIdentity) {
  return {
    kind: "RESOURCE" as const,
    tenantId: actor.tenantId,
    organisationId: company.organisationId,
    resourceType: "company",
    resourceId: company.id,
  };
}

function standingDto(
  claimType: VerificationClaimType,
  claim: VerificationClaim | null,
  now: Date,
): VerificationStandingDto {
  const status = standingOf(claim, now);
  const method = status === "NOT_REQUESTED" ? null : (claim?.method ?? null);
  return {
    claimType,
    subjectType: SUBJECT_TYPE_OF[claimType],
    status,
    method,
    // Only a waiting request is its own row; a decision row's request time
    // lives on the row it decides, which this read does not fetch.
    requestedAt: claim?.status === "PENDING" ? claim.createdAt : null,
    decidedAt: claim?.decidedAt ?? null,
    verifiedAt: claim?.verifiedAt ?? null,
    expiresAt: claim?.expiresAt ?? null,
    revokedAt: claim?.revokedAt ?? null,
    description: describeStanding(claimType, status, method),
  };
}

/** The two standings readiness reads, for this person, in a fixed order. */
export function toCompanyVerification(
  companyId: string,
  organisationId: string,
  askingUserId: string,
  claims: readonly VerificationClaim[],
  now: Date,
): CompanyVerificationDto {
  const byType: Record<
    (typeof COMPANY_VERIFICATION_CLAIM_TYPES)[number],
    VerificationClaim | null
  > = {
    FOUNDER_IDENTITY: founderIdentityOf(claims, askingUserId, now),
    ORGANISATION: organisationIdentityOf(claims, organisationId),
  };
  const standings = COMPANY_VERIFICATION_CLAIM_TYPES.map((type) =>
    standingDto(type, byType[type], now),
  );
  return {
    companyId,
    standings,
    requestable: standings.some((s) => isRequestable(s.status)),
    retrievedAt: UtcTimestampSchema.parse(now.toISOString()),
  };
}

function hashRequestKey(key: string): string {
  return createHash("sha256")
    .update(`verification.request:${key}`, "utf8")
    .digest("hex");
}

export function createGetCompanyVerification(
  dependencies: CompanyVerificationDependencies,
) {
  return async (
    query: GetCompanyVerificationQuery,
  ): Promise<CompanyVerificationDto> => {
    const { actor } = query;
    const company = await ownedCompany(dependencies, actor, query.companyId);
    await dependencies.authorization.requireCapability({
      actor,
      capability: VERIFICATION_VIEW,
      resource: companyScope(actor, company),
    });
    const claims = await dependencies.repository.currentForOrganisation(
      dependencies.sql,
      company.tenantId,
      company.organisationId,
    );
    return toCompanyVerification(
      company.id,
      company.organisationId,
      actor.userId,
      claims,
      dependencies.clock(),
    );
  };
}

/**
 * Ask Capital Q to verify whatever is requestable now: the asking
 * person's identity (unless a founder of this organisation is already
 * verified) and the organisation.
 *
 * Idempotent by state, under the organisation's advisory lock: a claim
 * that is already PENDING or VERIFIED is never asked for again, so a
 * retried request — same key or a new one — writes nothing and returns
 * the standings as they are. Each PENDING row is audited and announced
 * with `verification.claim.recorded` in the same transaction.
 */
export function createRequestCompanyVerification(
  dependencies: CompanyVerificationDependencies,
) {
  const { transactions, repository, audit, outbox, clock } = dependencies;
  return async (
    command: RequestCompanyVerificationCommand,
  ): Promise<RequestCompanyVerificationResult> => {
    const { actor } = command;
    const company = await ownedCompany(dependencies, actor, command.companyId);
    const scope = companyScope(actor, company);
    // Asking is an act on the company's behalf: the person must be able
    // to edit it, and hold the request capability, on this exact company.
    await dependencies.authorization.requireCapability({
      actor,
      capability: COMPANY_EDIT,
      resource: scope,
    });
    await dependencies.authorization.requireCapability({
      actor,
      capability: VERIFICATION_REQUEST,
      resource: scope,
    });

    return transactions.run(async (tx) => {
      await repository.lockOrganisation(
        tx,
        company.tenantId,
        company.organisationId,
      );
      const now = clock();
      const before = await repository.currentForOrganisation(
        tx.sql,
        company.tenantId,
        company.organisationId,
      );
      const view = toCompanyVerification(
        company.id,
        company.organisationId,
        actor.userId,
        before,
        now,
      );
      const subjects: Record<
        (typeof COMPANY_VERIFICATION_CLAIM_TYPES)[number],
        string
      > = {
        FOUNDER_IDENTITY: actor.userId,
        ORGANISATION: company.organisationId,
      };
      const requested: VerificationClaimType[] = [];
      for (const [index, claimType] of COMPANY_VERIFICATION_CLAIM_TYPES.entries()) {
        const standing = view.standings[index];
        if (standing === undefined || !isRequestable(standing.status)) continue;
        const claim = await repository.insertPending(tx, {
          tenantId: company.tenantId,
          organisationId: company.organisationId,
          claimType,
          subjectId: subjects[claimType],
          requestedByUserId: actor.userId,
        });
        requested.push(claimType);
        await audit.record(tx, {
          ...auditActorFromContext(actor),
          auditEventId: createAuditEventId(),
          actionType: REQUESTED,
          resourceType: RESOURCE,
          resourceId: claim.id,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: {
            claimType,
            companyId: company.id,
            revision: claim.revision,
            requestKeyHash: hashRequestKey(command.idempotencyKey),
          },
          correlationId: command.correlationId,
        });
        await outbox.enqueue(
          tx,
          verificationClaimRecordedEvent(
            {
              tenantId: company.tenantId,
              organisationId: company.organisationId,
              actor: { type: "HUMAN", id: actor.userId },
              correlationId: command.correlationId,
            },
            {
              claimId: claim.id,
              claimType,
              status: "PENDING",
              revision: claim.revision,
            },
          ),
        );
      }
      const after =
        requested.length === 0
          ? before
          : await repository.currentForOrganisation(
              tx.sql,
              company.tenantId,
              company.organisationId,
            );
      return {
        verification: toCompanyVerification(
          company.id,
          company.organisationId,
          actor.userId,
          after,
          now,
        ),
        requested,
      };
    });
  };
}
