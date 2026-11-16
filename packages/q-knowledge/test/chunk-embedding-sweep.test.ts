import { describe, expect, it } from "vitest";

import type { MessageSensitivity } from "@capital-q/contracts";
import type { TransactionManager } from "@capital-q/database";
import {
  createEmbeddingService,
  createFakeEmbeddingProvider,
  EmbeddingProviderFailure,
  FAKE_EMBEDDING_CONFIGURATION,
  type FakeEmbeddingProvider,
} from "@capital-q/q-embeddings";

import {
  embeddingInputFor,
  sweepChunkEmbeddings,
} from "../src/application/chunk-embedding-sweep.js";
import type { ChunkEmbeddingRepository } from "../src/application/embedding-ports.js";
import type { NewChunkEmbedding } from "../src/contracts/embeddings.js";
import type { Chunk } from "../src/contracts/index.js";

/**
 * The production chunk-embedding sweep (decision 99).
 *
 * Proves: nothing above the provider's ceiling is ever sent (even when the
 * repository's SQL filter is bypassed), an over-long chunk is embedded from
 * a deterministic prefix with its identity untouched, a rerun sends and
 * writes nothing, a provider with no ceiling is sent nothing, one refused
 * input does not hold back the batch, and the log carries no chunk text.
 */

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const SECRET = "HIGHLY-CONFIDENTIAL-TEXT-NEVER-SENT";

let counter = 0;
function chunk(
  content: string,
  sensitivityClass: MessageSensitivity = "CONFIDENTIAL",
  tenantId: string = TENANT_A,
): Chunk {
  counter += 1;
  const n = String(counter).padStart(12, "0");
  return {
    id: `44444444-4444-4444-8444-${n}`,
    tenantId,
    chunkSetId: "33333333-3333-4333-8333-333333333333",
    documentVersionId: "55555555-5555-4555-8555-555555555555",
    subjectType: "COMPANY",
    subjectId: "66666666-6666-4666-8666-666666666666",
    parentChunkId: null,
    chunkIndex: counter,
    role: "LEAF",
    kind: "passage",
    content,
    contentSha256: n.padStart(64, "a"),
    tokenEstimate: 10,
    blockIndexStart: 0,
    blockIndexEnd: 0,
    locator: { pageStart: 1 },
    visibilityScope: "founder_private",
    sensitivityClass,
    instructionRiskSignals: 0,
    status: "ACTIVE",
    invalidatedAt: null,
    createdAt: "2026-11-16T00:00:00.000Z",
  } as Chunk;
}

/**
 * An in-memory store with the same contract as the Postgres one: unique on
 * the work identity, filtered by configuration and allowed classes. With
 * `ignoreFilter` it returns every vectorless chunk, as a buggy query would.
 */
function store(
  chunks: readonly Chunk[],
  options: { readonly ignoreFilter?: boolean } = {},
) {
  const rows = new Map<string, NewChunkEmbedding>();
  const key = (chunkId: string, configurationVersion: string) =>
    `${chunkId}|${configurationVersion}`;
  const writes: NewChunkEmbedding[] = [];
  const repository: ChunkEmbeddingRepository = {
    upsert: (_tx, input) => {
      const k = key(input.chunkId, input.configurationVersion);
      const created = !rows.has(k);
      if (created) {
        rows.set(k, input);
        writes.push(input);
      }
      return Promise.resolve({
        created,
        embedding: {
          id: "77777777-7777-4777-8777-777777777777",
          tenantId: input.tenantId,
          chunkId: input.chunkId,
          providerCode: input.providerCode,
          modelCode: input.modelCode,
          modelRevision: input.modelRevision,
          configurationVersion: input.configurationVersion,
          instructionVersion: input.instructionVersion,
          dimension: input.dimension,
          createdAt: "2026-11-16T00:00:00.000Z",
        },
      } as Awaited<ReturnType<ChunkEmbeddingRepository["upsert"]>>);
    },
    findByWorkIdentity: () => Promise.resolve(null),
    listByChunk: () => Promise.resolve([]),
    findById: () => Promise.resolve(null),
    listChunksMissingEmbedding: (_sql, query) =>
      Promise.resolve(
        chunks
          .filter((c) => c.status === "ACTIVE")
          .filter((c) => !rows.has(key(c.id, query.configurationVersion)))
          .filter(
            (c) =>
              options.ignoreFilter === true ||
              query.allowedSensitivities === undefined ||
              query.allowedSensitivities.includes(c.sensitivityClass),
          )
          .filter((c) => !(query.excludeChunkIds ?? []).includes(c.id))
          .slice(0, query.limit),
      ),
    countChunksWithheldBySensitivity: (_sql, query) =>
      Promise.resolve(
        chunks.filter(
          (c) =>
            !rows.has(key(c.id, query.configurationVersion)) &&
            !query.allowedSensitivities.includes(c.sensitivityClass),
        ).length,
      ),
    countByConfiguration: () => Promise.resolve(rows.size),
  };
  return { repository, writes, rows };
}

