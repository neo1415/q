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

## Transports

Two transports carry the voice; Q is the brain on this server either way,
and the browser sees one client.

- **Deepgram Voice Agent** (default when `DEEPGRAM_API_KEY` exists). The
  browser opens the agent websocket with a 60-second token this server
  mints (`POST /v1/auth/grant`); the agent settings this server composes
  point every "think" at `POST /v1/q/voice/think/chat/completions` on
  `Q_API_PUBLIC_URL`, under a per-session bearer. That route speaks the
  OpenAI chat-completions dialect because that is what the provider sends,
  turns the messages into the turn's transcript, runs the same turn handler
  the websocket channel uses, and streams Q's words back as chunks. Flux
  (`flux-general-en`, keyterms from `voice/vocabulary.ts`) listens; Aura-2
  (Thalia, Orion) speaks. Barge-in: the provider cuts the audio and drops
  the think request, which aborts the turn's signal; pause-and-resume
  behaves as on the other transport. Billed from Deepgram's balance (the
  $200 starting credit), not from ElevenLabs minutes.
- **ElevenLabs Speech Engine** (`Q_VOICE_PROVIDER=elevenlabs`): the
  original transport, below.

`pnpm demo` writes `Q_API_PUBLIC_URL` from the tunnel; without it the
Deepgram transport is not composed and the log says why.

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

## Arrival (`voice/welcome.ts`, `/welcome`)

Sign-in lands on `/welcome`. A person Capital Q already knows goes
straight to Home; a new person meets Q: a quiet screen with the Q mark and
one tap (browsers need a gesture before a microphone opens), then Q
speaks first. `POST /v1/q/voice/sessions` with `welcome: true` binds a
session with no onboarding thread; the welcome host renders
`WELCOME_CONDUCTOR` (q-core) so Q introduces itself in its own words, asks
what to call the person (recorded through `PATCH /v1/me` under their own
token) and reads from anything they say whether they are raising or
investing. The turn state then names `INTERVIEW_FOUNDER` or
`INTERVIEW_INVESTOR`; the browser opens the interview with `?talk=1` and
the voice carries across. `?again=1` reopens arrival for anyone.

## Finishing

When a recorded answer leaves no required step open and the runtime says
the session can complete, the interviewer completes it through
`POST /v1/onboarding/sessions/:id/complete`, adds "That's everything I need
for now. I'm taking you to your home." to Q's reply, and the turn state
names HOME; the stage follows it.

## Pause, not stop

An interruption never throws Q's words away. A reply cut off mid-way keeps
its unsaid sentences; a Q answer (a lookup, a question) keeps running in
the background and holds its text. "Go on", "you were saying", a bare
"okay" resumes from where Q was; a new subject is answered first and a
finished answer is offered after it ("And on what you asked earlier…").
Held speech is per binding and process-local, like the bindings.

## Pronunciation

"It's pronounced vault-line" is intent PRONOUNCE. The term and the spelling
of the sound become an alias rule in one ElevenLabs pronunciation
dictionary for the environment (`capital-q-voice`), and both engines are
pointed at its new version. It applies to sessions that start afterwards.

## Uploading while talking

The stage's Upload control takes a deck or profile through the normal
evidence path (upload target, PUT, complete), waits for the worker to read
it, then says to Q "I've just uploaded <file>; read back what you found".
The proposals the worker produced arrive as DOCUMENT PROPOSALS on that
turn. Founder sessions only for now; an investor's documents attach to an
organisation, which the upload action does not address yet.

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
| `voice/welcome.ts`                    | Q's first minute: WELCOME_CONDUCTOR turn — name, then which setup to start                                                                 |
| `voice/pronunciation.ts`              | The pronunciation-teacher port; `providers/elevenlabs-pronunciation.ts` is the dictionary adapter                                          |
| `voice/providers/deepgram.ts`         | The Deepgram transport: token grant, agent settings with the think endpoint and the session bearer                                         |
| `voice/think.ts`                      | The think route: chat-completions in, the shared turn handler, chunks out                                                                  |
| `voice/vocabulary.ts`                 | ASR keyterms shared by both transports                                                                                                     |
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

## Long turns and dropped lines

A turn that researches or reads a document can take longer than a person
expects silence to last. Three things keep it from feeling like a hang:

- `voice/think.ts` writes an SSE comment every 5 s while a turn is still
  working, so neither the provider nor a proxy treats the line as dead;
  and if nothing has been said after 3.5 s it speaks one short beat
  ("One moment.") before the answer. At most one beat a turn; nothing
  when Q is quick.
- The stage's status line grows a note after 5 s ("Working on it") and
  after 14 s ("Still on it. This one takes a moment.").
- Deepgram's listener runs with `eot_threshold` 0.8 so a pause
  mid-sentence is not taken as the end of a turn, which was cancelling
  think requests in bursts.

