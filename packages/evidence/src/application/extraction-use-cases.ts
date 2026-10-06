import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import type { TenantId } from "@capital-q/security";

import {
  EXTRACTION_LIMITS,
  EXTRACTION_SCHEMA_VERSION,
  ExtractedDocumentSchema,
  ParserOutputSchema,
  type DocumentExtraction,
  type ExtractedDocument,
  type ParserOutput,
} from "../contracts/extraction.js";
import {
  DocumentVersionIdSchema,
  PipelineVersionSchema,
  type DocumentProcessingRunId,
  type DocumentVersionId,
} from "../contracts/index.js";
import {
  DocumentNotFoundError,
  DocumentStorageUnavailableError,
  DocumentVersionNotFoundError,
  EvidenceRuleError,
} from "../domain/errors.js";
import { pagesFromBlocks } from "../domain/document-pages.js";
import { scanInstructionRisk } from "../domain/instruction-risk.js";
import type { EvidenceProcessingDependencies } from "./dependencies.js";

/**
 * Recording a structured extraction (CQ-EVD-003).
 *
 * A trusted server operation, like the processing primitives beside it: the
 * caller is the processing worker, scoped by tenant and version id. It runs
 * no parser itself — it receives what a sandbox produced, re-validates it as
 * untrusted input, writes it to private storage and records the provenance.
 *
 *   extraction ≠ evidence ≠ claim ≠ knowledge
 *
 * The artifact inherits the document's disclosure scope and sensitivity. A
 * parser running is not a reason for private material to become less
 * private.
 */

/** The private bucket derived artifacts live in. Server-owned, never public. */
export const EXTRACTION_STORAGE_BUCKET = "cq-extractions-private";

export const RecordDocumentExtractionInputSchema = z
  .object({
    tenantId: z.string().uuid(),
    documentVersionId: DocumentVersionIdSchema,
    processingRunId: z.string().uuid(),
    pipelineVersion: PipelineVersionSchema,
    extractorId: z.string().min(1).max(64),
    output: ParserOutputSchema,
  })
  .strict();
export type RecordDocumentExtractionInput = z.input<
  typeof RecordDocumentExtractionInputSchema
>;

export type RecordDocumentExtractionResult = {
  readonly extraction: DocumentExtraction;
  readonly instructionRiskCategories: readonly string[];
  /** True when the extraction already existed; nothing was rewritten. */
  readonly alreadyRecorded: boolean;
};

/** Random, server-chosen, and never derived from the document or its name. */
function artifactKey(
  tenantId: TenantId,
  versionId: DocumentVersionId,
  runId: DocumentProcessingRunId,
): string {
  return `extractions/${tenantId}/${versionId}/${runId}-${randomBytes(8).toString("hex")}.json`;
}

