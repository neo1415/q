import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { CompanyQueryPort } from "@capital-q/companies";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { AuthorizationService } from "@capital-q/security";

import type { SyntheticDemoAttestation } from "../domain/attestation.js";
import {
  createPostgresSyntheticPrincipalPort,
  createPostgresVerificationClaimRepository,
} from "../infrastructure/postgres-verification-repository.js";
import {
  createGetCompanyVerification,
  createRequestCompanyVerification,
} from "./company-verification.js";
import { createDecideBySyntheticAttestation } from "./decide-synthetic.js";
import type {
  SyntheticPrincipalPort,
  VerificationClaimRepository,
} from "./ports.js";

/** What the API composes: a founder asks and reads. Nothing here decides. */
export type CompanyVerificationService = {
  readonly getCompanyVerification: ReturnType<
    typeof createGetCompanyVerification
  >;
  readonly requestCompanyVerification: ReturnType<
    typeof createRequestCompanyVerification
  >;
};

export function createCompanyVerificationService(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly companies: Pick<CompanyQueryPort, "getCanonicalCompany">;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly repository?: VerificationClaimRepository | undefined;
  readonly clock?: (() => Date) | undefined;
}): CompanyVerificationService {
  const dependencies = {
    ...options,
    repository:
      options.repository ?? createPostgresVerificationClaimRepository(),
    clock: options.clock ?? (() => new Date()),
  };
  return {
    getCompanyVerification: createGetCompanyVerification(dependencies),
    requestCompanyVerification: createRequestCompanyVerification(dependencies),
  };
}

/**
 * What a worker composes to decide. Separate from the founder service on
 * purpose: the API process never holds a decider.
 */
export function createSyntheticVerificationDecider(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly attestation: SyntheticDemoAttestation | null;
  readonly environment: string | undefined;
  readonly repository?: VerificationClaimRepository | undefined;
  readonly principals?: SyntheticPrincipalPort | undefined;
}) {
  return createDecideBySyntheticAttestation({
    ...options,
    repository:
      options.repository ?? createPostgresVerificationClaimRepository(),
    principals: options.principals ?? createPostgresSyntheticPrincipalPort(),
  });
}
