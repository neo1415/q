# 21 — Execution traces

Every trace is labelled **VERIFIED (live)** when it was observed in production through logs or database reads today, **REPRODUCED** when it ran locally, or **RECONSTRUCTED** when it was rebuilt from code. User content is paraphrased or shortened, and identifiers are truncated.

## T1 — VERIFIED (live), 2026-10-08 11:13 UTC: duplex call, generic opener, garbled speech, Q stays silent

Source: `q_runtime.voice_line_turns`, `q_runtime.runs` and `q_runtime.run_events` for run `5c13e186…`.

1. Founder member on Home presses talk. The browser's `spokenWelcome()` finds no arrival briefing (session gate already used) and speaks the web's generic `returning.ts` line: "Welcome back, <name>. What would you like to work on today?" The row is stored with `routed=model_only`.
2. The user says "find anything that needs my attention". `gpt-4o-mini-transcribe` (no language, no prompt) returns "Fidiani inanituma attention."
3. `routeDuplexTurn` returns ASK_Q, and the broker calls `askQ` → Q run `5c13e186` (screen CAPITAL). Run events: started → UNDERSTANDING_REQUEST → PREPARING_ANALYSIS → completed in 3.7 s, `prompt_bundle_version=none`, and no Q message stored.
4. The turn reader classifies it UNCLEAR_TRANSCRIPT. `answer.ts` returns SILENT for spoken unclear turns. `askQ` returns `{ok:true, say:""}`.
5. The browser sends `response.create`, and the realtime model improvises: "Got it — let's focus on what's pressing. Could you give me a bit more detail…" (stored `routed=ask_q`).

Root causes:

- The briefing was gated out.
- The weak transcriber had no language set.
- The SILENT branch let the voice model speak for Q.

The lead's same-day fixes address all three; see T2.

## T2 — VERIFIED (live), 12:02–12:04 UTC: lead test call (headless Chromium, fake mic, synthesized English)

Source: q-api logs; `conversation_messages` for run `80ae0803…`.

1. `POST /v1/q/voice/sessions` mints a duplex line. The line rejoins at 12:03:00 and ends at 12:03:11. The browser falls back to the standard line (Deepgram STT → `/v1/q/voice/think` → ElevenLabs `/speak`). Likely cause is the sandbox's WebRTC (R-C1); unconfirmed.
2. Deepgram transcript: "I'm anything that needs my attention."
3. TURN_READER v44 (gemini-3.5-flash-lite, FAST_CLASSIFICATION) reads `NOISY`, `TOOL_REQUEST`, `NAVIGATE`, with `heardAs` = "Find anything that needs my attention". Log line: "q read garbled speech by sound". The heard words are stored as a new USER message and the turn is answered again.
4. The second read is CLEAR, `NAVIGATE`. Q says "Over to Work." with `UI_INTENT NAVIGATE WORK`.

Result: the heard-as repair works live; the intent was mishandled (navigation instead of an answer).

## T3 — VERIFIED (live), 12:41 and 12:58 UTC: answer says "nothing is waiting"

Source: q-api logs for run `426cb9b0…`; `conversation_messages`.

1. After v44 added "WHAT NEEDS THEM", the read is QUESTION_TO_Q / THEIR_OWN_RECORDS.
2. Tools called: `relationship.get` (DENIED NOT_AVAILABLE), `approvals.pending.list`, `schedule.list`, `company.get`, `q.work.list`, `relationship.own.list`, `records.own.read`.
3. Answer model gpt-5.6-luna (NORMAL_DIALOGUE, prompt bundle `q-system.v2_company-analyst.v21_comm.v2`, about 37k prompt characters, 6.7 s): "I don't see any company issue that needs your attention … no approvals, or Q work waiting…".
4. Ground truth: the investor's message in that relationship had been unanswered since 7 Oct 15:43 (`communication.messages`, latest sender_side INVESTOR).

Root cause: no tool exposed "who wrote last". The fix (`relationship.own.list.lastMessage`) is deployed and **not yet verified**.

## T4 — VERIFIED (live), 12:05 UTC: standing instruction kick (Tensorgate → investor)

Source: `workforce_drafts`, `workforce_grades`, `q_runtime.actions`.

1. The instruction becomes due when paused then resumed, and the 60 s sweep fires it.
2. Draft 1 scores 58/100 (threshold 75). It fails integrity RESPONDS_TO_THREAD (no answer to the investor's question, no time offered).
3. A redraft uses the fix list. Draft 2 scores 68/100 and passes all integrity rules; the main deductions are WARM_OPENING 1/5 and PERSONAL_STYLE 3/5.
4. REVIEW_ROUNDS_MAX=2 is reached. Near the bar (within 10), so it becomes an approval card: action `AWAITING_APPROVAL`, `app.chat.message.send`, risk CONFIRM_REQUIRED, owner Daniel.
5. Nothing is sent. Per D-01, the card lapses after 24 h and the thread stays parked.

## T5 — REPRODUCED (local): workforce job with a WRITER step

See `evidence/agents/repro-writer-step.md`. WRITER is HELD with "No agent can do this step on its own" and the dependants are SKIPPED.

## T6 — RECONSTRUCTED: duplex turn lifecycle

See `diagrams/voice-lifecycle.md` and `04-VOICE-SYSTEM.md`.

1. Mic (WebRTC) → OpenAI semantic_vad (create_response=false).
2. `input_audio_transcription.completed` → browser `#routeHeard` → server action `heard` → broker `routeDuplexTurn`.
3. If ASK_Q: `askQ` → voice turn handler → Q run → `{say | facts | silent}` → browser adds a function_call plus its output → `response.create(tool_choice none)` → audio.
4. If SMALLTALK or MODEL: `response.create` with no Q involvement.

## T7 — RECONSTRUCTED: typed message

See `diagrams/text-message-execution.md` and `03-Q-BRAIN.md` (investigator B).

## T8 — RECONSTRUCTED: arrival briefing

1. `ArrivalBriefing` → `startArrival` (gate: once per browser session or after 2 h away) → `arrivalBriefingAction`. That action reads account, work-since, pending approvals, workforce, done items and notices.
2. `arrivalWords` builds the greeting (by the person's clock), the lowdown (counts of sent, booked, interest, held, replies, matches) and what's waiting, then a summary of the cards.
3. Rendered in the side columns only while the conversation is empty (E-01).
4. On call start, `voiceBriefing()` (lead fix) reads it on demand and speaks it.
