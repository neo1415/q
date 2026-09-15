# Q voice — the realtime speech channel

Owner: `apps/q-api/src/voice/` (server), `apps/web/src/features/voice/`
(browser). Decision: [ADR 0010](../adr/0010-realtime-voice-through-a-speech-engine.md).
Packet: CQ-Q-VOICE-001 C-F.

## Where to find it

- **Home** (`/home`): the Q panel shows "Prefer to talk? — Talk with Q" above the thread. Voice joins the conversation the tab is already in and is bound to your company or organisation.
- **Founder / investor setup** (`/onboarding/founder`, `/onboarding/investor`): the same card sits at the top of the Q-led interview, above progress. Q asks the live question aloud; tapping, typing and speaking all reach the same session.

Until the Speech Engine is set up for the environment (see Local development), the button answers "Voice isn't available on this build yet." and nothing else changes.

## What it is

One Q, spoken. ElevenLabs Speech Engine carries the microphone, speech
recognition, turn detection, interruption and text-to-speech; the Q API
carries everything that is Q. A spoken sentence travels the same two paths
a typed one does from the interview thread:

| The person says…                                        | Path                                                                                        | Who has authority                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| an answer to the question Q asked                       | `POST /v1/onboarding/sessions/:id/say` on the application API, under the person's own token | the onboarding runtime (validation, supersede history) |
| a question or a request for Q                           | `createRun` with `modality: "VOICE"` in the bound Q conversation, spoken as it streams      | the Q runtime, Context Firewall, tools, approvals      |
| "Let's stop here." / "Where were we?" / "Let me think." | answered from the session, nothing sent                                                     | —                                                      |

## Surfaces

- `POST /v1/q/voice/sessions` (contract: `CreateQVoiceSessionRequest` /
  `Response`). A protected request; the body may name the thread (a Q
  `conversationId`, `subjects`, an `onboarding` session) and a `voice`
  (`FEMALE` default, `MALE`). The server issues the provider's ephemeral
  conversation credential, binds the provider conversation id to the
  resolved `ActorContext` and the thread, and returns the credential. Never
  the provider API key. 429 when a person already holds
  `VOICE_SESSIONS_PER_USER_MAX` sessions.
