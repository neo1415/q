import { randomUUID } from "node:crypto";

import {
  CausationIdSchema,
  CorrelationIdSchema,
  createJobSchema,
  DocumentTypeSchema,
} from "@capital-q/contracts";
import type {
  DocumentProcessingService,
  ExtractedBlock,
  PrivateDocumentStorageProvider,
} from "@capital-q/evidence";
import { ProcessDocumentJob } from "@capital-q/evidence/jobs";
import type {
  BuildChunkSetInput,
  BuildChunkSetResult,
} from "@capital-q/q-knowledge";

import type { RunnerLogger } from "../outbox-runner.js";
import type { MessageOutcome } from "../queue/runner.js";
import type { QueueMessage } from "../queue/pgmq.js";
import type { ParserSandbox } from "../parser/sandbox.js";
import {
  isPermanentRefusal,
  type PageImageRequest,
} from "../parser/protocol.js";
import {
  mergeTranscriptions,
  transcribable,
  unreadPagesOf,
  type DocumentPageTranscriberPort,
} from "./transcription.js";
import {
  decideOnVerdict,
  type MalwarePolicy,
  type MalwareScanner,
} from "./malware.js";

/**
 * The document processing pipeline (doc 14 §9, doc 15 §26–28, doc 16 TM-FILE).
 *
 *   version created → job → security gate → malware gate → isolated parse
 *   → structured extraction → instruction-risk signal → chunk set → ready
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
    readonly chunkCount?: number | undefined;
  }) => void;
};

/**
 * The chunking stage (CQ-RAG-001 §67): derives the version's chunk set from
 * the blocks just extracted. Deterministic and idempotent on (version,
 * extraction, chunking version); absent in a build that only extracts.
 */
export type DocumentChunkingPort = {
  readonly buildChunkSet: (
    input: BuildChunkSetInput,
  ) => Promise<BuildChunkSetResult>;
};

/**
 * QA QO-23: what kind of document an unclassified upload is, read from its
 * opening text by a small governed model call (never its file name). Null
 * or UNSURE leaves it unclassified, which onboarding does not read.
 */
export type DocumentKindPort = (input: {
  readonly tenantId: string;
  readonly userId: string | null;
  readonly filename: string;
  readonly opening: string;
}) => Promise<string | null>;

/** The opening text the kind is read from: enough to tell, and no more. */
const OPENING_CHARACTERS = 4_000;

export function openingTextOf(blocks: readonly ExtractedBlock[]): string {
  const parts: string[] = [];
  let length = 0;
  for (const block of blocks) {
    const text =
      block.kind === "list"
        ? block.items.join("\n")
        : block.kind === "table" || block.kind === "spreadsheet_range"
          ? block.rows.map((row) => row.join(" | ")).join("\n")
          : block.kind === "slide"
            ? [block.title ?? "", block.text].join("\n")
            : block.kind === "page_break"
              ? ""
              : block.text;
    if (text.trim().length === 0) continue;
    parts.push(text.trim());
    length += text.length + 1;
    if (length >= OPENING_CHARACTERS) break;
  }
  return parts.join("\n").slice(0, OPENING_CHARACTERS);
}

/**
 * Owner decision 2026-10-28: the key figures of a founder's financial
 * document (management accounts, a financial model), read by code from the
 * blocks just extracted and offered to the founder to confirm. No model and
 * no network: it runs here, at processing time, never when Q is asked.
 */
export type LocalFiguresPort = (input: {
  readonly tenantId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly companyId: string | null;
  readonly documentType: string;
  readonly title: string;
  readonly createdByUserId: string | null;
  readonly blocks: readonly ExtractedBlock[];
}) => Promise<{
  readonly kind: string;
  readonly reason?: string | undefined;
  readonly read?: number | undefined;
  readonly offered?: number | undefined;
}>;

