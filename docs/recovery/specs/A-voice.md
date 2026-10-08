# A — Voice: every accepted turn ends, naturally spoken

Workstream A of RECOVERY-2026-10. Owner paths: SPEC §2 row A. Baseline `fe5579c3` (integration branch `recovery/2026-09-12-8y2j4w`). Audit references are to `capital-q-audit/04-VOICE-SYSTEM.md` (§n) and `_findings/C.md` (C-nn); line numbers are at the baseline.

## 1. Research

| Topic                             | Source                                                                                                                       | What it means here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sideband control of a WebRTC call | <https://developers.openai.com/api/docs/guides/realtime-server-controls> (read 2026-10-08)                                   | The SDP answer's `Location` header is `/v1/realtime/calls/rtc_…`; the last segment is the call id. A server attaches with `wss://api.openai.com/v1/realtime?call_id={callId}` and `Authorization: Bearer <API key>`. It receives the call's events and can send `session.update` and answer tool calls. The page does not document `response.create`/`conversation.item.create` on the WebRTC sideband explicitly (it does for GPT-Live `response.item.create`), gives no reconnect guidance, and says: if both connections receive a function call, execute it once; keep credentials server-side; store history collected before attaching. |
| Community reports (SPEC §1)       | lead summary                                                                                                                 | The sideband may drop after long silence (reconnect needed). The sideband does not control playback: the browser must still stop audio on barge-in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Interruption                      | SPEC §1                                                                                                                      | Stop local playback first, then `response.cancel`, then `conversation.item.truncate` with `audio_end_ms` clamped to audio actually played. Already the order in `duplex-line.ts:1211-1237`.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `semantic_vad`                    | SPEC §1                                                                                                                      | `interrupt_response` reportedly unreliable: keep the browser-confirmed barge-in (`interrupt_response:false`, `duplex-line.ts:1056`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Next.js server actions            | `next@16.3.4` `app-router-instance.js` `dispatchAction`/`runRemainingActions`; acknowledged `provider/narration-poll.ts:7-8` | Actions run one at a time per client. Route handlers (`fetch`) do not queue.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Node WebSocket with headers       | undici `WebSocket(url, { headers })` (Node ≥22 global)                                                                       | Server can attach without a new dependency; injected as a factory so tests use a fake.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 2. Current behaviour (verified at baseline)

- **C-01** `broker.askQ` adds `silent:true` (`apps/q-api/src/voice/duplex/broker.ts:556-558`); `broker.tool` returns it for ask_q (`:944`); `/duplex/tool` parses with the strict `QVoiceDuplexToolResultSchema` (`duplex/routes.ts:86`, `packages/contracts/src/q/voice.ts:432-441`) → throws → action `null` → "did not get through" (`duplex-line.ts:1496-1502`).
- **C-02** `timedVoiceTurns` builds a speaker without `facts` (`apps/q-api/src/voice/turn-timing.ts:369-395`), so `turn.ts:951` never sees it in production (`main.ts:5383`).
- **C-03/B-01** `routing.ts:178-182`: card in focus + ≤12 words → MODEL; small talk includes `yes`/`no`/`i`. Browser: `route ≠ ASK_Q` → bare `response.create` (`duplex-line.ts:1643-1646`); `silent` → LISTENING with nothing shown (`:1647-1652`).
- **A4 / C-06** No `error` case in the dispatcher (`duplex-line.ts:1258-1413`); `response.done` status unread (`:1400-1410`); no THINKING watchdog. Standard line: 14 s watchdog falls back to LISTENING silently (`deepgram-session.ts:358-368`).
- **C-04** Routed answer dropped when transport changed and rejoin already finished (`duplex-line.ts:1654-1658`).
- **C-05** `#relayTool` guards on `#generation` only (`:1421`, `:1528-1533`).
- **C-07/C-11** `speech_started` while a response is generating barges in at once (`:1265-1266`); empty transcript → LISTENING (`:1582-1587`); <450 ms speech over Q is a blip and its commit deleted (`:1199-1208`, `:1285-1291`).
- **C-08** All duplex relays are server actions (`duplex-session.ts:135-143`, `duplex-actions.ts`); `heard` holds for the whole ask_q with no deadline (`broker.ts:528-535`).
- **C-09** `inputLevel`/`outputLevel` return 0 (`duplex-session.ts:246-248`). **C-10** idle end is silent (`duplex-line.ts:1153-1175`, `use-voice-interview.ts:249-255`).
- **C-16** broker `lines` is an in-process `Map` (`broker.ts:453`); standard bindings are sealed (`bindings.ts`, `routes.ts:785-798`).
- **C-17** opener "Say exactly this … word for word" (`duplex-line.ts:1077`, `instructions.ts:213`); beats "Say exactly this" (`:1914`); `say` "faithfully" (`instructions.ts:113`); `speakable` flattens lists, drops tables, 1,200-char cap (`speech.ts:12`, `:271-305`).
- **Route changes.** The line lives in `useVoiceInterview` inside `QSessionProvider` (`features/q/q-session.tsx:233`) inside `GlobalQProvider`, mounted once by `AppShell` in `app/(app)/layout.tsx`. Both `AppShell` branches render `GlobalQProvider` at the root position, so navigation inside `(app)` keeps the provider and the line (verified by reading; no remount).

## 3. Design

### 3.1 Turn disposition on the duplex line (A1, A3, A4)

- Contract (`voice.ts`, A-owned): `QVoiceDuplexToolResultSchema` and the ASK_Q heard result gain optional `silent` and `disposition` (`QTurnDispositionSchema`) and `failure` (`QFailureClassSchema`). Strict schemas stay strict.
- Broker: `askQ` returns `disposition` (ANSWERED, ACTED when an approval/action is pending, CLARIFIED when Q asked back, IGNORED when silent, CANCELLED when interrupted, FAILED+TOOL_FAILED/TIMEOUT on error or deadline).
- Browser `DuplexLine` gets one turn ledger: each turn opened (routed, typed, forced ask_q, model tool call) gets a `turn_…` id and must be closed exactly once through `#settle(turnId, outcome)`, which emits `onTurnOutcome` and logs latency. Closed by: audio started for its answer (ANSWERED), `response.done` without audio (FAILED/RESULT_DELIVERY + repair line), realtime `error` (FAILED), silent result (IGNORED, shown as a visible line "Not answered — that didn't sound meant for me. Say it again if it was."), newer turn (SUPERSEDED), barge-in (CANCELLED), watchdog (FAILED/TIMEOUT, spoken repair "Sorry, that took too long — ask me again?").
- Watchdog: `THINKING_WATCHDOG_MS` (20 s, beyond the server's ask_q deadline) on every open turn; reset by narration beats.
- `onTurnOutcome` flows to `VoiceSessionEvents` → `useVoiceInterview` sets a short visible `turnNotice` for IGNORED/FAILED.
- Standard line: the think route records the turn's disposition on the turn board (`turn-board.ts`, `QVoiceTurnState.outcome`, optional); the browser's existing 1.5 s poll shows IGNORED/FAILED immediately instead of a silent 14 s watchdog; the 14 s watchdog itself now reports FAILED/TIMEOUT visibly.

### 3.2 Routing (A3, C-03/B-01)

- `routeDuplexTurn`: card in focus routes MODEL only when the words are a card reply (`isCardReply`: send/approve/skip/later/dismiss/ignore/edit/change/warmer/book/not now/next/yes/no and short forms, ≤12 words, and no question form about other things); anything else → ASK_Q. Greeting-only small talk stays SMALLTALK; bare `yes`/`no`/`i` move out of small talk (a reply to Q's question is Q's).
- Browser: on SMALLTALK the voice gets `response.create` with `tool_choice:"none"` and a per-response instruction "reply to the pleasantry in a few words; no facts". On MODEL it is restricted to `decide_card` (`tool_choice: {type:"function", name:"decide_card"}`). The model never composes a business answer.
- SILENT: never `response.create`; disposition IGNORED, shown. (B owns `answer.ts` SILENT; request: return a reason so voice can choose IGNORED vs a short repair "Sorry — I didn't catch that." for UNCLEAR. Until B ships it, voice treats silent-with-UNCLEAR-unknown as IGNORED + visible line.)

### 3.3 Result delivery (A5, A6)

- `#routeHeard`: transport changed and rejoin finished → inject as context system item + `response.create` (as `#relayTool` does).
- `#relayTool`: capture `#turnSeq` at call; a newer routed turn makes the result SUPERSEDED (kept on the line, not said).

### 3.4 Barge-in (A7)

- `speech_started` while a response is active but not audible → pending barge (same 450 ms confirm, nothing to duck). A blip leaves the response alone.
- If a confirmed barge-in cancels an un-heard answer and the turn then transcribes empty, the cancelled answer is re-spoken (`response.create` with `tool_choice:"none"`, instruction "continue the answer you were about to give"): the cough repair.
- C-11: a blip whose transcript (once it arrives) contains real words is routed as a turn instead of deleted: the commit is no longer deleted at commit time; it is marked `blip` and decided when its transcript lands (empty → delete item; words → route).

### 3.5 Relay transport (A8, C-08) — decision

- **Decision: deadline-bounded relays over route handlers (default), sideband behind `CQ_VOICE_REALTIME_SIDEBAND=on` (off, not live-verified).**
  - Why: the sideband cannot be exercised from this sandbox (no WebRTC); shipping an unverified transport as default on the core voice path is the riskier choice. The serialization defect is fixed without it by moving relays from server actions to `fetch` route handlers, and the hang is fixed by a server deadline.
- Relays: new route handler `apps/web/app/api/q-voice-duplex/[voiceSessionId]/[relay]/route.ts` (outside A paths; thin, mirrors `q-voice-narration`; listed as a request). `duplex-session.ts` uses `duplexRelaysOverFetch` with a client deadline.
- Server deadline: `broker.askQ` races `ASK_Q_DEADLINE_MS` (18 s, config `CQ_VOICE_REALTIME_ASK_DEADLINE_SECONDS`); on expiry the run is aborted and FAILED/TIMEOUT returned with a spoken line.
- Sideband (flag on): the browser reads the call id from the SDP answer's `Location` and posts it to `/duplex/attach`; q-api attaches via `model-gateway/realtime` `attachSideband` (key stays server-side) and runs `duplex/sideband.ts`: server-side usage from `response.done` (de-duplicated with browser reports by response id), `error` and failed `response.done` logged with failure class, per-turn first-audio latency, and **server delivery** of ask_q results (function_call + output + `response.create`) with a stale guard (speech_started after the turn opened → SUPERSEDED). Socket drop → bounded reattach; while detached the browser delivers (heard result carries `delivered:"BROWSER"`).

### 3.6 Presence and idle (A9)

- `DuplexLine.levels()` exposes input RMS (existing meter, now always created) and output RMS (an analyser on the remote stream); `duplex-session.ts` returns them.
- Idle end: before ending, Q says nothing but the UI shows "Voice paused after a quiet minute — tap to talk"; `onEnded("IDLE")` maps to `ended("idle")` in `use-voice-interview`, which sets that notice and keeps the thread for one-tap resume.

### 3.7 Natural delivery (A10, C-17)

- Opener and beats: "Say this opening in your own natural voice; keep every fact and name, change nothing of substance" (no "word for word").
- `say` results: instructions say "say this in natural speech; keep every fact, figure and name".
- `speakable()`: lists become "first, …; second, …" phrasing; tables become "a table is on your screen"; `spokenSummary()` for answers over the cap: the first sentences up to the cap, then "The rest is on your screen." instead of a mid-sentence cut.
- Backchannel left as is (SUBTLE, varied: verified `backchannel.ts`).

### 3.8 Line survives a deploy (A11, C-16)

- Duplex relays carry the sealed `sessionToken` header. When the broker does not know the line, routes restore the binding from the token (`bindings.restore`) and call `broker.adopt(binding)`, which rebuilds the line's plan (firewall, tools, listening, mint request) without minting; the WebRTC call itself never depended on q-api. History restarts empty (the conversation thread keeps it). A line that cannot be adopted returns 404 and the browser falls back with a visible notice.

### 3.9 Latency

- Browser: per turn `turn end → first audio`, `heard` round trip, transcript wait; sent with the turn outcome and logged server-side via the `said`/usage path is not needed: the turn outcome is posted to a new `outcome` relay and logged `duplex voice turn` (ids and ms only).

### 3.10 Agent tasks by voice

- ask_q is the one door: Q's run starts, monitors and talks about agent tasks (D/B own the tools). Voice adds nothing beyond routing every such turn to ASK_Q (verified by the routing tests).

## 4. Files

A-owned: `packages/contracts/src/q/voice.ts`; `apps/q-api/src/voice/{duplex/broker.ts,duplex/routes.ts,duplex/routing.ts,duplex/instructions.ts,duplex/config.ts,duplex/sideband.ts (new),turn-timing.ts,speech.ts,turn-board.ts,think.ts}`; `packages/model-gateway/src/realtime/{index.ts,openai.ts,sideband.ts (new)}`; `apps/web/src/features/voice/{provider/duplex-line.ts,provider/duplex-session.ts,provider/duplex-relays.ts (new),provider/deepgram-session.ts,session.ts,use-voice-interview.ts}`; tests under `apps/q-api/test/` and `apps/web/test/`.

Outside A (requests): `apps/web/app/api/q-voice-duplex/[voiceSessionId]/[relay]/route.ts` (new thin route), `apps/q-api/src/main.ts` (pass `bindings.restore` and sideband config to duplex routes), `packages/api-client` (duplex `attach`/`outcome` calls) — minimal, listed in the report.

## 5. Contracts needed from the lead

None changed in `turn.ts`/`ui-act.ts`; voice imports `QTurnDisposition`/`QFailureClass` as is. B: SILENT reason (UNCLEAR vs NOT_ADDRESSED) on the run result. E: `q-conversation.tsx`/`q-session.tsx` may show `voice.turnNotice` (voice exposes it).

## 6. Tests

- q-api: `/duplex/tool` with a silent ask_q returns 200 (C-01); broker composed with `timedVoiceTurns` returns `speakInYourOwnWords` facts (C-02); routing table (card reply vs card-in-focus question vs greeting vs yes); ask_q deadline → FAILED/TIMEOUT; adopt after restart; sideband with a fake socket (usage, error, server delivery, stale guard, reattach); speakable list/table/summary.
- web: duplex-line fake env: error event → FAILED + repair; response.done failed → FAILED; watchdog; silent → IGNORED shown; transport change → result delivered; relayTool stale → SUPERSEDED; cough during generation → no cancel; cancelled + empty → repaired; short real word routed; idle notice; levels non-zero; standard-line board outcome.

## 7. Risks

- Provider behaviour of `response.create` while another response is active and of the sideband is not live-verified.
- Repair lines are canned sentences; they are short and rare by design.
- Route handler for relays is outside A ownership.

## 8. Acceptance checklist

| Row | Criterion                                                                                                          | SPEC §5 |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------- |
| A1  | Silent ask_q through `/duplex/tool` parses; test                                                                   | H       |
| A2  | Facts reach the voice through `timedVoiceTurns`; test through the wrapper                                          | E, G    |
| A3  | No model-only business answers; card turns only for card replies; SILENT → IGNORED shown                           | E, F    |
| A4  | Every duplex and standard turn ends in one of 7 dispositions; watchdog; error/response.done handled; visible state | H       |
| A5  | Result after rejoin delivered                                                                                      | H       |
| A6  | Stale model ask_q not said                                                                                         | E       |
| A7  | Cough during generation keeps the answer; short real words answered                                                | E       |
| A8  | Relays not serialized; deadline; sideband behind flag, tested with fakes, NOT live-verified                        | H       |
| A9  | Presence levels live; idle end shows a notice                                                                      | E       |
| A10 | No word-for-word instructions; natural summary of long answers                                                     | E, G    |
| A11 | Line adopted on another instance from the sealed token; else visible notice                                        | H       |
