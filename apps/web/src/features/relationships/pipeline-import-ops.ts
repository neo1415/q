import type {
  PipelineImportAppliedDto,
  PipelineImportMapping,
  PipelineImportPreview,
  PipelineImportResolution,
  PipelineImportCounts,
} from "@capital-q/contracts";

import { mimeOf, uploadThroughEvidence } from "@/features/q/q-attachments";

import {
  applyPipelineImportAction,
  preparePipelineImportAction,
  type ImportActionResult,
} from "./pipeline-import-actions";

/**
 * What the import screen does, as one port: the real one goes through the
 * scanned documents upload and the server actions; the design-review
 * harness gives fixtures. Nothing here is authority: the API decides.
 */
export type PipelineImportOps = {
  readonly upload: (
    file: File,
    companyId: string | undefined,
  ) => Promise<
    | { readonly ok: true; readonly documentId: string }
    | { readonly ok: false; readonly message: string }
  >;
  readonly prepare: (input: {
    readonly documentId: string;
    readonly mapping?: PipelineImportMapping | undefined;
  }) => Promise<ImportActionResult<PipelineImportPreview>>;
  readonly apply: (input: {
    readonly importId: string;
    readonly documentId: string;
    readonly fileName: string;
    readonly proposalHash: string;
    readonly counts: PipelineImportCounts;
    readonly resolutions: readonly PipelineImportResolution[];
    readonly idempotencyKey: string;
  }) => Promise<ImportActionResult<PipelineImportAppliedDto>>;
};

export const PIPELINE_IMPORT_OPS: PipelineImportOps = {
  upload: async (file, companyId) => {
    try {
      return await uploadThroughEvidence({
        file,
        mimeType: mimeOf(file),
        idempotencyKey: crypto.randomUUID(),
        companyId,
      });
    } catch {
      return {
        ok: false,
        message:
          "The file couldn't be uploaded. Check your connection and try again.",
      };
    }
  },
  prepare: (input) =>
    preparePipelineImportAction({
      documentId: input.documentId,
      ...(input.mapping === undefined ? {} : { mapping: input.mapping }),
    }),
  apply: (input) =>
    applyPipelineImportAction({
      ...input,
      resolutions: [...input.resolutions],
    }),
};
