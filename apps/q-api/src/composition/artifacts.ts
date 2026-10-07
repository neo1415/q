import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createCorrelationId, type Logger } from "@capital-q/observability";
import {
  createArtifactService,
  createPostgresArtifactRepository,
  createPostgresDocumentJobRepository,
  type ArtifactService,
} from "@capital-q/q-artifacts";
import {
  createBriefReviser,
  createDeckPolisher,
  latestArtifactIn,
  type ArtifactPreparation,
  type ArtifactPreparationPort,
  type DocumentPipelinePort,
  type StockPhotoPort,
} from "@capital-q/q-specialists";
import type { QDocumentPipelineStage } from "@capital-q/contracts";
import type { QArtifactReviser } from "@capital-q/model-gateway/q";
import type { DocumentRevisionPort } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";
import type { PermittedContextPlan } from "@capital-q/contracts";

/**
 * The artifact context, composed (QX-003D; ADR 0013).
 *
 * The adapter below is the whole of the seam between the answer path and
 * the artifact context, and it is deliberately thin: it takes what the
 * port promises and hands it to the application service, which re-derives
 * authority from the run's own plan rather than trusting any of it.
 *
 * The direction matters. `q-specialists` declares the port and never
 * imports this package or the artifact context; the composition root
 * knows about both. So a specialist cannot reach a repository even by
 * accident, which is the property ADR 0013 turns on and a package
 * boundary rather than a comment enforces.
 */

export type QArtifactsComposition = {
  readonly service: ArtifactService;
  readonly preparation: ArtifactPreparation;
  /**
   * The same capability for the conversational seam (QX-003F).
   *
   * "Make the executive summary shorter" is a question about wording, not
   * a company investigation, so it is answered on the conversational path
   * — and somebody should not have to phrase a change as an analysis
   * request to be understood.
   */
  readonly reviser: QArtifactReviser;
  /**
   * The same revision, by id, for the `revise_my_document` tool (founder
   * directive 2026-09-28): the tool names the document from its card or
   * the documents list; the service still reads it as the actor.
   */
  readonly documentRevision: DocumentRevisionPort;
};

