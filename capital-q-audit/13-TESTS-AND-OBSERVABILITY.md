# 13 — Tests and Observability

Investigator F · 2026-10-08 · branch `recovery/2026-09-12-8y2j4w` @ `520bd123` · read-only.
Evidence: `capital-q-audit/evidence/tests/*.md`. Raw per-package counts: §2.

---

## 1. Summary

- **Deterministic tests are broad.** There are 1,074 `*.test.ts(x)` files under `apps/` and `packages/`, run by one root Vitest config with `retry: 0`. I ran 78 files in two batches: 2,132 of 2,133 tests passed. The one failure is the known `answer-turn-reading` manifest test.
- **CI is thin:**
  - It runs only on `pull_request` and pushes to `main` (`.github/workflows/ci.yml:8-13`).
  - It runs format, lint, typecheck, unit tests and build. It does **not** run pgTAP, integration, e2e, evals or live tests (`ci.yml:3-6,66-80`).
  - Railway deploys the branch `recovery/2026-09-12` with `checkSuites: false` (`.railway/railway.ts:31,109-112`). A deploy therefore does not wait for any check, and pushes to that branch trigger no CI at all.
- **Observability is logs only.**
  - OpenTelemetry is the API only: `TELEMETRY_EXPORT_ENABLED = false` and no SDK is registered, so every span and every `q.model.*` metric is discarded (`packages/observability/src/telemetry.ts:11-22`).
  - There is no Sentry or any other error monitoring (no dependency or import found).
  - The operational truth is pino JSON on stdout plus DB ledgers (`ai_ops.model_usage`, `q_runtime.run_events`).
- **What production behaviour lacks automated coverage:**
  - the live duplex/WebRTC path (fakes only)
  - the real OpenAI primary provider (the live suite covers Gemini and Groq, not OpenAI)
  - the hosted routing posture
  - the briefing content the founder complained about. A unit test exists (`apps/web/test/q-briefing.test.ts`), but nothing checks that waiting items are actually found end to end. The lead's trace shows "nothing is waiting" while an investor message was unanswered.

---

## 2. Test inventory

### 2.1 Vitest file counts (find, excluding `node_modules`/`dist`)

| Area                                        | `*.test.ts(x)`               | of which `*.live.test.ts` | of which `*.integration.test.ts` |
| ------------------------------------------- | ---------------------------- | ------------------------- | -------------------------------- |
| apps/web                                    | 219 (217 in `apps/web/test`) | 0                         | 0                                |
| apps/q-api                                  | 169                          | 4                         | 10                               |
| packages/model-gateway                      | 73                           | 3                         | 2                                |
| packages/q-core                             | 68                           | 0                         | 0                                |
| apps/api                                    | 53                           | 0                         | 2                                |
| packages/q-tools                            | 46                           | 0                         | 1                                |
| packages/q-specialists                      | 39                           | 0                         | 0                                |
| packages/discovery                          | 35                           | 0                         | 8                                |
| apps/workers                                | 34                           | 0                         | 1                                |
| packages/contracts                          | 28                           | 0                         | 0                                |
| packages/communication                      | 21                           | 0                         | 5                                |
| packages/evidence                           | 18                           | 0                         | 5                                |
| packages/q-knowledge                        | 17                           | 0                         | 5                                |
| packages/companies                          | 16                           | 0                         | 4                                |
| packages/network, q-runtime, config         | 14 each                      | 0                         | 3 / 2 / 0                        |
| packages/q-research                         | 13                           | 1                         | 0                                |
| packages/onboarding / founder-onboarding    | 12 / 11                      | 0                         | 2 / 1                            |
| packages/permissions                        | 10                           | 0                         | 1                                |
| packages/q-orchestrator, media, app-actions | 9 each                       | 0                         | 4 / 1 / 0                        |
| packages/q-firewall                         | 2                            | 0                         | 1                                |
| packages/q-evals                            | 5                            | 0                         | 3                                |
| packages/observability, q-embeddings        | 2 each                       | 0                         | 0                                |
| packages/email, test-support                | 1 each                       | 0                         | 0                                |
| (remaining 26 packages)                     | 3–7 each                     | 0                         | 0–3                              |
| **Total**                                   | **1,074**                    | **8**                     | **90**                           |

The live-test counts are a subset of the first column, and so are the integration counts.

### 2.2 Live tests (real providers; excluded from `pnpm test`)

The live files are:

- `apps/q-api/test/{q-smoke,q-tools-smoke,rehearsal,rehearsal-camera}.live.test.ts`
- `packages/model-gateway/test/{providers,turn-reader-actions,delegation-reader}.live.test.ts`
- `packages/q-research/test/tavily.live.test.ts`

