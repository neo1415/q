import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type { CorrelationId, CreateCompanyRequest } from "@capital-q/contracts";
import {
  ActorContextDeniedError,
  ActorContextRequiredError,
  capability,
  type ActorContext,
} from "@capital-q/security";

import type { Company } from "../contracts/index.js";
import {
  CompanyCreationConflictError,
  CompanySlugUnavailableError,
} from "../domain/errors.js";
import {
  hashCompanyIdempotencyKey,
  hashCreateCompanyRequest,
} from "../domain/idempotency.js";
import { companySlugCandidates, companySlugFromName } from "../domain/slug.js";
import { companyCreatedEvent } from "../events/index.js";
import type { CompanyServiceDependencies } from "./dependencies.js";

export const COMPANY_CREATE = capability("company.create");

const COMPANY_CREATED = AuditActionTypeSchema.parse("company.created");
const COMPANY_RESOURCE = AuditResourceTypeSchema.parse("company");

export type CreateCompanyCommand = {
  /** Trusted: server-resolved for this request. Supplies tenant and organisation. */
  readonly actor: ActorContext;
  /** Validated against CreateCompanyRequestSchema by the caller. */
  readonly input: CreateCompanyRequest;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

/**
 * Create the canonical Company in the caller's active organisation.
 *
 *   organisation context required -> organisation still active (query port)
 *   -> company.create on the ORGANISATION scope -> transaction:
 *   idempotency lock/lookup -> slug allocation -> company row -> audit
 *   -> core.company.created -> idempotency record -> COMMIT
 *
 * Tenant and organisation come from the ActorContext, never the request.
 * No founder link, no capital objective, no evidence, no verification: the
 * row is organisation-private and not marketplace eligible by default.
 */
export function createCreateCompany(dependencies: CompanyServiceDependencies) {
  const {
    transactions,
    authorization,
    organisations,
    outbox,
    audit,
    repositories: { companies, creationRequests },
  } = dependencies;

  return async (command: CreateCompanyCommand): Promise<Company> => {
    const { actor } = command;
    if (
      actor.organisationId === undefined ||
      actor.membershipId === undefined
    ) {
      throw new ActorContextRequiredError();
    }
    const organisationId = actor.organisationId;

    // The context proves membership; the query port proves the workspace is
    // still an active organisation. A suspended or closed organisation
    // cannot acquire a company, and the caller is not told which.
    const organisation = await organisations.getActiveOrganisationIdentity(
      actor.tenantId,
      organisationId,
    );
    if (organisation === null) {
      throw new ActorContextDeniedError();
    }

    await authorization.requireCapability({
      actor,
      capability: COMPANY_CREATE,
      resource: {
        kind: "ORGANISATION",
        tenantId: actor.tenantId,
        organisationId,
      },
    });

    const keyHash = hashCompanyIdempotencyKey(command.idempotencyKey);
    const requestHash = hashCreateCompanyRequest(command.input);

    return transactions.run(async (tx) => {
      await creationRequests.lock(tx, actor.userId, organisationId, keyHash);
      const previous = await creationRequests.find(
        tx,
        actor.userId,
        organisationId,
        keyHash,
      );
      if (previous !== null) {
        if (previous.requestHash !== requestHash) {
          throw new CompanyCreationConflictError();
        }
        const existing = await companies.findById(
          tx.sql,
          actor.tenantId,
          organisationId,
          previous.companyId,
        );
        if (existing === null) {
          throw new CompanyCreationConflictError();
        }
        return existing;
      }

      const base = companySlugFromName(command.input.canonicalName);
      await companies.lockSlug(tx, actor.tenantId, base);
      const candidates = companySlugCandidates(base);
      const taken = await companies.takenSlugs(tx, actor.tenantId, candidates);
      const slug = candidates.find((candidate) => !taken.has(candidate));
      if (slug === undefined) {
        throw new CompanySlugUnavailableError();
      }

      const company = await companies.insert(tx, {
        tenantId: actor.tenantId,
        organisationId,
        canonicalName: command.input.canonicalName,
        slug,
        legalName: command.input.legalName ?? null,
        websiteUrl: command.input.websiteUrl ?? null,
        foundedDate: command.input.foundedDate ?? null,
        headquartersCountry: command.input.headquartersCountry ?? null,
        headquartersCity: command.input.headquartersCity ?? null,
        currentStageCode: command.input.currentStageCode ?? null,
        primaryDescription: command.input.primaryDescription ?? null,
        shortDescription: command.input.shortDescription ?? null,
      });

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: COMPANY_CREATED,
        resourceType: COMPANY_RESOURCE,
        resourceId: company.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: { slug: company.slug },
        correlationId: command.correlationId,
      });

      await outbox.enqueue(
        tx,
        companyCreatedEvent({
          tenantId: actor.tenantId,
          organisationId,
          companyId: company.id,
          version: company.version,
          actorUserId: actor.userId,
          correlationId: command.correlationId,
        }),
      );

      await creationRequests.record(tx, {
        userId: actor.userId,
        organisationId,
        idempotencyKeyHash: keyHash,
        requestHash,
        companyId: company.id,
        tenantId: actor.tenantId,
      });

      return company;
    });
  };
}
