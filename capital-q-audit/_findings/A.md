# Findings — Investigator A (repository inventory, system architecture, database/persistence)

Reports: `01-REPOSITORY-INVENTORY.md`, `02-SYSTEM-ARCHITECTURE.md`, `12-DATABASE-AND-PERSISTENCE.md`. Diagrams: `diagrams/{system-architecture,auth-permission-boundaries,data-model}.md`. Evidence: `evidence/architecture/*.md`. HEAD `520bd123`.

## CONFIRMED DEFECTS

| ID | Severity | Symptom | Evidence | Root cause |
| --- | --- | --- | --- | --- |
| DEF-A1 | High | Every Q action domain event since 2026-09-26 is dropped: 657 `events.outbox` rows (`q.action.prepared` 321, `rejected` 198, `approved` 69, `executed` 62, `execution_failed` 7) stuck with `EVENT_SCHEMA_INVALID` after 10 attempts. The declared consumers never receive them, and q-api works around it with a 2-minute "approved action sweep" | Live aggregates in `evidence/architecture/live-db-aggregates.md`; `packages/eventing/src/publisher/outbox-publisher.ts:171-186`; `apps/workers/src/event-registry.ts:1-35`; `packages/q-actions/src/events/index.ts:35,46-110`; `apps/q-api/src/main.ts:3808-3830` | The workers' `EventRegistry` omits the q-actions event set (q-actions is not a workers dependency). The publisher validates against that registry |
| DEF-A2 | High (architecture/security) | Service traffic runs as `postgres` (BYPASSRLS). RLS and its 86 policies, including the 9 FORCE-RLS tables, protect only the unused PostgREST surface. Tenant isolation depends entirely on hand-written `tenant_id` predicates. `network.relationship_events` and `audit.material_actions` have no DB append-only guard | `packages/database/src/client.ts:24-41` (no role/GUC); `supabase/migrations/20261220150000_q_voice_line_transcripts.sql:61-64` (`grant … to postgres`); policies only `to authenticated` (`20260902144826_identity_permissions_rls.sql:239-275`); live `pg_roles`/`pg_stat_activity` (8 Supavisor connections as postgres) and `pg_trigger` (guards only on run_events, revisions, model_usage, claim revisions) | The design puts authorization in the app layer, with RLS kept for a client path that does not exist. CLAUDE.md requires server-side *and* RLS enforcement. The DATABASE_URL role is inferred, not read |
| DEF-A3 | Medium | `.railway/railway.ts`, documented as "source of truth" for service variables, omits OpenAI, `CQ_VOICE_REALTIME*`, Cloudflare, Stripe, Recall, Google Workspace, SMTP/Brevo, Web Push and Postmark, all of which production uses. Web is hosted on Railway, not Vercel as the ADRs and CLAUDE.md state | `.railway/railway.ts:16-20,98-107,166-184` (grep count 0 for those names); `docs/deployment/staging.md:26-28`; `docs/handoff/session-handoff-2026-10-08.md:5`; migration `20261008130000_ai_ops_openai_primary.sql`; `apps/q-api/src/main.ts:927-935` | Variables were set out-of-band in Railway and the IaC was not updated. Hosting docs drifted |
| DEF-A4 | Medium | `/health/ready` is static `{status:"ok"}` on q-api and api. Railway's healthcheck passes with the DB or providers down | `apps/q-api/src/app.ts:760-770`; `apps/api/src/app.ts:440-442` | Readiness checks were never implemented ("will grow…") |
| DEF-A5 | Medium | User-visible Q state is process memory on a single replica that is redeployed "many times a day": the room feed (cards beside Q), voice turn board, duplex lines, meeting-host sessions, workforce grading state, interview raised checks. A deploy or restart drops it | `apps/q-api/src/room/feed.ts:35-37`; `voice/turn-board.ts:7`; `composition/meeting-host-runtime.ts:51`; `composition/workforce/review.ts:485`; `voice/interview-agent.ts:301`; `voice/session-token.ts:20-27`; `.railway/railway.ts:164` | Ephemeral-by-design stores without a durable or shared backing |
| DEF-A6 | Medium | Background scheduling runs as `setInterval` loops inside the HTTP q-api process (instruction sweep 60 s, approved-action sweep 2 min, orphan sweep, errands 60 s, work tick 60 s, meeting assistant, scout 6 h), with no leader election. Scaling q-api beyond 1 replica multiplies them | `apps/q-api/src/main.ts:1892-1899,3816-3830,3851-3860,4141-4155,4268-4276,4499-4503,5000-5001` | Work loops were put in the web process instead of workers |
| DEF-A7 | Medium | Domain logic and cross-app writes. `apps/api/src/q-work-port.ts` issues raw `update q_runtime.standing_instructions` / `instruction_delegations` while q-api's `composition/instructions/store.ts` owns those tables. The whole instructions/workforce/rehearsal/presence domain lives in `apps/q-api/src/composition` with direct SQL | `apps/api/src/q-work-port.ts:55-118`; `apps/q-api/src/composition/{instructions/store,workforce/store,rehearsals,work/store}.ts` | Feature growth bypassed bounded-context packages (CLAUDE.md "Apps are composition/runtime boundaries") |
| DEF-A8 | Medium | `communication.notifications` is inserted from 19 separate code sites across q-api, workers and 5 packages, with no single owner or contract | file list in `12 §4.11` | No notification bounded context |
| DEF-A9 | Medium | No retention anywhere. LangGraph checkpoints hold 16,665 rows / 2,490 threads / about 90 MB of a 202 MB DB, keyed per run with no pruning. Dead outbox rows are never cleaned | live aggregates; `packages/q-orchestrator/src/checkpoint-store.ts:65`, `thread.ts:18`; no delete outside q-evals/dev | Missing retention jobs |
| DEF-A10 | Low-Medium | The voice session token key is HKDF-derived from `SUPABASE_SECRET_KEY`, **falling back to `DATABASE_URL`**. The IaC gives q-api no `SUPABASE_SECRET_KEY`. The token (held by the speech provider as a bearer, 4 h TTL) carries the user's Supabase access token, while `bindings.ts` says that token is "never serialised" | `apps/q-api/src/main.ts:5111-5114`; `voice/session-token.ts:20-52,114-135,155`; `voice/bindings.ts:73-79`; `.railway/railway.ts:166-184` | Reuse of a DB credential as key material; a stale comment |
| DEF-A11 | Low | `packages/q-orchestrator` imports `@capital-q/q-core` at runtime but declares it only in devDependencies | `packages/q-orchestrator/src/workforce/review-loop.ts:4`, `src/work/lane.ts:1`; `package.json:49` | Mis-declared dependency |
| DEF-A12 | Low | Duplicated security-critical code: `authentication.ts` and `supabase-authenticator.ts` are byte-identical in api and q-api; `actor-context.ts` is identical for lines 1-127; RFC 9457 handlers are diverged copies (782 vs 347 lines) | `diff` of the files; `apps/api/src/security/actor-context.ts:21-23` warns against exactly this | Copy-paste between apps |
| DEF-A13 | Low | Migration versions are future-dated to 2026-12-20 (115 files after today). Today's `20261008*` files sort before about 120 already-applied files. `db-push.mjs` lacks `--include-all` | `ls supabase/migrations`; `scripts/db-push.mjs:87-96`; live `schema_migrations` 178/178 | Ad-hoc version numbering |
| DEF-A14 | Low | Stale or contradictory docs: `packages/config/src/model-providers.ts:116-124` says OpenAI is "diagnosis only … no routing policy names it" (it is primary). CLAUDE.md says Render. There are two `ADR 0014` files. The voice_line_turns migration says "no policies … as every q_runtime table" while q_runtime has 22 policies. `apps/api`/`apps/web` package.json descriptions have mojibake | cited paths | Documentation drift |
| DEF-A15 | Low | Telemetry is a no-op (`TELEMETRY_EXPORT_ENABLED = false`). Logs exist only in Railway's short current-deployment buffer, so post-incident evidence disappears on the next deploy | `packages/observability/src/telemetry.ts:15-21`; `docs/handoff/session-handoff-2026-10-08.md:11` | Operations packet never done |

