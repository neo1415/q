# Implementation ledger

Packet readiness, dependencies and status (doc 25 §205). One line per packet;
the commit history is the audit trail and this file is the index of it.

Introduced at CQ-Q-001. Rows before it are reconstructed from the commit log —
each named packet has a commit of that name on `main` — and no checkpoint
before C3 had a written record. Statuses: `VERIFIED` (committed, gates green
at the time), `IN_PROGRESS`, `READY`, `BLOCKED`.

## Wave 0 — Repository foundation

```
CQ-FOUND-001..008   VERIFIED
C0                  satisfied (foundation packets present; not separately recorded)
```

## Wave 1 — Core contracts / data / security

```
CQ-CON-001..003     VERIFIED   contracts primitives, problem details, event/job envelopes
CQ-SEC-001..004     VERIFIED   actor context, authorization, audit, RLS harness
CQ-DATA-001..003    VERIFIED   database, identity, outbox
CQ-AUTH-001         VERIFIED
CQ-WEB-010, 011     VERIFIED
C1                  satisfied (not separately recorded)
```

## Wave 2 — Canonical product domains

```
CQ-ORG-001          VERIFIED
CQ-COMP-001, 002    VERIFIED
CQ-INV-001, 002     VERIFIED
CQ-CAP-001          VERIFIED
CQ-NET-001          VERIFIED
CQ-PERM-001         VERIFIED
C2                  satisfied (not separately recorded)
```

## Wave 3 — Taxonomy / onboarding / evidence

```
CQ-TAX-001, 002     VERIFIED
CQ-ONB-001..003     VERIFIED
CQ-EVD-001..003     VERIFIED
CQ-MEDIA-001        VERIFIED   a820ff2
C3                  SATISFIED BY EVIDENCE — doc 25 §68 requires canonical data
                    (CQ-COMP/INV/CAP), onboarding state (CQ-ONB), documents
                    (CQ-EVD), taxonomy IDs (CQ-TAX), capital objective (CQ-CAP);
                    all committed. Baseline gates at a820ff2 on 2026-09-05:
                    format PASS · lint PASS · typecheck PASS (47 tasks) ·
                    test PASS (82 files, 1257 tests). No formal C3 record
                    existed before this ledger; none is manufactured here.
```

## Wave 4 — Q platform foundation

```
CQ-Q-001            VERIFIED   Q contract package — packages/contracts/src/q, docs/modules/q.md
                    (uncommitted on main at the time of CQ-Q-002; commit one packet at a time)
CQ-Q-002            VERIFIED   Q run persistence + API lifecycle — q_runtime migration
                    20260906120000, packages/q-runtime, apps/q-api /v1/q/runs routes,
                    rls/300_q_runtime. Gates 2026-09-06: format PASS · lint PASS ·
                    typecheck PASS · test PASS (91 files, 1499) · build PASS (27) ·
                    db:reset/db:lint/db:types PASS · pgTAP PASS (25 files, 754) ·
                    integration PASS (19: ownership, idempotency, concurrency,
                    privacy marker). Uncommitted at time of writing.
CQ-Q-003            VERIFIED   LangGraph orchestrator skeleton — packages/q-orchestrator
                    (only LangGraph importer), QOrchestrator port + orchestration runtime in
                    q-runtime, migration 20260906150000 (q_runtime.checkpoint*), rls/310.
                    Version q-orchestrator-v1. Gates 2026-09-06: format PASS · lint PASS ·
                    typecheck PASS (51) · test PASS (93 files, 1520) · build PASS (28) ·
                    db:reset/db:lint/db:types PASS · pgTAP PASS (26 files, 770) ·
                    integration PASS (10 orchestrator + 19 Q-002 regression: restart/resume,
                    replay, cancellation races, tenancy, version, checkpoint inspection,
                    privacy marker). No model, no retrieval, no fake answer. Uncommitted.
CQ-Q-004            VERIFIED   Context Firewall — packages/q-firewall (deterministic
                    pipeline over security capabilities + permissions disclosure; no
                    table, no model, no retrieval), PermittedContextPlan contract
                    (contracts/src/q/firewall.ts, INTERNAL), ContextFirewallPort +
                    plan-bearing retrieval/answer seams in q-runtime, context_firewall
                    node in q-orchestrator (version q-orchestrator-v2; v1 not resumable),
                    re-plan before every retrieval and on resume, same-organisation
                    resume guard, real wiring in apps/q-api. Schema impact NONE. No new
                    ENV, dependency or external account. Gates 2026-09-06: format PASS ·
                    lint PASS · typecheck PASS (53) · test PASS (94 files, 1536) · build
                    PASS (29) · frozen install PASS · lockfile additive · db:lint PASS ·
                    pgTAP PASS (26 files, 770, unchanged) · integration PASS (29 files,
                    281: 12 firewall golden + 4 orchestrator resume/denial + all prior
                    suites). Five privacy markers absent from decisions, logs,
                    checkpoints and run events. Uncommitted.
CQ-Q-005            VERIFIED   Model Gateway + real provider routing — packages/model-gateway
                    (ports, deterministic eligibility and routing, budget, bounded retry and
                    fallback, timeouts, cancellation, structured-output acceptance, cost,
                    usage ledger, telemetry, fake provider, Google and Groq adapters behind
                    ./providers/*, Q answer seam behind ./q), model contracts in
                    contracts/src/model, migration 20260907090000 (schema ai_ops: providers,
                    models, model_prices, routing_policies, model_usage — INTERNAL_SERVER_ONLY,
                    seeded: 2 providers, 4 verified models, 5 versioned prices, routing policy
                    v1 for the 7 text task classes), rls/320_ai_ops, config
                    @capital-q/config/model-providers (GEMINI_API_KEY, GROQ_API_KEY optional,
                    opaque ProviderCredential), lint rule G (SDK imports only in the adapters),
                    q-runtime answer seam returns ANSWERED{modelPolicyVersion}|FAILED{code},
                    q-orchestrator v3 (answerFailure, modelPolicyVersion), q-api composes the
                    gateway. Data-use decisions: google UNREVIEWED ceiling PUBLIC; groq
                    UNREVIEWED ceiling INTERNAL (Services Agreement not verifiable from a
                    primary document); raising either is a reviewed ai_ops data change.
                    Gates 2026-09-06: format PASS · lint PASS · typecheck PASS (55) · test
                    PASS (97 files, 1574) · build PASS (30) · frozen install PASS · lockfile
                    additive · audit PASS (no known vulnerabilities) · db:reset/db:lint/
                    db:types PASS · pgTAP PASS (27 files, 801) · integration PASS (31 files,
                    286: gateway over real catalog + ledger, answer seam end to end, all prior
                    suites) · live smoke PASS via pnpm test:live-model: gemini-3.5-flash-lite
                    structured (1370 ms, 34/21 tokens, $0.0000627), openai/gpt-oss-120b text
                    (1158 ms, 112/120 tokens, $0.0001482), openai/gpt-oss-20b structured
                    (308 ms, 240/76 tokens, $0.0000567); confidential request refused with zero
                    calls. Uncommitted.
CQ-Q-006            VERIFIED   Prompt Registry + Q System Charter — packages/q-core (source-
                    controlled immutable prompt definitions, prompts.lock.json hash pins,
                    registry, renderer with untrusted-content fences, bounded communication
                    guidance, bundle identity, synthetic regression fixtures), contracts
                    q/communication (QCommunicationProfile + presets, QOperatingMode,
                    QProactivityMode), prompts q-system/v1, company-analyst/v1,
                    founder-onboarding-extraction/v1, investor-mandate-synthesis/v1,
                    fit-explanation/v1 with Zod output schemas, answer seam renders the
                    bundle and stores only the validated answer, prompt_bundle_version
                    recorded on completed runs, q-orchestrator v4, Google adapter strips
                    Gemini-rejected JSON Schema keywords, dev tooling pnpm q:smoke (local
                    database only) and an opt-in live Q smoke suite. Schema impact NONE.
                    No new ENV, dependency, account or service. Gates 2026-09-06: format
                    PASS · lint PASS · typecheck PASS (57) · test PASS (99 files, 1595) ·
                    build PASS (31) · frozen install PASS · lockfile additive · audit PASS ·
                    db:lint PASS · pgTAP PASS (27 files, 801, unchanged) · integration PASS
                    (31 files, 286) · pnpm q:smoke: 7/7 synthetic scenarios met their
                    deterministic checks through the real stack (Groq gpt-oss-120b; Gemini
                    3.8-flash served fallbacks in earlier runs) · live gateway suite PASS · live Q
                    scenario suite PASS (7/7) · cross-provider identity leg: Groq PASS,
                    Gemini FAILED on a 429 free-tier quota at run time (behaviour matched
                    on Gemini in earlier runs). Charter
                    ~6.4k chars (~1.6k tokens); bundles ~2.0-2.9k tokens. Uncommitted.
CQ-Q-007            VERIFIED   Tool Registry + Safe Read Tools — packages/q-tools (versioned,
                    source-controlled tool definitions with Zod in/out, risk class, required
                    capabilities, allowed purposes, approval/idempotency metadata, ACTIVE/
                    DISABLED/DEPRECATED kill switch; registry refuses duplicates and anything
                    but READ_ONLY+SAFE_READ; deterministic pipeline: offered-for-this-run →
                    argument validation → actor/plan match → cancellation → authorize (plan
                    scope, capability, disclosure) → sensitivity ≤ plan ceiling → execute
                    through public query ports → output validation → bounded sanitised
                    result), tools company.get / capital_objective.get / investor_mandate.get
                    / company.search (GET_COMPANY, GET_CAPITAL_OBJECTIVE, GET_INVESTOR_MANDATE,
                    SEARCH_COMPANIES), CompanyQueryPort profile projection + bounded keyset
                    search, contracts/model tool definitions/calls/TOOL turns, Google and Groq
                    adapters project canonical tools only (no provider tools), gateway requires
                    TOOL_CALLING and refuses unoffered proposals, q-runtime QToolPort seam +
                    actor on QAnswerRequest, answer seam bounded tool loop (one round of
                    parallel calls, ≤6 calls; TEXT+tools then a tool-free structured
                    finish; one call when no tool is used; Groq tool_use_failed on JSON
                    answers with tools declared is why a second round is not attempted),
                    approved visible stages per tool, q-api composes the registry, pnpm
                    q:smoke -- --tools and an opt-in live tool suite. Schema impact NONE (no
                    migration; search uses companies_marketplace_stage_idx, EXPLAIN reviewed on
                    the local database). No SQL/HTTP/shell/connector/MCP tool, no new ENV, no
                    new dependency. Gates 2026-09-05: format PASS · lint PASS · typecheck PASS (59 + root tsc) · test PASS (105 files, 1643) · build PASS (32) · frozen install PASS · lockfile additive · audit PASS · db:lint PASS · pgTAP PASS (27 files, 801, unchanged) · integration PASS (32 files, 292; q-tools real-domain suite 5, answer-seam tool run) · pnpm q:smoke -- --tools: 6/6 synthetic tool scenarios met every deterministic check through the real stack (Groq gpt-oss-120b; get_company, get_capital_objective, search_companies, get_investor_mandate SUCCEEDED where offered; unauthorised mandate never offered; unknown company DENIED and said plainly; no marker leaked) · live gateway suite: Gemini PASS, Groq PASS in the first run · live tool suite: a/b/c COMPLETED via Groq in the first run, then FAILED on quota — Groq tokens-per-day limit (2000 TPD on-demand) and Gemini 3.8-flash free-tier daily quota were exhausted by this session's smokes, so the rerun and the Q-006 scenario suite got no eligible route (RATE_LIMIT 429, not a code fault). Uncommitted.
CQ-Q-008            VERIFIED   Approval Engine + Consequential Action Authority — packages/q-actions
                    (QActionDefinition with Zod payload/result, targets, describe, authorize,
                    executor; registry accepts CONFIRM_REQUIRED only; deterministic action
                    and approval state machines; canonical-JSON SHA-256 exact-payload binding
                    over binding version/tenant/organisation/run/action/type/version/class/
                    targets/payload, no volatile field; hash at proposal, recomputed and
                    recorded at approval, recomputed at execution; server-derived approver;
                    requested-person + organisation-context + tenant ownership with one
                    not-found answer; q.action.approve at ORGANISATION scope + definition
                    authorize at proposal, approval and execution; clock-based expiry, no
                    sweeper; idempotency key q_action:<run>:<action>; gate claim → execute
                    outside tx → finalise; retry budget; UNKNOWN/thrown = RECONCILIATION_
                    REQUIRED never resent; LangGraph v5 action_prepare + approval_gate
                    interrupt, checkpoint never authority; run AWAITING_APPROVAL /
                    ACTION_EXECUTION with WAITING_FOR_APPROVAL / COMPLETING_APPROVED_ACTION;
                    audit q.action.proposed/approved/rejected/executed/execution_failed/
                    execution_blocked with actor Q + human authority; outbox
                    q.action.prepared/approved/rejected/executed/execution_failed v1; run
                    events q.action.proposed + q.approval.required; GET/approve/reject
                    routes with strict empty approve body and bounded reject reason; api-
                    client functions; test-only test.confirm_required executor, never in
                    production; production registry empty). Migration 20260908090000:
                    q_runtime.actions + q_runtime.approvals INTERNAL_SERVER_ONLY, role
                    capability q.action.approve for organisation_admin/member; pgTAP
                    rls/330_q_actions (31) + schema guard rows; db:types regenerated. Domain
                    error field is errorCode (a `code` field is treated as a driver failure
                    by the transaction manager — found by the integration suite). Doc 22 §80
                    expectedPayloadHash not accepted (server owns the fingerprint). No
                    Gmail/Calendar/Calendly/MCP/external side effect, no new ENV, no new
                    dependency. Gates 2026-09-05: see the CQ-Q-008 postflight. Uncommitted.
CQ-Q-009            VERIFIED   Resumable Q SSE Streaming — GET /v1/q/runs/:runId/events
                    (Server-Sent Events over the bearer-authenticated q-api; owner-only
                    through ownedRun, same 404 for colleague and foreign tenant; strict
                    Last-Event-ID header, no query cursor, no token in URL; event: =
                    QStreamEvent type, id: = durable per-run sequence, deltas carry no id;
                    heartbeat comments every 15 s; retry hint; replay after cursor in pages
                    with a 10 000 cap; replay/live race closed by subscribe-then-read-after-
                    cursor on every wake-up; wake-up = Postgres NOTIFY issued by the run-
                    event repository inside the append transaction (delivered on commit,
                    identifiers only) and LISTENed per instance, so a run executed on one
                    instance streams live from another; in-process bounded delta bus as the
                    seam for a streaming answer path; public projector = parse into the
                    closed contract; backpressure honoured with drain timeout and delta
                    dropping; per-person/per-run process-local limits (429); preClose
                    shutdown of streams + bounded connection drain; terminal runs replay then
                    close; disconnect never cancels; answer seam now appends
                    q.message.completed with the persisted message in the same
                    transaction; NewQConversationMessage.id optional for streaming
                    answers; api-client fetch-based SSE reader with conforming parser,
                    bounded jittered backoff, Last-Event-ID from the last durable
                    sequence, duplicate suppression, transport status separate from run
                    status, deterministic reducer; pnpm q:stream-smoke developer harness;
                    synthetic streaming answer for dev/tests). Schema impact NONE (no
                    migration; NOTIFY from code). No Redis, no WebSocket, no hosted
                    realtime, no voice, no new ENV, no new dependency. Model streaming:
                    NOT SUPPORTED BY ROUTED MODEL (all providers declare streaming:false
                    and the answer is a structured call) — production streams stages and
                    the persisted message, no fake deltas. Gates 2026-09-06: see the CQ-Q-009
                    postflight. Uncommitted.
CQ-Q-010            VERIFIED   Q eval harness skeleton + Wave-4 quality gate — packages/q-evals
                    (provider-agnostic: cases run through createRun + the LangGraph
                    orchestrator, Context Firewall, Prompt Registry, Model Gateway with the
                    real catalogue/policies, Tool Registry and Approval Engine; the only
                    substitution is the ModelProvider adapter — scripted under the real
                    provider codes in LOCAL_FAST/CI_CORE, real adapters in LIVE_MODEL, both
                    wrapped by a recorder so markers are graded on the provider input, the
                    answer, the events and the logs; typed Zod datasets/cases/results/
                    baselines; three SYNTHETIC_WITH_MARKERS datasets (golden DEVELOPMENT,
                    adversarial and regression HELD_OUT) = 29 cases incl. every doc-25
                    initial case; 11 hard invariants graded deterministically, listed first,
                    never averaged, any FAIL = exit 1; MINIMUM_QUALITY/COST/LATENCY report
                    WARN until thresholds are calibrated from baselines; RUBRIC and
                    HUMAN_REVIEW flags, MODEL_GRADED reserved only; profiles LOCAL_FAST,
                    CI_CORE, LIVE_MODEL (explicit opt-in, key PRESENCE only, synthetic only,
                    gateway budgets, --provider narrowing through the tenant policy seam),
                    STAGING_FULL/SCHEDULED_DEEP as contracts; baseline written only with
                    --update-baseline on a passing run; comparison utility; JSON +
                    summary reports under artifacts/q-evals (git-ignored); service name
                    q-evals and executionKind "eval"; a live provider that never serves a
                    run BLOCKS the case unless a restricted marker was observed. Findings:
                    cooperative cancellation completes the in-flight answer call
                    (QCANCEL-001 WARN); relationship subjects resolve in the company tenant
                    only; primary_description is network-visible by the Q-007 projection
                    (eval markers moved to founder-private rows; product question flagged);
                    no role grants company.financials.view. Schema impact NONE; no new
                    dependency, no new ENV, no external integration. Gates 2026-09-06: see
                    the CQ-Q-010 postflight. Uncommitted.
C4                  see the CQ-Q-010 postflight (criteria decided from evidence)
```

## Wave 5 — Q Knowledge / RAG / first intelligence

