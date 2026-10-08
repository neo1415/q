# G: Independent verification (RECOVERY-2026-10)

Owner: workstream G. Branch `build/rec-g`, based on `recovery/2026-09-12-8y2j4w` at `fe5579c3`.
Edit rights (SPEC §2): `apps/web/e2e/**`, `tests/**`, `scripts/recovery/**`, `docs/recovery/evidence/**`. No product source edits. A defect goes to the lead with reproduction steps.

G proves or disproves the claims of workstreams A–F. A test that is red because the work has not landed is labelled **expected red** and names the TRACKING row it waits for. A test that is red for any other reason is a defect.

## 1. Research (sources)

| Topic                        | Source                                                                                                                                                                                                                                                                                                    | What it settles                                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright WebSocket mocking | playwright.dev/docs/api/class-websocketroute (`page.routeWebSocket`, 1.48+; repo pins 1.62.1)                                                                                                                                                                                                             | The standard line's Deepgram agent socket (`wss://agent.deepgram.com/v1/agent/converse`, `apps/web/src/features/voice/provider/agent-socket.ts:26`) can be served by the test, with no vendor.                   |
| Fake capture devices         | Chromium switches `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`, `--use-file-for-fake-audio-capture=<wav>` (chromium.googlesource.com, `media/capture/video/fake_video_capture_device` and `media/audio/fake_audio_input_stream`); the lead's script `scratchpad/voice/call.mjs` | A WAV plays as the microphone. 16-bit PCM WAV, mono, 16 kHz or 48 kHz. `%noloop` suffix stops repeating.                                                                                                         |
| Mic permission loss          | Playwright `browserContext.clearPermissions()` / `grantPermissions([])`; `MediaStreamTrack` `ended` event                                                                                                                                                                                                 | Simulates lost mic permission and a track ending mid-line; `duplex-line.ts:949-987` (`#reacquireMicrophone`) and `deepgram-session.ts:649-661` (mic watchdog) are the code under test.                           |
| Network loss                 | `browserContext.setOffline(true)`; `page.route(...).abort("internetdisconnected")`                                                                                                                                                                                                                        | Network and relay failures without touching servers.                                                                                                                                                             |
| WebRTC boundary              | W3C webrtc-pc (RTCPeerConnection, RTCDataChannel); OpenAI realtime WebRTC (developers.openai.com/api/docs/guides/realtime-webrtc): SDP POST to `/v1/realtime/calls`, events on data channel `oai-events`                                                                                                  | A page-side fake of `RTCPeerConnection` that answers the SDP locally and scripts `oai-events` lets the duplex line run without OpenAI.                                                                           |
| OpenAI SDK base URL          | openai-node `ClientOptions.baseURL` defaults to `process.env.OPENAI_BASE_URL`                                                                                                                                                                                                                             | `packages/model-gateway/src/providers/openai.ts:346` constructs `new OpenAI({apiKey, maxRetries:0})` with no baseURL, so `OPENAI_BASE_URL` redirects every text call to a local fake with **no product change**. |
| Responses API wire shape     | developers.openai.com/api/reference/responses (object `response`, `output[]` items `message`/`function_call`, SSE events `response.created`, `response.output_text.delta`, `response.completed`)                                                                                                          | The fake vendor speaks exactly this subset.                                                                                                                                                                      |
| axe-core                     | github.com/dequelabs/axe-core (`axe.run`, WCAG 2.x A/AA tags)                                                                                                                                                                                                                                             | `axe-core@4.13.0` is already in the lockfile (transitive, `node_modules/.pnpm/axe-core@4.13.0`), not a direct dependency.                                                                                        |
| Percentiles                  | Nearest-rank method (NIST/Hyndman–Fan type 1)                                                                                                                                                                                                                                                             | p50/p95 are computed from observed samples only; n is printed beside every figure; n < 5 prints "insufficient".                                                                                                  |

## 2. Current behaviour (what exists, with paths)

