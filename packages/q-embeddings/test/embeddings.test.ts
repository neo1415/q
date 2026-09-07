import { describe, expect, it, vi } from "vitest";

import {
  assertValidVector,
  cosineSimilarity,
  createEmbeddingService,
  createFakeEmbeddingProvider,
  createLocalTeiEmbeddingProvider,
  deterministicVector,
  embeddingWorkKey,
  EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
  EMBEDDING_QUERY_TASKS,
  EmbeddingConfigurationSchema,
  EmbeddingProviderFailure,
  EVIDENCE_RETRIEVAL_INSTRUCTION,
  FAKE_EMBEDDING_CONFIGURATION,
  instructionFor,
  isRetryableEmbeddingFailure,
  QWEN3_EMBEDDING_CONFIGURATION,
  QWEN3_EMBEDDING_MODEL_CODE,
  QWEN3_EMBEDDING_MODEL_REVISION,
  UNIT_NORM_TOLERANCE,
  vectorNorm,
  type EmbeddingConfiguration,
  type EmbeddingFailureClass,
} from "../src/index.js";

/**
 * The embedding boundary, proved offline (CQ-RAG-002 §47-§48, §51-§57).
 *
 * Nothing here needs Docker, a model download, a GPU or a network: the
 * deterministic fake and a scripted fetch prove the service, the validation
 * and every failure path. Only the live smoke can show that the real model
 * produces meaningful vectors, and that is a separate, explicit command.
 */

const PRIVATE = "EMBEDDING-PRIVATE-CONTENT-DO-NOT-LOG";

const TEI_CONFIG: EmbeddingConfiguration = EmbeddingConfigurationSchema.parse({
  ...QWEN3_EMBEDDING_CONFIGURATION,
  dimension: 4,
  maxDimension: 4,
  maxBatchItems: 3,
  // Roomy enough for an instructed query: the instruction prefix is part of
  // the input the runtime receives and counts against this bound.
  maxInputCharacters: 400,
  maxBatchCharacters: 800,
});

const unit4 = [0.5, 0.5, 0.5, 0.5];

/** A runtime that is simply not there. */
const refusingFetch: typeof globalThis.fetch = () =>
  Promise.reject(new Error("ECONNREFUSED"));

/** Records what was logged, so privacy assertions can read it. */
function recordingLogger() {
  const lines: unknown[] = [];
  const push = (fields: unknown, message: unknown) => {
    lines.push({ fields, message });
  };
  const logger = {
    debug: push,
    info: push,
    warn: push,
    error: push,
    child: () => logger,
  };
  return { logger, lines };
}

/** A fetch double that records requests and replies from a script. */
function scriptedFetch(
  responses: readonly {
    readonly status: number;
    readonly body: unknown;
    readonly delayMs?: number;
  }[],
) {
  const requests: {
    url: string;
    body: string;
    headers: Record<string, string>;
  }[] = [];
  let at = 0;
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: url instanceof Request ? url.url : url.toString(),
        body: typeof init?.body === "string" ? init.body : "",
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      const scripted = responses[Math.min(at, responses.length - 1)];
      at += 1;
      if (scripted === undefined) throw new Error("no scripted response");
      if (scripted.delayMs !== undefined) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, scripted.delayMs);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      return new Response(
        scripted.body === null ? "" : JSON.stringify(scripted.body),
        { status: scripted.status },
      );
    },
  );
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

function teiProvider(
  responses: Parameters<typeof scriptedFetch>[0],
  overrides: Partial<
    Parameters<typeof createLocalTeiEmbeddingProvider>[0]
  > = {},
) {
  const scripted = scriptedFetch(responses);
  const provider = createLocalTeiEmbeddingProvider({
    baseUrl: "http://127.0.0.1:8080",
    configuration: TEI_CONFIG,
    timeoutMs: 50,
    fetch: scripted.fetch,
    ...overrides,
  });
  return { provider, requests: scripted.requests };
}

