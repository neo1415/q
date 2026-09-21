import type { TransactionContext } from "@capital-q/database";
import type { GatewayPolicy, QualificationResult } from "@capital-q/gateq";

import type {
  Application,
  ApplicationFact,
  ApplicationId,
  ApplicationSession,
  ApplicationStatus,
  NewApplicationFact,
} from "../contracts/index.js";

/**
 * What intake stores and what it borrows (CQ-GATE-002 §3, §13, §29).
 *
 * Intake owns applications, their guest sessions, what the applicant said
 * and the submission snapshot. It owns no gateway (GateQ does), no
 * document bytes (Evidence does), no company (Companies does) and no
 * conversation (the Q runtime does). Everything else arrives typed.
 */

export type ApplicationRepository = {
  readonly create: (
    tx: TransactionContext,
    application: Omit<Application, "createdAt" | "updatedAt">,
  ) => Promise<Application>;
  readonly findById: (id: ApplicationId) => Promise<Application | null>;
  readonly setStatus: (
    tx: TransactionContext,
    id: ApplicationId,
    status: ApplicationStatus,
    submittedAt?: string,
  ) => Promise<Application>;
  readonly setDeclaredName: (
    tx: TransactionContext,
    id: ApplicationId,
    declaredName: string,
  ) => Promise<void>;
};

export type ApplicationSessionRepository = {
  readonly create: (
    tx: TransactionContext,
    session: {
      readonly applicationId: ApplicationId;
      readonly tenantId: string;
      readonly tokenHash: string;
      readonly expiresAt: string;
    },
  ) => Promise<ApplicationSession>;
  /**
   * The verifier lookup. Takes a hash, never a raw credential: the caller
   * hashes, so a raw token never reaches a query log or a slow-query trace.
   */
  readonly findByTokenHash: (tokenHash: string) => Promise<{
    readonly session: ApplicationSession;
    readonly storedHash: string;
  } | null>;
  readonly touch: (id: string, at: string) => Promise<void>;
  readonly revokeForApplication: (
    tx: TransactionContext,
    applicationId: ApplicationId,
    at: string,
  ) => Promise<void>;
};

export type ApplicationFactRepository = {
  /** Current facts: superseded rows are history and are not returned. */
  readonly currentFor: (
    applicationId: ApplicationId,
  ) => Promise<readonly ApplicationFact[]>;
  readonly historyFor: (
    applicationId: ApplicationId,
    limit: number,
  ) => Promise<readonly ApplicationFact[]>;
  /**
   * Record facts, superseding whatever each dimension currently holds.
   * One statement per dimension inside the caller's transaction, so a turn
   * that says five things either records five or records none.
   */
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly applicationId: ApplicationId;
      readonly tenantId: string;
      readonly facts: readonly NewApplicationFact[];
      readonly at: string;
    },
  ) => Promise<readonly ApplicationFact[]>;
};

export type ApplicationSubmissionRepository = {
  readonly findForApplication: (applicationId: ApplicationId) => Promise<{
    readonly submittedAt: string;
    readonly clientRequestId: string;
  } | null>;
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly applicationId: ApplicationId;
      readonly tenantId: string;
      readonly gatewayVersionId: string;
      readonly snapshot: unknown;
      readonly qualification: QualificationResult;
      readonly clientRequestId: string;
      readonly submittedAt: string;
    },
  ) => Promise<{ readonly submittedAt: string }>;
};

export type ApplicationDocumentRepository = {
  readonly attach: (
    tx: TransactionContext,
    input: {
      readonly applicationId: ApplicationId;
      readonly tenantId: string;
      readonly documentId: string;
    },
  ) => Promise<void>;
  readonly countFor: (applicationId: ApplicationId) => Promise<number>;
  readonly listFor: (
    applicationId: ApplicationId,
  ) => Promise<readonly string[]>;
};

/** The published policy an application is bound to, read by its frozen id. */
export type BoundPolicyPort = {
  readonly policyByVersionId: (input: {
    readonly gatewayId: string;
    readonly gatewayVersionId: string;
  }) => Promise<GatewayPolicy | null>;
  /** The gateway's currently published policy, for a brand-new application. */
  readonly currentPolicyByPublicId: (
    publicId: string,
  ) => Promise<GatewayPolicy | null>;
};

/**
 * Turning the applicant's own phrases into canonical taxonomy (§11 of
 * GATE-001, §45 here).
 *
 * A model never produces a node id. It produces the words the person used;
 * the Taxonomy context resolves them, and anything ambiguous comes back as
 * a candidate for the applicant to confirm rather than as a classification.
 */
export type TaxonomyResolutionPort = {
  readonly resolvePhrases: (input: {
    readonly phrases: readonly string[];
  }) => Promise<
    readonly {
      readonly vocabularyCode: string;
      readonly nodeId: string;
      readonly ancestorNodeIds: readonly string[];
      /** False when more than one node fits; the applicant is asked. */
      readonly unambiguous: boolean;
    }[]
  >;
};
