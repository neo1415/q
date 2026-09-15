# ADR 0010 — Realtime voice through a Speech Engine, hosted by the Q API

**Status:** Accepted (CQ-Q-VOICE-001 C, 2026-09-15)

## Context

Capital Q's PADL adopted "Multimodal Intelligence": voice is a way of
talking to the one Q, not a second product. Doc 11 §17 names two voice
paths — dictation (Path A) and realtime conversation (Path B) behind a
provider adapter; doc 12 §7.2 reserves `POST /v1/q/voice/sessions`, §36.2
the `RealtimeVoiceProvider` port, §36.3 ephemeral client credentials, and
§89 rules out a separate voice database. Doc 16 lists TM-VOICE-01..04:
speech is not identity, background audio must not act, a transcription
error must not become fact, and raw audio must not be over-retained.

The realtime path needs a server that receives what a person said and
returns what Q says, in text, fast enough to speak. Q's reasoning, tools,
Context Firewall, retrieval, research, onboarding and approvals already
run in the Q API and the application API. What was missing was a speech
transport that leaves all of that where it is.

## Decision

1. **ElevenLabs Speech Engine is the speech transport, and only that.**
   It owns the microphone (WebRTC to the browser), speech recognition,
   turn detection, interruption and text-to-speech. It never decides,
   retrieves, researches, remembers or acts. Capital Q does not use a
   hosted ElevenLabs agent as a brain.
2. **The Q API hosts the voice channel.** `POST /v1/q/voice/sessions`
   issues an ephemeral, scoped provider credential to a server-resolved
   actor, and the Speech Engine connects back to the Q API on
   `/v1/q/voice/ws` — a WebSocket route on the same HTTP server. This is
   the Q API's first WebSocket, and it is inbound from the provider only:
   browsers never open it. Every upgrade is verified with the provider's
   signed header (`X-Elevenlabs-Speech-Engine-Authorization`); the
   unauthenticated mode the SDK offers is not exposed by the adapter.
3. **The binding is the authority, never the transcript.** The provider's
   conversation id is known when the credential is issued, so the server
   binds it — in process memory, bounded per person and in time — to the
   `ActorContext` and the thread the person is in (a Q conversation and/or
   an onboarding session). When the provider connects with that id, the
   binding names who is speaking; an unknown, expired or already-used id
   is closed. Nothing said into a microphone changes tenant, actor or
   authority (TM-VOICE-01, TM-VOICE-02).
4. **A spoken turn is a typed turn.** An interview answer reaches the
   onboarding runtime's `say` under the person's own bearer, held with the
   binding for the life of the session; a question becomes a Q run with
   `modality: "VOICE"` in the bound conversation and is spoken as its
   event stream arrives. Same validation, same Context Firewall, same
   approvals (doc 11 §17.3, doc 12 §36.4). There is no `voice_*` table,
   no voice memory and no provider-side memory that Capital Q reads back;
   the provider conversation id is integration metadata (doc 12 §89).
5. **Interruption is cancellation through the run's own lifecycle.** The
   provider aborts the turn's signal when the person speaks again; the Q
   run in flight is cancelled via `cancelRun`, a sentence not yet handed
   to the speaker is never spoken, and nothing stale is persisted as an
   answer.
6. **The vendor SDK lives in two adapter files.** `apps/q-api/src/voice/providers/`
   (server) and `apps/web/src/features/voice/provider/` (browser). A lint
   rule (Rule H) refuses `@elevenlabs/*` everywhere else, so Company,
   Investor, Onboarding, Evidence, q-core, contracts and React business
   components see only the `RealtimeVoiceProvider` port.
7. **Configuration, not code, names the environment.** `ELEVENLABS_API_KEY`
   is server-only (`ProviderCredential`, redacted on stringify);
   `ELEVENLABS_SPEECH_ENGINE_ID` / `_MALE` name the two Speech Engine
   resources (one per voice, same WebSocket route); the local tunnel
   hostname is runtime configuration recorded by the setup script in the
   gitignored `.env.local` and never committed.

## Consequences

- Voice sessions are process-local in V1. A multi-instance deployment
  needs a shared binding store keyed by provider conversation id before
  the voice channel can sit behind a load balancer; recorded as a
  follow-up, not a surprise.
- The Q API depends on `@capital-q/api-client` and
  `@capital-q/onboarding/interview` at runtime: the first so a spoken
  interview answer reaches the application API exactly as a typed one
  does, the second so "Where were we?" means the same thing spoken or
  typed.
- Audio retention is minimal by default (`recordVoice: false`,
  `deleteAudio: true` on the Speech Engine resource) per doc 12 §36.6 and
  TM-VOICE-04.
- Live use requires a public `wss://` route in front of the Q API. Locally
  that is an authenticated ngrok tunnel; without one the service still
  starts and simply has no voice.
