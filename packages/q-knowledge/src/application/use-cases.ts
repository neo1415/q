import { createHash } from "node:crypto";

import { z } from "zod";

import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  DocumentNotFoundError,
  DocumentStorageUnavailableError,
  DocumentVersionNotFoundError,
  EvidenceRuleError,
  type EvidenceRepositories,
  type PrivateDocumentStorageProvider,
} from "@capital-q/evidence";
import {
  DocumentIdSchema,
  DocumentVersionIdSchema,
  EvidenceSourceIdSchema,
  EXTRACTION_LIMITS,
  ExtractedBlockSchema,
  ExtractedDocumentSchema,
  PipelineVersionSchema,
  type Document,
  type DocumentExtraction,
  type DocumentVersion,
  type ExtractedBlock,
} from "@capital-q/evidence/contracts";
import { TenantIdSchema, type TenantId } from "@capital-q/security";

import { planChunks } from "../chunking/index.js";
import {
  CHUNKING_VERSION,
  ChunkingVersionSchema,
  ChunkSetIdSchema,
  ChunkSetStatusReasonSchema,
  type Chunk,
  type ChunkId,
  type ChunkPlan,
  type ChunkSet,
  type ChunkSetStatusReason,
} from "../contracts/index.js";
import { assertInherits } from "../domain/inheritance.js";
import type { QKnowledgeRepositories } from "./ports.js";

/**
 * Chunk set use cases (CQ-RAG-001 §27, §37-§39, §76).
 *
 * Trusted server operations: the caller is the processing worker or an
 * operator command, scoped by tenant and identifiers that were resolved
 * from rows, never from a client. There is no AuthorizationService here on
 * purpose — nothing below decides what a person may see. Retrieval will.
 */

export type QKnowledgeDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly evidence: Pick<
    EvidenceRepositories,
    "documents" | "documentVersions" | "documentExtractions"
  >;
  readonly repositories: QKnowledgeRepositories;
  /** Needed only to rebuild from a stored artifact. */
  readonly storage?: PrivateDocumentStorageProvider | undefined;
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export const BuildChunkSetInputSchema = z
  .object({
    tenantId: z.string().uuid(),
    documentVersionId: DocumentVersionIdSchema,
    /** Which extraction to derive from; one per (version, pipeline). */
    pipelineVersion: PipelineVersionSchema,
    blocks: z.array(ExtractedBlockSchema).max(EXTRACTION_LIMITS.maxBlocks),
    chunkingVersion: ChunkingVersionSchema.optional(),
  })
  .strict();
export type BuildChunkSetInput = z.input<typeof BuildChunkSetInputSchema>;

export type BuildChunkSetResult =
  | {
      readonly outcome: "BUILT";
      readonly chunkSet: ChunkSet;
      readonly plan: Pick<
        ChunkPlan,
        "strategy" | "truncated" | "tokenEstimate"
      >;
      readonly chunkCount: number;
      readonly supersededSetIds: readonly string[];
    }
  | { readonly outcome: "ALREADY_BUILT"; readonly chunkSet: ChunkSet }
  | {
      readonly outcome: "SKIPPED";
      readonly reason: "NO_SUBJECT" | "NO_EXTRACTION" | "NO_BLOCKS";
    };

async function loadTarget(
  dependencies: QKnowledgeDependencies,
  tenantId: TenantId,
  documentVersionId: DocumentVersion["id"],
): Promise<{ readonly version: DocumentVersion; readonly document: Document }> {
  const version = await dependencies.evidence.documentVersions.findById(
    dependencies.sql,
    tenantId,
    documentVersionId,
  );
  if (version === null) throw new DocumentVersionNotFoundError();
  const document = await dependencies.evidence.documents.findInTenant(
    dependencies.sql,
    tenantId,
    version.documentId,
  );
  if (document === null) throw new DocumentNotFoundError();
  return { version, document };
}

