import type { TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";
import type {
  ListQArtifactsQuery,
  ListQArtifactsResponse,
  PermittedContextPlan,
  QArtifactDetail,
  QArtifactSummary,
  QSubjectRef,
} from "@capital-q/contracts";

import {
  canRevise,
  nextVersion,
  parseContent,
  toDetail,
  toSummary,
  type StoredArtifact,
} from "../domain/artifact.js";
import type { ArtifactRepository, ComposedArtifact } from "./ports.js";

/**
 * Preparing, reading and revising what Q composed (QX-003C-F; ADR 0013).
 *
 * This is the trusted persistence boundary, and it is the only one. A
 * specialist composes and hands the content here; a model never reaches
 * this file; no tool can call it, because the Tool Registry admits nothing
 * that writes. Persisting a private draft is Prepare, so no approval is
 * required — and nothing here publishes, shares or sends anything, which
 * is where approval would be.
 *
 * What makes it trusted is that it re-derives every piece of authority
 * from the run's own authorised plan rather than from its arguments:
 *
 *   - the plan must belong to this actor, this tenant and this run;
 *   - the subject must be one the Context Firewall already authorised;
 *   - the plan must not have gone stale;
 *   - the owner is the actor's organisation, never a field anybody passed.
 *
 * A caller that gets any of that wrong is refused rather than trusted,
 * because the alternative is an artifact owned by whoever asked nicely.
 *
 * Three further properties:
 *
 * **An artifact exists before its content does.** The row is written
 * first, in its own transaction, so the answer that mentions it can carry
 * a real identifier and a person who closes the tab has something to come
 * back to.
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

/**
 * The caller's authority did not survive re-derivation.
 *
 * Deliberately one error for every way that can happen — a plan for
 * another run, another actor, another tenant, a subject the firewall never
 * authorised, or a plan that has gone stale. A caller learning which of
 * those it was would be learning something about somebody else's context.
 */
export class ArtifactAuthorityError extends Error {
  constructor() {
    super("That is not something you can prepare here.");
    this.name = "ArtifactAuthorityError";
  }
}

/** What preparation needs, and nothing a browser or a model could choose. */
export type PrepareArtifactInput = {
  /** Server-resolved, from the verified session. */
  readonly actorContext: ActorContext;
  /** The Context Firewall's own decision for this run. Never hand-built. */
  readonly permittedContextPlan: PermittedContextPlan;
  readonly qRunId: string;
  /** Must be one the plan already authorises. */
  readonly subject: QSubjectRef;
  readonly artifactType: string;
  /** Already composed, under that plan, by something that cannot write. */
  readonly content: ComposedArtifact;
};

export type ReviseArtifactInput = {
  readonly actorContext: ActorContext;
  readonly permittedContextPlan: PermittedContextPlan;
  readonly qRunId: string;
  readonly artifactId: string;
  /** The person's own words for what should change. */
  readonly instruction: string;
  readonly content: ComposedArtifact;
};

export type ArtifactService = {
  /** Create the artifact and its first version. A Prepare operation. */
  readonly prepareArtifact: (
    input: PrepareArtifactInput,
  ) => Promise<QArtifactDetail>;
  /** Append a version. The previous one is untouched. */
  readonly reviseArtifact: (
    input: ReviseArtifactInput,
  ) => Promise<QArtifactDetail>;
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
  /** The public summary, for a caller that only needs a card. */
  readonly summarise: (
    actor: ActorContext,
    artifactId: string,
  ) => Promise<QArtifactSummary>;
};

/** How many times a losing race is retried before giving up. */
const APPEND_ATTEMPTS = 3;

function sameSubject(a: QSubjectRef, b: QSubjectRef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createArtifactService(dependencies: {
  readonly repository: ArtifactRepository;
  readonly transactions: TransactionManager;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
}): ArtifactService {
  const { repository, transactions } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  /**
   * Re-derive the caller's authority from the plan, or refuse.
   *
   * The arguments say what to do; the plan says what may be done. Where
   * they disagree the plan wins, and where the plan itself does not belong
   * to this actor, tenant or run there is nothing to disagree with.
   */
  const authorise = (input: {
    readonly actorContext: ActorContext;
    readonly permittedContextPlan: PermittedContextPlan;
    readonly qRunId: string;
    readonly subject?: QSubjectRef | undefined;
  }): string => {
    const plan = input.permittedContextPlan;
    const actor = input.actorContext;
    const organisationId = actor.organisationId;
    if (organisationId === undefined) {
      // An artifact belongs to an organisation. Somebody with none has no
      // workspace to own one, which is a refusal rather than a null owner.
      throw new ArtifactAuthorityError();
    }
    if (
      plan.runId !== input.qRunId ||
      plan.tenantId !== actor.tenantId ||
      plan.actor.userId !== actor.userId ||
      (plan.actor.organisationId !== undefined &&
        plan.actor.organisationId !== organisationId)
    ) {
      throw new ArtifactAuthorityError();
    }
    // A plan is a decision at a moment, and this one has passed.
    if (Date.parse(plan.revalidateAfter) <= now().getTime()) {
      throw new ArtifactAuthorityError();
    }
    if (
      input.subject !== undefined &&
      !plan.subjects.some((authorised) =>
        sameSubject(authorised, input.subject as QSubjectRef),
      )
    ) {
      // The firewall never authorised this subject for this run, so
      // neither does anything downstream of it.
      throw new ArtifactAuthorityError();
    }
    return organisationId;
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
    readonly runId: string;
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
          composedByRunId: input.runId,
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
    // Three losses in a row is contention this cannot resolve by trying
    // harder. Nothing was overwritten, which is the property that matters.
    throw new ArtifactCompositionFailedError();
  };

  return {
    prepareArtifact: async (input) => {
      const organisationId = authorise(input);
      const subject = input.subject;
      const artifact = await transactions.run((tx) =>
        repository.create(tx, {
          tenantId: input.actorContext.tenantId,
          // The owner is the actor's own organisation. Never an argument.
          organisationId,
          type: input.artifactType,
          companyId: subject.kind === "COMPANY" ? subject.companyId : null,
          investorOrganisationId:
            subject.kind === "INVESTOR_ORGANISATION"
              ? subject.investorOrganisationId
              : null,
          createdByUserId: input.actorContext.userId,
        }),
      );

      try {
        await append({
          actor: input.actorContext,
          artifact,
          composed: input.content,
          instruction: null,
          runId: input.qRunId,
        });
      } catch (error) {
        // Visible failure, not a vanished artifact: one that says what
        // happened is honest, and one that disappears looks like one
        // nobody asked for.
        await transactions.run((tx) =>
          repository.setStatus(tx, artifact.id, "FAILED"),
        );
        dependencies.logger?.warn(
          { artifactId: artifact.id, type: input.artifactType },
          "artifact preparation failed",
        );
        throw error;
      }

      const settled = await repository.findById(
        input.actorContext,
        artifact.id,
      );
      if (settled === null) {
        throw new ArtifactNotFoundError();
      }
      return detailOf(input.actorContext, settled);
    },

    reviseArtifact: async (input) => {
      const artifact = await repository.findById(
        input.actorContext,
        input.artifactId,
      );
      if (artifact === null) {
        throw new ArtifactNotFoundError();
      }
      // The subject is the artifact's own, so a revision cannot be used to
      // reach a company this run was never authorised for.
      const subject: QSubjectRef | undefined =
        artifact.companyId !== null
          ? { kind: "COMPANY", companyId: artifact.companyId }
          : artifact.investorOrganisationId !== null
            ? {
                kind: "INVESTOR_ORGANISATION",
                investorOrganisationId: artifact.investorOrganisationId,
              }
            : undefined;
      authorise({ ...input, subject });
      if (!canRevise(artifact)) {
        throw new ArtifactNotRevisableError();
      }
      await append({
        actor: input.actorContext,
        artifact,
        composed: input.content,
        instruction: input.instruction,
        runId: input.qRunId,
      });
      const settled = await repository.findById(
        input.actorContext,
        input.artifactId,
      );
      if (settled === null) {
        throw new ArtifactNotFoundError();
      }
      return detailOf(input.actorContext, settled);
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

    summarise: async (actor, artifactId) => {
      const artifact = await repository.findById(actor, artifactId);
      if (artifact === null) {
        throw new ArtifactNotFoundError();
      }
      const current =
        artifact.currentVersion === 0
          ? null
          : await repository.findVersion(
              actor,
              artifactId,
              artifact.currentVersion,
            );
      return toSummary(artifact, current);
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
  };
}
