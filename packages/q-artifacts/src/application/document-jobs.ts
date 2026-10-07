import {
  QArtifactContentSchema,
  QBrandPaletteSchema,
  QDocumentPipelineStageSchema,
  type QDocumentPipelineStage,
} from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";
import { z } from "zod";

/**
 * A document Q is making, as a job (Q room W5, R8).
 *
 * The Q run writes the first draft from the person's record (the writer)
 * and resolves, as the person, what the rest needs: the statements the
 * document may rest on, their sector codes and their confirmed brand kit.
 * The worker does the rest (design, pictures, checks) and files the first
 * version. The job carries data, never authority: the worker files only
 * into the artifact the job names, for the organisation that owns it,
 * as the person who asked, while that person is still a member.
 */

export const DOCUMENT_JOB_KINDS = ["PITCH_DECK", "ONE_PAGER", "MEMO"] as const;
export const DocumentJobKindSchema = z.enum(DOCUMENT_JOB_KINDS);
export type DocumentJobKind = z.infer<typeof DocumentJobKindSchema>;

/** At most this many attempts; a job that fails twice stays failed. */
export const DOCUMENT_JOB_ATTEMPTS_MAX = 2;

export const DocumentJobInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(600),
    content: QArtifactContentSchema,
    grounding: z.array(z.string().max(2_000)).max(400),
    sectorCodes: z.array(z.string().max(64)).max(24),
    directionChosen: z.boolean(),
    brand: z
      .object({
        kitVersion: z.number().int().min(1),
        palette: QBrandPaletteSchema,
        pairing: z.string().max(64).optional(),
      })
      .strict()
      .nullable(),
    sensitivity: z.string().max(32),
  })
  .strict();
export type DocumentJobInput = z.infer<typeof DocumentJobInputSchema>;

export type DocumentJobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";

export type ClaimedDocumentJob = {
  readonly id: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly artifactId: string;
  readonly userId: string;
  readonly runId: string;
  readonly kind: DocumentJobKind;
  readonly attempts: number;
  readonly input: DocumentJobInput;
};

export type DocumentJobProgress = {
  readonly artifactId: string;
  readonly stage: QDocumentPipelineStage;
  readonly status: DocumentJobStatus;
  readonly updatedAt: string;
};

export const DocumentJobStageSchema = QDocumentPipelineStageSchema;

export type DocumentJobRepository = {
  readonly enqueue: (
    tx: TransactionContext,
    job: {
      readonly tenantId: string;
      readonly organisationId: string;
      readonly artifactId: string;
      readonly userId: string;
      readonly runId: string;
      readonly kind: DocumentJobKind;
      readonly input: DocumentJobInput;
    },
  ) => Promise<void>;
  /** The person's own job for an artifact, or null (not theirs or none). */
  readonly progress: (
    actor: ActorContext,
    artifactId: string,
  ) => Promise<DocumentJobProgress | null>;
  /**
   * The oldest waiting job whose requester is still an active member,
   * marked RUNNING (one more attempt), or null. Jobs out of attempts, or
   * whose requester left, are failed (with their artifact) on the way.
   */
  readonly claim: () => Promise<ClaimedDocumentJob | null>;
  readonly setStage: (
    jobId: string,
    stage: QDocumentPipelineStage,
  ) => Promise<void>;
  readonly finish: (
    jobId: string,
    outcome: "DONE" | "FAILED",
    failureCode?: string | undefined,
  ) => Promise<void>;
  /** Back to the queue after a failed attempt that may be retried. */
  readonly release: (jobId: string) => Promise<void>;
};

/** The person the job acts for, as an actor (Q acting on their behalf). */
export function jobActor(job: ClaimedDocumentJob): ActorContext {
  return ActorContextSchema.parse({
    userId: job.userId,
    tenantId: job.tenantId,
    organisationId: job.organisationId,
    actorType: "Q",
  });
}