How they run:

- Run by `pnpm test:live-model` through `scripts/live-model-tests.mjs`. It loads only `GEMINI_API_KEY`, `GROQ_API_KEY` and `TAVILY_API_KEY` from `.env.local`, then sets `CQ_LIVE_MODEL_TESTS=1`.
- `vitest.live-model.config.ts` uses a 60 s timeout, `fileParallelism:false` and `retry:0`.

Gap:

- `providers.live.test.ts` has cases gated on GEMINI (`:272,:405`) and GROQ (`:321`) only.
- **The primary provider (OpenAI `gpt-5.6-luna`) has no gateway live smoke test.** OpenAI appears only in the two rehearsal live tests.

Status for OpenAI-primary routing: UNTESTED (live).

### 2.3 Browser e2e (Playwright, Chromium)

| Location               | Count            | Notes                                                                                                                                                                                                                                                  |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/e2e/`           | 25 `*.spec.ts`   | auth, onboarding, artifact viewer, public card; desktop and mobile projects (`playwright.config.ts:49,74,106-125`); run by `pnpm test:e2e` after building web and api                                                                                  |
| `apps/web/e2e/`        | 10 specs         | `q-room*`, `arrival-briefing`, `answer-cards`, `founder-docs`, `q-nav`, `q-presence-room`; its own config starts `next start` with **non-empty disabled** provider keys (`apps/web/e2e/playwright.config.ts:55-63`); no package script found to run it |
| `tests/acceptance-e5/` | 8 `*.e5.spec.ts` | own `playwright.e5.config.ts`                                                                                                                                                                                                                          |

Not run (rules: no builds).

### 2.4 Database tests (pgTAP)

- 116 SQL files under `supabase/tests/database`: `000_foundation`, `010_identity_rls`, `020_events_outbox`, `030_audit`, plus `rls/` from `100_principals` to `891_data_room_connected_access`, plus `support/`.
- Run by `pnpm test:db` / `pnpm test:rls` (Supabase CLI). **Not run by me**: it needs the local Supabase stack, and the `supabase` CLI is not on PATH in this VM.
- Known failing per RULES.md (not re-verified):
  - `010` (capability codes, role templates)
  - `240` / `591` (founder definition version)
  - `450` (gateq table count)
- New finding by reading (§5): `882_document_jobs.test.sql:85-86` passes for the wrong reason.

### 2.5 Evals and agents

- `packages/q-evals`: cli, runner, graders, datasets, profiles. Run by `pnpm q:eval:{lint,fast,ci,live}` (`package.json:60-66`), plus separate `q:eval:instructions|voice|rehearsal` scripts. In the default suite: `harness.test.ts` and `gateq-grounding.test.ts`; three `*.integration.test.ts`.
- `q:eval:ci` is not wired into CI.
- Agent and workforce tests (deterministic, model faked):
  - `apps/q-api/test/instruction-*.test.ts` (12 files)
  - `workforce-*.test.ts` (4)
  - `work-*.test.ts` (5, including 2 integration)
  - `packages/q-orchestrator` (9)

### 2.6 Voice tests

- q-api has 30+ voice and interview test files, for example `voice-turn`, `voice-think`, `voice-think-gate`, `voice-session-token`, `voice-speak-elevenlabs`, `duplex-voice-broker` (59 tests), `duplex-voice-routes` and `duplex-transcription-hint`.
- Transports are **injected fakes**: `fetch` stubs and fake providers.
- Web: `apps/web/test/voice-duplex*.test.tsx`, `voice-backchannel`, `voice-mic-recovery`, `q-briefing.test.ts`.
- No test opens a real WebRTC call. The lead's headless-Chromium session (duplex minted, then fell back after about 20 s) is the only end-to-end evidence and it is unexplained.

Status: MOCKED end to end; UNTESTED live.

---

## 3. What I ran (exact)

Environment: provider keys set to the non-empty disabled value `disabled-locally-000000000000` (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, and in batch 1 also `GEMINI_API_KEY_2/2`, `OPEN_AI_API_KEY`, `TAVILY_API_KEY`, `SERP_API_KEY`, `BRIGHT_DATA_API_KEY`, `RECALL_API_KEY`). No builds were run.

**Batch 1**

```
npx vitest run packages/model-gateway/test/gateway.test.ts \
  packages/model-gateway/test/account-exhausted.test.ts \
  packages/model-gateway/test/realtime-voice.test.ts \
  packages/model-gateway/test/images.test.ts \
  packages/q-firewall/test/policy.test.ts \
  packages/q-specialists/test/answer-turn-reading.test.ts \
  apps/q-api/test/duplex-voice-broker.test.ts \
  apps/q-api/test/route-capability-parity.test.ts
