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
`GET /sessions/current?journeyType=` (the caller's latest active or
completed session, 404 when none), `GET /sessions/:id`, `POST /sessions/:id/responses`, `POST
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

## CQ-ONB-002 additions

- Step type `reference_select` (canonical reference entities by stable id;
  the taxonomy confirmation step). Response type RESOURCE_REFERENCE with the
  SELECTION modality.
- Handlers may bind the session's context inside their transaction
  (`OnboardingWriteContext.bindContext`, same one-way rules).
- Step-context providers: a confirmation step names a `contextKey`; the
  registered provider assembles server-side data into `currentStep.context`.
  A missing provider is a redacted 500 (fault `STEP_CONTEXT_PROVIDER_MISSING`).
- `responses`: the current response of every eligible step, on the view.
- An unbound start resumes the person's latest active session of the
  journey, bound or not; `GET /sessions/current` reads it without starting.
- Navigation with `targetStepKey` accepts any visited, currently eligible
  step (earlier or later). Unvisited steps stay locked.
- `OnboardingActor.principal` carries the verified principal from the API
  hook so person-scoped bootstrap (creating a first workspace) can run inside
  a handler. Never reconstructed from client input.

The Founder journey itself lives in `docs/modules/founder-onboarding.md`.

## CQ-ONB-003 additions

- `reference_select` steps may name a `contextKey` (as confirmations do),
  so a server-assembled candidate list (the investor's open mandates) reaches
  the browser on the step view.
- Resource type `INVESTOR_MANDATE` for RESOURCE_REFERENCE responses: the
  mandate an investor is defining is a typed reference on the session, never
  free JSON.
- `createInvestorOrganisationOnboardingSubjectResolver` binds sessions to
  INVESTOR_ORGANISATION subjects through the Investor query port.
- The migration renderer (`renderOnboardingDefinitionMigration`) and the
  response-value helpers moved from the Founder package into this runtime
  package and are shared by both journeys.

The Investor journey itself lives in `docs/modules/investor-onboarding.md`.

## Conversational interview (CQ-PRE-REC-001 §16-§30)

The Q-led interview is a reading of this runtime, not a second store of
progress. Q asks the session's current step in the words the pinned
definition gives it, with the step's own options as quick controls; what Q
picked up is the session's pending suggestions; what Q still needs is its
pending questions; progress is its step states. A refresh, a logout or a
new device shows the same interview because nothing authoritative lives in
the browser, a graph process or a provider conversation.

- `POST /v1/onboarding/sessions/:id/say` (`SayOnboardingRequest`) is the one
  entry point for a turn. `domain/interpretation.ts` reads what was said
  deterministically against the current step — an option named in plain
  words (with journey alias tables such as `FOUNDER_UTTERANCE_ALIASES`), a
  figure inside a range, a plain text answer, a yes on a confirmation — and
  a few conversational moves (skip, I don't know, why, upload). A
  recognised answer goes through `submitResponse`; a skip through
  `skipStep`; both exactly as a tap would. The reply
  (`OnboardingUnderstanding`) says which: ANSWERED, SKIPPED, REQUIRED, WHY,
  UPLOAD, AMBIGUOUS, DECLINED, READING, UNCLEAR.
- A sentence no rule can place (several facts, a figure with context, a
  preference in the person's own words) is recorded in
  `onboarding.utterances` (PENDING → READ | IGNORED) and announced by
  `onboarding.utterance.recorded` (identifiers only). The journey's own
  reading — the founder extraction, the investor mandate synthesis — turns
  it into ordinary suggestions and questions the person confirms. The
  founder reading also reacts to `onboarding.response.committed` on its
  narrative steps (description, follow-up), so prose typed as an answer is
  read too. An utterance is never a value.
- Nothing the model proposes is authoritative: suggestions still pass the
  pinned step's validation on creation and again on acceptance, and the
  founder mapper (`structuredValueFor`) only lands a reading in a step's
  own vocabulary — "Seed" becomes the `seed` option, "$3m" a range value —
  or leaves it for the review list. A hard exclusion is still only ever
  written by the investor's explicit answer to an EXCLUSION_CONFIRMATION
  question.
- Idempotency: a `say` that records an utterance uses the `say` operation;
  one that answers or skips carries its key into the submit or skip it
  delegates to.
- A rich sentence that names an option is placed **and** read (§44): "We
  back Series A and B in fintech across Nigeria, one to three million" lands
  Series A and B on the stages step through `submitResponse`, and the whole
  sentence is recorded as an utterance under `<key>:reading` so Q proposes
  the cheque, the geography and the sectors for confirmation. The
  `ANSWERED` understanding carries the `utteranceId` when that happened.
  A bare option ("Seed") is only placed.
- What the interview will not read into an option: a mention right after a
  negation or contrast word ("beyond pilots", "not a SAFE") is what the
  person is not saying, and a word that only occurs inside another matched
  option's phrase ("co-invest alongside a lead" names co-investing, not
  leading). A confirmation step accepts its own labels ("Save my raise") as
  well as plain assent. A reference step whose server context lists
  candidates (the investor's mandates) is answered by name, or by assent
  when there is exactly one; it is never chosen by position.
- The way back in: once a company or investor organisation exists, Home no
  longer shows the setup paths for a stranger; while a journey session is
  still ACTIVE it shows "Finish setting up" with one link, "Continue setup",
  to that journey (`resolveUnfinishedSetup`, a server fact). Resume itself
  is the runtime's persisted session; Home only points at it.

The web workspace (`apps/web/src/features/onboarding-conversation`) is
shared by both journeys; each supplies a `JourneyVocabulary` (titles, value
descriptions, review groups, the editor that owns a step) so the interview
speaks the definition's language and never a field name. Direct editing
opens the existing structured screen for the step; it is the same runtime
mutation either way.

## Frontend boundary

The web keeps one generic `OnboardingClient` (`apps/web/src/features/onboarding-kit`)
over a `RuntimePort` speaking this runtime's session-view contract; each
journey supplies a pure `JourneyModel` (screens, mapper, planner). The API
adapter and the development fixture implement the port. One adapter setting
(`CQ_FOUNDER_ONBOARDING_ADAPTER`) governs both journeys.

## Not here (later packets)

Evidence sources and upload (CQ-EVD), voice capture and transcription,
Q-generated suggestions, pitch media, recommendation, GateQ evaluation, an
onboarding builder UI, `onboarding.voice_captures`.

## Natural language → canonical meaning (CQ-Q-VOICE-001 A)

One sentence may answer many questions, and it is read deterministically before
Q's model reading runs. `POST /v1/onboarding/sessions/:id/say` now does, in order:

1. **Correction** (`domain/resolution/correction.ts`). "No, that's wrong.",
   "What I meant was Series A", "Actually, we're enterprise software" — the words
   after the objection are re-read against the step most recently answered and
   land through the same supersede path every revision uses (`CORRECTED`). A
   bare objection asks what should change (`DECLINED`).
2. **The asked step**, as before (`interpretUtterance`), now through the one
   option resolver (`domain/resolution/options.ts`): exact label, key or alias
   first, then whole-word mentions — on the **affirmative** text only.
3. **Every other step** (`domain/resolution/cross-step.ts`): each unanswered
   single- or multi-select the sentence names unambiguously becomes a
   **suggestion** the person confirms (retained until the step is reached); a
   name that fits several options becomes an **AMBIGUITY question** with the
   real options; a figure next to a journey-declared cue word ("raising $1.5m",
   "$250k to $1m") becomes a range suggestion; a mention of a hard-exclusion
   option becomes an **EXCLUSION_CONFIRMATION question** — never a value.
   Journeys declare cues (`FOUNDER_INTERVIEW_CUES`, `INVESTOR_INTERVIEW_CUES`).
4. **Category phrases** (`domain/resolution/taxonomy-phrases.ts`): short
   n-grams of the affirmed words are resolved by Capital Q's own taxonomy
   classifier (exact label/alias, then bounded lexical scoring) through the
   `OnboardingTaxonomyResolver` port the API composes. Per phrase: an exact
   match or a clear lexical leader is proposed as one set to keep or adjust;
   several candidates within a hair of each other become a choice among real
   nodes ("That could mean a few things here. Which is closest?"). No model
   emits an id; a phrase that resolves nothing proposes nothing.
5. **The asked step's own ambiguity** is persisted as a question with options,
   so it survives a refresh.

**Negation, contrast and scope** (`domain/negation.ts`): a sentence is read
clause by clause; everything after a negation marker in its clause ("not",
"never", "don't", "isn't really", "unlike", "except", "beyond", …) is what the
person is NOT saying. "We don't do fintech", "We're not really fintech — we're
logistics infrastructure" and "Unlike fintech companies, we…" select no fintech;
"Nigeria and Ghana, but not Kenya" keeps Nigeria and Ghana. Founder document
suggestions apply the same rule.

**Confirmation policy.** The step Q asked is placed directly when the sentence
names exactly one option (as before). Everything read for another step is a
proposal — one tap to keep, one to change, none to ignore — because a sentence
about one thing is evidence, not a form submission, for the others. Hard
exclusions are only ever the person's explicit answer. The understanding carries
`proposed` (how many proposals and questions the sentence produced) so Q can
say "I also picked up N other things".

Tests: `test/negation.test.ts`, `test/cross-step.test.ts`,
`test/taxonomy-phrases.test.ts`, `test/correction.test.ts`, and the
integration case "one sentence answers many questions" in
`test/onboarding.integration.test.ts`.

## The interview without the robot (CQ-Q-VOICE-001 B)

The Q-led workspace (`apps/web/src/features/onboarding-conversation/`) asks one
question at a time, and the controls for that question are the input:

- **Single select / confirmation**: a tap submits the option's own value through
  the client's `submitValue` (the runtime's normal `submit`, validated like the
  form's). No "Answer" button, no second click. **Multi select**: chips toggle;
  "Done" submits the set; a stand-alone option ("Nothing yet") submits at once.
  "I don't know" and "Skip" are one click each.
- **Categories** (a `reference_select` over `TAXONOMY_NODE`): Q's pending
  proposal for the step is shown as "I think these are the closest fits" with
  the nodes as selected chips; "Keep these" accepts the suggestion, an adjusted
  set corrects it (`EDIT`), and "Search categories" runs the real classifier over
  the person's words to add more. Only real taxonomy nodes ever appear.
- **Gaps** (pending interview questions) sit behind a small "N things left to
  settle · Review remaining gaps" entry. Each gap is answered in place: the
  question's own options, else the step's real options from the definition,
  else a figure or a line — the form only when nothing else fits. "Skip this"
  sets it aside.
- **Text and options together**: the composer is always enabled; typing on a
  select step is read by the runtime like any utterance.
- **Tangents**: a question for Q — a "?" or the shape of a request ("Tell me
  about…", "Can you check…", "Look up…") — is answered in the same thread over
  the Q event stream (the approved stage labels show while it works), in one
  continuing Q conversation, and the live question returns afterwards.
- **Resume / pause**: "Let's continue.", "Where were we?", "Back to onboarding.",
  "Carry on." bring the live question back; "Let's stop here.", "I'll finish
  this later.", "Pause the interview." acknowledge that everything is already
  persisted. Neither touches the runtime; nothing is completed on the person's
  behalf.
- **Welcome back** is said only after a real absence: `RESUME_AFTER_MS` (30
  minutes) since the session's own `lastActivityAt`. A refresh, "Use the form"
  and back, or a second tab a moment later greets nobody.
- **Form mode** remains ("Use the form" / "Review as form"); both views read and
  write the same session.

Tests: `apps/web/test/onboarding-conversation.test.ts` (structured chips, multi
select limits, taxonomy control, gap controls, resume/pause, request detection,
the time-gated greeting) and the browser journey
`tests/e2e/onboarding-conversation.desktop.spec.ts` against the real API.