export function createBuildChunkSet(dependencies: QKnowledgeDependencies) {
  const { repositories, transactions } = dependencies;

  return async (input: BuildChunkSetInput): Promise<BuildChunkSetResult> => {
    const parsed = BuildChunkSetInputSchema.parse(input);
    const tenantId = TenantIdSchema.parse(parsed.tenantId);
    const chunkingVersion = parsed.chunkingVersion ?? CHUNKING_VERSION;

    const extraction =
      await dependencies.evidence.documentExtractions.findByVersionAndPipeline(
        dependencies.sql,
        tenantId,
        parsed.documentVersionId,
        parsed.pipelineVersion,
      );
    if (extraction === null) {
      return { outcome: "SKIPPED", reason: "NO_EXTRACTION" };
    }
    const existing = await repositories.chunkSets.findByIdentity(
      dependencies.sql,
      tenantId,
      parsed.documentVersionId,
      extraction.id,
      chunkingVersion,
    );
    if (existing !== null) {
      // Same version, same parser output, same chunker: the set exists.
      return { outcome: "ALREADY_BUILT", chunkSet: existing };
    }
    const { version, document } = await loadTarget(
      dependencies,
      tenantId,
      parsed.documentVersionId,
    );
    if (document.companyId === null) {
      // No typed subject yet: no anonymous chunk pile.
      return { outcome: "SKIPPED", reason: "NO_SUBJECT" };
    }
    if (parsed.blocks.length === 0) {
      return { outcome: "SKIPPED", reason: "NO_BLOCKS" };
    }

    const plan = planChunks(parsed.blocks, { chunkingVersion });
    if (plan.chunks.length === 0) {
      return { outcome: "SKIPPED", reason: "NO_BLOCKS" };
    }
    // Derived governance: exactly the extraction's, which is exactly the
    // document's. Refuse rather than adjust if that ever stops being true.
    const governance = assertInherits(
      {
        visibilityScope: extraction.visibilityScope,
        sensitivityClass: extraction.sensitivityClass,
      },
      {
        visibilityScope: document.visibilityScope,
        sensitivityClass: document.sensitivityClass,
      },
    );

    return transactions.run(async (tx) => {
      // Serialises activation per document so two workers cannot both
      // believe their set is the active one.
      const locked = await dependencies.evidence.documents.lockById(
        tx,
        tenantId,
        document.ownerOrganisationId,
        document.id,
      );
      if (locked === null) throw new DocumentNotFoundError();
      const raced = await repositories.chunkSets.findByIdentity(
        tx.sql,
        tenantId,
        parsed.documentVersionId,
        extraction.id,
        chunkingVersion,
      );
      if (raced !== null) {
        return { outcome: "ALREADY_BUILT", chunkSet: raced };
      }

      // Activation policy (§37-§38): only the document's current version,
      // while the document is active, yields an ACTIVE set. Anything else
      // is derived history from the moment it is written.
      const isCurrent =
        locked.currentVersionId === version.id && locked.status === "ACTIVE";
      const statusReason: ChunkSetStatusReason | null = isCurrent
        ? null
        : locked.status !== "ACTIVE"
          ? "DOCUMENT_ARCHIVED"
          : "NOT_CURRENT_VERSION";

      const supersededSetIds: string[] = [];
      if (isCurrent) {
        const active = (
          await repositories.chunkSets.listByDocument(
            tx.sql,
            tenantId,
            locked.id,
          )
        ).filter((set) => set.status === "ACTIVE");
        if (active.length > 0) {
          const reason: ChunkSetStatusReason = active.every(
            (set) => set.documentVersionId === version.id,
          )
            ? active.every((set) => set.extractionId === extraction.id)
              ? "NEWER_CHUNKING_VERSION"
              : "NEWER_EXTRACTION"
            : "NEWER_DOCUMENT_VERSION";
          await repositories.chunkSets.transition(tx, {
            tenantId,
            chunkSetIds: active.map((set) => set.id),
            status: "SUPERSEDED",
            reason,
          });
          supersededSetIds.push(...active.map((set) => set.id));
        }
      }

      const chunkSet = await repositories.chunkSets.insert(tx, {
        tenantId,
        ownerOrganisationId: document.ownerOrganisationId,
        sourceId: extraction.sourceId,
        documentId: document.id,
        documentVersionId: version.id,
        extractionId: extraction.id,
        subjectType: "COMPANY",
        subjectId: document.companyId ?? "",
        extractorId: extraction.extractorId,
        extractorVersion: extraction.extractorVersion,
        chunkingStrategy: plan.strategy,
        chunkingVersion,
        visibilityScope: governance.visibilityScope,
        sensitivityClass: governance.sensitivityClass,
        status: isCurrent ? "ACTIVE" : "SUPERSEDED",
        statusReason,
        chunkCount: plan.chunks.length,
        tokenEstimate: plan.tokenEstimate,
      });

      // Parents precede their children in a plan, so one ordered pass
      // resolves every parent id before it is needed.
      const ids = new Map<number, ChunkId>();
      for (const planned of plan.chunks) {
        const parentChunkId =
          planned.parentIndex === null
            ? null
            : (ids.get(planned.parentIndex) ?? null);
        if (planned.parentIndex !== null && parentChunkId === null) {
          throw new EvidenceRuleError(
            "chunk plan references an unknown parent",
          );
        }
        const chunk = await repositories.chunks.insert(tx, {
          tenantId,
          chunkSetId: chunkSet.id,
          documentVersionId: version.id,
          subjectType: "COMPANY",
          subjectId: chunkSet.subjectId,
          parentChunkId,
          chunkIndex: planned.index,
          role: planned.role,
          kind: planned.kind,
          content: planned.content,
          contentSha256: planned.contentSha256,
          tokenEstimate: planned.tokenEstimate,
          blockIndexStart: planned.blockIndexStart,
          blockIndexEnd: planned.blockIndexEnd,
          locator: planned.locator,
          visibilityScope: governance.visibilityScope,
          sensitivityClass: governance.sensitivityClass,
          instructionRiskSignals: planned.instructionRiskSignals,
          status: chunkSet.status,
        });
        ids.set(planned.index, chunk.id);
      }

      return {
        outcome: "BUILT",
        chunkSet,
        plan: {
          strategy: plan.strategy,
          truncated: plan.truncated,
          tokenEstimate: plan.tokenEstimate,
        },
        chunkCount: plan.chunks.length,
        supersededSetIds,
      };
    });
  };
}

