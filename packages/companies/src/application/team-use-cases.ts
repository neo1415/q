import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import {
  ContractValidationError,
  FOUNDER_PROFILE_EDITABLE_FIELDS,
  TEAM_FACT_FIELDS,
  type CorrelationId,
  type UpdateCompanyTeamFactsRequest,
  type UpdateMyFounderProfileRequest,
  type UpsertMyCompanyMembershipRequest,
} from "@capital-q/contracts";
import { capability, type ActorContext } from "@capital-q/security";

import type { Company, CompanyId } from "../contracts/index.js";
import type {
  CompanyMember,
  CompanyTeamFacts,
  FounderProfile,
} from "../contracts/team.js";
import { CompanyNotFoundError } from "../domain/errors.js";
import {
  CompanyMemberNotFoundError,
  CompanyTeamFactsNotFoundError,
  FounderProfileNotAllowedError,
  FounderProfileNotFoundError,
  TeamVersionConflictError,
} from "../domain/team-errors.js";
import {
  companyMemberCreatedEvent,
  companyMemberUpdatedEvent,
  companyTeamUpdatedEvent,
  founderProfileCreatedEvent,
  founderProfileUpdatedEvent,
} from "../events/team.js";
import type { CompanyServiceDependencies } from "./dependencies.js";
import type {
  CompanyMemberChanges,
  CompanyTeamFactsValues,
  FounderProfileChanges,
} from "./team-ports.js";

/**
 * Founder / team use cases.
 *
 * Every operation starts the same way: the company must be visible in the
 * caller's tenant and active organisation (enumeration-safe otherwise), then
 * a capability is required on the exact company resource. The person is
 * always the caller (`actor.userId`): no operation here takes a UserId from
 * outside. Nothing here reads or writes organisation roles.
 */

export const COMPANY_TEAM_VIEW = capability("company.team.view");
export const COMPANY_TEAM_SELF_EDIT = capability("company.team.self_edit");
export const COMPANY_TEAM_MANAGE = capability("company.team.manage");

const RESOURCE_COMPANY_MEMBER = AuditResourceTypeSchema.parse("company_member");
const RESOURCE_FOUNDER_PROFILE =
  AuditResourceTypeSchema.parse("founder_profile");
const RESOURCE_COMPANY = AuditResourceTypeSchema.parse("company");
const ACTION = {
  memberCreated: AuditActionTypeSchema.parse("company_member.created"),
  memberUpdated: AuditActionTypeSchema.parse("company_member.updated"),
  profileCreated: AuditActionTypeSchema.parse("founder_profile.created"),
  profileUpdated: AuditActionTypeSchema.parse("founder_profile.updated"),
  teamUpdated: AuditActionTypeSchema.parse("company_team.updated"),
};

type Scoped = { readonly actor: ActorContext; readonly companyId: CompanyId };

/** Locally built change sets are mutable while they are assembled. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

async function visibleCompany(
  dependencies: CompanyServiceDependencies,
  { actor, companyId }: Scoped,
): Promise<{
  company: Company;
  organisationId: NonNullable<ActorContext["organisationId"]>;
}> {
  if (actor.organisationId === undefined) {
    throw new CompanyNotFoundError();
  }
  const company = await dependencies.repositories.companies.findById(
    dependencies.sql,
    actor.tenantId,
    actor.organisationId,
    companyId,
  );
  if (company === null) {
    throw new CompanyNotFoundError();
  }
  return { company, organisationId: actor.organisationId };
}

function companyScope(
  actor: ActorContext,
  organisationId: string,
  companyId: string,
) {
  return {
    kind: "RESOURCE" as const,
    tenantId: actor.tenantId,
    organisationId: organisationId as ActorContext["organisationId"],
    resourceType: "company",
    resourceId: companyId,
  };
}

function eventContext(
  actor: ActorContext,
  organisationId: string,
  correlationId: CorrelationId,
) {
  return {
    tenantId: actor.tenantId,
    organisationId,
    actorUserId: actor.userId,
    correlationId,
  };
}

// ---------------------------------------------------------------------------
// Company membership (self)
// ---------------------------------------------------------------------------

export type GetMyCompanyMembershipQuery = Scoped;

export function createGetMyCompanyMembership(
  dependencies: CompanyServiceDependencies,
) {
  return async (query: GetMyCompanyMembershipQuery): Promise<CompanyMember> => {
    const { company, organisationId } = await visibleCompany(
      dependencies,
      query,
    );
    await dependencies.authorization.requireCapability({
      actor: query.actor,
      capability: COMPANY_TEAM_VIEW,
      resource: companyScope(query.actor, organisationId, company.id),
    });
    const member = await dependencies.repositories.members.findCurrentForUser(
      dependencies.sql,
      query.actor.tenantId,
      company.id,
      query.actor.userId,
    );
    if (member === null) {
      throw new CompanyMemberNotFoundError();
    }
    return member;
  };
}

export type UpsertMyCompanyMembershipCommand = Scoped & {
  readonly input: UpsertMyCompanyMembershipRequest;
  readonly correlationId: CorrelationId;
};

/**
 * Establish or update the caller's own current relationship to the company.
 * Idempotent: the target row is (company, caller). A first call, or a call
 * after every earlier period has ended, opens a new period; ended periods
 * are never reopened or rewritten. Setting `isFounder` touches no role,
 * capability or organisation membership.
 */
