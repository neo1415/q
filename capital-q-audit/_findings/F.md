# Findings — Investigator F (AI providers and costs, security and permissions, tests and observability)

Reports: `09-AI-PROVIDERS-AND-COSTS.md`, `10-SECURITY-AND-PERMISSIONS.md`, `13-TESTS-AND-OBSERVABILITY.md`.
Evidence: `evidence/providers/*`, `evidence/security/*`, `evidence/tests/*`.
Diagram: `diagrams/model-routing.md`.

## CONFIRMED DEFECTS

| Id    | Severity            | Symptom                                                                                                                                                                               | Evidence                                                                                                                                                                                                                                                                                                                             | Root cause                                                                                                                                                                                                |
| ----- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-D1  | Medium              | Google image usage rows point at the `gpt-realtime-mini` model row. The catalog has no `gemini-3.1-flash-lite-image` row, and `gemini-2.5-flash-image` is RETIRED.                    | `supabase/migrations/20261203090000_model_usage_voice_realtime.sql:28`; `supabase/migrations/20261215090000_image_model_flash_lite.sql:11,17-20`; `packages/model-gateway/src/images/config.ts:21-26`; `supabase/tests/database/rls/320_ai_ops.test.sql:38-44`                                                                       | The same UUID `a2000000-…-000000000022` is used by two migrations, both `on conflict (id) do nothing`. The second insert silently no-ops.                                                                 |
| F-D2  | Low                 | A pgTAP assertion passes for the wrong reason: "gemini-3.1-flash-lite-image is the active Gemini image model".                                                                        | `supabase/tests/database/rls/882_document_jobs.test.sql:85-86`                                                                                                                                                                                                                                                                       | It asserts the status of id `…022`, which is the realtime row. Model code is not checked.                                                                                                                 |
| F-D3  | High (integrity)    | Public-web research excerpts (attacker-controllable) reach the model as a SYSTEM message, and the OpenAI adapter concatenates all SYSTEM messages into `instructions`.                | `packages/model-gateway/src/q/index.ts:1389-1396,3619-3660`; `packages/model-gateway/src/providers/openai.ts:146-153`; `packages/q-tools/src/tools/research-public-web.ts:134-140`                                                                                                                                                   | The code-initiated research hop is modelled as "fetched for you" in the SYSTEM role instead of a fenced USER or TOOL message. The OpenAI `toInput` lifts every SYSTEM message, not only the leading ones. |
| F-D4  | Medium              | Unit test fails on base: `answer-turn-reading.test.ts` "hands on a manifest built from what is composed and what the plan holds".                                                     | `packages/q-specialists/test/answer-turn-reading.test.ts:919` (run today: 1 failed / 129)                                                                                                                                                                                                                                            | The expected capability list is stale. GATEWAY entries were added ("Pass on or reply to a founder in their GateQ inbox…", "Set up their GateQ gateway…") and the order changed.                           |
| F-D5  | Medium              | Config, IaC and docs contradict running behaviour: "OpenAI diagnostic only / in no routing policy"; "staging cannot attest synthetic demo"; `OPENAI_API_KEY` absent from Railway IaC. | `packages/config/src/model-providers.ts:116-124`; `packages/model-gateway/src/providers/openai.ts:34-50`; `.railway/railway.ts:76-80,101-106`; `docs/deployment/staging.md:101-103,128-134` vs `supabase/migrations/20261008130000_ai_ops_openai_primary.sql:8-21` and `packages/model-gateway/src/policy/synthetic-demo.ts:175-215` | Docs and comments were not updated when OpenAI became primary (20261008130000) and staging attestation was added. Hosted secrets are set by hand.                                                         |
| F-D6  | Medium              | CI never runs on the deploy branch, and Railway deploys without waiting for checks.                                                                                                   | `.github/workflows/ci.yml:8-13`; `.railway/railway.ts:31,109-112` (`checkSuites: false`)                                                                                                                                                                                                                                             | CI is scoped to `main` and PRs, while deploys come from `recovery/2026-09-12`.                                                                                                                            |
| F-D7  | Medium              | All OpenTelemetry spans and metrics (`q.model.*`, `q.tool.execute`, …) are discarded. There is no error monitoring.                                                                   | `packages/observability/src/telemetry.ts:11-22`; no `@sentry` dependency in any `package.json`                                                                                                                                                                                                                                       | No SDK or exporter is registered (`TELEMETRY_EXPORT_ENABLED=false`).                                                                                                                                      |
| F-D8  | Medium (cost)       | Text inference has no aggregate daily or monthly spend cap. Only per-request and per-policy ceilings exist.                                                                           | `packages/model-gateway/src/q/index.ts:401-456`; `gateway.ts:788-796`; grep shows caps only in duplex, q-daily, Q2Q and delegation                                                                                                                                                                                                   | Not built.                                                                                                                                                                                                |
| F-D9  | Medium (capability) | Deep investigation, evidence synthesis and comparison run first on a model the catalog rates STANDARD/FAST, after HIGH floors were lowered "for the demo".                            | `supabase/migrations/20261008120000_ai_ops_demo_routing_gemini_openai.sql:13-17,69-75`; `supabase/migrations/20261006090000_ai_ops_openai_test_provider.sql:32-34`; `supabase/migrations/20261008130000_ai_ops_openai_primary.sql:16-21`                                                                                             | A demo-time workaround was left in force.                                                                                                                                                                 |
| F-D10 | Medium (privacy)    | Duplex transcripts with `conversation_id NULL` have no deletion path, and `user_id on delete restrict` blocks user deletion. There is no reader or purge job.                         | `supabase/migrations/20261220150000_q_voice_line_transcripts.sql:16-18,22-23,29,46-47`; the only code reference is the writer `apps/q-api/src/voice/duplex/transcript.ts:65`                                                                                                                                                         | Retention is tied only to conversation cascade.                                                                                                                                                           |

