import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createArtifactService,
  createPostgresArtifactRepository,
  type ArtifactService,
} from "@capital-q/q-artifacts";
import {
  createBriefReviser,
  type ArtifactPreparation,
  type ArtifactPreparationPort,
} from "@capital-q/q-specialists";

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
};

export function createQArtifacts(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly gateway: ModelGateway;
  readonly logger?: Logger | undefined;
}): QArtifactsComposition {
  const service = createArtifactService({
    repository: createPostgresArtifactRepository({ sql: dependencies.sql }),
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
        subject: input.subject,
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

  return {
    service,
    preparation: {
      port,
      reviser: createBriefReviser({
        gateway: dependencies.gateway,
        ...(dependencies.logger === undefined
          ? {}
          : { logger: dependencies.logger }),
      }),
    },
  };
}
