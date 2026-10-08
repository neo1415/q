# 04 — Voice System (forensic audit, investigator C)

Repository `/home/user/q`, branch `recovery/2026-09-12-8y2j4w`, HEAD `520bd123`. Read-only audit, 2026-10-08.
All `path:line` references are to that HEAD. Excerpts with original line numbers are in `evidence/voice/*.md`.
Diagrams: `diagrams/voice-lifecycle.md`, `diagrams/voice-state-machine.md`, `diagrams/error-propagation-voice.md`.
Findings list: `_findings/C.md`.

Classification legend: IMPLEMENTED / PARTIAL / CONFIGURED-UNUSED / MOCKED / BROKEN / UNTESTED / PLANNED.
"Verified" means established by reading the code path end to end (and, where stated, by a probe or test run).
"Hypothesis" means the code allows it but runtime occurrence was not observed by me.

---

## 1. Executive summary

The voice system has two live lines and one dormant one:

| Line | Speech in | Brain | Speech out | Status |
|---|---|---|---|---|
| **Duplex** (flag `CQ_VOICE_REALTIME`) | OpenAI Realtime `gpt-realtime-mini` over WebRTC; input transcription `gpt-4o-transcribe` | Server router (`routeDuplexTurn`) → `ask_q` → the standard voice turn handler → Q run; SMALLTALK/MODEL turns answered by the realtime model alone | The realtime model's own voice (`marin` / `cedar`), speaking text it is handed | IMPLEMENTED, with confirmed defects |
| **Standard** (Deepgram Voice Agent) | Deepgram Flux STT (`flux-general-en`/`-multi`), PCM16 16 kHz | Deepgram "think" calls Q API `/v1/q/voice/think/chat/completions` → the same voice turn handler | Deepgram "speak" calls Q API `/v1/q/voice/speak` → ElevenLabs `eleven_v3_conversational` (turbo v2.5 → Aura-2 fallbacks), PCM16 24 kHz | IMPLEMENTED |
| ElevenLabs Speech Engine (whole transport) | ElevenLabs | Q API over a WebSocket | ElevenLabs | CONFIGURED (only when `Q_VOICE_PROVIDER=elevenlabs` and no Deepgram); not inspected in depth |

Top findings (details in §13 and `_findings/C.md`):

1. **BROKEN (verified, probe run): a "silent" ask_q through the `/duplex/tool` route crashes the response.** `broker.askQ` returns an object with an extra `silent: true` key (`apps/q-api/src/voice/duplex/broker.ts:556-558`), `broker.tool` returns it unchanged for `ask_q` (`broker.ts:944`), and the route parses it with `QVoiceDuplexToolResultSchema.parse` (`apps/q-api/src/voice/duplex/routes.ts:86`), which is `.strict()` and has no `silent` field (`packages/contracts/src/q/voice.ts:432-441`). I ran `safeParse` on that exact shape: `{"success":false,"issues":[["unrecognized_keys",["silent"]]]}`. The route throws, the server action returns `null` (`apps/web/src/features/voice/duplex-actions.ts:53-57`), and the browser feeds the model "That request did not get through. Say so in a few words and ask them to try again." (`apps/web/src/features/voice/provider/duplex-line.ts:1496-1502`). Affects every ask_q the *model* calls (MODEL-routed turns, card-in-focus turns, forced ask_q after a missing transcript, replies on guided lines that the model forwards itself) when Q decides to stay silent (unclear speech, words not addressed to Q, empty spoken text).
2. **BROKEN (verified): the "speak from facts" path never reaches the duplex voice in production.** `timedVoiceTurns` wraps the turn handler with a `timedSpeaker` that forwards `narrate` and `deferred` but not `facts` (`apps/q-api/src/voice/turn-timing.ts:369-395`). The broker is composed with that wrapped handler (`apps/q-api/src/main.ts:5383`, `5472`). So `turn.ts` `fromFacts` sees `speaker.facts === undefined` (`apps/q-api/src/voice/turn.ts:951`) and runs the extra SPOKEN_REPLY model rewrite instead; `broker` `heldFacts()` is always null and `askQFactsOutput` is never returned live. The broker unit tests pass because they inject an unwrapped turn.
3. **"Just listening and not doing anything" has several verified paths** (§14): Q's deliberate silence on unclear/room speech (`packages/q-specialists/src/answer.ts:2442-2462`) → duplex `silent` → browser returns to LISTENING with no word (`duplex-line.ts:1647-1652`); standard line returns an empty think stream and the browser sits on "Thinking" for up to 14 s (`deepgram-session.ts:61`, `358-368`); the duplex presence visual gets input/output levels hard-coded to 0 (`duplex-session.ts:246-248`); the duplex line ends itself after 30 s of quiet without a notice (`duplex-line.ts:1153-1175`, `config.ts:49`, `use-voice-interview.ts:249-255`).
4. **The realtime model still answers without Q** whenever the server routes a turn SMALLTALK or MODEL (`duplex-line.ts:1643-1646`). MODEL is chosen for *any* utterance of ≤12 words while a briefing card is in focus (`routing.ts:181`, `line-cards.ts:78-80`), e.g. "find anything that needs my attention". "yes"/"no"/"I" are in the small-talk list (`routing.ts:48-90`), so a bare "yes" to a question Q asked is answered by the voice model unless the broker flagged `awaitingApproval`.
5. **Duplex relays are Next.js server actions, which Next runs one at a time per client** (`node_modules/.../next/dist/client/components/app-router-instance.js` dispatchAction/runRemainingActions; acknowledged in `provider/narration-poll.ts:7-8`). The `heard` relay holds for the whole ask_q (no deadline: `broker.ts:528-535`), so the 1.5 s turn poll that drives cards/navigation (`use-voice-interview.ts:583-586`), usage reports, `said` reports and rejoin requests queue behind it.
6. **A model-initiated ask_q answer can be spoken after a newer question** (G): `#relayTool` guards only on `#generation`, which changes only on barge-in, not on a new turn (`duplex-line.ts:1421`, `1528-1533`); routed turns use `#turnSeq` (`duplex-line.ts:1638`).
7. **A routed answer is dropped after a rejoin completes mid-ask** (C): when `transport !== this.#transport` and the line is no longer rejoining, the result is neither queued nor sent (`duplex-line.ts:1654-1658`), unlike `#relayTool`, which injects it as context (`duplex-line.ts:1508-1516`). State stays THINKING.
8. **Realtime `error` events and failed `response.done` statuses are ignored** (I): the dispatcher has no `error` case (`duplex-line.ts:1258-1413`) and `response.done` reads only usage (`1400-1410`). There is no THINKING watchdog on the duplex line (the standard line has one: `deepgram-session.ts:358-368`).
9. **Noise during answer generation cancels the answer with no repair** (E): `speech_started` while a response is being generated (not yet audible) barges in immediately, without the 450 ms confirm (`duplex-line.ts:1265-1266`); if the noise transcribes to nothing, the flush returns to LISTENING (`1582-1587`). The standard line has a "[continue]" repair (`deepgram-session.ts:454-474`); duplex has none.
10. **Mechanical delivery is designed in**: the opener and narration beats are sent as "Say exactly this … word for word" (`duplex-line.ts:1077`, `1914`, `instructions.ts:213`); Q's text answers go to the voice as `say` with "say that faithfully" (`instructions.ts:113`); `speakable()` flattens lists, drops table rows and caps at 1,200 chars (`speech.ts:271-305`, `12`).