export function createQArtifacts(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly gateway: ModelGateway;
  readonly logger?: Logger | undefined;
  /** Stock photos for decks; absent means decks are made without them. */
  readonly photos?: StockPhotoPort | undefined;
  /** DOCS: the confirmed brand kit and the actor's own company, as the actor. */
  readonly studio?:
    Omit<NonNullable<ArtifactPreparation["studio"]>, "polisher"> | undefined;
  /**
   * Q room W5 (R8): how decks, one-pagers and memos are made. JOB (the
   * default in a deployment): the worker makes them and the run follows
   * the job for `waitMs`; IN_RUN: the run makes them itself (a stack with
   * no worker); STUDIO: the earlier in-run studio.
   */
  readonly documentPipeline?:
    | {
        readonly mode: "JOB" | "IN_RUN" | "STUDIO";
        readonly waitMs?: number | undefined;
        readonly pollMs?: number | undefined;
      }
    | undefined;
}): QArtifactsComposition {
  const service = createArtifactService({
    repository: createPostgresArtifactRepository({ sql: dependencies.sql }),
    jobs: createPostgresDocumentJobRepository({ sql: dependencies.sql }),
    transactions: dependencies.transactions,
    ...(dependencies.logger === undefined
      ? {}
      : { logger: dependencies.logger }),
  });

  const port: ArtifactPreparationPort = {
    prepare: async (input) => {
      const detail = await service.prepareArtifact({
        actorContext: input.actorContext,
        permittedContextPlan: input.permittedContextPlan,
        qRunId: input.qRunId,
        ...(input.subject === undefined ? {} : { subject: input.subject }),
        artifactType: input.artifactType,
        content: input.content,
      });
      return detail.artifact;
    },
    revise: async (input) => {
      const detail = await service.reviseArtifact({
        actorContext: input.actorContext,
        permittedContextPlan: input.permittedContextPlan,
        qRunId: input.qRunId,
        artifactId: input.artifactId,
        instruction: input.instruction,
        content: input.content,
      });
      return detail.artifact;
    },
    currentVersion: async (actor, artifactId) => {
      try {
        const detail = await service.read(actor, artifactId);
        return detail.current ?? null;
      } catch {
        // Not theirs, or gone. The caller prepares a fresh one rather
        // than learning which of those it was.
        return null;
      }
    },
  };

  const reviser = createBriefReviser({
    gateway: dependencies.gateway,
    ...(dependencies.logger === undefined
      ? {}
      : { logger: dependencies.logger }),
  });

  /**
   * One revision: read the current version as the actor, rewrite it from
   * the instruction (grounded only in what it already says), and file the
   * result as a new version through the service, which re-authorises it
   * under the run's plan. Null: not theirs, gone, or nothing to revise.
   */
  const reviseById = async (input: {
    readonly actor: ActorContext;
    readonly plan: PermittedContextPlan;
    readonly runId: string;
    readonly artifactId: string;
    readonly instruction: string;
    readonly signal?: AbortSignal | undefined;
  }) => {
    const detail = await service
      .read(input.actor, input.artifactId)
      .catch(() => null);
    if (detail === null) return { status: "NOT_FOUND" as const };
    const current = detail.current;
    if (current === undefined || current === null) {
      return { status: "NOT_REVISABLE" as const };
    }
    const revised = await reviser.revise({
      base: {
        title: current.title,
        summary: current.summary,
        content: current.content,
      },
      instruction: input.instruction,
      // What the document already carries is what a revision may
      // restate; nothing else is in scope for a rewrite.
      grounding: current.content.sections.flatMap((section) => [
        section.body,
        ...section.findings.map((finding) => finding.statement),
      ]),
      sensitivity: input.plan.maxSensitivity,
      attribution: {
        tenantId: input.actor.tenantId,
        userId: input.actor.userId,
        qRunId: input.runId,
        // Its own correlation id: a plan identifier is not one, and
        // labelling a model call with it would make the trace lie.
        correlationId: createCorrelationId(),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const written = await service.reviseArtifact({
      actorContext: input.actor,
      permittedContextPlan: input.plan,
      qRunId: input.runId,
      artifactId: input.artifactId,
      instruction: input.instruction,
      content: revised,
    });
    return { status: "REVISED" as const, artifact: written.artifact };
  };

  const pipelinePort = createDocumentPipelinePort(service, {
    waitMs: dependencies.documentPipeline?.waitMs ?? 45_000,
    pollMs: dependencies.documentPipeline?.pollMs ?? 1_000,
  });
  const mode = dependencies.documentPipeline?.mode ?? "STUDIO";

  return {
    service,
    documentRevision: {
      revise: async (input) => {
        try {
          const outcome = await reviseById(input);
          if (outcome.status !== "REVISED") return outcome;
          return {
            status: "REVISED",
            artifactId: outcome.artifact.artifactId,
            type: outcome.artifact.type,
            artifactStatus: outcome.artifact.status,
            title: outcome.artifact.title,
            currentVersion: outcome.artifact.currentVersion,
          };
        } catch (error: unknown) {
          if (input.signal?.aborted === true) throw error;
          dependencies.logger?.warn(
            { err: error, qRunId: input.runId },
            "revise_my_document did not complete",
          );
          return { status: "FAILED" };
        }
      },
    },
    reviser: {
      reviseFromConversation: async (input) => {
        // Which document they mean comes from their own conversation's
        // cards, never from anything a model said.
        const artifactId = latestArtifactIn(input.history);
        if (artifactId === null) return null;
        const outcome = await reviseById({
          actor: input.actor,
          plan: input.plan,
          runId: input.runId,
          artifactId,
          instruction: input.instruction,
          signal: input.signal,
        });
        return outcome.status === "REVISED" ? outcome.artifact : null;
      },
    },
    preparation: {
      port,
      reviser,
      photos: dependencies.photos,
      ...(mode === "JOB"
        ? { pipeline: { mode: "JOB" as const, port: pipelinePort } }
        : mode === "IN_RUN"
          ? { pipeline: { mode: "IN_RUN" as const } }
          : {}),
      // DOCS block: the document studio's steps for new decks.
      ...(dependencies.studio === undefined
        ? {}
        : {
            studio: {
              ...dependencies.studio,
              polisher: createDeckPolisher({
                gateway: dependencies.gateway,
                ...(dependencies.logger === undefined
                  ? {}
                  : { logger: dependencies.logger }),
              }),
            },
          }),
    },
  };
}

/**
 * Q room W5 (R8): the document pipeline port over the artifact service.
 * `request` starts the document and queues its job under the run's plan;
 * `wait` follows the job's stage as the person (their own job only) for a
 * bounded time and hands back the filed card, or null when it is still
 * being made (the room keeps following it).
 */
export function createDocumentPipelinePort(
  service: ArtifactService,
  options: {
    readonly waitMs: number;
    readonly pollMs: number;
    readonly sleep?: ((ms: number) => Promise<void>) | undefined;
    readonly now?: (() => number) | undefined;
  },
): DocumentPipelinePort {
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = options.now ?? Date.now;
  return {
    request: async (input) =>
      (
        await service.requestDocument({
          actorContext: input.actorContext,
          permittedContextPlan: input.permittedContextPlan,
          qRunId: input.qRunId,
          ...(input.subject === undefined ? {} : { subject: input.subject }),
          artifactType: input.artifactType,
          content: input.content,
          kind: input.kind,
          job: {
            grounding: [...input.job.grounding],
            sectorCodes: [...input.job.sectorCodes],
            directionChosen: input.job.directionChosen,
            brand:
              input.job.brand === null
                ? null
                : {
                    kitVersion: input.job.brand.kitVersion,
                    palette: input.job.brand.palette,
                    ...(input.job.brand.pairing === undefined
                      ? {}
                      : { pairing: input.job.brand.pairing }),
                  },
            sensitivity: input.job.sensitivity,
          },
        })
      ).artifact,
    wait: async (input) => {
      const until = now() + options.waitMs;
      let said: QDocumentPipelineStage | null = null;
      while (now() < until && input.signal?.aborted !== true) {
        const progress = await service
          .documentProgress(input.actor, input.artifactId)
          .catch(() => null);
        if (progress === null) return null;
        if (progress.stage !== said) {
          said = progress.stage;
          await input.onStage(progress.stage).catch(() => undefined);
        }
        if (progress.status === "DONE" || progress.status === "FAILED") {
          return (await service.read(input.actor, input.artifactId)).artifact;
        }
        await sleep(options.pollMs);
      }
      return null;
    },
  };
}
