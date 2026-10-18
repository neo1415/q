import type {
  ModelSensitivity,
  PermittedContextPlan,
  QArtifactContent,
  QDocumentPipelineStage,
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
    /**
     * The canonical entity it is about. Absent for a company Capital Q
     * holds no record of (CQ-QACT-002): the document belongs to the
     * person's organisation and names no record, because there is none.
     */
    readonly subject?: QSubjectRef | undefined;
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

/**
 * Q room W5 (R8): a document made by the worker. The run writes the first
 * draft and queues it with what it resolved as the person; the worker
 * designs, illustrates and checks it. `wait` follows the job's stages for
 * a bounded time (so the silence ladder can say them) and returns the
 * filed card, or null when it is still being made when the wait ends.
 */
export type DocumentPipelinePort = {
  readonly request: (input: {
    readonly actorContext: ActorContext;
    readonly permittedContextPlan: PermittedContextPlan;
    readonly qRunId: string;
    readonly subject?: QSubjectRef | undefined;
    readonly artifactType: string;
    readonly kind: "PITCH_DECK" | "ONE_PAGER" | "MEMO";
    readonly content: {
      readonly title: string;
      readonly summary: string;
      readonly content: QArtifactContent;
    };
    readonly job: {
      readonly grounding: readonly string[];
      readonly sectorCodes: readonly string[];
      readonly directionChosen: boolean;
      readonly brand: {
        readonly kitVersion: number;
        readonly palette: {
          readonly primary: string;
          readonly secondary?: string | undefined;
          readonly background?: string | undefined;
          readonly ink?: string | undefined;
        };
        readonly pairing?: string | undefined;
      } | null;
      readonly sensitivity: ModelSensitivity;
    };
  }) => Promise<QArtifactSummary>;
  readonly wait: (input: {
    readonly actor: ActorContext;
    readonly artifactId: string;
    readonly onStage: (stage: QDocumentPipelineStage) => Promise<void>;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<QArtifactSummary | null>;
};
