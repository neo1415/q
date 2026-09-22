import type {
  PermittedContextPlan,
  QArtifactContent,
  QArtifactSummary,
  QArtifactVersion,
  QSubjectRef,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

/**
 * How the answer seam reaches the artifact context (ADR 0013).
 *
 * A port rather than an import. This package composes documents and must
 * not hold a repository, a transaction or anything that writes — the ADR
 * says so and the package boundary is where that is enforced, not a
 * comment. The composition root supplies an adapter over the artifact
 * application service; everything named here comes from the shared
 * contracts, so no artifact internal crosses into a specialist.
 *
 * Every method takes the run's own authorised plan. The service on the
 * other side re-derives authority from it rather than trusting the
 * arguments, so a caller that got the subject or the actor wrong is
 * refused there, not here.
 */

export type ArtifactPreparationPort = {
  /** Create the artifact and its first version. Returns the public card. */
  readonly prepare: (input: {
    readonly actorContext: ActorContext;
    readonly permittedContextPlan: PermittedContextPlan;
    readonly qRunId: string;
    readonly subject: QSubjectRef;
    readonly artifactType: string;
    readonly content: {
      readonly title: string;
      readonly summary: string;
      readonly content: QArtifactContent;
    };
  }) => Promise<QArtifactSummary>;

  /** Append a version. The previous one is untouched. */
  readonly revise: (input: {
    readonly actorContext: ActorContext;
    readonly permittedContextPlan: PermittedContextPlan;
    readonly qRunId: string;
    readonly artifactId: string;
    readonly instruction: string;
    readonly content: {
      readonly title: string;
      readonly summary: string;
      readonly content: QArtifactContent;
    };
  }) => Promise<QArtifactSummary>;

  /**
   * The version a revision starts from, or null when this person may not
   * read it. Re-authorised on the other side: a card in an old message is
   * not a grant.
   */
  readonly currentVersion: (
    actor: ActorContext,
    artifactId: string,
  ) => Promise<QArtifactVersion | null>;
};
