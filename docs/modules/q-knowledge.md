# Q Knowledge module (`@capital-q/q-knowledge`, CQ-RAG-001)

**Purpose.** The deterministic, provenance-preserving textual substrate for
retrieval: structure-aware chunks derived from governed document
extractions, versioned, owned, governed and rebuildable. No embedding, no
vector index, no retrieval, no model call and no knowledge object live here
yet; each is a later packet over the same rows.

```
source ≠ document ≠ document version ≠ extraction ≠ chunk
chunk ≠ evidence item ≠ claim ≠ Q knowledge ≠ canonical company fact
embedding ≠ chunk;  parsed text ≠ verified truth;  uploaded document ≠ instruction
```

Sources: doc 13 §41.1, doc 14 §7-§14, §119-§122, doc 15 §20-§21, §26-§30,
doc 16 TM-FILE, doc 24 (ingestion evals), CQ-EVD-001..003 (what is reused),
ADR-001 (visibility vocabulary).

## What CQ-EVD-003 owns and this packet reuses

Source registration, logical documents, immutable versions, secure upload,
the processing job and queue, the malware gate, the parser sandbox, the
`ContentExtractor` registry (PDF, DOCX, PPTX, text), the typed
`ExtractedBlock` artifact with page, slide, section and line locators, the
immutable `evidence.document_extractions` provenance row and the
instruction-risk scanner. Nothing of that is duplicated. CQ-RAG-001 adds two
extractors through the same boundary (XLSX, CSV), one block kind
(`spreadsheet_range`) with sheet/range/row locators, and the chunk layer.

## Every chunk can answer

| Question                                        | Column                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Which tenant owns me?                           | `tenant_id` (direct, indexed, composite foreign keys all the way down)                                      |
| Which source / document / version / extraction? | set: `source_id` (when registered), `document_id`, `document_version_id`, `extraction_id`                   |
| Which subject?                                  | `subject_type` = `COMPANY`, `subject_id` (through the Evidence subject registry)                            |
| Which parser and version?                       | set: `extractor_id`, `extractor_version`                                                                    |
| Which chunker and version?                      | set: `chunking_strategy`, `chunking_version` (`q-chunking-v1`)                                              |
| Where in the file?                              | `locator`: page range, slide and title, heading path, section range, line range, sheet, A1 range, row range |
| Which parent?                                   | `parent_chunk_id` (same set, same tenant, enforced by foreign key)                                          |
| What is my hash?                                | `content_sha256`                                                                                            |
| What visibility and sensitivity?                | inherited from the extraction, checked never to widen or weaken                                             |
| Am I active?                                    | `status` ACTIVE / SUPERSEDED / REVOKED, `invalidated_at`                                                    |
| Can I be rebuilt?                               | yes, from the recorded artifact, under any chunking version                                                 |

## Chunking strategies (`q-chunking-v1`)

Selected by what the extractor found; never one splitter for everything.

- **slide** (PPTX): one leaf per slide with slide number and title. A slide
  past the parent bound becomes a parent with sentence-packed children.
- **narrative** (DOCX, PDF, text): heading-aware sections with the heading
  path recorded. A section within the leaf bound is one leaf and keeps its
  heading. A longer section becomes parent windows (about 1,200 estimated
  tokens) of coherent blocks with sentence-packed children (target 500,
  max 800) and a one-sentence overlap (10% of the target) between
  consecutive prose children. Tables and lists are never cut unless a
  single one exceeds the leaf bound, in which case a table is cut by rows
  with its first row repeated and a list by items.
- **spreadsheet** (XLSX, CSV): one leaf per range window, rendered as
  `Sheet`, `Range`, `Columns` and one `Row N "label": col = value; …` line
  per row. A labelled first row at the top of a sheet, or a mostly-textual
  first row, is read as column labels; the first cell of a row is read as
  its label when textual. Values are the cached text of the cell. No
  formula is evaluated and no financial meaning is attached.
- **mixed**: more than one of the above in one document; chunks are ordered
  by block position.

Sizes follow doc 14 §12 in a provider-neutral estimate (four characters per
token, stored as an estimate, never a billing count). Structure wins over
the numbers.

## Lifecycle

A **chunk set** is the unit: one per (document version, extraction, chunking
version), `UNIQUE`. Building the same identity again returns the existing
set. A newer chunking version, a newer extraction or a newer document
version creates a new set and moves the previous ACTIVE set and its chunks
to SUPERSEDED with a reason. Only the document's current version, while the
document is ACTIVE, yields an ACTIVE set; anything else is SUPERSEDED at
birth (`NOT_CURRENT_VERSION`, `DOCUMENT_ARCHIVED`). At most one ACTIVE set
per document is enforced by a partial unique index. Revoking a document or
source moves every set to REVOKED; a later rebuild finds the revoked set
and does not reactivate it. Content, provenance and placement are
immutable by trigger; only lifecycle columns change; an ACTIVE row cannot be
deleted, a non-active one may be purged as rebuildable derived data.