---

## 2. Transports and how one is chosen

### 2.1 Server side: issuing a session — `POST /v1/q/voice/sessions`

`apps/q-api/src/voice/routes.ts:551-932` (evidence `session-issue.md`).

1. Transport = `deepgram ?? elevenLabs` (`routes.ts:570-572`). Deepgram is composed when `Q_VOICE_PROVIDER` resolves to `deepgram`, its key exists and `Q_API_PUBLIC_URL` is set (`apps/q-api/src/main.ts:5061-5082`); the ElevenLabs Speech Engine only when `Q_VOICE_PROVIDER=elevenlabs` with Speech Engine ids (`main.ts:5010-5018`).
2. The opener (`firstMessage`) is composed server-side: rehearsal line, welcome turn, onboarding conductor turn, else `composeReturningOpener(...)` or "Hi {name}. What's on your mind?" (`routes.ts:600-733`), passed through `speakable` and bounded (`routes.ts:692-698`).
3. One standard binding per person: `dependencies.bindings.releaseFor(actor.userId)` before issuing (`routes.ts:809`). A second surface or tab opening a line releases the first line's binding, so the first line's think/speak calls are refused 401 (`think.ts:191-205`).
4. **Duplex is offered on top of the standard credential, never instead** (`routes.ts:866-896`): if the broker is enabled, `input.duplex !== false` and not a rehearsal, `broker.open(...)` is called; any failure is logged ("duplex voice unavailable") and the standard credential is returned alone.

### 2.2 Duplex broker open — `apps/q-api/src/voice/duplex/broker.ts:643-814` (evidence `broker-open.md`)

Order: flag → rehearsal refused → one duplex line per person (older removed, `650-652`) → daily spend (fail closed, `654-664`) → Context Firewall plan (`670-680`) → tool offer (`690-699`) → remembered listening level (`701-721`) → mint (`726-768`). Any short-circuit returns `FALLBACK` with a reason (`OFF`, `REHEARSAL`, `CAP_REACHED`, `LEDGER_UNAVAILABLE`, `DENIED`, `TOOLS_UNAVAILABLE`, `MINT_UNAVAILABLE`) and is logged "duplex voice fell back to the standard line" (`488-491`).

Notable facts:
- Tools minted: `ask_q`, `set_listening` (if backchannel), `decide_card`; **no direct read tools** (`broker.ts:733-740` passes `[]`) even though `direct` is computed and `config.maxDirectTools` defaults to 6. CONFIGURED-UNUSED.
- `guided` = welcome or onboarding line → `GUIDED_CONDUCT` and every turn routes ASK_Q (`broker.ts:723-725`, `routing.ts:178`).
- Provider ceiling is `"PUBLIC"` (openai UNREVIEWED) unless the deployment holds the synthetic-demo attestation (`main.ts:5462-5465`; gateway check `packages/model-gateway/src/realtime/index.ts:262-267`). On a non-attested deployment every non-PUBLIC plan returns `INELIGIBLE` → `MINT_UNAVAILABLE`. Live evidence shows lines minted today, so the attestation is presumably present (not verified by me).
- Defaults (`apps/q-api/src/voice/duplex/config.ts:45-57`): `enabled:false`, `maxSessionMs` 10 min, **`dailyCapUsd` 1** (platform-wide, all tenants: `spend.ts:23-28`), `idleMs` 30 s, `sessionReserveUsd` 0.25, `maxOutputTokens` 800, `secretTtlSeconds` 60, `speechSpeed` 0.95, `routeTurns` on, `backchannel` on. The env values in production were not visible to me.

### 2.3 Browser side: picking the transport

`apps/web/src/features/voice/use-voice-session.ts:50-65` (evidence `use-voice-session.md`): if `credential.duplex` exists, `duplex.start(input)` is awaited; if it resolves `false`, the provider named by the credential (`deepgram` or `elevenlabs`) starts **on the same credential** at once, silently.

`use-voice-interview.ts` (`talk`, `445-527`) asks for a session with `duplex:false` once `duplexOff` is set (`470`).

### 2.4 Fallback rules (all verified in code)

| Event | Where | Result |
|---|---|---|
| Duplex mint refused / any open failure | `routes.ts:866-896` | Standard credential only; person never told |
| Mic `getUserMedia` fails on duplex | `duplex-line.ts:527-540` | `fallback("CONNECT")` → `start` false → standard line on the same credential |
| WebRTC offer/answer or data channel not up within `DUPLEX_CONNECT_MS` = 10 s | `duplex-line.ts:352`, `628-643`, `1124-1140` | One retry on a freshly minted call (`relays.rejoin("NETWORK")`, `547-553`); else `fallback("CONNECT")` → standard line. Two timeouts ≈ 20 s+, which matches the lead's "minted, then rejoined, then ended ~20 s later" observation (hypothesis: the sandbox blocks WebRTC media) |
| Connection `failed` or `disconnected` > grace | `duplex-line.ts:890-915` | `#rejoin("NETWORK")` up to `MAX_REJOINS`=6, `REJOIN_ATTEMPTS`=4 each (`147-150`, `698-759`) |
| Session length reached | `duplex-line.ts:650-653`, `broker.ts:1046-1050` | Rejoin `MAX_LENGTH` (same voice) |
| Usage relay null 3× | `duplex-line.ts:2144-2163` | Rejoin `RELAY` |
| Daily cap | `broker.ts:1058-1062`, `1101-1108` | `fallback("CAP", DUPLEX_CAP_NOTICE)` |
| Duplex fell back after it was up | `duplex-session.ts:178-192` → `use-voice-interview.ts:314-368` | New `talk({resume:true})`: renewed as duplex for NETWORK/RELAY/MAX_LENGTH up to `MAX_DUPLEX_RENEWALS`=6 (`47`, `341-348`); CAP/CONNECT or exhausted → standard line (`duplex:false`) |
| Duplex idle 30 s | `duplex-line.ts:1153-1175` | Line **ends** (`onEnded("IDLE")` → `ended("ended")` → `setActive(false)`, no reconnect, no notice: `use-voice-interview.ts:249-255`) |
| Standard line error/disconnect | `deepgram-session.ts:570-617` | `onEnded("dropped")` → reconnect 1.2 s / 3 s / 8 s then "I couldn't get the line back…" (`use-voice-interview.ts:112`, `236-287`) |

