# Evidence module (`@capital-q/evidence`, CQ-EVD-001)

**Purpose.** The canonical answer to "where did this information come from,
which document and which immutable file version is it tied to, what
assertion does it relate to, how is that assertion classified, what supports
or contradicts it, and who may know the source exists". Schema `evidence`:
sources, documents, document versions, document processing runs, claims,
claim revisions, evidence items and claim-evidence links.

**Invariant.**

```
Source ≠ Document ≠ DocumentVersion ≠ EvidenceItem ≠ Claim
Claim ≠ canonical Company state ≠ Q Knowledge object
Evidence ≠ Verification        Q knows ≠ user may know
same bytes ≠ same authorization ≠ same ownership
```

Documents support intelligence; uploading one never makes it the company's
authoritative record. A deck saying "revenue $2M" may support a Claim
(`USER_CLAIM` / `SELF_REPORTED`); nothing here writes `core.*`.

Uploading arrived with CQ-EVD-002 and processing with CQ-EVD-003 (below).
There is still no malware scanner, no chunking, no embedding, no model
call, no URL fetch and no document download route.

## Vocabulary (ADR-001 wins)

Doc 13 §22.1's `verification_state` / `truth_state` are superseded. Claims
carry three independent axes, shared in `@capital-q/contracts`:

| Axis               | Values                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `truth_class`      | VERIFIED · USER_CLAIM · ESTIMATE · Q_INFERENCE · UNKNOWN                                                            |
| `evidence_status`  | NO_EVIDENCE · SELF_REPORTED · DOCUMENT_SUPPORTED · MULTI_SOURCE_SUPPORTED · EXTERNALLY_VERIFIED · PLATFORM_VERIFIED |
| `lifecycle_status` | CURRENT · HISTORICAL · SUPERSEDED · DISPUTED · CONTRADICTORY · STALE                                                |

`UNKNOWN` is valid; absence never becomes zero or "poor". `CONTRADICTORY`
means investigation, never fraud or a quality penalty. A `VERIFIED` claim
must carry `EXTERNALLY_VERIFIED` or `PLATFORM_VERIFIED` evidence (DB
check). `Q_INFERENCE` is schema-compatible; only a `Q` actor may record it,
and no Q exists yet. `reliability_class` (doc 14 §43) describes source
quality, is nullable (unassessed), and carries no numeric weighting.
Disclosure scope is the ADR-001 eight-value set; sensitivity is the doc 15
six-value set; both are persisted on sources, documents, claims and
evidence items and are never merged.

## Sources

`evidence.sources`: provenance only. `source_type` is USER_STATEMENT,
DOCUMENT, MEETING, CONVERSATION, PLATFORM_EVENT, INTEGRATION, PUBLIC_WEB,
REGULATORY_RECORD or ADMIN_VERIFICATION; `provider` and
`external_reference` are separate. `source_url` is stored and never
fetched. `metadata` is bounded (4 KB) provenance whose keys may not name
secrets, tokens, prompts or credentials. A registered source defaults to
`organisation_private` / `CONFIDENTIAL`; broader scopes are a later
disclosure decision. Subjects are `{ subject_type, subject_id }`, resolved
through `EvidenceSubjectResolverRegistry` (COMPANY over the Company query
port) before any write; there is no dynamic table lookup.

## Documents and versions

`evidence.documents` is the logical identity ("FY2026 Financial Model"):
`owner_organisation_id` (the actor's active organisation, never client
input, tenant-coherent through a composite FK), optional `company_id`
(must belong to that organisation), declared `document_type` (no
classifier has run), `visibility_scope` default `organisation_private`,
`sensitivity_class` default `CONFIDENTIAL` (financial model, management
accounts and FINANCIAL default `HIGHLY_CONFIDENTIAL`; callers may only
strengthen), `status` ACTIVE | ARCHIVED, `current_version_id` (deferred
composite FK: it must point into the same document) and `version` for
optimistic concurrency.