## Pipeline placement

```
… → isolated parse → extraction recorded → chunk set built → run completed (chunking_version) → evidence.document.ready
```

The worker passes the validated parser blocks straight into
`buildChunkSet`; nothing is re-read from storage. A chunking failure retries
the attempt (`CHUNKING_FAILED`) with the extraction already recorded; the
build is idempotent, so the retry finds or finishes the set. The run's
provenance gains `chunking_version` and count/strategy metadata; no chunk
text reaches the run, the log or the event. No chunk event is emitted;
`evidence.document.ready` remains the completion signal.

## Security

- Tables are server-only: RLS enabled, no policy, schema revoked from
  `public`; the pgTAP suite proves anonymous, signed-in and cross-tenant
  reads fail with `42501`. RLS does not replace the Context Firewall and the
  firewall does not replace RLS.
- No raw chunk API exists and none is planned; Q receives no chunk search.
- Derived governance: `assertInherits` refuses a set that would be more
  visible or less sensitive than its extraction, which inherits from the
  document.
- Document text is data: the instruction-shaped line in the synthetic deck
  is carried verbatim, counted in `instruction_risk_signals`, and obeyed by
  nothing.
- Spreadsheets are static reads of cached values; a package carrying a VBA
  project is refused; sheet, row, column and cell limits bound the parse.
- Logs carry ids, versions, counts and durations only.

## Commands

```bash
pnpm rag:extract-smoke -- --builtin deck
```

Runs one synthetic fixture (`deck`, `report`, `model`, `customers`, `notes`,
`memo`) or a path through the real parser sandbox and the chunker and prints
a safe summary. Excerpts are shown only for the built-in synthetic fixtures
or with `--show-text`.

```bash
pnpm rag:rebuild-chunks -- --tenant <id> --document-version <id> [--chunking-version q-chunking-v2] [--list]
```

Operator rebuild over the worker's credentials against the local stack:
reads the recorded artifact, verifies its hash, derives a set. An identical
rebuild is a no-op by design.

## The semantic index (CQ-RAG-003)

`q_knowledge.embeddings` stores one vector per chunk per embedding
configuration, in native pgvector at the store's physical dimension of 1024.
It is a disposable derived index: rebuildable from the chunk, replaceable by
another model, and never consulted for whether anyone may see anything.

| Field                                           | Why                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `tenant_id`                                     | Direct, and constrained by composite foreign key to equal the chunk's tenant    |
| `chunk_id`                                      | The provenance; `ON DELETE CASCADE`, so a purged chunk takes its vectors        |
| `provider_code`, `model_code`, `model_revision` | Which runtime and which weights produced it                                     |
| `configuration_version`                         | Which vector space it belongs to                                                |
| `instruction_version`                           | `none-v1` for documents: no query instruction was applied                       |
| `embedding_dimension`                           | Checked against `vector_dims(embedding)`, so metadata cannot drift from payload |

**Tenant ownership is DIRECT, not derived through the chunk.** Every semantic
query filters by tenant on the same table it orders by distance; reaching
tenancy through a join is exactly how a security predicate ends up applied
after an index scan instead of before it. The composite foreign key
`(chunk_id, tenant_id) → chunks(id, tenant_id)` makes a disagreeing tenant
impossible to insert, so the denormalised column can never become a second,
wrong answer.

**The model identity lives on the row, not in `ai_ops.models`.** That
catalogue is the Model Gateway's: it carries pricing, routing policies,
eligibility, context windows and a `NOT NULL max_output_tokens`, none of
which mean anything for a local embedding runtime, and the gateway loads it
for routing. Putting an embedding model there would mean inventing
generation facts and placing a non-generation model inside the routing
catalogue. `model_type = 'EMBEDDING'` exists in that vocabulary and a future
packet may revisit this; today the self-describing row keeps historical
embeddings attributable without either cost.

### Work identity and coexistence

The unique key is `(chunk_id, model_code, embedding_dimension,
configuration_version, instruction_version)` — the work identity of doc 14
§14, with the content hash reached through the chunk, whose content is
immutable. A retried worker collides on it instead of writing a second
vector; a concurrent duplicate loses the race. Deliberately **not**
`UNIQUE(chunk_id)`: several models must be able to embed the same chunk at
once, which is what makes a model migration a backfill rather than a
rewrite.

Migrating models is therefore: register configuration B, backfill B,
evaluate, switch the retrieval configuration, and retire A later if ever.
A is never deleted when B arrives, and nothing about the source, the
document or the chunk changes at any point. A model with a **different
dimension** needs its own physical store, because one `vector(N)` column has
one dimension; that is an additive migration next to this table, not a
looser column here.

