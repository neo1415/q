import { describe, expect, it, vi } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  createAuthorisedRetrievalService,
  DEFAULT_RETRIEVAL_CONFIG,
  RetrievalCancelledError,
  StaleRetrievalEnvelopeError,
  type ChunkHydrationPort,
  type HydratedChunk,
  type LexicalSearchPort,
  type RetrievalPermissionEnvelope,
} from "../src/index.js";
import type { SemanticSearchPort } from "../src/application/embedding-ports.js";
import type { ChunkId } from "../src/contracts/index.js";

/**
 * The retrieval service's control flow, with both halves and the database
 * replaced by fakes: degradation, bounds, cancellation and the order in
 * which the pieces run. The SQL these fakes stand in for is exercised for
 * real, against real permissions, in the integration suite.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const COMPANY = "44444444-4444-4444-8444-444444444444";

const sql = null as unknown as DatabaseExecutor;

function envelope(
  overrides: Partial<RetrievalPermissionEnvelope> = {},
): RetrievalPermissionEnvelope {
  return {
    planId: "77777777-7777-4777-8777-777777777777",
    planFingerprint: "a".repeat(64),
    policyVersion: "context-firewall-v1",
    tenantId: TENANT,
    actorUserId: "22222222-2222-4222-8222-222222222222",
    organisationId: "33333333-3333-4333-8333-333333333333",
    taskClass: "OWN_COMPANY_QUESTION",
    constraints: [
      {
        scopeKind: "EVIDENCE_DOCUMENTS",
        layer: "EVIDENCE_DOCUMENTS",
        subjectIds: [COMPANY],
        visibilityScopes: ["founder_private"],
        sensitivityCeiling: "HIGHLY_CONFIDENTIAL",
        canDiscloseExistence: true,
        canQuote: true,
        canProvideLink: false,
      },
    ],
    maxSensitivity: "HIGHLY_CONFIDENTIAL",
    evaluatedAt: "2026-09-07T10:00:00.000Z",
    revalidateAfter: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const chunkId = (n: number): ChunkId =>
  `0000000${String(n)}-0000-4000-8000-000000000000` as ChunkId;

function hydrated(id: ChunkId, parent: ChunkId | null = null): HydratedChunk {
  return {
    chunkId: id,
    chunkSetId:
      "99999999-9999-4999-8999-999999999999" as HydratedChunk["chunkSetId"],
    documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    documentVersionId:
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as HydratedChunk["documentVersionId"],
    documentTitle: "Deck",
    subjectType: "COMPANY",
    subjectId: COMPANY,
    chunkKind: "slide",
    role: parent === null ? "PARENT" : "LEAF",
    locator: { slide: 1 },
    content: `content ${id}`,
    visibilityScope: "founder_private",
    sensitivityClass: "HIGHLY_CONFIDENTIAL",
    parentChunkId: parent,
    scopeKind: "EVIDENCE_DOCUMENTS",
    canDiscloseExistence: true,
    canQuote: true,
    canProvideLink: false,
  };
}

function fakeHydration(rows: readonly HydratedChunk[]): ChunkHydrationPort {
  const byId = new Map(rows.map((row) => [row.chunkId, row]));
  return {
    hydrate: (_executor, query) =>
      Promise.resolve(
        query.chunkIds
          .map((id) => byId.get(id))
          .filter((row): row is HydratedChunk => row !== undefined),
      ),
    parentsOf: () => Promise.resolve(new Map()),
    countAuthorised: () => Promise.resolve(rows.length),
  };
}

const noLexical: LexicalSearchPort = { search: () => Promise.resolve([]) };
const noSemantic: SemanticSearchPort = { search: () => Promise.resolve([]) };

describe("authorised retrieval service", () => {
  it("refuses to retrieve behind a plan that is no longer current", async () => {
    const service = createAuthorisedRetrievalService({
      sql,
      lexical: noLexical,
      semantic: noSemantic,
      hydration: fakeHydration([]),
    });
    await expect(
      service.retrieve({
        query: "market size",
        envelope: envelope({ revalidateAfter: "2020-01-01T00:00:00.000Z" }),
      }),
    ).rejects.toBeInstanceOf(StaleRetrievalEnvelopeError);
  });

  it("searches nothing when the envelope authorises nothing", async () => {
    const lexical = { search: vi.fn().mockResolvedValue([]) };
    const service = createAuthorisedRetrievalService({
      sql,
      lexical: lexical,
      semantic: noSemantic,
      hydration: fakeHydration([]),
    });
    const result = await service.retrieve({
      query: "market size",
      envelope: envelope({ constraints: [] }),
    });
    // Not "searched and filtered to nothing": never searched at all.
    expect(lexical.search).not.toHaveBeenCalled();
    expect(result.hits).toEqual([]);
    expect(result.degraded.reason).toBe("NO_AUTHORISED_SCOPE");
  });

  it("degrades to lexical when no embedding runtime is configured", async () => {
    const service = createAuthorisedRetrievalService({
      sql,
      lexical: {
        search: () =>
          Promise.resolve([
            { chunkId: chunkId(1), rank: 1, lexicalScore: 0.5 },
          ]),
      },
      semantic: noSemantic,
      hydration: fakeHydration([hydrated(chunkId(1))]),
    });
    const result = await service.retrieve({
      query: "SOC 2",
      envelope: envelope(),
    });
    expect(result.executedStrategy).toBe("LEXICAL_ONLY");
    expect(result.degraded.semantic).toBe("UNAVAILABLE");
    expect(result.degraded.reason).toBe("EMBEDDING_UNAVAILABLE");
    // The point of degrading rather than failing: an answer is still
    // possible from the half that works.
    expect(result.hits.map((h) => h.chunkId)).toEqual([chunkId(1)]);
  });

  it("never reaches for an external provider when the local one is down", async () => {
    const embeddings = {
      describe: () => {
        throw new Error("unused");
      },
      embedDocuments: () => Promise.reject(new Error("unused")),
      embedQuery: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      health: () => Promise.reject(new Error("unused")),
    };
    const service = createAuthorisedRetrievalService({
      sql,
      lexical: {
        search: () =>
          Promise.resolve([
            { chunkId: chunkId(1), rank: 1, lexicalScore: 0.5 },
          ]),
      },
      semantic: noSemantic,
      hydration: fakeHydration([hydrated(chunkId(1))]),
      embeddings: embeddings,
    });
    const result = await service.retrieve({
      query: "payment rails",
      envelope: envelope(),
    });
    expect(embeddings.embedQuery).toHaveBeenCalledTimes(1);
    expect(result.degraded.reason).toBe("EMBEDDING_UNAVAILABLE");
    expect(result.executedStrategy).toBe("LEXICAL_ONLY");
  });

  it("degrades to semantic when the lexical half fails", async () => {
    const service = createAuthorisedRetrievalService({
      sql,
      lexical: {
        search: () => Promise.reject(new Error("relation does not exist")),
      },
      semantic: {
        search: () =>
          Promise.resolve([
            {
              chunkId: chunkId(2),
              rank: 1,
            } as never,
          ]),
      },
      hydration: fakeHydration([hydrated(chunkId(2))]),
      embeddings: {
        embedQuery: () =>
          Promise.resolve({
            vector: [0.1],
            dimension: 1,
            configurationVersion: "x-v1",
          }),
      } as never,
    });
    const result = await service.retrieve({
      query: "market size",
      envelope: envelope(),
    });
    expect(result.executedStrategy).toBe("SEMANTIC_ONLY");
    expect(result.degraded.lexical).toBe("UNAVAILABLE");
  });

  it("returns an empty, honest result when both halves are down", async () => {
    const service = createAuthorisedRetrievalService({
      sql,
      lexical: { search: () => Promise.reject(new Error("down")) },
      semantic: noSemantic,
      hydration: fakeHydration([]),
    });
    const result = await service.retrieve({
      query: "market size",
      envelope: envelope(),
    });
    expect(result.hits).toEqual([]);
    expect(result.degraded.lexical).toBe("UNAVAILABLE");
    expect(result.degraded.semantic).toBe("UNAVAILABLE");
  });

  it("drops a fused candidate that hydration does not admit", async () => {
    // The lists and hydration should always agree; this asserts what happens
    // when they do not. Hydration is the last word, so a candidate it does
    // not return is not assembled, whatever rank it held.
    const service = createAuthorisedRetrievalService({
      sql,
      lexical: {
        search: () =>
          Promise.resolve([
            { chunkId: chunkId(1), rank: 1, lexicalScore: 0.9 },
            { chunkId: chunkId(2), rank: 2, lexicalScore: 0.4 },
          ]),
      },
      semantic: noSemantic,
      hydration: fakeHydration([hydrated(chunkId(2))]),
    });
    const result = await service.retrieve({
      query: "anything",
      envelope: envelope(),
    });
    expect(result.hits.map((h) => h.chunkId)).toEqual([chunkId(2)]);
  });

  it("bounds the final hits and the assembled context", async () => {
    const ids = Array.from({ length: 9 }, (_, i) => chunkId(i));
    const service = createAuthorisedRetrievalService({
      sql,
      lexical: {
        search: () =>
          Promise.resolve(
            ids.map((id, at) => ({
              chunkId: id,
              rank: at + 1,
              lexicalScore: 1 - at / 10,
            })),
          ),
      },
      semantic: noSemantic,
      hydration: fakeHydration(ids.map((id) => hydrated(id))),
    });
    const result = await service.retrieve({
      query: "anything",
      envelope: envelope(),
    });
    expect(result.hits).toHaveLength(DEFAULT_RETRIEVAL_CONFIG.finalHits);
    expect(result.diagnostics.contextCharacters).toBeLessThanOrEqual(
      DEFAULT_RETRIEVAL_CONFIG.maxContextCharacters,
    );
  });

  it("stops when the run is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const service = createAuthorisedRetrievalService({
      sql,
      lexical: noLexical,
      semantic: noSemantic,
      hydration: fakeHydration([]),
    });
    await expect(
      service.retrieve({
        query: "market size",
        envelope: envelope(),
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(RetrievalCancelledError);
  });

  it("reports counts and timings without any text", async () => {
    const service = createAuthorisedRetrievalService({
      sql,
      lexical: {
        search: () =>
          Promise.resolve([
            { chunkId: chunkId(1), rank: 1, lexicalScore: 0.5 },
          ]),
      },
      semantic: noSemantic,
      hydration: fakeHydration([hydrated(chunkId(1))]),
    });
    const result = await service.retrieve({
      query: "RAG-QUERY-PRIVATE-DO-NOT-LOG",
      envelope: envelope(),
    });
    const diagnostics = JSON.stringify(result.diagnostics);
    expect(diagnostics).not.toContain("RAG-QUERY-PRIVATE-DO-NOT-LOG");
    expect(diagnostics).not.toContain("content");
    expect(result.diagnostics.constraintCount).toBe(1);
    expect(result.configVersion).toBe("capital-q-hybrid-v1");
  });
});