`evidence.document_versions` are immutable: `UNIQUE (document_id,
version_number)`, `version_number >= 1`, `supersedes_version_id` must
belong to the same document, and a trigger refuses any change to storage
bucket/key, filename, MIME, size, sha256, uploader, upload time or
supersedes, and refuses delete. Only `processing_status`,
`malware_scan_status` and `text_extraction_status` evolve. Registering a
version inserts the row and advances the pointer atomically under the
document's expected version; old versions remain. `sha256` is duplicate
detection inside one organisation only (`findBySha256` joins through the
owning document); tenants and organisations holding identical bytes keep
separate documents and permissions.

Storage is deferred: rows carry a bucket name and a random server key; no
bucket is created or exposed, no bytes are accepted.

## Secure upload (CQ-EVD-002)

```
transferred ≠ validated ≠ scanned ≠ parsed ≠ safe
storage key ≠ authorization      declared type ≠ actual content
```

**The flow.** `POST /v1/documents/upload-sessions` (Idempotency-Key)
authorises one transfer: the server checks the capability, resolves the
company, chooses the object identity and returns a scoped target. The
browser PUTs the bytes straight into private storage.
`POST …/:id/complete` (Idempotency-Key) is where the decision happens: the
server stats the object, streams it to a capped temporary file computing
SHA-256, identifies the container, requires extension, declared MIME and
detected content to agree, and only then appends an immutable
DocumentVersion and marks the session COMPLETED. `POST …/:id/cancel` closes
a session and removes any bytes. `GET /v1/documents` and
`GET /v1/documents/:id` return authorised metadata and processing state,
never a bucket, a key or a URL. The API never proxies document bytes and
there is no download route.

**The bucket.** `cq-documents-private`, created by migration with
`public = false`, a 25 MiB ceiling and the MIME allowlist. `storage.objects`
keeps RLS with no policy for it, so anonymous and authenticated browser
credentials can neither read, list, write nor delete. The only
browser-reachable write is the server-issued signed target, scoped to one
object with `upsert:false`, so a completed upload's bytes can never be
replaced; replacement is a new session, a new random identity and a new
version. A public bucket is a release blocker and is asserted in pgTAP.

**Object identity.** `raw/<tenantId>/<32 random hex>`, chosen by the server.
Never the filename, the title or any business id. The original filename is
kept as display metadata only, with client directories stripped and control
characters, path separators and CR/LF refused.

**What is admitted.** PDF, DOCX, PPTX, XLSX, CSV, TXT, PNG, JPEG — the same
list the version registry stores. Executables, scripts, HTML, SVG, general
archives, legacy Office and macro-enabled Office are refused. PDF must carry
its signature at byte zero, so a polyglot with leading junk is refused
rather than admitted as the convenient interpretation. OOXML is identified
by reading the ZIP **central directory only** — entry names, never an
inflated entry — requiring `[Content_Types].xml` plus exactly one of
`word/`, `ppt/` or `xl/`, and refusing `vbaProject.bin`. Text must contain
no NUL or stray control bytes and must not open with markup, a shebang or a
printable binary header.

> Admitting an OOXML package means its container is what it claims to be. It
> does **not** mean extracting it is safe: expansion ratios, entry counts,
> parser timeouts and memory limits belong to the isolated processing worker
> in CQ-EVD-003.

**Sessions.** `evidence.document_upload_sessions`: PENDING_AUTHORIZATION →
AUTHORIZED → FINALIZING → COMPLETED, or REJECTED, EXPIRED, CANCELLED.
COMPLETED means bytes arrived, passed the boundary and became a version —
never scanned, parsed or safe. The session records which capability admitted
it (`document.create` for a new document's first version, `document.manage`
for a further version of an existing one) and re-checks it at finalization.
Its object identity is immutable by trigger, and
`UNIQUE (storage_bucket, storage_key)` means a key is never reused. The
signed target itself is never persisted.
`evidence.document_upload_requests` carries durable idempotency: one key,
one session, one document; the same key with different content is a
conflict.