### Lifecycle: read from the chunk, never invented

Embeddings have no status of their own. Eligibility is the chunk's
`status = 'ACTIVE'`, joined at query time, so revoking a source revokes its
vectors in the same instant with nothing to keep in sync and nothing to
forget. The row survives for provenance and rebuild; only eligibility
changes. Purging a non-active chunk cascades its vectors away.

### Internal candidate generation

`SemanticSearchPort.search` takes a typed scope — tenant, configuration
version, dimension, query vector, bounded K, optional subjects, optional
disclosure scopes — and returns bounded candidates. There is no raw SQL, no
operator, no table name, no tenant override and no "include private" escape,
and the query vector is bound as a parameter and cast, never interpolated.

It is candidate generation, not retrieval and not authorisation:

- **The nearest vector is not an authorised vector.** Every test that matters
  here puts the mathematically closest chunk out of scope and checks it stays
  out: another tenant's, a founder-private one in a network-visible search,
  one embedded in another vector space, one whose chunk was revoked.
- A query vector is not a token. Asking a similar question grants nothing.
- Distance is cosine distance, lower is nearer; `similarity` is `1 -
distance`. Neither is a confidence, a quality, a fit or an investment
  score, and neither is exposed to anyone.
- K is bounded at 100, and a zero, negative, fractional or oversized K is
  refused rather than silently clamped.

Vectors are never selected back out of the store. Nothing above the
infrastructure layer needs one, and a vector that never leaves the database
cannot be logged or serialised by accident.

### Exact search, and why there is no HNSW yet

Measured locally on this machine, one tenant, one configuration, K = 5:

| Active rows | Search (client) | Postgres execution | Table + index size |
| ----------- | --------------- | ------------------ | ------------------ |
| 504         | 59 ms           | 8.8 ms             | 8.4 MB             |
| 2,004       | 50 ms           | 38 ms              | 19 MB              |
| 10,004      | 208 ms          | 126 ms             | 71 MB              |
| 25,004      | 434 ms          | 258 ms             | 144 MB             |

The size column is `pg_total_relation_size` measured across one sequence of
runs, so it carries the dead tuples the earlier rolled-back rows left behind;
a single clean run at 2,004 rows measures 11 MB. Read the column as an upper
bound on growth, not as bytes per row.

Exact search is linear, around 10 µs per row, and the plan is a hash join
feeding a top-N heapsort. **HNSW is deferred**, on that evidence: at the
volumes a tenant holds today exact search costs tens of milliseconds, and an
approximate index is a recall problem precisely where the filters are most
selective — tenant, configuration and active status are all highly
selective, which is the case where HNSW returns fewer eligible rows than
asked for. Revisit when one tenant's active chunks under one configuration
approach ~10,000; the mitigation to evaluate then is pgvector 0.8's
iterative index scans or candidate overfetch, and never a loosened filter.

**Statistics matter more than the index here.** A table bulk-loaded and
queried immediately has none, and the planner's default guess of one row
produces a nested loop that is quadratic in the row count: the same query
that runs in 20 ms took 898 ms at 2,000 rows and exceeded the statement
timeout at 10,000. Run `ANALYZE` after a large backfill.

### Commands

```bash
pnpm rag:embed:backfill -- --limit 50 [--tenant <id>] [--fake]
pnpm rag:semantic:smoke -- --k 5 [--rows 2000] [--fake]
```

The backfill embeds active chunks that have no vector under the current
configuration, bounded per call so a worker resumes rather than restarts.
The smoke seeds a synthetic tenant, embeds it with the real local model,
searches, prints ranked candidates with their locators and distances, shows
the query plan and rolls everything back. Neither is an HTTP endpoint;
neither prints a vector.

## Authorised hybrid retrieval (CQ-RAG-004)

One question, asked by one person, in one organisation, about one subject,
answered from source material they are allowed to read.

```
plan (Context Firewall) -> envelope -> lexical AND semantic, each already
constrained in SQL -> RRF -> authorised hydration -> authorised expansion
-> bounded assembly -> model
```

**Authorisation before similarity.** There is no path that searches the
corpus and filters the results. Both halves receive the envelope and put it
in the query above the ranking, so an unauthorised chunk is never a row: it
cannot be counted, timed, logged or one bug away from being returned. Fusion
is a pure function over two already-authorised lists and has no way to admit
anything. Hydration re-applies the whole envelope, which can only ever agree
with the lists, and is the second layer that would have to fail too.

### The envelope

`envelopeFromPlan` is a projection of the `PermittedContextPlan`, never a
second policy. It keeps the three scopes derived chunks can answer -
`EVIDENCE_DOCUMENTS`, `NETWORK_VISIBLE_DATA`, `PUBLIC_EXTERNAL_DATA` - and
drops the rest, because canonical company state answers "what stage is this
company?" better than a deck does.

