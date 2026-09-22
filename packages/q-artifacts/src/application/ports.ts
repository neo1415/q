import type { TransactionContext } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";
import type { QArtifactContent, QArtifactStatus } from "@capital-q/contracts";

import type {
  ArtifactHistoryEntry,
  StoredArtifact,
  StoredArtifactVersion,
} from "../domain/artifact.js";

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