- **Two browser suites already exist.** `apps/web/e2e/playwright.config.ts:1-75`: fixture-only harness pages under `apps/web/app/dev/*` (product source, `CQ_DEV_PREVIEW=1`). `playwright.config.ts:1-140`: full journeys against the local Supabase plus a built api and web. `tests/acceptance-e5/playwright.e5.config.ts`: against an already-running stack. None covers scenarios A–H.
- **A deterministic model fake exists but is test-only in code.** `packages/model-gateway/src/providers/fake.ts:1-230` (`createFakeModelProvider`, scripted TEXT/JSON/TOOL_CALLS/FAIL/HANG). q-api never registers it (`apps/q-api/src/main.ts:906-935` registers google/groq/openai by key only). `withTestRouting` (`packages/model-gateway/src/policy/test-route.ts:59`) can force one catalogue provider in local/test.
- **Voice vendor URLs are constants.** `apps/q-api/src/voice/providers/deepgram.ts:16` (`GRANT_URL`), `packages/model-gateway/src/realtime/openai.ts:28-30` (client secrets, calls). A local stack cannot issue a voice credential without a live vendor call. Defect G-D2.
- **Egress.** Node in this VM reaches `api.deepgram.com` (verified: `fetch` returned 401 through the agent proxy). Disabled keys alone do not prevent a live call attempt. G adds an egress guard.
- **Logs.** pino NDJSON. `"voice turn timed"` (`apps/q-api/src/voice/turn-timing.ts:168-194`: `reasoningStartMs`, `firstTextMs`, `firstAudioMs`, `endMs`, `outcome`, `modelMs`). `"q answer produced"` (`packages/model-gateway/src/q/index.ts:4195-4219`: `latencyMs`, `totalMs`, `firstPublishedMs`, `attempts`, `fallbackUsed`). `"duplex voice line ended"` (`apps/q-api/src/voice/duplex/broker.ts:1141-1158`).
- **Local stack in this VM.** `dockerd` was not running after the VM restart (uptime 16 min at 14:08 UTC); starting it restarted the Supabase containers. 178 migrations applied; DB empty (0 users). Storage, realtime, studio and others were stopped. `scripts/seed-fictional-world.mjs` seeds 12 companies and 8 investors through a running api (`founder.<key>@` / `investor.<key>@fictional.capitalq.local`, synthetic password from `scripts/dev-bootstrap.mjs:52`).
- **Observable UI.** Composer placeholder "Message Q" (`apps/web/src/features/q/q-conversation.tsx:1343`) / "Ask Q" (`q-sheet.tsx:249`); answers carry `data-q-answer="streaming|settled"` (`q-answer.tsx:112`); "Talk with Q" (`q-conversation.tsx:1341`). No DOM marker exposes `QTurnDisposition` or `QUiActReceipt` yet.

## 3. Design

### 3.1 Local full stack, no live calls (`scripts/recovery/`)

- `local-stack.sh start|stop|status|seed|env` brings up one service at a time: docker → Supabase (`supabase start`, storage kept) → fake vendors → api → q-api → workers → web (`next dev`). PIDs and logs go to `$CQ_RECOVERY_RUN_DIR` (default `.playwright/recovery-stack/`, already gitignored with `.playwright/`). `stop` kills exactly the PIDs it started.
- `egress-guard.mjs` is preloaded (`node --import`) into api, q-api and workers. It patches `net.Socket.prototype.connect` and refuses any non-loopback TCP destination, logging `"recovery egress refused"` with the host. The agent proxy variables are unset for those processes. This is the guarantee; disabled keys are the second layer.
- `fake-vendors.mjs` is one loopback HTTP server: OpenAI Responses (`POST /v1/responses`, JSON and SSE), embeddings (`POST /v1/embeddings`, deterministic unit vectors), and placeholders for Deepgram grant and OpenAI realtime client secrets (used once G-R2 lands). Answers come from a **script file** (`tests/recovery/fixtures/q-script.json`, override `CQ_FAKE_SCRIPT`), re-read on every request so a test can swap it. Rules match on the last user text (regex) and the offered tool names; no match answers an honest `"[scripted] no rule matched"` so a missing rule is visible, never silent. Every request is appended to `fake-vendors.ndjson` so a test can assert what the model was shown (Context Firewall checks).
- Every provider key is set to `disabled-locally-000000000000`; `OPENAI_BASE_URL` points at the fake.