## UNVERIFIED RISKS

| Hypothesis | What would verify it |
| --- | --- |
| The lead's duplex line that "rejoined, then ended ~20s later" coincided with a q-api deploy/restart wiping in-memory duplex state (DEF-A5) | Railway deploy timestamps for 12:02-12:58 UTC vs the duplex end events in q-api logs |
| A voice line older than the Supabase access-token lifetime (typically 1 h) fails onboarding/interview calls that forward `binding.accessToken` (`voice/turn.ts:1469,1707,1767`), because the sealed token lives 4 h and holds a fixed access token | Supabase project JWT expiry setting, plus a >1 h line test, or a code path that refreshes the binding token |
| The per-request `auth.getUser` network round trip (no cache) adds noticeable latency to every voice think callback and room long-poll | Timing in q-api logs or a local benchmark against Supabase Auth |
| Other q-api timers (errands, work tick, meeting assistant, scout, approved-action sweep) are unsafe with 2+ replicas (double sends) | Read each tick's claim SQL for `FOR UPDATE SKIP LOCKED` or an equivalent |
| q-api actually lacks `SUPABASE_SECRET_KEY` in Railway, so the voice token key is derived from `DATABASE_URL` | `railway variable list --service @capital-q/q-api` (names only) |
| A missing tenant predicate in any of the hundreds of raw-SQL repository queries is a cross-tenant read, because RLS will not catch it (DEF-A2) | A security investigator's grep of `sql\`` queries without `tenant_id`, plus negative tests run as a non-bypass role |
| The 1,225 CANCELLED runs (43%) carry real model spend (voice supersession) | Join `ai_ops.model_usage` cost by run status (aggregate) |
| Webhook signature verification (Cloudflare, Stripe, Postmark, Gmail Pub/Sub, Recall) is correct | Read each verifier; not inspected by A |
| `20261008*` migrations were applied with `--include-all` or by hand, so the hosted history order differs from the file order | `supabase_migrations.schema_migrations` insert order (`inserted_at` if present) |

## OPEN QUESTIONS