The envelope is a **disjunction of constraints**, each a conjunction of
subject, disclosure scopes and a sensitivity ceiling. That structure is the
security property. An actor permitted founder-private material about the
company they own AND network-visible material generally is not permitted
founder-private material about everyone; unioning the labels and unioning
the subjects separately would grant exactly that. The disjunction travels to
Postgres as one bound `jsonb` parameter and is expanded there, so the
statement keeps one fixed shape and no part of a permission check is ever
built as text.

Two consequences worth stating plainly, because they are policy and not
oversight:

- The firewall grants `EVIDENCE_DOCUMENTS` to the **owning side only**. An
  investor asking about a company they do not own reaches no chunk-backed
  scope at all. Founder-private material is not filtered out of their
  answer; it is never searched.
- `relationship_shared` and `specifically_shared` chunks are outside every
  V1 envelope. Document sharing is the Data Room's grant to make, and the
  firewall's evidence scope does not carry those labels. An expired or
  revoked share therefore cannot retrieve, because no share retrieves yet.

### Lexical: Postgres full-text search

`q_knowledge.chunks.content_tsv` is a STORED generated column over
`to_tsvector('english', content)`. Generated rather than trigger-maintained
or ingestion-written: chunk content is immutable, so the derived vector
cannot drift from the text, there is no backfill to forget, and a rebuild is
a new chunk set as it already was. The index is GIN, over an append-only
corpus where GIN's slower writes cost nothing.

`english` is a deliberate V1 choice. It preserves the tokens private-capital
retrieval depends on - SOC 2, ARR, MRR, Series A, PCI DSS, CAC, company and
investor names - and only folds ordinary English morphology. Multilingual
sources are additive: a per-chunk language column selecting the regconfig,
and a second generated column beside this one.

**How a question becomes a tsquery, and why not `websearch_to_tsquery`.**
The obvious choice ANDs every term, so "What does the deck say about the
total addressable market?" requires a chunk containing "deck" and "say".
Measured against the golden set it returned zero candidates for every
natural-language question. The lexemes are ORed instead and `ts_rank`
orders by how many match: initial retrieval optimises recall, and precision
comes from fusion and the final bound. Nothing accepts operator syntax from
a caller - Postgres parses the text into lexemes under the same
configuration the column used, and `quote_literal` quotes each one.

### Semantic

CQ-RAG-003's candidate path, unchanged, with the envelope and a
current-source requirement added to its typed scope. The query is embedded
by CQ-RAG-002's local Qwen runtime under `capital-q-evidence-retrieval-v1`.
If that runtime is down there is **no fallback**: sending a private evidence
query to an external embedding API to keep search working would trade a
privacy guarantee for an availability one. Retrieval degrades to lexical and
says so internally.

### Fusion

Reciprocal Rank Fusion, `score = sum of 1/(k + rank)` over the lists a chunk
appears in, k = 60, ranks 1-based everywhere. Rank fusion rather than score
fusion because a `ts_rank` and a cosine distance share no units, no range
and no distribution; averaging them produces a number that looks meaningful
and is not. A chunk found by both halves appears once carrying both ranks -
the same evidence retrieved twice is one piece of evidence.

### What a hit is not

A retrieval hit is relevant source material with provenance. It is not
verified, not current company truth, not a claim and not knowledge.
`truthClass` is `USER_CLAIM` and `evidenceStatus` is `DOCUMENT_SUPPORTED`;
there is no path that emits `VERIFIED` because something ranked first. No
score, rank or fingerprint reaches the model's context. Retrieved text is
DATA: it arrives inside the prompt's untrusted fence, and it cannot change
the envelope, the tools, the tenant or an approval.

`canDiscloseExistence` is separate from `canUseForReasoning`. A hit may
inform an answer while its title stays private, in which case the fact names
its source by shape alone. Reasoning access is not download access, not
share access and not a Data Room grant.

### Measured baseline

Local, 11 synthetic passages, real Qwen, K = 5, `capital-q-hybrid-v1`:

| Strategy      | Recall@5 | Precision@5 | MRR  | nDCG@5 | mean ms |
| ------------- | -------- | ----------- | ---- | ------ | ------- |
| Lexical only  | 85.7%    | 71.4%       | 0.67 | 0.86   | 21      |
| Semantic only | 100.0%   | 20.0%       | 0.78 | 1.00   | 1,981   |
| Hybrid RRF    | 100.0%   | 20.0%       | 0.72 | 0.95   | 1,522   |

Read these carefully rather than as a scoreboard:

- **Precision@5 is capped at 20% for the semantic and hybrid rows** because
  every golden case has exactly one relevant passage and a k-NN always
  returns k candidates. Lexical scores higher only because it returns fewer
  rows. The numbers to compare are Recall@5 and MRR.
