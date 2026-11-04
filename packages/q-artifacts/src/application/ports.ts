import type { TransactionContext } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";
import type { QArtifactContent, QArtifactStatus } from "@capital-q/contracts";

import type {
  ArtifactHistoryEntry,
  StoredArtifact,
  StoredArtifactVersion,
} from "../domain/artifact.js";

/** Server-derived identity of one immutable, approved workforce step. */
export type WorkforceDocumentBinding = {
  readonly jobId: string;
  readonly stepKey: string;
  /** SHA-256 of the approved intent, never of a freshly generated draft. */
  readonly intentSha256: string;
  /** Cost belongs to this workforce run; qRunId keeps the original Q provenance. */
  readonly execution?:
    | {
        readonly runId: string;
        readonly budgetUsd: number;
      }
    | undefined;
};

/**
 * SEC-01: the kinds of source an artifact can be composed from. Reference
 * data (persisted as text, never a Postgres enum): a company document whose
 * passages the run's authorised retrieval read or a finding cited, and a
 * company document read through the data room's own view as the person.
 */
export const ARTIFACT_SOURCE_KINDS = [
  "retrieved_document",
  "data_room_document",
] as const;
export type ArtifactSourceKind = (typeof ARTIFACT_SOURCE_KINDS)[number];

/**
 * One source document an artifact was composed from. Provenance, never a
 * grant: on every read the reader's current access to each one is asked
 * again, and any that is no longer open to them closes the artifact.
 */
export type ArtifactSourceRef = {
  readonly kind: ArtifactSourceKind;
  /** The source's id in its owning context (an Evidence document id). */
  readonly id: string;
};

/**
 * What this context stores, and what it borrows (QX-003C, ADR 0013).
 *
 * Artifacts owns the artifact, its versions and their order. It owns no
 * company (Companies does), no investor organisation (Investors does), no
 * evidence (Evidence does) and no conversation (the Q runtime does).
 * Composing the content happens elsewhere entirely and arrives here
 * already written — this context never calls a model, and no specialist
 * holds a repository from it.
 *
 * Every read takes an explicit `ActorContext`. There is no ambient tenant
 * here and no "current organisation" to fall back on: a repository that
 * could be called without saying who is asking is a repository that will
 * eventually be.
 */

export type ArtifactRepository = {
  /** Actor-scoped resume lookup; matching approved intent only. */
  readonly findForWorkforce?: (
    actor: ActorContext,
    input: WorkforceDocumentBinding & {
      readonly type: string;
      readonly companyId: string | null;
      readonly investorOrganisationId: string | null;
    },
  ) => Promise<StoredArtifact | null>;
  /**
   * Atomically claim the existing artifact row for a workforce step. A
   * restart reuses it, even before the runner recorded its result. The
   * binding is stored on artifacts, with no second document registry.
   * Optional only for adapters without workforce preparation support.
   */
  readonly createForWorkforce?: (
    tx: TransactionContext,
    artifact: Parameters<ArtifactRepository["create"]>[1],
    binding: WorkforceDocumentBinding,
  ) => Promise<{
    readonly artifact: StoredArtifact;
    readonly created: boolean;
  } | null>;
  /**
   * Start one. The artifact exists before its first version does, so a
   * person who closes the tab has something to come back to.
   */
  readonly create: (
    tx: TransactionContext,
    artifact: {
      readonly tenantId: string;
      readonly organisationId: string;
      readonly type: string;
      readonly companyId: string | null;
      readonly investorOrganisationId: string | null;
      readonly createdByUserId: string;
    },
  ) => Promise<StoredArtifact>;

  /**
   * Theirs, or null.
   *
   * Scoped by the actor's tenant and organisation in the query itself
   * rather than fetched and then checked: a row that is not theirs must
   * not be in this process's memory at all, and "not found" and
   * "not yours" must be the same answer to the caller.
   */
  readonly findById: (
    actor: ActorContext,
    artifactId: string,
  ) => Promise<StoredArtifact | null>;

  readonly list: (
    actor: ActorContext,
    query: {
      readonly limit: number;
      readonly before?: string | undefined;
      readonly subjectId?: string | undefined;
    },
  ) => Promise<readonly StoredArtifact[]>;

  readonly setStatus: (
    tx: TransactionContext,
    artifactId: string,
    status: QArtifactStatus,
  ) => Promise<void>;

  /**
   * Append a version and move the artifact to it, in one transaction.
   *
   * The unique constraint on (artifact_id, version) is what decides a
   * race; this returns null when it loses, so the caller can read the
   * moved number and try again rather than overwrite somebody's work.
   */
  readonly appendVersion: (
    tx: TransactionContext,
    version: {
      readonly artifactId: string;
      readonly tenantId: string;
      readonly version: number;
      readonly title: string;
      readonly summary: string;
      readonly content: QArtifactContent;
      readonly instruction: string | null;
      readonly composedByRunId: string | null;
      readonly createdByUserId: string;
    },
  ) => Promise<StoredArtifactVersion | null>;

  readonly findVersion: (
    actor: ActorContext,
    artifactId: string,
    version: number,
  ) => Promise<StoredArtifactVersion | null>;

  readonly history: (
    actor: ActorContext,
    artifactId: string,
  ) => Promise<readonly ArtifactHistoryEntry[]>;

  /**
   * SEC-01: record which source documents an artifact was composed from,
   * in the caller's transaction. Idempotent per (artifact, kind, id); never
   * removes or rewrites a recorded source. Optional only for adapters that
   * record none: the service refuses to file an artifact with sources into
   * a repository that cannot record them.
   */
  readonly recordSources?: (
    tx: TransactionContext,
    input: {
      readonly tenantId: string;
      readonly artifactId: string;
      readonly sources: readonly ArtifactSourceRef[];
    },
  ) => Promise<void>;

  /**
   * SEC-01: the recorded sources of these artifacts, scoped by the actor in
   * the query like every other read. An artifact with none is absent from
   * the map (or maps to an empty list).
   */
  readonly sourcesOf?: (
    actor: ActorContext,
    artifactIds: readonly string[],
  ) => Promise<ReadonlyMap<string, readonly ArtifactSourceRef[]>>;
};

/**
 * One composed version, before it has a number.
 *
 * Written by whoever composed it — today the Company Intelligence
 * specialist, under the run's own authorised plan — and handed here as
 * data. Nothing in this context produced it and nothing here can ask for
 * more of it.
 */
export type ComposedArtifact = {
  readonly title: string;
  readonly summary: string;
  readonly content: QArtifactContent;
};
