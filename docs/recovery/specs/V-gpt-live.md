# V — GPT-Live conversational voice

Owner: workstream V (`build/rec-v`). Founder requirement 2026-10-09: voice quality is the product requirement; the provider is an implementation choice. GPT-Live (`gpt-live-1`) is the voice. Q Brain (the q-api runtime) stays authoritative for facts, records, tools, navigation, Work, approvals and cards. The two are joined by GPT-Live **client delegation**.

## Research (sources)

- OpenAI docs: `guides/live`, `live-delegation`, `live-prompting`, `voice-webrtc?api=live`, `voice-websockets?api=live`. A lead smoke test on 2026-10-09 (`scripts/recovery/live/smoke.mjs`) confirmed the WebSocket endpoint, `session.start`, PCM 24 kHz and Pidgin understanding.
- **WebRTC:** our server makes `POST /v1/live/sessions` with `{session, transport:{type:"webrtc", sdp}}` and gets back `201 {session:{id}, transport:{sdp}}`. The data channel is `oai-events`, created before the offer. There is no `session.start` and no ephemeral secret, so the key never leaves our server. Creating a session bills 15 s up front, credited against duration.
- **Delegation:** `session.delegation.created` carries `{delegation:{id, target:"client"}}` and no request text. We reply with:
  - `session.commentary.append` (spoken, paraphrased);
  - `session.thinking.append` (quiet);
  - `session.instructions.append` (can interrupt).

  Each takes `{event_id, delegation_id|null, content ≤500 tokens}`, acknowledged by `*.appended` with `client_event_id`. Interrupting speech does not stop backend work. Superseded requests must be ignored. Only verified outcomes are reported.

- **Prompt:** an identity line, then a speaking style, then "Backchannel policy", "Interruption policy" and "Delegation policy" (Backend tools / Delegate to the backend when / Do not delegate to the backend when). Describe behaviour; don't script wording.

## Current behaviour (what we reuse)

- The duplex (OpenAI Realtime) line is `apps/q-api/src/voice/duplex/broker.ts`. Its `askQ` runs the standard `VoiceTurnHandler` (`voice/turn.ts:232`) with a collecting speaker (`broker.ts:442`). That single run is where the conversation messages, cards (by run), turn board, navigation receipts and approvals come from.
- Voice sessions are bindings (`voice/bindings.ts:69`) issued by `POST /v1/q/voice/sessions` (`voice/routes.ts`). They can be restored on any instance from the sealed token (`bindings.restore`).
- Spend is the daily realtime cap. `duplex/spend.ts` sums `ai_ops.model_usage` rows with purpose `VOICE_REALTIME`.

## Design

1. **Provider adapter:** `apps/q-api/src/voice/providers/gpt-live.ts`. It implements a `LiveVoiceProvider` port, `createWebRtcSession({session, sdp})`, using fetch only (no SDK). The key is held in closure and never logged. It is a real new adapter, not the realtime adapter with a different model id.
2. **Line:** `apps/q-api/src/voice/live/` holds `config.ts`, `prompt.ts`, `contracts.ts` (our own Zod types), `broker.ts` and `routes.ts`. The broker:
   - attaches to an existing voice-session binding, owned by the caller;
   - checks the Context Firewall plan and the provider ceiling (OpenAI is UNREVIEWED, so PUBLIC unless the deployment is a synthetic demo);
   - checks the daily cap, then exchanges the SDP;
   - records billed seconds as `VOICE_REALTIME` rows ($0.05/min, `ESTIMATED`);
   - enforces a hard duration cap (default 180 s, at most 600 s); after the cap, delegation refuses and the client closes.
3. **Delegation:** `POST /v1/q/voice/live/:voiceSessionId/delegations` takes `{delegationId, request, context}`.
   - **One delegation id → one Q run**, memoised by id: a repeat (a retry, or an interruption followed by a re-send) joins the same promise and never starts a second run.
   - A newer delegation supersedes older ones. Their results are returned `stale: true` and the client does not speak them.
   - The result holds **verified facts only** (`commentary`): Q's facts, or Q's own words as content to paraphrase, with an approval flag.
   - Cards, navigation and approvals arrive through Q's existing run paths, keyed by run.
4. **Client bridge:** `apps/web/src/features/voice/live/bridge.ts`, a pure TS module with no React and no DOM.
   - Keeps a transcript ledger from `input/output_transcript.delta`.
   - Rebuilds the request on `delegation.created`, from the user words since the previous delegation (with the last-answer context, so "the second one" keeps its referent).
   - Sends `thinking.append` progress once, then `commentary.append` with the result.
   - Drops stale and duplicate results.
   - Owns cancellation (it never claims cancelled before the server confirms).

   The harness (Node 24 type-stripping) uses the same module.

5. **Preview:** `/dev/voice-preview`, `notFound()` unless `CQ_VOICE_PREVIEW=on` AND the deployment environment is local or test. The q-api route is gated the same way.
   - A = GPT-Live, B = the existing realtime line, C = ElevenLabs.
   - It shows the provider and model **as reported by the provider's session event**, plus transcripts, latency and billed seconds.
6. **Recordings:** `scripts/recovery/live/harness.mjs` runs over WebSocket with TTS inputs that are clearly marked synthetic. It writes WAVs under scratchpad, plus `docs/recovery/evidence/gpt-live/scorecard.md`.

## Files

New:

- `apps/q-api/src/voice/live/*`
- `apps/q-api/src/voice/providers/gpt-live.ts`
- `apps/q-api/test/voice-live-*.test.ts`
- `apps/web/src/features/voice/live/*`
- `apps/web/app/dev/voice-preview/*`
- `apps/web/app/api/voice-live/*`
- `scripts/recovery/live/harness.mjs`

Hooks into shared files, kept minimal:

- `apps/q-api/src/main.ts`: compose the broker when `CQ_VOICE_LIVE=on`.
- `apps/q-api/src/voice/routes.ts`: register the live routes.

## Contracts from the lead

None needed now. Our types live in `voice/live/contracts.ts` and the web module. Promote them to `@capital-q/contracts` when this line is merged into the product UI.

## Tests (no live calls; keys disabled)

- Adapter: request shape, the key header, a 201 parse, and non-2xx mapped without leaking the body.
- Broker:
  - one id → one run;
  - a duplicate while running joins the run;
  - supersede → stale;
  - the duration cap;
  - the ceiling refusal;
  - another person's line → 404;
  - usage recorded once, as seconds × price.
- Bridge:
  - request rebuild;
  - a late result after a newer delegation is not spoken;
  - an interrupt keeps the run;
  - acks are matched.
- Preview gate: off in production, off without the flag.

## Risks

- WebRTC in the product UI is only previewed (dev page). Wiring it into A's voice UI is a later step, coordinated with A.
- The voice may still paraphrase loosely. Commentary carries `mustSay` facts verbatim, and the prompt forbids inventing.
- History compaction: the app keeps authoritative state (the ledger plus the delegation map).

## Acceptance

- [ ] Adapter and routes, with unit tests green.
- [ ] Bridge, with tests green.
- [ ] Preview page, gated.
- [ ] Ten scenario WAVs, plus B baseline for the key scenarios, plus a scorecard with spend logged.
