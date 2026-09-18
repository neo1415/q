import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import {
  UtcTimestampSchema,
  type CorrelationId,
  type MarketplaceReadinessAssessment,
} from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";
import { capability, type ActorContext } from "@capital-q/security";

import type { Company, CompanyId } from "../contracts/index.js";
import { CompanyNotFoundError } from "../domain/errors.js";
import {
  evaluateMarketplaceReadiness,
  outstandingRequirementIds,
  type MarketplaceReadinessEvaluation,
} from "../domain/marketplace-readiness.js";
import { companyMarketplaceReadinessChangedEvent } from "../events/index.js";
import type { CompanyServiceDependencies } from "./dependencies.js";

const COMPANY_VIEW = capability("company.view");
const COMPANY_EDIT = capability("company.edit");
const READINESS_CHANGED = AuditActionTypeSchema.parse(
  "company.marketplace_readiness_changed",
);
const COMPANY_RESOURCE = AuditResourceTypeSchema.parse("company");

/**
 * Marketplace readiness (PADL #57/#58; doc 10 F10/F11).
 *
 * "Is this company permitted to take part in investor discovery, and if
 * not, exactly what legitimate requirement remains?" — answered by the
 * policy over canonical state and the Verification seam, never by a
 * caller. A founder asks for an assessment; nobody, in any role, on any
 * side of the network, sends a desired state. There is no request body
 * with a state in it, and the two capabilities in play are the company's
 * own `company.view` and `company.edit` on the exact company.
 *
 * `getMarketplaceReadiness` is a read: it evaluates and returns without
 * touching the row. `assessMarketplaceReadiness` reconciles: when the
 * policy's answer differs from the stored state, the row moves, the
 * transition is audited and `core.company.marketplace_readiness_changed`
 * is queued in the same transaction. Readiness can move in both
 * directions; nothing here is a one-way switch.
 */

export type GetMarketplaceReadinessQuery = {
  readonly actor: ActorContext;
  readonly companyId: CompanyId;
};

export type AssessMarketplaceReadinessCommand = {
  readonly actor: ActorContext;
  readonly companyId: CompanyId;
  readonly correlationId: CorrelationId;
};

export type MarketplaceReadinessReconciliation = {
  readonly company: Company;
  readonly assessment: MarketplaceReadinessAssessment;
  readonly changed: boolean;
};

function toAssessment(
  companyId: string,
  evaluation: MarketplaceReadinessEvaluation,
): MarketplaceReadinessAssessment {
  return {
    companyId,
    policyVersion: evaluation.policyVersion,
    state: evaluation.state,
    verificationAvailable: evaluation.verificationAvailable,
    requirements: [...evaluation.requirements],
    assessedAt: UtcTimestampSchema.parse(new Date().toISOString()),
  };
}

async function evaluateFor(
  dependencies: CompanyServiceDependencies,
  company: Company,
): Promise<MarketplaceReadinessEvaluation> {
  const verification = await dependencies.verification.currentStandings({
    tenantId: company.tenantId,
    organisationId: company.organisationId,
    companyId: company.id,
  });
  return evaluateMarketplaceReadiness({
    companyId: company.id,
    companyStatus: company.companyStatus,
    canonicalName: company.canonicalName,
    shortDescription: company.shortDescription,
    primaryDescription: company.primaryDescription,
    currentStageCode: company.currentStageCode,
    headquartersCountry: company.headquartersCountry,
    marketplaceVisibility: company.marketplaceVisibility,
    verification,
  });
}

/**
 * Reconcile the stored state with the policy's answer inside the caller's
 * transaction. The row must already be locked by the caller. Shared by the
 * assess command and by visibility withdrawal, so a company never stays
 * represented as ready after a prerequisite it once met is gone.
 */
