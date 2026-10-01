import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import type { CorrelationId } from "@capital-q/contracts";
import type { TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import { verificationClaimDecidedEvent } from "../events/index.js";
import type { VerificationClaimRepository } from "./ports.js";

/**
 * ADR 0033: a Capital Q operator decides a verification request by hand
 * (OPERATOR_DECISION, CAPITAL_Q_OPERATOR, HUMAN decider). Who may call this
 * is decided before it is reached -- a platform admin with
 * `verification.decide` and a live step-up (@capital-q/platform-admin); this
 * function trusts nothing else and re-checks the request: still PENDING and
 * still the current revision. Same append-only row, audit and event as the
 * synthetic decider, in one transaction. Deterministic; no model.
 */

const RESOURCE = AuditResourceTypeSchema.parse("verification_claim");
const DECIDED = AuditActionTypeSchema.parse("verification.claim.decided");

export type DecideByOperatorCommand = {
  readonly tenantId: string;
  readonly claimId: string;
  readonly operatorUserId: string;
  readonly status: "VERIFIED" | "REVOKED";
  readonly decisionBasis: string;
  readonly revocationReason: string | null;
  readonly correlationId: CorrelationId;
};

export type DecideByOperatorOutcome =
  | {
      readonly kind: "DECIDED";
      readonly claimId: string;
      readonly decidesClaimId: string;
      readonly status: "VERIFIED" | "REVOKED";
    }
  | { readonly kind: "NOTHING_TO_DECIDE" };

export function createDecideByOperator(dependencies: {
  readonly transactions: TransactionManager;
  readonly repository: VerificationClaimRepository;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
}) {
  const { repository, audit, outbox, transactions } = dependencies;
  return async (
    command: DecideByOperatorCommand,
  ): Promise<DecideByOperatorOutcome> => {
    const tenantId = TenantIdSchema.parse(command.tenantId);
    const operator = UserIdSchema.parse(command.operatorUserId);
    const basis = command.decisionBasis.trim();
    const reason =
      command.status === "REVOKED"
        ? (command.revocationReason ?? basis).trim().slice(0, 500)
        : null;
    if (basis.length === 0 || (command.status === "REVOKED" && !reason)) {
      return { kind: "NOTHING_TO_DECIDE" };
    }
    return transactions.run(async (tx): Promise<DecideByOperatorOutcome> => {
      const request = await repository.findById(
        tx.sql,
        tenantId,
        command.claimId,
      );
      if (request === null) return { kind: "NOTHING_TO_DECIDE" };
      await repository.lockOrganisation(
        tx,
        request.tenantId,
        request.organisationId,
      );
      if (request.status !== "PENDING") return { kind: "NOTHING_TO_DECIDE" };
      const current = await repository.currentRevision(tx.sql, request);
      if (current !== request.revision) return { kind: "NOTHING_TO_DECIDE" };

      const decision = await repository.insertOperatorDecision(tx, {
        decides: request,
        status: command.status,
        decisionBasis: basis.slice(0, 1000),
        revocationReason: reason,
        operatorUserId: operator,
      });
      const organisationId = OrganisationIdSchema.parse(
        decision.organisationId,
      );
      await audit.record(tx, {
        auditEventId: createAuditEventId(),
        tenantId,
        actorType: "HUMAN",
        actorId: operator,
        organisationId,
        actionType: DECIDED,
        resourceType: RESOURCE,
        resourceId: decision.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          claimType: decision.claimType,
          status: decision.status,
          method: "OPERATOR_DECISION",
          decidesClaimId: request.id,
          revision: decision.revision,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        verificationClaimDecidedEvent(
          {
            tenantId,
            organisationId,
            actor: { type: "HUMAN", id: operator },
            correlationId: command.correlationId,
          },
          {
            claimId: decision.id,
            decidesClaimId: request.id,
            claimType: decision.claimType,
            status: command.status,
            method: "OPERATOR_DECISION",
            revision: decision.revision,
          },
        ),
      );
      return {
        kind: "DECIDED",
        claimId: decision.id,
        decidesClaimId: request.id,
        status: command.status,
      };
    });
  };
}