const transactions: TransactionManager = {
  run: (work) => work({} as never),
};

function recordingLogger() {
  const lines: { level: string; fields: unknown; message: string }[] = [];
  return {
    lines,
    info: (fields: unknown, message: string) =>
      lines.push({ level: "info", fields, message }),
    warn: (fields: unknown, message: string) =>
      lines.push({ level: "warn", fields, message }),
    error: (fields: unknown, message: string) =>
      lines.push({ level: "error", fields, message }),
  };
}

function setup(
  chunks: readonly Chunk[],
  options: {
    readonly ceiling?: MessageSensitivity | null;
    readonly ignoreFilter?: boolean;
    readonly provider?: FakeEmbeddingProvider;
  } = {},
) {
  const provider = options.provider ?? createFakeEmbeddingProvider();
  const embeddings = createEmbeddingService({ provider });
  const s = store(chunks, { ignoreFilter: options.ignoreFilter ?? false });
  const logger = recordingLogger();
  const ceiling =
    options.ceiling === undefined ? "CONFIDENTIAL" : options.ceiling;
  const run = () =>
    sweepChunkEmbeddings(
      {
        sql: {} as never,
        transactions,
        repository: s.repository,
        embeddings,
        ceiling: () => Promise.resolve(ceiling),
        logger,
      },
      { maxChunks: 1_000 },
    );
  return { provider, run, logger, ...s };
}