export function createRecordDocumentExtraction(
  dependencies: EvidenceProcessingDependencies,
) {
  const { transactions, repositories } = dependencies;

  return async (
    input: RecordDocumentExtractionInput,
  ): Promise<RecordDocumentExtractionResult> => {
    const parsed = RecordDocumentExtractionInputSchema.parse(input);
    const storage = dependencies.storage;
    if (storage === undefined) {
      throw new DocumentStorageUnavailableError();
    }
    const tenantId = parsed.tenantId as TenantId;

    const existing =
      await repositories.documentExtractions.findByVersionAndPipeline(
        dependencies.sql,
        tenantId,
        parsed.documentVersionId,
        parsed.pipelineVersion,
      );
    if (existing !== null) {
      // One pipeline version yields one artifact. A redelivered job finds
      // the work already done rather than producing a second one.
      return {
        extraction: existing,
        instructionRiskCategories: [],
        alreadyRecorded: true,
      };
    }

    const version = await repositories.documentVersions.findById(
      dependencies.sql,
      tenantId,
      parsed.documentVersionId,
    );
    if (version === null) {
      throw new DocumentVersionNotFoundError();
    }
    const document = await repositories.documents.findInTenant(
      dependencies.sql,
      tenantId,
      version.documentId,
    );
    if (document === null) {
      throw new DocumentNotFoundError();
    }

    const output: ParserOutput = parsed.output;
    const risk = scanInstructionRisk(output.blocks);

    const artifact: ExtractedDocument = ExtractedDocumentSchema.parse({
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      sourceId: null,
      documentId: document.id,
      documentVersionId: version.id,
      processingRunId: parsed.processingRunId,
      pipelineVersion: parsed.pipelineVersion,
      extractorId: parsed.extractorId,
      extractorVersion: output.metadata.parserVersion,
      extractedAt: new Date().toISOString(),
      ...(output.title === undefined ? {} : { title: output.title }),
      ...(output.language === undefined ? {} : { language: output.language }),
      blocks: output.blocks,
      metadata: output.metadata,
    });

    const body = new TextEncoder().encode(JSON.stringify(artifact));
    if (body.byteLength > EXTRACTION_LIMITS.maxArtifactBytes) {
      throw new EvidenceRuleError("the extracted document exceeds its bound");
    }
    const key = artifactKey(
      tenantId,
      version.id,
      parsed.processingRunId as DocumentProcessingRunId,
    );

    // Storage first, outside any transaction: an external call never runs
    // inside one. A failure here leaves no metadata row, so the next attempt
    // simply writes a new artifact under a new key.
    await storage.putObject({
      object: { bucket: EXTRACTION_STORAGE_BUCKET, key },
      body,
      contentType: "application/json",
    });

    const pages = pagesFromBlocks(output.blocks);
    const extraction = await transactions.run(async (tx) => {
      const recorded = await repositories.documentExtractions.insert(tx, {
        tenantId,
        ownerOrganisationId: document.ownerOrganisationId,
        documentId: document.id,
        documentVersionId: version.id,
        processingRunId: parsed.processingRunId as DocumentProcessingRunId,
        sourceId: null,
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        extractorId: parsed.extractorId,
        extractorVersion: output.metadata.parserVersion,
        pipelineVersion: parsed.pipelineVersion,
        artifactBucket: EXTRACTION_STORAGE_BUCKET,
        artifactKey: key,
        artifactSha256: createHash("sha256").update(body).digest("hex"),
        artifactBytes: body.byteLength,
        blockCount: output.blocks.length,
        pageCount: output.metadata.pageCount ?? null,
        slideCount: output.metadata.slideCount ?? null,
        language: output.language ?? null,
        // Inherited, never widened because a parser ran.
        visibilityScope: document.visibilityScope,
        sensitivityClass: document.sensitivityClass,
        instructionRiskSignals: risk.signals.length,
      });
      // Q room W3: the same text, page by page, in the same transaction,
      // so every paged extraction has its pages.
      await repositories.documentExtractions.insertPages(tx, recorded, pages);
      return recorded;
    });

    return {
      extraction,
      instructionRiskCategories: risk.categories,
      alreadyRecorded: false,
    };
  };
}

export type GetDocumentExtractionQuery = {
  readonly tenantId: string;
  readonly documentVersionId: string;
  readonly pipelineVersion: string;
};

/** Metadata only; reading the artifact itself is an authorised storage read. */
export function createFindDocumentExtraction(
  dependencies: EvidenceProcessingDependencies,
) {
  return async (
    query: GetDocumentExtractionQuery,
  ): Promise<DocumentExtraction | null> =>
    dependencies.repositories.documentExtractions.findByVersionAndPipeline(
      dependencies.sql,
      query.tenantId as TenantId,
      DocumentVersionIdSchema.parse(query.documentVersionId),
      PipelineVersionSchema.parse(query.pipelineVersion),
    );
}

export type BackfillDocumentPagesResult = {
  readonly examined: number;
  readonly pagesWritten: number;
  readonly failed: number;
};

/**
 * Q room W3: pages for extractions recorded before pages existed. Each is
 * read back from its private artifact (the same bytes the extraction row
 * names, checked against its hash), cut into pages, and written beside it.
 * Bounded, idempotent (pages are written once), and never fatal: one
 * unreadable artifact is counted and the rest carry on.
 */
export function createBackfillDocumentPages(
  dependencies: EvidenceProcessingDependencies,
) {
  const { transactions, repositories } = dependencies;
  return async (limit = 200): Promise<BackfillDocumentPagesResult> => {
    const storage = dependencies.storage;
    if (storage === undefined) {
      throw new DocumentStorageUnavailableError();
    }
    const missing = await repositories.documentExtractions.listWithoutPages(
      dependencies.sql,
      Math.max(1, Math.min(limit, 1_000)),
    );
    let pagesWritten = 0;
    let failed = 0;
    for (const extraction of missing) {
      try {
        const stream = await storage.openObjectStream({
          bucket: extraction.artifactBucket,
          key: extraction.artifactKey,
        });
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of stream.body) {
          size += chunk.byteLength;
          if (size > EXTRACTION_LIMITS.maxArtifactBytes) {
            throw new EvidenceRuleError("the artifact exceeds its bound");
          }
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        if (
          createHash("sha256").update(body).digest("hex") !==
          extraction.artifactSha256
        ) {
          throw new EvidenceRuleError("the artifact does not match its hash");
        }
        const artifact = ExtractedDocumentSchema.parse(
          JSON.parse(body.toString("utf8")),
        );
        const pages = pagesFromBlocks(artifact.blocks);
        pagesWritten += await transactions.run((tx) =>
          repositories.documentExtractions.insertPages(tx, extraction, pages),
        );
      } catch {
        failed += 1;
      }
    }
    return { examined: missing.length, pagesWritten, failed };
  };
}