```
CQ-RAG-001          VERIFIED   Structure-preserving extraction + versioned chunks —
                    packages/q-knowledge (chunk contracts, slide/narrative/spreadsheet
                    chunking under q-chunking-v1 with parent-child for long sections,
                    sentence-safe cuts, header-repeating table cuts, bounded 10% prose
                    overlap; chunk sets with ACTIVE/SUPERSEDED/REVOKED lifecycle, one
                    ACTIVE set per document, idempotent on (version, extraction,
                    chunking version); inherited visibility/sensitivity refused if
                    widened or weakened; rebuild from the hash-verified artifact;
                    revocation), migration 20260908120000 (q_knowledge.chunk_sets,
                    q_knowledge.chunks, evidence.document_processing_runs.chunking_version;
                    RLS enabled, no policy; immutability triggers; rls/340, schema guard),
                    EVD-003 extractors reused and extended through the same
                    ContentExtractor boundary: XLSX (own OOXML reader, cached values
                    only, VBA project refused, sheet/row/column/cell limits) and CSV
                    (RFC 4180) as `spreadsheet_range` blocks with sheet/range/row
                    locators; worker pipeline gains the chunking stage after the
                    extraction is recorded and before completion; pnpm
                    rag:extract-smoke (six synthetic fixtures through the real sandbox)
                    and pnpm rag:rebuild-chunks. No embedding, no vector, no retrieval,
                    no chunk API, no model call, no new dependency, no new ENV, no
                    external service. Malware scanning still NOT IMPLEMENTED (default
                    policy blocks unscanned files before parsing). Gates 2026-09-06: see
                    the CQ-RAG-001 postflight. Uncommitted.
CQ-RAG-002          VERIFIED   Local embedding provider + Qwen3 embedding runtime —
                    packages/q-embeddings (provider-neutral EmbeddingProvider port with
                    embedDocuments/embedQuery/describe/health; provider, model and
                    configuration kept as three identities; versioned configuration
                    capital-q-qwen3-embedding-0-6b-1024-v1 pinning
                    Qwen/Qwen3-Embedding-0.6B at revision 97b0c614, native dimension 1024
                    with no Matryoshka truncation adopted, L2_UNIT normalisation produced
                    by the runtime and never applied twice, QUERY_ONLY instruction
                    strategy; one versioned V1 query instruction
                    capital-q-evidence-retrieval-v1 carrying no policy, documents embedded
                    uninstructed under the canonical marker none-v1; local TEI adapter
                    owning the only TEI HTTP shape in the repository, with composed
                    timeout + cancellation, status mapping, no credential and no runtime
                    text escaping it; vector validation refusing wrong dimension, NaN,
                    Infinity, empty and non-unit vectors and never resizing or
                    renormalising; bounded batching preserving caller order; health
                    checking the runtime's reported model_sha against the pinned
                    revision; deterministic fake provider so pnpm test needs no Docker,
                    model, GPU or network; work-key helper that deliberately carries no
                    tenant and is documented as not a cache key), packages/config
                    embeddings module (four NON-SECRET variables; endpoint must be
                    loopback or private), q-knowledge chunk-embedding seam that refuses
                    non-ACTIVE sets, infra/embeddings/docker-compose.yml on loopback with
                    a named weight volume, pnpm embedding:up/down/logs/health and
                    pnpm rag:embedding:smoke. Schema impact NONE; no migration, no
                    pgvector, no vector column, no index, no retrieval. External NONE: no
                    account, no API key, no paid service, $0. Gemini/Groq/ElevenLabs NOT
                    USED. Gates 2026-09-06: see the CQ-RAG-002 postflight. Uncommitted.
CQ-RAG-003          VERIFIED   Versioned pgvector embedding storage + semantic index
                    foundation — migration 20260909090000 (vector extension in the
                    extensions schema; q_knowledge.embeddings as native vector(1024)
                    with the recorded dimension CHECKed against vector_dims so metadata
                    cannot drift from payload; DIRECT tenant_id constrained by composite
                    FK to equal the chunk's tenant; model identity recorded on the row
                    rather than in ai_ops.models, which is the Model Gateway's
                    generation catalogue; unique work identity (chunk_id, model_code,
                    embedding_dimension, configuration_version, instruction_version) so
                    several models coexist per chunk and a retried or concurrent worker
                    collides instead of duplicating; ON DELETE CASCADE from the chunk so
                    no orphan vector outlives its provenance; UPDATE forbidden by
                    trigger; RLS enabled with no policy; one prefilter index, no vector
                    index), packages/q-knowledge embedding contracts, repository,
                    persistence + bounded resumable backfill and the internal
                    SemanticSearchPort (typed scope only: tenant, configuration,
                    dimension, bounded K ≤ 100, optional subjects and disclosure scopes;
                    query vector bound and cast, never interpolated; eligibility read
                    from the chunk's ACTIVE status so a revoked source cannot return
                    through a vector; cosine distance, lower is nearer, never a score),
                    rls/350 (26 tests), 9 integration tests including the cross-tenant
                    blocker, and pnpm rag:embed:backfill / rag:semantic:smoke. HNSW
                    DEFERRED on measurement: exact search is linear at ~10 µs/row
                    (2k rows 38 ms, 25k rows 258 ms) and the security filters are highly
                    selective, which is where ANN recall degrades. Real local Qwen
                    end-to-end smoke PASS: the seed-stage infrastructure passage ranks
                    above the cocoa exporter, the shipping schedule and an
                    instruction-shaped chunk. External NONE: no vector SaaS, no account,
                    no API key, no new ENV, $0. Gemini/Groq/ElevenLabs NOT USED. Gates
                    2026-09-07: see the CQ-RAG-003 postflight. Uncommitted.
CQ-RAG-004          VERIFIED   Hybrid authorised retrieval + Q evidence retrieval —
                    migration 20260910090000 (chunks.content_tsv as a STORED
                    generated column over to_tsvector('english', content), so a
                    lexical index cannot drift from immutable chunk text and no
                    backfill can be forgotten; GIN index; a security prefilter
                    index; q_knowledge.sensitivity_rank as an immutable,
                    search_path-pinned total order so a ceiling means the same
                    thing in SQL as in TypeScript). packages/q-knowledge gains
                    the authorised retrieval service: envelopeFromPlan projects
                    the Context Firewall's PermittedContextPlan into a
                    DISJUNCTION of constraints, each pairing subject with
                    disclosure scopes and a sensitivity ceiling — never
                    flattened, because unioning labels and subjects separately
                    would grant founder-private access to every company in the
                    tenant. Both halves apply that envelope IN the query above
                    the ranking (one bound jsonb parameter, expanded by
                    Postgres, so no permission check is ever built as text);
                    RRF fuses two already-authorised lists and can admit
                    nothing; hydration re-applies the whole envelope; parent
                    expansion resolves a parent on its own authority or keeps
                    the leaf. Lexical ORs the question's lexemes rather than
                    using websearch_to_tsquery, which ANDs terms and returned
                    zero candidates for every natural-language question in the
                    golden set. Q integration replaces the CQ-Q-003 placeholder
                    seam: the retrieval node reports whether the plan reaches
                    any corpus at all (it receives no message text by design),
                    and the answer's context port performs the one search of
                    the run and returns bounded, source-labelled facts as
                    USER_CLAIM / DOCUMENT_SUPPORTED inside the prompt's
                    untrusted fence. 24 unit + 10 service tests, 20 integration
                    tests (every security case makes the forbidden chunk the
                    BEST match: cross-tenant, founder-private into a
                    network-visible search, investor-private into a founder
                    search, another company in the same tenant,
                    relationship/specifically-shared, above-ceiling, archived
                    document, revoked set, superseded version, tsquery and SQL
                    operator syntax), rls/360 (22 tests), and 4 end-to-end Q
                    evidence tests through the REAL graph asserting against the
                    provider's recorded input. Measured baseline, real Qwen,
                    K=5: lexical R@5 85.7% MRR 0.67; semantic 100% / 0.78;
                    hybrid RRF 100% / 0.72. Unauthorised retrieval rate 0.
                    Reranker NOT IMPLEMENTED — the baseline is the argument it
                    must be justified against. External NONE: no search SaaS,
                    no vector SaaS, no reranker API, no account, no API key, no
                    new ENV, $0. Gemini/Groq/ElevenLabs NOT USED. Gates
                    2026-09-07: see the CQ-RAG-004 postflight. Uncommitted.
CQ-KNW-001          VERIFIED   Claims + evidence interpretation — the boundary between
                    what a source SAID and what Capital Q RECORDED. NO migration
                    and no new table: CQ-EVD-001's evidence.claims,
                    claim_revisions, evidence_items and claim_evidence are
                    reused unchanged, and idempotency is derived from
                    (source, locator, claim key) which they already store.
                    packages/evidence gains an interpretation layer —
                    ClaimProposal (untrusted whatever produced it),
                    ClaimProposerPort, deterministic policy, and a service
                    that persists ONLY through createClaim /
                    createEvidenceItem / linkClaimEvidence, so authorisation,
                    audit, events and the axis rules all still apply. The
                    proposal type has no field for tenant, visibility,
                    sensitivity, evidence status, lifecycle, author,
                    confidence, weight or any id; it has no truth-class field
                    either. A proposer names SOURCE_ASSERTION /
                    SOURCE_ESTIMATE / MODEL_INFERENCE and policy maps that —
                    VERIFIED is not filtered out, there is no branch that
                    returns it, and the database refuses it independently.
                    Vocabulary reconciled to ADR-001: a deck's own ARR is
                    truth_class USER_CLAIM with evidence_status
                    DOCUMENT_SUPPORTED, because "document supported" is an
                    evidence status here and collapsing the axes is how a
                    deck becomes verification. Excerpts must appear verbatim
                    in the passage (which is what stops general model
                    knowledge becoming entity evidence); currency is never
                    inferred or converted; asOf is the source's period or
                    null. Visibility narrows or holds, sensitivity climbs
                    only, reliability is a class not a score. A second source
                    agreeing links SUPPORTS; disagreeing links CONTRADICTS
                    and HOLDS without revising, superseding or preferring
                    either number — the input CQ-KNW-003 needs. When no
                    provider may receive the source's sensitivity the result
                    is blocked: PROVIDER_INELIGIBLE, nothing recorded and
                    nothing relabelled (verified live: both providers refused
                    a CONFIDENTIAL source with SENSITIVITY_EXCEEDS_CEILING at
                    attempts 0). Prompt claim-extraction/v1 registered and
                    hash-pinned; model path behind
                    @capital-q/model-gateway/extraction so Evidence stays
                    model-free. 25 unit + 19 integration tests (9 BLOCKERs:
                    cross-tenant source, wrong subject, fabricated document
                    version, another tenant's version, founder-private and
                    investor-private inheritance, a source demanding VERIFIED
                    and public, a fabricated excerpt, a key outside the
                    permitted set, a count in currency). pnpm
                    knowledge:claims:smoke, free and deterministic; --live
                    measured at groq/openai/gpt-oss-20b, 2.0 s, $0.00057. No
                    new service, account, API key or ENV. No Q Knowledge
                    Object, no canonical company mutation. Gates 2026-09-07:
                    see the CQ-KNW-001 postflight. Uncommitted.
CQ-KNW-002          VERIFIED   Q Knowledge Objects + deterministic Knowledge Write Gate
                    — what Capital Q understands, kept apart from what a source
                    said. Migration 20260911090000 creates q_knowledge.objects,
                    revisions, object_evidence, object_sources and lineage; the
                    Evidence and RAG migrations are untouched. Objects carry the
                    three ADR-001 axes plus a confidence CLASS a named rule
                    produced, direct tenant ownership, one ACTIVE understanding
                    per (subject, key), append-only revisions, immutable identity
                    and RLS on with no policy. Three independent layers make
                    VERIFIED unreachable: the candidate enum has no such member,
                    the policy has no branch that returns it, and the database
                    refuses it without EXTERNALLY_VERIFIED or PLATFORM_VERIFIED
                    evidence. KnowledgeCandidate is .strict() with no field for
                    tenant, visibility, sensitivity, status, confidence, evidence
                    status or any canonical company value, so a candidate
                    carrying status ACTIVE or confidence 0.92 is refused at the
                    schema. Confidence is nine ordered named rules — conflict and
                    withdrawal first, HIGH reachable only from verified evidence
                    — and no percentage exists anywhere in the path. Visibility
                    takes the NARROWEST input scope and sensitivity the
                    STRONGEST, with a CONFIDENTIAL floor for combination risk.
                    MULTI_SOURCE_SUPPORTED requires genuinely distinct sources.
                    A conflicting candidate is HELD and the active object gains a
                    revision moving it to CONFLICTING_EVIDENCE plus a `reassesses`
                    lineage edge: both readings kept, neither chosen, which is
                    what CQ-KNW-003 needs. reassessForWithdrawnEvidence
                    re-derives confidence when support disappears without
                    deleting or rewriting anything. Reads go through
                    KnowledgeQueryService under the same envelope CQ-RAG-004
                    uses, ACTIVE only, applied in the query; Q's answer context
                    now offers knowledge before the passages it came from, with
                    confidence as a word. Canonical state, the Data Room and
                    recommendation features are untouched — the table has no
                    column for any of them. 28 unit + 18 integration tests
                    (KNWW-001..008 named in the integration suite, with the
                    reasoning for that placement in its header) + rls/370 (32
                    tests) + schema guard rows. pnpm knowledge:write:smoke, free
                    and deterministic. No new service, account, API key or ENV;
                    no live model call anywhere in this packet. Gates 2026-09-07:
                    see the CQ-KNW-002 postflight. Uncommitted.
CQ-KNW-003          VERIFIED   Contradictions, temporal knowledge and revision
                    resolution — a metric that has a history, and disagreement
                    with somewhere durable to live. Migration 20260912090000
                    adds definition_qualifier, measurement_basis and
                    last_verified_at to objects, replaces the one-ACTIVE-per-key
                    index with one per (subject, key, definition, basis,
                    period), adds an effective-date index, adds
                    revisions.correction_of_revision_id, and creates
                    contradiction_sets + contradiction_members with an identity
                    trigger and RLS on with no policy. "Current" stops being a
                    status and becomes the latest effective reading, where
                    effective is coalesce(valid_from, recorded_at) — the same
                    expression the index orders by. compareKnowledge examines
                    metric, period, definition, basis, value kind and currency
                    BEFORE calling anything a conflict, so growth, a second
                    definition and a forecast are never reported as
                    discrepancies; different currencies are INCOMPARABLE rather
                    than contradictory because deciding would mean inventing an
                    FX rate. Materiality is UNDETERMINED for every genuine
                    conflict — no calibrated methodology exists here and one was
                    not invented. correctsEarlier is a REQUEST: the gate reads it
                    only after isCorrectionOf confirms the periods match, so no
                    candidate can supersede an inconvenient figure by claiming to
                    correct it; the earlier reading becomes SUPERSEDED with a
                    `supersedes` lineage edge, never deleted. A conflict holds the
                    challenger, moves the incumbent to DISPUTED at
                    CONFLICTING_EVIDENCE and opens — or joins — a contradiction
                    set that inherits its members' visibility and sensitivity, so
                    "these two figures conflict" is never filed more openly than
                    the figures. settleContradiction requires a HUMAN actor and
                    every member survives the decision. Reads gain currentForKey,
                    currentForSubject, asOfForKey, historyForKey and
                    disputesForSubject; a dispute returns every authorised member
                    or nothing, and the "is there a later reading" predicate
                    carries the SAME envelope so an unauthorised founder-private
                    figure can never suppress an authorised earlier one.
                    Freshness is a declared per-key policy
                    (knowledge-freshness-v1) with a rationale on each rule; a key
                    with no rule never ages; reassessForFreshness marks STALE and
                    touches lifecycle only — scope and sensitivity are untouched,
                    because age qualifies an answer and never widens who may hear
                    it. 27 new unit tests (KNWC-001..012) + 9 new integration
                    tests (KNW3-001..009) + rls/380 (31 tests) + schema guard
                    rows; the whole RLS suite is 838 tests across 29 files. pnpm
                    knowledge:temporal:smoke, free and deterministic. No new
                    service, account, API key or ENV; no model call anywhere in
                    this packet. Gates 2026-09-07: see the CQ-KNW-003 postflight.
CQ-Q-020            VERIFIED   Company Intelligence specialist — Q's first real
                    specialist capability, packages/q-specialists (the bounded
                    QSpecialist contract under one Q; createCompanyIntelligence-
                    Specialist; createSpecialistQAnswer implementing the runtime's
                    existing QAnswerPort so the graph, firewall, lifecycle and
                    stream are untouched and an unsupported request falls through
                    to the conversational path). One bounded investigation:
                    canonical structured state through the Safe Read tools called
                    DETERMINISTICALLY (never offered to the model) -> authorised Q
                    Knowledge (current/as-of/series/disputes under the plan's own
                    envelope) -> ONE authorised hybrid retrieval search with the
                    person's own words -> deterministic findings -> ONE model call
                    -> validated model findings. Contradictions, staleness,
                    material changes, gaps, evidence coverage and information
                    confidence are COMPUTED, never asked, and become the trusted
                    frame the prompt tells the model it may not overturn: those
                    are exactly the statements a fluent model gets wrong in the
                    direction that flatters. Citation is by opaque per-render
                    label (F1..Fn) resolved server-side, so a model never writes
                    an identifier and citation fabrication is inexpressible rather
                    than merely discouraged; an invented label is dropped and
                    counted. validateModelFindings drops (never repairs) findings
                    that assert a score/fit/probability/peer benchmark, that make
                    an unsupported entity-specific material claim, or that would
                    upgrade truth class beyond what they cite; absence becomes GAP
                    whatever type the model chose. VERIFIED is reachable only by
                    restating something already verified upstream. COMPANY_ANALYST
                    v2 ACTIVE (EVIDENCE_SYNTHESIS), v1 DEPRECATED but retained
                    immutable with its hash unchanged; every new output field is
                    defaulted so the conversational path is unaffected. NO score,
                    fit, funding probability, InvestIQ methodology or peer
                    benchmark; NO canonical mutation, NO consequential action, NO
                    knowledge write, NO provider SDK, NO SQL, NO web/connector.
                    Findings: the developer smoke surfaced that evidence coverage
                    read from facts alone reported INSUFFICIENT beside findings
                    plainly resting on documents (a retrieved passage carries no
                    dimension), fixed by reading coverage from the findings' own
                    support; and that a reading swept to STALE leaves
                    currentForSubject entirely, so the specialist stops seeing it
                    rather than reporting its age — a real CQ-KNW-003/CQ-Q-020
                    seam, recorded rather than papered over. Schema impact NONE;
                    migration NONE; no new service, account, API key, ENV, paid
                    service or model. Gates 2026-09-07: see the CQ-Q-020
                    postflight.
CQ-Q-021            PARTIAL    Founder Onboarding Q + document-assisted adaptive
                    interview. LANDED AND VERIFIED: founder definition v2
                    (migration 20260913090000, generated from the manifest) makes
                    F2 a REAL document_upload against the existing Evidence upload
                    API instead of v1's checkbox declaration whose own copy said
                    "uploading arrives in a later release"; v1 stays published and
                    immutable and v2 inherits every step it did not replace
                    verbatim (drift-guarded by test). Web: a document_upload
                    renderer with a keyboard-reachable file picker (drag/drop is an
                    enhancement, never a requirement), real processing states from
                    the version's own status — a queued file says it is waiting
                    rather than showing a spinner over work that has not started —
                    a first-class skip path, privacy stated in the open, and
                    server actions that carry the HttpOnly session token
                    server-to-server through the real create-session ->
                    signed-target -> complete sequence. FOUNDER_ONBOARDING_EXTRACTION
                    v2 ACTIVE (v1 DEPRECATED, immutable, hash unchanged): source
                    passages cited by opaque per-render label so the model never
                    writes an identifier and citation fabrication is inexpressible;
                    taxonomy candidates as plain phrases mapped by Capital Q's own
                    service; conflicts as two readings plus a settling question;
                    ambiguity as its own finding; proposed questions bounded and
                    restricted to keys the SERVER said are unanswered. Extraction
                    service resolves citations, refuses VERIFIED a second time
                    after the schema already excludes it, and drops a specific
                    figure with nothing behind it. Deterministic adaptive planner:
                    never asks what is answered or awaiting confirmation, never
                    asks a metric this business shape does not produce, maps every
                    question to a real step, orders contradiction > required > gap,
                    and bounds the count. Review bridge turns a processed document
                    into suggestions (never responses, never canonical writes) and
                    replans the questions around them; safe to run twice.
                    NOT LANDED: the F3 screen does not yet render those
                    suggestions, F7/F8 are not wired to the live session, nothing
                    in production yet triggers the review when processing
                    completes, and the DB-backed integration tests, QFO eval suite,
                    Playwright E2E and developer smoke are absent. Malware
                    scanning remains NOT IMPLEMENTED: REQUIRE_CLEAN is the default
                    and an unscanned document is BLOCKED, not parsed. Schema
                    impact: one onboarding definition-version migration; no new
                    core table. No new service, account, API key, ENV, paid
                    service or model. Gates 2026-09-07: see the CQ-Q-021
                    postflight.
CQ-Q-022            PARTIAL    Investor Mandate Q. The canonical mandate
                    architecture was already complete (CQ-INV-002: versioned
                    core.investor_mandates, core.investor_mandate_constraints with
                    a closed dimension allowlist, a closed operator set, the
                    MUST/STRONG/NICE/NEUTRAL/AVOID/HARD_EXCLUSION scale and a DB
                    CHECK keeping importance and is_hard_exclusion in lockstep,
                    plus InvestorMandateSnapshot as the Wave-6 handoff), and the
                    I0-I12 journey and its review screen were already built
                    (CQ-ONB-003). What was missing was Q: the synthesis prompt
                    existed and NOTHING CALLED IT. LANDED AND VERIFIED:
                    INVESTOR_MANDATE_SYNTHESIS v2 ACTIVE (v1 DEPRECATED, immutable,
                    hash unchanged) adds AVOID to the strength scale — v1 had only
                    HARD/STRONG/PREFERENCE and therefore could not express a soft
                    negative at all, which is the packet's central distinction —
                    renames HARD to EXCLUSION_CLAIMED to mark it as a reading
                    rather than a decision, ties ambiguity to a dimension and kind
                    (SCOPE_OR_EXCLUSION, TYPICAL_OR_LIMIT, IMPRECISE_VALUE) with
                    the neutral question that settles it, keeps sector language as
                    plain phrases for Capital Q's own taxonomy service, and reports
                    protected-trait screening rather than encoding it. Semantics
                    layer makes HARD_EXCLUSION UNREACHABLE from model output:
                    preferenceClassFor has no branch returning it and the only
                    function that does takes the investor's confirmation as an
                    argument, so silence, a firm tone or a forgotten flag can never
                    make a candidate ineligible. Synthesis service: one gateway
                    call, refuses to re-propose a dimension already answered by
                    selection (never broadens), files no constraint for an
                    unresolved taxonomy phrase (a free string would look like a
                    filter while matching nothing), records the session revision so
                    a stale result cannot overwrite newer choices, and reports a
                    protected-screening request in the open. Confirmation gate maps
                    a confirmed exclusion to HARD_EXCLUSION and derives
                    isHardExclusion from the same source so the two cannot
                    disagree; sameMandate makes a repeated confirmation idempotent
                    by semantic content rather than row order. Inferences,
                    observed behaviour and tensions exist but are structurally
                    excluded from what confirmMandate returns, so neither can reach
                    a declared mandate. NOT LANDED: the I11 review screen still
                    renders the deterministic projection of what the investor
                    selected rather than Q's reading; nothing calls the synthesis
                    from the live session; the QIM Playwright E2E, the DB-backed
                    integration tests and the developer smoke are absent. No
                    ranking, no fit score, no feed — none claimed. Schema impact
                    NONE; migration NONE (the existing schema represents
                    everything). No new service, account, API key, ENV, paid
                    service or model. Gates 2026-09-08: see the CQ-Q-022
                    postflight.
CQ-Q-023            DEFERRED_BY_DEPENDENCY
                    Recommendation / Fit Explanation Q. NOT IMPLEMENTED, and must
                    not be until a deterministic recommendation factor model
                    exists. Doc 25 C5: "No recommendation explanation by Q before
                    deterministic factor model exists."
                    ACTIVATION DEPENDENCY: the versioned feature snapshot,
                    ranking configuration, factor contributions and reason codes
                    — expected around CQ-REC-004. A later agent MUST return to
                    this row once that lands; nothing else in the repository
                    will prompt for it.
                    Verified absent at this build: no recommendation package, no
                    recommendation/ranking/slate table, no feature or ranking
                    version, no reason-code catalogue, no explanation service, no
                    Q production fit-explanation route. FIT_EXPLANATION v1 is
                    registered in the Prompt Registry and has ZERO callers — it
                    stays versioned and dormant, and was not modified.
                    ARCHITECTURE VIOLATION FOUND AND FIXED: both Q answer seams
                    wrote the model's `answer` prose to the stored Q message with
                    only a length trim. COMPANY_ANALYST v2 forbids scores, fit,
                    probabilities and benchmarks, and CQ-Q-020's validation drops
                    FINDINGS asserting one, but neither reached the text a person
                    actually reads — so a fluent or injected model could have
                    published "this is a 91% fit for Apex" as a Capital Q
                    recommendation explanation that no ranker produced. A guard
                    now sits on the last surface before the message is stored, in
                    q-core beside the existing communication rules (both seams
                    depend on q-core; q-specialists depends on model-gateway, so
                    the guard could not live in either seam without a cycle). It
                    removes the offending sentence rather than rewriting it — a
                    rewritten explanation is one nobody wrote — and substitutes a
                    plain message when nothing honest survives. Twenty cases,
                    written failing first: 20/20 failed before the guard existed.
                    When the factor model lands the guard is not deleted; it
                    becomes the check that an explanation cites factors the
                    ranker actually produced.
                    No ranker, no factor model, no recommendation contract, no
                    fit score and no temporary pseudo-ranker were introduced.
                    Schema impact NONE; migration NONE; no new service, account,
                    API key, ENV or paid service; ZERO live model calls.
C5                  FAIL       First Q Intelligence integration gate. Every
                    Wave-5 LAYER is real and verified; NONE of it is composed
                    into the running application.
                    THE FINDING: apps/q-api/src/main.ts wires
                    `retrieval: createUnconfiguredQRetrieval()` and calls
                    createModelGatewayQAnswer with no `context` port, so the
                    production seam falls back to `noAuthorisedContext` — whose
                    own text reads "no subject context is available in this
                    environment (retrieval is not implemented yet)". apps/q-api
                    imports neither @capital-q/q-knowledge nor
                    @capital-q/q-specialists. In the deployed product Q therefore
                    answers with ZERO authorised facts: no RAG-004 retrieval, no
                    KNW knowledge, no Company Intelligence specialist. Separately,
                    grep for production callers finds NONE for
                    createFounderExtraction, createFounderReview, draftSuggestions,
                    createMandateSynthesis or confirmMandate; the only caller of
                    createCompanyIntelligenceSpecialist is the q-evals dev smoke.
                    This is accumulated un-wired integration rather than a
                    regression — each packet built its layer and left composition
                    to a later one, exactly as RAG-004's postflight said — and it
                    is precisely what an integration checkpoint exists to catch.
                    C5 PASS conditions 2, 6 and 7 (founder document-assisted
                    intelligence end to end; uploaded evidence reusable by Q;
                    RAG retrieves authorised evidence) do not hold IN THE PRODUCT.
                    WHAT IS VERIFIED: the same paths work end to end through the
                    real Q graph in the eval world — createRun, LangGraph
                    orchestrator, Context Firewall, Safe Read tools, Q Knowledge,
                    hybrid retrieval, Model Gateway — proven by QCI-001..017
                    (17/17) including founder-private, cross-tenant, source
                    existence and injection as hard invariants. Integration suite
                    422/427 passed (5 skipped, 0 failed), RLS 839/839, evals 29/29
                    with no baseline regression, repository gate 2096/2096.
                    THREE STALE EXPECTATIONS FOUND AND FIXED, all consequences of
                    Wave-5 version bumps that `pnpm test` alone could not surface
                    because it excludes integration and pgTAP:
                    founder-onboarding.integration (definitionVersion 1->2, F2 now
                    document_upload so the flow skips it, materials becomes a
                    genuine open gap), q-orchestrator answer-seam.integration
                    (company-analyst v1->v2 bundle), and rls/240 ("points new
                    sessions at version 1" -> version 2, plus a new assertion that
                    both versions stay published). Also found: the local database
                    held a v2 definition published BEFORE its context keys were
                    corrected; db:reset republished the current migration.
                    Test-weakening audit across the whole wave: 7017 test lines
                    added, 14 removed, every removal a version-bump expectation
                    replaced by an equal or stronger assertion; no .only, no .skip,
                    no broadened matcher, no deleted security case.
                    REMEDIATION FOR C5 RE-RUN: compose createQEvidenceRetrieval,
                    createKnowledgeQueryService and createSpecialistQAnswer into
                    apps/q-api; trigger the founder review when a document
                    finishes processing; call the mandate synthesis from the
                    investor session; render F3/F7/F8 and I11. No new architecture
                    is required — every seam already exists and is tested.
CQ-C5-R1            PARTIAL    Wave-5 production composition. Closes the FIRST
                    HALF of the C5 gap; C5 itself stays FAIL until the rest is
                    done. Recorded honestly rather than as a pass, because a
                    checkpoint that moves for partial work stops being one.
                    DONE — Q API composition (packet Part A). apps/q-api now
                    composes the real Wave-5 path in
                    apps/q-api/src/composition/q-intelligence.ts: authorised
                    hybrid retrieval (CQ-RAG-004) with the local query-embedding
                    runtime, the authorised Knowledge query service
                    (CQ-KNW-002/003), the Company Intelligence specialist
                    (CQ-Q-020) behind the existing answer seam, and — the exact
                    thing C5 found missing — the real authorised `context` port
                    on createModelGatewayQAnswer. `createUnconfiguredQRetrieval`
                    is gone from apps/q-api/src/main.ts; sensitivity is FROM_PLAN
                    rather than the smoke's DECLARED_SYNTHETIC, so provider
                    eligibility is decided from the plan's own ceiling.
                    VERIFIED IN A LIVE PROCESS, not only in tests: q-api logs
                    `q intelligence composed` with all four capabilities true,
                    and a real browser question produced a run whose log shows
                    company.get executed, knowledgeReads=2, retrievalCalls=1,
                    facts=2 and `company intelligence completed`. Six composition
                    tests hold the wiring itself (C5R1-001..003), each keyed to a
                    tell that cannot pass by accident — an unconfigured retrieval
                    port can only answer NOT_CONFIGURED, and noAuthorisedContext
                    has its own sentence that must not reach the prompt.
                    DONE — visual Q (packet Part B). The Home QComposer, present
                    but deliberately unwired since the design system landed, now
                    calls the real Q API: create run, append turn, cancel, and
                    the CQ-Q-009 SSE client through one single-purpose Next route
                    that attaches the HttpOnly session token server-side. No
                    catch-all proxy: the browser gets one run's event stream and
                    nothing else of the Q API's surface. Turns, streaming text,
                    plain working stages from Q_VISIBLE_STAGE_LABELS, Stop,
                    plain failures from the contract's own public projection, and
                    server-side persistence with the active conversation restored
                    after a refresh. Verified in a real browser against the real
                    services end to end.
                    TWO DEFECTS FOUND BY RUNNING THE PRODUCT, both fixed:
                    (1) Q's answer rendered ABOVE the question it answered,
                    because the run persists Q's message as a durable event while
                    the person's own turn is still an unconfirmed placeholder —
                    turns are now ordered by when they happened, and the case is
                    a test; (2) F2 (CQ-Q-021's document upload) rendered with no
                    heading and no styling at all: it never called StepHeading
                    and its `cq-materials*` class names are defined in no
                    stylesheet. Nothing caught either, because no test renders a
                    step and no E2E covers F2.
                    NOT DONE — packet Parts C, D and E. Founder document ->
                    review trigger, F3/F7/F8, investor mandate synthesis caller,
                    I11, and the C5 demo command are NOT implemented. The
                    production-caller audit therefore still finds NONE for
                    createFounderExtraction, createFounderReview,
                    draftSuggestions, createMandateSynthesis and confirmMandate.
                    BLOCKING FINDING FOR THE HUMAN — no configured provider may
                    see a founder's own company. Every plan includes
                    OWN_Q_CONVERSATION, which the firewall catalogue classifies
                    CONFIDENTIAL, so maxSensitivity is CONFIDENTIAL on every Q
                    run; both seeded providers are UNREVIEWED with model ceilings
                    of PUBLIC (google) and INTERNAL (groq). The gateway therefore
                    refuses every route with SENSITIVITY_EXCEEDS_CEILING and Q
                    answers with the honest "too sensitive to send for analysis"
                    message. This is the Context Firewall and doc 15 §88 working,
                    not a bug, and it is PRE-EXISTING — it was equally true
                    before this packet; production simply never reached the
                    gateway with a real plan, so nothing could observe it.
                    Clearing it is a data-governance decision about a provider's
                    data-processing terms (privacy_policy_class, zero retention,
                    a model's sensitivity_ceiling), which belongs to a person and
                    not to an agent. NOT CHANGED HERE.
                    Also observed: the local embedding runtime was not running,
                    so retrieval degraded to lexical and said so in its own
                    diagnostics — the designed behaviour, and evidence that the
                    degradation path is honest rather than silent.
                    One configuration addition, flagged before it was made:
                    CQ_Q_API_URL, OPTIONAL, naming the q-api deployable the web
                    app talks to. No new service, account, key, paid service or
                    model. Unset, the composer keeps its previous honest "Q isn't
                    connected" state and nothing changes. Schema impact NONE;
                    migration NONE.
CQ-C5-R2A           PARTIAL    Reliable authentication, provider privacy unblock and
                    live Q proof. The Q half is DONE and proven live; the
                    authentication half is done in code and waits on two
                    console actions only a person can take.
                    THE HEADLINE: Q now gives a real, substantive, grounded
                    answer in the browser. "Analyse Northstar." reached the
                    Home composer, the real q-api, the Context Firewall
                    (OWN_COMPANY_QUESTION, maxSensitivity CONFIDENTIAL,
                    AUTHORISED), authorised Knowledge and retrieval, the
                    Company Intelligence specialist, and an APPROVED Groq
                    route -- provider groq, model openai/gpt-oss-120b, 5
                    findings, blocked null. Follow-ups continued the same
                    server conversation and stayed grounded; asked "What
                    evidence supports that?" Q named the two authorised facts
                    with their truth class and evidence status and said they
                    were self-reported and unverified. Four successful live
                    calls, 14,802 input / 9,826 output tokens, ~6.4s per
                    EVIDENCE_SYNTHESIS call, USD 0.0117 total.
                    HOW THE BLOCK WAS CLEARED, AND HOW IT WAS NOT. The C5-R1
                    finding was that every Q request is at least CONFIDENTIAL
                    (OWN_Q_CONVERSATION is classified CONFIDENTIAL and appears
                    in every plan) while both providers sat UNREVIEWED at
                    PUBLIC/INTERNAL. NOTHING WAS RECLASSIFIED: the firewall
                    catalogue is untouched and the plan is still CONFIDENTIAL.
                    What changed is one vendor's reviewed terms, recorded as a
                    dated migration -- groq to NO_TRAINING_ZERO_RETENTION with
                    supports_zero_retention true and its two models raised to
                    CONFIDENTIAL. Zero Data Retention being ENABLED is an
                    assertion made by the human operator on 2026-09-08 and is
                    labelled as such IN THE ROW, because no process here can
                    read a vendor console. Gemini is deliberately untouched:
                    its free-tier terms permit training on content, so it stays
                    UNREVIEWED at PUBLIC and remains available for public and
                    synthetic work only.
                    A GAP FOUND AND CLOSED WHILE DOING IT: eligibility read
                    only the MODEL's ceiling, so one edit to one row could have
                    sent confidential customer data to an unreviewed vendor
                    with nothing in the system objecting. `providerJustifiedCeiling`
                    is now a second, independent limit -- UNREVIEWED and
                    TRAINING_PERMITTED justify PUBLIC, NO_TRAINING_DEFAULT_RETENTION
                    INTERNAL, NO_TRAINING_ZERO_RETENTION CONFIDENTIAL only when
                    zero retention is actually enabled, ENTERPRISE_CONTRACT
                    CONFIDENTIAL -- and NO class reaches HIGHLY_CONFIDENTIAL or
                    RESTRICTED, by construction. 14 tests, each using a model
                    whose own ceiling admits the request so the refusal can
                    only be the provider gate. The pgTAP expectations moved
                    with the policy and got stronger: "no model is cleared for
                    confidential data" became "no model is cleared ABOVE
                    confidential" plus a join proving every CONFIDENTIAL model
                    sits behind a provider whose review justifies it.
                    AUTHENTICATION -- DIAGNOSED. The email failure was never an
                    SMTP bug. `.env.local` points the whole application at
                    hosted project vcohxiqsmnkzxnvawgri, whose auth settings
                    report mailer_autoconfirm false (so signup REQUIRES a
                    confirmation email) and google false. Worse, that project
                    has NONE of Capital Q's schemas -- no core, ai_ops,
                    q_runtime, q_knowledge, evidence or onboarding, only
                    auth.users -- so even a successful sign-in reaches an
                    application that cannot work. The local stack, which has
                    every migration, sends to Mailpit and was rate-limited to
                    2 emails/hour, which reads as "email is broken" within one
                    minute of testing; raised to 30 for LOCAL only, where no
                    message reaches a real inbox. Hosted rate limits and SMTP
                    are untouched.
                    GOOGLE SIGN-IN -- BUILT, INERT UNTIL ENABLED. Through
                    Supabase Auth, not beside it: signInWithOAuth on the server
                    so the PKCE verifier cookie is written where the callback
                    can read it, the existing callback exchanging the code, and
                    the same redirect allow-list every emailed link already
                    uses, so no ?next=https://evil survives a round trip
                    through Google. No new auth library, no provider token
                    persisted, no scope beyond identity. The control renders
                    only when the Auth server itself reports the provider
                    enabled, asked of /auth/v1/settings rather than declared in
                    a second switch that could disagree with the truth in
                    either direction -- verified in the browser, where it is
                    correctly absent today. Email and password are untouched
                    and remain a first-class way in.
                    ALSO FIXED: reload restored only the LAST run's turns,
                    because each question is its own run and the restore read
                    one. It now remembers the conversation's run ids and reads
                    each back from the server; the turns are still never
                    cached. Verified across a two-run conversation.
                    HUMAN ACTION REQUIRED, and nothing here works around it:
                    enable Google in the hosted Supabase dashboard with the
                    existing OAuth client, and decide whether the hosted
                    project gets Capital Q's schema or the product runs
                    locally. Neither is an agent's decision.
                    New service NONE; new API key NONE; new paid service NONE;
                    Qwen, Gemini and Groq unchanged as services; ElevenLabs
                    NOT USED.
CQ-C5-R2B           PARTIAL    Founder production integration. The founder
                    document path is REAL and proven end to end in the
                    browser; the investor path and F7 are NOT done, so C5
                    still FAILS.
                    WHAT NOW WORKS, VERIFIED LIVE, NOT ONLY IN TESTS:
                    a founder uploads a deck at F2 -> the real Evidence upload
                    API issues a signed target and the browser puts the bytes
                    into private storage -> an immutable version and a
                    processing job -> the pipeline parses, extracts and chunks
                    -> evidence.document.ready on the outbox -> the worker's
                    new founder-review caller -> ONE governed Groq call under
                    the reviewed CONFIDENTIAL ceiling -> validated candidates
                    -> onboarding suggestions -> F3 shows "What Q read in your
                    documents" -> the founder confirms -> the onboarding
                    runtime validates it against the pinned step -> the
                    company's canonical primary_description is what Q read.
                    Confirmed in the database: suggestion ACCEPTED, and
                    core.companies.primary_description holds the sentence from
                    the deck.
                    THREE PRE-EXISTING DEFECTS FOUND BY RUNNING IT, all fixed,
                    none of which any test could have caught because no test
                    ran the real pipeline:
                    (1) DOCUMENT PROCESSING HAD NEVER COMPLETED. The run
                    completion wrote its metadata as ${JSON.stringify(x)}::jsonb;
                    the driver JSON-ENCODES a parameter cast straight to
                    jsonb, so the column received a jsonb STRING and the
                    table's jsonb_typeof(metadata) = 'object' check rejected
                    every row. Every other repository in the tree uses
                    ::text::jsonb; this one site did not. Nothing could ever
                    reach evidence.document.ready, which is why the founder
                    document path had never run.
                    (2) EVERY SUGGESTION Q PRODUCED WAS SILENTLY REFUSED.
                    draftSuggestions emitted { text } where the onboarding
                    response contract is a union tagged by `type`, so the
                    runtime rejected each one at validation. The CQ-Q-021
                    suite stayed green throughout because it only asserted the
                    draft's own shape, never that the runtime accepts it.
                    QFOU-009 now parses every draft with the real
                    OnboardingResponseValueSchema.
                    (3) use_of_funds WAS LISTED AS FREE TEXT while its step is
                    a multi_select over a fixed vocabulary, so its suggestion
                    could never be accepted. Removed, and the test now asserts
                    every directly-suggestable key against the PUBLISHED
                    definition's step type, so the set cannot drift again.
                    Also: STRUCTURED_EXTRACTION's output budget was 2,048
                    tokens, which truncated the founder extraction mid-JSON
                    and spent the whole call for nothing. Raised to 6,144 in
                    the one place budgets are decided.
                    ALSO WIRED: F2's upload, whose server actions CQ-Q-021
                    wrote and never connected to the client — the composer
                    said "uploading isn't available here" while the whole
                    Evidence path sat ready. F8 now asks the SAME production Q
                    boundary the Home composer asks, so the founder's first
                    intelligence is the same Company Intelligence specialist
                    rather than a second analyst; it renders only when the
                    session is bound to a company. F3 confirm, change and
                    decline all go through the existing resolve contract.
                    NOT DONE: F7 adaptive follow-up (the planner runs and its
                    questions are counted, but nothing persists a model-
                    proposed question, so F7 still renders the static long
                    text); investor mandate synthesis caller; I11; mandate
                    confirmation; the C5 demo command. C5 pass conditions 6
                    and 7 therefore do not hold.
                    THE INVESTOR DESIGN QUESTION, unanswered on purpose: a
                    mandate synthesis result has nowhere to live. Onboarding
                    suggestions cannot carry it (a constraint is not a valid
                    answer to a step), and core.investor_mandates could hold a
                    DRAFT with constraints — which is probably right, and is a
                    decision about canonical state that belongs to a person
                    rather than to an agent mid-packet.
                    Two policy-era integration expectations moved with the
                    R2A provider review and got stronger: both now assert that
                    CONFIDENTIAL routes only to the reviewed provider and that
                    RESTRICTED is still refused before any provider is called.
                    Sixteen integration failures remain, all in the three
                    q-evals suites. They fail IDENTICALLY at 6a3fd3c, whose own
                    postflight recorded the suite fully green, so they are
                    environmental or data-state rather than a regression from
                    this packet or R2A. Not isolated; recorded rather than
                    hidden.
                    Schema impact NONE; migration NONE. New service NONE; new
                    account NONE; new API key NONE; new ENV NONE — the worker
                    reads the same GEMINI_API_KEY and GROQ_API_KEY q-api
                    already reads. Qwen, Gemini, Groq unchanged; ElevenLabs
                    NOT USED.
```