describe("chunk embedding sweep", () => {
  it("never sends a chunk above the provider's ceiling, and counts it", async () => {
    const chunks = [
      chunk("public deck text", "PUBLIC"),
      chunk("confidential deck text", "CONFIDENTIAL"),
      chunk(SECRET, "HIGHLY_CONFIDENTIAL"),
      chunk(SECRET, "RESTRICTED"),
    ];
    const { provider, run, writes, logger } = setup(chunks);
    const report = await run();
    expect(provider.inputs).toEqual([
      "public deck text",
      "confidential deck text",
    ]);
    expect(provider.inputs.join()).not.toContain(SECRET);
    expect(report.created).toBe(2);
    expect(report.withheldBySensitivity).toBe(2);
    expect(report.ceiling).toBe("CONFIDENTIAL");
    expect(writes.map((w) => w.chunkId)).toEqual([
      chunks[0]?.id,
      chunks[1]?.id,
    ]);
    expect(JSON.stringify(logger.lines)).not.toContain(SECRET);
    expect(JSON.stringify(logger.lines)).not.toContain("deck text");
    expect(logger.lines.at(-1)?.fields).toMatchObject({
      withheldBySensitivity: 2,
      withheldReason: "SENSITIVITY_ABOVE_PROVIDER_CEILING",
    });
  });

  it("refuses an HC chunk even if the repository filter is bypassed", async () => {
    const chunks = [
      chunk("ok", "INTERNAL"),
      chunk(SECRET, "HIGHLY_CONFIDENTIAL"),
    ];
    const { provider, run } = setup(chunks, { ignoreFilter: true });
    const report = await run();
    expect(provider.inputs).toEqual(["ok"]);
    expect(report.skippedBySensitivity).toBe(1);
  });

  it("sends nothing when the provider has no eligible ceiling", async () => {
    const { provider, run, writes, logger } = setup([chunk("text")], {
      ceiling: null,
    });
    const report = await run();
    expect(report.outcome).toBe("PROVIDER_INELIGIBLE");
    expect(provider.calls()).toBe(0);
    expect(writes).toHaveLength(0);
    expect(logger.lines.at(-1)?.level).toBe("warn");
  });

  it("embeds an over-long chunk from a deterministic prefix, identity unchanged", async () => {
    const limit = FAKE_EMBEDDING_CONFIGURATION.maxInputCharacters;
    const long = chunk(`${"x".repeat(limit)}TAIL-BEYOND-THE-LIMIT`);
    const { provider, run, writes } = setup([long, chunk("short")]);
    const report = await run();
    expect(provider.inputs[0]).toBe("x".repeat(limit));
    expect(report.truncated).toBe(1);
    expect(report.truncatedChunkIds).toEqual([long.id]);
    // One row per chunk, keyed by the chunk's own id.
    expect(writes.map((w) => w.chunkId)).toContain(long.id);
    expect(writes).toHaveLength(2);
  });

  it("never cuts a surrogate pair", () => {
    expect(embeddingInputFor("ab\u{1F600}", 3)).toBe("ab");
    expect(embeddingInputFor("abc", 3)).toBe("abc");
  });

  it("a rerun sends and writes nothing new", async () => {
    const { provider, run, writes } = setup([chunk("a"), chunk("b")]);
    await run();
    const calls = provider.calls();
    const second = await run();
    expect(provider.calls()).toBe(calls);
    expect(second.created).toBe(0);
    expect(second.listed).toBe(0);
    expect(writes).toHaveLength(2);
  });

  it("writes each row under its chunk's own tenant, one tenant per request", async () => {
    const { run, writes } = setup([
      chunk("a", "CONFIDENTIAL", TENANT_A),
      chunk("b", "CONFIDENTIAL", TENANT_B),
    ]);
    await run();
    expect(writes.map((w) => w.tenantId).sort()).toEqual([TENANT_A, TENANT_B]);
  });

  it("one refused input does not hold back the rest of its batch", async () => {
    const base = createEmbeddingService({
      provider: createFakeEmbeddingProvider(),
    });
    // A provider that refuses one specific input (as the API does for an
    // input over its token limit), whatever the batch.
    const embeddings = {
      ...base,
      embedDocuments: (inputs: readonly string[]) =>
        inputs.includes("refused")
          ? Promise.reject(
              new EmbeddingProviderFailure("too large", {
                failureClass: "INPUT_TOO_LARGE",
                providerCode: "fake",
              }),
            )
          : base.embedDocuments(inputs),
    };
    const s = store([chunk("a"), chunk("refused"), chunk("b")]);
    const report = await sweepChunkEmbeddings(
      {
        sql: {} as never,
        transactions,
        repository: s.repository,
        embeddings,
        ceiling: () => Promise.resolve("CONFIDENTIAL"),
      },
      { maxChunks: 100 },
    );
    expect(report.created).toBe(2);
    expect(report.outcome).toBe("COMPLETED");
    expect(report.failures).toEqual({ INPUT_TOO_LARGE: 1 });
  });

  it("stops on an unavailable provider, logging the failure code", async () => {
    const provider = createFakeEmbeddingProvider({
      behaviour: { kind: "FAILURE", failureClass: "UNAVAILABLE" },
    });
    const { run, writes, logger } = setup([chunk("a"), chunk("b")], {
      provider,
    });
    const report = await run();
    expect(report.outcome).toBe("STOPPED_ON_FAILURE");
    expect(report.failures).toEqual({ UNAVAILABLE: 2 });
    expect(writes).toHaveLength(0);
    expect(logger.lines.at(-1)).toMatchObject({
      level: "error",
      fields: { alert: "CHUNK_EMBEDDING_FAILED" },
    });
  });
});
