import { randomUUID } from "node:crypto";

import {
  CausationIdSchema,
  CorrelationIdSchema,
  createJobSchema,
} from "@capital-q/contracts";
import type {
  DocumentProcessingService,
  PrivateDocumentStorageProvider,
} from "@capital-q/evidence";
import { ProcessDocumentJob } from "@capital-q/evidence/jobs";

import type { RunnerLogger } from "../outbox-runner.js";
import type { MessageOutcome } from "../queue/runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { ParserSandbox } from "../parser/sandbox.js";
import { isPermanentRefusal } from "../parser/protocol.js";
import {
  decideOnVerdict,
  type MalwarePolicy,
  type MalwareScanner,
} from "./malware.js";

/**
 * The document processing pipeline (doc 14 §9, doc 15 §26–28, doc 16 TM-FILE).
 *
 *   version created → job → security gate → malware gate → isolated parse
 *   → structured extraction → instruction-risk signal → ready
 *
 * Two rules shape everything below.
 *
 * First, the message is a claim, not an authority. It names a document
 * version and a tenant; the tenant is re-resolved from the row and the claim
 * is *checked* against it, so a forged or replayed job can name a resource in
 * another tenant but can never reach one.
 *
 * Second, a document's bytes are data. They are read into a child process
 * that holds no credential, and what comes back is revalidated before it is
 * stored. Instruction-shaped passages are counted, not obeyed: this packet
 * calls no model, and nothing a document says can change what happens to it.
 */

const ProcessDocumentJobSchema = createJobSchema(ProcessDocumentJob.dataSchema);

export type PipelineMetrics = {
  readonly observe: (event: {
    readonly outcome: string;
    readonly extractorId?: string | undefined;
    readonly durationMs: number;
  }) => void;
};

export type DocumentPipelineOptions = {
  readonly evidence: DocumentProcessingService;
  readonly storage: PrivateDocumentStorageProvider;
  readonly scanner: MalwareScanner;
  readonly malwarePolicy: MalwarePolicy;
  readonly sandbox: ParserSandbox;
  readonly pipelineVersion: string;
  /** Ceiling on bytes read out of storage, independent of the parser's own. */
  readonly maxDocumentBytes: number;
  readonly logger: RunnerLogger;
  readonly metrics?: PipelineMetrics | undefined;
};