## Architecture coverage (doc 25 §198) — Q rows

| Architecture requirement                                                                     | Implementation                                                 |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Q public contract describes capability (12 §7)                                               | CQ-Q-001                                                       |
| Q request envelope, actor/tenant server-derived                                              | CQ-Q-001 (shape), CQ-Q-002 (resolution)                        |
| Run status ≠ visible stage (12 §9, §37.1)                                                    | CQ-Q-001                                                       |
| Structured result blocks (12 §44, §70)                                                       | CQ-Q-001                                                       |
| Safe evidence references (12 §46.3, 22 §192)                                                 | CQ-Q-001 (shape), CQ-Q-004 (rights per scope)                  |
| Typed UI intents, no browser code (12 §70)                                                   | CQ-Q-001                                                       |
| Proposal ≠ approval ≠ execution (12 §31, 22 §79)                                             | CQ-Q-001 (shape), CQ-Q-008 — actions/approvals rows, gate      |
| Typed resumable stream events (22 §71-74)                                                    | CQ-Q-001 (shape), CQ-Q-009 — SSE route, replay, client         |
| No chain-of-thought event (22 §72, TM-Q-12)                                                  | CQ-Q-001 + q-stream/q-surface tests                            |
| Public-safe failures (22 §21)                                                                | CQ-Q-001 + q-failure tests                                     |
| Context Firewall (12 §15, 14 §34, 15)                                                        | CQ-Q-004 — q-firewall pipeline, PermittedContextPlan           |
| Approval payload hash                                                                        | CQ-Q-008 — canonical JSON SHA-256 binding envelope             |
| Q conversations / messages / runs persist (13 §34, §47)                                      | CQ-Q-002 — one message store, run_id NOT NULL                  |
| Run events append-only, unique per-run sequence (22 §71-74)                                  | CQ-Q-002 — trigger + allocator; CQ-Q-009 — id: = sequence      |
| SSE transport, heartbeat comments, ids/Last-Event-ID (22 §69-75; AEC-018/020)                | CQ-Q-009 — q-events route, sse formatter, strict header        |
| SSE is transport, durable store is truth (22 §74; AEC-019)                                   | CQ-Q-009 — NOTIFY wake-up, read-after-cursor, projector        |
| No token deltas persisted; final message durable (22 §76)                                    | CQ-Q-009 — delta bus, q.message.completed in the seam          |
| No chain-of-thought event (22 §72; AEC-021)                                                  | CQ-Q-009 — projector refuses unknown types; marker tests       |
| Graceful shutdown of streams, reconnecting client (21 §80, §219)                             | CQ-Q-009 — preClose hook, drain, client backoff                |
| Q concurrency baseline (24)                                                                  | CQ-Q-009 — 20 concurrent clients recorded                      |
| Deterministic run lifecycle, cancel semantics (22 §78)                                       | CQ-Q-002 — Q_RUN_TRANSITIONS, decideCancellation               |
| Actor/tenant server-derived; owner-only Q reads (15)                                         | CQ-Q-002 — 404 parity + security event                         |
| Idempotent run/message creation (22 §26)                                                     | CQ-Q-002 — hash-only records, advisory lock                    |
| No chain-of-thought column or event (TM-Q-12)                                                | CQ-Q-002 — rls/300_q_runtime                                   |
| QOrchestrator port, LangGraph behind it (12 §10.2)                                           | CQ-Q-003 — q-runtime port, q-orchestrator adapter              |
| Durable checkpoints under q_runtime (12 §10.4, 13 §47)                                       | CQ-Q-003 — migration 20260906150000, rls/310                   |
| Checkpoint ≠ institutional memory; bounded state (12 §10.3)                                  | CQ-Q-003 — QGraphStateSchema + blob inspection                 |
| Pause/resume, restart recovery, replay safety (12 §10.5)                                     | CQ-Q-003 — pause seam, idempotent lifecycle moves              |
| Orchestration version, fail-closed resume (12 §9.3)                                          | CQ-Q-003 — q-orchestrator-v1 policy                            |
| Thread id is not authorization (15, TM-Q)                                                    | CQ-Q-003 — ownedRun before engine; 404 + event                 |
| Context Firewall seam / Model Gateway seam                                                   | CQ-Q-004 (firewall filled) / CQ-Q-005 (gateway filled)         |
| Eval principle: intelligence measured, never assumed (24 §71-72)                             | CQ-Q-010 — q-evals harness through the real run path           |
| Dataset types, versioning, privacy class, held-out (24 §73-75, §70)                          | CQ-Q-010 — QEvalDatasetSchema, DEVELOPMENT/HELD_OUT roles      |
| Hard invariants never averaged; deterministic graders (24 §78-79, §21)                       | CQ-Q-010 — 11 invariants, marker/gate/routing graders          |
| Human review for institutional quality; no LLM judge yet (24 §19, §22)                       | CQ-Q-010 — HUMAN_REVIEW flag; MODEL_GRADED reserved            |
| Eval profiles; CI without credentials or spend (24 §83, §106)                                | CQ-Q-010 — LOCAL_FAST, CI_CORE (keys stripped), LIVE_MODEL     |
| Provider-agnostic harness; routing evals (24 §86-88)                                         | CQ-Q-010 — scripted provider under real codes; QROUTE-*        |
| Baseline never auto-rewrites; comparison (24 §80-81)                                         | CQ-Q-010 — --update-baseline on pass only; compare             |
| Eval traffic distinguishable from product traffic (24 §90)                                   | CQ-Q-010 — service q-evals, executionKind eval                 |
| Structure-aware, type-aware chunking; no universal splitter (14 §11)                         | CQ-RAG-001 — slide / narrative / spreadsheet strategies        |
| Chunk size policy, bounded overlap (14 §12)                                                  | CQ-RAG-001 — CHUNK_LIMITS, sentence-safe packing               |
| Parent-child retrieval structure (14 §13)                                                    | CQ-RAG-001 — PARENT/LEAF roles, parent_chunk_id                |
| Chunk identity from version, chunker version, locator, hash (14 §14)                         | CQ-RAG-001 — chunk sets, content_sha256, chunking_version      |
| q_knowledge.chunks separate from knowledge objects (13 §41.1)                                | CQ-RAG-001 — migration 20260908120000                          |
| Derived data inherits visibility and sensitivity (15 §20-§21)                                | CQ-RAG-001 — assertInherits, pgTAP vocabulary checks           |
| Spreadsheets as structured ranges, never prose (14 §11.2)                                    | CQ-RAG-001 — xlsx/csv extractors, spreadsheet strategy         |
| Parser/chunker versions explicit; rebuild without rewriting (14 §119-§120)                   | CQ-RAG-001 — immutability triggers, rebuild command            |
| Embeddings are disposable derived indexes, not knowledge (14 §15)                            | CQ-RAG-002 — q-embeddings owns no truth, persists nothing      |
| Open-weight Qwen3 embedding candidate evaluated first (14 §15.1)                             | CQ-RAG-002 — local TEI runtime, no hosted API, $0              |
| Provider behind an adapter; no SDK in domain code (11, 23)                                   | CQ-RAG-002 — EmbeddingProvider port, TEI shape confined        |
| Retrieval configuration version recorded (14 §115)                                           | CQ-RAG-002 — configuration and instruction versions on results |
| Derived data inherits source sensitivity (15 §20-§21)                                        | CQ-RAG-002 — vectors documented and treated as sensitive       |
| q_knowledge.embeddings separate from chunks, model id recorded (13 §41.2)                    | CQ-RAG-003 — migration 20260909090000, identity on the row     |
| Embeddings are disposable indexes over chunks, rebuildable (14 §15)                          | CQ-RAG-003 — no status of its own; eligibility from chunk      |
| Multiple embedding models coexist during migration (14 §15, §119-§122)                       | CQ-RAG-003 — work-identity unique key, not UNIQUE(chunk)       |
| Exact search before ANN; index only when measured (14 §16)                                   | CQ-RAG-003 — HNSW deferred with latency measurements           |
| Authorisation constrains retrieval before results exist (14 §7; 15; 16 TM-RAG-01)            | CQ-RAG-003 — typed scope, tenant/scope/status prefilters       |
| Hybrid retrieval: FTS + pgvector fused by RRF (14 §24-§26; 25)                               | CQ-RAG-004 — generated tsvector + GIN, RRF in TypeScript       |
| Permission-aware retrieval: authorisation before similarity (14 §7, §30-§31; 15 §19-§22)     | CQ-RAG-004 — plan → envelope disjunction, applied in SQL       |
| Source existence can itself be private (15 §21; 16 TM-RAG-02)                                | CQ-RAG-004 — no excluded count; denied and empty identical     |
| Retrieved content is data, never instruction (12; 15 §49)                                    | CQ-RAG-004 — facts render inside the prompt's untrusted fence  |
| Structured canonical state is preferred over evidence search (14 §22; 19)                    | CQ-RAG-004 — structured scopes deliberately not chunk-backed   |
| Retrieval configuration is versioned and reproducible (24)                                   | CQ-RAG-004 — capital-q-hybrid-v1, baseline recorded            |
| Provider-neutral ModelGateway / ModelProvider (12 §24.1)                                     | CQ-Q-005 — model-gateway ports, google + groq adapters         |
| Task classes, no model names in domain code (12 §24.3-24.5)                                  | CQ-Q-005 — contracts/model, lint rule G, boundary tests        |
| Routing factors: sensitivity before cost (12 §24.4, 15 §61)                                  | CQ-Q-005 — policy/eligibility fixed order                      |
| ai_ops catalog, versioned prices, routing policies (13 §56)                                  | CQ-Q-005 — migration 20260907090000, rls/320                   |
| Every model call recorded with cost (12 §51, 13 §56.5)                                       | CQ-Q-005 — ai_ops.model_usage, append-only                     |
| Deadlines, budgets, bounded retry, fallback (12 §47-49)                                      | CQ-Q-005 — ModelBudget, gateway loop, unit suite               |
| Structured outputs validated at the boundary (12 §27)                                        | CQ-Q-005 — acceptStructuredOutput, INVALID_MODEL_OUTPUT        |
| Provider credentials server-only (12 §65, 21 §139-142)                                       | CQ-Q-005 — config/model-providers, ProviderCredential          |
| Free ≠ safe; provider data-use eligibility (15 §62, 13 §120)                                 | CQ-Q-005 — sensitivity ceilings, UNREVIEWED classes            |
| Live provider tests separate from CI (23 §185)                                               | CQ-Q-005 — vitest.live-model.config, test:live-model           |
| Prompts as versioned software artifacts (12 §26, 23 §127-129)                                | CQ-Q-006 — q-core registry, prompts.lock.json                  |
| Institutional charter, layered prompts (12 §26.1-26.2)                                       | CQ-Q-006 — Q_SYSTEM v1, task prompts, comm guidance            |
| Run records prompt bundle version (12 §26.4)                                                 | CQ-Q-006 — prompt_bundle_version on completed runs             |
| Untrusted content boundaries (12 §38, §40; 15 §47)                                           | CQ-Q-006 — renderer fences, fence neutralisation               |
| System prompt: rules and schemas, no secrets (15 §48)                                        | CQ-Q-006 — charter tests: provider-neutral, no secrets         |
| Depth follows significance (PADL 43)                                                         | CQ-Q-006 — charter + analyst responseShape, smoke A/B          |
| Assessment precedes advice (PADL 12)                                                         | CQ-Q-006 — QOperatingMode ASSESSMENT in charter/tasks          |
| Bounded Q Controls, no user system prompts (Spec Q Controls)                                 | CQ-Q-006 — QCommunicationProfile strict enum contract          |
| Eval fixtures tagged for the harness (24 §81, §83)                                           | CQ-Q-006 — q-core fixtures, q:smoke checks                     |
| Tool Registry Capital Q-owned, versioned, per-context tool set (12 §33; 15 §49)              | CQ-Q-007 — q-tools registry, eligible(context)                 |
| Tool execution pipeline, no direct model-to-effect path (12 §29; 15 §50)                     | CQ-Q-007 — q-tools executor                                    |
| Typed tool contracts, metadata, versioning (22 §83-84, §87)                                  | CQ-Q-007 — QToolDefinition, versionId, DEPRECATED              |
| No raw SQL / unbounded tool (12 §28.3; 22 §85)                                               | CQ-Q-007 — four SAFE_READ tools over query ports only          |
| Model arguments validated like external input (15 §51)                                       | CQ-Q-007 — Zod input, INVALID_ARGUMENTS paths only             |
| Tool output untrusted, bounded, sanitised (15 §52; 22 §86)                                   | CQ-Q-007 — output schema, size bound, TOOL turns as data       |
| Read-only tools getCompany/getCapitalObjective/getInvestorMandate/searchCompanies (12 §28.1) | CQ-Q-007 — the four tools                                      |
| Provider tool projection behind adapters (12 §24.5)                                          | CQ-Q-007 — google/groq projections, gateway TOOL_CALLS         |
| Q shows approved stages, never tool names (12 §9.2, §37.1)                                   | CQ-Q-007 — visibleStage per tool, q.stage.changed              |
| Human approval for consequential actions, exact payload (12 §31; 15 §53; 22 §79-81)          | CQ-Q-008 — Prepare→Approve→Execute, hash at 3 points           |
| Approver identity server-derived, live authority re-checked (15 §53)                         | CQ-Q-008 — session actor; q.action.approve at 3 points         |
| Consequential action idempotency key, execute once (15 §54; 22 §82)                          | CQ-Q-008 — q_action:<run>:<action>, claim/finalise gate        |
| Interrupt/checkpoint never authority (12 §31.4)                                              | CQ-Q-008 — approval_gate re-reads DB; undecided → none         |
| Audit: who acted under whose authority (15 §60; 22 §108)                                     | CQ-Q-008 — actor Q + authority_user_id on every step           |
| Approval API: empty approve body, bounded reject reason (22 §80-81)                          | CQ-Q-008 — strict contracts; no client hash/approver           |
| Plain-English user messages for approval outcomes (22 §21)                                   | CQ-Q-008 — sentences on domain errors, codes in logs           |
| Requested scope ≠ permission; purpose limitation (12 §15.2)                                  | CQ-Q-004 — derived task class, candidate tables                |
| Deny by default, no wildcard/admin bypass (15)                                               | CQ-Q-004 — closed reason and scope vocabularies                |
| Firewall before retrieval; model never decides (14 §34)                                      | CQ-Q-004 — retrieve(request, plan); re-plan                    |
| Source existence protection (15, 22 §21)                                                     | CQ-Q-004 — internal reasons only; public parity                |
| Combination risk, derived sensitivity (15)                                                   | CQ-Q-004 — COMBINATION_RISK_RULES, ceilings                    |
| Resume re-evaluates permission (12 §10.5, 15)                                                | CQ-Q-004 — revalidateOnResume literal, org guard               |