1. Is RLS intended to be enforced for service traffic (e.g. a non-bypass app role plus a `SET LOCAL` tenant GUC), or is app-layer isolation the accepted design? This needs an ADR either way.
2. Is Vercel still the target for web, or should ADR 0014 be amended to "Railway for all four"?
3. Should q.action events be registered in workers, or removed from the outbox, given that no consumer exists?
4. What retention is intended for LangGraph checkpoints, outbox, run_events and model_usage?
5. Is the single-replica q-api a deliberate constraint? Several features (room, duplex, meeting host) depend on it.
6. ADR 0030 delegations: abandon (0 rows) or still planned?

## EVIDENCE INDEX

| Conclusion | Evidence |
| --- | --- |
| Hosted migrations = repo (178/178) | `evidence/architecture/live-db-aggregates.md` |
| App connects as postgres, bypasses RLS | `packages/database/src/client.ts:24-41`; `supabase/migrations/20261220150000_q_voice_line_transcripts.sql:61-64`; live pg_roles/pg_stat_activity |
| RLS policies only for `authenticated` | `supabase/migrations/20260902144826_identity_permissions_rls.sql:239-275`; live pg_policies by schema |
| Web never uses PostgREST | grep of `apps/web` for `.from(`/`.rpc(`/`.schema(` (no hits) |
| q.action events stuck | `apps/workers/src/event-registry.ts:1-35`; `packages/eventing/src/publisher/outbox-publisher.ts:171-186`; live outbox aggregates |
| Railway IaC drift | `.railway/railway.ts` (whole file, `evidence/architecture/railway-iac.md`) |
| OpenAI primary | `apps/q-api/src/main.ts:927-935`; `supabase/migrations/20261008130000_ai_ops_openai_primary.sql` |
| Room feed process-local | `apps/q-api/src/room/feed.ts:17-40` |
| Static readiness | `apps/q-api/src/app.ts:760-770` |
| Bearer-only, per-request Auth call | `apps/api/src/security/supabase-authenticator.ts:20-37`; `packages/security/src/supabase/access-token-authenticator.ts:69-89` |
| Actor context never from headers | `apps/api/src/security/actor-context.ts:93-112` |
| App actions: authorize then run, deny = 404 | `apps/api/src/http/app-actions.ts:156-200` |
| Voice token contents and key | `apps/q-api/src/voice/session-token.ts:20-52`; `apps/q-api/src/main.ts:5111-5114` |
| Duplex transcripts only since today | `supabase/migrations/20261220150000_q_voice_line_transcripts.sql:1-18`; live voice_line_turns = 21 |
| q-api schedulers | `apps/q-api/src/main.ts` lines in DEF-A6 |
| Workers loops | `apps/workers/src/main.ts:1338-1452` |
| Telemetry no-op | `packages/observability/src/telemetry.ts:15-21` |
| Schema-only tables (63) | `evidence/architecture/live-table-counts.md` |
| Package graph has no cycles or app imports | DFS over `packages/*/package.json` (see `diagrams/system-architecture.md`) |
| 139 deprecated prompt versions | `grep 'status: "DEPRECATED"' packages/q-core/src/prompts` |

## COVERAGE

Inspected:
- Every `package.json` (apps + 52 packages) and `pnpm-lock.yaml` versions.
- `.railway/railway.ts`, `render.yaml` header, `docs/deployment/staging.md` (grep), ADR 0014 (first 60 lines), `docs/handoff/session-handoff-2026-10-08.md` (grep).
- api/q-api route registration across `apps/*/src` (static extraction) and the app-actions registry.
- `apps/web/app` route tree, `proxy.ts`, `src/auth/session.ts`, `cookie-options.ts`, `app/api/q-room/route.ts`, the q-stream proxy route (head).
- api/q-api security modules, `packages/security/src/supabase/access-token-authenticator.ts`.
- `packages/database/src/{client,transaction}.ts`, `packages/eventing/src/publisher/outbox-publisher.ts`, `apps/workers/src/{main.ts (loops), event-registry.ts}`.
- `apps/q-api/src/room/*`, `q-events.ts` (options), `voice/session-token.ts` (head), `voice/bindings.ts` (fields), `voice/turn.ts` (createRun, UNCLEAR, stopRun), `voice/duplex/transcript.ts` (head), q-api `main.ts` scheduler sites, the model-provider block and the voice secret.
- `packages/config/src/*` env names; `packages/observability/src/telemetry.ts`.
- Migrations: schema/table extraction for all 178; read in part: identity foundation and RLS, relationship foundation, voice_line_turns, network matches.
- Live: aggregate counts and catalog metadata only.

Not inspected (left to other investigators or out of scope):
- Q answer quality and prompts content, turn reader, specialists' logic, Context Firewall internals, tool authorization per tool.
- Voice provider adapters' internals beyond selection and persistence, and the web voice UI.
- Webhook verifiers, billing logic, the discovery/ranking pipeline, the document parser sandbox.
- pgTAP test contents; no test suites were run (sandbox Node 22 < engines 24).
- Railway runtime variables and logs (no access attempted).
- `apps/web` feature components beyond auth/proxy/voice selection.
