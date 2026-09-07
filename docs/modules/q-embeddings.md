# Embeddings module (`@capital-q/q-embeddings`, CQ-RAG-002)

**Purpose.** One replaceable boundary between Capital Q and whatever
produces embedding vectors, and a local open-weight runtime behind it. The
V1 implementation runs `Qwen/Qwen3-Embedding-0.6B` on this machine through
Hugging Face Text Embeddings Inference: no account, no API key, no paid
service, and no confidential document text leaving Capital Q's own
infrastructure.

```
embedding ≠ evidence ≠ claim ≠ knowledge ≠ company truth
embedding ≠ permission;   vector ≠ public;   provider ≠ model ≠ configuration
```

Sources: doc 14 §15 (embedding architecture, Qwen3 candidate), §115
(retrieval configuration version), §119-§122 (versioning derived layers),
doc 15 §20-§21 (derived sensitivity), doc 16 (supply chain), doc 21
(deployment), CQ-RAG-001 (the chunks this embeds).

## Free-first, and why it is also the private option

Capital Q embeds confidential founder and investor material. A hosted
embedding API would mean that text leaving this infrastructure on every
ingestion run, for a capability an open-weight 0.6B model provides locally
at zero marginal cost. So the local runtime is not a budget compromise
standing in for a "real" provider; it is the better answer on privacy, and
the cost of $0 follows from it.

A hosted provider can be added later behind the same `EmbeddingProvider`
port. That is a decision with a privacy review attached, not a fallback:
when the local runtime is down, embedding work waits. Availability never
justifies sending private text somewhere else.

## Three identities, never one string