export type DocumentPipelineOptions = {
  readonly evidence: DocumentProcessingService;
  /** Owner 2026-10-28: local figures; absent, none are offered. */
  readonly localFigures?: LocalFiguresPort | undefined;
  /** QA QO-23: files an unclassified upload by its content; absent: not filed. */
  readonly documentKind?: DocumentKindPort | undefined;
  readonly storage: PrivateDocumentStorageProvider;
  readonly scanner: MalwareScanner;
  readonly malwarePolicy: MalwarePolicy;
  readonly sandbox: ParserSandbox;
  /**
   * Deck reading 2026-10-28: transcribes low-text pages (scans, picture
   * slides, PNG/JPEG uploads) from pictures drawn in the sandbox, through
   * the model gateway. Absent: those pages are recorded as unread, and the
   * founder is told, never handed silence.
   */
  readonly pageTranscriber?: DocumentPageTranscriberPort | undefined;
  /** The pictures asked of the sandbox for transcription. */
  readonly pageImages?: PageImageRequest | undefined;
  readonly knowledge?: DocumentChunkingPort | undefined;
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

/** Pictures for transcription: legible text, inside the model image bound. */
export const DEFAULT_PAGE_IMAGES: PageImageRequest = {
  maxPages: 30,
  maxLongSide: 1_600,
  maxBytes: 500_000,
};

export function createDocumentProcessingPipeline(
  options: DocumentPipelineOptions,
): (message: QueueMessage) => Promise<MessageOutcome> {
  const { evidence, logger, pipelineVersion } = options;

  const observe = (
    outcome: string,
    startedAt: number,
    extractorId?: string,
    chunkCount?: number,
  ): void => {
    options.metrics?.observe({
      outcome,
      ...(extractorId === undefined ? {} : { extractorId }),
      durationMs: Date.now() - startedAt,
      ...(chunkCount === undefined ? {} : { chunkCount }),
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
    // asking for a different one is not honoured silently. Nor is it a
    // decision: during a deploy the old and new workers overlap, and a job
    // the new version enqueued can reach the old worker first (live
    // 2026-10-03: three re-driven v2 jobs dead-lettered by the v1 worker
    // within a second). It goes back on the queue for the worker of its
    // version; the attempt limit still dead-letters a job no worker runs.
    if (job.data.pipelineVersion !== pipelineVersion) {
      logger.warn(
        {
          msgId: message.msgId,
          requested: job.data.pipelineVersion,
          running: pipelineVersion,
        },
        "process job names another pipeline version; left for its worker",
      );
      observe("PIPELINE_VERSION_MISMATCH", startedAt);
      return { kind: "RETRY", errorCode: "PIPELINE_VERSION_MISMATCH" };
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
      malwareScanStatus?: "BLOCKED" | "ERROR" | "CLEAN" | "NOT_SCANNED",
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

    // A voice note (R34) has no text for the extractor: it is stored and
    // scanned, never parsed. A real scanner's clean verdict is still the
    // version's truth; without one it stays unscanned.
    if (version.mimeType.startsWith("audio/")) {
      await fail(
        "FAILED",
        "NOT_A_TEXT_DOCUMENT",
        "UNSUPPORTED",
        decision.scanned
          ? "CLEAN"
          : decision.recordNotScanned === true
            ? "NOT_SCANNED"
            : undefined,
      );
      observe("AUDIO_STORED", startedAt);
      return { kind: "DONE" };
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

    const transcribe =
      options.pageTranscriber !== undefined &&
      transcribable(document.sensitivityClass)
        ? options.pageTranscriber
        : undefined;
    const result = await options.sandbox.run({
      content,
      mimeType: version.mimeType,
      filename: version.originalFilename,
      sizeBytes: version.sizeBytes,
      ...(transcribe === undefined
        ? {}
        : { pageImages: options.pageImages ?? DEFAULT_PAGE_IMAGES }),
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

    const correlationId = CorrelationIdSchema.parse(
      job.correlationId ?? `cor_${randomUUID()}`,
    );

    // --- Pictures read (deck reading 2026-10-28) ---------------------------
    // Pages with no text layer, transcribed from the sandbox's pictures of
    // them. Every failure here leaves the pages unread and recorded as
    // such; it never fails or retries the job.
    let output = result.output;
    if (transcribe !== undefined && (result.pageImages?.length ?? 0) > 0) {
      try {
        const transcriptions = await transcribe({
          tenantId,
          userId: document.createdByUserId,
          sensitivity: document.sensitivityClass,
          correlationId,
          images: (result.pageImages ?? []).map((image) => ({
            page: image.page,
            mediaType: image.mediaType,
            dataBase64: image.bytes.toString("base64"),
          })),
        });
        if (transcriptions !== null) {
          output = mergeTranscriptions(output, transcriptions);
        }
      } catch (error: unknown) {
        logger.warn(
          {
            msgId: message.msgId,
            runId: run.id,
            failure: error instanceof Error ? error.name : "unknown",
          },
          "low-text pages not transcribed; recorded as unread",
        );
      }
    }
    const unreadPages = unreadPagesOf(output);

    const recorded = await evidence.recordDocumentExtraction({
      tenantId,
      documentVersionId: version.id,
      processingRunId: run.id,
      pipelineVersion,
      extractorId: result.extractorId,
      output,
    });

    // --- Structure-aware chunking -------------------------------------------
    // Blocks go straight from the validated parser output into the chunker;
    // nothing is re-read from storage and nothing is interpreted. A failure
    // here is this attempt's, not the document's: the extraction stays
    // recorded and the job retries into an idempotent build.
    let chunking:
      | {
          readonly outcome: BuildChunkSetResult["outcome"];
          readonly chunkingVersion?: string | undefined;
          readonly chunkCount?: number | undefined;
          readonly strategy?: string | undefined;
          readonly truncated?: boolean | undefined;
          readonly supersededSets?: number | undefined;
          readonly reason?: string | undefined;
        }
      | undefined;
    if (options.knowledge !== undefined) {
      const chunkingStartedAt = Date.now();
      let built: BuildChunkSetResult;
      try {
        built = await options.knowledge.buildChunkSet({
          tenantId,
          documentVersionId: version.id,
          pipelineVersion,
          blocks: [...output.blocks],
        });
      } catch (error: unknown) {
        logger.warn(
          {
            msgId: message.msgId,
            runId: run.id,
            failure: error instanceof Error ? error.name : "unknown",
          },
          "chunking attempt failed; will retry",
        );
        observe("CHUNKING_FAILED", startedAt, result.extractorId);
        return { kind: "RETRY", errorCode: "CHUNKING_FAILED" };
      }
      chunking =
        built.outcome === "BUILT"
          ? {
              outcome: built.outcome,
              chunkingVersion: built.chunkSet.chunkingVersion,
              chunkCount: built.chunkCount,
              strategy: built.plan.strategy,
              truncated: built.plan.truncated,
              supersededSets: built.supersededSetIds.length,
            }
          : built.outcome === "ALREADY_BUILT"
            ? {
                outcome: built.outcome,
                chunkingVersion: built.chunkSet.chunkingVersion,
                chunkCount: built.chunkSet.chunkCount,
                strategy: built.chunkSet.chunkingStrategy,
              }
            : { outcome: built.outcome, reason: built.reason };
      logger.info(
        {
          msgId: message.msgId,
          runId: run.id,
          chunking: chunking.outcome,
          chunkCount: chunking.chunkCount ?? 0,
          chunkingDurationMs: Date.now() - chunkingStartedAt,
        },
        "document chunk set settled",
      );
    }

    // --- Local figures (owner decision 2026-10-28) ------------------------
    // A financial document's key figures, read by code from the blocks in
    // hand (nothing re-read, no model), offered to the founder to confirm.
    // Idempotent per version; a failure here is logged and never fails or
    // retries the job: the document is processed either way.
    if (options.localFigures !== undefined) {
      const figuresStartedAt = Date.now();
      try {
        const figures = await options.localFigures({
          tenantId,
          documentId: document.id,
          documentVersionId: version.id,
          companyId: document.companyId,
          documentType: document.documentType,
          title: document.title,
          createdByUserId: document.createdByUserId,
          blocks: output.blocks,
        });
        if (figures.kind !== "SKIPPED" || figures.reason !== "NOT_FINANCIAL") {
          // Counts and codes only: never a figure, a label or a title.
          logger.info(
            {
              msgId: message.msgId,
              runId: run.id,
              localFigures: figures.kind,
              reason: figures.reason,
              read: figures.read ?? 0,
              offered: figures.offered ?? 0,
              localFiguresDurationMs: Date.now() - figuresStartedAt,
            },
            "local figures read",
          );
        }
      } catch (error: unknown) {
        logger.warn(
          {
            msgId: message.msgId,
            runId: run.id,
            failure: error instanceof Error ? error.name : "unknown",
          },
          "local figures not offered",
        );
      }
    }

    // --- Filed by what it says (QA QO-23) ----------------------------------
    // Before the document is announced ready, so every reader of the ready
    // event sees its real kind. Only an organisation's unclassified document
    // the uploader did not mark highly confidential: a type a person chose is
    // theirs, and what they marked as highly confidential no model reads. A
    // reading that fails leaves it unclassified; it never fails the job.
    if (
      options.documentKind !== undefined &&
      document.documentType === "UNCLASSIFIED" &&
      document.ownerOrganisationId !== null &&
      document.sensitivityClass !== "HIGHLY_CONFIDENTIAL" &&
      document.sensitivityClass !== "RESTRICTED"
    ) {
      const opening = openingTextOf(output.blocks);
      if (opening.trim().length > 0) {
        try {
          const kind = DocumentTypeSchema.exclude(["UNCLASSIFIED"]).safeParse(
            await options.documentKind({
              tenantId,
              userId: document.createdByUserId,
              filename: version.originalFilename,
              opening,
            }),
          );
          if (kind.success) {
            const { filed } = await evidence.classifyDocumentContent({
              tenantId,
              documentId: document.id,
              documentType: kind.data,
            });
            logger.info(
              { msgId: message.msgId, runId: run.id, kind: kind.data, filed },
              "document filed by its content",
            );
          }
        } catch (error: unknown) {
          logger.warn(
            {
              msgId: message.msgId,
              runId: run.id,
              failure: error instanceof Error ? error.name : "unknown",
            },
            "document kind not read; left unclassified",
          );
        }
      }
    }

    const completion = await evidence.completeDocumentProcessing({
      tenantId,
      documentVersionId: version.id,
      runId: run.id,
      pipelineVersion,
      correlationId,
      causationId: CausationIdSchema.parse(`cau_${job.id}`),
      scannedClean: decision.scanned,
      ...(decision.recordNotScanned === true ? { notScanned: true } : {}),
      provenance: {
        extractorVersion: output.metadata.parserVersion,
        ...(chunking?.chunkingVersion === undefined
          ? {}
          : { chunkingVersion: chunking.chunkingVersion }),
        // Structural counts and coded categories only. Never a title, never a
        // block of text, never a matched passage: this metadata is read by
        // operators and could otherwise carry document content into logs.
        metadata: {
          extractorId: result.extractorId,
          blockCount: output.blocks.length,
          instructionRiskSignals: recorded.extraction.instructionRiskSignals,
          instructionRiskCategories: [...recorded.instructionRiskCategories],
          truncated: output.metadata.truncated === true,
          // Counts only: how many pages were pictures, how many of those Q
          // transcribed, and how many nobody could read (the founder is
          // told that number; deck reading 2026-10-28).
          lowTextPages: output.metadata.lowTextPages?.length ?? 0,
          transcribedPages: output.metadata.transcribedPages?.length ?? 0,
          unreadPages: unreadPages.length,
          parseDurationMs: result.durationMs,
          scanned: decision.scanned,
          // The policy this run was made under (ADR 0042).
          malwarePolicy: options.malwarePolicy,
          ...(chunking === undefined
            ? {}
            : {
                chunkingOutcome: chunking.outcome,
                ...(chunking.reason === undefined
                  ? {}
                  : { chunkingSkipped: chunking.reason }),
                ...(chunking.chunkCount === undefined
                  ? {}
                  : { chunkCount: chunking.chunkCount }),
                ...(chunking.strategy === undefined
                  ? {}
                  : { chunkingStrategy: chunking.strategy }),
                ...(chunking.truncated === undefined
                  ? {}
                  : { chunkingTruncated: chunking.truncated }),
                ...(chunking.supersededSets === undefined
                  ? {}
                  : { chunkSetsSuperseded: chunking.supersededSets }),
              }),
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
        blockCount: output.blocks.length,
        unreadPages: unreadPages.length,
        instructionRiskSignals: recorded.extraction.instructionRiskSignals,
        alreadyRecorded: recorded.alreadyRecorded,
        chunkCount: chunking?.chunkCount ?? 0,
        emitted: completion.emitted,
      },
      "document extraction recorded",
    );
    observe("COMPLETED", startedAt, result.extractorId, chunking?.chunkCount);
    return { kind: "DONE" };
  };
}