**Limits.** 25 MiB by default (`CQ_DOCUMENT_UPLOAD_MAX_BYTES`), an adjustable
implementation limit inside the 50 MiB ceiling a version may carry, enforced
at the bucket, at the declaration and against the actual stored size. A
30-minute application window; Supabase's own signed-upload token lives a
fixed two hours, so finalization after the window fails closed and late bytes
can never become a version. An organisation may hold 25 open authorizations
at once — a bound on outstanding scoped writes, not a rate limiter.

**Failure and cleanup.** A refusal marks the session REJECTED with a bounded
code and deletes the object; if deletion fails the refusal still stands and
`cleanup_pending` records the debt. Validity never depends on cleanup
succeeding. Storage and Postgres cannot share a transaction: the object
exists first, the database commits second, and a failed commit leaves the
bytes private and unattached for a safe retry.
`cleanupExpiredUploadSession` is a service primitive; scheduled cleanup
arrives with the worker packet.

**Refusal codes** (problem `VALIDATION_FAILED` with the category in
`errors[0].code`): FILE_TOO_LARGE, FILE_EMPTY, FILENAME_NOT_ALLOWED,
EXTENSION_NOT_ALLOWED, MIME_NOT_ALLOWED, SIGNATURE_MISMATCH,
OOXML_TYPE_MISMATCH, ACTIVE_CONTENT_TYPE_NOT_ALLOWED, ARCHIVE_NOT_ALLOWED,
CONTENT_UNRECOGNISED, SIZE_MISMATCH, OBJECT_MISSING, UPLOAD_EXPIRED,
STORAGE_VALIDATION_FAILED. Only the content-disagrees-with-its-claim
categories raise a security event; an unsupported type or an oversized file
is an ordinary mistake and must not flood security monitoring.

**Credentials.** The privileged storage key lives only in the API process,
validated as privileged by its own config schema so a publishable key cannot
be configured in its place and it cannot be configured where the public key
belongs. It never reaches a browser, a log or a problem response. Without it
the upload boundary is closed rather than open.

**Threat coverage.** TM-FILE-02 (content-type bypass) is mitigated at this
boundary. TM-FILE-04 (macros) is blocked by type and package inspection, with
parser-level enforcement still to come. TM-FILE-06 (public storage) is
mitigated and asserted. TM-FILE-07 has nothing to leak: no download URL is
issued. TM-FILE-01 (parser exploits) and TM-FILE-03 (decompression bombs)
have their foundation here and their controls in CQ-EVD-003. TM-FILE-05
(document prompt injection) is untouched by design: a valid document whose
words give instructions is admitted as a valid document, and its words carry
no authority.

## Processing provenance

`evidence.document_processing_runs`: `UNIQUE (document_version_id,
pipeline_version)`; `registerProcessingRun` is get-or-create, so a second
registration of `evidence-processing-v1` for the same version is the same
run. Status QUEUED → RUNNING → COMPLETED | FAILED | BLOCKED. FAILED means
the attempt broke and may be re-queued; BLOCKED means policy refused the
work (infected, unscannable) and is terminal. Version states: processing
NOT_STARTED/QUEUED/PROCESSING/COMPLETED/FAILED; malware
PENDING/CLEAN/BLOCKED/ERROR; extraction
NOT_STARTED/PROCESSING/COMPLETED/FAILED/UNSUPPORTED. All checked strings.
The package still runs no parser and no scanner; it records what a worker
did.

## Processing pipeline (CQ-EVD-003)

```
version created → evidence.document.process → documents queue → worker
  → security gate → malware gate → isolated parse → extraction artifact
  → instruction-risk signal → evidence.document.ready
```

**Where it runs.** `apps/workers` owns the loops: a `domain-events`
consumer turns `evidence.document.version_created` into a job, and a
`documents` consumer runs it (`documents-dead` holds exhausted attempts).
The evidence package exposes `createDocumentProcessingService`, a surface
with no AuthorizationService and no audit writer: processing is a trusted
server operation on a queue message, not a user action.