## Threat coverage (doc 16) — CQ-Q-004 rows

| Threat                                              | Control                                                       | Proof                                             |
| --------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| TM-Q-01 direct prompt injection (authority in text) | Firewall reads typed fields only; text, purpose, role ignored | firewall.integration "smuggled" test              |
| TM-Q-11 Q uses wrong entity                         | Typed subject refs, per-subject resolution, no partial plan   | firewall.integration malformed-input test         |
| Founder-private → investor (release-blocking)       | Owner-only kinds + disclosure paths; intrinsic vs path labels | GOLDEN §73, §77; markers in no output             |
| Investor-private → founder (release-blocking)       | Mandate owner-only; profile only via explicit share           | GOLDEN §74                                        |
| Cross-organisation / cross-tenant reach             | Owner = same tenant + organisation; view port on run creation | GOLDEN §75; orchestrator start denial             |
| Relationship history to a non-party                 | Exact parties, own side's labels, no existence hint           | GOLDEN §76                                        |
| Source existence enumeration                        | Internal reasons never echoed; one public code                | GOLDEN §77 (public parity with a non-existent id) |
| Stale permission reused after pause/resume          | Plan re-derived before retrieval; checkpoint holds descriptor | GOLDEN §79 revoked-after-resume, denial-on-resume |
| Active organisation switch on resume                | run.actorOrganisationId must match the resuming actor         | GOLDEN §80                                        |
| Private content in logs / checkpoints / events      | Ids, kinds and reasons only; captured-logger assertions       | both integration suites, five markers             |

## Threat coverage (doc 16) — CQ-Q-005 rows

| Threat                                            | Control                                                                                   | Proof                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Cost harvesting (MUST_MITIGATE_V1)                | Per-request budget: attempts, estimated cost, output tokens, timeout; pre-call rejection  | gateway.test cost + reliability groups; ledger rows                 |
| Confidential data to an unreviewed/free provider  | Model sensitivity ceiling judged before cost; fallback re-judged                          | gateway.test privacy; gateway-postgres; providers.live (zero calls) |
| Provider key exposure (TM-TEN-03, TM-SEC-02)      | Opaque ProviderCredential, config-only reads, lint rule G, boundary tests                 | config/model-providers.test; boundaries.test                        |
| Raw provider error to a user (22 §236.7)          | Stable failure classes; vendor text on cause only; public projection                      | gateway.test boundaries; answer-seam integration                    |
| Chain-of-thought exposure (TM-Q-12)               | Gemini includeThoughts=false; Groq reasoning_format=hidden; no reasoning field on results | adapter code; result key allowlist test                             |
| Model output becoming truth                       | Answer seam writes a conversation message only                                            | answer-seam integration; q.md                                       |
| Provider-native tools / search / code execution   | tools: [] on Gemini; no tools, documents or search settings on Groq                       | adapter code (packet §70-72)                                        |
| Model selection from the public request (TM-Q-03) | ModelGatewayRequest strict; public Q request unchanged                                    | boundaries.test; gateway.test "names a provider"                    |

## Threat coverage (doc 16) — CQ-Q-006 rows

| Threat                                   | Control                                                                     | Proof                                               |
| ---------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------- |
| TM-Q-01 direct prompt injection          | Charter precedence; user text fenced as data; permissions deterministic     | q-core renderer tests; smoke D and injection-reveal |
| TM-Q-02 indirect injection via documents | Authorised facts fenced; charter treats fenced content as data              | injection-document scenario (live); fence tests     |
| Prompt leakage (24 §285)                 | Charter forbids revealing instructions; seam logs/stores no prompt          | q-answer.test marker; injection-reveal scenario     |
| Sycophancy (24 §280)                     | Charter: not a mirror; contradictions listed, not resolved                  | smoke D scenario                                    |
| Style overriding truth or permissions    | Strict enum profile; guidance vocabulary test; charter precedence           | q-core profile tests; q-answer BALANCED vs DIRECT   |
| TM-Q-12 chain-of-thought exposure        | No reasoning field in outputs; providers hide thoughts                      | result schemas; adapter settings                    |
| Model output becoming truth              | Extraction/synthesis/fit outputs are candidates; seam writes a message only | schema docs; answer-seam integration                |