Edge (hypothesis): the standard credential's Deepgram token lives `TOKEN_TTL_SECONDS` = 60 s (`providers/deepgram.ts:17`). The immediate fallback reuses it after the duplex connect attempts (mic prompt + up to 2 × 2 × 10 s). A slow mic-permission prompt plus two connect timeouts could exceed 60 s, and the Deepgram socket would then be refused.

---

## 3. Audio input

### 3.1 Duplex (WebRTC to OpenAI)

- `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })` (`duplex-line.ts:283-286`). No `autoGainControl`, sample rate or channel count constraint: WebRTC/Opus picks them. The provider session sets no `noise_reduction` (`packages/model-gateway/src/realtime/openai.ts:106-138`).
- The mic track is added to an `RTCPeerConnection` (`duplex-line.ts:613-619`); events travel on data channel `oai-events` (`620-624`); SDP is POSTed to `https://api.openai.com/v1/realtime/calls` with the ephemeral client secret (`630-642`, `openai.ts:29-30`).
- A local `AudioContext` + `AnalyserNode` (fftSize 1024) reads RMS every `LEVEL_FRAME_MS` = 50 ms, **only for the backchannel pause detector** (`duplex-line.ts:322-347`, `1692-1714`; `backchannel.ts:266-296`: `MIN_VOICE_RMS` 0.02, adaptive floor ×3, 2 voiced frames). The levels are never exposed to the UI: `inputLevel`/`outputLevel` return 0 (`duplex-session.ts:246-248`).
- No AudioWorklet anywhere on this line. No chunking: the provider receives continuous Opus RTP.
- Track recovery: `ended` → `#reacquireMicrophone` replaces the track on the sender (`duplex-line.ts:949-987`); device change and tab-visible re-check (`564-571`, `989-1001`).
- Away pause: hidden tab / pagehide / freeze / 10 s blur mutes the mic until the person unmutes (`use-voice-session.ts` `AWAY_BLUR_PAUSE_MS`, evidence `use-voice-session.md`).

### 3.2 Standard (Deepgram Voice Agent)

- Deepgram SDK `AgentMicrophone` with `{ sampleRate: 16_000, echoCancellation: true }` (`deepgram-session.ts:288-296`); noise suppression is whatever the SDK defaults to (not inspected).
- PCM16 linear 16 kHz frames go over our own `AgentSocket` to `wss://agent.deepgram.com/v1/agent/converse` (`agent-socket.ts:26`). Until the agent applies settings, frames are held, max `MAX_HELD_FRAMES` = 256 (~2 s); older frames are shifted out (`agent-socket.ts:39`, `180-185`). Speech said in that window before settings are applied can be lost (A, hypothesis).
- Stall detection: >2 s of unsent audio counts as stalled (`agent-socket.ts:30-37`). Mic watchdog: no frame for `MIC_SILENT_MS` = 2 s → restart mic (`deepgram-session.ts:71`, `649-661`). No frames at all 4 s after start → "Q can't hear you…" (`693-698`).
- A console heartbeat every 5 s logs frames sent, last provider event, mute and input level (`deepgram-session.ts:297-316`). Browser console only.

---

## 4. VAD and end of turn

| | Duplex | Standard |
|---|---|---|
| Detector | Provider `semantic_vad` (`openai.ts:110-122`) | Deepgram Flux end-of-turn model |
| Eagerness | `auto` when backchannel on and level ≠ OFF, else `high` (`broker.ts:750-758`, `openai.ts:112-113`; changed live by `#sendTurnDetection`, `duplex-line.ts:1042-1062`) | `eot_threshold` 0.85, `eot_timeout_ms` 4,000 (`providers/deepgram.ts:233-234`) |
| Who starts the reply | Routed line: `create_response:false`; the browser decides (`openai.ts:116`, `duplex-line.ts:1053`) | Deepgram agent calls think |
| Interruption | Provider `interrupt_response:false`; the browser decides: speech over audible Q must last `BARGE_CONFIRM_MS` = 450 ms; Q is ducked to 0.3 meanwhile (`duplex-line.ts:132-134`, `1185-1196`). Speech while a response is generating but not yet audible barges in **at once** (`1266`) | Provider "user-started-speaking" stops at once; browser drops in-flight audio for `STALE_AUDIO_MS` = 700 ms (`deepgram-session.ts:116`, `475-499`) |
| Blip | Speech that stops before 450 ms → Q restored, next committed item deleted (`duplex-line.ts:1199-1208`, `1285-1291`) | "[continue]" cue injected after 4.4 s of quiet if no words came (`deepgram-session.ts:103-110`, `454-474`) |
| Unfinished utterance hold | Skipped (`settledTurn`, `turn.ts:411-416`; broker `532`) | `UNFINISHED_HOLD_MS` = 1.5 s when the transcript ends unfinished (`turn.ts:400`, `1897-1914`) |
| Transcription | `gpt-4o-transcribe` with `language` (device locale, default `en`) and a vocabulary prompt (`openai.ts:48`, `123-137`; `broker.ts:242-258`) | Flux with `keyterms` (own names, org hint, remembered terms, ASR keywords; max 100) (`providers/deepgram.ts:198-210`) |

Mid-turn backchannel commits (duplex): when the policy fires, the browser sends `input_audio_buffer.commit` and waits `COMMIT_WAIT_MS` = 400 ms for the item id (`duplex-line.ts:126`, `1752-1767`). Levels: SUBTLE (default, `contracts/src/q/voice.ts:308`) max 1 reaction per turn; NATURAL max 5 (`backchannel.ts:41-61`).

---

## 5. Processing: who decides each turn

### 5.1 Duplex, routed (`routeTurns` on — the default)

Browser (`duplex-line.ts`, evidence `duplex-line-receive-relaytool.md`, `duplex-line-routing.md`):

1. `input_audio_buffer.committed` (not a reaction commit) → `#turnFinished(itemId)` (`1283-1304`, `1541-1558`) gathers the turn's items and waits up to `TRANSCRIPT_WAIT_MS` = 2.5 s for their transcripts (`205`).
2. `#flushTurn` (`1568-1591`): words → `#routeHeard`; empty transcript (not timed out) → LISTENING, nothing said; timed out → `#forceAskQ` (`response.create` with `tool_choice: ask_q`, `1594-1602`) — the *model* writes the request from audio.
3. `#routeHeard` (`1604-1686`) shows the user's line, sets THINKING, starts the narration poll and calls the `heard` relay (a server action), passing `cardInFocus` from the page.

