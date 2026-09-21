import type { TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";
import type {
  ListQArtifactsQuery,
  ListQArtifactsResponse,
  QArtifactDetail,
} from "@capital-q/contracts";

import {
  canRevise,
  nextVersion,
  parseContent,
  toDetail,
  toSummary,
  type StoredArtifact,
} from "../domain/artifact.js";
import type {
  ArtifactComposer,
  ArtifactRepository,
  ComposedArtifact,
} from "./ports.js";

/**
 * Preparing, reading and revising what Q composed (QX-003C, QX-003F).
 *
 * Three things this is careful about.
 *
 * **An artifact exists before its content does.** Composition takes as
 * long as a model takes. The row is written first, in its own
 * transaction, so the answer that mentions it can carry a real identifier
 * and a person who closes the tab has something to come back to. If
 * composition then fails, the artifact says FAILED rather than
 * disappearing — an artifact that vanishes looks like one that was never
 * asked for.
 *
 * **A revision is an append.** The previous version stays exactly as it
 * was, because somebody who sent a brief to an investor last week needs to
 * see what they sent. Nothing here updates a version row.
 *
 * **Not found and not yours are the same answer.** Every read is scoped by
 * the actor in the query, so an artifact belonging to another tenant or
 * another organisation is not fetched and then rejected — it is not
 * fetched. A caller cannot tell the two apart, which is the point.
 */

export class ArtifactNotFoundError extends Error {
  constructor() {
    super("No such artifact.");
    this.name = "ArtifactNotFoundError";
  }
}

export class ArtifactNotRevisableError extends Error {
  constructor() {
    super("That artifact has nothing to revise yet.");
    this.name = "ArtifactNotRevisableError";
  }
}

export class ArtifactCompositionFailedError extends Error {
  constructor() {
    super("Q could not prepare that.");
    this.name = "ArtifactCompositionFailedError";
  }
}

export type ArtifactService = {
  readonly prepare: (input: {
    readonly actor: ActorContext;
    readonly type: string;
    readonly companyId: string | null;
    readonly investorOrganisationId: string | null;
    readonly instruction: string | null;
  }) => Promise<QArtifactDetail>;
  readonly read: (
    actor: ActorContext,
    artifactId: string,
  ) => Promise<QArtifactDetail>;
  readonly readVersion: (
    actor: ActorContext,
    artifactId: string,
    version: number,
  ) => Promise<QArtifactDetail>;
  readonly list: (
    actor: ActorContext,
    query: ListQArtifactsQuery,
  ) => Promise<ListQArtifactsResponse>;
  readonly revise: (input: {
    readonly actor: ActorContext;
    readonly artifactId: string;
    readonly instruction: string;
  }) => Promise<QArtifactDetail>;
};

/** How many times a losing race is retried before giving up. */
const APPEND_ATTEMPTS = 3;

export function createArtifactService(dependencies: {
  readonly repository: ArtifactRepository;
  readonly transactions: TransactionManager;
  readonly composers: readonly ArtifactComposer[];
  readonly logger?: Logger | undefined;
}): ArtifactService {
  const { repository, transactions, composers } = dependencies;

  const composerFor = (type: string): ArtifactComposer => {
    const composer = composers.find((candidate) => candidate.type === type);
    if (composer === undefined) {
      // A type nobody can compose is not a 500: it is a request for
      // something this build does not make.
      throw new ArtifactNotFoundError();
    }
    return composer;
  };

  const detailOf = async (
    actor: ActorContext,
    artifact: StoredArtifact,
  ): Promise<QArtifactDetail> => {
    const current =
      artifact.currentVersion === 0
        ? null
        : await repository.findVersion(
            actor,
            artifact.id,
            artifact.currentVersion,
          );
    const history = await repository.history(actor, artifact.id);
    return toDetail(artifact, current, history);
  };

  /**
   * Write a composed version, retrying against a number that has moved.
   *
   * The database decides the sequence. Losing means somebody else's
   * revision landed while this one was being composed, and the right
   * answer is to take the next free number, never to overwrite theirs.
   */
  const append = async (input: {
    readonly actor: ActorContext;
    readonly artifact: StoredArtifact;
    readonly composed: ComposedArtifact;
    readonly instruction: string | null;
  }) => {
    let current = input.artifact.currentVersion;
    for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt += 1) {
      const written = await transactions.run(async (tx) => {
        const version = await repository.appendVersion(tx, {
          artifactId: input.artifact.id,
          tenantId: input.artifact.tenantId,
          version: nextVersion(current),
          title: input.composed.title,
          summary: input.composed.summary,
          // Validated here as well as at the boundary: this is the last
          // place before it becomes a stored row.
          content: parseContent(input.composed.content),
          instruction: input.instruction,
          composedByRunId: input.composed.composedByRunId ?? null,
          createdByUserId: input.actor.userId,
        });
        if (version !== null) {
          await repository.setStatus(tx, input.artifact.id, "READY");
        }
        return version;
      });
      if (written !== null) {
        return written;
      }
      const moved = await repository.findById(input.actor, input.artifact.id);
      if (moved === null) {
        throw new ArtifactNotFoundError();
      }
      current = moved.currentVersion;
    }
    throw new ArtifactCompositionFailedError();
  };

  return {
    prepare: async ({
      actor,
      type,
      companyId,
      investorOrganisationId,
      instruction,
    }) => {
      const composer = composerFor(type);
      // The row first, in its own transaction, so it survives whatever
      // composition does next.
      const artifact = await transactions.run((tx) =>
        repository.create(tx, {
          tenantId: actor.tenantId,
          organisationId: actor.organisationId ?? "",
          type,
          companyId,
          investorOrganisationId,
          createdByUserId: actor.userId,
        }),
      );

      let composed: ComposedArtifact;
      try {
        composed = await composer.compose({
          actor,
          companyId,
          investorOrganisationId,
          instruction,
        });
      } catch (error) {
        // Visible failure, not a vanished artifact.
        await transactions.run((tx) =>
          repository.setStatus(tx, artifact.id, "FAILED"),
        );
        dependencies.logger?.warn(
          { artifactId: artifact.id, type },
          "artifact composition failed",
        );
        if (error instanceof ArtifactNotFoundError) throw error;
        throw new ArtifactCompositionFailedError();
      }

      await append({ actor, artifact, composed, instruction });
      const settled = await repository.findById(actor, artifact.id);
      if (settled === null) {
        throw new ArtifactNotFoundError();
      }
      return detailOf(actor, settled);
    },

    read: async (actor, artifactId) => {
      const artifact = await repository.findById(actor, artifactId);
      if (artifact === null) {
        throw new ArtifactNotFoundError();
      }
      return detailOf(actor, artifact);
    },

    readVersion: async (actor, artifactId, version) => {
      const artifact = await repository.findById(actor, artifactId);
      if (artifact === null) {
        throw new ArtifactNotFoundError();
      }
      const stored = await repository.findVersion(actor, artifactId, version);
      if (stored === null) {
        throw new ArtifactNotFoundError();
      }
      const history = await repository.history(actor, artifactId);
      // The artifact, shown at the version that was asked for: reading V1
      // of something now on V2 shows V1's content and the whole history.
      return toDetail(artifact, stored, history);
    },

    list: async (actor, query) => {
      // One more than asked for, so "is there another page" is answered
      // without a second count over a table that is changing.
      const rows = await repository.list(actor, {
        limit: query.limit + 1,
        before: query.before,
        subjectId: query.subjectId,
      });
      const page = rows.slice(0, query.limit);
      const items = await Promise.all(
        page.map(async (artifact) => {
          const current =
            artifact.currentVersion === 0
              ? null
              : await repository.findVersion(
                  actor,
                  artifact.id,
                  artifact.currentVersion,
                );
          return toSummary(artifact, current);
        }),
      );
      const last = page.at(-1);
      return {
        items,
        ...(rows.length > query.limit && last !== undefined
          ? { nextBefore: last.updatedAt }
          : {}),
      };
    },

    revise: async ({ actor, artifactId, instruction }) => {
      const artifact = await repository.findById(actor, artifactId);
      if (artifact === null) {
        throw new ArtifactNotFoundError();
      }
      if (!canRevise(artifact)) {
        throw new ArtifactNotRevisableError();
      }
      const previous = await repository.findVersion(
        actor,
        artifactId,
        artifact.currentVersion,
      );
      if (previous === null) {
        throw new ArtifactNotRevisableError();
      }
      const composer = composerFor(artifact.type);
      let composed: ComposedArtifact;
      try {
        composed = await composer.compose({
          actor,
          companyId: artifact.companyId,
          investorOrganisationId: artifact.investorOrganisationId,
          instruction,
          previous: {
            title: previous.title,
            summary: previous.summary,
            content: previous.content,
          },
        });
      } catch {
        // The artifact stays READY at the version it already has: a
        // revision that could not be composed has not damaged anything,
        // and saying FAILED here would hide a version that is fine.
        dependencies.logger?.warn(
          { artifactId, type: artifact.type },
          "artifact revision failed",
        );
        throw new ArtifactCompositionFailedError();
      }

      await append({ actor, artifact, composed, instruction });
      const settled = await repository.findById(actor, artifactId);
      if (settled === null) {
        throw new ArtifactNotFoundError();
      }
      return detailOf(actor, settled);
    },
  };
}