- **Lexical alone misses the paraphrase case entirely** (0% recall on
  "payment rails" against "financial infrastructure APIs"), which is the
  reason the semantic half exists.
- **Hybrid's MRR sits slightly below semantic alone** (0.72 vs 0.78) on this
  corpus. On the paraphrase case a confident-but-wrong lexical rank 1 ties
  with the correct semantic rank 1 and wins the tie-break. That is a real
  cost of ORing lexemes for recall, it is what a reranker would fix, and it
  is the measurement the reranker gate should be argued from - not a reason
  to reach for one now.
- Latency is dominated by query embedding on a CPU runtime (1-5 s), not by
  Postgres. The lexical query executes in under a millisecond on this
  corpus.

**Unauthorised retrieval rate: 0.** That one is a requirement, not a
baseline.

### Commands

```bash
pnpm rag:retrieval:smoke -- [--fake]
pnpm rag:retrieval:eval  -- [--fake]
```

The smoke runs one owner scenario and one counterparty probe - the same
question, in the founder-private passage's own words - and prints the
lexical query plan. The eval runs the golden set through all three
strategies and prints the table above. Both seed a synthetic tenant in a
transaction and roll it back; neither is an HTTP endpoint, and neither
prints a vector or a private marker.

## Q Knowledge Objects and the Write Gate (CQ-KNW-002)

The difference between "this document says ARR is $2.4m" and "Capital Q
currently understands ARR to be approximately $2.4m, on this evidence, with
this confidence".

```
candidate -> schema -> subject -> provenance identity -> tenant/ownership ->
scope and visibility -> truth class -> evidence links -> temporal validity ->
sensitivity -> contradiction pre-check -> confidence -> persist | hold | reject
```

A model may propose. Nothing in the path lets it decide, and there is no
second way into `q_knowledge.objects`.

### What a candidate cannot say

Not "cannot say convincingly" — cannot express. `KnowledgeCandidate` is
`.strict()` and has no field for a tenant, a visibility scope, a sensitivity
class, a status, a confidence, an evidence status, a reliability, a revision
number or any canonical company field. A candidate carrying `status: ACTIVE`
or `confidence: 0.92` is refused at the schema, before any rule runs.

`truthClassProposal` exists, and its enum has no `VERIFIED` member. The
policy that maps it has no branch that returns VERIFIED either, and the
database refuses a VERIFIED object whose evidence status is not
`EXTERNALLY_VERIFIED` or `PLATFORM_VERIFIED`. Three independent layers, none
of which an extraction can reach.

### Confidence is a category a rule produced

| Rule (in order)              | Class                   | Reason                         |
| ---------------------------- | ----------------------- | ------------------------------ |
| sources disagree             | `CONFLICTING_EVIDENCE`  | `CONFLICTING_SUPPORT`          |
| support was withdrawn        | `INSUFFICIENT_EVIDENCE` | `SUPPORT_WITHDRAWN`            |
| nothing behind it            | `INSUFFICIENT_EVIDENCE` | `NO_SUPPORTING_EVIDENCE`       |
| verified evidence            | `HIGH`                  | `VERIFIED_SUPPORT`             |
| Q's own conclusion           | `LOW`                   | `INFERENCE_NOT_ASSERTED`       |
| a projection                 | `LOW`                   | `ESTIMATE_NOT_ACTUAL`          |
| two or more distinct sources | `MODERATE`              | `MULTIPLE_INDEPENDENT_SOURCES` |
| one document                 | `MODERATE`              | `SINGLE_DOCUMENT_SOURCE`       |
| a bare statement             | `LOW`                   | `SELF_REPORTED_ONLY`           |

Conflict and withdrawal come first because they are facts about the evidence
rather than gradations of it: an understanding whose sources disagree is not
"a bit less confident", it is a different situation.

**HIGH is reachable only from verified evidence.** Nothing an extraction or
an inference does gets there. A pitch deck agreeing with itself nine times is
still a pitch deck.

There is no percentage anywhere. This repository has no calibrated
methodology, and a number that looks measured but is not is worse than a
category everyone reads correctly.

### Inheritance

Visibility takes the **narrowest** input scope, never the widest. An
understanding drawn from a founder-private source and a network-visible one
could not have been reached without the private half, so it carries the
private half's scope. A source already broader than private is narrowed to
`organisation_private`.

Sensitivity takes the **strongest** input class and never descends, with a
`CONFIDENTIAL` floor. The floor is there for combination risk: cash, burn and
payroll may each be classified one way while the runway they jointly imply is
more sensitive than any of them.

### Multi-source means distinct sources

