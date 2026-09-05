import { randomUUID } from "node:crypto";

import { UtcTimestampSchema } from "@capital-q/contracts";
import {
  DocumentExtractionIdSchema,
  DocumentIdSchema,
  DocumentProcessingRunIdSchema,
  DocumentVersionIdSchema,
  type Document,
  type DocumentExtraction,
  type DocumentProcessingRun,
  type DocumentProcessingService,
  type DocumentVersion,
  type ProcessingRunStatus,
} from "@capital-q/evidence";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import type { RunnerLogger } from "../../src/outbox-runner.js";

/**
 * Test doubles for the pipeline's collaborators.
 *
 * The fake evidence surface resolves a version by id alone, exactly as the
 * real one does, so a test can hand the pipeline a job whose tenant claim is
 * wrong and watch it refuse rather than quietly find nothing.
 */

export type LogLine = {
  readonly level: "info" | "warn" | "error";
  readonly fields: Record<string, unknown>;
  readonly message: string;
};

export function createRecordingLogger(): RunnerLogger & {
  readonly lines: LogLine[];
} {
  const lines: LogLine[] = [];
  return {
    lines,
    info: (fields, message) => lines.push({ level: "info", fields, message }),
    warn: (fields, message) => lines.push({ level: "warn", fields, message }),
    error: (fields, message) => lines.push({ level: "error", fields, message }),
  };
}

export const TENANT_A = TenantIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
export const TENANT_B = TenantIdSchema.parse(
  "22222222-2222-4222-8222-222222222222",
);

const now = () => UtcTimestampSchema.parse(new Date().toISOString());

export function makeVersion(
  overrides: Partial<DocumentVersion> = {},
): DocumentVersion {
  return {
    id: DocumentVersionIdSchema.parse(randomUUID()),
    tenantId: TENANT_A,
    documentId: DocumentIdSchema.parse(randomUUID()),
    versionNumber: 1,
    storageBucket: "cq-documents-private",
    storageKey: "documents/a/b.pdf",
    originalFilename: "deck.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1_024,
    sha256: "a".repeat(64),
    uploadedByUserId: UserIdSchema.parse(randomUUID()),
    uploadedAt: now(),
    supersedesVersionId: null,
    processingStatus: "QUEUED",
    malwareScanStatus: "PENDING",
    textExtractionStatus: "NOT_STARTED",
    ...overrides,
  };
}

export function makeDocument(
  version: DocumentVersion,
  overrides: Partial<Document> = {},
): Document {
  return {
    id: version.documentId,
    tenantId: version.tenantId,
    companyId: null,
    ownerOrganisationId: OrganisationIdSchema.parse(randomUUID()),
    documentType: "PITCH_DECK",
    title: "Deck",
    visibilityScope: "founder_private",
    sensitivityClass: "CONFIDENTIAL",
    currentVersionId: version.id,
    status: "ACTIVE",
    createdByUserId: UserIdSchema.parse(randomUUID()),
    createdAt: now(),
    updatedAt: now(),
    version: 1,
    ...overrides,
  };
}

export function makeRun(
  version: DocumentVersion,
  status: ProcessingRunStatus,
  pipelineVersion: string,
): DocumentProcessingRun {
  return {
    id: DocumentProcessingRunIdSchema.parse(randomUUID()),
    documentVersionId: version.id,
    pipelineVersion,
    status,
    startedAt: null,
    completedAt: null,
    errorCode: null,
    extractorVersion: null,
    classifierVersion: null,
    embeddingModelId: null,
    costUsd: "0",
    metadata: {},
    createdAt: now(),
  };
}

