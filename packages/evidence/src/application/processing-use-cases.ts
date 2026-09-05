import { z } from "zod";

import {
  ContractValidationError,
  CausationIdSchema,
  CorrelationIdSchema,
} from "@capital-q/contracts";
import { TenantIdSchema } from "@capital-q/security";

import {
  DocumentVersionIdSchema,
  MalwareScanStatusSchema,
  PipelineVersionSchema,
  ProcessingRunMetadataSchema,
  ProcessingRunStatusSchema,
  ProcessingStatusSchema,
  TextExtractionStatusSchema,
  type Document,
  type DocumentProcessingRun,
  type DocumentVersion,
} from "../contracts/index.js";
import {
  DocumentNotFoundError,
  DocumentVersionNotFoundError,
} from "../domain/errors.js";
import { documentReadyEvent } from "../events/index.js";
import type { EvidenceProcessingDependencies } from "./dependencies.js";

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
  dependencies: EvidenceProcessingDependencies,
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
    /**
     * What did the work, recorded on the run. Bounded and structural: never
     * document text, never a parser message a document could have shaped.
     */
    provenance: z
      .object({
        extractorVersion: z.string().min(1).max(64).optional(),
        metadata: ProcessingRunMetadataSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type TransitionProcessingRunInput = z.input<
  typeof TransitionProcessingRunInputSchema
>;

const RUN_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  QUEUED: ["RUNNING", "FAILED", "BLOCKED"],
  RUNNING: ["COMPLETED", "FAILED", "BLOCKED"],
  COMPLETED: [],
  // A refusal is final: policy said no, and retrying changes nothing.
  BLOCKED: [],
  FAILED: ["QUEUED"],
};

export function createTransitionProcessingRun(
  dependencies: EvidenceProcessingDependencies,
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
        // A refusal carries its reason too: BLOCKED without a code would be
        // an unexplained "no".
        errorCode:
          parsed.status === "FAILED" || parsed.status === "BLOCKED"
            ? parsed.errorCode
            : null,
        ...(parsed.provenance === undefined
          ? {}
          : { provenance: parsed.provenance }),
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
  dependencies: EvidenceProcessingDependencies,
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

/**
 * What the processing worker needs to know before it touches a document.
 *
 * Resolved from the database by version id alone. The queue message's tenant
 * is a claim to be checked against this, never the filter that finds it: a
 * forged pairing must be *refused*, not quietly reported as missing.
 */
export type ProcessingTarget = {
  readonly version: DocumentVersion;
  readonly document: Document;
};

export function createResolveProcessingTarget(
  dependencies: EvidenceProcessingDependencies,
) {
  const { repositories, sql } = dependencies;
  return async (
    documentVersionId: string,
  ): Promise<ProcessingTarget | null> => {
    const versionId = DocumentVersionIdSchema.parse(documentVersionId);
    const version = await repositories.documentVersions.findByIdForProcessing(
      sql,
      versionId,
    );
    if (version === null) {
      return null;
    }
    const document = await repositories.documents.findInTenant(
      sql,
      version.tenantId,
      version.documentId,
    );
    return document === null ? null : { version, document };
  };
}

export const CompleteDocumentProcessingInputSchema = z
  .object({
    tenantId: z.string().uuid(),
    documentVersionId: DocumentVersionIdSchema,
    runId: z.string().uuid(),
    pipelineVersion: PipelineVersionSchema,
    correlationId: CorrelationIdSchema,
    causationId: CausationIdSchema.optional(),
    /** True only when a scanner actually returned a clean verdict. */
    scannedClean: z.boolean(),
    provenance: z
      .object({
        extractorVersion: z.string().min(1).max(64).optional(),
        metadata: ProcessingRunMetadataSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CompleteDocumentProcessingInput = z.input<
  typeof CompleteDocumentProcessingInputSchema
>;

/**
 * Closing a successful processing run, atomically.
 *
 * The run's completion, the version's processing state and the
 * `evidence.document.ready` event are one transaction. Emitting the event
 * separately would be the dual write the outbox exists to prevent: a
 * consumer could learn a document is ready before — or without — the state
 * that makes it true.
 *
 * A redelivered job finds the run already COMPLETED and emits nothing, so
 * at-least-once delivery does not become at-least-once announcement.
 */
export function createCompleteDocumentProcessing(
  dependencies: EvidenceProcessingDependencies,
) {
  const { transactions, repositories, outbox } = dependencies;
  return async (
    input: CompleteDocumentProcessingInput,
  ): Promise<{ readonly emitted: boolean }> => {
    const parsed = CompleteDocumentProcessingInputSchema.parse(input);
    const tenantId = TenantIdSchema.parse(parsed.tenantId);
    const runId = parsed.runId as DocumentProcessingRun["id"];

    return transactions.run(async (tx) => {
      const run = await repositories.processingRuns.findById(
        tx.sql,
        tenantId,
        runId,
      );
      if (run === null) {
        throw new DocumentVersionNotFoundError();
      }
      if (run.status === "COMPLETED") {
        return { emitted: false };
      }
      const allowed = RUN_TRANSITIONS[run.status] ?? [];
      if (!allowed.includes("COMPLETED")) {
        throw new ContractValidationError("Invalid processing transition.", [
          {
            path: "status",
            code: "invalid_transition",
            message: `a ${run.status} run cannot become COMPLETED`,
          },
        ]);
      }

      const version = await repositories.documentVersions.updateProcessingState(
        tx,
        {
          tenantId,
          versionId: parsed.documentVersionId,
          changes: {
            processingStatus: "COMPLETED",
            textExtractionStatus: "COMPLETED",
            // Only a scanner's verdict may write CLEAN; an unscanned
            // document keeps the state it already had.
            ...(parsed.scannedClean
              ? ({ malwareScanStatus: "CLEAN" } as const)
              : {}),
          },
        },
      );
      if (version === null) {
        throw new DocumentVersionNotFoundError();
      }
      const document = await repositories.documents.findInTenant(
        tx.sql,
        tenantId,
        version.documentId,
      );
      if (document === null) {
        throw new DocumentNotFoundError();
      }
      await repositories.processingRuns.transition(tx, {
        tenantId,
        runId,
        status: "COMPLETED",
        errorCode: null,
        ...(parsed.provenance === undefined
          ? {}
          : { provenance: parsed.provenance }),
      });
      await outbox.enqueue(
        tx,
        documentReadyEvent(
          {
            tenantId,
            organisationId: document.ownerOrganisationId,
            correlationId: parsed.correlationId,
            ...(parsed.causationId === undefined
              ? {}
              : { causationId: parsed.causationId }),
          },
          {
            documentId: document.id,
            documentVersionId: version.id,
            processingRunId: runId,
            pipelineVersion: parsed.pipelineVersion,
          },
        ),
      );
      return { emitted: true };
    });
  };
}