Server (`broker.heard`, `broker.ts:816-855`; `routing.ts:167-183`):

```
guided || awaitingApproval      -> ASK_Q
cardInFocus && words <= 12      -> MODEL
isSmallTalk(words)              -> SMALLTALK   (<=7 words, all from TRIVIAL list/phrases)
otherwise                       -> ASK_Q
```

- ASK_Q: the broker runs `askQ` *inside the heard request* and returns `{route, callId, arguments, output, approvalPending, silent?}`.
- SMALLTALK / MODEL: returns `{route}` only.

Browser on the result (`duplex-line.ts:1636-1685`):

| Result | What the browser does | Who speaks |
|---|---|---|
| `null` (relay failed/404) | `#forceAskQ()` | model → its own ask_q (§6.2) |
| `route ≠ ASK_Q` | `response.create` (default tool choice) | **realtime model, without Q**, unless it chooses to call ask_q / decide_card |
| `silent: true` | state LISTENING; nothing sent | nobody |
| rejoining / transport changed | queued if rejoining; **dropped** if the rejoin already finished | nobody (defect, §13 C) |
| otherwise | inserts `function_call` + `function_call_output` items, then `response.create {tool_choice:"none"}` after any bridge (`afterBridge`, hold ≤ 2.5 s) | realtime model voices Q's output |

### 5.2 Duplex, unrouted (`CQ_VOICE_REALTIME_ROUTE_TURNS=off`)

The provider creates a response on every turn (`create_response:true`), and the model decides whether to call `ask_q` per `DUPLEX_CONDUCT`. PARTIAL / not the default.

### 5.3 Standard line

Deepgram sends the whole conversation to `/v1/q/voice/think/chat/completions` (`providers/deepgram.ts:131`, `237-244`). The think route (`think.ts:150-397`): restores the binding from the bearer, de-duplicates re-asks of identical words, aborts the older think on a grown utterance, passes the think gate, runs `turn(...)` and streams each sentence as an OpenAI chat-completion SSE delta (`353-366`), with empty keep-alive deltas every 5 s (`330-336`) and a 20 s deadline that speaks `TURN_TOO_LONG` / `TURN_CUT_SHORT` (`55-59`, `339-347`). No LLM runs in Deepgram's think: `THINK_PROMPT` tells it to relay (`providers/deepgram.ts:107-108`).

### 5.4 The shared voice turn handler (`apps/q-api/src/voice/turn.ts:1857-2174`)

Both lines call the same handler (duplex via `broker.askQ` → `turn(...)`, `broker.ts:528-535`). Paths that end with **nothing said** (`{kind:"NOTHING"}`): no user text or already aborted (`1864-1866`); aborted during the unfinished hold (`1913`); Q's own words echoed while an approval waits (`1944-1951`); a non-lexical utterance with nothing paused (`2089-2090`). Otherwise: pending approval reading (`1938-2035`), recognition question (`2037-2078`), a parallel turn-reader read to detect "stop voice" (`2108-2131`), then exactly one owner: WELCOME / INTERVIEW / `askQ` (`2150-2156`).

`askQ` (`turn.ts:982-1453`) creates a Q run (`capability ANSWER`, `modality VOICE`, `turn.ts:1017-1039`), optionally autostarts orchestration, then streams the run's events: `q.message.delta` → `speakable` sentence (`1116-1166`); `q.message.completed` → room publish, board navigate/clientAction/presence, facts or `speakable(text)` (`1168-1243`); `q.input.required` → question (+ random "Hm?" 50%) (`1245-1255`); `q.approval.required` → "{summary} Shall I go ahead?" and stop (`1262-1277`); `q.run.failed` → notice unless already spoken (`1278-1298`). All of it is wrapped in the silence ladder (`1358-1382`).

Inside the run, the TURN_READER decides; spoken unclear turns get **SILENT** and spoken turns not addressed to Q get no answer (`packages/q-specialists/src/answer.ts:2426-2462`). TURN_READER v44's `heardAs` re-reads garbled speech once per run when the latest message has an `utteranceRef` (`answer.ts:2340-2378`).

---

## 6. ask_q into the Q brain

### 6.1 Server-routed (heard)

`broker.heard` → `askQ(line, words, signal)` (`broker.ts:839-844`) → `collectingSpeaker` (`349-389`) collects everything `turn(...)` would have spoken (`deferred:true`, `narrate` → narration queue) → the answer is post-processed:

- `outcome INTERRUPTED` or aborted → `{ok:false, interrupted:true}` (`547-549`).
- `heldFacts()` → `askQFactsOutput` (`550-554`). **Unreachable in production** (finding 2).
- `forRealtime(said)` strips stage directions and written laughs (`111-122`); empty → `{ok:true, say:""}` + `silent:true` (`555-559`).
- Approval pending when `said.endsWith("Shall I go ahead?")` → `line.awaitingApproval` (`560-561`).
- Exceptions → `{ok:false, error:"That didn't go through on my side."}` (`568-576`).

No deadline: the standard line's 20 s `TURN_DEADLINE_MS` lives in `think.ts` only; `broker.askQ` waits for the turn indefinitely (abort only when the HTTP reply closes, `duplex/routes.ts:101-104`). The api-client `call()` has no timeout either (`packages/api-client/src/request.ts:27-63`).

### 6.2 Model-initiated (tool)

The realtime model calls `ask_q` (MODEL/SMALLTALK turns, forced ask_q, decide_card redirect) → `#relayTool` (`duplex-line.ts:1416-1534`) → `relayDuplexToolAction` → `POST .../duplex/tool` → `broker.tool` → `askQ(line, request, abort)` with the **model's words**, not the transcript (`broker.ts:928-945`). The result must parse as `QVoiceDuplexToolResultSchema` (strict) → silent results throw (finding 1).

---

## 7. Silence ladder, bridges, backchannel