export function createUpsertMyCompanyMembership(
  dependencies: CompanyServiceDependencies,
) {
  const { transactions, audit, outbox, repositories } = dependencies;

  return async (
    command: UpsertMyCompanyMembershipCommand,
  ): Promise<CompanyMember> => {
    const { actor, input } = command;
    const { company, organisationId } = await visibleCompany(
      dependencies,
      command,
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: COMPANY_TEAM_SELF_EDIT,
      resource: companyScope(actor, organisationId, company.id),
    });

    return transactions.run(async (tx) => {
      const current = await repositories.members.lockCurrentForUser(
        tx,
        actor.tenantId,
        company.id,
        actor.userId,
      );
      const context = eventContext(
        actor,
        organisationId,
        command.correlationId,
      );

      if (current === null) {
        const member = await repositories.members.create(tx, {
          tenantId: actor.tenantId,
          companyId: company.id,
          userId: actor.userId,
          relationshipType: input.relationshipType,
          businessTitle: input.businessTitle ?? null,
          isFounder: input.isFounder,
        });
        await audit.record(tx, {
          ...auditActorFromContext(actor),
          auditEventId: createAuditEventId(),
          actionType: ACTION.memberCreated,
          resourceType: RESOURCE_COMPANY_MEMBER,
          resourceId: member.id,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: { companyId: company.id, isFounder: member.isFounder },
          correlationId: command.correlationId,
        });
        await outbox.enqueue(
          tx,
          companyMemberCreatedEvent({
            ...context,
            companyMemberId: member.id,
            companyId: company.id,
            userId: actor.userId,
            isFounder: member.isFounder,
            version: member.version,
          }),
        );
        return member;
      }

      const changes: Mutable<CompanyMemberChanges> = {};
      const changedFields: string[] = [];
      if (input.relationshipType !== current.relationshipType) {
        changes.relationshipType = input.relationshipType;
        changedFields.push("relationshipType");
      }
      const title = input.businessTitle ?? null;
      if (title !== current.businessTitle) {
        changes.businessTitle = title;
        changedFields.push("businessTitle");
      }
      if (input.isFounder !== current.isFounder) {
        changes.isFounder = input.isFounder;
        changedFields.push("isFounder");
      }
      if (changedFields.length === 0) {
        return current;
      }

      const updated = await repositories.members.updateCurrent(tx, {
        tenantId: actor.tenantId,
        companyMemberId: current.id,
        expectedVersion: current.version,
        changes,
      });
      if (updated === null) {
        throw new TeamVersionConflictError(
          current.version,
          "company relationship",
        );
      }
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.memberUpdated,
        resourceType: RESOURCE_COMPANY_MEMBER,
        resourceId: updated.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          companyId: company.id,
          changedFields,
          previousVersion: current.version,
          newVersion: updated.version,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        companyMemberUpdatedEvent({
          ...context,
          companyMemberId: updated.id,
          companyId: company.id,
          version: updated.version,
          changedFields,
        }),
      );
      return updated;
    });
  };
}

// ---------------------------------------------------------------------------
// Founder profile (self)
// ---------------------------------------------------------------------------

/** Current founder relationship + self-edit capability, or nothing. */
async function requireFounderInContext(
  dependencies: CompanyServiceDependencies,
  scoped: Scoped,
): Promise<{ company: Company; organisationId: string }> {
  const { company, organisationId } = await visibleCompany(
    dependencies,
    scoped,
  );
  await dependencies.authorization.requireCapability({
    actor: scoped.actor,
    capability: COMPANY_TEAM_SELF_EDIT,
    resource: companyScope(scoped.actor, organisationId, company.id),
  });
  const member = await dependencies.repositories.members.findCurrentForUser(
    dependencies.sql,
    scoped.actor.tenantId,
    company.id,
    scoped.actor.userId,
  );
  if (member === null || !member.isFounder) {
    throw new FounderProfileNotAllowedError();
  }
  return { company, organisationId };
}