`MULTI_SOURCE_SUPPORTED` requires genuinely distinct sources. Two passages of
one deck, or two evidence items from one source, are one source saying a
thing twice; counting that as corroboration is how a single unchecked
assertion acquires the appearance of independent support.

### Conflict, and what is deliberately not done

A candidate whose value disagrees with the current understanding is **HELD**
as a `CANDIDATE`. The existing object keeps its value, its status and its
history — nothing preferred the larger number, and nothing preferred the
newer one. What does change is that Capital Q stops claiming confidence it no
longer has: the active object gains a revision setting confidence to
`CONFLICTING_EVIDENCE`, and a `reassesses` lineage edge records that one
reading reassesses the other.

That is the input CQ-KNW-003 needs, and the section below is what it does
with it. Since CQ-KNW-003 the incumbent also moves to `DISPUTED` and a
contradiction set is opened.

### Revocation

`reassessForWithdrawnEvidence` finds the understandings resting on evidence
that is no longer valid and re-derives their confidence. Nothing is deleted
and no statement is rewritten; what changes is that an understanding whose
only support disappeared stops looking supported, and carries
`reassessment_required_at`. The earlier, better-supported revision remains
reconstructable.

### Reads are authorisation, not existence

`KnowledgeQueryService` takes the same envelope CQ-RAG-004 uses — one
disjunction of constraints for the whole knowledge context, projected from
the Context Firewall's plan. There is no `getAllKnowledge`, no tenant-wide
list, and no method that takes a subject without an envelope. The constraint
is applied IN the query, so an unauthorised understanding is never a row.

`ACTIVE` and `DISPUTED` objects are answers; a `DISPUTED` one says so. A held
candidate is a proposal awaiting a person, not Capital Q's position.

Existing in this schema grants nothing: not a Data Room grant, not download,
not share, not recommendation eligibility. The table has no column for any of
them.

### Where knowledge sits in Q's retrieval hierarchy

```
canonical structured state   (the Tool Registry; still authoritative)
  -> authorised Knowledge Objects   (settled understanding, with confidence)
    -> authorised document retrieval  (the passages themselves)
```

Knowledge is offered to the model before the passages it was derived from,
because it is the settled reading of them — but both travel, so the model can
see the passage behind the summary. Confidence reaches the model as a word,
so an answer can say "moderate confidence, document-supported" rather than
asserting a number as fact.

Canonical state is untouched. The gate never writes `core.companies`, a
capital objective, an investor mandate or relationship state; a candidate
implying a canonical update is a suggestion for the owning domain, and this
packet does not build that path.

### Commands

```bash
pnpm knowledge:write:smoke
```

Claim and evidence in, six candidates through the gate, knowledge object out,
read back under three different envelopes. Free, deterministic, no provider.
It seeds two synthetic tenants in a transaction and rolls back, and it prints
keys, classes and codes — never a statement, never a value.

Observed: a document-supported candidate ACCEPTED at MODERATE; the same one
again DUPLICATE; a second independent source REVISED to
MULTI_SOURCE_SUPPORTED; a conflicting value HELD with the active object moved
to CONFLICTING_EVIDENCE; another tenant's evidence REJECTED
`PROVENANCE_NOT_FOUND`; and a candidate asserting VERIFIED, ACTIVE and 92%
REJECTED `CANDIDATE_INVALID`. Counterparty and other-tenant reads: 0.
VERIFIED objects: 0. Non-private objects: 0.

## Time and disagreement (CQ-KNW-003)

Two things change here, and both follow from one observation: a company's
numbers move, and a system that treats every difference as a discrepancy will
report a founder's own growth back to them as an inconsistency.

```
historical ≠ false      old ≠ wrong           corrected ≠ fraudulent
different ≠ contradictory   disputed ≠ rejected   superseded ≠ deleted
stale ≠ incorrect       latest ≠ most reliable    highest ≠ true
```

### "Current" stops being a status

CQ-KNW-002 allowed one `ACTIVE` row per `(subject, key)`. That made "current"
a stored flag, and a metric with a history impossible: January, June and
August ARR are all true, of different months.

The constraint moves down to the period. The partial unique index is now
`(tenant, subject, key, coalesce(definition_qualifier,''), measurement_basis,
coalesce(valid_from,'-infinity')) where status = 'ACTIVE'`, and _current_ is
derived — the latest effective reading, where effective means
`coalesce(valid_from, recorded_at)`. The application and the index order by
the same expression on purpose.

The only thing still forbidden is two settled answers to the same question
about the same period, which is exactly a contradiction, and is held rather
than stored.

Two clocks, never conflated: **valid time** is when the information applies to
the world; **record time** is when Capital Q came to hold it. "What was ARR in
June?" is a valid-time question, and answering it from record time returns
whatever was learned most recently, which may be about August.

### Difference is examined before it is called a conflict

