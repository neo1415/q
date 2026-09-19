import type { TransactionManager } from "@capital-q/database";

import type {
  NewRecommendationItem,
  RecommendationItem,
  RecommendationSlate,
  RefreshPriority,
  RefreshReason,
  SlateDiagnostics,
  SlateInvalidationReason,
  SlateVersions,
} from "./contracts.js";

/**
 * What the slate layer reads and writes. The repository speaks in slate
 * and item rows; nothing here reaches a company, a mandate, a feature
 * value or a private source. Publication is one transaction: the builder
 * hands the repository a transaction manager so BUILDING → CURRENT and
 * CURRENT → SUPERSEDED cannot be observed apart.
 */

export type SlateKey = {
  readonly tenantId: string;
  readonly investorOrganisationId: string;
  readonly mandateId: string;
  readonly mode: string;
};

export type BeginBuildInput = SlateKey & {
  readonly mandateVersion: number;
  readonly versions: SlateVersions;
  readonly generatedAt: string;
};

export type PublishInput = {
  readonly slateId: string;
  readonly generationFingerprint: string;
  readonly itemCount: number;
  readonly diagnostics: SlateDiagnostics;
  readonly publishedAt: string;
  readonly expiresAt: string;
};

/** Refused when another build already holds the BUILDING claim. */
export class SlateBuildInProgressError extends Error {
  constructor() {
    super("a slate build is already in progress for this mandate and context");
    this.name = "SlateBuildInProgressError";
  }
}

export type SlateRepository = {
  /** Inserts a BUILDING slate; throws SlateBuildInProgressError on a concurrent claim. */
  readonly beginBuild: (input: BeginBuildInput) => Promise<RecommendationSlate>;
  /** Batch insert, in rank order. Only a BUILDING slate accepts items. */
  readonly insertItems: (
    slateId: string,
    tenantId: string,
    items: readonly NewRecommendationItem[],
  ) => Promise<number>;
  /**
   * In one transaction: the BUILDING slate becomes CURRENT with its
   * content stamped, and the previous CURRENT slate for the same key
   * becomes SUPERSEDED, linked from the new one. Returns the published
   * slate and the id it superseded.
   */
  readonly publish: (
    transactions: TransactionManager,
    input: PublishInput,
  ) => Promise<{
    readonly slate: RecommendationSlate;
    readonly supersededSlateId: string | null;
  }>;
  readonly fail: (slateId: string, failureCode: string) => Promise<void>;
  readonly invalidate: (
    slateId: string,
    reason: SlateInvalidationReason,
    at: string,
  ) => Promise<boolean>;
  readonly expire: (slateId: string) => Promise<boolean>;
  readonly findById: (slateId: string) => Promise<RecommendationSlate | null>;
  /** The CURRENT slate for the key, expired or not; the reader applies the policy. */
  readonly findCurrent: (key: SlateKey) => Promise<RecommendationSlate | null>;
  /** CURRENT slates that contain the company, across investors: the invalidation fan-out. */
  readonly findCurrentContaining: (
    companyId: string,
  ) => Promise<readonly RecommendationSlate[]>;
  /** CURRENT slates for an investor organisation, all mandates and contexts. */
  readonly findCurrentForInvestor: (input: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
  }) => Promise<readonly RecommendationSlate[]>;
  /** Every CURRENT slate, oldest publication first, bounded: the broad fan-out. */
  readonly listCurrent: (
    limit: number,
  ) => Promise<readonly RecommendationSlate[]>;
  /** Items after a rank, in rank order, bounded. */
  readonly pageItems: (input: {
    readonly slateId: string;
    readonly afterRank: number;
    readonly limit: number;
  }) => Promise<readonly RecommendationItem[]>;
  readonly listHistory: (
    key: SlateKey,
    limit: number,
  ) => Promise<readonly RecommendationSlate[]>;
};

export type RefreshRequest = {
  readonly id: string;
  readonly tenantId: string;
  readonly investorOrganisationId: string;
  readonly mandateId: string;
  readonly mode: string;
  readonly status: string;
  readonly priority: RefreshPriority;
  readonly reason: RefreshReason;
  readonly requestSequence: number;
  readonly claimedSequence: number | null;
  readonly attempts: number;
};

export type RefreshRequestStore = {
  /**
   * Upsert PENDING for the key: bumps the sequence, raises (never lowers)
   * the priority, records the latest reason. Returns the row and whether
   * it was newly pending (a message is worth sending) or already pending
   * (coalesced).
   */
  readonly requestRefresh: (
    input: SlateKey & {
      readonly reason: RefreshReason;
      readonly priority: RefreshPriority;
      readonly requestedAt: string;
    },
  ) => Promise<{
    readonly request: RefreshRequest;
    readonly coalesced: boolean;
  }>;
  /** Moves PENDING → CLAIMED for the key; null when nothing is pending. */
  readonly claim: (
    key: SlateKey,
    claimedAt: string,
  ) => Promise<RefreshRequest | null>;
  /**
   * CLAIMED → DONE, unless a newer request arrived meanwhile, in which case
   * the row returns to PENDING and `reopened` is true so the caller can
   * re-queue it.
   */
  readonly complete: (
    requestId: string,
    completedAt: string,
  ) => Promise<{ readonly reopened: boolean }>;
  /** CLAIMED → PENDING (retry) or FAILED (exhausted), with a bounded code. */
  readonly release: (
    requestId: string,
    outcome: "RETRY" | "FAILED",
    errorCode: string,
  ) => Promise<void>;
  readonly findByKey: (key: SlateKey) => Promise<RefreshRequest | null>;
};