export type GetMyFounderProfileQuery = Scoped;

export function createGetMyFounderProfile(
  dependencies: CompanyServiceDependencies,
) {
  return async (query: GetMyFounderProfileQuery): Promise<FounderProfile> => {
    await requireFounderInContext(dependencies, query);
    const profile = await dependencies.repositories.founderProfiles.findForUser(
      dependencies.sql,
      query.actor.tenantId,
      query.actor.userId,
    );
    if (profile === null) {
      throw new FounderProfileNotFoundError();
    }
    return profile;
  };
}

export type UpdateMyFounderProfileCommand = Scoped & {
  readonly input: UpdateMyFounderProfileRequest;
  readonly correlationId: CorrelationId;
};

/**
 * Create (first call, no `expectedVersion`) or update (later calls, with the
 * version read) the caller's own founder profile. Only the two summaries are
 * writable; the primary company is set once on creation and never moved
 * here; the visibility scope stays at its private default. Audit and events
 * carry field names and versions, never the text.
 */
export function createUpdateMyFounderProfile(
  dependencies: CompanyServiceDependencies,
) {
  const { transactions, audit, outbox, repositories } = dependencies;

  return async (
    command: UpdateMyFounderProfileCommand,
  ): Promise<FounderProfile> => {
    const { actor, input } = command;
    const { company, organisationId } = await requireFounderInContext(
      dependencies,
      command,
    );
    const context = eventContext(actor, organisationId, command.correlationId);

    return transactions.run(async (tx) => {
      const current = await repositories.founderProfiles.lockForUser(
        tx,
        actor.tenantId,
        actor.userId,
      );

      if (current === null) {
        if (input.expectedVersion !== undefined) {
          // The caller believes a profile exists; it does not. Refusing is
          // safer than silently creating under a stale assumption.
          throw new FounderProfileNotFoundError();
        }
        const profile = await repositories.founderProfiles.create(tx, {
          tenantId: actor.tenantId,
          userId: actor.userId,
          primaryCompanyId: company.id,
          professionalSummary: input.professionalSummary ?? null,
          backgroundSummary: input.backgroundSummary ?? null,
        });
        await audit.record(tx, {
          ...auditActorFromContext(actor),
          auditEventId: createAuditEventId(),
          actionType: ACTION.profileCreated,
          resourceType: RESOURCE_FOUNDER_PROFILE,
          resourceId: profile.id,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: { primaryCompanyId: company.id },
          correlationId: command.correlationId,
        });
        await outbox.enqueue(
          tx,
          founderProfileCreatedEvent({
            ...context,
            founderProfileId: profile.id,
            userId: actor.userId,
            primaryCompanyId: profile.primaryCompanyId,
            version: profile.version,
          }),
        );
        return profile;
      }

      if (
        input.expectedVersion === undefined ||
        input.expectedVersion !== current.version
      ) {
        throw new TeamVersionConflictError(current.version, "founder profile");
      }

      const changes: Mutable<FounderProfileChanges> = {};
      const changedFields: string[] = [];
      for (const field of FOUNDER_PROFILE_EDITABLE_FIELDS) {
        const next = input[field];
        if (next !== undefined && next !== current[field]) {
          changes[field] = next;
          changedFields.push(field);
        }
      }
      if (changedFields.length === 0) {
        return current;
      }

      const updated = await repositories.founderProfiles.update(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        expectedVersion: current.version,
        changes,
      });
      if (updated === null) {
        throw new TeamVersionConflictError(current.version, "founder profile");
      }
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.profileUpdated,
        resourceType: RESOURCE_FOUNDER_PROFILE,
        resourceId: updated.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          changedFields,
          previousVersion: current.version,
          newVersion: updated.version,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        founderProfileUpdatedEvent({
          ...context,
          founderProfileId: updated.id,
          userId: actor.userId,
          primaryCompanyId: updated.primaryCompanyId,
          version: updated.version,
          changedFields,
        }),
      );
      return updated;
    });
  };
}

// ---------------------------------------------------------------------------
// Team facts (company-wide)
// ---------------------------------------------------------------------------

export type GetCompanyTeamFactsQuery = Scoped;