export async function reconcileMarketplaceReadinessInTransaction(
  dependencies: CompanyServiceDependencies,
  tx: TransactionContext,
  input: {
    readonly actor: ActorContext;
    readonly locked: Company;
    readonly correlationId: CorrelationId;
    /** Why this reconciliation ran; audit metadata, never prose. */
    readonly trigger: "ASSESSMENT_REQUESTED" | "VISIBILITY_WITHDRAWN";
  },
): Promise<MarketplaceReadinessReconciliation> {
  const { actor, locked } = input;
  const evaluation = await evaluateFor(dependencies, locked);
  if (evaluation.state === locked.marketplaceReadinessState) {
    return {
      company: locked,
      assessment: toAssessment(locked.id, evaluation),
      changed: false,
    };
  }

  const updated = await dependencies.repositories.companies.updateReadiness(
    tx,
    {
      tenantId: locked.tenantId,
      organisationId: locked.organisationId,
      companyId: locked.id,
      expectedVersion: locked.version,
      readinessState: evaluation.state,
    },
  );
  if (updated === null) {
    // The row was locked, so a version mismatch here is a programming
    // error, not a race; fail loudly rather than write a stale state.
    throw new Error("marketplace readiness update lost its lock");
  }

  await dependencies.audit.record(tx, {
    ...auditActorFromContext(actor),
    auditEventId: createAuditEventId(),
    actionType: READINESS_CHANGED,
    resourceType: COMPANY_RESOURCE,
    resourceId: updated.id,
    occurredAt: occurredNow(),
    outcome: "SUCCEEDED",
    metadata: {
      policyVersion: evaluation.policyVersion,
      trigger: input.trigger,
      previousState: locked.marketplaceReadinessState,
      newState: updated.marketplaceReadinessState,
      previousVersion: locked.version,
      newVersion: updated.version,
      outstandingRequirements: outstandingRequirementIds(evaluation).join(","),
      verificationSource: dependencies.verification.sourceLabel,
    },
    correlationId: input.correlationId,
  });

  await dependencies.outbox.enqueue(
    tx,
    companyMarketplaceReadinessChangedEvent({
      tenantId: locked.tenantId,
      organisationId: locked.organisationId,
      companyId: updated.id,
      version: updated.version,
      actorUserId: actor.userId,
      correlationId: input.correlationId,
      readinessState: evaluation.state,
      policyVersion: evaluation.policyVersion,
    }),
  );

  return {
    company: updated,
    assessment: toAssessment(updated.id, evaluation),
    changed: true,
  };
}

export function createGetMarketplaceReadiness(
  dependencies: CompanyServiceDependencies,
) {
  const { sql, authorization, repositories } = dependencies;
  return async (
    query: GetMarketplaceReadinessQuery,
  ): Promise<MarketplaceReadinessAssessment> => {
    const { actor } = query;
    if (actor.organisationId === undefined) {
      throw new CompanyNotFoundError();
    }
    const company = await repositories.companies.findById(
      sql,
      actor.tenantId,
      actor.organisationId,
      query.companyId,
    );
    if (company === null) {
      throw new CompanyNotFoundError();
    }
    await authorization.requireCapability({
      actor,
      capability: COMPANY_VIEW,
      resource: {
        kind: "RESOURCE",
        tenantId: actor.tenantId,
        organisationId: actor.organisationId,
        resourceType: "company",
        resourceId: company.id,
      },
    });
    return toAssessment(company.id, await evaluateFor(dependencies, company));
  };
}

export function createAssessMarketplaceReadiness(
  dependencies: CompanyServiceDependencies,
) {
  const { sql, transactions, authorization, repositories } = dependencies;
  return async (
    command: AssessMarketplaceReadinessCommand,
  ): Promise<MarketplaceReadinessAssessment> => {
    const { actor } = command;
    if (actor.organisationId === undefined) {
      throw new CompanyNotFoundError();
    }
    const organisationId = actor.organisationId;
    const visible = await repositories.companies.findById(
      sql,
      actor.tenantId,
      organisationId,
      command.companyId,
    );
    if (visible === null) {
      throw new CompanyNotFoundError();
    }
    await authorization.requireCapability({
      actor,
      capability: COMPANY_EDIT,
      resource: {
        kind: "RESOURCE",
        tenantId: actor.tenantId,
        organisationId,
        resourceType: "company",
        resourceId: visible.id,
      },
    });

    return transactions.run(async (tx) => {
      const locked = await repositories.companies.lockById(
        tx,
        actor.tenantId,
        organisationId,
        command.companyId,
      );
      if (locked === null) {
        throw new CompanyNotFoundError();
      }
      const { assessment } = await reconcileMarketplaceReadinessInTransaction(
        dependencies,
        tx,
        {
          actor,
          locked,
          correlationId: command.correlationId,
          trigger: "ASSESSMENT_REQUESTED",
        },
      );
      return assessment;
    });
  };
}