**Tenancy.** The job carries a version id, a pipeline version and a tenant
_claim_. The worker resolves the version by id alone
(`findByIdForProcessing`) and refuses on mismatch — a forged pairing is
dead-lettered, not silently reported as missing.

**Parser isolation.** `execFile` with an argument array, no shell, a
private temp directory removed in `finally`, a timeout, a bounded stdout,
a heap ceiling, and an environment holding no database URL, storage key,
model key or connector token. Output is revalidated with
`ParserOutputSchema` before anything is stored.

**Extractors.** PDF (`pdfjs-dist`, evaluation and system fonts disabled),
DOCX and PPTX (own bounded OOXML reader: entry, size, total and ratio
limits checked before inflating; XML scanned, never entity-resolved),
plain text, and since CQ-RAG-001 XLSX (the same OOXML reader: shared
strings, cached cell values as text, no formula evaluation, a VBA project
refused, sheet/row/column/cell limits) and CSV (RFC 4180). Spreadsheets
become `spreadsheet_range` blocks with sheet, A1 range and row locators.
Images remain UNSUPPORTED, never COMPLETED.

**Chunking (CQ-RAG-001).** After the extraction is recorded, the same
worker derives the version's chunk set through `@capital-q/q-knowledge`
and records `chunking_version` on the run; see
`docs/modules/q-knowledge.md`.

**Malware gate.** A port with one implementation that answers UNAVAILABLE.
Under the default `REQUIRE_CLEAN` policy an unscanned document is BLOCKED
and never parsed; `ALLOW_UNSCANNED` is refused outside a local
environment. Only a scanner verdict may write CLEAN.

**Extraction.** `evidence.document_extractions` records extractor,
versions, run, artifact bucket/key, hash, counts and the number of
instruction-risk signals; one row per (version, pipeline version),
immutable. The blocks live in the private `cq-extractions-private` bucket
and inherit the document's visibility scope and sensitivity class. Blocks
keep page, slide, section and line locators, so a later citation can name
a place. A deterministic scanner counts instruction-shaped passages and
reports categories and locators — never the matched text, which stays in
the private artifact.

**Completion.** The run transition, the version state and
`evidence.document.ready` are one transaction; a redelivered job finds the
run settled and emits nothing. See `docs/adr/0008-document-processing-and-parser-isolation.md`.

## Claims and revisions

`evidence.claims` is the current projection; `evidence.claim_revisions`
is the append-only history (`UNIQUE (claim_id, revision_number)`, trigger
forbids update and delete). Creating a claim writes revision 1; revising
inserts revision N+1 with a change reason and actor attribution and moves
`current_revision_id` / `current_revision_number` in the same transaction,
guarded by the revision number the caller last read. A trigger on
`claims` refuses any change to statement, value, axes or validity unless
the current revision advances by exactly one, and refuses delete. There
is no lifecycle or evidence-state setter outside a revision.

## Evidence items and links

`evidence.evidence_items`: something identified inside a source about the
source's subject, with a typed `locator` (`document` with version id,
page, paragraph, sheet, cell; `meeting` with a time range; `statement`).
Unknown locator fields are refused; a locator carries no storage
semantics and grants no access. An item never widens its source's scope
and inherits at least its sensitivity. `evidence.claim_evidence` links
claims to items with SUPPORTS, CONTRADICTS, QUALIFIES or SUPERSEDES,
unique per relationship; SUPPORTS and CONTRADICTS coexist and nothing is
deleted. `weight` exists as an extension point and is unset.

## Claim interpretation (CQ-KNW-001)

The boundary between what a source SAID and what Capital Q RECORDED.

```
authorised passage -> proposer -> schema -> provenance checks -> truth
policy -> inheritance -> idempotency -> conflict check -> the Evidence
application services -> recorded
```

A proposer reads one passage and returns candidates. It may be a language
model or the deterministic line parser; either way its output is untrusted,
and it never touches the database. Persistence goes through `createClaim`,
`createEvidenceItem` and `linkClaimEvidence` — the same services a person
uses, with the same authorisation, audit and events. There is no second
claims table and no direct insert.