export function createGetCompanyTeamFacts(
  dependencies: CompanyServiceDependencies,
) {
  return async (query: GetCompanyTeamFactsQuery): Promise<CompanyTeamFacts> => {
    const { company, organisationId } = await visibleCompany(
      dependencies,
      query,
    );
    await dependencies.authorization.requireCapability({
      actor: query.actor,
      capability: COMPANY_TEAM_VIEW,
      resource: companyScope(query.actor, organisationId, company.id),
    });
    const facts = await dependencies.repositories.teamFacts.findForCompany(
      dependencies.sql,
      query.actor.tenantId,
      company.id,
    );
    if (facts === null) {
      throw new CompanyTeamFactsNotFoundError();
    }
    return facts;
  };
}

export type UpdateCompanyTeamFactsCommand = Scoped & {
  readonly input: UpdateCompanyTeamFactsRequest;
  readonly correlationId: CorrelationId;
};

/** Cross-field rules over the merged values. Unknown (null) never fails. */
function assertConsistent(values: CompanyTeamFactsValues): void {
  const issues: { path: string; code: string; message: string }[] = [];
  if (
    values.fullTimeFounderCount !== null &&
    values.founderCount !== null &&
    values.fullTimeFounderCount > values.founderCount
  ) {
    issues.push({
      path: "fullTimeFounderCount",
      code: "custom",
      message: "full-time founders cannot exceed the number of founders",
    });
  }
  if (
    values.founderCount !== null &&
    values.teamSize !== null &&
    values.founderCount > values.teamSize
  ) {
    issues.push({
      path: "founderCount",
      code: "custom",
      message: "founders cannot exceed the team size",
    });
  }
  if (issues.length > 0) {
    throw new ContractValidationError(
      "The team facts are not consistent.",
      issues,
    );
  }
}

export function createUpdateCompanyTeamFacts(
  dependencies: CompanyServiceDependencies,
) {
  const { transactions, audit, outbox, repositories } = dependencies;

  return async (
    command: UpdateCompanyTeamFactsCommand,
  ): Promise<CompanyTeamFacts> => {
    const { actor, input } = command;
    const { company, organisationId } = await visibleCompany(
      dependencies,
      command,
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: COMPANY_TEAM_MANAGE,
      resource: companyScope(actor, organisationId, company.id),
    });
    const context = eventContext(actor, organisationId, command.correlationId);

    return transactions.run(async (tx) => {
      const current = await repositories.teamFacts.lockForCompany(
        tx,
        actor.tenantId,
        company.id,
      );
      const base: CompanyTeamFactsValues = current ?? {
        founderCount: null,
        fullTimeFounderCount: null,
        teamSize: null,
      };
      const merged: CompanyTeamFactsValues = {
        founderCount:
          input.founderCount === undefined
            ? base.founderCount
            : input.founderCount,
        fullTimeFounderCount:
          input.fullTimeFounderCount === undefined
            ? base.fullTimeFounderCount
            : input.fullTimeFounderCount,
        teamSize: input.teamSize === undefined ? base.teamSize : input.teamSize,
      };
      assertConsistent(merged);
      const changedFields = TEAM_FACT_FIELDS.filter(
        (field) => merged[field] !== base[field],
      );

      let facts: CompanyTeamFacts;
      let previousVersion: number | null;
      if (current === null) {
        if (input.expectedVersion !== undefined) {
          throw new CompanyTeamFactsNotFoundError();
        }
        facts = await repositories.teamFacts.create(
          tx,
          actor.tenantId,
          company.id,
          merged,
        );
        previousVersion = null;
      } else {
        if (
          input.expectedVersion === undefined ||
          input.expectedVersion !== current.version
        ) {
          throw new TeamVersionConflictError(current.version, "team facts");
        }
        if (changedFields.length === 0) {
          return current;
        }
        const updated = await repositories.teamFacts.update(
          tx,
          actor.tenantId,
          company.id,
          current.version,
          merged,
        );
        if (updated === null) {
          throw new TeamVersionConflictError(current.version, "team facts");
        }
        facts = updated;
        previousVersion = current.version;
      }

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION.teamUpdated,
        resourceType: RESOURCE_COMPANY,
        resourceId: company.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          changedFields: [...changedFields],
          previousVersion,
          newVersion: facts.version,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        companyTeamUpdatedEvent({
          ...context,
          companyId: company.id,
          version: facts.version,
          changedFields:
            changedFields.length === 0 ? [...TEAM_FACT_FIELDS] : changedFields,
        }),
      );
      return facts;
    });
  };
}
