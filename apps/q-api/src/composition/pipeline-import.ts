import type { BoardService } from "@capital-q/board";
import {
  createOwnScannedFileReader,
  type PrivateDocumentStorageProvider,
  type EvidenceService,
} from "@capital-q/evidence";
import type { ModelDataPosture } from "@capital-q/contracts";
import { PIPELINE_IMPORT_MAX_BYTES } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createPipelineColumnMapper } from "@capital-q/model-gateway/q";
import {
  createPipelineImportService,
  type InterestServiceOptions,
  type PipelineImportService,
} from "@capital-q/network";
import type { Logger } from "@capital-q/observability";

/**
 * CRM import (decision 106) for Q: "import my pipeline" prepares through
 * the same Network service the screen's routes call, reading the upload
 * only once its scan is CLEAN, with Q's column mapping through the model
 * gateway (header synonyms when Q gives nothing usable). A next step from
 * a row becomes a task on the person's own board, by the board's own key.
 */
export function createQApiPipelineImport(dependencies: {
  readonly interests: InterestServiceOptions;
  readonly evidence: () => Pick<EvidenceService, "getDocumentWithVersion">;
  readonly storage:
    Pick<PrivateDocumentStorageProvider, "openObjectStream"> | undefined;
  readonly gateway: Pick<ModelGateway, "execute"> | undefined;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly board: () => Pick<BoardService, "add">;
  readonly logger: Logger;
}): PipelineImportService {
  const { storage, gateway } = dependencies;
  return createPipelineImportService({
    ...dependencies.interests,
    files:
      storage === undefined
        ? undefined
        : createOwnScannedFileReader({
            getDocumentWithVersion: (query) =>
              dependencies.evidence().getDocumentWithVersion(query),
            storage,
            maxBytes: PIPELINE_IMPORT_MAX_BYTES,
          }),
    mapper:
      gateway === undefined
        ? undefined
        : createPipelineColumnMapper({
            gateway,
            logger: dependencies.logger,
            dataPosture: dependencies.dataPosture,
          }),
    tasks: {
      addTask: async (actor, task, options) => {
        const outcome = await dependencies.board().add(
          actor,
          {
            kind: "TASK",
            title: task.title,
            notes: task.notes,
            ...(task.dueOn === null ? {} : { dueOn: task.dueOn }),
          },
          {
            by: options.byQ ? "Q" : "PERSON",
            idempotencyKey: options.idempotencyKey,
          },
        );
        return outcome.outcome === "OK" && !outcome.replayed;
      },
    },
  });
}