function makeExtraction(
  version: DocumentVersion,
  document: Document,
  run: DocumentProcessingRun,
  signals: number,
): DocumentExtraction {
  return {
    id: DocumentExtractionIdSchema.parse(randomUUID()),
    tenantId: version.tenantId,
    ownerOrganisationId: document.ownerOrganisationId,
    documentId: document.id,
    documentVersionId: version.id,
    processingRunId: run.id,
    sourceId: null,
    schemaVersion: 1,
    extractorId: "text",
    extractorVersion: "1.0.0",
    pipelineVersion: run.pipelineVersion,
    artifactBucket: "cq-extractions-private",
    artifactKey: "extractions/a/b.json",
    artifactSha256: "b".repeat(64),
    artifactBytes: 512,
    blockCount: 3,
    pageCount: null,
    slideCount: null,
    language: null,
    visibilityScope: document.visibilityScope,
    sensitivityClass: document.sensitivityClass,
    instructionRiskSignals: signals,
    createdAt: now(),
  };
}

export type EvidenceCall = { readonly name: string; readonly input: unknown };

export type FakeEvidence = {
  readonly service: DocumentProcessingService;
  readonly calls: EvidenceCall[];
  readonly status: () => ProcessingRunStatus;
  readonly runId: () => string;
};

export function createFakeEvidence(options: {
  readonly version: DocumentVersion | null;
  readonly document?: Document | undefined;
  readonly runStatus?: ProcessingRunStatus | undefined;
  readonly pipelineVersion: string;
  readonly instructionRiskSignals?: number | undefined;
}): FakeEvidence {
  const calls: EvidenceCall[] = [];
  const version = options.version;
  const document =
    version === null ? null : (options.document ?? makeDocument(version));
  let run =
    version === null
      ? null
      : makeRun(
          version,
          options.runStatus ?? "QUEUED",
          options.pipelineVersion,
        );

  const record = (name: string, input: unknown): void => {
    calls.push({ name, input });
  };
  const requireRun = (): DocumentProcessingRun => {
    if (run === null) throw new Error("no processing run in this fake");
    return run;
  };
  const requireVersion = (): DocumentVersion => {
    if (version === null) throw new Error("no version in this fake");
    return version;
  };

  const resolveProcessingTarget: DocumentProcessingService["resolveProcessingTarget"] =
    (documentVersionId) => {
      record("resolveProcessingTarget", documentVersionId);
      return Promise.resolve(
        version === null || document === null ? null : { version, document },
      );
    };

  const registerProcessingRun: DocumentProcessingService["registerProcessingRun"] =
    (input) => {
      record("registerProcessingRun", input);
      return Promise.resolve({ run: requireRun(), created: true });
    };

  const transitionProcessingRun: DocumentProcessingService["transitionProcessingRun"] =
    (input) => {
      record("transitionProcessingRun", input);
      run = { ...requireRun(), status: input.status };
      return Promise.resolve(run);
    };

  const advanceVersionProcessingState: DocumentProcessingService["advanceVersionProcessingState"] =
    (input) => {
      record("advanceVersionProcessingState", input);
      return Promise.resolve(requireVersion());
    };

  const completeDocumentProcessing: DocumentProcessingService["completeDocumentProcessing"] =
    (input) => {
      record("completeDocumentProcessing", input);
      run = { ...requireRun(), status: "COMPLETED" };
      return Promise.resolve({ emitted: true });
    };

  const recordDocumentExtraction: DocumentProcessingService["recordDocumentExtraction"] =
    (input) => {
      record("recordDocumentExtraction", input);
      const current = requireRun();
      const currentVersion = requireVersion();
      if (document === null) throw new Error("no document in this fake");
      return Promise.resolve({
        extraction: makeExtraction(
          currentVersion,
          document,
          current,
          options.instructionRiskSignals ?? 0,
        ),
        instructionRiskCategories:
          (options.instructionRiskSignals ?? 0) > 0
            ? ["override_instructions"]
            : [],
        alreadyRecorded: false,
      });
    };

  const findDocumentExtraction: DocumentProcessingService["findDocumentExtraction"] =
    () => Promise.resolve(null);

  return {
    service: {
      resolveProcessingTarget,
      registerProcessingRun,
      transitionProcessingRun,
      advanceVersionProcessingState,
      completeDocumentProcessing,
      recordDocumentExtraction,
      findDocumentExtraction,
    },
    calls,
    status: () => requireRun().status,
    runId: () => requireRun().id,
  };
}