| Concept              | V1 value                                                |
| -------------------- | ------------------------------------------------------- |
| Provider             | `local-tei`                                             |
| Model                | `Qwen/Qwen3-Embedding-0.6B`                             |
| Model revision       | `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`              |
| Configuration        | `capital-q-qwen3-embedding-0-6b-1024-v1`                |
| Dimension            | 1024 (the model's native maximum)                       |
| Normalization        | `L2_UNIT`, produced by the runtime, never applied twice |
| Instruction strategy | `QUERY_ONLY`                                            |
| Query instruction    | `capital-q-evidence-retrieval-v1`                       |
| Document instruction | `none-v1` (a canonical marker, not an instruction)      |

Vectors from two configuration versions are never comparable, so every
result carries the version that produced it. The dimension lives here, in
embedding configuration, and never in the chunk schema.

**Why 1024 and not a Matryoshka truncation.** The model supports 32 to 1024
dimensions, and doc 14 asks for dimensional truncation to be evaluated
before adoption. This packet has no retrieval quality baseline to evaluate
it against, so V1 uses the native dimension and leaves the smaller ones to a
measured decision after CQ-RAG-004.

## Documents and queries are embedded differently

Qwen3 embedding models are instruction-aware for queries and explicitly ask
for no instruction on retrieval documents. Capital Q preserves that
distinction exactly:

```
document → the chunk's canonical text, unchanged
query    → Instruct: {task description}\nQuery:{query}
```

That format is built inside the adapter and nowhere else. Application code
passes an `EmbeddingTask`, never a prompt string, so changing the wording is
a versioned change in one place rather than a search across the codebase.

The V1 instruction is one sentence describing the retrieval task. It
contains no tenant, no permission, no policy, no system prompt and no Q
personality: authorisation happens long before and long after this string,
never inside an embedding model.

## The provider port

```ts
type EmbeddingProvider = {
  code: EmbeddingProviderCode;
  describe(): EmbeddingProviderDescriptor;
  embedDocuments(request, context?): Promise<EmbeddingBatchResult>;
  embedQuery(request, context?): Promise<EmbeddingResult>;
  health(context?): Promise<EmbeddingProviderHealth>;
};
```

Capital Q depends on this interface. It does not depend on TEI's HTTP shape,
on a Python inference library, on SentenceTransformers or on a model
implementation, and no TEI field, status code or error string escapes the
adapter. Two implementations exist: the local TEI adapter, and a
deterministic fake for tests.

A result carries the vector, the dimension, the provider, the model, the
revision, the configuration version, the instruction version, a SHA-256 of
the input, its character count and the latency. It never carries the text,
the raw runtime payload or any server internal.

## What is validated, and what is never repaired

Every vector crossing the boundary is checked for the configured dimension,
finite values, and unit length when the configuration promises it. Nothing
is repaired: a short vector is never padded, a long one never truncated, a
raw one never normalised behind the configuration's back. A dimension
disagreement means the runtime is serving something other than what the
configuration describes, and that is a failure, not a resize.

Failure classes: `UNAVAILABLE`, `TIMEOUT`, `CANCELLED`, `INVALID_VECTOR`,
`INPUT_TOO_LARGE`, `MODEL_MISMATCH`, `CONFIGURATION_ERROR`,
`INVALID_RESPONSE`. Only the first two are retryable; retrying an invalid
dimension forever is how a worker loop becomes a load problem.

## Bounds, and why the input cap is in characters

| Bound                | Value        | Why                                                                                                 |
| -------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| Max input characters | 4,000        | Provably under the runtime's 4,096-token ceiling, because a token is never shorter than a character |
| Max batch items      | 16           | Bounded request, bounded memory on a development machine                                            |
| Max batch characters | 64,000       | One request stays small enough to cancel cheaply                                                    |
| Timeout              | 60 s default | Long enough for a cold CPU model, short enough that a stuck runtime does not hold a worker          |

**Nothing is ever silently shortened, and the guarantee is enforced rather
than assumed.** TEI truncates inputs that exceed the model's supported size
by default, and that ceiling follows the batch-token budget. The bound above
is therefore expressed in characters and set at or below the runtime's
reported token ceiling: since a token can never be shorter than one
character, an input Capital Q accepts can never tokenise past the size at
which the runtime would truncate it. The health check compares the two on
every call and reports `MISCONFIGURED` if the relationship is ever broken,
so raising one number without the other is caught rather than discovered
later as a missing paragraph of a financial document.

An input above the cap is refused with `INPUT_TOO_LARGE` before a byte is
sent. An input the runtime cannot fit in a batch comes back as a refusal
too. Both are visible; neither loses the end of a document.

## Privacy and derived sensitivity

- The local runtime receives the text because it must embed it. Nothing else
  does: no request body, error, metric or log line built here contains the
  input, and results carry a hash instead.
- **A vector inherits the sensitivity and ownership of what it was derived
  from.** It is not public because it is numeric; embeddings leak
  information about their source. Vectors are never logged, never put in a
  public API, never serialised into run events and never sent to analytics.
  CQ-RAG-003 stores them under the same tenancy and sensitivity as the
  chunk.
- Metrics carry small fixed dimensions only: provider, model, configuration,
  kind and failure class. Never a tenant, a document or a query.
- The configured endpoint must be loopback or a private-network host. A
  public address is a configuration error, checked where a typo would
  otherwise create the exposure.

## Work identity, and why it is not a cache key

```
work key = sha256(content hash + model + dimension + instruction version)
```

This identifies work, not ownership: it deliberately carries no tenant.
Two tenants holding identical text compute the same key, which is exactly
why storage scopes rows by tenant and why this value must never address a
shared store on its own. Doing so would let one tenant learn that another
embedded the same secret. There is no cache in this packet.

## Supply chain

The model is public and ungated, Apache 2.0, distributed as safetensors, and
its repository contains no Python at all, so there is nothing to execute and
no `trust_remote_code` decision to make. TEI implements the architecture
natively in Rust; it reads weights and tokenizer configuration and runs no
model-repository code. The container image and the model revision are both
pinned, and the runtime's reported `model_sha` is checked against the pinned
revision on every health check: a runtime serving different weights under
the same name reports `MISCONFIGURED`.

## Local runtime

```bash
pnpm embedding:up        # start; the first run downloads ~1.2 GB of weights
pnpm embedding:health    # what is it serving?
pnpm rag:embedding:smoke # embed synthetic fixtures and rank them
pnpm embedding:logs
pnpm embedding:down      # stop; the model cache survives
```

`infra/embeddings/docker-compose.yml` binds the runtime to loopback only,
keeps weights in a named volume outside source control, and sets
conservative CPU-friendly limits. Set `CQ_EMBEDDING_HOST_PORT` if 8080 is
taken on your machine. Model weights are never committed and never copied
into an application image.

**What the CPU profile actually costs.** TEI runs a full forward pass at
`--max-batch-tokens` when it starts, and attention cost grows with the
square of that number. At 8,192 tokens warmup needed about 12 GB and was
killed by a smaller container limit, which looks exactly like a clean exit
and a restart loop; at 4,096 it warms up in roughly four minutes and
settles at about 2.5 GB. That budget is the reason the input cap is 4,000
characters. Raising it is a memory and hardware decision, not a
configuration preference: a GPU image, or a machine with more headroom,
allows a larger budget and therefore a larger cap.

A GPU is not required and CUDA is not installed by this packet. On
compatible NVIDIA hardware a GPU TEI image can be substituted; that is an
optional acceleration, not an architectural requirement.

## Configuration

All non-secret. There is no embedding credential of any kind.

| Variable                      | Default                 | Meaning                                                        |
| ----------------------------- | ----------------------- | -------------------------------------------------------------- |
| `Q_EMBEDDING_PROVIDER`        | `local-tei`             | Which adapter to compose                                       |
| `Q_EMBEDDING_BASE_URL`        | `http://127.0.0.1:8080` | Where the private runtime listens; must be loopback or private |
| `Q_EMBEDDING_TIMEOUT_MS`      | `60000`                 | One request's ceiling                                          |
| `Q_EMBEDDING_MAX_BATCH_ITEMS` | `16`                    | Items per request                                              |

## Degraded behaviour

An unreachable runtime is a reported health state, not a thrown error, and
never a reason to start Capital Q's other services in a broken state. When
embedding is down, embedding work waits and retrieval capability is
degraded; a person eventually sees plain English along the lines of "search
intelligence is temporarily unavailable", never a container id, a
filesystem path or a Rust panic.

## Tests

`pnpm test` needs no Docker, no model, no GPU and no network: the
deterministic fake and a scripted fetch prove the service, batching, order,
cancellation, timeouts, status mapping, vector validation and the privacy
markers. The live model is exercised only by `pnpm rag:embedding:smoke`,
which is explicit and separate. CI never downloads a 1.2 GB model.

## Boundaries

This package persists nothing, authorises nothing and retrieves nothing. No
pgvector extension, column, index or nearest-neighbour query exists yet; no
full-text search, no RRF, no reranker. Q does not call an embedding provider
from a graph node — retrieval infrastructure will own query embeddings, and
this port stays reusable outside the orchestrator.

## Known limitations

- On this CPU profile the input cap is 4,000 characters. Capital Q's
  largest configured chunks (parent blocks, up to ~1,200 tokens, roughly
  4,800 characters) can exceed it and would be refused with
  `INPUT_TOO_LARGE` rather than embedded. Raising `--max-batch-tokens` and
  the cap together, on hardware that can warm it up, is the fix; CQ-RAG-003
  should confirm the pairing before embedding production chunk sets.
- Embedding is CPU-bound here: about 1.1-1.5 s per document and ~1 s per
  query. That is fine for ingestion and for a development query path, and
  it is not a production latency budget.
- TEI has no ONNX build of this model, so the ORT backend is tried and
  fails at startup before the Candle backend loads the safetensors. The
  startup log records that as an error; it is expected and harmless.
- The runtime's warmup is not incremental: a cold start is minutes, and a
  container memory limit below the warmup peak kills it silently.

## Where the vectors go

CQ-RAG-003 stores them in `q_knowledge.embeddings` as native pgvector, keyed
by the work identity this package defines, with the configuration version
recorded on every row so two vector spaces are never compared. See
`docs/modules/q-knowledge.md`.

## Where a query goes

CQ-RAG-004 embeds the person's question here, under
`capital-q-evidence-retrieval-v1`, and searches only what the Context
Firewall authorised. If this runtime is unavailable there is no external
fallback: retrieval degrades to Postgres full-text search rather than
sending a private evidence query to a provider nobody approved.

## Deferrals

FTS + hybrid RRF → CQ-RAG-004 · reranking → benchmarked only
after an RRF baseline shows it adds value; the Qwen reranker family is
deliberately not downloaded · claims and evidence intelligence →
CQ-KNW-001 · Q Knowledge → CQ-KNW-002 · contradictions and revisions →
CQ-KNW-003 · Company Intelligence → CQ-Q-020.
