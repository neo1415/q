# Founder onboarding (`@capital-q/founder-onboarding`, CQ-ONB-002)

The Founder journey F0–F8 running on the onboarding runtime
(`docs/modules/onboarding.md`). The package owns two things: **Founder
Definition v1** as declarative reference data, and the **integration layer**
that maps its semantic write targets and review/snapshot contexts onto the
canonical domains through their public services. It owns no journey state
(the runtime does) and no business truth (Organisation, Company, Taxonomy
and Capital do). Zero model calls, zero provider SDKs, no Evidence, no voice.

## Definition v1

`src/definition/founder-v1.ts` is the manifest; the production migration
`supabase/migrations/20260905090000_founder_onboarding_definition_v1.sql`
is rendered from it by `renderOnboardingDefinitionMigration` and drift-guarded
by `test/definition.test.ts` (the committed file must end with the rendered
SQL, and the manifest hash must match). Publishing the same manifest through
the runtime publisher is an idempotent no-op; a change to the journey is v2.
Ids are UUIDv5 over journey + version so every environment shares them.

Phases `F0`…`F8`; 28 steps. The runtime gained one step type for this packet,
`reference_select` (select canonical reference entities by stable id), and
the `steps_step_type_check` constraint was extended in the same migration.

| Step                                                                                                   | Type                     | Writes to                                     |
| ------------------------------------------------------------------------------------------------------ | ------------------------ | --------------------------------------------- |
| `F0.intent`                                                                                            | single_select            | — (onboarding-only)                           |
| `F1.company_name`                                                                                      | short_text               | `company.bootstrap`                           |
| `F1.website`, `F1.country`, `F1.stage`, `F1.description`                                               | text / single_select     | `company.basics`                              |
| `F1.categories`                                                                                        | reference_select         | `company.taxonomy`                            |
| `F2.materials`                                                                                         | multi_select             | — (declaration only; no upload, no Evidence)  |
| `F3.review`                                                                                            | confirmation             | — (context `founder.review`)                  |
| `F4.founder_role`                                                                                      | single_select            | `founder.membership`                          |
| `F4.founder_count`, `F4.full_time`, `F4.team_size`                                                     | range / single_select    | `company.team_facts`                          |
| `F4.functions`                                                                                         | multi_select             | — (onboarding-only)                           |
| `F5.signal`, `F5.pilots` (early stages) / `F5.revenue_status`, `F5.customers`, `F5.growth` (Series A+) | branched on `F1.stage`   | — (onboarding-only)                           |
| `F6.raising`, `F6.currency`, `F6.target_amount`, `F6.instrument`, `F6.timeframe`, `F6.use_of_funds`    | branched on `F6.raising` | — (collected)                                 |
| `F6.confirm`                                                                                           | confirmation             | `capital.objective` (context `founder.raise`) |
| `F7.follow_up`                                                                                         | long_text                | — (founder-private)                           |
| `F8.snapshot`                                                                                          | confirmation             | — (context `founder.snapshot`)                |

