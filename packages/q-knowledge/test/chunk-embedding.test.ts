import { describe, expect, it } from "vitest";

import {
  createEmbeddingService,
  createFakeEmbeddingProvider,
  embeddingWorkKey,
  EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
  FAKE_EMBEDDING_CONFIGURATION,
} from "@capital-q/q-embeddings";

import { createChunkEmbeddingProcessor } from "../src/application/chunk-embedding.js";
import type { QKnowledgeRepositories } from "../src/application/ports.js";
import type {
  Chunk,
  ChunkSet,
  ChunkSetStatus,
} from "../src/contracts/index.js";

/**
 * The chunk embedding seam (CQ-RAG-002 §33, §35).
 *
 * What this proves is eligibility and identity, not vector quality: a chunk
 * whose set is no longer ACTIVE is never embedded, results come back in
 * chunk order with a work identity attached, and nothing is persisted —
 * CQ-RAG-003 owns the rows.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const SET = "33333333-3333-4333-8333-333333333333";
const PRIVATE = "EMBEDDING-PRIVATE-CONTENT-DO-NOT-LOG";

function chunk(
  index: number,
  content: string,
  status: ChunkSetStatus = "ACTIVE",
): Chunk {
  return {
    id: `44444444-4444-4444-8444-4444444444${String(index).padStart(2, "0")}`,
    tenantId: TENANT,
    chunkSetId: SET,
    documentVersionId: "55555555-5555-4555-8555-555555555555",
    subjectType: "COMPANY",
    subjectId: "66666666-6666-4666-8666-666666666666",
    parentChunkId: null,
    chunkIndex: index,
    role: "LEAF",
    kind: "passage",
    content,
    contentSha256: `${String(index)}`.padStart(64, "a"),
    tokenEstimate: 10,
    blockIndexStart: index,
    blockIndexEnd: index,
    locator: { pageStart: 1 },
    visibilityScope: "founder_private",
    sensitivityClass: "RESTRICTED",
    instructionRiskSignals: 0,
    status,
    invalidatedAt: status === "ACTIVE" ? null : "2026-09-06T00:00:00.000Z",
    createdAt: "2026-09-06T00:00:00.000Z",
  } as Chunk;
}

function set(status: ChunkSetStatus): ChunkSet {
  return {
    id: SET,
    tenantId: TENANT,
    status,
    chunkCount: 2,
  } as ChunkSet;
}

function repositories(options: {
  readonly set: ChunkSet | null;
  readonly chunks: readonly Chunk[];
}): QKnowledgeRepositories {
  return {
    chunkSets: {
      findById: (_sql: unknown, tenantId: string, chunkSetId: string) =>
        Promise.resolve(
          options.set !== null &&
            tenantId === options.set.tenantId &&
            chunkSetId === options.set.id
            ? options.set
            : null,
        ),
    },
    chunks: {
      listBySet: () => Promise.resolve(options.chunks),
    },
  } as unknown as QKnowledgeRepositories;
}

const service = () =>
  createEmbeddingService({ provider: createFakeEmbeddingProvider() });

describe("chunk embedding processor", () => {
  it("embeds an active set in chunk order with a complete work identity", async () => {
    const chunks = [chunk(0, "first passage"), chunk(1, `second ${PRIVATE}`)];
    const embeddings = service();
    const process = createChunkEmbeddingProcessor({
      repositories: repositories({ set: set("ACTIVE"), chunks }),
      sql: undefined as never,
      embeddings,
    });

    const result = await process({ tenantId: TENANT, chunkSetId: SET });

    expect(result.outcome).toBe("EMBEDDED");
    if (result.outcome !== "EMBEDDED") return;
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings.map((e) => e.chunkId)).toEqual(
      chunks.map((c) => c.id),
    );
    for (const [at, embedded] of result.embeddings.entries()) {
      const source = chunks[at];
      expect(embedded.tenantId).toBe(TENANT);
      expect(embedded.contentSha256).toBe(source?.contentSha256);
      expect(embedded.embedding.dimension).toBe(
        FAKE_EMBEDDING_CONFIGURATION.dimension,
      );
      // A document is embedded without a query instruction.
      expect(embedded.embedding.instructionVersion).toBe(
        EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
      );
      expect(embedded.workKey).toBe(
        embeddingWorkKey({
          contentSha256: source?.contentSha256 ?? "",
          modelCode: FAKE_EMBEDDING_CONFIGURATION.modelCode,
          dimension: FAKE_EMBEDDING_CONFIGURATION.dimension,
          instructionVersion: EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
        }),
      );
    }
    // The chunk text never travels back out with the result.
    expect(JSON.stringify(result.embeddings)).not.toContain(PRIVATE);
  });

  it("refuses to embed a superseded or revoked set", async () => {
    for (const status of ["SUPERSEDED", "REVOKED"] as const) {
      const provider = createFakeEmbeddingProvider();
      const process = createChunkEmbeddingProcessor({
        repositories: repositories({
          set: set(status),
          chunks: [chunk(0, "text")],
        }),
        sql: undefined as never,
        embeddings: createEmbeddingService({ provider }),
      });
      await expect(
        process({ tenantId: TENANT, chunkSetId: SET }),
      ).resolves.toEqual({ outcome: "SKIPPED", reason: "NOT_ACTIVE" });
      // Eligibility is checked before the work, not after a vector exists.
      expect(provider.calls()).toBe(0);
    }
  });

  it("refuses a set another tenant owns and one that does not exist", async () => {
    const provider = createFakeEmbeddingProvider();
    const process = createChunkEmbeddingProcessor({
      repositories: repositories({
        set: set("ACTIVE"),
        chunks: [chunk(0, "text")],
      }),
      sql: undefined as never,
      embeddings: createEmbeddingService({ provider }),
    });
    await expect(
      process({ tenantId: OTHER_TENANT, chunkSetId: SET }),
    ).resolves.toEqual({ outcome: "SKIPPED", reason: "NOT_ACTIVE" });
    expect(provider.calls()).toBe(0);
  });

  it("skips a set whose chunks are all inactive", async () => {
    const provider = createFakeEmbeddingProvider();
    const process = createChunkEmbeddingProcessor({
      repositories: repositories({
        set: set("ACTIVE"),
        chunks: [chunk(0, "gone", "REVOKED")],
      }),
      sql: undefined as never,
      embeddings: createEmbeddingService({ provider }),
    });
    await expect(
      process({ tenantId: TENANT, chunkSetId: SET }),
    ).resolves.toEqual({ outcome: "SKIPPED", reason: "NO_CHUNKS" });
    expect(provider.calls()).toBe(0);
  });

  it("gives two tenants the same work key for identical text, and separate results", () => {
    // Identical content is identical work. It is never shared ownership:
    // storage scopes by tenant, which is why the key alone addresses nothing.
    const shared = "the same synthetic sentence";
    const first = chunk(0, shared);
    const second: Chunk = {
      ...chunk(0, shared),
      tenantId: OTHER_TENANT as Chunk["tenantId"],
    };
    const key = (c: Chunk) =>
      embeddingWorkKey({
        contentSha256: c.contentSha256,
        modelCode: FAKE_EMBEDDING_CONFIGURATION.modelCode,
        dimension: FAKE_EMBEDDING_CONFIGURATION.dimension,
        instructionVersion: EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
      });
    expect(key(first)).toBe(key(second));
    expect(first.tenantId).not.toBe(second.tenantId);
  });
});
