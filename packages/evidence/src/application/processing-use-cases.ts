import { z } from "zod";

import { ContractValidationError } from "@capital-q/contracts";
import { TenantIdSchema } from "@capital-q/security";

import {
  DocumentVersionIdSchema,
  MalwareScanStatusSchema,
  PipelineVersionSchema,
  ProcessingRunStatusSchema,
  ProcessingStatusSchema,
  TextExtractionStatusSchema,
  type DocumentProcessingRun,
  type DocumentVersion,
} from "../contracts/index.js";
import { DocumentVersionNotFoundError } from "../domain/errors.js";
import type { EvidenceServiceDependencies } from "./dependencies.js";

/**
 * Processing provenance primitives for CQ-EVD-002/003. They are trusted
 * server operations (an upload verifier or a worker), scoped by tenant and
 * version id, and they run no scanner, parser, classifier or model. They
 * only record that a pipeline run exists and how the version's state moved.
 */

export const RegisterProcessingRunInputSchema = z
  .object({
    tenantId: z.string().uuid(),
    documentVersionId: DocumentVersionIdSchema,
    pipelineVersion: PipelineVersionSchema,
  })
  .strict();
export type RegisterProcessingRunInput = z.infer<
  typeof RegisterProcessingRunInputSchema
>;

/** Get-or-create: a second registration of the same pipeline is the same run. */
export function createRegisterProcessingRun(
  dependencies: EvidenceServiceDependencies,
) {
  const { transactions, repositories } = dependencies;
  return async (
    input: RegisterProcessingRunInput,
  ): Promise<{
    readonly run: DocumentProcessingRun;
    readonly created: boolean;
  }> => {
    const parsed = RegisterProcessingRunInputSchema.parse(input);
    const tenantId = TenantIdSchema.parse(parsed.tenantId);
    return transactions.run(async (tx) => {
      const version = await repositories.documentVersions.findById(
        tx.sql,
        tenantId,
        parsed.documentVersionId,
      );
      if (version === null) {
        throw new DocumentVersionNotFoundError();
      }
      return repositories.processingRuns.getOrCreate(tx, {
        tenantId,
        documentVersionId: version.id,
        pipelineVersion: parsed.pipelineVersion,
      });
    });
  };
}

export const TransitionProcessingRunInputSchema = z
  .object({
    tenantId: z.string().uuid(),
    runId: z.string().uuid(),
    status: ProcessingRunStatusSchema,
    errorCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .nullable()
      .default(null),
  })
  .strict();
export type TransitionProcessingRunInput = z.input<
  typeof TransitionProcessingRunInputSchema
>;

const RUN_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  QUEUED: ["RUNNING", "FAILED"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: ["QUEUED"],
};

export function createTransitionProcessingRun(
  dependencies: EvidenceServiceDependencies,
) {
  const { transactions, repositories } = dependencies;
  return async (
    input: TransitionProcessingRunInput,
  ): Promise<DocumentProcessingRun> => {
    const parsed = TransitionProcessingRunInputSchema.parse(input);
    const tenantId = TenantIdSchema.parse(parsed.tenantId);
    return transactions.run(async (tx) => {
      const runId = parsed.runId as DocumentProcessingRun["id"];
      const run = await repositories.processingRuns.findById(
        tx.sql,
        tenantId,
        runId,
      );
      if (run === null) {
        throw new DocumentVersionNotFoundError();
      }
      const allowed = RUN_TRANSITIONS[run.status] ?? [];
      if (!allowed.includes(parsed.status)) {
        throw new ContractValidationError("Invalid processing transition.", [
          {
            path: "status",
            code: "invalid_transition",
            message: `a ${run.status} run cannot become ${parsed.status}`,
          },
        ]);
      }
      const updated = await repositories.processingRuns.transition(tx, {
        tenantId,
        runId,
        status: parsed.status,
        errorCode: parsed.status === "FAILED" ? parsed.errorCode : null,
      });
      if (updated === null) {
        throw new DocumentVersionNotFoundError();
      }
      return updated;
    });
  };
}

export const AdvanceVersionProcessingStateInputSchema = z
  .object({
    tenantId: z.string().uuid(),
    documentVersionId: DocumentVersionIdSchema,
    processingStatus: ProcessingStatusSchema.optional(),
    malwareScanStatus: MalwareScanStatusSchema.optional(),
    textExtractionStatus: TextExtractionStatusSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.processingStatus !== undefined ||
      value.malwareScanStatus !== undefined ||
      value.textExtractionStatus !== undefined,
    "at least one state must change",
  );
export type AdvanceVersionProcessingStateInput = z.infer<
  typeof AdvanceVersionProcessingStateInputSchema
>;

/** Processing-state columns only; file identity is untouchable (trigger-enforced too). */
export function createAdvanceVersionProcessingState(
  dependencies: EvidenceServiceDependencies,
) {
  const { transactions, repositories } = dependencies;
  return async (
    input: AdvanceVersionProcessingStateInput,
  ): Promise<DocumentVersion> => {
    const parsed = AdvanceVersionProcessingStateInputSchema.parse(input);
    const tenantId = TenantIdSchema.parse(parsed.tenantId);
    return transactions.run(async (tx) => {
      const updated = await repositories.documentVersions.updateProcessingState(
        tx,
        {
          tenantId,
          versionId: parsed.documentVersionId,
          changes: {
            ...(parsed.processingStatus === undefined
              ? {}
              : { processingStatus: parsed.processingStatus }),
            ...(parsed.malwareScanStatus === undefined
              ? {}
              : { malwareScanStatus: parsed.malwareScanStatus }),
            ...(parsed.textExtractionStatus === undefined
              ? {}
              : { textExtractionStatus: parsed.textExtractionStatus }),
          },
        },
      );
      if (updated === null) {
        throw new DocumentVersionNotFoundError();
      }
      return updated;
    });
  };
}
