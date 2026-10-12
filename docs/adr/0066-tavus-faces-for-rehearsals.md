# ADR 0066 — Tavus faces for Rehearsals, with Q as the brain

- Status: Proposed (Claude Code, 2026-10-12; owner directive "Tavus immersive rehearsals")
- Builds on: ADR 0029 (per-viewer personas, screen frames), the rehearsal service (`apps/q-api/src/composition/rehearsals.ts`), the Q Model Gateway

## Context

Rehearsals today are a Q-powered voice room: the rehearsal service plays
the counterpart from a per-viewer persona, reads shared-screen frames,
and scores the review in code. The owner wants a live, human-looking
interviewer (Tavus CVI), four selectable archetypes plus a Gulf-influenced
English voice, a hard three-minute live limit, and the same intelligence.

Tavus (docs.tavus.io, OpenAPI read 2026-10-12): a conversation is created
with a face and a PAL (`POST /v2/conversations`, `properties.max_call_duration`,
`participant_left_timeout`, `participant_absent_timeout`, `test_mode`),
ended with `POST /v2/conversations/{id}/end`; a PAL's `layers.llm` may
point at our own OpenAI-compatible endpoint (`base_url`, `headers`,
streaming `/chat/completions`), with `perception_model: raven-1`
(camera/screen context as system messages), `conversational_flow.turn_detection_model: sparrow-2`
and a Tavus voice (`GET /v2/voices?source=system`).

## Decision

1. **Tavus is the face, voice and turn-taking; Q is the brain.** Each live
   session gets its own PAL whose `layers.llm.base_url` is Capital Q's
   `/v1/rehearsals/video/{sessionId}` bridge, authenticated by a
   single-session bearer token in `layers.llm.headers` (stored hashed,
   expires with the session). The bridge passes the founder's latest words
   to the existing `rehearsals.say(...)` as the founder (never a wider
   path) and streams the line back. No company memory, scoring or persona
   lives in Tavus; the PAL's own prompt only fixes voice and disclosure.
2. **Three minutes, enforced three ways.** `max_call_duration: 180` at
   creation (provider backstop); a server timer from the first `participant
joined` callback that asks the interviewer to close naturally at
   150–160 s (the bridge adds a closing cue to the next line) and calls
   `/end` at 180 s; a sweep that ends any session past its end time. The
   clock never restarts on reconnect: the end time is stored on the
   session row when it first connects.
3. **Identity is disclosed.** The interviewer is "an AI rehearsal of
   <person>" in words on screen and in its first line, a stock Tavus face
   chosen per archetype (never a likeness of the real person), and voices
   from Tavus's catalogue (no cloning).
4. **Keys and spend.** One server-side key in `TAVUS_API_KEY` (Railway
   variable), never in a browser, log or prompt. Multiple keys are not
   pooled to evade a plan's limits; a second configuration is used only
   when the owner records that it is a separately entitled account. Each
   session is metered (seconds) against a configured monthly cap that
   fails closed. Google Meet / Zoom (`meeting_url`) stays feature-gated
   until an account's plan includes it.
5. **Fallback.** If a Tavus session cannot be created or drops, the same
   rehearsal continues in the existing Q voice room with its transcript;
   the review is the existing review.

## Consequences

- New table for live sessions (rehearsal, provider conversation id,
  started/ends at, ended reason, seconds) with RLS like rehearsals.
- New q-api bridge route that is not cookie-authenticated (Tavus calls it);
  its token is single-use per session and scoped to one rehearsal.
- Latency: the bridge adds one hop; first audio depends on `say()`'s
  first sentence, so the bridge streams sentence by sentence.