## Threat coverage (doc 16) — CQ-Q-007 rows

| Threat                                                            | Control                                                                                                                                   | Proof                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Excessive agency: every run gets every tool                       | Registry eligibility by purpose, actor, plan scopes; DISABLED kill switch                                                                 | registry-executor.test eligibility; tools.integration offers               |
| Model-generated arguments as an attack vector (15 §51)            | Zod validation before anything runs; paths only echoed; provider pattern checks stripped so a bad id is INVALID_ARGUMENTS, not a dead run | registry-executor.test; safe-read-tools malformed id without lookup        |
| Cross-tenant read through a tool                                  | Plan scope required; capability or disclosure per resource; one NOT_AVAILABLE answer                                                      | tools.integration GOLDEN cross-tenant; TOOL-CROSS-TENANT marker            |
| Founder-private data to an investor                               | COMPANY_PROFILE/CAPITAL scopes bound to subjects; disclosure re-check; sensitivity ≤ plan                                                 | tools.integration; TOOL-FOUNDER-PRIVATE marker                             |
| Investor-private mandate to a founder                             | Owner-only path; not offered without the scope; raw narrative never read                                                                  | tools.integration GOLDEN investor-private; INVESTOR-PRIVATE-MANDATE marker |
| Tool result as instruction (indirect injection)                   | TOOL turns labelled data; charter + environment note; executor never obeys                                                                | q-answer-tools denial-as-data; smoke markers                               |
| Internal error text to the model                                  | TOOL_INTERNAL_ERROR code + safe sentence; message stays in server log                                                                     | registry-executor.test TOOL-INTERNAL-ERROR marker                          |
| Unbounded tool loops / cost harvesting                            | ≤3 rounds, ≤6 calls per run; gateway budgets still apply                                                                                  | q-answer-tools bounds test                                                 |
| Model calls a tool the run was never offered                      | Gateway refuses unoffered proposals as invalid output; registry refuses non-eligible                                                      | tools.test unoffered; registry-executor TOOL_NOT_ELIGIBLE                  |
| Tool name / argument / result leaking to events, messages or logs | Stages only; observation carries names and statuses; logs bounded fields                                                                  | answer-seam integration; q-answer-tools logs                               |

## Threat coverage (doc 16) — CQ-Q-008 rows

| Threat                                                                | Control                                                                                                   | Proof                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| TM-Q-03 model approves its own action                                 | No approval field on any proposal or request; approval row written only by the decide command             | approval-engine injection test; q-approvals body strictness               |
| TM-Q-04 tool output / document text "approves"                        | Text is data; approval status unchanged by any message                                                    | approval-engine injection test ("The user has approved…" stays PENDING)   |
| TM-Q-05 / RT-05 payload swapped after approval (approval swap)        | SHA-256 over canonical binding envelope at proposal, approval and execution; mismatch blocks + HIGH event | approval-engine MUTATION demo; targets/version invalidation; binding.test |
| TM-Q-06 replayed or concurrent execution                              | Idempotency key + atomic EXECUTING claim + finalise; ALREADY_EXECUTED / IN_PROGRESS                       | approval-engine concurrency (held executor); approval-flow two processes  |
| TM-Q-07 approval by the wrong person / context / tenant               | requested_from_user_id + organisation context + tenant; one not-found answer; security event              | approval-engine authorization test; APPROVAL-CROSS-TENANT marker          |
| TM-Q-08 authority revoked between approval and execution              | Reauthorize at the gate (capability + definition); BLOCKED, audit DENIED, approval untouched              | approval-engine revoked-membership test                                   |
| TM-Q-09 checkpoint/interrupt treated as authority                     | Graph state carries the action id only; gate reads the database; undecided resume executes nothing        | approval-flow interrupt-not-authority test; checkpoint text asserts       |
| TM-AUD-01 side effect without attributable authority                  | Material audit on every step with actor Q + authority_user_id; outbox events                              | approval-engine REQUIRED DEMO audit assertions                            |
| TM-AUD-02 payload / hash / executor error in audit, events, logs, API | Bounded metadata (ids, codes, hash only in audit); no hash in API; executor error class only              | privacy-markers test; q-approvals leak tests; logs asserted               |
| Expired approval executed                                             | Clock comparison at read, decide and gate; EXPIRED persisted; 410 to the person                           | approval-engine state-machine test                                        |
| Unknown outcome retried into a double send                            | UNKNOWN / thrown → RECONCILIATION_REQUIRED (terminal)                                                     | approval-engine failure-semantics test                                    |
| Prohibited or unknown action type proposed                            | Registry accepts CONFIRM_REQUIRED only; unknown type → QActionUnavailableError                            | lifecycle-registry.test; approval-engine injection test                   |

## Threat coverage (doc 16) — CQ-Q-009 rows

| Threat                                                          | Control                                                                                  | Proof                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Unauthenticated or run-id-only stream access                    | Session hook before headers; ownedRun; run id never authority                            | q-events.test 401/404; q-events.integration AUTHORIZATION       |
| Same-tenant private stream leakage                              | Owner-only (tenant + user); identical 404; security event                                | q-events.integration colleague 404; no facts in body            |
| Cross-tenant existence probing                                  | Same 404, no stage/count/state in the response                                           | q-events.integration; q-events.test 404 body asserts            |
| Token in URL                                                    | Header-only auth; client sends Authorization; no query cursor                            | q-stream-client.test URL asserts                                |
| Chain-of-thought / internal event on the wire                   | Projector parses into the closed contract; unknown types skipped                         | stream.test projector; q-events.test never frames; marker tests |
| Raw run-event row or internal error serialised                  | Public event only; after-headers errors become a comment                                 | q-events.test stream-error; internal-error marker               |
| Provider raw error on the stream                                | Gateway classification only; q.run.failed carries the public failure                     | contract tests; live smoke (503/429 → fallback, no raw JSON)    |
| Token-per-row history / heartbeat persisted                     | Deltas in-process only; heartbeat is a comment                                           | q-events.test heartbeat creates no row; stream.test deltas      |
| SSE or EventEmitter treated as truth                            | Every frame comes from a read after the cursor; notifier carries ids only                | stream.test race; integration PROCESS RECREATION                |
| Lost event between replay and live                              | Subscribe first, read after cursor on every notice, safety re-read                       | stream.test race; integration REPLAY/LIVE RACE (120 writes)     |
| Unbounded replay / reconnect / client queue                     | Replay cap, paged reads; bounded jittered backoff; bounded delta queue; frame bound      | stream.test cap; q-stream-client backoff; q-events backpressure |
| Listener leak / slow client OOM                                 | Subscriptions removed on close; drain timeout disconnects; deltas dropped under pressure | q-events.test leak cycles, backpressure; stream.test cleanup    |
| Disconnect cancels the run / duplicate execution per subscriber | Socket close only aborts the reader; one run, many observers                             | q-events.test disconnect; integration MULTIPLE CONNECTIONS      |
| Shutdown hangs on open streams                                  | preClose ends streams; idle close + bounded force close                                  | q-events.test shutdown                                          |

## Threat coverage (doc 16) — CQ-Q-010 rows

| Threat                                                         | Control                                                                                  | Proof                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Founder-private data reaches an investor run                   | Firewall plans scope before the model; eval markers on founder-private rows              | QPERM-001, QINJ-001 (provider input, answer, events, logs)      |
| Investor mandate reaches a founder run                         | INVESTOR_MANDATE not plannable for a founder                                             | QPERM-002 (run refused; zero attempts)                          |
| Cross-tenant private company readable through Q                | Tenant-scoped subject resolver; run refused                                              | QPERM-003 (REFUSED, zero provider attempts)                     |
| Relationship context reaches a non-party                       | Subject resolver + RELATIONSHIP_CONTEXT plan gate                                        | QPERM-004 (unrelated investor refused); QPERM-005 (party sees)  |
| Model proposes a prohibited tool (run_sql, http)               | Registry knows no such tool; call recorded as failed, never executed                     | QTOOL-002, QINJ-002 (tool-output injection)                     |
| Execution before approval / model self-approval                | Approval Engine ignores model-supplied approval fields; execute needs an approval row    | QACT-001, QACT-002 (ACTION_GATE scenarios)                      |
| Payload swap after approval / duplicate execution              | Hash bound to the approved payload; idempotent execution                                 | QACT-003, QACT-004                                              |
| Private data routed to an ineligible provider; fallback widens | Eligibility before candidates; fallback keeps sensitivity                                | QROUTE-001, QROUTE-002 (real catalogue and policies)            |
| Chain of thought / charter on the stream or in logs            | Closed event contract; charter absent from logs                                          | QLEAK-001 (internal-leakage grader)                             |
| Eval harness itself leaks: keys, answers, fixture bodies       | Keys stripped for deterministic profiles; key PRESENCE only; markers never in the result | q-evals.integration (no marker/key in the JSON); q-eval lint    |
| Markers transmitted to a live provider to test its recall      | Markers only on rows the firewall must withhold; a live leak is graded on the input side | marker-absence grader on providerInput; LIVE_MODEL BLOCKED rule |
| Eval run mistaken for product traffic or spend                 | Synthetic tenants deleted on close; service name q-evals; executionKind eval; budgets    | world.close cleanup; result.environment                         |

## Threat coverage (doc 16) — CQ-RAG-001 rows

| Threat                                                       | Control                                                                         | Proof                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Tenant B reads tenant A chunks                               | Direct tenant_id, composite FKs, server-only tables, tenant-scoped repositories | rls/340 (42501, 23503); q-knowledge.integration cross-tenant |
| Derived chunk wider or weaker than its source                | assertInherits refuses; vocabulary checks in the table                          | q-knowledge.integration VISIBILITY_WIDENED; chunking.test    |
| Chunk mistaken for evidence, claim or knowledge              | Separate schema and rows; no promotion path; documented invariants              | q-knowledge.md; no write to evidence.claims anywhere         |
| Stale private chunk remains retrievable after revocation     | Set-level REVOKED cascades to chunks; rebuild never reactivates                 | q-knowledge.integration revocation                           |
| Chunker rewrites history / destroys source truth             | Immutability triggers; new set per chunking version; sources untouched          | rls/340 immutability; integration v1→v2                      |
| Instruction-shaped document text acts on the pipeline        | Text carried as data, counted as risk; no model, no tool, no SQL in the chunker | chunking.test injection; pipeline.test privacy marker        |
| Formula or macro execution through spreadsheets              | Static OOXML read of cached values; VBA project refused; no evaluation          | spreadsheets.test formula/macro                              |
| Resource exhaustion by a large workbook or pathological text | Sheet/row/column/cell limits, range windows, chunk and content bounds           | spreadsheets.test limits; chunking.test pathological         |
| Chunk content in logs, run metadata or events                | Counts, versions and ids only; no chunk event                                   | pipeline.test marker assertions                              |
| Rebuild from a tampered artifact                             | SHA-256 verified against the extraction row before parsing                      | q-knowledge.integration tampered artifact                    |
| Raw chunk API exposed to browsers                            | None exists; tables server-only; Q has no chunk tool                            | schema guard; rls/340 exposure tests                         |

## Threat coverage (doc 16) — CQ-RAG-002 rows

| Threat                                                      | Control                                                                             | Proof                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Confidential chunk text sent to a third-party embedding API | Local open-weight runtime only; no hosted provider configured; no credential exists | q-embeddings tests; smoke reports zero external calls       |
| Private text or vectors in logs, metrics, errors or results | Results carry a hash; metrics carry fixed labels; runtime error text never escapes  | privacy marker tests (EMBEDDING-PRIVATE-CONTENT-DO-NOT-LOG) |
| Embedding runtime exposed on a routable interface           | Loopback binding in compose; private-host check at configuration time               | config tests; docker-compose port binding                   |
| Model supply-chain substitution                             | Pinned image tag and model revision; health compares the runtime's model_sha        | health MISCONFIGURED tests; compose --revision              |
| Arbitrary model-repository code execution                   | Repository holds no Python; TEI implements the architecture in Rust; safetensors    | model card and file listing; no trust-remote-code option    |
| Silent truncation of financial evidence                     | truncate=false; oversized input refused as INPUT_TOO_LARGE                          | adapter request-body test; status mapping test              |
| Corrupt or mis-dimensioned vectors entering storage         | Dimension, finite and unit-norm validation; never resized or renormalised           | vector validation tests                                     |
| Vectors mis-assigned across a batch                         | A count mismatch is a failure; order preserved across batch boundaries              | batch order and count-mismatch tests                        |
| Cross-tenant inference through a shared embedding cache     | No cache; the work key carries no tenant and is not an addressing key               | work identity tests                                         |
| Runaway retry on a permanent failure                        | Only UNAVAILABLE and TIMEOUT are retryable                                          | isRetryableEmbeddingFailure tests                           |
| Embedding a chunk that is no longer eligible                | The chunk seam refuses a set that is not ACTIVE                                     | chunk-embedding tests                                       |
| Availability pressure causing a privacy downgrade           | An unavailable runtime leaves work pending; no external fallback exists             | adapter UNAVAILABLE path; documented policy                 |

## Threat coverage (doc 16) — CQ-RAG-003 rows

| Threat                                                       | Control                                                                                   | Proof                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Cross-tenant retrieval through vector similarity (TM-RAG-01) | Tenant predicate on the embedding table itself; composite FK forbids a disagreeing tenant | integration BLOCKER test; rls/350 FK and 42501 tests        |
| A private chunk surfacing in a narrower-scope search         | Disclosure scopes constrain the search, not its output                                    | integration founder-private vs network-visible test         |
| Deleted or revoked evidence returning through a stale vector | Eligibility is the chunk's ACTIVE status, joined at query time                            | integration revocation test; rls/350 active-join test       |
| Comparing vectors from different models or dimensions        | configuration_version filters the search; dimension CHECKed against vector_dims           | integration vector-space test; rls/350 dimension tests      |
| Duplicate vectors from worker retries or concurrency         | Unique work identity; insert ... on conflict do nothing                                   | integration dedupe test; rls/350 duplicate test             |
| Raw vectors reaching a browser or a client                   | RLS on with no policy, no grant, no API route; vectors never selected back out            | rls/350 anonymous/user tests; no public route               |
| SQL injection through search parameters                      | Typed Zod scope; every value bound; no operator, table or filter string from a caller     | integration malformed-input tests; parameterised repository |
| Unbounded vector scan or full-table return                   | K bounded at 100; zero, negative, fractional and oversized K refused                      | integration K-bound tests                                   |
| Instruction-shaped chunk text altering a query               | Chunk text is data; filters come from the typed scope alone                               | integration injection test                                  |
| Embedding a chunk nobody may retrieve                        | Backfill embeds only ACTIVE chunks                                                        | integration backfill test                                   |
| A vector outliving the chunk that explains it                | ON DELETE CASCADE from the chunk                                                          | rls/350 purge test                                          |
| Query vectors accumulating as durable private data           | Query vectors are request state; no query_embeddings table exists                         | rls/350 hasnt_table test                                    |

## Threat coverage (doc 16) — CQ-RAG-004 rows

| Threat                                                           | Control                                                                                       | Proof                                                         |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Cross-tenant retrieval through lexical or semantic match         | Tenant predicate in both queries, above the ranking                                           | integration cross-tenant BLOCKER; rls/360 user-B test         |
| Founder-private evidence reaching an investor                    | The firewall grants EVIDENCE_DOCUMENTS to the owning side only; nothing to search             | integration BLOCKER; q-evidence provider-input test           |
| Investor-private evidence reaching a founder                     | Disclosure scopes constrain the query, not its output                                         | integration BLOCKER                                           |
| Another company's material inside one tenant                     | Subject is part of the constraint; same tenant is not enough                                  | integration organisation-private BLOCKER                      |
| An expired or revoked document share retrieving                  | Shared labels are outside every V1 envelope: no share retrieves                               | integration relationship/specifically-shared BLOCKER          |
| Revoked or archived evidence returning through a stale index     | Chunk, set and document lifecycle joined in both queries; current version required            | integration archived / revoked-set / superseded-version tests |
| Material above the run's sensitivity ceiling                     | Per-constraint ceiling compared by q_knowledge.sensitivity_rank                               | integration ceiling BLOCKER; rls/360 ceiling test             |
| Flattening the envelope into label and subject unions            | The envelope is a disjunction of conjunctions, expanded by Postgres                           | unit envelope tests; the disjunction is the SQL shape         |
| RRF admitting an unauthorised candidate                          | Fusion is pure over already-authorised lists; hydration re-applies the envelope               | unit fusion tests; service hydration-drop test                |
| Source existence disclosed by counts or wording                  | No count of exclusions; a denied envelope and an empty match are indistinguishable            | integration empty-envelope test; unit assembler test          |
| tsquery or SQL operator syntax in a question                     | Postgres parses the text into lexemes; every value is bound; quote_literal quotes each lexeme | integration operator-syntax test                              |
| Indirect prompt injection through retrieved text                 | Retrieved text is data, rendered inside the untrusted fence; filters come from the plan alone | integration injection test; q-evidence tests                  |
| A private query leaving the machine when the local model is down | No external embedding fallback; retrieval degrades to lexical and reports it                  | service degradation tests                                     |
| Unbounded retrieval or context assembly                          | Bounded lexical K, semantic K, fused K, final hits, per-hit and total characters              | service bound tests; integration bound test                   |
| A cached private result outliving its permission                 | No retrieval cache exists                                                                     | rls/360 hasnt_table tests                                     |
| A browser reading the lexical index                              | RLS on, no policy, no grant, no route                                                         | rls/360 anonymous and cross-tenant tests                      |

## Threat coverage (doc 16) — CQ-KNW-003 rows

| Threat                                                              | Control                                                                                   | Proof                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| A company's own growth reported back to it as a discrepancy         | Period is compared before value; a series is `DIFFERENT_PERIOD`, never a conflict         | temporal.test KNWC-004; integration KNW3-001              |
| A forecast or a second definition treated as a competing figure     | Definition and basis are part of the slot and of the comparison                           | temporal.test KNWC-005/006; integration KNW3-002; rls/380 |
| A corrected typo recorded as a decline                              | `isCorrectionOf` requires the same period; the earlier reading is SUPERSEDED, not deleted | temporal.test KNWC-011; integration KNW3-003              |
| A candidate superseding a figure by asserting it corrects it        | `correctsEarlier` is read only after the periods match                                    | integration KNW3-004                                      |
| Capital Q silently choosing the larger or the newer number          | Conflict is held; both readings persist; resolution requires a human actor                | integration KNW3-005; rls/380 members-survive test        |
| A machine settling a disagreement                                   | `settleContradiction` refuses a non-HUMAN actor with `NOT_A_HUMAN_DECISION`               | integration KNW3-005                                      |
| An invented materiality threshold shown as measured                 | `classifyMateriality` returns UNDETERMINED for every genuine conflict; DB default matches | temporal.test KNWC-010; rls/380 default test              |
| An invented FX rate deciding a currency difference                  | Different currencies are INCOMPARABLE; both readings kept                                 | temporal.test KNWC-008                                    |
| "These two figures conflict" leaking what the figures are           | A set inherits its members' classification and holds no statement or value                | integration KNW3-006; rls/380 shape tests                 |
| One side of a disagreement travelling alone                         | `disputesForSubject` returns every authorised member or nothing                           | integration KNW3-005/006                                  |
| An unauthorised later reading suppressing an authorised earlier one | The "is there a later reading" predicate carries the same envelope                        | integration KNW3-007                                      |
| Age silently widening who may read something                        | Freshness changes lifecycle only; scope and sensitivity untouched                         | integration KNW3-008; temporal.test KNWC-012              |
| A universal TTL inventing an expiry nobody measured                 | Only declared keys age; each rule carries its rationale; no policy means no expiry        | temporal.test KNWC-012                                    |
| A held candidate keeping its hold reason after being settled        | `revise` clears `hold_reason` whenever the status leaves CANDIDATE; DB CHECK enforces it  | integration KNW3-005; rls/370 held-and-settled test       |
| A contradiction's identity edited after the fact                    | Trigger refuses any change to what is contested, and refuses reopening a settled set      | rls/380 immutability and reopen tests                     |
| Another tenant's understanding dragged into a disagreement          | Composite FKs on (set, tenant) and (object, tenant)                                       | rls/380 cross-tenant test                                 |
| A browser reading contradiction sets                                | RLS on, no policy, no grant, no route                                                     | rls/380 policy and RLS tests; schema guard                |

