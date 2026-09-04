# Onboarding module (`@capital-q/onboarding`)

**Purpose.** The declarative onboarding runtime: journeys are published
definitions, sessions are pinned to an immutable definition version, answers
are validated historical responses, branching is deterministic data, and
confirmed answers reach the canonical domains through registered write-target
handlers inside the onboarding transaction. A product engine, not a set of
forms, and not a home for business truth.

**Ownership.** Onboarding owns journey state only: definitions, versions,
steps, sessions, step states, responses, suggestions and the runtime events.
Company, Investor, Capital Objective and Taxonomy truth stay in their own
contexts; there is no `onboarding_company`, draft investor or temporary raise.
The runtime carries no Founder or Investor logic; those journeys are manifests
and write adapters published by CQ-ONB-002 / CQ-ONB-003.

```
onboarding response ≠ canonical domain state
suggestion ≠ response ≠ truth
published definition version = immutable; session = pinned
tenant / organisation / subject bind once, one way
```

## Definitions and versions

`onboarding.definitions` — one per `journey_type` (`founder`, `investor`,
`external_investor_conversion`), status `ACTIVE | RETIRED`, `current_version`
(the published version new sessions receive; never alters existing
sessions). `onboarding.definition_versions` — UNIQUE(definition, version ≥ 1),
`schema` = `OnboardingDefinitionSchemaV1` (`schemaVersion: 1`, named phases,
runtime settings: bound subject type and whether an unbound bootstrap start is
allowed), `manifest_hash`, `published_at`. `onboarding.steps` — the only
executable step store: UNIQUE(version, step_key), UNIQUE(version,
sequence_order ≥ 0), `step_type` (single_select, multi_select, range,
short_text, long_text, voice_text, document_upload, confirmation),
`required`, `configuration` (discriminated Zod per type: prompt, supporting
text, whyQAsks, phase key, option keys + labels, selection bounds, text
bounds, exact-decimal range bounds, resource-type allowlist, confirmation
labels — never styling), `branching_expression`, `writes_to`. Database
triggers freeze a published version and its steps (no update, insert or
delete); change means publishing the next version.

**Publication.** `publisher.publish(manifest)` is a trusted reference-data
path (no admin UI): validate the complete manifest (shape, unique keys and
sequence, known phases, branch references to earlier steps only, branch
values that are real options, bounded depth, coherent bounds, an
unconditional first step) → get/create the definition → insert the version
and steps → set `published_at` → raise `current_version` → commit. Same
journey + version + manifest again is idempotent; a different manifest for
the same version conflicts. No production Founder or Investor definition is
published here.

## Branch DSL

`branching_expression` is data: `EXISTS`, `EQUALS`, `IN`, `CONTAINS` over a
prior step's current response, composed with `ALL`, `ANY`, `NOT` (depth ≤ 8).
A predicate may reference only lower-sequence steps, so evaluation is a single
in-memory pass over the current-response snapshot and cycles are impossible. A
step is eligible when it has no expression or the expression is true;
responses of steps that are themselves ineligible are invisible to branching.
No JavaScript, SQL, JSONLogic, functions or external lookups.

## Sessions

`onboarding.sessions` — user-owned (`user_id` is the application Person id,
never `auth.users.id`), pinned `definition_version_id`, `status`
`ACTIVE | COMPLETED | CANCELLED` (cancel is not exposed; dormant sessions are
never expired), `current_step_key` (navigation state, null once completed),
`version` for optimistic concurrency, timestamps. **Bootstrap:** a session may
begin with `tenant_id`, `organisation_id`, `subject_type`, `subject_id` all
null — a personal session before any canonical subject exists; no fake
company or organisation is created. **Binding** (`internal.bindSessionContext`)
resolves the subject through the owning domain's query port under the actor's
context and sets all four together, once: NULL → value, same value idempotent,
never a different subject or organisation (application check + database
trigger). Pair nullability and organisation ⇒ tenant are constraints. Partial
unique indexes allow at most one ACTIVE unbound session per user + journey and
one ACTIVE bound session per user + journey + subject.

**Start / resume.** `POST /v1/onboarding/sessions` with Idempotency-Key:
journey → ACTIVE definition → current published version (the server chooses;
a client never names a version). An existing matching ACTIVE session is
resumed (200); otherwise one is created under an advisory lock (201) with the
first eligible step `IN_PROGRESS`. Same key + same payload replays; same key

- different payload → IDEMPOTENCY_CONFLICT. A subject at start requires an
  organisation context and must be owned by it (enumeration-safe otherwise).

**Mutations.** Every mutation row-locks the owner's session, replays an
identical Idempotency-Key, requires `status = ACTIVE`, compares
`expectedSessionVersion` (VERSION_CONFLICT otherwise), validates against the
pinned definition and the current path, then commits journey state with
`version + 1`, `last_activity_at` and the outbox event in one transaction.
Submit: registered write targets → insert response → link the previous
response forward → step COMPLETED → recompute eligibility → next incomplete
eligible step becomes current. Skip: optional, eligible, not completed →
SKIPPED with a server timestamp, no fake answer. Back: to the previous visited
eligible step (or a named earlier visited one); navigation only, nothing
deleted; a subsequent answer supersedes. Complete: every eligible required
step COMPLETED → `COMPLETED`, `completed_at`, `current_step_key = null`;
completion is journey completion, not visibility, readiness or verification.