describe("configuration identity", () => {
  it("keeps provider, model and configuration as three separate things", () => {
    expect(QWEN3_EMBEDDING_CONFIGURATION.providerCode).toBe("local-tei");
    expect(QWEN3_EMBEDDING_CONFIGURATION.modelCode).toBe(
      "Qwen/Qwen3-Embedding-0.6B",
    );
    expect(QWEN3_EMBEDDING_CONFIGURATION.modelFamily).toBe("qwen3-embedding");
    expect(QWEN3_EMBEDDING_CONFIGURATION.configurationVersion).toBe(
      "capital-q-qwen3-embedding-0-6b-1024-v1",
    );
    // The identity is never one magic string.
    expect(QWEN3_EMBEDDING_CONFIGURATION.modelCode).not.toBe(
      QWEN3_EMBEDDING_CONFIGURATION.configurationVersion,
    );
  });

  it("uses the model's native 1024 dimension and pins a revision", () => {
    expect(QWEN3_EMBEDDING_CONFIGURATION.dimension).toBe(1024);
    expect(QWEN3_EMBEDDING_CONFIGURATION.maxDimension).toBe(1024);
    // No Matryoshka truncation is adopted before it is evaluated.
    expect(QWEN3_EMBEDDING_CONFIGURATION.dimension).toBe(
      QWEN3_EMBEDDING_CONFIGURATION.maxDimension,
    );
    expect(QWEN3_EMBEDDING_MODEL_REVISION).toMatch(/^[0-9a-f]{40}$/);
    expect(QWEN3_EMBEDDING_CONFIGURATION.modelRevision).toBe(
      QWEN3_EMBEDDING_MODEL_REVISION,
    );
    expect(QWEN3_EMBEDDING_MODEL_CODE).toBe("Qwen/Qwen3-Embedding-0.6B");
  });

  it("declares normalised, query-instructed semantics and bounded inputs", () => {
    expect(QWEN3_EMBEDDING_CONFIGURATION.normalization).toBe("L2_UNIT");
    expect(QWEN3_EMBEDDING_CONFIGURATION.instructionStrategy).toBe(
      "QUERY_ONLY",
    );
    // A 32k-token model does not mean 32k-character chunks.
    expect(QWEN3_EMBEDDING_CONFIGURATION.maxInputCharacters).toBeLessThan(
      32_000,
    );
    expect(QWEN3_EMBEDDING_CONFIGURATION.maxBatchItems).toBeGreaterThan(1);
    // Characters, not tokens, so the bound holds whatever the tokeniser
    // does: an input this long can never tokenise past the runtime's
    // ceiling, which is what makes silent truncation unreachable.
    expect(
      QWEN3_EMBEDDING_CONFIGURATION.maxInputCharacters,
    ).toBeLessThanOrEqual(4_096);
  });

  it("registers exactly one versioned V1 query instruction, free of policy", () => {
    expect(EMBEDDING_QUERY_TASKS).toEqual(["EVIDENCE_RETRIEVAL"]);
    const profile = instructionFor("EVIDENCE_RETRIEVAL");
    expect(profile).toBe(EVIDENCE_RETRIEVAL_INSTRUCTION);
    expect(profile.instructionVersion).toBe("capital-q-evidence-retrieval-v1");
    expect(profile.instruction.length).toBeLessThan(200);
    // No permission, prompt, persona or tenant ever enters an instruction.
    for (const forbidden of [
      "tenant",
      "permission",
      "authoris",
      "authoriz",
      "system prompt",
      "founder_private",
    ]) {
      expect(profile.instruction.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("vector validation", () => {
  it("accepts a finite unit vector of the configured dimension", () => {
    expect(assertValidVector(unit4, TEI_CONFIG, "local-tei")).toEqual(unit4);
    expect(vectorNorm(unit4)).toBeCloseTo(1, 10);
  });

  it("refuses a wrong dimension and never resizes it", () => {
    const attempt = () =>
      assertValidVector([0.5, 0.5, 0.5], TEI_CONFIG, "local-tei");
    expect(attempt).toThrow(EmbeddingProviderFailure);
    expect(attempt).toThrow(/3 values where the configuration requires 4/);
    try {
      attempt();
    } catch (error: unknown) {
      expect((error as EmbeddingProviderFailure).failureClass).toBe(
        "INVALID_VECTOR",
      );
      expect((error as EmbeddingProviderFailure).retryable).toBe(false);
    }
  });

  it("refuses NaN, Infinity, empty and non-numeric vectors", () => {
    for (const bad of [
      [Number.NaN, 0.5, 0.5, 0.5],
      [Number.POSITIVE_INFINITY, 0.5, 0.5, 0.5],
      [],
      ["0.5", 0.5, 0.5, 0.5],
      "not a vector",
      null,
    ]) {
      expect(() => assertValidVector(bad, TEI_CONFIG, "local-tei")).toThrow(
        EmbeddingProviderFailure,
      );
    }
  });

  it("refuses an unnormalised vector under a normalised configuration", () => {
    expect(() =>
      assertValidVector([1, 1, 1, 1], TEI_CONFIG, "local-tei"),
    ).toThrow(/not unit length/);
    // Float32 wobble is fine; an unnormalised vector is not.
    const wobbly = unit4.map((v, at) =>
      at === 0 ? v + UNIT_NORM_TOLERANCE / 4 : v,
    );
    expect(() =>
      assertValidVector(wobbly, TEI_CONFIG, "local-tei"),
    ).not.toThrow();
  });

  it("allows a raw vector when the configuration does not promise unit length", () => {
    const raw = EmbeddingConfigurationSchema.parse({
      ...TEI_CONFIG,
      normalization: "RAW",
    });
    expect(assertValidVector([1, 1, 1, 1], raw, "local-tei")).toEqual([
      1, 1, 1, 1,
    ]);
  });
});

describe("local TEI adapter", () => {
  it("asks the runtime to normalise, never to truncate, and sends no credential", async () => {
    const { provider, requests } = teiProvider([
      { status: 200, body: [unit4] },
    ]);
    await provider.embedDocuments({ inputs: ["a passage"] });
    const [request] = requests;
    expect(request?.url).toBe("http://127.0.0.1:8080/embed");
    const body = JSON.parse(request?.body ?? "{}") as Record<string, unknown>;
    expect(body["normalize"]).toBe(true);
    // Silently dropping the end of financial evidence is worse than refusing.
    expect(body["truncate"]).toBe(false);
    expect(body["inputs"]).toEqual(["a passage"]);
    expect(
      Object.keys(request?.headers ?? {}).map((k) => k.toLowerCase()),
    ).toEqual(["content-type"]);
  });

  it("embeds documents without an instruction and queries with the versioned one", async () => {
    const documents = teiProvider([{ status: 200, body: [unit4] }]);
    const documentResult = await documents.provider.embedDocuments({
      inputs: ["Northstar is raising a seed round."],
    });
    const sentDocument = JSON.parse(documents.requests[0]?.body ?? "{}") as {
      inputs: string[];
    };
    // Qwen3 asks for no instruction on retrieval documents.
    expect(sentDocument.inputs[0]).toBe("Northstar is raising a seed round.");
    expect(documentResult.embeddings[0]?.instructionVersion).toBe(
      EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
    );

    const queries = teiProvider([{ status: 200, body: [unit4] }]);
    const queryResult = await queries.provider.embedQuery({
      query: "who is raising seed capital?",
      task: "EVIDENCE_RETRIEVAL",
    });
    const sentQuery = JSON.parse(queries.requests[0]?.body ?? "{}") as {
      inputs: string[];
    };
    expect(sentQuery.inputs[0]).toBe(
      `Instruct: ${EVIDENCE_RETRIEVAL_INSTRUCTION.instruction}\nQuery:who is raising seed capital?`,
    );
    expect(queryResult.instructionVersion).toBe(
      "capital-q-evidence-retrieval-v1",
    );
  });

  it("keeps batch order and refuses a count mismatch rather than mis-assigning", async () => {
    const ordered = teiProvider([
      {
        status: 200,
        body: [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
        ],
      },
    ]);
    const result = await ordered.provider.embedDocuments({
      inputs: ["first", "second", "third"],
    });
    expect(result.embeddings.map((e) => e.inputCharacters)).toEqual([5, 6, 5]);
    expect(result.embeddings[0]?.vector).toEqual([1, 0, 0, 0]);
    expect(result.embeddings[2]?.vector).toEqual([0, 0, 1, 0]);

    const short = teiProvider([{ status: 200, body: [unit4] }]);
    await expect(
      short.provider.embedDocuments({ inputs: ["a", "b"] }),
    ).rejects.toMatchObject({ failureClass: "INVALID_RESPONSE" });
  });

  it("refuses an oversized input or batch before a byte is sent", async () => {
    const big = teiProvider([{ status: 200, body: [unit4] }]);
    await expect(
      big.provider.embedDocuments({ inputs: ["x".repeat(401)] }),
    ).rejects.toMatchObject({ failureClass: "INPUT_TOO_LARGE" });
    await expect(
      big.provider.embedDocuments({ inputs: ["a", "b", "c", "d"] }),
    ).rejects.toMatchObject({ failureClass: "INPUT_TOO_LARGE" });
    // Nothing reached the runtime.
    expect(big.requests).toEqual([]);
  });

  it("maps the runtime's status codes to Capital Q's classes", async () => {
    const cases: readonly [number, EmbeddingFailureClass, boolean][] = [
      [413, "INPUT_TOO_LARGE", false],
      [422, "INPUT_TOO_LARGE", false],
      [429, "UNAVAILABLE", true],
      [424, "UNAVAILABLE", true],
      [503, "UNAVAILABLE", true],
      [500, "UNAVAILABLE", true],
      [404, "INVALID_RESPONSE", false],
    ];
    for (const [status, failureClass, retryable] of cases) {
      const { provider } = teiProvider([
        { status, body: { error: "runtime detail", error_type: "Validation" } },
      ]);
      await expect(
        provider.embedDocuments({ inputs: ["a"] }),
      ).rejects.toMatchObject({ failureClass });
      expect(isRetryableEmbeddingFailure(failureClass)).toBe(retryable);
    }
  });

  it("never lets the runtime's own error text escape", async () => {
    const { provider } = teiProvider([
      {
        status: 422,
        body: {
          error: `tokenizer failed on ${PRIVATE}`,
          error_type: "Tokenizer",
        },
      },
    ]);
    try {
      await provider.embedDocuments({ inputs: [PRIVATE] });
      expect.unreachable("the runtime refused the request");
    } catch (error: unknown) {
      const failure = error as EmbeddingProviderFailure;
      expect(failure.message).not.toContain(PRIVATE);
      // The stable token is kept for diagnostics; the message is not.
      expect(failure.runtimeErrorType).toBe("Tokenizer");
      expect(JSON.stringify({ ...failure })).not.toContain(PRIVATE);
    }
  });

  it("reports a timeout, a cancellation and an unreachable runtime differently", async () => {
    const slow = teiProvider([{ status: 200, body: [unit4], delayMs: 500 }]);
    await expect(
      slow.provider.embedDocuments({ inputs: ["a"] }),
    ).rejects.toMatchObject({ failureClass: "TIMEOUT" });

    const cancelled = teiProvider([
      { status: 200, body: [unit4], delayMs: 500 },
    ]);
    const controller = new AbortController();
    const pending = cancelled.provider.embedDocuments(
      { inputs: ["a"] },
      { signal: controller.signal, timeoutMs: 5_000 },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ failureClass: "CANCELLED" });

    const down = createLocalTeiEmbeddingProvider({
      baseUrl: "http://127.0.0.1:8080",
      configuration: TEI_CONFIG,
      timeoutMs: 50,
      fetch: refusingFetch,
    });
    await expect(down.embedDocuments({ inputs: ["a"] })).rejects.toMatchObject({
      failureClass: "UNAVAILABLE",
    });
  });

  it("refuses a response that is not JSON or not a vector array", async () => {
    const { provider } = teiProvider([{ status: 200, body: { ok: true } }]);
    await expect(
      provider.embedDocuments({ inputs: ["a"] }),
    ).rejects.toMatchObject({ failureClass: "INVALID_RESPONSE" });
  });

  it("reports health as a state and detects a model or revision mismatch", async () => {
    const healthy = createLocalTeiEmbeddingProvider({
      baseUrl: "http://127.0.0.1:8080",
      configuration: QWEN3_EMBEDDING_CONFIGURATION,
      timeoutMs: 50,
      fetch: scriptedFetch([
        {
          status: 200,
          body: {
            model_id: QWEN3_EMBEDDING_MODEL_CODE,
            model_sha: QWEN3_EMBEDDING_MODEL_REVISION,
            max_input_length: 32_768,
            version: "1.9.0",
          },
        },
      ]).fetch,
    });
    const health = await healthy.health();
    expect(health.state).toBe("READY");
    expect(health.reportedMaxInputTokens).toBe(32_768);
    expect(health.reportedModelRevision).toBe(QWEN3_EMBEDDING_MODEL_REVISION);
    expect(health.runtimeVersion).toBe("1.9.0");

    const wrongModel = createLocalTeiEmbeddingProvider({
      baseUrl: "http://127.0.0.1:8080",
      configuration: QWEN3_EMBEDDING_CONFIGURATION,
      timeoutMs: 50,
      fetch: scriptedFetch([
        {
          status: 200,
          body: { model_id: "someone-else/model", version: "1.9.0" },
        },
      ]).fetch,
    });
    expect((await wrongModel.health()).state).toBe("MISCONFIGURED");

    // A runtime that accepts fewer tokens than Capital Q would send could
    // truncate an input; that is a misconfiguration, not a working setup.
    const narrowRuntime = createLocalTeiEmbeddingProvider({
      baseUrl: "http://127.0.0.1:8080",
      configuration: QWEN3_EMBEDDING_CONFIGURATION,
      timeoutMs: 50,
      fetch: scriptedFetch([
        {
          status: 200,
          body: {
            model_id: QWEN3_EMBEDDING_MODEL_CODE,
            model_sha: QWEN3_EMBEDDING_MODEL_REVISION,
            max_input_length:
              QWEN3_EMBEDDING_CONFIGURATION.maxInputCharacters - 1,
          },
        },
      ]).fetch,
    });
    const narrow = await narrowRuntime.health();
    expect(narrow.state).toBe("MISCONFIGURED");
    expect(narrow.detail).toMatch(/could be truncated/);

    const wrongRevision = createLocalTeiEmbeddingProvider({
      baseUrl: "http://127.0.0.1:8080",
      configuration: QWEN3_EMBEDDING_CONFIGURATION,
      timeoutMs: 50,
      fetch: scriptedFetch([
        {
          status: 200,
          body: {
            model_id: QWEN3_EMBEDDING_MODEL_CODE,
            model_sha: "0".repeat(40),
          },
        },
      ]).fetch,
    });
    expect((await wrongRevision.health()).state).toBe("MISCONFIGURED");

    // An unreachable runtime is a reported state, never a thrown error.
    const down = createLocalTeiEmbeddingProvider({
      baseUrl: "http://127.0.0.1:8080",
      configuration: QWEN3_EMBEDDING_CONFIGURATION,
      timeoutMs: 20,
      fetch: refusingFetch,
    });
    const downHealth = await down.health();
    expect(downHealth.state).toBe("UNAVAILABLE");
    expect(downHealth.detail).not.toContain("ECONNREFUSED");
  });
});

describe("embedding service", () => {
  it("splits a long list into bounded batches and keeps caller order", async () => {
    const provider = createFakeEmbeddingProvider();
    const service = createEmbeddingService({ provider });
    const inputs = Array.from(
      { length: 20 },
      (_v, at) => `chunk ${String(at)}`,
    );
    const result = await service.embedDocuments(inputs);
    expect(result.embeddings).toHaveLength(20);
    expect(provider.calls()).toBe(20);
    expect(provider.inputs).toEqual(inputs);
    // Order is the caller's, across batch boundaries.
    expect(result.embeddings.map((e) => e.inputCharacters)).toEqual(
      inputs.map((i) => i.length),
    );
    for (const [at, embedding] of result.embeddings.entries()) {
      expect(embedding.vector).toEqual(
        deterministicVector(
          inputs[at] ?? "",
          FAKE_EMBEDDING_CONFIGURATION.dimension,
        ),
      );
    }
  });

  it("fails the whole call when one batch fails, rather than reporting a gap", async () => {
    const provider = createFakeEmbeddingProvider();
    const service = createEmbeddingService({ provider });
    provider.setBehaviour({ kind: "FAILURE", failureClass: "UNAVAILABLE" });
    await expect(service.embedDocuments(["a", "b"])).rejects.toMatchObject({
      failureClass: "UNAVAILABLE",
    });
  });

  it("embeds nothing for an empty list without calling the runtime", async () => {
    const provider = createFakeEmbeddingProvider();
    const service = createEmbeddingService({ provider });
    expect(await service.embedDocuments([])).toEqual({
      embeddings: [],
      batchSize: 0,
      latencyMs: 0,
    });
    expect(provider.calls()).toBe(0);
  });

  it("propagates cancellation and stops waiting", async () => {
    const provider = createFakeEmbeddingProvider({
      behaviour: { kind: "DELAY", delayMs: 5_000 },
    });
    const service = createEmbeddingService({ provider });
    const controller = new AbortController();
    const pending = service.embedDocuments(["a"], {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ failureClass: "CANCELLED" });
  });
});

describe("privacy", () => {
  it("keeps the embedded text out of results, errors and logs", async () => {
    const { logger, lines } = recordingLogger();
    const provider = createFakeEmbeddingProvider();
    const service = createEmbeddingService({ provider, logger });
    const result = await service.embedDocuments([`revenue is 4m ${PRIVATE}`]);
    const embedding = result.embeddings[0];

    // The provider had to receive the text; nothing else did.
    expect(provider.inputs[0]).toContain(PRIVATE);
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
    expect(embedding?.inputSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(embedding ?? {})).not.toContain("text");
    expect(Object.keys(embedding ?? {})).not.toContain("input");

    provider.setBehaviour({ kind: "FAILURE", failureClass: "UNAVAILABLE" });
    await expect(
      service.embedDocuments([`${PRIVATE} again`]),
    ).rejects.toThrow();
    const logged = JSON.stringify(lines);
    expect(logged).not.toContain(PRIVATE);
    // The failure class is what a log line is for.
    expect(logged).toContain("UNAVAILABLE");
  });

  it("returns the vector to the caller and puts it in nothing else", async () => {
    const { logger, lines } = recordingLogger();
    const provider = createFakeEmbeddingProvider();
    const service = createEmbeddingService({ provider, logger });
    const result = await service.embedQuery("a question", "EVIDENCE_RETRIEVAL");
    expect(result.vector).toHaveLength(FAKE_EMBEDDING_CONFIGURATION.dimension);
    // A vector is derived sensitive data: never a log field, never a metric.
    const first = result.vector[0] ?? 0;
    expect(JSON.stringify(lines)).not.toContain(String(first));
  });
});

describe("work identity", () => {
  it("is deterministic in content, model, dimension and instruction", () => {
    const base = {
      contentSha256: "a".repeat(64),
      modelCode: QWEN3_EMBEDDING_MODEL_CODE,
      dimension: 1024,
      instructionVersion: EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
    };
    expect(embeddingWorkKey(base)).toBe(embeddingWorkKey({ ...base }));
    expect(embeddingWorkKey(base)).toMatch(/^[0-9a-f]{64}$/);
    for (const changed of [
      { ...base, contentSha256: "b".repeat(64) },
      { ...base, modelCode: "other/model" },
      { ...base, dimension: 512 },
      { ...base, instructionVersion: "capital-q-evidence-retrieval-v1" },
    ]) {
      expect(embeddingWorkKey(changed)).not.toBe(embeddingWorkKey(base));
    }
  });

  it("carries no tenant, so it can never be a shared cross-tenant cache key", () => {
    const identity = {
      contentSha256: "c".repeat(64),
      modelCode: QWEN3_EMBEDDING_MODEL_CODE,
      dimension: 1024,
      instructionVersion: EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
    };
    // Two tenants holding identical text compute the same work key: that is
    // why storage must scope by tenant and this value must never address a
    // shared store on its own.
    expect(embeddingWorkKey(identity)).toBe(embeddingWorkKey(identity));
    expect(Object.keys(identity)).not.toContain("tenantId");
    expect(embeddingWorkKey(identity)).not.toContain("tenant");
  });
});

describe("similarity", () => {
  it("scores identical text at 1 and is symmetric", () => {
    const a = deterministicVector("northstar systems", 8);
    const b = deterministicVector("northstar systems", 8);
    const c = deterministicVector("cocoa exporter", 8);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
    expect(cosineSimilarity(a, c)).toBeCloseTo(cosineSimilarity(c, a), 12);
    // The fake's vectors are a hash expansion and carry no meaning; only the
    // live model can show that a relevant passage outranks an unrelated one.
    expect(Math.abs(cosineSimilarity(a, c))).toBeLessThan(1);
  });

  it("refuses vectors of different lengths", () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(TypeError);
  });
});
