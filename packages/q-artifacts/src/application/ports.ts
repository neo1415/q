import type { TransactionContext } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";
import type { QArtifactContent, QArtifactStatus } from "@capital-q/contracts";

import type {
  ArtifactHistoryEntry,
  StoredArtifact,
  StoredArtifactVersion,
} from "../domain/artifact.js";

/**
 * What this context stores, and what it borrows (QX-003C).
 *
 * Artifacts owns the artifact, its versions and their order. It owns no
 * company (Companies does), no investor organisation (Investors does), no
 * evidence (Evidence does) and no conversation (the Q runtime does).
 * Composing the content is somebody else's job entirely and arrives here
 * through `ArtifactComposer` — this context never calls a model.
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

/** What a composed version consists of, before it has a number. */
export type ComposedArtifact = {
  readonly title: string;
  readonly summary: string;
  readonly content: QArtifactContent;
  /** The Q run that composed it, when there was one. Provenance only. */
  readonly composedByRunId?: string | undefined;
};

/**
 * Whoever actually writes the thing.
 *
 * Deliberately a port. This context knows that an artifact has versions
 * and who may read them; it does not know what an Investment Brief is,
 * which model composed it, or what it was allowed to look at. Those are
 * the composer's, and the composer resolves them under the same actor.
 */
export type ArtifactComposer = {
  readonly type: string;
  readonly compose: (input: {
    readonly actor: ActorContext;
    readonly companyId: string | null;
    readonly investorOrganisationId: string | null;
    /** The person's own words, when they gave any. Never system instructions. */
    readonly instruction: string | null;
    /**
     * What is being revised, when this is a revision. The composer sees
     * the previous version so a change is a change rather than a rewrite
     * that happens to be about the same company.
     */
    readonly previous?: ComposedArtifact | undefined;
  }) => Promise<ComposedArtifact>;
};
