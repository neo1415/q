import type { TransactionContext } from "@capital-q/database";
import type { GatewayPolicy, QualificationResult } from "@capital-q/gateq";

import type {
  Application,
  ApplicationDimension,
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
  /**
   * GateQ slice 1: take the application's row lock for the rest of the
   * transaction and read it as it now is. Every writer to an application
   * (facts, turns, documents, contact) and the submission take it, so a
   * submission sees one consistent application and nothing lands after it.
   */
  readonly lock: (
    tx: TransactionContext,
    id: ApplicationId,
  ) => Promise<Application | null>;
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
  /**
   * The last turn this session processed, so a retry is the same turn.
   *
   * A flaky mobile connection retries; a double-tapped send arrives twice.
   * Without this, each one is another model call the organisation pays for
   * and another chance to record the same sentence as two facts.
   */
  readonly lastTurn: (sessionId: string) => Promise<{
    readonly clientTurnId: string;
    readonly reply: string;
  } | null>;
  readonly rememberTurn: (input: {
    readonly sessionId: string;
    readonly clientTurnId: string;
    readonly reply: string;
  }) => Promise<void>;
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
      /** Lineage: the PERSON turn these were read from, when one was. */
      readonly sourceTurnSeq?: number | null | undefined;
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
      /**
       * GateQ slice 1: the deterministic dossier and the snapshot's shape
       * version, written at insert and never again. Absent: a v1 row.
       */
      readonly dossier?: unknown;
      readonly snapshotVersion?: 1 | 2 | undefined;
    },
  ) => Promise<{ readonly submittedAt: string }>;
};

/** One line of the interview, as stored. */
export type StoredTurn = {
  readonly seq: number;
  readonly role: "PERSON" | "Q";
  readonly text: string;
  readonly clientTurnId: string;
  /** Q turns only: the bounded dimension Q asked about. */
  readonly askingDimension: ApplicationDimension | null;
  /** Q turns only: the model's reading of the person's turn. */
  readonly intent: string | null;
  /** Q turns only: server time to the reply, in milliseconds. */
  readonly latencyMs: number | null;
  readonly createdAt: string;
};

/**
 * The interview transcript (GateQ slice 1). Append-only and ordered; the
 * store assigns `seq` under a lock on the application, and a role written
 * twice for one client turn id is written once.
 */
export type ApplicationTurnRepository = {
  /** Oldest first. `limit` keeps the newest that many. */
  readonly listFor: (
    applicationId: ApplicationId,
    limit?: number,
  ) => Promise<readonly StoredTurn[]>;
  readonly findExchange: (
    applicationId: ApplicationId,
    clientTurnId: string,
  ) => Promise<{
    readonly person: StoredTurn | null;
    readonly q: StoredTurn | null;
  }>;
  /**
   * Appends under the application's row lock and answers the row's seq;
   * an existing (client turn id, role) row is left as it is and its seq
   * returned. Throws IntakeRefusedError("ALREADY_SUBMITTED") once the
   * application is submitted: nothing is said into it afterwards.
   */
  readonly append: (input: {
    readonly applicationId: ApplicationId;
    readonly tenantId: string;
    readonly role: "PERSON" | "Q";
    readonly text: string;
    readonly clientTurnId: string;
    readonly askingDimension?: ApplicationDimension | null | undefined;
    readonly intent?: string | null | undefined;
    readonly latencyMs?: number | null | undefined;
  }) => Promise<{ readonly seq: number }>;
  readonly countFor: (applicationId: ApplicationId) => Promise<number>;
};

export type ContactChannel = "EMAIL" | "PHONE";

/** The applicant's contact as stored. The code itself is never here. */
export type StoredContact = {
  readonly applicationId: ApplicationId;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly companyName: string;
  readonly phone: string | null;
  readonly preferredChannel: ContactChannel | null;
  readonly codeHash: string | null;
  readonly codeExpiresAt: string | null;
  readonly codeAttempts: number;
  readonly emailConfirmedAt: string | null;
  readonly confirmedVia: "EMAIL_CODE" | "ACCOUNT" | null;
};

/** One contact per application (GateQ slice 1). */
export type ApplicationContactRepository = {
  readonly findFor: (
    applicationId: ApplicationId,
  ) => Promise<StoredContact | null>;
  /**
   * Insert or replace the details. A changed email loses its confirmation;
   * attempts reset whenever a new code is issued.
   */
  readonly save: (
    tx: TransactionContext,
    input: {
      readonly applicationId: ApplicationId;
      readonly tenantId: string;
      readonly name: string;
      readonly email: string;
      readonly role: string;
      readonly companyName: string;
      readonly phone: string | null;
      readonly preferredChannel: ContactChannel | null;
      readonly codeHash: string | null;
      readonly codeExpiresAt: string | null;
      readonly emailConfirmedAt: string | null;
      readonly confirmedVia: "EMAIL_CODE" | "ACCOUNT" | null;
    },
  ) => Promise<StoredContact>;
  readonly recordFailedAttempt: (
    tx: TransactionContext,
    applicationId: ApplicationId,
  ) => Promise<void>;
  readonly confirm: (
    tx: TransactionContext,
    input: {
      readonly applicationId: ApplicationId;
      readonly at: string;
      readonly via: "EMAIL_CODE" | "ACCOUNT";
    },
  ) => Promise<StoredContact | null>;
};

/** Titles of Evidence-owned documents, by id. Display only. */
export type DocumentTitlesPort = {
  readonly titles: (
    documentIds: readonly string[],
  ) => Promise<ReadonlyMap<string, string>>;
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
