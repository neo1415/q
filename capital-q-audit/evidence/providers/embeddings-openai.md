# OpenAI embeddings outside the gateway

Why included: Direct fetch to OpenAI embeddings; no routing policy/eligibility/ledger.

## `packages/q-embeddings/src/infrastructure/openai-provider.ts` lines 18-60

```ts
   18
   19  /**
   20   * The hosted OpenAI embeddings adapter (Q.02, 2026-10-07).
   21   *
   22   * Why it exists: the self-hosted TEI runtime (Qwen3-Embedding-0.6B) needs
   23   * ~3-4 GB and the Railway plan caps a service at 1 GB, so it was removed
   24   * on 2026-09-24 and every hosted company and mandate stayed vectorless
   25   * (0 embeddings): semantic fit was silently absent from every slate. The
   26   * lead's note then named this as the option: OpenAI embeddings at the
   27   * table's fixed 1024 dimensions.
   28   *
   29   * Provider eligibility: OpenAI is already the Model Gateway's primary
   30   * reviewed provider for CONFIDENTIAL work (deck reading). What is sent is
   31   * (a) a company's investor-visible representation and (b) an investor's
   32   * own mandate representation, never a founder-private field (the
   33   * representation builders' contract). Like TEI, nothing here logs or
   34   * echoes the input; only failure classes and counts leave this file.
   35   *
   36   * A different provider is a different configuration version, so vectors
   37   * from the two never mix in one search (the store keys every vector by
   38   * configuration and instruction version).
   39   */
   40
   41  export const OPENAI_EMBEDDING_PROVIDER_CODE = "openai" as const;
   42  const PROVIDER = OPENAI_EMBEDDING_PROVIDER_CODE;
   43  const ENDPOINT = "https://api.openai.com/v1/embeddings";
   44
   45  export const OPENAI_TE3_SMALL_1024_CONFIGURATION: EmbeddingConfiguration =
   46    EmbeddingConfigurationSchema.parse({
   47      configurationVersion: "capital-q-openai-te3-small-1024-v1",
   48      providerCode: PROVIDER,
   49      runtime: "HOSTED_API",
   50      modelCode: "text-embedding-3-small",
   51      modelFamily: "openai-text-embedding-3",
   52      // A hosted model reports no weights revision.
   53      modelRevision: null,
   54      // The recommendation tables hold vector(1024); the model's native size
   55      // is 1536 and the API shortens (and re-normalises) on request.
   56      dimension: 1024,
   57      maxDimension: 1536,
   58      normalization: "L2_UNIT",
   59      instructionStrategy: "QUERY_ONLY",
   60      // Far under the model's 8,191-token limit (a token is never shorter
```

## `packages/config/src/embeddings.ts` lines 20-40

```ts
   20   * quiet addition here.
   21   */
   22
   23  /**
   24   * `openai` (Q.02, 2026-10-07): the hosted adapter, because the TEI runtime
   25   * does not fit the hosting plan. It reuses the reviewed OpenAI model-provider
   26   * key the composition root already holds (OPENAI_API_KEY); this file still
   27   * holds no secret. Selecting it is an explicit operator choice.
   28   */
   29  export const EMBEDDING_PROVIDERS = ["local-tei", "openai"] as const;
   30  export type EmbeddingProviderSetting = (typeof EMBEDDING_PROVIDERS)[number];
   31
   32  export const EMBEDDING_ENV_NAMES = [
   33    "Q_EMBEDDING_PROVIDER",
   34    "Q_EMBEDDING_BASE_URL",
   35    "Q_EMBEDDING_TIMEOUT_MS",
   36    "Q_EMBEDDING_MAX_BATCH_ITEMS",
   37  ] as const;
   38
   39  /** The laptop runtime. A default only when CAPITAL_Q_ENV is local. */
   40  const LOCAL_BASE_URL = "http://127.0.0.1:8080";
```