INTERVIEW_CONDUCTOR now forbids promising a later action ("I'll update
your profile"): the platform records; Q says what it has taken from the
person's words now, or asks the next question.

A session that drops on its own (`onEnded` with a reason other than the
person ending it) is reconnected once by `useVoiceInterview`, on the
same thread, with "The line dropped. Reconnecting…" as the notice; a
second drop is shown as before. A provider error carries its code in the
notice so the person can say which leg failed.

Q's destinations (a page, the form) are followed by `useFollowTurn`
only once the client has stopped speaking or thinking, with a 1.5 s floor
and a 12 s ceiling, so a goodbye is heard before the screen changes.

## Barge-in

The provider reports "user started speaking" on any sound, so Q sampled
the microphone before cutting playback — and the first threshold was set
so high that Q carried on talking over people. It is now 260 ms at a low
level: failing to stop when somebody speaks is far worse than stopping for
a cough, because a false stop repairs itself a moment later through the
hidden `[continue]` cue and a missed one does not.

## Sounds, interruptions, endings and destinations

`voice/navigation.ts` reads a few things deterministically before any
path runs, so they work in the arrival conversation and the open thread
as well as in the interview:

- A cough, a laugh, a bare "uh" or the browser's `[continue]` cue is not
  a turn. If Q was cut off it carries on; otherwise Q says nothing.
- "End the chat", "let me type", "that's all for now" records a `CHAT`
  handoff: the browser ends the voice and keeps the typed thread.
- "Take me to Discover", "open my profile" records the destination (the
  interview reads these through its own model, so this runs only outside
  it); Q says where it is going and the screen follows once Q has said it.
- Fillers, recovery lines and resume acknowledgements rotate; the same
  apology is never heard twice in a row, and every recovery line names
  what Q can still do.

A held answer remembers what was already heard. Resuming, or offering the
answer after the next reply, speaks only the unsaid part, after "Sorry, I
got cut off. As I was saying," (`unsaidPartOf` in `turn.ts`). Nothing
is repeated; an answer that had finished is not re-spoken.

In the browser the Deepgram adapter no longer cuts playback on any sound:
it samples the microphone for 420 ms and interrupts only for a sound that
keeps going. When Q was cut and no words follow within 1.6 s, it injects
`[continue]` as a user message; the server resumes and the transcript
never shows the cue.

## Visibility by voice

"Make me visible to investors" / "make us private" (`spokenVisibility`
in `voice/navigation.ts`): Q asks one confirming question, the spoken
yes is the approval of that exact change, and the platform's own
visibility API performs it under the person's authority; a no leaves
things as they are.

Both sides of the network have the switch and Q works out which one it is
holding: the thread's subject, then the setup's bound subject, then the
organisation's own investor row (`ownVisibilitySubject`). A founder
publishes a company through `POST /v1/companies/:id/visibility`; an
investor publishes the declared investor profile through
`POST /v1/investors/:id/visibility`. Becoming visible as an investor
exposes the declared profile only — never the mandate, the portfolio or
anything observed. Without a subject at all Q offers the setup first.

## Q speaks first

Every thread opens with Q's line: the interview and the arrival compose
theirs from state; the open thread greets by first name when Capital Q
knows it ("Hi Daniel. I'm listening; what would you like to look at?").

## Tangents

The conductor counts small talk and asides since the last recorded answer
(`tangents`): the first two are answered properly with no steering, the
third is answered briefly and brought back, later ones get one line and
the question. When it asks a choice step it names two or three options as
examples; the screen always shows the full list.

## A person before any organisation

Sign-in lands on arrival, and a person who has just signed in belongs to
no organisation. The strict actor-context hook refuses them; the voice
routes use `requireActorContextOrPersonalHook` instead: an
authenticated person with an active profile and no organisation context
gets a personal context attributed to the well-known personal tenant
(`PERSONAL_BOOTSTRAP_TENANT_ID`, migration 20260922090000). It grants no
organisation, no membership and no subject. A person with an organisation
resolves exactly as everywhere else. The typed thread (`POST /v1/q/runs`)
and its event stream accept the same personal context, so Home works
before setup; approvals stay strict.

## Home

Talking with Q on Home mounts the same full-page stage as the interview
(`VoiceStage`, no progress, no form), and follows Q's destinations the
same way. Typed answers on Home render through `q-answer.tsx`: prose
first, then the server's FINDING blocks as one plain list (type in words,
the contract's confidence label, a source count), then UNCERTAINTY blocks
under "Still open" with what would settle them, then the count of recorded
sources. Nothing is coloured by truth and nothing is invented.

## When every session drops at once

"The voice connection dropped" the moment Q appears, every time, is the
provider refusing to start a conversation. The headless probe (scratch
`probe-step.mjs` pattern: signed URL, `conversation_initiation_client_data`,
read the close reason) shows it in one line; on 2026-09-15 it was
`[quota_exceeded] You've run out of credits` — the ElevenLabs free plan's
15 agent minutes were spent. Nothing in Capital Q can fix that; credits or
another transport can.

## Public research: indexes in a row, with a short memory

Search goes to every configured index in turn (Bright Data when its zones
are named, Tavily, SerpApi via `SERP_API_KEY`), so one index being
rate-limited costs a second search rather than the answer; page reading
goes to the first provider that reads pages. A short memory
(`providers/cached.ts`, six hours, process-local) returns the same
search or page without a second vendor call; "refresh", "latest",
"again", "check now" in the person's words bypass it and replace the
entry. Q reaches for the web on market, comparison, competitor, peer,
trend and "rate me" questions as well as on explicit "online" cues
(`q-core/communication/research-cues.ts`). When the synthesis model
route is out, the deterministic findings are still spoken with a note
that the fuller review did not come through (`q-specialists/answer.ts`).

## Demo posture

Migration `20260919090000_demo_gemini_posture.sql` raises the Google
models' sensitivity ceiling to CONFIDENTIAL and adds them to every
policy's fallback chain, so a demo is not gated by one provider's free-tier
minute. The google provider review is unchanged (UNREVIEWED for
confidential customer data). Revert the ceiling before real customer data.

## Local development

`pnpm demo` does all of the below in one command: starts the database if
needed, opens the tunnel, points the Speech Engines at it, and runs
`pnpm dev`. Manually:

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
