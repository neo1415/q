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

This packet contains no upload endpoint, no signed URL, no parser, no
malware scanner, no embedding, no model call and no URL fetch.

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

## Processing provenance

`evidence.document_processing_runs`: `UNIQUE (document_version_id,
pipeline_version)`; `registerProcessingRun` is get-or-create, so a second
registration of `evidence-v1` for the same version is the same run.
Status QUEUED → RUNNING → COMPLETED | FAILED (FAILED may be re-queued).
Version states: processing NOT_STARTED/QUEUED/PROCESSING/COMPLETED/FAILED;
malware PENDING/CLEAN/BLOCKED/ERROR; extraction
NOT_STARTED/PROCESSING/COMPLETED/FAILED. All checked strings. No processor
runs here.

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
- Malware orchestration, extraction, queues → CQ-EVD-002/003.
- Chunks, embeddings, RAG → CQ-RAG; Q Knowledge Objects → CQ-KNW; Q → CQ-Q.
- InvestIQ evidence weighting → later methodology.
- Data Room → CQ-DR. Verification claims → separate workflow (ADR-001).

## Tests

`packages/evidence/test/contracts.test.ts` (vocabulary, locators, storage
identity, metadata, sensitivity, registry, events);
`packages/evidence/test/evidence-service.integration.test.ts` (lifecycle,
same-hash-across-tenants, cross-organisation ownership, revisions,
contradiction retention, immutability, processing idempotency,
cross-tenant negatives, privacy markers);
`supabase/tests/database/rls/260_evidence.test.sql` (shape, constraints,
triggers, principals).