Canonical versus onboarding-only is deliberate: a band ("four or more
founders") is never turned into a number, a timeframe band is never turned
into a date, "some founders are full-time" records no count. Unknown stays
unknown.

## Integration layer

`createFounderOnboardingIntegration({ outbox, audit, securityEvents? })`
returns the `writeTargets` and `stepContextProviders` the API composition
root hands to `createOnboardingService`. Handlers run inside the runtime's
transaction; `createFounderDomainServices(tx, …)` composes the Organisation,
Company, Taxonomy and Capital services on that transaction's executor with a
savepoint-backed `TransactionManager` (`createSavepointTransactionManager`,
new in `@capital-q/database`), so a domain use case's own unit of work nests
inside the onboarding step and its authorization reads see rows the same
transaction created. Every canonical write goes through the owning
service's public contract with its own authorization, versioning, audit and
events. No SQL, no direct tables, no temporary company truth.

- **`company.bootstrap` (F1.company_name)** — with no organisation context:
  `organisations.createOrganisation` (tenant, organisation, admin membership,
  active context) from the verified principal, then `companies.createCompany`
  and `upsertMyCompanyMembership({ isFounder: true })`, then the session is
  bound one-way to the company through `context.bindContext`. With an
  existing context: create the company there (the company service decides
  whether the actor may). After binding, a repeated F1 renames the same
  company. Idempotency keys derive from the session id.
- **`company.basics`** — read the company, update only what differs with
  `expectedVersion`. Website "example.com" becomes `https://example.com`;
  "Somewhere else" and "Not sure yet" record null.
- **`company.taxonomy`** — `replaceCompanyAssignments` per allowed vocabulary
  (industry, product_category, business_model, customer_type) with the
  founder's explicitly chosen node ids; unknown ids or other vocabularies
  are refused (422) and nothing is assigned. Candidates come from
  `POST /v1/taxonomy/candidates` ("Suggested categories"); nothing is
  auto-accepted.
- **`founder.membership`** — `upsertMyCompanyMembership` with the business
  title for the chosen role.
- **`company.team_facts`** — `updateCompanyTeamFacts` with the founder count,
  team size and the exact full-time count when it is knowable.
- **`capital.objective` (F6.confirm)** — `createCapitalObjective` when the
  company has no active objective, otherwise `updateCapitalObjective`
  (recalibrate) with `expectedVersion`. Never a duplicate active objective;
  no `if (isFounder)` anywhere — the capital service authorises.

Step contexts are deterministic projections read back through the same
services under the founder's context: `founder.review` (F3, "Here's what we
have so far"), `founder.raise` (create vs recalibrate) and
`founder.snapshot` (F8). They contain labels and values, never analysis,
readiness, visibility, verification or Q claims; the F7 note is reported
only as "recorded", never as text.

Actor resolution: handlers re-resolve the actor context for the session's
organisation from the verified principal (`OnboardingActor.principal`, set by
the API hook) on the transaction's executor. The session row is scope, never
authority.

## Runtime additions (generic)

- `OnboardingWriteContext.bindContext` — one-way binding inside the handler
  transaction (same rules as the internal bind).
- Step-context providers (`stepContextProviders`, `context` on the step
  view) — a confirmation step may name a `contextKey`; a missing provider is
  a redacted 500 with fault `STEP_CONTEXT_PROVIDER_MISSING`.
- `responses` on the session view — the caller's current answers on the
  eligible path, so composite screens can prefill without a call per step.
- `GET /v1/onboarding/sessions/current?journeyType=` — the caller's latest
  active or completed session (404 when none). An unbound start resumes the
  person's latest active session of the journey even after it bound its
  company, so a refresh can never create a second company.
- Navigation (`POST …/back` with `targetStepKey`) accepts any visited,
  currently eligible step, earlier or later; unvisited future steps stay
  locked.

## Web

`apps/web/src/features/founder-onboarding`: one `FounderOnboardingClient`
implemented over a `RuntimePort` (the generic session API + two taxonomy
reads). The `api` adapter implements the port with server actions that
forward the HttpOnly session's token server-to-server; the browser holds only
session and step ids. The development `fixture` adapter is an in-memory
runtime over the same definition data and the same session-view contract,
validated with `OnboardingSessionViewSchema`. `models/journey.ts` is the pure
mapper: runtime steps are grouped into the screens the founder sees (one
"team" screen over five runtime steps), copy and options come from the
definition, state from the session view. A composite save becomes ordered
runtime submissions, each carrying the version the previous returned;
unchanged answers are not re-sent, confirmations always are, and a question
that became eligible during the save keeps the screen open rather than being
skipped. Version conflicts reload the latest view ("Updated elsewhere") and
never retry the stale write.

Config: `CQ_FOUNDER_ONBOARDING_ADAPTER` is `api` by default whenever
`CQ_API_URL` is set; `fixture` only on a non-production build without an API
URL, and refused on any production build or environment; `none` otherwise.
There is no fallback from `api` to `fixture`.

## Tests

- `packages/founder-onboarding/test/definition.test.ts` — manifest, mappings,
  migration drift.
- `packages/founder-onboarding/test/founder-onboarding.integration.test.ts` —
  F0→F8 against local PostgreSQL through the runtime with the real domains:
  bootstrap and binding, basics, taxonomy, membership, team facts, branch
  selection, objective create then recalibrate, snapshot, completion;
  retry safety and resume; refused writes roll the step back; cross-user
  isolation; privacy markers never in logs or event payloads.
- `supabase/tests/database/rls/240_founder_onboarding_definition.test.sql`.
- `apps/web/test/founder-onboarding-journey.test.ts` — the mapper and client
  over the fixture runtime; `packages/config/test/web.test.ts` — adapter
  selection.
- `tests/e2e/founder-onboarding.{desktop,mobile}.spec.ts` — the real journey
  in a browser against the API and the local database, including refresh and
  resume and a stale-tab conflict.

## Deferred

Evidence upload and extraction (F2 stays a declaration), Q-generated
suggestions and any model call, voice capture, the Investor journey
(CQ-ONB-003), rate limiting (none exists in the repository), a
`GET /v1/onboarding/founder/current` alias (the generic `sessions/current`
route serves it).