### What a proposal cannot say

Not "cannot say convincingly" — cannot express. The proposal type has no
field for a tenant, a visibility scope, a sensitivity class, an evidence
status, a lifecycle status, an author, a confidence, an evidence weight, a
claim id or an evidence item id. Each is derived server-side from the source
row and the actor.

It has no field for a truth class either. A proposer names an
`assertionKind` — SOURCE_ASSERTION, SOURCE_ESTIMATE or MODEL_INFERENCE — and
deterministic policy maps that onto the canonical class. **VERIFIED is not
filtered out; there is no branch that returns it.** A document instructing
Capital Q to mark it verified is asking for a value nothing in the pipeline
can produce, and the database refuses it independently: a VERIFIED claim
requires EXTERNALLY_VERIFIED or PLATFORM_VERIFIED evidence, which an
extraction cannot create.

### The two axes, kept apart

The packet's own wording treats "document supported" as a truth class. In
this repository it is an EVIDENCE STATUS, and ADR-001 keeps the two axes
separate on purpose. So a deck asserting its own ARR becomes:

| Axis              | Value                | Why                                  |
| ----------------- | -------------------- | ------------------------------------ |
| `truth_class`     | `USER_CLAIM`         | the company is speaking about itself |
| `evidence_status` | `DOCUMENT_SUPPORTED` | a document version stands behind it  |

Collapsing those two is exactly how a pitch deck ends up counting as
verification. A founder saying the same thing aloud produces the same truth
class with `SELF_REPORTED` — the claim is no less real, and no better
evidenced.

### What is checked, and why each check exists

- **Source, subject and tenant** come from the source row, never the
  proposal. A cross-tenant source id and a wrong-subject source id both stop
  at the same refusal, because a source id is a selection and not authority.
- **The document version** is validated by the evidence service itself. A
  proposal naming a plausible uuid has not read a document.
- **The excerpt must appear in the passage.** A proposal quoting words the
  passage does not contain did not read it, and the claim it carries has no
  provenance whatever the model believes. This is what stops general model
  knowledge becoming entity evidence.
- **The claim key must be permitted, and its value must have that key's
  shape.** `financial.arr` is money; `traction.customer_count` is a count. A
  customer count denominated in dollars is a different claim, not a
  formatting slip. The key — not the number — is what keeps `financial.arr`
  and `capital.raise_target` apart when both read "$2m".
- **Currency is never inferred and never converted.** "$2.4m" is USD;
  "£2.4m" is GBP; "2.4m" has no currency and is refused rather than assumed.
  A claim whose currency was guessed is worse than a claim with no number.
- **`asOf` is the period the source attached**, or null. Never today.

### Inheritance

Visibility narrows or stays: a private source keeps its exact scope, and a
network-visible or public source is narrowed to `organisation_private`,
because a claim is the organisation's own record of what a source said and
CQ-EVD-001 refuses to record one at a shared scope. Widening is a disclosure
decision with its own workflow, its own audit and its own actor.

Sensitivity climbs only: the strongest of the source's class and the
caller's floor. A RESTRICTED source cannot produce an INTERNAL claim through
this path.

Reliability is a classification — `MODEL_DERIVED`, `USER_STATEMENT`,
`UNKNOWN` — never a score. There is no weighting methodology in the
repository, and inventing one (audited 0.95, deck 0.40) would be a number
nobody could defend and everything downstream would treat as measured.

### Idempotency, corroboration and conflict

Identity is `(source, locator, claim key)` plus the value, which is what
CQ-EVD-001 already stores; no column was added. A retried worker finds its
own earlier evidence item rather than making a second one.

When a claim already exists for `(subject, claim key)`:

- **the same value** links the new evidence as `SUPPORTS`. One claim, two
  independent evidence items behind it.
- **a different value** links it as `CONTRADICTS` and holds. The existing
  claim is not revised, not superseded and not overwritten; the larger
  number is not preferred and neither is the newer one. Both readings are
  reachable from the claim, which is precisely the input CQ-KNW-003 needs.

