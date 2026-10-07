import { createCorrelationId } from "@capital-q/observability";
import {
  DOCUMENT_JOB_ATTEMPTS_MAX,
  jobActor,
  type ArtifactService,
  type ClaimedDocumentJob,
  type DocumentImages,
  type DocumentJobRepository,
} from "@capital-q/q-artifacts";
import {
  runDocumentPipeline,
  type DeckPolisher,
  type StockPhotoPort,
} from "@capital-q/q-specialists";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

/**
 * The document worker (Q room W5, R8).
 *
 * The Q run wrote the first draft from the person's record and queued a
 * job; this designs it, finds its pictures, checks it (at most two fix
 * rounds) and files the first version, saying each stage as it goes so the
 * room and the silence ladder can speak it. One job at a time: a document
 * is a few seconds of CPU and a few network calls, and the VM is shared.
 *
 * A failed attempt is retried once from the start (the pipeline is pure
 * over the job's input, and every picture it files is budgeted and
 * attributed to the run, so a retry cannot overspend); a second failure
 * rests the artifact at FAILED, visibly.
 */

export const DOCUMENT_JOB_INTERVAL_MS = 3_000;

export type DocumentJobRunner = {
  /** One job, if one is waiting. True when a job was taken. */
  readonly runOnce: (signal?: AbortSignal) => Promise<boolean>;
};

export function createDocumentJobRunner(dependencies: {
  readonly jobs: DocumentJobRepository;
  readonly artifacts: Pick<
    ArtifactService,
    "completeDocumentJob" | "failDocumentJob"
  >;
  readonly photos?: StockPhotoPort | undefined;
  readonly images?: Pick<DocumentImages, "illustrationsFor"> | undefined;
  readonly polisher?: DeckPolisher | undefined;
  readonly logger: RunnerLogger;
}): DocumentJobRunner {
  const { jobs, artifacts, logger } = dependencies;

  const run = async (
    job: ClaimedDocumentJob,
    signal: AbortSignal | undefined,
  ): Promise<void> => {
    const actor = jobActor(job);
    const correlationId = createCorrelationId();
    const { input } = job;
    const result = await runDocumentPipeline(input.content, {
      kind: job.kind,
      grounding: input.grounding,
      sectorCodes: input.sectorCodes,
      directionChosen: input.directionChosen,
      brand: input.brand,
      photos: dependencies.photos,
      illustrations:
        job.kind === "PITCH_DECK"
          ? dependencies.images?.illustrationsFor({
              actor,
              runId: job.runId,
              correlationId,
            })
          : undefined,
      polisher: dependencies.polisher,
      sensitivity: input.sensitivity,
      attribution: {
        tenantId: job.tenantId,
        userId: job.userId,
        qRunId: job.runId,
        correlationId,
      },
      onStage: (stage) =>
        stage === "READY" ? undefined : jobs.setStage(job.id, stage),
      signal,
    });
    await artifacts.completeDocumentJob(job, {
      title: input.title,
      summary: input.summary,
      content: result.content,
    });
    await jobs.finish(job.id, "DONE");
    logger.info(
      {
        artifactId: job.artifactId,
        kind: job.kind,
        rounds: result.rounds,
        passed: result.passed,
      },
      "document job filed",
    );
  };

  return {
    runOnce: async (signal) => {
      const job = await jobs.claim();
      if (job === null) return false;
      try {
        await run(job, signal);
      } catch (error) {
        const retry = job.attempts < DOCUMENT_JOB_ATTEMPTS_MAX;
        logger.warn(
          {
            artifactId: job.artifactId,
            attempt: job.attempts,
            retry,
            error: error instanceof Error ? error.name : "unknown",
          },
          "document job attempt failed",
        );
        if (retry) {
          await jobs.release(job.id).catch(() => undefined);
        } else {
          await artifacts.failDocumentJob(job).catch(() => undefined);
          await jobs.finish(job.id, "FAILED", "PIPELINE_FAILED");
        }
      }
      return true;
    },
  };
}

/** Takes waiting jobs one at a time; idles between empty polls. */
export async function runDocumentJobTicker(options: {
  readonly runner: DocumentJobRunner;
  readonly signal: AbortSignal;
  readonly logger: RunnerLogger;
  readonly intervalMs?: number | undefined;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
}): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  const intervalMs = options.intervalMs ?? DOCUMENT_JOB_INTERVAL_MS;
  while (!options.signal.aborted) {
    let took = false;
    try {
      took = await options.runner.runOnce(options.signal);
    } catch {
      options.logger.warn(
        {},
        "document job tick failed; retrying next interval",
      );
    }
    if (!took) await sleep(intervalMs, options.signal);
  }
}