`compareKnowledge` walks the axes in order of how completely each one explains
a difference, and stops at the first that does:

| axis       | example                                  | verdict                    |
| ---------- | ---------------------------------------- | -------------------------- |
| metric     | FY revenue against current ARR           | `DIFFERENT_SUBJECT_MATTER` |
| period     | January ARR against August ARR           | `DIFFERENT_PERIOD`         |
| definition | gross ARR against ARR net of churn       | `ACCEPTED_DIFFERENCE`      |
| basis      | a 4m forecast against a 2m actual        | `DIFFERENT_BASIS`          |
| kind       | a headcount against an amount of money   | `INCOMPARABLE`             |
| currency   | 100m naira against 65k dollars           | `INCOMPARABLE`             |
| value      | 2.4m against 1.8m, everything else equal | `CONTRADICTION`            |

Currency is deliberately `INCOMPARABLE` rather than a conflict: 100m naira and
65k dollars may be exactly the same money, and without a trusted dated
conversion basis, deciding would mean inventing an FX rate. Both readings are
kept, each with its own currency.

Materiality is `UNDETERMINED` for every genuine conflict. This repository has
no calibrated materiality methodology, and "more than 5% is material" would
put a number nobody measured in front of a founder as though it had been.

### Corrections

A correction restates a period already recorded; a new value describes a
different one. Conflating them turns a fixed typo into a reported decline.

`correctsEarlier` on a candidate is a **request, never a decision**: the gate
reads it only after `isCorrectionOf` confirms the periods match, so a
candidate cannot supersede an inconvenient figure by asserting that it
corrects it. When it is a correction, the earlier reading is marked
`SUPERSEDED` — kept, because it is what the period looked like before — and a
`supersedes` lineage edge records what was fixed. Confidence is not lowered:
being told which reading stands is not a disagreement.

### Disagreement has somewhere to live

`q_knowledge.contradiction_sets` and `contradiction_members` record which
understandings disagree, about which metric, definition, basis and period, and
whether anyone has settled it. A set holds **references and codes only** — no
statement, no value — because the members already carry those along with the
permissions that govern them, and a set that copied them would be a second
place a private figure could leak from.

A set inherits its members' classification through the same
`derivedKnowledgeVisibility` / `derivedKnowledgeSensitivity` rules the objects
use. "These two figures conflict" can disclose as much as the figures do, so a
set is never filed more openly than what it is about.

When a contradiction opens: the challenger is held as a `CANDIDATE`, the
incumbent moves to `DISPUTED` with confidence `CONFLICTING_EVIDENCE`, a
`reassesses` lineage edge is written, and a set is opened — or joined, if one
is already open about that question. A third disagreeing reading joins the
same argument rather than starting a parallel one.

Reads carry both sides. `disputesForSubject` returns a set with **every member
the envelope reaches, or nothing at all**: one side alone would be Capital Q
silently picking a number, which is the single thing this exists to prevent.
`currentForKey` still returns the disputed reading, marked `disputed: true`,
because withholding it entirely would turn a known disagreement into a claimed
absence of knowledge.

`settleContradiction` requires a **human actor**. Choosing between two readings
of a company's own numbers is commercial authority; nothing about being newer,
larger or better evidenced transfers it, and a `SYSTEM` or `Q` actor is
refused `NOT_A_HUMAN_DECISION`. Every member survives the decision: the reading
not chosen becomes `SUPERSEDED`, which is a record of having been considered.

### Freshness, which is not permission

`assessFreshness` measures age from the later of validity start and last
verification, against a declared policy per key
(`knowledge-freshness-v1`: cash balance 45 days, burn rate 90, ARR 120,
investor mandate 365). Each rule carries the reasoning for its number.

A key with **no declared rule never goes stale by time**. There are no
universal TTLs here, because a company's address and its cash position do not
age at the same rate, and inventing a number for each would be inventing a
fact about each.

`reassessForFreshness` marks aged understandings `STALE`. It changes lifecycle
and nothing else — the statement, the value, the visibility scope and the
sensitivity class are untouched. An old founder-private figure is
founder-private. Stale still answers "what was it in May"; it stops answering
"what is it now".

### Reads

| method               | question                                                  |
| -------------------- | --------------------------------------------------------- |
| `currentForKey`      | the latest effective reading **this viewer may see**      |
| `currentForSubject`  | one current reading per (key, definition, basis)          |
| `asOfForKey`         | what applied at an instant, from valid time               |
| `historyForKey`      | the whole authorised series, superseded readings included |
| `disputesForSubject` | open disagreements, with every side                       |

The Context Firewall applies inside the derivation, not after it.
`currentForSubject` decides "is there a later reading" **under the same
envelope**: if a founder-private August figure suppressed an
organisation-visible January figure, private information would have silently
altered what a counterparty is shown without ever being shown to them. That is
the release-blocking invariant, and it is why the envelope predicate appears
twice in that query.

