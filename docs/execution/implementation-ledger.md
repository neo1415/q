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
CQ-Q-021            NEXT       Not started.
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