```

Result: **Test Files 1 failed | 7 passed (8); Tests 1 failed | 267 passed (268); 19.95 s.**

| File                            | Tests | Result       |
| ------------------------------- | ----- | ------------ |
| gateway.test.ts                 | 34    | pass         |
| account-exhausted.test.ts       | 2     | pass         |
| realtime-voice.test.ts          | 11    | pass         |
| images.test.ts                  | 6     | pass         |
| q-firewall policy.test.ts       | 19    | pass         |
| duplex-voice-broker.test.ts     | 59    | pass         |
| route-capability-parity.test.ts | 8     | pass         |
| answer-turn-reading.test.ts     | 129   | **1 failed** |

The failure is `the answer is told what this run can do (CQ-QX-008) > hands on a manifest built from what is composed and what the plan holds`, at `packages/q-specialists/test/answer-turn-reading.test.ts:919`. `run.capabilities` differs from the expected list: the GATEWAY "does" entries now include "Pass on or reply to a founder in their GateQ inbox…" and "Set up their GateQ gateway…", and the order changed. This is a stale expectation against a grown capability catalog, consistent with RULES.md.

**Batch 2**

```
npx vitest run packages/q-tools packages/q-actions packages/security \
  packages/observability packages/q-core/test/prompts.test.ts packages/config