/** Reads an object into memory, refusing anything past the bound mid-stream. */
async function readBounded(
  stream: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Buffer | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > maxBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createDocumentProcessingPipeline(
  options: DocumentPipelineOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  const { evidence, logger, pipelineVersion } = options;

  const observe = (
    outcome: string,
    startedAt: number,
    extractorId?: string,
  ): void => {
    options.metrics?.observe({
      outcome,
      ...(extractorId === undefined ? {} : { extractorId }),
      durationMs: Date.now() - startedAt,
    });
  };

  return async (message) => {
    const startedAt = Date.now();
    const parsed = ProcessDocumentJobSchema.safeParse(message.message);
    if (!parsed.success) {
      // A message this build cannot validate is a decision, not an outage.
      logger.error({ msgId: message.msgId }, "process job failed validation");
      observe("INVALID_JOB", startedAt);
      return { kind: "PERMANENT", errorCode: "INVALID_JOB" };
    }
    const job = parsed.data;
    const { documentVersionId } = job.data;

    // The pipeline version comes from this worker's configuration; a job
    // asking for a different one is not honoured silently.
    if (job.data.pipelineVersion !== pipelineVersion) {
      logger.warn(
        { msgId: message.msgId, requested: job.data.pipelineVersion },
        "process job names another pipeline version",
      );
      observe("PIPELINE_VERSION_MISMATCH", startedAt);
      return { kind: "PERMANENT", errorCode: "PIPELINE_VERSION_MISMATCH" };
    }

    const target = await evidence.resolveProcessingTarget(documentVersionId);
    if (target === null) {
      logger.warn(
        { msgId: message.msgId, documentVersionId },
        "process job names an unknown document version",
      );
      observe("UNKNOWN_VERSION", startedAt);
      return { kind: "PERMANENT", errorCode: "UNKNOWN_VERSION" };
    }
    const { version, document } = target;

    // Tenancy is what the row says. A message claiming otherwise is refused
    // outright rather than quietly treated as "not found": the difference
    // matters, because one is a stale job and the other is an attack.
    if (job.tenantId !== version.tenantId) {
      logger.error(
        { msgId: message.msgId, documentVersionId },
        "process job tenant claim did not match the document version",
      );
      observe("TENANT_MISMATCH", startedAt);
      return { kind: "PERMANENT", errorCode: "TENANT_MISMATCH" };
    }
    const tenantId = version.tenantId;

    const { run } = await evidence.registerProcessingRun({
      tenantId,
      documentVersionId: version.id,
      pipelineVersion,
    });
    if (run.status === "COMPLETED" || run.status === "BLOCKED") {
      // Already decided. A redelivery re-reads the decision instead of
      // re-making it, and emits nothing.
      logger.info(
        { msgId: message.msgId, runId: run.id, status: run.status },
        "document processing already settled",
      );
      observe(`ALREADY_${run.status}`, startedAt);
      return { kind: "DONE" };
    }

    const fail = async (
      status: "FAILED" | "BLOCKED",
      errorCode: string,
      textExtractionStatus: "FAILED" | "UNSUPPORTED",
      malwareScanStatus?: "BLOCKED" | "ERROR",
    ): Promise<void> => {
      await evidence.advanceVersionProcessingState({
        tenantId,
        documentVersionId: version.id,
        // There is no BLOCKED processing state on a version: the run carries
        // why the work stopped, the version only records that it did.
        processingStatus: "FAILED",
        textExtractionStatus,
        ...(malwareScanStatus === undefined ? {} : { malwareScanStatus }),
      });
      await evidence.transitionProcessingRun({
        tenantId,
        runId: run.id,
        status,
        errorCode,
      });
    };

    if (run.status === "QUEUED") {
      await evidence.transitionProcessingRun({
        tenantId,
        runId: run.id,
        status: "RUNNING",
      });
      await evidence.advanceVersionProcessingState({
        tenantId,
        documentVersionId: version.id,
        processingStatus: "PROCESSING",
        textExtractionStatus: "PROCESSING",
      });
    }

    // --- Security gate -----------------------------------------------------
    // The stored object must still be the object the version describes. A
    // size that no longer matches means the row and the bytes disagree, and
    // parsing the bytes anyway would be trusting the wrong one.
    const stored = await options.storage.statObject({
      bucket: version.storageBucket,
      key: version.storageKey,
    });
    if (stored === null) {
      await fail("FAILED", "OBJECT_MISSING", "FAILED");
      observe("OBJECT_MISSING", startedAt);
      return { kind: "DONE" };
    }
    if (stored.sizeBytes !== version.sizeBytes) {
      logger.error(
        { msgId: message.msgId, documentVersionId: version.id },
        "stored object size disagrees with the recorded version",
      );
      await fail("BLOCKED", "OBJECT_MISMATCH", "FAILED");
      observe("OBJECT_MISMATCH", startedAt);
      return { kind: "DONE" };
    }

    // --- Malware gate ------------------------------------------------------
    const verdict = await options.scanner.scan({
      bucket: version.storageBucket,
      key: version.storageKey,
      sizeBytes: version.sizeBytes,
      mimeType: version.mimeType,
    });
    const decision = decideOnVerdict(verdict, options.malwarePolicy);
    if (decision.kind === "BLOCK") {
      await fail(
        "BLOCKED",
        decision.errorCode,
        "FAILED",
        verdict.status === "INFECTED" ? "BLOCKED" : undefined,
      );
      logger.warn(
        {
          msgId: message.msgId,
          runId: run.id,
          scanner: verdict.scannerId,
          verdict: verdict.status,
        },
        "document blocked before parsing",
      );
      observe(`BLOCKED_${decision.errorCode}`, startedAt);
      return { kind: "DONE" };
    }
    if (decision.kind === "RETRY") {
      observe(decision.errorCode, startedAt);
      return { kind: "RETRY", errorCode: decision.errorCode };
    }

    // --- Isolated extraction ----------------------------------------------
    const objectStream = await options.storage.openObjectStream({
      bucket: version.storageBucket,
      key: version.storageKey,
    });
    const content = await readBounded(
      objectStream.body,
      options.maxDocumentBytes,
    );
    if (content === null) {
      await fail("BLOCKED", "DOCUMENT_TOO_LARGE", "FAILED");
      observe("DOCUMENT_TOO_LARGE", startedAt);
      return { kind: "DONE" };
    }

    const result = await options.sandbox.run({
      content,
      mimeType: version.mimeType,
      filename: version.originalFilename,
      sizeBytes: version.sizeBytes,
    });

    if (!result.ok) {
      if (!isPermanentRefusal(result.code)) {
        // The parser timed out or died. That is about this attempt, not
        // about the document; the run stays RUNNING and the job retries.
        logger.warn(
          { msgId: message.msgId, runId: run.id, code: result.code },
          "parser attempt failed; will retry",
        );
        observe(result.code, startedAt);
        return { kind: "RETRY", errorCode: result.code };
      }
      const unsupported = result.code === "UNSUPPORTED_MEDIA_TYPE";
      await fail("FAILED", result.code, unsupported ? "UNSUPPORTED" : "FAILED");
      logger.info(
        { msgId: message.msgId, runId: run.id, code: result.code },
        unsupported
          ? "no extractor exists for this document type"
          : "document refused by the parser",
      );
      observe(result.code, startedAt);
      // Recorded, not retried, and not dead-lettered: the state is the answer.
      return { kind: "DONE" };
    }

    const recorded = await evidence.recordDocumentExtraction({
      tenantId,
      documentVersionId: version.id,
      processingRunId: run.id,
      pipelineVersion,
      extractorId: result.extractorId,
      output: result.output,
    });

    const correlationId = CorrelationIdSchema.parse(
      job.correlationId ?? `cor_${randomUUID()}`,
    );
    const completion = await evidence.completeDocumentProcessing({
      tenantId,
      documentVersionId: version.id,
      runId: run.id,
      pipelineVersion,
      correlationId,
      causationId: CausationIdSchema.parse(`cau_${job.id}`),
      scannedClean: decision.scanned,
      provenance: {
        extractorVersion: result.output.metadata.parserVersion,
        // Structural counts and coded categories only. Never a title, never a
        // block of text, never a matched passage: this metadata is read by
        // operators and could otherwise carry document content into logs.
        metadata: {
          extractorId: result.extractorId,
          blockCount: result.output.blocks.length,
          instructionRiskSignals: recorded.extraction.instructionRiskSignals,
          instructionRiskCategories: [...recorded.instructionRiskCategories],
          truncated: result.output.metadata.truncated === true,
          parseDurationMs: result.durationMs,
          scanned: decision.scanned,
        },
      },
    });

    logger.info(
      {
        msgId: message.msgId,
        runId: run.id,
        documentId: document.id,
        documentVersionId: version.id,
        extractorId: result.extractorId,
        blockCount: result.output.blocks.length,
        instructionRiskSignals: recorded.extraction.instructionRiskSignals,
        alreadyRecorded: recorded.alreadyRecorded,
        emitted: completion.emitted,
      },
      "document extraction recorded",
    );
    observe("COMPLETED", startedAt, result.extractorId);
    return { kind: "DONE" };
  };
}
