import type {
  CardDetail,
  QCardFieldScopes,
  QCardScope,
  QCardSubjectType,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";

/**
 * The seams this context depends on (BIZ-004). It owns handles and cards
 * and nothing else: a subject's declared facts come from the companies or
 * investors context through the directory port, composed by the app, so
 * this package never reads another context's tables.
 */

export type QCardSubject = {
  readonly subjectType: QCardSubjectType;
  readonly subjectId: string;
};

/** A subject's trusted ownership, declared facts and verified claims. */
export type SubjectFacts = {
  /** Null for a PERSON: a person is not owned by one tenant's row here. */
  readonly tenantId: string | null;
  /** Null for a PERSON: a person's card belongs to the person, not an organisation. */
  readonly organisationId: string | null;
  readonly name: string;
  /** The profile carries owner-approved demonstration figures. */
  readonly demonstration?: boolean | undefined;
  /** Declared profile fields by card field key; null means not stated. */
  readonly facts: Readonly<Record<string, string | null>>;
  /**
   * A section's structured content by card field key and audience scope
   * (CardSectionDetails); shown only beside a field `facts` also holds.
   */
  readonly details?:
    | Readonly<
        Record<string, Readonly<Partial<Record<QCardScope, CardDetail | null>>>>
      >
    | undefined;
  /** Capital Q's own verification claims, never a statement or a reading. */
  readonly verified: {
    readonly organisation: boolean;
    readonly founderIdentity: boolean;
    /** Which of the above rest on the synthetic-demo attestation. */
    readonly demoAttested?:
      | {
          readonly organisation: boolean;
          readonly founderIdentity: boolean;
        }
      | undefined;
  };
};

/** Permission-neutral: callers authorise before they act on what it returns. */
export type SubjectDirectory = {
  readonly find: (subject: QCardSubject) => Promise<SubjectFacts | null>;
};

export type HandleStatus = "ACTIVE" | "HELD" | "RETIRED" | "RELEASED";

export type HandleRow = {
  readonly id: string;
  readonly handle: string;
  readonly subjectType: QCardSubjectType;
  readonly subjectId: string;
  readonly status: HandleStatus;
  readonly holdUntil: Date | null;
};

export type CardRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly organisationId: string | null;
  readonly subjectType: QCardSubjectType;
  readonly subjectId: string;
  readonly publicCode: string;
  readonly fieldScopes: unknown;
  readonly indexable: boolean;
  readonly status: "ACTIVE" | "REVOKED";
  readonly version: number;
  readonly updatedAt: string;
};

export type PublicIdentityRepository = {
  readonly isReserved: (
    sql: DatabaseExecutor,
    handle: string,
  ) => Promise<boolean>;
  /** The live (not RELEASED) row for a handle, locked. */
  readonly lockLive: (
    tx: TransactionContext,
    handle: string,
  ) => Promise<HandleRow | null>;
  readonly findLive: (
    sql: DatabaseExecutor,
    handle: string,
  ) => Promise<HandleRow | null>;
  readonly lockActiveForSubject: (
    tx: TransactionContext,
    subject: QCardSubject,
  ) => Promise<HandleRow | null>;
  readonly findActiveForSubject: (
    sql: DatabaseExecutor,
    subject: QCardSubject,
  ) => Promise<HandleRow | null>;
  readonly setStatus: (
    tx: TransactionContext,
    id: string,
    next: {
      readonly status: Exclude<HandleStatus, "ACTIVE">;
      readonly at: Date;
      readonly holdUntil: Date | null;
    },
  ) => Promise<void>;
  readonly insertActive: (
    tx: TransactionContext,
    row: {
      readonly handle: string;
      readonly tenantId: string;
      readonly organisationId: string | null;
      readonly subject: QCardSubject;
      readonly claimedByUserId: string;
    },
  ) => Promise<void>;
  readonly findCard: (
    sql: DatabaseExecutor,
    subject: QCardSubject,
  ) => Promise<CardRow | null>;
  /** The cards of many subjects of one type in one read; absent ones have none. */
  readonly findCards: (
    sql: DatabaseExecutor,
    subjectType: QCardSubject["subjectType"],
    subjectIds: readonly string[],
  ) => Promise<readonly CardRow[]>;
  readonly insertCard: (
    tx: TransactionContext,
    row: {
      readonly tenantId: string;
      readonly organisationId: string | null;
      readonly subject: QCardSubject;
      readonly publicCode: string;
      readonly fieldScopes: QCardFieldScopes;
      readonly createdByUserId: string;
    },
  ) => Promise<void>;
  /** Null when the version moved on. */
  readonly updateCard: (
    tx: TransactionContext,
    id: string,
    expectedVersion: number,
    patch: {
      readonly fieldScopes?: QCardFieldScopes | undefined;
      readonly indexable?: boolean | undefined;
    },
  ) => Promise<CardRow | null>;
  readonly findActiveCardByCode: (
    sql: DatabaseExecutor,
    code: string,
  ) => Promise<CardRow | null>;
  readonly countScan: (
    sql: DatabaseExecutor,
    cardId: string,
    day: string,
  ) => Promise<void>;
  readonly scansSince: (
    sql: DatabaseExecutor,
    cardId: string,
    day: string,
  ) => Promise<number>;
};