- **Silence ladder** (ADR 0062): `withSilenceLadder` (`apps/q-api/src/voice/narration.ts:77-156`) wraps the answer stream; beats start at `toneAtMs` 700 ms, stage line at 1,500 ms, progress at 4,000 ms (`packages/contracts/src/q/silence-ladder.ts:27-30`). Standard line: beats are yielded as text into the think stream (spoken by TTS, stripped from the transcript by `wire.stripSilenceBeats`, `deepgram-session.ts:422-436`). Duplex: beats go to `narrate` → the broker's narration queue (`broker.ts:510-519`) → the browser's long poll `/api/q-voice-narration/:id` (a route handler, not a server action: `narration-poll.ts:5-25`) → `#sayBeat` sends an out-of-band `response.create` with "Say exactly this, warmly and quietly, and nothing else: …" (`duplex-line.ts:1905-1919`). A beat is skipped while Q is speaking or a response is active (`1907`).
- **Bridges**: only when there is no narration relay (`duplex-line.ts:1439-1450`), so in the composed app (narration present, `duplex-session.ts:140`) model bridges are CONFIGURED-UNUSED; BRIDGE_INSTRUCTIONS are still minted (`broker.ts:718-719`).
- **Backchannel**: local pause detector + `BackchannelPolicy` → manual commit → out-of-band audio-only response (`conversation:"none"`, `tools:[]`, max 40 tokens, gain 0.6) (`duplex-line.ts:1752-1808`, `1941-1964`, `107-111`). Cut on overlong text (>4 words) or when the person resumes (`2025-2035`, `1706`).
- Out-of-band audio plays at volume 0 if `#speakingSilenced` is still set from a barge-in or a cut (`duplex-line.ts:2010-2015`; it is cleared only by a main response, `1239-1244`, `1329-1331`, `1349-1350`). Minor, verified.

## 8. Spoken-facts layer

Design: code-built answers (`spokenFactsOf`, `turn.ts:1207-1223`) are said from facts: duplex hands `facts` to the voice (`speakInYourOwnWords`, `broker.ts:131-142`); the standard line rewrites them with the SPOKEN_REPLY task (`turn.ts:955-979`; prompt `packages/q-core/src/prompts/tasks/spoken-reply.v1.ts:19-47`, `FAST_CLASSIFICATION`). Actual (production composition): both lines take the SPOKEN_REPLY rewrite because `timedSpeaker` drops `facts` (finding 2). The duplex voice then gets `{ok:true, say:<rewrite>}` and is told to say it faithfully. Status: **BROKEN on duplex** (the fix is inert), IMPLEMENTED on standard.

## 9. Every point where the realtime model is told to speak