`asOfForKey` answers from one series. Omitting the slot means the unqualified
actual — a defined thing, not a preferred one: a caller asking about a
definition or a projection names it, and nothing silently picks the reading
that answers best.

### Commands

```bash
pnpm knowledge:temporal:smoke
```

Six candidates against the local database inside a rolled-back transaction:
growth, a definition, a projection, a correction and a conflict. Free,
deterministic, no provider. Observed:

```
january (gross, actual)      ACCEPTED             RECORDED                 ACTIVE
august (gross, actual)       ACCEPTED_DIFFERENCE  DIFFERENT_PERIOD         ACTIVE
january net of churn         ACCEPTED_DIFFERENCE  DIFFERENT_DEFINITION     ACTIVE
january forecast             ACCEPTED_DIFFERENCE  DIFFERENT_BASIS          ACTIVE
january restated             CORRECTED            CORRECTS_EARLIER_PERIOD  ACTIVE
august, disagreeing          HELD                 CONFLICTS_WITH_ACTIVE    CANDIDATE
```

with 5 readings in history, 3 current, 1 open disagreement carrying 2 members
at `UNDETERMINED` materiality, the corrected January reading `SUPERSEDED`
rather than deleted, no settled August answer while it is contested, and the
disagreement filed `founder_private`. Keys, outcomes and codes only — never a
statement, never a value.

## Known limitations

- Automated malware scanning does not exist. Outside a local stack the
  default policy blocks every document before parsing, so this substrate is
  reachable in production only once a scanner lands or an approved
  compensating control exists.
- Dates in XLSX are the serial numbers the file stores; number formats are
  not applied.
- The column-label rule is a structural heuristic and is documented as such.
- `source_id` is null until a later packet registers a Source per document;
  provenance runs through the document version and extraction today.
- Source environment (`CAPITAL_Q_PRIVATE` and friends, doc 14 §8) is not
  modelled anywhere yet.
- Revocation is a use case; no archive event triggers it automatically yet.
- Scanned PDFs without a text layer produce few or no blocks; there is no
  OCR and none is added automatically.

## Embeddings over these chunks (CQ-RAG-002)

The free-first rule was met: `@capital-q/q-embeddings` embeds these chunks
with the open-weight `Qwen3-Embedding-0.6B` model running locally through
Text Embeddings Inference, with no API key and no hosted provider. See
`docs/modules/q-embeddings.md`. `createChunkEmbeddingProcessor` is the seam:
it refuses to embed a chunk whose set is no longer ACTIVE, and it returns
validated vectors without persisting them — CQ-RAG-003 owns the rows. An
embedding is a disposable derived layer over these chunks: a chunk's
identity never changes when its embedding does, and a vector inherits the
chunk's visibility and sensitivity.

## Deferrals

A reassessment worker and its schedule. `reassessForFreshness` and
`reassessForWithdrawnEvidence` are the seams; nothing calls them on a timer
yet, and no job row exists.

A calibrated materiality methodology. `classifyMateriality` returns
`UNDETERMINED` for every genuine conflict, and the function is where a
measured policy goes when one exists — with its version beside it.

Dated currency conversion. Two readings in different currencies stay
`INCOMPARABLE`; resolving them needs a trusted, dated rate that this
repository does not have.

A reviewer's queue or any UI over `contradiction_sets`. The settlement seam is
`settleContradiction` and it requires a human actor; the surface a person uses
belongs to a UI packet.

Contradiction detection across keys — "cash and burn imply a runway that
disagrees with the stated one". Comparison here is within one key, and
combination reasoning is the Context Firewall's problem, not the comparator's.

Long-term entity memory (`q_knowledge.memory_items`) → a later packet. KNW-002
is knowledge, not memory, and the table deliberately does not exist yet.

A canonical-state suggestion path — a confirmed knowledge object proposing an
update to `core.companies` or a capital objective → the owning domain's own
packet. Nothing here writes canonical state.

A cross-encoder reranker → only if a measured RRF baseline justifies the
latency and the compute. The baseline above is that measurement's starting
point.

Connected and external retrieval (web, Gmail, Drive, MCP) → a later governed
connector slice. There is no automatic web search when internal retrieval is
empty: empty is a valid answer.

Embedding provider → CQ-RAG-002 · pgvector storage and index → CQ-RAG-003 ·
hybrid FTS + vector + RRF retrieval → CQ-RAG-004 · claims and evidence
intelligence → CQ-KNW-001 · knowledge objects → CQ-KNW-002 · contradictions
and revisions → CQ-KNW-003 · ingestion evals as a Q eval suite → with
CQ-RAG-004 (the deterministic fixtures live in this package's tests today).