## Responses and step states

`onboarding.step_states` PK(session, step_key), `IN_PROGRESS | COMPLETED |
SKIPPED`; no row = not entered. `onboarding.responses` — history: typed
`response_type`, discriminated `response_jsonb` (stable option keys, unique
multi-select keys, exact-decimal range values, bounded text, typed resource
ids, explicit confirmation), `raw_text` for text steps only, `source_modality`
(`SELECTION | TYPED_TEXT | VOICE_TRANSCRIPT | DOCUMENT_REFERENCE |
SUGGESTION_ACCEPT | SUGGESTION_EDIT`; provenance, never authority — clients
may only declare the first four). Current = `superseded_by_response_id is
null` (partial unique per session + step); a revision inserts a new row and
links the old one forward (deferred FK). A trigger forbids any content edit
or delete. Progress counts only currently eligible steps; a response for a
step that fell off the path remains history and is reported in `pathChanges`.

## Suggestions

`onboarding.suggestions` — `PENDING → ACCEPTED | EDITED | REJECTED |
EXPIRED`, validated against the pinned step before persistence, typed bounded
`source_refs`, exact `confidence` in [0, 1] (not a calibrated probability),
nullable `model_run_id` (no FK until Q runtime tables exist). Creation and
expiry are internal trusted operations (no browser route); the session owner
resolves via `POST …/suggestions/:id/resolve`: ACCEPT commits the suggested
value as a normal validated response with `SUGGESTION_ACCEPT`, EDIT commits
the user's value with `SUGGESTION_EDIT` (the suggested value is never
mutated), REJECT records the decision and writes nothing. A resolved
suggestion cannot be resolved again. No Q, model or generator exists here.

## Write-target seam

`writes_to` is `[{ targetKey }]` with semantic keys (`company.stage`,
`capital.objective`, …), never a table or column. A domain registers an
`OnboardingWriteTargetHandler` per key; the runtime hands it the onboarding
`TransactionContext`, actor, session, step and current responses and awaits it
before the response is stored, so a failing canonical write rolls back the
response, the step state, the version bump and every event. A published step
whose target has no registered handler fails safely (redacted 500, safe fault
code logged) and stores nothing. CQ-ONB-001 registers zero production
handlers; the COMPANY subject resolver is identity resolution, not journey
logic.

## Events, audit, privacy

Outbox events (`CONFIDENTIAL`, `PLATFORM` tenancy so a bootstrap session may
publish without a tenant; bound sessions carry tenant and organisation on the
envelope): `onboarding.session.started@1`, `onboarding.response.committed@1`,
`onboarding.step.skipped@1`, `onboarding.session.completed@1`,
`onboarding.suggestion.resolved@1`. Payloads carry identifiers, step keys,
versions and statuses only. No `audit.material_actions` row is written for
journey activity; canonical mutations performed by handlers keep their own
domain audit. Logs carry operation, session id, journey, definition version,
step key, session version — never response values, raw text or suggested
values. Metrics: sessions started / completed, responses committed, steps
skipped, version conflicts, suggestions resolved, runtime errors, with
bounded labels.

## API and security

Routes (all require an authenticated Person; an organisation context is
optional so bootstrap works before any membership exists): `POST /sessions`,
`GET /sessions/:id`, `POST /sessions/:id/responses`, `POST
/sessions/:id/steps/:stepKey/skip`, `POST /sessions/:id/back`, `POST
/sessions/:id/complete`, `POST /sessions/:id/suggestions/:id/resolve`. The
view exposes the session summary, phases, the current step's safe
presentation with its current response, truthful progress, pending
suggestions and path changes — never write targets, branching or handler
keys. Session ownership is `actor.userId === session.user_id`: organisation
admins, colleagues, other tenants and guessed ids get an enumeration-safe
404; a bound session keeps its context when the owner acts under another or
no context. All nine tables are INTERNAL_SERVER_ONLY (RLS enabled, no
policies, no grants); the privileged server role can read rows, and that is
never application authorisation.

## Frontend boundary

WEB-011 keeps its fixture behind the `FounderOnboardingClient` port. Its
presentation model uses composite Founder step kinds that have no V1 runtime
step type; mapping them onto this runtime's contracts (and any step-type
extension) is CQ-ONB-002's Founder-definition work. No visual change here.

## Not here (later packets)

Founder F0–F8 definition and write mappings (CQ-ONB-002), Investor I0–I12
(CQ-ONB-003), Evidence sources and upload (CQ-EVD), voice capture and
transcription, Q-generated suggestions, pitch media, recommendation, an
onboarding builder UI, `onboarding.voice_captures`.