A `MODEL_INFERENCE` is held as well: the evidence is kept and linked to
nothing, because an inference read out of a passage is not something the
source said.

### When no provider may see the material

Provider eligibility is the Model Gateway's, decided from the source's own
sensitivity before any provider is called. If nothing configured may receive
it, the result is `blocked: PROVIDER_INELIGIBLE` — nothing recorded, and the
passage NOT relabelled to find a provider that would accept it. A blocked
extraction is distinguishable from an empty one, because the difference is
whether Capital Q looked.

Verified locally against the running gateway: a `founder_private` /
`CONFIDENTIAL` source is refused by both configured providers with
`SENSITIVITY_EXCEEDS_CEILING` at `attempts: 0`.

### Commands

```bash
pnpm knowledge:claims:smoke
pnpm knowledge:claims:smoke -- --live [--public-source]
```

Normal mode uses the deterministic line parser: no provider, no cost, and
what CI runs. `--live` routes the same synthetic passage through the Model
Gateway. Both seed a synthetic company, source and deck page in a
transaction and roll it back, and neither prints the passage, the statements
or the excerpts — a smoke that echoes private source text leaks it into a
scrollback buffer.

The synthetic passage ends with an instruction demanding to be treated as
VERIFIED and made public. Both modes report `VERIFIED claims: 0 ·
non-private claims: 0`.

## Authority, access and privacy

Capabilities: `document.create`, `document.view`, `document.download`,
`document.manage` (versions, reclassify, archive), `evidence.view`,
`evidence.record`. Admins hold all; members hold all but
`document.manage`. Reads and writes first resolve the subject or document
as visible in the actor's tenant and active organisation; anything else is
"not found" before any capability check (enumeration-safe). All eight
tables are INTERNAL_SERVER_ONLY: RLS enabled, no policies, no grants to
`anon` or `authenticated`, schema usage revoked. DB privilege ≠ business
authorization. Events (`evidence.source.registered`,
`evidence.document.created`, `evidence.document.version_created`,
`evidence.claim.changed` with CREATED/REVISED/EVIDENCE_LINKED,
`evidence.evidence_item.created`) are CONFIDENTIAL and carry ids, subject
references, numbers and codes only. Audit records document creation,
version registration, claim creation/revision and evidence linking by
humans, with ids and codes only. Statements, summaries, titles, filenames,
storage keys and URLs never reach events, audit or logs.

## Query ports

`EvidenceSourceQueryPort`, `DocumentQueryPort` (ownership and
classification facts, never storage keys), `ClaimQueryPort`,
`EvidenceItemQueryPort`. Future Q, RAG and Data Room code import these,
never the Postgres repositories.

## Boundaries and deferrals

- Upload sessions, private storage, MIME/signature checks → CQ-EVD-002.
- A real malware scanner, OCR, spreadsheet and CSV extraction → later.
- Chunks, embeddings, RAG → CQ-RAG; Q Knowledge Objects → CQ-KNW; Q → CQ-Q.
- Claims derived from an extraction → a later packet; extraction creates none.
- InvestIQ evidence weighting → later methodology.
- Data Room → CQ-DR. Verification claims → separate workflow (ADR-001).

## Tests

`packages/evidence/test/contracts.test.ts` (vocabulary, locators, storage
identity, metadata, sensitivity, registry, events);
`packages/evidence/test/evidence-service.integration.test.ts` (lifecycle,
same-hash-across-tenants, cross-organisation ownership, revisions,
contradiction retention, immutability, processing idempotency,
cross-tenant negatives, privacy markers);
`packages/evidence/test/extraction.test.ts` (extraction bounds, artifact
provenance, instruction-risk categories and locators without text);
`apps/workers/test/` (OOXML refusals, extractor structure, sandbox
containment, pipeline decisions, queue acknowledgement, event handling);
`supabase/tests/database/rls/260_evidence.test.sql` and
`280_document_processing.test.sql` (shape, constraints, triggers,
principals).
