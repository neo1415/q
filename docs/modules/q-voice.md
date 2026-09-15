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

- `GET /v1/q/voice/sessions/:voiceSessionId/turn` (contract:
  `QVoiceTurnState`). What Q is asking after its latest spoken turn, with
  the step's options only when Q chose to show them, where Q is taking the
  person (`navigate`), and whether Q has handed them to the form
  (`handoff`). Owner only; the stage polls it every 1.5 s while talking.
  A tapped option is said to Q, the same path as speaking it.

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

Conduct, after the first live transcripts:

- **Manner.** `Q_PERSONALITY` (UPBEAT default, CALM, DIRECT) selects a
  paragraph from q-core's personality registry; it shapes reactions and
  humour, never what is recorded.
- **Tangents.** Small talk gets one line in Q's manner and the interview
  continues in the same breath; something unrelated is acknowledged and
  brought back to the current step. Never rude.
- **Derailing.** Abuse, instruction injection or repeated nonsense is
  intent SABOTAGE; the code counts warnings per session (never the model).
  Two friendly warnings, then `handoff: FORM` and the stage leaves the
  person with the form.
- **Navigation.** "Take me to my profile" is intent NAVIGATE with one of a
  fixed list of destinations; the browser maps each to its one route.
- **Lookups.** A website, company or person is read back with its spelling
  first; once confirmed, the lookup becomes a question for Q's own
  public-web research tools (CQ-Q-RESEARCH-001), answered aloud as
  unverified context the person confirms or rejects. LinkedIn pages are not
  crawled; only what a public search surfaces is read.
- **Documents.** Pending suggestions lifted from uploads are handed to the
  model as DOCUMENT PROPOSALS and read back like Q's own readings; a yes
  resolves the suggestion through the runtime's ACCEPT path, a different
  value through EDIT.
- **Expressiveness.** With `Q_VOICE_EXPRESSIVE=true` (written by
  `voice:setup`) Q may use one inline tag such as [laughs] per reply; the
  engines render them only on `eleven_v3_conversational`.
- **Size.** A live turn renders the `Q_SYSTEM_VOICE` charter (a third of
  `Q_SYSTEM`) and a compact open-steps list (full options for the first
  three open steps, ten and a count for the rest): about 3k tokens a turn
  against 4.9k before. Groq's free tier allows 8k tokens a minute per
  model, so `normal_dialogue.v1` now falls back across
  `openai/gpt-oss-20b` and `qwen/qwen3.8-27b` (each its own quota) before
  Google, and the gateway moves to the next model on a 429 instead of
  sleeping on the first.

`pnpm interview:smoke -- "I have two pilots" "and forty customers"` runs
the interviewer against the live gateway and the dev founder's own session
and prints what Q said, read, recorded and asked, with the provider and
latency of each call: the thing a browser transcript cannot show.

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
| `voice/turn-board.ts`                 | Process-local: what Q is asking, and where it is taking the person, after each voice session's latest turn, for the screen                 |
| `dev/interview-smoke.ts`              | `pnpm interview:smoke -- "<utterance>"...`: the interviewer against the live gateway, one turn per argument                                |
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
`eleven_v3_conversational` with expressive mode and suggested audio tags
(laughs, chuckles, sighs), stability 0.42 (low enough that a sentence
rises and falls like speech), similarity 0.8, speed 1,
`optimizeStreamingLatency` 1 (`--classic` returns to `eleven_turbo_v2`
without tags); recogniser `scribe_realtime` with ASR keywords for the
interview vocabulary and the names and places a Nigerian or wider West
African founder is likely to say (a recogniser mis-hears an unknown name
far more often than an accent); turn-taking `patient` with a 10 s turn timeout, re-transcription of audio
the voice detector missed at the timeout, and a person's "mm-hm", "okay",
"right" while Q speaks treated as listening rather than interruption; `recordVoice: false`, `deleteAudio: true`. Default voices:
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