## UNVERIFIED RISKS

| Id   | Hypothesis                                                                                                                                                                                  | How to verify                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-R1 | Server processes connect with a role that bypasses RLS (owner or `bypassrls`), so RLS never constrains app traffic. No `set role` or JWT claims are set anywhere.                           | On the hosted project, run `select current_user, rolbypassrls from pg_roles where rolname=current_user` via the `DATABASE_URL` user. Grep evidence is in `10` §3.      |
| F-R2 | Hosted q-api runs with the SYNTHETIC_DEMO attestation, so non-public turns go to UNREVIEWED Gemini (free-tier terms permit training). The lead's trace shows the turn reader on flash-lite. | Check the startup log "synthetic-demo attestation accepted" (`apps/q-api/src/main.ts:1019-1029`), or `ai_ops.model_usage` rows for google with `purpose=CONVERSATION`. |
| F-R3 | Duplex realtime spend can be under-counted because usage is browser-reported, and the server cannot hang up the WebRTC call.                                                                | Compare the OpenAI billing dashboard with the `VOICE_REALTIME` ledger sum for the same day. Look for a sideband or hangup API call in the broker (none found).         |
| F-R4 | `{ err }` log fields leak SQL parameters or SDK request detail.                                                                                                                             | Inspect production log lines for `err.query`, `err.parameters`, `err.headers`.                                                                                         |
| F-R5 | The Gemini and Groq multi-key rotation, which exists to stretch free tiers, breaches provider terms.                                                                                        | Legal and ToS review.                                                                                                                                                  |
| F-R6 | OpenAI ZDR is not actually enabled. The CONFIDENTIAL ceiling rests on an operator assertion.                                                                                                | Check the OpenAI org's data controls.                                                                                                                                  |
| F-R7 | GateQ anonymous turns can be amplified across API instances or by many gateways, because the throttle is in-process.                                                                        | Load-test staging (not done), or read the web-tier limiter in `apps/web/src/features/gateq/apply-actions.ts`.                                                          |
| F-R8 | Migrations with future timestamps (`202611*`, `202612*`) were applied in a different order than the filenames suggest on hosted, so the net routing differs from `09` §4.                   | `select version from supabase_migrations.schema_migrations order by inserted_at`.                                                                                      |
| F-R9 | Recall webhook replay inside the timestamp window has side effects beyond `settleBot`.                                                                                                      | Read `settleBot` and the meeting record writes.                                                                                                                        |

## OPEN QUESTIONS

1. Which provider env vars and flags are actually set on each Railway service (`OPENAI_API_KEY`, `CQ_VOICE_REALTIME`, `CQ_SYNTHETIC_DEMO_ROUTING`, `CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED`, `Q_EMBEDDING_PROVIDER`, `CQ_INSTRUCTIONS_AUTO`)?
2. Will real (non-seeded) founders or investors use the staging project? This decides whether F-R2 is a breach or an accepted demo posture.
3. What is the actual monthly spend per provider? `ai_ops.model_usage` covers text, images and duplex only. Deepgram, ElevenLabs, Recall, Tavily, SerpAPI, Bright Data and OpenAI embeddings have no ledger.
4. Is `apps/web/e2e` (Q room specs) run by anyone? No script references it.
5. Is the deploy branch `recovery/2026-09-12` or the current `recovery/2026-09-12-8y2j4w`? Both exist on origin.

## EVIDENCE INDEX