// ---------------------------------------------------------------------------
// Rebuild from the stored artifact
// ---------------------------------------------------------------------------

export const RebuildChunkSetInputSchema = z
  .object({
    tenantId: z.string().uuid(),
    documentVersionId: DocumentVersionIdSchema,
    /** Defaults to the most recent extraction of the version. */
    pipelineVersion: PipelineVersionSchema.optional(),
    chunkingVersion: ChunkingVersionSchema.optional(),
  })
  .strict();
export type RebuildChunkSetInput = z.input<typeof RebuildChunkSetInputSchema>;

async function readArtifact(
  storage: PrivateDocumentStorageProvider,
  extraction: DocumentExtraction,
): Promise<readonly ExtractedBlock[]> {
  const stream = await storage.openObjectStream({
    bucket: extraction.artifactBucket,
    key: extraction.artifactKey,
  });
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const part of stream.body) {
    total += part.byteLength;
    if (total > EXTRACTION_LIMITS.maxArtifactBytes) {
      throw new EvidenceRuleError("the extraction artifact exceeds its bound");
    }
    parts.push(part);
  }
  const body = Buffer.concat(parts);
  // The artifact is what the row says it is, or it is not used at all.
  const sha256 = createHash("sha256").update(body).digest("hex");
  if (sha256 !== extraction.artifactSha256) {
    throw new EvidenceRuleError(
      "the extraction artifact does not match its recorded hash",
    );
  }
  const artifact = ExtractedDocumentSchema.parse(
    JSON.parse(body.toString("utf8")),
  );
  if (artifact.documentVersionId !== extraction.documentVersionId) {
    throw new EvidenceRuleError(
      "the extraction artifact names another document version",
    );
  }
  return artifact.blocks;
}

