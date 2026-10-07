# MEET-HOST — Q as a live participant in booked calls (2026-10-01)

Controlling sources: ADR 0027, ADR 0037 (proposed), CLAUDE.md (Q authority, Context Firewall).

## Recall APIs used (documented)

- Create bot `POST /api/v1/bot/` with `join_at` (≥10 min notice), `metadata`, `recording_config.transcript.provider.meeting_captions`, `recording_config.realtime_endpoints[{type:"webhook", url, events}]` for `participant_events.join/leave/speech_on/speech_off` and `transcript.data` (finished lines only; partials are not subscribed), `automatic_leave` (waiting_room / noone_joined / everyone_left / in_call_recording / in_call_not_recording timeouts) and `automatic_audio_output` (a quarter-second of silence, required for output audio).
- Speak: `POST /api/v1/bot/{id}/output_audio/` `{kind:"mp3", b64_data}` (ElevenLabs, Q's voice). Leave: `POST /api/v1/bot/{id}/leave_call/`.
- Output Media (a webpage as the bot's camera/mic) was not chosen: short lines through output_audio need no page, no signed page auth and no larger bot variant.
- Webhook auth: the workspace has no verification secret configured, so each meeting's endpoint carries an HMAC-SHA256 token of the meeting id keyed by the server's Recall key; the route refuses anything else. Recall's workspace secret (whsec_, Svix headers) can replace it later.

## Flow

waiting → greeting (each arrival, consent line) → intros (both sides present) → listening → addressed (one model call per addressed line) → closing (recap offer at T-3 min to end; recap on request). Grace 10 min after the start: nobody → NO_SHOW; one side → apology and "shall I let you know?" (never mind / yes / no answer = yes). Hard cap 120 min after the start.

## What happens on Fri 2 Oct, 12:30 UTC (meeting cfccb9a9, Zino ↔ Nixo), once deployed

- ~12:00: the 2-minute enlist tick books Q's bot with `join_at` 12:27, a signed events URL, leave limits (alone/unadmitted 13 min, in call ≤ 53 min).
- 12:27: "Q (Capital Q notes)" asks to join the Meet. **Someone must admit it** (Google Meet's waiting room) unless the meeting lets anyone in.
- Each person who arrives hears "Hi <first name>, welcome. I'm Q from Capital Q, here to take notes and help; say 'Q, leave' to remove me." Unknown call names are asked to introduce themselves; if the name they give is an invited person's, they are matched.
- With both sides in: "Priya, this is Zino from Zino Aviation. Zino, this is Priya Khandelwal of Nixo. You're meeting about Introductory call. I'll keep notes; just say 'Q' if you need me."
- Then silent unless addressed; at 12:57 (3 min before the scheduled end) a recap offer; a recap only when asked.
- 12:40 with nobody: Q leaves, invite withdrawn, both told. With one side: the apology path.
- After the call: the existing record (ADR 0027) is composed as today.

## Cost per call (estimate)

- Recall: $0.50/h recording + $0 captions (meeting_captions); a 30-min call joined 3 min early ≈ 33 min ≈ $0.28; a no-show ≈ 13 min ≈ $0.11.
- ElevenLabs: greetings ~110 chars × people + intro ~200 + a few answers ≈ 600–1,200 chars, capped at 2,400 per call (v3 conversational).
- Model: ≤16 calls per call, only on addressed lines and guest introductions (~1.5k input + ≤400 output tokens each).