| Conclusion                                                                            | Evidence                                                                                                 |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Text LLM calls are centralised in the gateway                                         | SDK imports only in `packages/model-gateway/src/providers/{openai,google,groq}.ts`; `gateway.ts:590-647` |
| OpenAI adapter runs only `gpt-5.6-luna`                                               | `providers/openai.ts:61-62,364-375`                                                                      |
| Effective routing (luna first; FAST_CLASSIFICATION flash-lite first with a 2 s hedge) | `20261008130000…sql:8-21`; `20261110000000…sql:11-16`; `20261207163000…sql:33-36`                        |
| Google ceiling PUBLIC; OpenAI CONFIDENTIAL via asserted ZDR                           | `20260926090000…sql`; `20261006100000…sql:27-36`                                                         |
| Provider-justified ceiling mapping                                                    | `policy/eligibility.ts:77-93`                                                                            |
| SYNTHETIC_DEMO skips ceilings                                                         | `policy/eligibility.ts:221-225,295-309`                                                                  |
| Staging may attest                                                                    | `policy/synthetic-demo.ts:175-215`                                                                       |
| `firstAttemptTimeoutMs` semantics                                                     | `gateway.ts:807-812`; `q/turn-reader.ts:310`                                                             |
| Hedge semantics                                                                       | `gateway.ts:837-908,1077-1153`                                                                           |
| Per-attempt ledger, non-fatal on failure                                              | `gateway.ts:256-269,499-518`; `infrastructure/postgres-usage.ts:14-33`                                   |
| Per-task budgets                                                                      | `q/index.ts:401-456`                                                                                     |
| Duplex daily cap ($1 default, 0–20)                                                   | `apps/q-api/src/voice/duplex/config.ts:45-57,87-92`; `spend.ts:19-33`; `broker.ts:653-664,1058-1066`     |
| Browser-reported realtime usage                                                       | `apps/web/src/features/voice/provider/duplex-line.ts:44,371-405`; `broker.ts:1017-1043`                  |
| Realtime and transcribe models and prices                                             | `realtime/openai.ts:26-56`                                                                               |
| Embeddings outside the gateway                                                        | `packages/q-embeddings/src/infrastructure/openai-provider.ts:20-60`                                      |
| Image model id collision                                                              | F-D1 evidence                                                                                            |
| Voice vendors and models                                                              | `apps/q-api/src/voice/providers/deepgram.ts:16-35,195-245`; `elevenlabs-speak.ts:109-123`                |
| Auth via Supabase `getUser`                                                           | `packages/security/src/supabase/access-token-authenticator.ts:75`                                        |
| Org selector resolved against active membership                                       | `packages/security/src/postgres/actor-context-resolver.ts:55-131`                                        |
| Firewall version and plan log                                                         | `packages/contracts/src/q/firewall.ts:34`; `packages/q-firewall/src/firewall.ts:597-625`                 |
| Tool pipeline                                                                         | `packages/q-tools/src/executor.ts:25-40,170-260`                                                         |
| Approval hash recheck and idempotency key                                             | `packages/q-actions/src/application/service.ts:310-315,1376-1395`                                        |
| AUTO autonomy off by default; audited delegation                                      | `apps/q-api/src/composition/instructions/engine.ts:1385-1411`                                            |
| Fence implementation                                                                  | `packages/q-core/src/prompts/definition.ts:223-288`                                                      |
| Logger redaction                                                                      | `packages/observability/src/logger.ts:15-36`                                                             |
| Telemetry no-op                                                                       | `packages/observability/src/telemetry.ts:11-22`                                                          |
| CI scope                                                                              | `.github/workflows/ci.yml:3-13,66-80`                                                                    |
| Test counts and run results                                                           | `13` §2–§3                                                                                               |

## COVERAGE

**Inspected in full or substantially:**

- `packages/model-gateway/src/{gateway,catalog}.ts`
- `packages/model-gateway/src/policy/{eligibility,synthetic-demo,cost}.ts`
- `packages/model-gateway/src/providers/openai.ts`; `providers/google.ts` (composition and keys)
- `packages/model-gateway/src/realtime/openai.ts`; `images/config.ts`, `images/index.ts` (usage)
- `packages/model-gateway/src/infrastructure/postgres-usage.ts`
- every `ai_ops` routing migration
- `packages/config/src/model-providers.ts`
- `apps/q-api/src/main.ts:900-1030`
- duplex `config.ts`, `spend.ts`, `transcript.ts`, and `broker.ts` (cap, open, usage, rejoin)
- q-api `authentication.ts` and `actor-context.ts`; the security resolver and authenticator (partial)
- q-firewall `version.ts` and `firewall.ts` (disclosure and logging)
- q-tools `executor.ts`; q-actions approval excerpt
- q-core prompt fencing
- observability `logger.ts`, `telemetry.ts`, `correlation.ts`
- CI workflow; `vitest.config.ts`; the live-model runner
- `.railway/railway.ts`; `render.yaml`; staging docs
- the `voice_line_turns` migration
- webhook auth (Recall, inbound email, meeting host); GateQ apply throttle

**Not inspected:**

- Groq adapter body
- q-research provider internals beyond endpoints
- Cloudflare Stream
- discovery and ranking firewall enforcement
- web server actions
- admin console authorization
- `combination.ts`
- most pgTAP file contents (only 320, 590 routing, 730, 882, 889 read)
- q-evals graders
- problem handler
- data room