### 3.2 Browser tests (`tests/recovery/`)

- `playwright.recovery.config.ts`: runs against the running local stack, Chromium at `/opt/pw-browsers/chromium`, fake media switches, one worker (4 shared CPUs), JSON + list reporters to `.playwright/recovery/`.
- `support/`: `stack.ts` (URLs, accounts), `auth.ts` (sign in a seeded account), `q.ts` (ask Q by text, wait for a settled answer, read dispositions and receipts), `expect-red.ts` (`awaits(rows, why)` annotation), `faults.ts` (offline, abort routes, permission loss), `duplex-fake.ts` (RTCPeerConnection fake init script), `deepgram-fake.ts` (routeWebSocket agent fake), `axe.ts`.
- `scenarios/a…h-*.spec.ts`, `promises/q01…q08-*.spec.ts`, `permissions/*.spec.ts` (HTTP through Playwright `request`), `voice/*.spec.ts`, `a11y/axe.spec.ts`.
- **Expected red** is an annotation, not `test.fail()` and not a skip: the test runs, fails honestly, and `results-table.mjs` reports it as `EXPECTED RED (awaits C1, C2)` versus `UNEXPECTED RED`. When the awaited work lands and the test passes, the table shows `GREEN (was expected red)`, prompting removal of the annotation.

### 3.3 Test hooks requested (the only way G can observe contracts without reading internals)

- **G-R1 (C):** `performUiAct` also dispatches `window` `CustomEvent("cq:ui-act-receipt", {detail: QUiActReceipt & {act, target}})`. Tests record receipts with an init script.
- **G-R3 (A, B, E):** every rendered Q turn element carries `data-q-turn-id` and `data-q-disposition` (one of `QTurnDisposition`), and `data-q-failure` when FAILED. IGNORED is rendered visibly (SPEC §4.3).
- **G-R4 (B):** the attention answer renders `data-q-attention-unread="<SOURCE,…>"` when any source was unread.
- **G-R5 (D):** Work rows carry `data-work-state` (one of `QWorkState`).

### 3.4 Voice

- **Standard line:** fake mic WAV + `routeWebSocket` Deepgram agent fake. Asserts mic frames arrive, `ConversationText`/`AgentAudioDone` flow, and failure paths (socket close → reconnect ladder 1.2/3/8 s then the notice, `use-voice-interview.ts:112,236-287`).
- **Duplex:** init-script fake `RTCPeerConnection` + `page.route` for the SDP POST; the script emits `oai-events` (`input_audio_buffer.speech_started/stopped`, `conversation.item.input_audio_transcription.completed`, `response.output_audio_transcript.delta`, `error`). Covers realtime timeout (no SDP answer within `DUPLEX_CONNECT_MS`), failed transcript (`...transcription.failed`), relay failure (server action aborted), playback loss (`output_audio_buffer` never starts), barge-in.
- **Real Nigerian-English clips:** `scripts/recovery/voice/RECORDING.md` tells the founder how to record five clips; `scripts/recovery/voice/play-clips.mjs` plays each through the fake mic into a running stack and writes what the app heard beside the expected text. It needs a live STT vendor, so it is run only on the founder's approval (CLAUDE.md budget rule).

### 3.5 Permission-negative (`tests/recovery/permissions/`)

API-level, through `request` with two seeded sessions: investor vs founder disclosure (`/v1/documents/:id`, `/v1/data-room/documents/:id/access`, `/v1/network/companies/:id/incoming-interest`), other-tenant records, approvals (`/v1/q/approvals/:id` and `/approve` by a non-owner; strict body refuses `approver`, `payloadHash`, `role`). Expect 403/404 problem details, never 200 with data. Also: the founder-private sentinel planted in a founder document never appears in any fake-vendor request made for an investor turn (`fake-vendors.ndjson`).