```

Result: **Test Files 70 passed (70); Tests 1865 passed (1865).** Integration files are excluded by the root config.

**Not run:** pgTAP, integration (needs Postgres), e2e, evals, live.

---

## 4. CI, deploy, rollback, flags

| Item                      | Finding                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| CI triggers               | PRs and `push: main` only                                                                                                                                                                                                                                                                                                                  | `.github/workflows/ci.yml:8-13`                                                                                                |
| CI steps                  | install (frozen lockfile), `format:check`, `lint`, `typecheck`, `test`, `build`; 15 min timeout; read-only permissions; pinned action SHAs                                                                                                                                                                                                 | `ci.yml:17-80`                                                                                                                 |
| Not in CI                 | pgTAP/RLS, integration, e2e, evals, security scanning ("arrive with the packets that introduce those capabilities")                                                                                                                                                                                                                        | `ci.yml:3-6`                                                                                                                   |
| Deploy                    | Railway IaC: 4 services (`api`, `q-api`, `workers`, `web`) from branch `recovery/2026-09-12`, `checkSuites: false`, 1 replica each, healthcheck `/health/ready`, `CAPITAL_Q_ENV=staging`                                                                                                                                                   | `.railway/railway.ts:31,82-87,108-262`                                                                                         |
| Superseded config         | `render.yaml` header: "SUPERSEDED by ADR 0014 — do not apply this blueprint" (CLAUDE.md still cites ADR 0001/Render)                                                                                                                                                                                                                       | `render.yaml:1-9`                                                                                                              |
| IaC drift                 | `railway.ts` omits `OPENAI_API_KEY`, `CQ_VOICE_REALTIME*`, `CQ_INSTRUCTIONS_AUTO`, `RECALL_*`, `Q_EMBEDDING_PROVIDER=openai`; these must be set by hand in the dashboard                                                                                                                                                                   | `.railway/railway.ts:101-106,166-185` vs `apps/q-api/src/voice/duplex/config.ts:75-77`, `packages/config/src/embeddings.ts:81` |
| Rollback                  | No documented rollback procedure in `docs/deployment/staging.md` or `.railway/README.md` (grep "rollback" finds none). Migrations are fix-forward only (CLAUDE.md)                                                                                                                                                                         | grep                                                                                                                           |
| Feature flags             | Env-var flags read at startup, e.g. `CQ_VOICE_REALTIME` (+`_DAILY_CAP_USD`, `_ROUTE_TURNS`, `_BACKCHANNEL`, `_SPEED`, …), `CQ_INSTRUCTIONS_AUTO`, `CQ_MEETING_HOST`, `CQ_DOCUMENT_PIPELINE`, `Q_MCP_SERVER`, `CQ_TEST_MODEL_PROVIDER`, `RECALL_TRANSCRIBER/SCREEN_VISION/CAMERA_VISION`. No runtime flag service; a change needs a restart | `apps/q-api/src/voice/duplex/config.ts:72-139`                                                                                 |
| Model routing as a "flag" | Routing is data in `ai_ops.routing_policies`, read through a 60 s TTL cache, so it changes without a deploy                                                                                                                                                                                                                                | `packages/model-gateway/src/infrastructure/postgres-catalog.ts:201-203`                                                        |

---

## 5. Logging, metrics, tracing, correlation

- **Logger.** pino JSON to stdout. Base fields `service`, `environment`, `serviceVersion?`, `region?`. Every record is enriched with ambient observability context (`requestId`, `tenantId`, `organisationId` set by the auth hooks) and trace ids when a span is valid. With no SDK, spans are never valid (`packages/observability/src/logger.ts:51-95`; `apps/q-api/src/security/actor-context.ts:122-131`). Key-name redaction is one level deep (see 10 §9).
- **Correlation.** `req_<uuid>` and `cor_<uuid>` are server-generated. Inbound `X-Request-Id` is deliberately not trusted (`packages/observability/src/correlation.ts:3-19`). Model calls carry `correlationId` and `qRunId` into `ai_ops.model_usage`.
- **Model telemetry.** The gateway defines 15 counters and histograms (`q.model.requests`, `failures`, `fallbacks`, `hedges`, `spoken_failures`, `usage_record_failures`, `provider_latency_ms`, `estimated_cost_usd`, …) and spans `q.model_gateway.execute` / `provider_attempt` (`packages/model-gateway/src/gateway.ts:219-239,295-305,616-626`). All are **no-ops** today (`telemetry.ts:17-22`). Only the log lines "model request served" / "model provider attempt failed" / "no eligible route" survive (`gateway.ts:555-571,726-737,940-955`).
- **Voice timing.** One "voice turn timed" log line per voice turn (`apps/q-api/src/main.ts:991-1000`, `createVoiceTurnTimings`).
- **Firewall.** One "context firewall evaluated" log per plan (`packages/q-firewall/src/firewall.ts:597-625`).
- **Error monitoring.** None: no `@sentry/*` or equivalent in any `package.json` or source. Unhandled errors go only to the logs and to RFC 9457 problem responses (`apps/*/src/http/problem-handler.ts`, not read in depth).
- **Health.** `/health/ready` is the Railway healthcheck for api and q-api (`.railway/railway.ts:126,163`).

---

## 6. Tested vs assumed

| Behaviour                                                               | Tested?                                                                                                                     | Notes                                                                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Gateway eligibility, fallback, retry, budget, hedge, streaming no-retry | Unit, yes (34 tests passed)                                                                                                 | Fake providers                                                                                    |
| OpenAI adapter mapping, account-exhausted classification                | Unit, yes                                                                                                                   | `account-exhausted.test.ts`, `openai-diagnostic-fence.test.ts` (not run)                          |
| OpenAI as primary in production                                         | **No** live smoke                                                                                                           | §2.2                                                                                              |
| Routing policy rows                                                     | pgTAP `320_ai_ops`, `590_fast_classification_routing` (4 asserts)                                                           | Not run here; `320` codifies the image-id collision (10 models, no `gemini-3.1-flash-lite-image`) |
| Image model catalog                                                     | `882_document_jobs.test.sql:85-86` asserts `…022` is ACTIVE "gemini-3.1-flash-lite-image"                                   | **False positive.** The row is `gpt-realtime-mini` (see 09 §7.1)                                  |
| Context Firewall policy                                                 | Unit, yes (19); integration file exists                                                                                     | —                                                                                                 |
| Tool pipeline, approvals                                                | Unit, yes (q-tools and q-actions all passed)                                                                                | —                                                                                                 |
| RLS for browser roles                                                   | pgTAP (113 rls files)                                                                                                       | 4 known failing files; not run                                                                    |
| RLS for server role                                                     | **Not tested**, and by design not enforced (10 §3)                                                                          | —                                                                                                 |
| Duplex broker caps, routing, transcripts                                | Unit, yes (59 tests)                                                                                                        | Usage is supplied by the test, as the browser would supply it                                     |
| Real WebRTC duplex                                                      | **No**                                                                                                                      | Lead's live trace: duplex ended about 20 s in and fell back                                       |
| Briefing/opener "what needs attention" correctness                      | Unit only (`q-briefing.test.ts`, `returning-opener.test.ts`); e2e spec `arrival-briefing.spec.ts` runs against a mocked web | Live result contradicted it (RULES.md live evidence)                                              |
| Answer manifest (capabilities)                                          | **Failing** unit test                                                                                                       | §3                                                                                                |
| Prompt-injection fencing                                                | Unit test of the fence function only                                                                                        | No coverage test over all prompt variables (10 §5.2)                                              |
| Web research result in SYSTEM role                                      | No test asserts the role                                                                                                    | 10 §5.1                                                                                           |
