import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import type { CorrelationId } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import { OrganisationIdSchema, TenantIdSchema } from "@capital-q/security";

import {
  decisionBasisOf,
  deploymentRefusal,
  type SyntheticDecisionRefusal,
  type SyntheticDemoAttestation,
} from "../domain/attestation.js";
import { verificationClaimDecidedEvent } from "../events/index.js";
import type {
  SyntheticPrincipalPort,
  VerificationClaimRepository,
} from "./ports.js";

/**
 * Capital Q deciding a verification request by SYNTHETIC_DEMO_ATTESTATION.
 *
 * Deterministic, no model anywhere. It verifies only when every one of
 * these holds, and refuses by name otherwise:
 *
 *   - the deployment is not production or preview;
 *   - the process holds the synthetic-demo attestation (the same
 *     allowance the model gateway checks: operator opt-in, local/test with
 *     a loopback database, or staging naming its synthetic project);
 *   - the person who asked, and the person a FOUNDER_IDENTITY claim is
 *     about, have auth accounts created as synthetic;
 *   - the request is still the current revision for its subject.
 *
 * A refusal writes nothing: the request stays PENDING, which is the truth.
 * A decision is a new row naming the request, audited as the SYSTEM
 * actor with its method and basis, and announced with
 * `verification.claim.decided`, all in one transaction. A replay finds the
 * request no longer current and does nothing.
 */

const RESOURCE = AuditResourceTypeSchema.parse("verification_claim");
const DECIDED = AuditActionTypeSchema.parse("verification.claim.decided");

export type SyntheticDecisionDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly repository: VerificationClaimRepository;
  readonly principals: SyntheticPrincipalPort;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  /** The deployment's synthetic-demo allowance; null wherever real people are served. */
  readonly attestation: SyntheticDemoAttestation | null;
  /** CAPITAL_Q_ENV of this process. */
  readonly environment: string | undefined;
};

export type DecideSyntheticCommand = {
  readonly tenantId: string;
  readonly claimId: string;
  readonly correlationId: CorrelationId;
};

export type DecideSyntheticOutcome =
  | {
      readonly kind: "VERIFIED";
      readonly claimId: string;
      readonly decidesClaimId: string;
    }
  /** Not found in the tenant, not PENDING, or no longer current. */
  | { readonly kind: "NOTHING_TO_DECIDE" }
  | { readonly kind: "REFUSED"; readonly reason: SyntheticDecisionRefusal };

export function createDecideBySyntheticAttestation(
  dependencies: SyntheticDecisionDependencies,
) {
  const { repository, principals, audit, outbox, transactions } = dependencies;
  return async (
    command: DecideSyntheticCommand,
  ): Promise<DecideSyntheticOutcome> => {
    const refused = deploymentRefusal(
      dependencies.attestation,
      dependencies.environment,
    );
    if (refused !== null || dependencies.attestation === null) {
      return { kind: "REFUSED", reason: refused ?? "NO_ATTESTATION" };
    }
    const attestation = dependencies.attestation;
    const tenantId = TenantIdSchema.parse(command.tenantId);

    return transactions.run(async (tx): Promise<DecideSyntheticOutcome> => {
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

      const people = new Set([request.requestedByUserId]);
      if (request.subjectType === "PERSON" && request.subjectId !== null) {
        people.add(request.subjectId);
      }
      for (const person of people) {
        if (!(await principals.isSynthetic(tx.sql, person))) {
          return { kind: "REFUSED", reason: "PRINCIPAL_NOT_SYNTHETIC" };
        }
      }

      const decision = await repository.insertDecision(tx, {
        decides: request,
        status: "VERIFIED",
        method: "SYNTHETIC_DEMO_ATTESTATION",
        provider: "CAPITAL_Q_SYNTHETIC_DEMO",
        decisionBasis: decisionBasisOf(attestation),
      });
      const organisationId = OrganisationIdSchema.parse(
        decision.organisationId,
      );

      await audit.record(tx, {
        auditEventId: createAuditEventId(),
        tenantId,
        actorType: "SYSTEM",
        organisationId,
        actionType: DECIDED,
        resourceType: RESOURCE,
        resourceId: decision.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          claimType: decision.claimType,
          status: decision.status,
          method: "SYNTHETIC_DEMO_ATTESTATION",
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
            actor: { type: "SYSTEM" },
            correlationId: command.correlationId,
          },
          {
            claimId: decision.id,
            decidesClaimId: request.id,
            claimType: decision.claimType,
            status: "VERIFIED",
            method: "SYNTHETIC_DEMO_ATTESTATION",
            revision: decision.revision,
          },
        ),
      );
      return {
        kind: "VERIFIED",
        claimId: decision.id,
        decidesClaimId: request.id,
      };
    });
  };
}