### 3.6 Promise acceptance (Q.01–Q.08)

One spec per promise, twelve steps each as `test.step`. The founder's brief is not in the repository; the 12 steps are SPEC §5's ten plus two from CLAUDE.md, and the lead must confirm them: 1 journey, 2 data, 3 backend, 4 UI, 5 text, 6 voice, 7 persistence, 8 authorization, 9 failure, 10 integration, 11 honesty (truth labels, unknown ≠ empty, no invented numbers), 12 measurement (a timing log line exists). `scripts/recovery/results-table.mjs` turns the JSON report into `promises.md` (promise × step: PASS / FAIL / EXPECTED RED).

### 3.7 Performance (`scripts/recovery/perf-report.mjs`)

Reads NDJSON logs (files or stdin), selects `msg` = `"voice turn timed"` / `"q answer produced"` / `"duplex voice line ended"`, computes nearest-rank p50/p95/max per field with n, and prints "insufficient (n=k)" below five samples. Never estimates. Local runs against the fake vendor measure our code only; the report says so.

### 3.8 Release evidence (`scripts/recovery/release-evidence.mjs`)

Runs the gates one at a time (format:check, lint on changed files or full when `--full`, typecheck, vitest, pgTAP, recovery Playwright) and writes `docs/recovery/evidence/<date>/` with `gates.md` (exact command, exit code, duration, counts parsed from the tool's own summary) plus raw tails. A gate that was not run is written as NOT RUN, never PASS.

## 4. Files (all inside G's ownership)

`scripts/recovery/{local-stack.sh,local-stack.md,egress-guard.mjs,fake-vendors.mjs,seed-local.sh,perf-report.mjs,results-table.mjs,release-evidence.mjs}`, `scripts/recovery/voice/{RECORDING.md,play-clips.mjs}`, `tests/recovery/**`, `docs/recovery/evidence/**`.

## 5. Requests to the lead

- **G-R1** receipt event (C). **G-R3** disposition attributes (A, B, E). **G-R4** unread attribute (B). **G-R5** work-state attribute (D).
- **G-R2 (A, F):** local/test-only vendor base override for voice: `CQ_VOICE_VENDOR_BASE_URL` read where `GRANT_URL` (`deepgram.ts:16`) and the realtime URLs (`realtime/openai.ts:28-30`) are built, refused unless `CAPITAL_Q_ENV` is `local` or `test`. Without it no voice test can run against q-api offline.
- **G-R6:** add `axe-core` (4.13.0, already in the lockfile) as a root devDependency so `tests/recovery/support/axe.ts` resolves it normally rather than from the pnpm store path.
- **G-R7:** confirm the founder brief's 12-step promise structure (§3.6 is an assumption).

## 6. Risks

- `next dev` compiles on first visit and is slow on 4 shared CPUs; the config's timeouts are generous and the stack starts one service at a time.
- The fake vendor proves our code, not the vendors. Live verification remains a separate, founder-approved step.
- Selectors drift as C and E change pages; all selectors live in `support/q.ts` and `support/pages.ts`.

## 7. Acceptance checklist

| Item                                | SPEC §5 / TRACKING    | Evidence                                         |
| ----------------------------------- | --------------------- | ------------------------------------------------ |
| Local stack starts/stops, no egress | G1                    | `local-stack.sh status`, guard log               |
| Scenarios A–H specs                 | §5 A–H, G2            | `tests/recovery/scenarios/*`                     |
| Voice failure simulations           | §5 E, G, H            | `tests/recovery/voice/*`                         |
| Permission-negative                 | §4.5, CLAUDE.md       | `tests/recovery/permissions/*`                   |
| Promises Q.01–Q.08                  | §5 promises, G3       | `tests/recovery/promises/*`, `results-table.mjs` |
| a11y                                | CLAUDE.md WCAG 2.2 AA | `tests/recovery/a11y/*`                          |
| Perf p50/p95                        | audit 04 §15          | `perf-report.mjs`                                |
| Release evidence                    | §6.4                  | `release-evidence.mjs`                           |