## Threat coverage (doc 16) — CQ-Q-020 rows

| Threat                                                                | Control                                                                                          | Proof                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Founder-private context silently lowering an investor-facing finding  | The investor's plan never reaches the deck, so no private figure exists in the run to influence  | integration QCI-008                         |
| Another tenant's company material reaching an investigation           | Every read carries the plan's envelope; the specialist cannot fetch on its own initiative        | integration QCI-009                         |
| Confirming that a private document exists by declining to show it     | An unauthorised reader's context contains no such source; empty and denied are indistinguishable | integration QCI-010                         |
| Instructions inside a deck changing authority or tooling              | Retrieved text is fenced data; the tool calls are decided before the model is asked anything     | integration QCI-011                         |
| A model citing a document, slide or knowledge object it never saw     | Citation is by opaque per-render label resolved server-side; a model never writes an identifier  | unit QCIU-001; integration QCI-006          |
| General model knowledge becoming an entity-specific fact              | An unsupported material assertion is dropped, not softened                                       | unit QCIU-002; integration QCI-004          |
| A USER_CLAIM becoming VERIFIED by being restated confidently          | Truth class is capped by the best class among the facts a finding actually cites                 | unit QCIU-003                               |
| An invented score, fit, probability or peer benchmark reaching a user | Findings whose language asserts one are dropped whole                                            | unit QCIU-004; integration QCI-005          |
| Missing information reported as weakness                              | Absence is reclassified to GAP whatever type the model chose; gaps need no support               | unit QCIU-005; integration QCI-007, QCI-016 |
| Capital Q choosing, averaging or preferring a conflicting figure      | Disagreements are computed and both sides travel; the frame forbids resolving them               | integration QCI-013                         |
| A five-month-old balance presented as the current position            | Freshness is assessed on read and stated in the fact, the finding and the frame                  | integration QCI-014                         |
| A company's own growth reported back as a discrepancy                 | Change is compared between recorded readings of one key, never between model answers             | integration QCI-015                         |
| Private context sent to an ineligible provider to keep a feature up   | Eligibility is decided from declared sensitivity before any provider call; the refusal is coded  | specialist blocked: NO_ELIGIBLE_MODEL_ROUTE |
| A specialist becoming a second chatbot with its own persona           | The specialist writes no message and names itself nowhere a person reads                         | integration QCI-001, QCI-017                |
| A private statement or figure leaking through logs or telemetry       | Telemetry carries counts, codes and identifiers only                                             | integration QCI-012                         |

## Threat coverage (doc 16) — CQ-Q-021 rows

| Threat                                                         | Control                                                                                          | Proof                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------- |
| A model's reading of a deck becoming company truth             | A candidate becomes a suggestion; the runtime validates it and only a person's acceptance writes | QFOU-007; QFOR-003/004                 |
| A founder's own answer overwritten by an extraction            | Candidates about answered facts are dropped before any suggestion is drafted                     | QFOR-004                               |
| A candidate citing a slide nobody supplied                     | Citation is by opaque per-render label resolved server-side; a model never writes an identifier  | extraction resolve(); QFOR-007         |
| A deck's assertion recorded as VERIFIED                        | The schema excludes VERIFIED and the mapper refuses it again                                     | founder-extraction schema; extraction  |
| General model knowledge becoming an entity fact                | A specific figure with no citation and no quote is dropped                                       | extraction unsupported check           |
| A founder asked to retype what their deck already answered     | The planner treats an answered fact and a pending suggestion alike as not-to-ask                 | QFOU-002; QFOR-005                     |
| A pre-revenue company quizzed on retention or growth           | Business shape excludes inapplicable facts; unknown shape excludes nothing                       | QFOU-003                               |
| Capital Q choosing between two documents' figures              | A conflict becomes one question carrying both readings; nothing averages or prefers              | QFOU-004; QFOR-005                     |
| Missing information read as a weakness                         | Absence is a gap; completion needs only the required set; no completion percentage exists        | QFOU-006                               |
| An endless model-driven interview                              | The planner bounds the count and admits each fact once                                           | QFOU-005                               |
| A model introducing a question with no schema behind it        | Every planned question maps to a step of the pinned definition                                   | QFOU-005                               |
| A fake upload success over work that did not happen            | States are derived from the version's own processing status; no client-side success is invented  | material-actions stateOf()             |
| A format offered that the pipeline cannot read                 | F2 accepts only PDF, PPTX, DOCX and plain text — the extractors that exist                       | journey MATERIAL_MIME_TYPES            |
| An uploaded document silently becoming investor-visible        | Visibility is the Evidence context's decision; F2 writes no scope and says so on the screen      | founder-v2 F2 writesTo: []             |
| A browser choosing its own tenant or holding a Capital Q token | Upload actions run server-side with the HttpOnly session token                                   | material-actions run()                 |
| An unscanned document being parsed                             | REQUIRE_CLEAN is the default; no scanner means UNAVAILABLE, which blocks rather than opens       | workers config; malware.ts (unchanged) |

## Threat coverage (doc 16) — CQ-Q-022 rows

| Threat                                                           | Control                                                                                                        | Proof                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------- |
| A model's reading making candidates ineligible                   | `preferenceClassFor` has no branch returning HARD_EXCLUSION; the only route takes the investor's confirmation  | QIM-005                   |
| Silence read as consent to exclude                               | A proposal with no decision keeps its soft negative                                                            | QIM-005                   |
| A firm tone collapsing avoid into exclusion                      | EXCLUSION_CLAIMED maps to AVOID; only an answered decision changes it                                          | QIM-005                   |
| importance and is_hard_exclusion disagreeing                     | Derived from one source on the way in; a DB CHECK enforces it at rest                                          | QIM-005                   |
| A model-invented taxonomy id becoming a matching criterion       | Phrases are resolved by Capital Q's own service; an unresolved phrase files nothing                            | QIM-003                   |
| Screening on a protected characteristic                          | No canonical dimension can express one; a request is reported and refused in the open                          | QIM-015                   |
| Observed behaviour rewriting a declared mandate                  | Observations reach inferences and tensions only; confirmMandate never reads them                               | QIM-011                   |
| Q inference becoming a declaration                               | Same separation, with the basis carried so it cannot be presented as declared                                  | QIM-011                   |
| Discovery mode derived from the constraints                      | The mode is the investor's I9 choice; nothing infers it, and no mode touches an exclusion                      | QIM-011                   |
| A stale synthesis overwriting newer selections                   | Each synthesis records its session revision; `synthesisIsCurrent` refuses an older one                         | QIM-017                   |
| A repeated confirmation creating a duplicate mandate version     | `sameMandate` compares semantic content, not row order                                                         | QIM-018                   |
| A mandate quietly broadened by a synthesis                       | A dimension already answered by selection is never re-proposed                                                 | synthesis declaredAlready |
| Commercially sensitive mandate text reaching an unsuitable model | Declared CONFIDENTIAL; the gateway decides eligibility before contacting a provider, and a refusal is honoured | synthesis blocked path    |
| A cheque ceiling or exclusion appearing in a log line            | Telemetry carries counts, codes and versions only                                                              | synthesis telemetry       |

## Threat coverage (doc 16) — CQ-Q-023 rows

| Threat                                                    | Control                                                                                                    | Proof                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------- |
| A model inventing why a company was recommended           | Both answer seams strip recommendation, ranking and fit claims from the prose before the message is stored | QREC-001                |
| A fabricated fit score or percentage reaching an investor | The same guard, matched on the assertion rather than the vocabulary                                        | QREC-001                |
| A claimed rank position that no ranker computed           | Ordering claims are removed with the rest                                                                  | QREC-001                |
| An honest answer deleted by an over-broad filter          | Patterns target the comparative claim; mandate, sector and evidence sentences pass untouched               | QREC-001 negative cases |
| Silence where a question deserved an answer               | When nothing honest survives, a plain message says Capital Q does not match yet                            | QREC-001                |
| Implementation jargon leaking into a refusal              | The message carries no factor, snapshot, ranker or version wording                                         | QREC-001                |
| FIT_EXPLANATION being invoked before factors exist        | Registered, zero callers, unmodified and dormant                                                           | inspection; grep        |
| A pseudo-ranker introduced to make the packet pass        | None added; no recommendation package, table, contract or score exists                                     | inspection              |

## Threat coverage (doc 16) — CQ-C5-R1 rows

| Threat                                                                    | Control                                                                                                       | Proof                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Verified intelligence that no user path reaches                           | The composition root itself is under test, keyed to tells an unconfigured wiring cannot produce               | C5R1-001..003               |
| Retrieval running before the Context Firewall                             | Unchanged: the port takes the plan, and the envelope is built from the plan alone                             | live run log; RAG-004 tests |
| A browser holding the Q API's session token                               | The token never leaves the server; writes go through server actions, the stream through one narrow route      | apps/web/app/api/q-stream   |
| A general proxy handing the browser the whole Q API                       | GET only, one run's events only, no catch-all; the inbound Authorization header is never forwarded            | inspection                  |
| Confidential context reaching an unreviewed provider                      | FROM_PLAN sensitivity; the gateway refused both providers on a real production run                            | live run log                |
| A fabricated answer while the product is unfinished                       | No local reply exists: an unconfigured build says so and sends nothing                                        | QComposer; C5R1-W01         |
| Invented progress stages                                                  | Only stages the server emitted, through the contract's own labels; no fallback guess                          | C5R1-W02                    |
| Engineering detail in a user-facing failure                               | The contract's public failure projection supplies the sentence; the fallback carries no status, host or table | C5R1-W02                    |
| Evidence identifiers leaking into the browser                             | A count is rendered, never a reference; nothing resolves one into something safe to show yet                  | C5R1-W03                    |
| A client's memory of a conversation outliving the access that produced it | Reload reads the run back from the server under the person's own session; only the run id is cached           | C5R1 browser reload         |

## Threat coverage (doc 16) — CQ-C5-R2A rows

| Threat                                                                    | Control                                                                                                                             | Proof             |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Confidential customer data reaching a vendor nobody reviewed              | The provider's reviewed class is an independent ceiling; the model's own ceiling cannot widen it                                    | R2A-P02           |
| A single row edit unblocking a demo and leaking customer data             | Raising a model ceiling alone still refuses: both limits must admit the request                                                     | R2A-P02           |
| A vendor's brochure mistaken for our configuration                        | NO_TRAINING_ZERO_RETENTION justifies CONFIDENTIAL only when zero retention is recorded as enabled                                   | R2A-P01           |
| Approving a vendor for one class silently approving it for all            | No privacy class reaches HIGHLY_CONFIDENTIAL or RESTRICTED, by construction                                                         | R2A-P01, R2A-P02  |
| Data reclassified downward to satisfy a model vendor                      | The firewall catalogue is untouched; the live run still plans at CONFIDENTIAL                                                       | live run log      |
| An unverified vendor assertion recorded as a verified fact                | The row itself says ZDR is a human assertion, not a verification, and carries its date                                              | migration row     |
| An open redirect through the OAuth round trip                             | `next` is resolved before it enters redirectTo and again on return; absolute, protocol-relative and encoded forms fall back to Home | R2A-A02           |
| A provider's configuration error described to whoever asked               | Every Google refusal is one sentence; the provider's own text is never reflected                                                    | callback; R2A-A01 |
| A sign-in control that cannot work                                        | Rendered only when the Auth server reports the provider enabled; failure to ask means not offered                                   | R2A-A01           |
| A Google session mistaken for authority                                   | Authentication yields CONTEXT_REQUIRED; a run naming another organisation's company is refused before any context                   | live probe        |
| A client's memory of a conversation outliving the access that produced it | Only run ids are cached; every turn is read back from the server under the person's own session                                     | browser reload    |

## Threat coverage (doc 16) — CQ-C5-R2B rows

| Threat                                                                     | Control                                                                                                  | Proof                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------- |
| A model writing company truth directly                                     | The review's entire output is suggestions; the onboarding runtime validates each against the pinned step | live run; QFOU-009            |
| A suggestion the runtime cannot accept, shown as if it could be            | Every draft is parsed with the real response schema, and only free-text steps are drafted for            | QFOU-009                      |
| An upload request waiting on a model                                       | The review runs off `evidence.document.ready` in the worker, never in the upload request                 | live run; worker log          |
| A replayed event burying a founder in duplicate suggestions                | Only facts neither answered nor already offered are drafted, read fresh from the session on every run    | review service; §9            |
| A stale document's reading overwriting a newer answer                      | The review only ever ADDS an offer for something still open; nothing here supersedes anything            | review service                |
| A second, unreconcilable company analysis inside onboarding                | F8 asks the same Q boundary the Home composer asks; no onboarding analyst exists                         | intelligence panel            |
| A queue message naming a tenant it does not own                            | The tenant is validated at the queue boundary before it names anything                                   | document-processing handler   |
| A processing failure reported as a successful read                         | A file's state comes from the version's own processing status; "Read" only after extraction completed    | F2 live run                   |
| A vendor approved for confidential work treated as approved for everything | CONFIDENTIAL routes only to the reviewed provider; RESTRICTED is refused before any provider is called   | gateway-postgres; answer-seam |

## Threat coverage (doc 16) — CQ-PRE-REC-001 rows (Checkpoints A-B)

| Threat                                                                  | Control                                                                                                                                            | Proof                                              |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| A model turning an investor's firm wording into a hard exclusion        | A reading only ever proposes an EXCLUSION_CONFIRMATION question; the hard-exclusion step is written by the investor's explicit answer alone        | mandate-review-service; I11 live run               |
| A model proposal treated as an answer                                   | Every proposal is a suggestion validated against the pinned step on creation and again on acceptance; nothing said becomes canonical by being said | onboarding integration (say); founder-onboarding-q |
| A typed sentence guessed into an option                                 | Interpretation is deterministic (labels, journey aliases, figures); anything else is READING or UNCLEAR, never a guess                             | interpretation.test.ts                             |
| A short option code read as a word ("in" → India)                       | Option keys under four characters are never matched as names                                                                                       | interpretation.test.ts                             |
| Interview progress living in the browser, a graph process or a provider | The workspace is a reading of the session; utterances, suggestions, questions and step states are runtime rows                                     | conversation.test.ts; refresh/logout live runs     |
| An utterance's words travelling on the event bus                        | `onboarding.utterance.recorded` carries identifiers only; the reader re-reads the row                                                              | onboarding integration (say)                       |
| A founder's deck reaching a provider that may not hold it               | Evidence is admitted up to CONFIDENTIAL; a HIGHLY_CONFIDENTIAL document is outside every plan, and the gateway ceiling still decides               | firewall integration; policy.test.ts               |
| A run stuck "working" forever after a Q API restart                     | Non-terminal runs are closed RUN_EXPIRED at startup; the durable terminal event reaches a reconnecting client                                      | orphaned-runs.ts; live restart                     |
| A raw internal error shown to a person with no organisation             | The missing-context error's default message is written for the person; the API still refuses                                                       | companies.test.ts; Home live run                   |
| A duplicate persistence path for conversational answers                 | `say` delegates to submitResponse and skipStep; a chip says its label through the same path                                                        | use-cases.ts; drive-say live run                   |

## Threat coverage (doc 16) — CQ-PRE-REC-001 rows (Checkpoint C)

| Threat                                                                    | Control                                                                                                                         | Proof                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| A company becoming visible because onboarding finished                    | Visibility changes only through `setCompanyVisibility`, an explicit editor action with `company.edit`                           | companies integration; visibility live run     |
| A founder's preview built from private data and a rendering filter        | The preview is `projectCompanyForNetwork`, the same function Q's company tool serves an investor; it reads declared fields only | companies integration; companies API tests     |
| A visibility the product does not offer (public, relationship) set by API | The request contract admits only the two founder choices; the use case refuses anything else                                    | companies API tests                            |
| An investor learning that a private company exists                        | The disclosure layer answers NOT_AVAILABLE for a private company, and Q says it does not know it, whatever the name             | investor lookup live run                       |
| A model returning its answer as a pseudo tool call, failing the run       | The first tool round is a gathering step with its own note; a refused round falls back to the structured call                   | q-answer-tools tests; investor lookup live run |

## Threat coverage (doc 16) — CQ-PRE-REC-001 rows (Checkpoint D)

| Threat                                                                         | Control                                                                                                                                                                                                                                                                                                                               | Proof                                                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A mandate chosen for the investor by position when several are open            | Only exactly one open mandate is answered on the investor's behalf; the runtime's `say` answers a reference step from its server context only, by name or by assent when there is one candidate; nothing is invented without candidates                                                                                               | onboarding interpretation tests; conversation tests; fresh investor live run                                                          |
| The same criterion held as both AVOID and HARD_EXCLUSION                       | Ticking a flag in one list moves it out of the other; the client plan and `exclusionConstraints` refuse a remaining overlap and name the flag; a sector excluded at I7 is removed from the I3 preference lists in the same save, and vice versa; `taxonomyPreferencesFromResponses` still refuses a node in both buckets and names it | investor journey tests; investor definition tests; fresh investor live run (Gambling moved; Logistics & Mobility HARD_EXCLUSION only) |
| A sector list that reads "leaving this empty means anywhere"                   | The hint is part of the group's presentation; only geography carries it                                                                                                                                                                                                                                                               | fresh investor live run                                                                                                               |
| A hard exclusion created by anything other than the investor's explicit answer | Unchanged: the I7 write target is the only writer; readings propose questions                                                                                                                                                                                                                                                         | investor definition tests                                                                                                             |

## Threat coverage (doc 16) — CQ-PRE-REC-001 rows (Checkpoint E)