export function createRebuildChunkSet(dependencies: QKnowledgeDependencies) {
  const build = createBuildChunkSet(dependencies);
  return async (input: RebuildChunkSetInput): Promise<BuildChunkSetResult> => {
    const parsed = RebuildChunkSetInputSchema.parse(input);
    const storage = dependencies.storage;
    if (storage === undefined) throw new DocumentStorageUnavailableError();
    const tenantId = TenantIdSchema.parse(parsed.tenantId);
    const extractions =
      await dependencies.evidence.documentExtractions.listByVersion(
        dependencies.sql,
        tenantId,
        parsed.documentVersionId,
      );
    const extraction =
      parsed.pipelineVersion === undefined
        ? extractions[extractions.length - 1]
        : extractions.find((e) => e.pipelineVersion === parsed.pipelineVersion);
    if (extraction === undefined) {
      return { outcome: "SKIPPED", reason: "NO_EXTRACTION" };
    }
    const blocks = await readArtifact(storage, extraction);
    return build({
      tenantId,
      documentVersionId: parsed.documentVersionId,
      pipelineVersion: extraction.pipelineVersion,
      blocks: [...blocks],
      ...(parsed.chunkingVersion === undefined
        ? {}
        : { chunkingVersion: parsed.chunkingVersion }),
    });
  };
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

export const RevokeChunkSetsInputSchema = z
  .object({
    tenantId: z.string().uuid(),
    documentId: DocumentIdSchema.optional(),
    sourceId: EvidenceSourceIdSchema.optional(),
    reason: ChunkSetStatusReasonSchema.extract([
      "SOURCE_REVOKED",
      "DOCUMENT_REVOKED",
      "DOCUMENT_ARCHIVED",
    ]),
  })
  .strict()
  .refine(
    (value) => value.documentId !== undefined || value.sourceId !== undefined,
    {
      message: "a document or a source must be named",
      path: ["documentId"],
    },
  );
export type RevokeChunkSetsInput = z.input<typeof RevokeChunkSetsInputSchema>;

/**
 * Withdrawing a source or a document withdraws every chunk set derived from
 * it, active or superseded, so nothing stale can be a retrieval candidate
 * later — including embeddings built over these rows in a later packet.
 * Provenance stays; only eligibility ends.
 */
export function createRevokeChunkSets(dependencies: QKnowledgeDependencies) {
  const { repositories, transactions } = dependencies;
  return async (
    input: RevokeChunkSetsInput,
  ): Promise<{ readonly revokedSetIds: readonly string[] }> => {
    const parsed = RevokeChunkSetsInputSchema.parse(input);
    const tenantId = TenantIdSchema.parse(parsed.tenantId);
    return transactions.run(async (tx) => {
      const sets = [
        ...(parsed.documentId === undefined
          ? []
          : await repositories.chunkSets.listByDocument(
              tx.sql,
              tenantId,
              parsed.documentId,
            )),
        ...(parsed.sourceId === undefined
          ? []
          : await repositories.chunkSets.listBySource(
              tx.sql,
              tenantId,
              parsed.sourceId,
            )),
      ].filter((set) => set.status !== "REVOKED");
      const ids = [...new Set(sets.map((set) => set.id))].map((id) =>
        ChunkSetIdSchema.parse(id),
      );
      if (ids.length === 0) return { revokedSetIds: [] };
      await repositories.chunkSets.transition(tx, {
        tenantId,
        chunkSetIds: ids,
        status: "REVOKED",
        reason: parsed.reason,
      });
      return { revokedSetIds: ids };
    });
  };
}

// ---------------------------------------------------------------------------
// Reads (server-internal; never a browser API)
// ---------------------------------------------------------------------------

export function createListChunkSets(dependencies: QKnowledgeDependencies) {
  return (query: {
    readonly tenantId: string;
    readonly documentVersionId: string;
  }): Promise<readonly ChunkSet[]> =>
    dependencies.repositories.chunkSets.listByVersion(
      dependencies.sql,
      TenantIdSchema.parse(query.tenantId),
      DocumentVersionIdSchema.parse(query.documentVersionId),
    );
}

export function createListChunks(dependencies: QKnowledgeDependencies) {
  return (query: {
    readonly tenantId: string;
    readonly chunkSetId: string;
  }): Promise<readonly Chunk[]> =>
    dependencies.repositories.chunks.listBySet(
      dependencies.sql,
      TenantIdSchema.parse(query.tenantId),
      ChunkSetIdSchema.parse(query.chunkSetId),
    );
}

export function createListActiveChunks(dependencies: QKnowledgeDependencies) {
  return (query: {
    readonly tenantId: string;
    readonly documentVersionId: string;
  }): Promise<readonly Chunk[]> =>
    dependencies.repositories.chunks.listActiveByVersion(
      dependencies.sql,
      TenantIdSchema.parse(query.tenantId),
      DocumentVersionIdSchema.parse(query.documentVersionId),
    );
}