| # | Trigger | Code | Instructions / tool choice | Q involved? |
|---|---|---|---|---|
| 1 | Line opened with an opener | `speakFirst`, `duplex-line.ts:1070-1083` (called `duplex-session.ts:213`) | "Say exactly this … word for word, and nothing else", `tool_choice:none` | Opener text from server/web |
| 2 | Routed ASK_Q answer | `duplex-line.ts:1678-1685` | session instructions; `tool_choice:none` | Yes |
| 3 | Routed SMALLTALK / MODEL | `duplex-line.ts:1643-1646` | session instructions; auto tools | **No**, unless the model calls ask_q |
| 4 | Forced ask_q (no transcript / heard failed) | `duplex-line.ts:1594-1602` | `tool_choice: {function: ask_q}` | Yes (model's paraphrase) |
| 5 | Tool result (ask_q, decide_card, set_listening) | `duplex-line.ts:1529-1533` | session instructions; auto tools | Yes for ask_q |
| 6 | Card note with `respond` | `note`, `duplex-line.ts:830-843` | system item + `response.create` | No (screen note) |
| 7 | Results after a rejoin | `duplex-line.ts:798` | system item "Result of the request…" | Yes |
| 8 | Narration beat | `duplex-line.ts:1905-1919` | out of band, "Say exactly this…" / hum | Fixed beat text |
| 9 | Bridge (only with no narration relay) | `duplex-line.ts:1922-1939` | out of band, BRIDGE_INSTRUCTIONS | No |
| 10 | Backchannel | `duplex-line.ts:1769-1808` | out of band, BACKCHANNEL_INSTRUCTIONS | No |
| 11 | Unrouted lines | provider `create_response:true` | session instructions | Model decides |

---

## 10. Output

### 10.1 Duplex
- Voice: OpenAI `marin` (FEMALE) / `cedar` (MALE) (`openai.ts:59`, `139-149`), `speed` 0.95 by default (`config.ts`), `output_modalities:["audio"]`, `max_output_tokens` 800 per response (`openai.ts:97-98`).
- Transport: WebRTC Opus into one `<audio autoplay>` element (`duplex-line.ts:312-316`, `597-612`); playout buffer target 150 ms, or 400 ms on a WEAK line (`161`, `278`, `606-610`).
- Cancellation/truncation: `response.cancel`, `output_audio_buffer.clear`, `conversation.item.truncate` with `audio_end_ms` from local playback start (`1211-1237`).
- Transcript of Q: `response.output_audio_transcript.done` → UI line + `said` relay (`1376-1396`).

### 10.2 Standard
- Deepgram agent → `POST /v1/q/voice/speak` (bearer = per-session think token) → ElevenLabs stream (`routes.ts:396-548`). Model order: `eleven_v3_conversational` → `eleven_turbo_v2_5` when v3 errors or has no first byte in `FIRST_AUDIO_DEADLINE_MS` = 1.2 s → Deepgram Aura-2; ElevenLabs is rested 60 s after 3 failures (`providers/elevenlabs-speak.ts` header and constants, `~48-148`). Voices: account voices "Sarah" (FEMALE) and "Daniel" (MALE); ids are public voice ids and are not reproduced here. Voice settings stability 0.5, similarity 0.75, style 0, speaker boost (`elevenlabs-speak.ts:157-162`). Without ElevenLabs the agent uses Aura-2 `aura-2-thalia-en` / `aura-2-orion-en` (`providers/deepgram.ts:20-23`).
- Text is sent sentence by sentence (`think.ts:353-366`); `RELAY_MAX_CHARS` bounds a request (`routes.ts:436`).
- Browser playback: PCM16 24 kHz into our `PcmPlayer` on one Web Audio timeline: prebuffer 180 ms, max wait 250 ms, min start 80 ms, underrun doubles the buffer up to 1 s (`pcm-schedule.ts:69-78`); barge-in `player.interrupt()` (`deepgram-session.ts:493`); `agent-audio-done` flushes (`538-556`).

---

## 11. Capability matrix

| Capability | Duplex | Standard | Evidence |
|---|---|---|---|
| Full duplex (talk over Q) | IMPLEMENTED (browser-confirmed barge-in) | IMPLEMENTED | `duplex-line.ts:1185-1237`; `deepgram-session.ts:475-499` |
| Barge-in | IMPLEMENTED; instant (unconfirmed) during generation | IMPLEMENTED; cough repair | above |
| Thinking while speaking | PARTIAL: narration beats and backchannel are out of band; the answer itself is not interleaved | PARTIAL: ladder beats precede the answer | §7 |
| Tools mid-call | IMPLEMENTED via ask_q/decide_card/set_listening; direct read tools CONFIGURED-UNUSED | IMPLEMENTED through Q run | `broker.ts:733-740` |
| Async results | PARTIAL: results that arrive while rejoining are queued (`1503-1506`, `1654-1657`); results after a newer turn are not guarded (§13 G) | Held answers resumed on "go on" (`turn.ts:1394-1448`) | |
| Resumption / rejoin | IMPLEMENTED (replay of last 8 lines × 400 chars, `duplex-line.ts:155-156`, `767-799`) | Reconnect on the same thread with `resume:true` (`use-voice-interview.ts:236-287`); bindings sealed in tokens | |
| Server state survives restart | **No**: broker `lines` is an in-process `Map` (`broker.ts:453`) | Yes (sealed binding, `routes.ts:785-798`) | |
| Transcript sync | PARTIAL (§12) | PARTIAL | |
| Presence levels | **MISSING** (0) | IMPLEMENTED | `duplex-session.ts:246-248`; `deepgram-session.ts:762-771` |
| Thinking watchdog | **MISSING** | IMPLEMENTED 14 s | `deepgram-session.ts:358-368` |

## 12. Transcript sync: `voice_line_turns` vs `conversation_messages`

- `q_runtime.voice_line_turns` (duplex only): USER row on `openTurn` (`broker.ts:616-634`), Q row on every `said` (`857-916`); insert `transcript.ts:65`. Server-only; never read by a browser.
- `conversation_messages`: ASK_Q turns go through a Q run (`turn.ts:1017-1039`), which stores the user's message and Q's text answer (and a `:heard` row when re-read, `answer.ts:2355-2367`). Model-only turns are mirrored via `recordSpokenExchange` **only when the binding already has a `conversationId`** (`broker.ts:894-912`).
- Divergences (verified unless noted):
  1. Q's spoken words on duplex are the realtime model's rendering of `say`/facts; `conversation_messages` holds Q's written answer. The UI transcript shows the spoken version; the chat thread the written one.
  2. On a fresh conversation, the first USER row is written before the run creates the conversation (`openTurn` before `askQ`; `thread.conversationId` is set inside `turn.ts:1041`), so it has `conversation_id` NULL; small talk before the first ask_q is never mirrored.
  3. `said` attributes a Q transcript to whatever `line.turn` is current (`broker.ts:863-870`) and then clears it (`914`). A late transcript from the previous response, arriving after the next turn opened, is filed against the new turn and pushed into `line.history` paired with the new user words (`883-893`). Hypothesis on timing.
  4. Forced ask_q shows the model's paraphrase as the person's line (`duplex-line.ts:1433-1435`).
  5. SILENT turns: the user message is stored by the run; nothing from Q (`answer.ts:2455-2462`). After a silent answer the next ask's transcript has two trailing user turns, so `utteranceRefOf` returns the *same* utterance ref for both (`utterance.ts:28-40`), and the newer turn supersedes the older stored message. Hypothesis about downstream effect.

---

## 13. Failure tracing A–I

Each item lists the code path and whether it is **verified** (code read end to end; probe or test where stated) or a **hypothesis** (possible by the code; occurrence not observed).

### A — Speech captured, never submitted
| # | Path | Line | Status |
|---|---|---|---|
| A1 | Short real words over audible Q (< 450 ms, e.g. "no", "stop") are treated as a blip: Q un-ducks and the committed item is **deleted** | `duplex-line.ts:1272-1277`, `1199-1208`, `1285-1291` | Verified (by design); loss of short replies is the effect |
| A2 | `dropNextCommit` is cleared only by a commit; if the blip produced no commit, the **next real turn's** commit is deleted | `duplex-line.ts:1204`, `1285-1291` | Hypothesis (needs a speech_stopped without commit) |
| A3 | Transcript empty (not timed out) → treated as noise, LISTENING, nothing routed | `duplex-line.ts:1319-1323`, `1582-1587` | Verified |
| A4 | A backchannel commit that lands after `COMMIT_WAIT_MS` (400 ms) is treated as the end of the turn → a fragment is routed; the rest becomes a new turn whose routed text excludes the already-routed items | `duplex-line.ts:1294`, `1301-1303`, `1546-1552`, `1757-1762` | Hypothesis (timing) |
| A5 | `#turnItems` capped at 3; with NATURAL listening (up to 5 reactions) the earliest items of a long turn are shifted out and never routed | `duplex-line.ts:137`, `1296-1297`, `1544-1550`; `backchannel.ts:54-60` | Verified logic; only NATURAL level |
| A6 | Mic paused away (tab hidden / 10 s blur) — only the person's own unmute resumes | `use-voice-session.ts` (`AWAY_BLUR_PAUSE_MS`) | Verified (by design) |
| A7 | Standard: frames before settings applied beyond 256 are dropped | `agent-socket.ts:39`, `180-185` | Hypothesis |
| A8 | Line idle-ended (30 s) — later speech goes nowhere until the person restarts voice | `duplex-line.ts:1153-1175`; `use-voice-interview.ts:249-255` | Verified |

### B — Submitted, never processed
| # | Path | Line | Status |
|---|---|---|---|
| B1 | Broker line unknown on this process (restart, deploy, other replica, swept after idle+60 s): heard/tool/usage → 404 → null → forced ask_q → "did not get through" → usage null ×3 → rejoin 404 → fallback | `broker.ts:453`, `456-463`, `475-486`; `duplex-line.ts:1639-1641`, `2159-2163`, `727-742` | Verified path; occurrence depends on replica count (not inspected) |
| B2 | Server-action queue: heard waits behind any running server action (turn poll, screen post, card actions) and vice versa | Next `app-router-instance.js` `dispatchAction`; `narration-poll.ts:7-8`; `use-voice-interview.ts:577-586` | Verified (framework code read) |
| B3 | Standard: binding released by a newer session (another surface/tab) → think 401 → no reply; browser falls back to LISTENING after 14 s | `routes.ts:809`; `think.ts:191-205`; `deepgram-session.ts:358-368` | Verified |
| B4 | Think gate drops a burst re-ask → empty stream | `think.ts:374-378` | Verified (by design) |
| B5 | Guided/onboarding: interview conductor path | `turn.ts:1456-1603` | Not traced in depth |

### C — Brain answered, never reached TTS
| # | Path | Line | Status |
|---|---|---|---|
| C1 | Model-called ask_q whose answer is silent → strict schema throws → "did not get through" | §1 finding 1 | **Verified + probe** |
| C2 | Routed answer arrives after a rejoin finished → neither queued nor sent; state THINKING | `duplex-line.ts:1654-1658` | Verified |
| C3 | `speakable` reduces a table-only or markup-only answer to "" → `forRealtime` empty → `silent:true` (duplex) / nothing streamed (standard) | `speech.ts:271-305`; `broker.ts:555-559` | Verified logic |
| C4 | `q.run.failed` after deltas streamed → nothing more said | `turn.ts:1282-1292` | Verified (by design) |
| C5 | Standard 20 s deadline: later words discarded, `TURN_TOO_LONG` said | `think.ts:339-347`, `319-324` | Verified |
| C6 | Duplex answer released while `#responseActive` from another response → second `response.create` likely refused by the provider; the `error` event is ignored | `duplex-line.ts:1678-1685`, `1258-1413` | Hypothesis (provider behaviour) |
| C7 | Spoken answer cap `SPOKEN_MAX_CHARS` 1,200 | `speech.ts:12`; `turn.ts:1129-1131` | Verified (by design) |

### D — TTS got input, no audio played
| # | Path | Line | Status |
|---|---|---|---|
| D1 | Speak relay 401 (binding not restorable), 400 (empty / > 2,000 chars), 502 (vendor) | `routes.ts:53`, `404-514` | Verified; browser says "I can't speak out loud right now…" after 10 s (`deepgram-session.ts:59`, `335-349`) |
| D2 | Duplex audio element muted by a stale `#speakingSilenced` for out-of-band audio | `duplex-line.ts:2010-2015`, `2088-2093` | Verified (minor) |
| D3 | Duplex `<audio autoplay>` not attached to the DOM; autoplay policy on Safari/iOS | `duplex-line.ts:312-316` | Hypothesis (not tested by me) |
| D4 | Standard: audio for an interrupted reply discarded for 700 ms; a reply the agent re-starts inside that window is clipped | `deepgram-session.ts:116`, `530-537` | Hypothesis |

### E — Interrupt leaves the line silent
| # | Path | Line | Status |
|---|---|---|---|
| E1 | Noise during answer generation (response created, no audio yet) → immediate barge-in → response cancelled; noise transcribes empty → LISTENING; Q's answer is already in the conversation but never spoken; no repair on duplex | `duplex-line.ts:1265-1266`, `1211-1237`, `1582-1587` | Verified |
| E2 | Barge-in bumps `#generation` → an in-flight routed answer is discarded (`seq/generation` guard) even if the interruption was a cough that produced no turn | `duplex-line.ts:1216`, `1638` | Verified |
| E3 | Standard: cough repair waits 4.4 s of quiet, gives up at 20 s | `deepgram-session.ts:105-108`, `454-474` | Verified (by design) |

### F — Voice state diverges from text state
F1–F5 are in §12. Also: `line.history` keeps only 12 turns (`broker.ts:261`), and `#replay` 8 lines (`duplex-line.ts:155`), so a rejoined call has less context than the chat thread. Verified.

### G — A stale response speaks after a newer question
| # | Path | Line | Status |
|---|---|---|---|
| G1 | `#relayTool` checks `#generation` only; a new turn does not bump it unless Q was audible/responding → an older model-initiated ask_q answer is spoken after (or racing) the newer turn's answer | `duplex-line.ts:1421`, `1528-1533`, `1611-1612` | Verified logic |
| G2 | `#relayTool` bridge/narration timers use `generation` too (`1444`, `1440`) | same | Verified |
| G3 | Standard: superseded runs cancelled (`turn.ts:701-706`, `1883`) | — | Guarded |

### H — Looks healthy but stalled
| # | Path | Line | Status |
|---|---|---|---|
| H1 | Duplex has no THINKING watchdog: any response that never produces audio (cancelled, failed, refused, function-call-only, C2) leaves "Thinking" until the person speaks again | `duplex-line.ts:1281`, `1616`; no timer found in file | Verified |
| H2 | Duplex presence levels are 0: the orb does not react to the mic or Q's voice | `duplex-session.ts:246-248` | Verified |
| H3 | Long ask_q with no deadline holds "Thinking" and the server-action queue (cards don't update) | `broker.ts:528-535`; B2 | Verified |
| H4 | Silent turn → "Listening", nothing said | `duplex-line.ts:1647-1652`; `answer.ts:2448-2449` | Verified |
| H5 | Standard: socket open but agent never applied settings → 10 s then error | `deepgram-session.ts:57`, `370-382` | Guarded |

### I — Swallowed errors
| # | Path | Line | Status |
|---|---|---|---|
| I1 | Realtime `error` events: no case; dropped | `duplex-line.ts:1411-1412` | Verified |
| I2 | `response.done` status `failed`/`cancelled`/`incomplete` not read for main responses | `duplex-line.ts:1400-1410` | Verified |
| I3 | `conversation.item.input_audio_transcription.failed`: no log | `duplex-line.ts:1326-1328` | Verified |
| I4 | All duplex server actions convert any error to `null` with no log | `duplex-actions.ts:53-57`, `70-74`, `87-91`, `103-107`, `120-124`, `147-151` | Verified |
| I5 | Mint failure class logged only as "duplex voice secret not minted" with `failureClass`; broker logs only `MINT_UNAVAILABLE` | `main.ts:5466-5467`; `realtime/index.ts:300-303` | Verified |
| I6 | `said` relay and transcript writes: errors logged server-side only | `broker.ts:608-613`; `duplex-actions.ts:89-91` | Verified |
| I7 | Turn-reader errors → `null` reading (turn proceeds) | `turn.ts:1843`, `2129` | Verified |

## 14. The founder's complaint: "it's just listening and not doing anything"

Ranked by how directly the code produces exactly that experience.

1. **Q chose silence** (verified). A spoken turn the TURN_READER reads as unclear, or not addressed to Q, gets no answer (`answer.ts:2426-2462`). Duplex: `silent:true` → the browser sets LISTENING (`duplex-line.ts:1647-1652`). Standard: empty think stream; "Thinking" for up to 14 s, then "Listening" (`deepgram-session.ts:358-368`). The 11:13 live call shows the transcription half of this (garbled → UNCLEAR → SILENT); v44 `heardAs` now re-reads it once, but a turn read as not addressed to Q or still unclear stays silent by design.
2. **Model-called ask_q with a silent answer errors out** (verified, finding 1). The voice then says "that didn't go through"; it is not silence, but it is "not doing anything".
3. **Duplex line idle-ends at 30 s** (verified) with no notice: if the person reads the briefing cards for 30 s, voice is gone (`duplex-line.ts:1153-1175`; `use-voice-interview.ts:249-255`).
4. **No visual feedback on duplex** (verified): levels 0 (`duplex-session.ts:246-248`). Combined with 1 and 3, the stage shows a calm presence and a state label while nothing happens.
5. **Stuck THINKING on duplex** (verified paths C2, E1, H1). No timer returns it to listening or tells the person.
6. **Answers in flight but queued** (verified B2/H3): the heard relay blocks the turn poll, so cards and navigation from the answer appear late; the spoken answer itself waits for the whole Q run (deferred speaker), filled only by narration beats.
7. **The realtime model answers alone** on SMALLTALK/MODEL turns (verified, `duplex-line.ts:1643-1646`), so "find anything that needs my attention" while a briefing card is in focus (6 words ≤ 12) goes to the voice model and `decide_card`, not to Q (`routing.ts:181`). The model may then call ask_q with its paraphrase (path 2) or improvise.
8. **Q answered but said "nothing is waiting"** (lead's 12:xx standard-line test): content-level; the voice delivered what the run produced. Out of my area (Q answer correctness), noted for the brain investigators.

The hypothesis "it's only going to voice models or not reaching the code" is **partly true**: SMALLTALK/MODEL turns, forced ask_q, decide_card redirects and every bridge/backchannel/beat are produced by the realtime model without a Q run; but every turn routed ASK_Q does reach `turn.ts` and a Q run (log lines "duplex user turn routed" `broker.ts:625-633`, "q turn read" `answer.ts:2337`, "voice turn timed").

## 15. Latency instrumentation

What exists (no numbers invented; none were measured by me):

| Signal | Where | Scope |
|---|---|---|
| "voice turn timed": reasoningStart/End, firstText, end, ttsRequest, firstAudio, per-step model/api/memory timings, speculation | `turn-timing.ts:14-48`, `143-200`; wraps every voice turn incl. duplex ask_q (`main.ts:5383`) | Server log. On duplex `firstTextMs` is when text was *collected*, not spoken; ttsRequest/firstAudio do not apply |
| Speak relay timing: which engine served, first byte, fallback | `turn-timing.ts` `SpeechTiming`; `elevenlabs-speak.ts` (`timings`) | Standard line only |
| Duplex first-audio per turn (speech_stopped → output_audio_buffer.started), p50/max, rejoins, weak seconds, worst loss/jitter/RTT | `duplex-line.ts:1342-1348`, `862-883`; sent with the end call and logged "duplex voice line ended" (`broker.ts:1141-1158`) | Once per line, at the end; lost if the line never ends cleanly |
| "duplex user turn routed" (routed, word count, typed) | `broker.ts:625-633` | Per turn, no timing |
| Deepgram latency report (stt/think/tts/total) | `deepgram-session.ts:507-514` | **Browser console only** |
| Playback stats, mic heartbeat | `deepgram-session.ts:297-316`, `544` | Browser console only |
| Usage per response (cost) | `ai_ops.model_usage` purpose VOICE_REALTIME with `latencyMs: 0` (`realtime/index.ts:323-324`) | Cost only |

Missing: duration of the `heard` relay (server action + ask_q) per turn; transcript-wait time (`TRANSCRIPT_WAIT_MS` hits); server-action queue wait; time from `heard` result to first audio; any per-turn duplex timing that survives a line that does not end cleanly; browser-side latency persisted anywhere for the standard line; a correlation id linking the browser turn, the `heard` request and the Q run.

## 16. Why it can sound mechanical

1. **Verbatim instructions.** The opener is sent as "Say exactly this to the person, word for word, and nothing else" (`duplex-line.ts:1077`) and the session instructions repeat it (`instructions.ts:213`); narration beats are "Say exactly this, warmly and quietly, and nothing else" (`duplex-line.ts:1914`). Q's answers arrive as `say` with "say that faithfully" (`instructions.ts:113`).
2. **Facts path inert.** The "say it in your own words" path (SPEAK_FROM_FACTS) never reaches the duplex model (finding 2); it reads a rewrite produced by another model call, which adds latency.
3. **Heavy negative conduct.** DUPLEX_CONDUCT forbids lead-ins ("never open with sure / got it / okay"), caps turns at three sentences and bans asking leave (`instructions.ts:117-121`); BACKCHANNEL forbids agreeing words (`165`). The model is a reader with few natural moves left.
4. **`speakable()` flattening** (`speech.ts:271-305`): bullets and numbered markers removed so list items run together; table rows deleted; links reduced to hostnames; 1,200-char cap.
5. **Standard line**: sentence-by-sentence TTS requests (`think.ts:353-366`) restart prosody each sentence; v3 → turbo fallback after 1.2 s changes engine mid-answer (`elevenlabs-speak.ts` constants); voice settings stability 0.5 / style 0 (`157-162`).
6. **Speech rate 0.95** and "relaxed, unhurried" pacing instructions (`config.ts`, `instructions.ts:124-129`).
7. The random "Hm?" before clarification questions (50%, `turn.ts:385`, `1249-1251`) and a written-laugh replacement (`turn.ts:1137-1165`) are scripted reactions.

Sanitized prompts: `evidence/voice/instructions-prompts.md` (DUPLEX_CONDUCT, LISTENING, BACKCHANNEL, BRIDGE, GUIDED, assembly; SPEAK_FROM_FACTS_V1). They contain no secrets.

## 17. Checks run

- Targeted vitest from the repo root with provider keys set to `disabled-locally-000000000000`:
  `apps/q-api/test/duplex-voice-broker.test.ts`, `duplex-voice-routes.test.ts`, `duplex-transcription-hint.test.ts`, `voice-turn-timing.test.ts`, `apps/web/test/voice-duplex.test.tsx`, `voice-duplex-fallback.test.tsx`, `voice-barge-in.test.tsx` → **7 files passed, 131 tests passed**. None covers the `/duplex/tool` route with a silent ask_q, or the broker composed with `timedVoiceTurns`.
- Probe: `QVoiceDuplexToolResultSchema.safeParse({output, approvalPending:false, silent:true})` → `success:false`, `unrecognized_keys ["silent"]`. (A temporary `.mjs` file was created under `apps/q-api/` to resolve the workspace package and deleted immediately; no source changed.)
- No live provider calls, no builds, no database access.

## 18. Not inspected / limits

- ElevenLabs Speech Engine transport (`elevenlabs-session.ts`, `providers/elevenlabs.ts`, `attach.ts`) beyond headers; interview/onboarding voice (`interview-agent.ts`, `onboarding-*.ts`, `interview-steps.ts`); rehearsal voice; one-way TTS (`use-q-speech.ts`, `synthesis.ts`); `bindings.ts` sealing; `think-gate.ts` internals; `elevenlabs-speak.ts` stream implementation beyond constants; `voice-stage.tsx` rendering; arrival-briefing voice opener (lead fixed today).
- Production env values (`CQ_VOICE_REALTIME*`, caps, replica count, Vercel function limits) are not visible here.
- The Next.js server-action serialisation is read from `next@16.3.4` client code; whether the briefing page issues other server actions during a call was not enumerated.