| Threat                                                                                                                | Control                                                                                                                                                                                                      | Proof                                                                                           |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| A negated or nested mention read as the answer ("beyond pilots" → pilots; "co-invest alongside a lead" → lead)        | Deterministic interpretation drops a mention after a negation marker and a phrase that only occurs inside another matched option's phrase; a rich sentence with nothing placeable goes to Q as an utterance  | onboarding interpretation tests; founder and investor live runs                                 |
| Part of what the person said dropped because an option matched                                                        | A rich sentence that names an option is placed and also recorded as an utterance under a derived idempotency key; the event carries identifiers only                                                         | onboarding integration test (say scenario, outbox scoped to the session); investor live run     |
| An ambiguity asked with a question that misdescribes it (exclusion wording on a cheque range)                         | `ambiguityQuestion` builds TYPICAL_OR_LIMIT and IMPRECISE_VALUE questions from the dimension and quote; the model's wording is kept only for SCOPE_OR_EXCLUSION or a specific question                       | ambiguity-question tests                                                                        |
| The review or snapshot saying no materials while a deck is on file                                                    | Founder facts read F2's evidence documents by id within the tenant (title and kind only); v1 material kinds still read                                                                                       | founder step-context build; founder live run (Q answered from the deck)                         |
| A confirmation chip's own label not accepted by the interview                                                         | Confirmation steps accept their confirm and decline labels as well as assent                                                                                                                                 | onboarding interpretation tests; founder live run ("Save my raise")                             |
| A document's contents crossing into onboarding context                                                                | Only `title` and `documentType` are projected; reading stays in the worker                                                                                                                                   | founder step-context code review                                                                |
| A part-finished setup with no way back from Home once the organisation exists                                         | Home resolves the unfinished journey server-side and offers "Continue setup"; nothing is created or changed by showing it                                                                                    | founder and investor mobile E2Es (Save & leave → Home → Continue setup); dev-founder live check |
| Stale E2E expectations masking the current product (form-first, v1 materials, single-mandate chooser, inert composer) | Specs updated to the shipped behaviour: one tap to the form after each navigation, definition v2 headings and materials, auto-selected single mandate, move semantics for red flags, the composer reaching Q | Playwright run recorded in the postflight                                                       |
| An eval expecting a ceiling the catalogue no longer has                                                               | QROUTE-001 v2 sends a HIGHLY_CONFIDENTIAL request (Groq's reviewed ceiling is CONFIDENTIAL); the routing grader is unchanged                                                                                 | q:eval:ci PASS, no baseline regression                                                          |

## Security acceptance — CQ-PRE-REC-001 (Checkpoints A–E)

- No secret in any commit: `.env.local` untouched and unstaged; diffs scanned for provider keys and the hosted project ref before each commit.
- Hard exclusions: written only by the investor's explicit I7 answer (form or EXCLUSION_CONFIRMATION chip); `Q_PROPOSED` never creates one; verified live in both investor runs and in the database (`is_hard_exclusion` rows).
- The model decides no tenant, authority, canonical identity, verification, marketplace eligibility or disclosure: suggestions are validated against the pinned definition on creation and acceptance; ambiguity questions are asked, never resolved by the model.
- Tenant scoping: the founder read services resolve documents with `findInTenant` under the bound actor's tenant; company visibility changes only through `setCompanyVisibility` with `company.edit`.
- No duplicate truth store: utterances are transient reading input (status PENDING → READ), never a value; responses remain the only answers; mandate constraints and taxonomy preferences remain canonical.
- Events carry identifiers only (asserted for `onboarding.utterance.recorded`).

## Postflight — CQ-PRE-REC-001 (2026-09-14)

Verdict: **PRE-VOICE PASS — Q-LED ONBOARDING AND LOST PRODUCT STATE RESTORED**

| Check                                                               | Result                                                                                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format (`prettier --check` on every changed file)                   | PASS                                                                                                                                                     |
| Lint (`eslint . --max-warnings=0`)                                  | PASS                                                                                                                                                     |
| Typecheck (turbo packages + root `tsc` over tests)                  | PASS after two api test fixtures were repaired                                                                                                           |
| Unit (`pnpm test`)                                                  | 138 files, 2179 tests PASS (one vitest fork-worker start timeout under load, not a test failure)                                                         |
| Integration (`pnpm test:integration`, fresh database)               | 44 files: 40 pass first run; media (3), q-knowledge (1) and q-evals (1) failed on unscoped assertions and a stale eval ceiling — hardened, then all pass |
| RLS (`db:reset` → `test:rls` on the empty schema → `dev:bootstrap`) | 29 files, 841 tests PASS                                                                                                                                 |
| Build (`turbo run build`)                                           | 37 tasks PASS                                                                                                                                            |
| `q:eval:lint`                                                       | PASS (29 cases, 15 graders)                                                                                                                              |
| `q:eval:ci`                                                         | exit 0, no baseline regression; QROUTE-001 v2 as recorded above                                                                                          |
| E2E (Playwright, built api and web, local Supabase)                 | 35 passed, 0 failed (final full run)                                                                                                                     |
| Live (§42)                                                          | fresh investor completed onboarding with no Skip; mandate ACTIVE; database state as recorded in Checkpoint D                                             |
| Live (§43)                                                          | fresh founder, chat-first, deck read and confirmed, leave/return resume, Home Q answers from the same state                                              |
| Live (§44)                                                          | fresh investor, one-sentence mandate placed and read, explicit exclusion confirmation, leave/return, mandate ACTIVE, Home Q answers from the mandate     |

Out of scope by instruction and untouched: ElevenLabs, Tavily, any
recommendation work (REC-001/002, ranker, slates, feed, GateQ). Known
follow-ups, none blocking: the Discover empty state still says "Set up your
mandate" to an investor with an active mandate (REC surface); the mandate
answer exposes stage codes and omits geography; the founder reader does not
propose taxonomy categories from an utterance (the form suggests them);
"Welcome back" also greets a person returning from the form within one
sitting; a six-word answer is treated as rich and read as well as placed.

## Threat coverage (doc 16) — CQ-Q-RESEARCH-001 rows

| Threat                                                                                         | Control                                                                                                                                                                                                                            | Proven by                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Founder-private material (deck text, figures, customer names) leaving Capital Q in a search    | The outbound query is composed from an allow-list — the person's own words (figures dropped), the subject's authorised public identity, neutral connectives; the model's argument adds nothing                                     | `q-research/test/egress.test.ts`, `q-tools/test/research-tools.test.ts` (marker `CQ_PRIVATE_DO_NOT_EGRESS_94731` never reaches the provider, a log or an error) |
| An investor's private constraints or another organisation's name used as a search subject      | Investor identity leads a query only for a self-referential question; markers dropped; own display name only                                                                                                                       | `egress.test.ts`, `egress-identity.test.ts`, `research-tools.test.ts` (`CQ_INVESTOR_PRIVATE_DO_NOT_EGRESS_55120`)                                               |
| A private, unknown or cross-tenant company named to a provider                                 | Subject identity is decided by `company.view` (owner) or disclosure NETWORK_VISIBLE/PUBLIC (others); a private company with no website has no identity and nothing is sent; unknown and undisclosed companies are one denial       | `research-tools.test.ts` (C, H); live investor run against a private company: no leak, no research of its name                                                  |
| A page instructing the model (prompt injection through retrieved text)                         | Excerpts are cleaned, bounded, scanned (a risk count travels as data), rendered inside the untrusted fence; the specialist offers no tools; the seam offers one round, so a page can never cause a call                            | `q-specialists/test/company-research.test.ts`, `model-gateway/test/q-answer-research.test.ts` (D/E), `q-research/test/research-service.test.ts`                 |
| SSRF: extract of localhost, private ranges, link-local, cloud metadata, file:/javascript: URLs | `judgePublicUrl` refuses with a reason; extract reads only URLs a search in the same run surfaced                                                                                                                                  | `url-safety.test.ts`, `research-tools.test.ts` (I)                                                                                                              |
| A search result treated as fact, or raising Capital Q's confidence                             | Sources are `PUBLIC_EXTERNAL_DATA` facts with truth class UNKNOWN and evidence status SELF_REPORTED (own site) / NO_EVIDENCE; findings citing them are bounded; `informationConfidence` unchanged                                  | `company-research.test.ts` ("does not let public pages raise Capital Q's confidence")                                                                           |
| Research writing canonical company or investor state, or a hard exclusion                      | Every tool is READ_ONLY / SAFE_READ; persistence is only `PUBLIC_WEB` evidence through the Evidence owner (owner only) and a USER_CLAIM knowledge candidate through the Write Gate; no domain service is reachable from q-research | `research-tools.test.ts` (F/G), `boundaries.test.ts`, database inspection (no company row changed by a run)                                                     |
| A model inventing a statement "the person said"                                                | The quote must occur verbatim in the person's message or nothing is recorded; key, statement and date validated                                                                                                                    | `q-knowledge/test/statement-recorder.test.ts`, `company-research.test.ts`, `q-answer-research.test.ts`                                                          |
| The provider key reaching the browser, a log, Postgres or a prompt                             | `TAVILY_API_KEY` is q-api-only, wrapped as a `ProviderCredential`, absent from web configuration, reported by presence; provider request ids never leave the adapter                                                               | `config/test/research-providers.test.ts` (J), `tavily-adapter.test.ts`, live smoke assertion                                                                    |
| Provider failure leaking status codes, endpoints or stacks to a person                         | Typed failure classes; Q receives `PROVIDER_UNAVAILABLE` with one plain sentence                                                                                                                                                   | `tavily-adapter.test.ts`, `research-tools.test.ts`, `company-research.test.ts`                                                                                  |
| Unbounded cost or a runaway loop                                                               | ≤ 2 searches, ≤ 5 results, one extract of ≤ 5, 2,000-character excerpts, one research read per investigation, one deterministic seam call; metrics carry counts only                                                               | `research-service.test.ts`, `q-answer-research.test.ts`                                                                                                         |

## Security acceptance — CQ-Q-RESEARCH-001

- Tavily is used through `@tavily/core` search and extract only, in one adapter file; the eslint boundary (`@tavily/*`) and a boundary test keep it and the research package out of apps/web, q-core, contracts, the domains, onboarding, q-firewall and q-runtime.
- `.env.local` untouched, unstaged and ignored; the change set was scanned for provider-key patterns before commit (only a synthetic test key appears). Configuration logs report `tavily: configured` and never a value.
- No new table, no migration. Public sources are `evidence.sources` rows of type `PUBLIC_WEB` (provider, URL, title, retrieval time, publication time only when dated, SECONDARY_EXTERNAL, organisation_private, INTERNAL, metadata `{ domain, researchRunId }`) with one excerpt item each, deduplicated by URL and excerpt hash; verified in the database after the live founder run (3 rows, 1 item each).
- A person's clarification is a `USER_STATEMENT` source + item and a `USER_CLAIM` knowledge object (SELF_REPORTED, LOW, ACTIVE, founder_private, CONFIDENTIAL); verified in `q_knowledge.objects` (`operations.geography`) and retrieved by a new conversation. No canonical company field changed.
- The model never chooses to reach outside Capital Q: the specialist calls the research port deterministically from the person's words; the conversational seam calls it once when the question asks for public information and the gathering round did not.
- The DB `run_events.visible_stage` CHECK constraint does not admit the new `SEARCHING_PUBLIC_SOURCES` stage; widening it is a migration deliberately not created (migration rule). Research is shown as `CHECKING_EVIDENCE` until it lands; the contract value and web label are in place.

## Postflight — CQ-Q-RESEARCH-001 (2026-09-14)

Verdict: **Q-RESEARCH PASS — Q CAN RESEARCH, COMPARE, CLARIFY AND PERSIST PUBLIC-WEB INTELLIGENCE**

| Check                                                                   | Result                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight (`git status`, `git fetch`, HEAD == @{u})                     | PASS (clean tree at 490afd8, local == remote)                                                                                                                                                                                                                                                                             |
| TAVILY_API_KEY in root `.env.local`                                     | PRESENT (never printed, logged, committed or sent to the browser)                                                                                                                                                                                                                                                         |
| Format (`prettier --check` on every changed file)                       | PASS                                                                                                                                                                                                                                                                                                                      |
| Lint (`eslint . --max-warnings=0`)                                      | PASS                                                                                                                                                                                                                                                                                                                      |
| Typecheck (turbo packages + root `tsc` over tests)                      | PASS (70 tasks; two test typings repaired)                                                                                                                                                                                                                                                                                |
| Unit (`pnpm test`)                                                      | 152 files, 2301 tests PASS (one config expectation updated for the new research-provider secret home)                                                                                                                                                                                                                     |
| Integration (targeted)                                                  | q-tools, q-knowledge (knowledge, q-knowledge), q-api (runs, events), q-evals company intelligence: 69 of 70 PASS; the one failure asserts `q_runtime.runs` is empty, which holds only on a fresh database — the shared local database held the 16 runs of this packet's live acceptance (environmental, not a regression) |
| Build (`turbo run build`)                                               | 38 tasks PASS                                                                                                                                                                                                                                                                                                             |
| Dependency audit (`pnpm audit --prod`, new SDK `@tavily/core@0.7.11`)   | No known vulnerabilities                                                                                                                                                                                                                                                                                                  |
| Secret scan of the change set                                           | Only the synthetic test key `tvly-synthetic-…`                                                                                                                                                                                                                                                                            |
| Live Tavily smoke (§37, `pnpm test:live-model packages/q-research/…`)   | 1 search, 1 extract, 2 sources (ng.linkedin.com, developer.ice.com); no key in output                                                                                                                                                                                                                                     |
| Live §38 (founder, real Tavily invocation)                              | Home Q: "What does the public web currently say about which countries Kobo360 operates in?" → 1 search, 1 extract, 3 sources persisted, stage shown, sources cited in the answer                                                                                                                                          |
| Live §39 (internal vs public comparison)                                | Q: Wikipedia and Y Combinator list seven countries; "Capital Q's internal record only cites Nigeria and Ghana"; public footprint broader than the record                                                                                                                                                                  |
| Live §40 HARD (mismatch → clarification → persisted → new conversation) | Founder: "Kenya was only a pilot and ended last year…" → "Noted as your statement …" → `USER_STATEMENT` + `operations.geography` USER_CLAIM in the database → new tab, new conversation, "What is the status of Kenya?" → "The Kenya pilot has ended; Kobo360 currently operates only in Nigeria and Ghana."              |
| Live investor (network-visible company)                                 | dev-investor on Home: research executed (3 sources, 0 persisted), founder-private description never shown; the two-call conversational path hit Groq free-tier TPM limits twice before succeeding with two sources                                                                                                        |
| Live investor (private company)                                         | "no records or facts about Kobo360" — nothing founder-private, nothing searched under the company's name                                                                                                                                                                                                                  |
| Migration                                                               | None created; the `run_events` stage constraint widening is reported, not written                                                                                                                                                                                                                                         |

Fixture: the dev founder's company was given the public identity of a real, well-documented logistics company (name, website, headquarters) through the product's own PATCH and visibility endpoints for the live runs, and restored afterwards; the knowledge object recorded during §40 remains in the local database as the acceptance record.

Out of scope by instruction and untouched: ElevenLabs/voice, GateQ, recommendations, Tavily Research/Crawl/Map, connectors. Known follow-ups, none blocking: widen the `run_events.visible_stage` CHECK constraint so `SEARCHING_PUBLIC_SOURCES` can be shown; the conversational path does not yet rewrite "(source S1)" labels into title/domain/date/link (the specialist path does); research about a non-owned company is transient until the Evidence owner admits it; the specialist still passes no earlier turns to the model; Groq's free-tier tokens-per-minute cap makes the two-call conversational research path fragile in quick succession (the seam requests two sources for that reason).

## Checkpoint R — CQ-Q-VOICE-001 R: close research integration handoff (2026-09-14)

| Item                          | What changed                                                                                                                                                                                                                                                                                                                                                                                                                 | Proven by                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1 · stage persistence        | Migration `20260917090000_q_runtime_visible_stage_public_sources.sql` drops and re-adds `run_events_visible_stage_check` with every earlier value plus `SEARCHING_PUBLIC_SOURCES`; the column stays a bounded vocabulary. The interim `CHECKING_EVIDENCE` fallback in the two research tools and the specialist is gone. Rollback would require rewriting rows carrying the new stage before narrowing the constraint again. | migration applied locally; RLS suite; a live research run persisting the stage and the web label "Searching public sources"                      |
| R2 · brittle integration test | `q-runs.integration.test.ts` "refuses privilege-bearing fields" now counts runs for the caller's real tenant and the tenant the payload claimed, not the whole table.                                                                                                                                                                                                                                                        | 2/2 pass against a database holding 16 unrelated valid runs                                                                                      |
| R3 · one source presentation  | q-core `presentPublicSource` / `describePublicSource` / `citePublicSources`; Company Intelligence re-exports it; the conversational seam collects the run's public sources from tool outcomes and rewrites label references before the recommendation guard. Public fields only.                                                                                                                                             | `q-core/test/source-presentation.test.ts`, `model-gateway/test/q-answer-research.test.ts` (R3), `q-specialists/test/cite-public-sources.test.ts` |
| R4 · no duplicate research    | The research service remembers a successful outcome per tenant, run and composed query; the seam already skips its deterministic call when the model researched.                                                                                                                                                                                                                                                             | `q-research/test/research-reuse.test.ts`, `q-answer-research.test.ts`                                                                            |
| R5 · investor persistence     | Deferred to CQ-PRE-REC-FINAL: research about a network-visible company owned by another organisation stays transient; no ownership, RLS or subject rule was bent.                                                                                                                                                                                                                                                            | postflight                                                                                                                                       |

## Checkpoint A — CQ-Q-VOICE-001 A: natural language → canonical meaning (2026-09-14)

| Item                                               | What changed                                                                                                                                                                                                                                                                                                                                            | Proven by                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Negation, contrast, scope (§7)                     | `packages/onboarding/src/domain/negation.ts`: clause-scoped markers ("not", "never", "don't", "isn't really", "unlike", "except", …); the one option resolver (`resolution/options.ts`) matches affirmative text only; founder document suggestions apply the same rule                                                                                 | `negation.test.ts` (the four packet sentences), `interpretation.test.ts` unchanged                                                                                                                                                                                                           |
| One utterance, many answers (§8-§9)                | `resolution/cross-step.ts` reads every unanswered step: unambiguous selects → suggestions retained until eligible; several fits → AMBIGUITY question with real options; cued figures and figure pairs → range suggestions; exclusion mentions → EXCLUSION_CONFIRMATION questions. Journeys declare `FOUNDER_INTERVIEW_CUES` / `INVESTOR_INTERVIEW_CUES` | `cross-step.test.ts` (founder and investor packet sentences), integration "one sentence answers many questions"                                                                                                                                                                              |
| Canonical categories (§5, §10-§11, §19)            | `resolution/taxonomy-phrases.ts`: affirmed n-grams → `OnboardingTaxonomyResolver` (the taxonomy classifier, composed in apps/api) → exact or clear lexical leader proposed as a set; close candidates → a choice among real nodes; no invented ids                                                                                                      | live: "We make AI software for freight forwarders and logistics companies… We're not fintech." → suggestion {Logistics & Mobility, Enterprise Software}; "We're an infrastructure platform." → question {Data Infrastructure, Developer API, Payment Infrastructure}; fintech never proposed |
| Ambiguity persisted (§10)                          | The asked step's AMBIGUOUS reading is recorded as an interview question with the matching options                                                                                                                                                                                                                                                       | integration suite; live run                                                                                                                                                                                                                                                                  |
| Corrections (§14)                                  | `resolution/correction.ts`: the words after "no, that's wrong / actually / what I meant" re-read against the last answered step and superseded through the normal response history; `CORRECTED` understanding                                                                                                                                           | `correction.test.ts`, integration case (two rows for intent, current = exploring)                                                                                                                                                                                                            |
| Contract                                           | `OnboardingUnderstandingSchema`: `CORRECTED` member; `proposed` count on ANSWERED / AMBIGUOUS / READING / UNCLEAR; web acknowledgement says "I also picked up N other things"                                                                                                                                                                           | contracts build, web unit tests                                                                                                                                                                                                                                                              |
| Model-assisted choice among candidates (§5 rung 6) | Not built: the deterministic rungs plus a clarification question met the acceptance sentences; a bounded index-choice task remains a follow-up if live use shows ambiguity the classifier cannot settle                                                                                                                                                 | —                                                                                                                                                                                                                                                                                            |

Environment note: an unrelated project's Next.js dev server (songscribe) was also
bound to port 3001 and intermittently answered Capital Q API requests during the
live smoke; it was stopped so the API could be exercised reliably.

## Checkpoint B — CQ-Q-VOICE-001 B: remove robotic onboarding interactions (2026-09-15)

| Item                                | What changed                                                                                                                                                                                                                                         | Proven by                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| One active question (§16)           | The "I still need" card became a small "N things left to settle · Review remaining gaps" entry; the live prompt is the only question on screen                                                                                                       | E2E: no "Answer" button anywhere in the workspace                                                    |
| No "Answer" gate (§17-§18)          | Chips carry the value they stand for; `OnboardingClient.submitValue` → runtime `submit`; single select and confirmation submit on one tap; multi select toggles + "Done" (exclusive option submits at once); "I don't know" and "Skip" one click     | `promptFor` tests; E2E founder F0/F1/F2/F3 and investor I0                                           |
| Category UX (§19)                   | Taxonomy steps render Q's pending proposal as selected chips ("I think these are the closest fits"), Keep these / adjust (ACCEPT or EDIT of the suggestion), and a real taxonomy search; founder presentation now carries labels for suggested nodes | E2E: "Logistics & Mobility" pre-selected after the description, "Supply Chain" added by search, kept |
| Gaps answered in place (§16, §21)   | Each pending question offers its own options, else the definition's options, else a figure/text input, else the form; `JourneyVocabulary.stepType/optionsFor` from the pinned definitions                                                            | `stillNeeded`/`gapValue` tests                                                                       |
| Text + options simultaneously (§20) | Composer always enabled (only while a request is in flight is it not), placeholder says "Or say it in your own words" on select steps                                                                                                                | E2E types on text steps, taps on select steps                                                        |
| Tangents (§23)                      | Questions and request-shaped sentences go to Q over the event stream (`/api/q-stream`), stage labels shown, one continuing Q conversation per interview, bridge line then the live question                                                          | `looksLikeQuestionForQ` tests; manual check against q-api                                            |
| Resume / pause (§24-§25)            | `resumeIntent` / `pauseIntent`; pause acknowledges persistence, never completes                                                                                                                                                                      | tests with the packet phrases; E2E "Let's stop here." / "Where were we?"                             |
| Welcome back (§26)                  | Time-gated on `session.lastActivityAt` (30 min); never from browser memory                                                                                                                                                                           | tests at the boundary; E2E: form-and-back and reload show no greeting                                |
| Form mode (§22)                     | "Review as form" / "Use the form" unchanged; same session both ways                                                                                                                                                                                  | E2E: form shows "Your founding team" after the thread reached F4                                     |

| Proposals retired on answer (§21) | Runtime `commitResponse` expires the other pending suggestions for a step once the person has answered it (the one being accepted or corrected is resolved as before), so an older proposal never lingers as an offer to overwrite the answer | onboarding unit + integration suites; live: after "Keep these" the older category proposal no longer reappears |
| Short text is the answer | `interpretUtterance` on a `short_text` step takes any line under six words as the value; a figure inside a name ("E2E Rail 2024") no longer makes it a narrative to be read | interpretation unit tests; E2E company and firm names typed into the composer |

## Checkpoint C — CQ-Q-VOICE-001 C: ElevenLabs Speech Engine (2026-09-15)

| Item                                         | What changed                                                                                                                                                                                                                                                                                                              | Proven by                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Architecture (§28-§29)                       | ElevenLabs is the Speech Engine (mic transport, STT, turn detection, interruption, TTS); Q stays in the Q API. [ADR 0010](../adr/0010-realtime-voice-through-a-speech-engine.md); module doc `docs/modules/q-voice.md`                                                                                                    | —                                                                              |
| Secrets and ids (§30-§31)                    | `packages/config/src/speech-providers.ts`: `ELEVENLABS_API_KEY` as `ProviderCredential` (server-only, redacted), `ELEVENLABS_SPEECH_ENGINE_ID` / `_MALE`; q-api config `voice` + `secrets.speechProviders`; `pnpm voice:setup` creates/updates the two Speech Engine resources and records ids in gitignored `.env.local` | config status logs presence only; `q-voice.test.ts` asserts no key in any body |
| Provider adapter (§33)                       | `RealtimeVoiceProvider` port (`voice/provider.ts`); ElevenLabs adapter in `voice/providers/`; eslint Rule H refuses `@elevenlabs/*` outside the two adapter directories                                                                                                                                                   | lint                                                                           |
| Token endpoint + binding (§31, §34, §85-§86) | `POST /v1/q/voice/sessions` issues an ephemeral credential and binds the provider conversation id to the server-resolved actor and thread before returning; per-person and total bounds; a stranger presenting the id is closed                                                                                           | `q-voice.test.ts`                                                              |
| WebSocket auth (§32)                         | `/v1/q/voice/ws` attached to the Q API's HTTP server through `speechEngine.attach`, which verifies the provider JWT on every upgrade; `disableAuth` is not exposed by the adapter                                                                                                                                         | code review; adapter has no such option                                        |
| Same Q thread (§35-§36)                      | A spoken interview answer → the application API's `say` under the person's own bearer; a spoken question → `createRun` with `modality: "VOICE"` in the bound conversation, spoken as the run stream arrives; no voice tables                                                                                              | `voice-turn.test.ts`                                                           |
| Interruption (§37-§38)                       | The provider aborts the turn signal on barge-in; the run is cancelled via `cancelRun`; sentence chunking (`speech.ts`) means at most one sentence is lost and nothing stale is spoken                                                                                                                                     | `voice-turn.test.ts` interruption case; `voice-speech.test.ts`                 |
| Streaming (§40)                              | Deltas are re-chunked by sentence and handed to `sendResponse` as an async iterable; a completed message without deltas is spoken whole (bounded)                                                                                                                                                                         | `voice-turn.test.ts` streaming case                                            |
| Shared interview moves                       | `@capital-q/onboarding/interview`: `looksLikeQuestionForQ`, `resumeIntent`, `pauseIntent`, `thinkingIntent` — one implementation for the typed thread and the spoken one                                                                                                                                                  | `interview-moves.test.ts`; web tests unchanged                                 |
| Live tunnel (0A)                             | `ngrok version` 3.39.9 (MSIX) present; `ngrok config check`, `ngrok http 3002` and the user/machine `NGROK_AUTHTOKEN` all report no credential on this machine, so the tunnel could not be started and the Speech Engine resources were not created here                                                                  | ERR_NGROK_4018; see Known limitations                                          |

## Checkpoint D — CQ-Q-VOICE-001 D: voice interview UX (2026-09-15)

| Item                                   | What changed                                                                                                                                                                                                                                                                                                                             | Proven by                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Entry and layout (§43-§45)             | "Talk with Q" beside the review controls of the Q-led workspace; while voice is active a calm panel sits above the thread (presence, state label, mute / end voice / Female-Male / volume) and the thread, contextual controls, progress and composer stay exactly where they were — voice adds nothing that would make it a different Q | web typecheck/lint; screenshots deferred to the live smoke (tunnel)                                      |
| Presence and states (§46-§47)          | `features/voice/q-presence.tsx`: the Q mark (doc 18 §33 — no orb) in a ring that eases with the session's own input/output level; public labels only (Ready, Connecting, Listening, Thinking, Speaking, Voice paused); breathing in opacity while thinking; still under `prefers-reduced-motion`                                         | `VOICE_STATE_LABELS`; global reduced-motion rule                                                         |
| Live transcript (§48)                  | The provider's final user and Q lines join the thread as turns; after each of Q's lines the session is re-read so chips and progress follow. Partial transcripts are not bolted on with a second STT (the SDK reports final lines)                                                                                                       | code                                                                                                     |
| Controls (§49-§51)                     | Mute, End voice, voice picker (Female default / Male), volume; switching voice restarts only the provider session — the interview and the Q conversation stay where they were on the server                                                                                                                                              | `use-voice-interview.ts`                                                                                 |
| Voice tuning (§52)                     | Recorded in `dev/voice-setup.ts` and `docs/modules/q-voice.md`; Sarah (female) default, Daniel (male) alternative                                                                                                                                                                                                                        | —                                                                                                        |
| Fillers and acknowledgements (§53-§54) | `withFiller`: one "Let me check that." only when the first words take longer than 2.5 s; "Let me look at public sources." once when a run reaches the research stage; spoken acknowledgements are "Noted." + the next question, never "Great!"                                                                                           | `voice-speech.test.ts` (quick answer → no filler; slow → one), `voice-turn.test.ts` (research line once) |
| Patience (§55)                         | "Let me think" / "give me a second" → "Of course, take your time."; the Speech Engine is configured `turnEagerness: patient`, 10 s turn timeout                                                                                                                                                                                          | `interview-moves.test.ts`                                                                                |
| Options during voice (§59-§61)         | A tapped option, "Done" on a set, "Skip", typed text and "Keep these" go through the spoken thread (`sendUserMessage`) so the server runs the same `say` / ACCEPT the typed path runs and Q continues aloud; an adjusted category set is committed over HTTP and Q is asked to continue                                                  | `voice-turn.test.ts` (spoken "keep these" → ACCEPT)                                                      |
| Research in voice (§64-§65)            | The research stage is spoken as its approved label; long material is never read aloud (`bounded`, 1,200 chars)                                                                                                                                                                                                                           | `voice-speech.test.ts`                                                                                   |
| ElevenLabs UI components               | The registry (`ui.elevenlabs.io/r/orb.json`) is behind a browser security checkpoint from this machine and doc 18 §33 rules out an orb; the presence is hand-written on the Q mark                                                                                                                                                       | CLI dry-run log                                                                                          |

## Checkpoints E/F — CQ-Q-VOICE-001: one interview across modalities; live acceptance (2026-09-15)

What the same-interview property rests on, and how much of it this machine could prove.

| Journey (§67-§81)                                                         | How it is the same interview                                                                                                                                   | Proven here                                                                                                                                                 |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Voice → text (§67)                                                        | A spoken answer reaches `say` on the same onboarding session; the typed thread reads the session back and continues from `currentStep`                         | `voice-turn.test.ts` (say under the bound token, next question spoken); `onboarding-conversation.desktop.spec.ts` (typed continuation from persisted state) |
| Text → voice (§68)                                                        | "Talk with Q" binds the credential to the session id and the Q conversation the thread already holds; Q opens with the live question                           | `q-voice.test.ts` (binding carries onboarding + thread); workspace `talkWithQ`                                                                              |
| Click → voice (§69)                                                       | A tap while voice is active travels the spoken thread and the server runs the same `say`; a tap before voice is the structured `submitValue`                   | workspace routing; `voice-turn.test.ts`                                                                                                                     |
| Voice → form (§70)                                                        | Form mode reads the same session; nothing lives in the provider session                                                                                        | `onboarding-conversation.desktop.spec.ts` ("Use the form" shows the position the thread reached)                                                            |
| Tangent / research → interview (§71-§72)                                  | A spoken question is a VOICE run in the bound conversation; the research stage is spoken; the live question returns after                                      | `voice-turn.test.ts` (streaming, research line, bridge back)                                                                                                |
| Pause → new session (§73-§74)                                             | "Let's stop here." persists nothing new and completes nothing; a new voice session binds to the same Capital Q session — no ElevenLabs memory, no localStorage | `interview-moves.test.ts`; `voice-turn.test.ts` (pause/resume without touching the runtime)                                                                 |
| Live founder / investor journeys, interrupt, filler, disconnect (§75-§81) | Designed and unit-proven with fake adapters (interruption → `cancelRun`, one filler on a slow turn, plain disconnect notice with typing still available)       | **Not exercised live**: no authenticated ngrok on this machine, so no public WSS, no Speech Engine resource, no microphone session                          |

Security (§82-§86): the credential is bound to the server-resolved actor before it is returned; a stranger presenting the provider conversation id is closed; the body cannot name a tenant (422); the provider key is absent from every response and problem body (`q-voice.test.ts`), from the web configuration (`speech-providers.test.ts`) and — see the postflight — from the production client bundle. Only conversational text reaches the provider (`speech.ts` strips citations, addresses and markup).

Performance (§87-§89): `q.voice.turn.first_speech_ms` (final transcript → first text handed to speech) is recorded per turn as an observability histogram; no live sample exists yet, and none is invented. Memory on this 16 GB machine during the packet: ~1.0 GB free with the dev stack, the browser and the lint run up; the embeddings container (1.8 GiB) is the largest Docker consumer; the voice channel adds no worker or container — it runs inside q-api.

Analytics (§90): voice_started / voice_ended / voice_interrupted / voice_error / q_tool_used equivalents are observability counters (`q.voice.session.issued`, `q.voice.session.started`, `q.voice.session.ended`, `q.voice.turn` by outcome and path, `q.voice.error`) — not domain events, not the outbox, not the run stream.

## Postflight — CQ-Q-VOICE-001 (2026-09-15)

Verdict: **VOICE INTERVIEW FAIL — ngrok is not authenticated on this machine (ERR_NGROK_4018: no ngrok.yml at the default path, no NGROK_AUTHTOKEN in the user or machine environment), so no public WSS tunnel could be opened, the Speech Engine resources were not created, and the live ElevenLabs paths — microphone, STT, Q receiving a spoken turn, TTS, interruption, the founder and investor voice journeys — were not exercised.**

Everything that does not need the tunnel is built, tested, committed and pushed. Status: BLOCKED ON LIVE VERIFICATION, not on code.

| Checkpoint                                 | Commit                                                                   | Local                          | Remote  | Equal                     |
| ------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------ | ------- | ------------------------- |
| R — close research integration handoff     | CQ-Q-VOICE-001 R: close research integration handoff                     | e7dc899                        | e7dc899 | yes                       |
| A — natural language → canonical meaning   | feat(onboarding): natural language → canonical meaning                   | 038cfd1                        | 038cfd1 | yes                       |
| B — remove robotic onboarding interactions | feat(web): remove robotic onboarding interactions                        | 53dd209                        | 53dd209 | yes                       |
| C — ElevenLabs Speech Engine channel       | feat(q-api): realtime voice channel through the ElevenLabs Speech Engine | 09ca9f1                        | 09ca9f1 | yes                       |
| D — voice interview UX                     | feat(web): voice interview UX on the Q-led workspace                     | 2e6f635                        | 2e6f635 | yes                       |
| E/F — cross-modality proofs, postflight    | docs: CQ-Q-VOICE-001 E/F and postflight                                  | the commit adding this section | same    | yes (verified after push) |

Client bundle proof (§85): the production web build (200 files under `.next/static` and `.next/server/app`) contains zero occurrences of the ELEVENLABS_API_KEY value and zero of its name; the only ElevenLabs mention in static output is the browser SDK chunk itself. E2E on that build: the interview spec passes 3/3 with the "Talk with Q" entry present.

**To unblock the live portion** (in this order, on this machine): `ngrok config add-authtoken <token>` (the MSIX install expects `%LOCALAPPDATA%\ngrok\ngrok.yml`), then `ngrok http 3002`, then `pnpm voice:setup -- --ws-url wss://<ngrok-host>/v1/q/voice/ws`, restart `pnpm dev`, open the founder interview and press "Talk with Q". The bounded manual smoke (§93) then covers mic → STT → Q turn → TTS, interruption, typing during voice, a tapped option during voice, and the two journeys; the `q.voice.turn.first_speech_ms` histogram gives the speech-end → first-text samples.

## Security acceptance — CQ-REC-001 deterministic hard eligibility (2026-09-18)

| Concern                                           | How it is held                                                                                                                                                                                                                       | Proven by                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Founder-private inputs (memory, chats, documents) | `EligibilityPorts` has no port that can express them; the subtree imports no Q, evidence, media or onboarding package and contains no SQL                                                                                            | `eligibility-boundary.test.ts`; `eligibility-service.test.ts` L/M/N; `eligibility.integration.test.ts` L/M/N |
| Public-web research bypassing canonical state     | A PUBLIC_WEB `evidence.sources` row is not an input; only a confirmed ACTIVE taxonomy assignment can match a declared exclusion                                                                                                      | service test N; integration test L/M/N                                                                       |
| Model-derived hard exclusions                     | Only `importance = HARD_EXCLUSION` constraints and `isExclusion` preferences from `user_selected`/`admin_curated` are read; `q_inferred`/`document_extracted`/`integration` rows cannot exclude; MANUAL_ONLY constraints are ignored | policy test I; onboarding invariant unchanged                                                                |
| Client-provided tenant / organisation / mandate   | Investor organisation resolved from the actor; mandate reads are tenant- and organisation-scoped; a pinned foreign mandate resolves as absent                                                                                        | service test "pinned mandate belonging to another investor"                                                  |
| Cross-tenant exposure                             | Candidates are cross-tenant by design; every id passes the disclosure evaluator; results carry ids and codes only                                                                                                                    | policy test O; integration test C/O                                                                          |
| Private reason leakage                            | Reason codes are a closed set naming canonical state or a declared rule; `detail` is a dimension or relationship state, never a declared value                                                                                       | policy tests "reason codes…", "hard exclusion on a dimension…"                                               |
| AVOID / MUST / cheque as eligibility              | Never evaluated; the cheque criterion is NOT_APPLICABLE in v1                                                                                                                                                                        | policy tests E, J; integration test D/E                                                                      |
| DRAFT or stale mandate                            | Only ACTIVE is FOUND; a DRAFT/CLOSED pinned mandate yields `MANDATE_NOT_ACTIVE` with no rules read                                                                                                                                   | policy test H; service test H; integration test H                                                            |
| GateQ / ranking contamination                     | Only `INVESTOR_DISCOVER` is evaluated; other modes throw; no weights, no order, no score in the result                                                                                                                               | service test "only INVESTOR_DISCOVER…"; result schema                                                        |
| Arbitrary SQL / dynamic tables                    | The Recommendation context issues no SQL; the one new query is `createPostgresCompanyMarketplaceQueryPort` in the Companies context, bounded to 500 ids                                                                              | boundary test; code                                                                                          |

## Postflight — CQ-REC-001 (2026-09-18)

Verdict: **REC-001 PASS — HARD ELIGIBILITY IS DETERMINISTIC, PRIVATE-SAFE AND READY FOR CANDIDATE GENERATION**

| Check                                                                                           | Result                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format (`prettier --check .`)                                                                   | PASS on every tracked file; the 244 warnings are all under the untracked, git-ignored `graphify-out/`                                                        |
| Lint (`eslint . --max-warnings=0`)                                                              | PASS                                                                                                                                                         |
| Typecheck (`turbo run typecheck` + root `tsc`)                                                  | 76 tasks PASS                                                                                                                                                |
| Unit (`pnpm test`)                                                                              | 202 files, 2627 tests: 2626 pass; `packages/ui/test/q-composer.test.tsx` hit a vitest fork-worker start timeout under concurrent load and passes alone (5/5) |
| Integration (`vitest --config vitest.integration.config.ts packages/discovery`, local Supabase) | 9 tests PASS                                                                                                                                                 |
| Build (`turbo run build`)                                                                       | 41 tasks PASS                                                                                                                                                |
| `git diff --check`, secret scan of changed files, cycle check                                   | clean; no owning context depends on `@capital-q/discovery`                                                                                                   |
| Migration                                                                                       | NONE — `marketplace_readiness_state` already exists; only `not_assessed` is written today                                                                    |
| New external integration / ENV / model calls                                                    | NONE / NONE / ZERO                                                                                                                                           |

Canonical inputs: marketplace state `core.companies.marketplace_readiness_state` via `marketplaceParticipationOf`; visibility `core.companies.marketplace_visibility` plus the disclosure evaluator; ACTIVE mandate via `InvestorMandateQueryPort`; hard exclusions via `investor_mandate_constraints.importance = HARD_EXCLUSION` and `taxonomy.mandate_preferences.is_exclusion`; stage `current_stage_code`; geography `headquarters_country`; cheque: none (NOT_APPLICABLE); relationship `network.relationships.current_state` via `RelationshipQueryPort`.

Golden scenarios A–P: A ELIGIBLE · B INELIGIBLE · C INELIGIBLE · D INELIGIBLE · E ELIGIBLE (not ineligible) · F INELIGIBLE · G UNDETERMINED · H DRAFT exclusion has no effect · I cannot hard-exclude · J ELIGIBLE (not automatically ineligible) · K DISCOVERED passes, unknown state UNDETERMINED, no closed state exists in v1 · L unchanged · M unchanged · N unchanged until a canonical classification · O INELIGIBLE with ids only · P identical.

Known limitations (REC-001 only): every company is `not_assessed`, so nothing is ELIGIBLE until the readiness packet writes `marketplace_ready`; the pre-REC slate is untouched and still gates on visibility alone until REC-002 routes candidates through this service; Network defines only DISCOVERED, so `RELATIONSHIP_STATES_CLOSED_TO_DISCOVERY` is empty; onboarding writes stage as MUST plus a range, so a hard stage gate arises only from an explicitly declared HARD_EXCLUSION constraint; hard exclusions on `red_flag`, `business.attribute`, `founder.business_attribute`, `sector` and `investment_role` are UNDETERMINED for every company until a canonical company field answers them.

Next: CQ-REC-002 — Structured Candidate Generator.