- `/v1/q/voice/ws`. The Speech Engine connects here (through the
  environment's public `wss://` hostname). Verified on every upgrade with
  the provider's signed header; `disableAuth` is not offered. `onInit`
  resolves the binding or closes the socket; `onTranscript` runs the turn
  as the bound actor; `onClose` / `onDisconnect` release it.
- Browser: `startVoiceSessionAction` (web server action) → the credential
  and Q's model-composed opening line (`firstMessage`); the ElevenLabs
  client opens the WebRTC session with both. The web adapter lives in
  `apps/web/src/features/voice/provider/`.
- The voice stage (`apps/web/src/features/voice/voice-stage.tsx`): while
  the person talks with Q, the interview screen is Q — a dark field, the Q
  mark breathing with the audio, Q's last words and the person's beneath
  it, options only when the live step is a choice (tap or say), a Type
  toggle, Mute, voice, volume, and "Use the form". Entered from "Talk with
  Q" on the interview or the form; "Use the form" leaves it for the editor
  of the live step. The form's header offers "Back to Q" and "Talk with Q",
  so every mode reaches every other.

## The interviewer (`voice/interviewer.ts`)

Q conducts the interview rather than reading a script. Each spoken turn
renders the `INTERVIEW_CONDUCTOR` prompt (q-core) with the session's known
answers, the open steps with their own kinds and option keys, pending
confirmations, and the recent turns; the model returns Q's words plus what
it read (answers, category phrases, confirmations, skips, the step it asks
next, whether options would help). Deterministic code then validates every
reading against the step (option keys, ranges with k/m/b scaling, text
bounds), holds material values (money, revenue, customers, exclusions) and
MEDIUM-confidence readings as pending until the person confirms, maps
category phrases through `findTaxonomyCandidates`, records through the
onboarding API under the person's own token, and routes a question for Q
to the Q run. The prompt is not the security boundary; the model never
writes to anything. When the model is unavailable, Q says so plainly and
re-asks the current step. Pending confirmations are process-local for now.

## Server modules

| File                                  | Role                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `voice/provider.ts`                   | `RealtimeVoiceProvider`, `VoiceSpeaker`, `VoiceChannelHandlers` — the port; no vendor type crosses it                                      |
| `voice/providers/elevenlabs.ts`       | The ElevenLabs adapter: token issuance (`getWebrtcToken`) and `speechEngine.attach` on the HTTP server. The only runtime import of the SDK |
| `voice/providers/elevenlabs-admin.ts` | Speech Engine resource create/update for the setup script                                                                                  |
| `voice/bindings.ts`                   | Process-local bindings: issue → connect (once) → release; per-person and total bounds; connect window                                      |
| `voice/routes.ts`                     | `POST /v1/q/voice/sessions`                                                                                                                |
| `voice/attach.ts`                     | The channel on the running server: binding resolution, turn dispatch, metrics                                                              |
| `voice/interviewer.ts`                | Q conducting the interview: one `INTERVIEW_CONDUCTOR` turn per utterance, validated and recorded through the onboarding API                |
| `voice/turn.ts`                       | One spoken turn: interviewer turn (or scripted `say` fallback) or Q run; interruption → `cancelRun`                                        |
| `voice/speech.ts`                     | Text as Q speaks it: markdown/citations/URLs stripped, bounded, sentence-chunked                                                           |
| `dev/voice-setup.ts`                  | `pnpm voice:setup -- --ws-url wss://<host>/v1/q/voice/ws`: creates/updates the two Speech Engines, records their ids in `.env.local`       |

## Configuration

| Variable                           | Where                           | Meaning                                                                                 |
| ---------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| `ELEVENLABS_API_KEY`               | root `.env.local` (server-only) | Provider key. `ProviderCredential`: redacted on stringify, revealed once at composition |
| `ELEVENLABS_SPEECH_ENGINE_ID`      | root `.env.local`               | The default (female) Speech Engine resource                                             |
| `ELEVENLABS_SPEECH_ENGINE_ID_MALE` | root `.env.local`               | The male alternative; absent means one voice                                            |
| `CQ_API_URL`                       | q-api env                       | The application API origin for spoken interview turns                                   |

Without the key and an engine id, q-api starts with no voice routes and
logs `voice channel composed` with `speech.elevenLabs: "unconfigured"`.
Never `NEXT_PUBLIC_ELEVENLABS_*`.

## Voice tuning (D §52)

Recorded in `dev/voice-setup.ts`, applied to both engines: model
`eleven_turbo_v2` (ElevenLabs requires turbo or flash v2 for English
agents; turbo carries fuller prosody), stability 0.42 (low enough that a
sentence rises and falls like speech), similarity 0.8, speed 1,
`optimizeStreamingLatency` 1; ASR keywords for the interview vocabulary
("Capital Q", "MRR", "Series A", "Lagos", …); turn-taking `patient` with a
10 s turn timeout; `recordVoice: false`, `deleteAudio: true`. Default voices:
Sarah (female, mature, reassuring) and Daniel (male, steady broadcaster);
override with `--female` / `--male`.

## Local development

1. `ngrok http 3002` (ngrok must be authenticated on the machine; the
   tunnel hostname is runtime configuration and is never committed).
2. `pnpm voice:setup -- --ws-url wss://<ngrok-host>/v1/q/voice/ws`.
3. Restart `pnpm dev` (or let `--watch` restart q-api); the log says
   `voice channel attached` with the path and voices.

## Security (§82-§86)

- Voice has the authority of the person's session and nothing more: the
  binding is made from the server-resolved `ActorContext`; a transcript
  never names a tenant, an actor or a permission (TM-VOICE-01/02).
- The provider receives conversational text only — never database rows,
  credentials, tenant ids, storage keys, evidence objects or prompts.
  `speech.ts` strips citations and addresses before anything is spoken.
- Provider history is not memory: nothing is read back from ElevenLabs.
- The API key is absent from every response, log line, client bundle and
  test fixture; `q-voice.test.ts` asserts the response and problem bodies
  carry neither the key nor the bearer.

## Tests

`apps/q-api/test/q-voice.test.ts` (route, bindings, channel — fake
provider), `voice-turn.test.ts` (interview `say` under the bound token,
Q run with `modality: VOICE`, streaming by sentence, interruption →
`cancelRun`, public failure only), `voice-speech.test.ts`, and
`packages/onboarding/test/interview-moves.test.ts`. Live ElevenLabs use is a
bounded manual smoke (§93), never a deterministic test.
