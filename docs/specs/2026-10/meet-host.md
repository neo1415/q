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

## Waiting for the other participant, and budgets (2026-10-09)

Live bug (founder, Friday): Q announced it would "arrange another time" and left while the founder told it to wait. Cause: after the check at the grace period Q asked "shall I let you know once it's rescheduled?" and the very next utterance (any words, "wait" included) or 2 minutes of silence was taken as a yes. The host now never reschedules or cancels because someone is absent; silence is never consent.

- Check-in at the grace period (10 min): "It looks like we're still waiting for the other participant. Would you like me to keep waiting or help you prepare?" Q stays and talks.
- "Wait / hang on / don't leave / stay with me / give them a few more minutes" extend the wait (code matcher first; the MEETING_HOST_TURN v4 reader returns KEEP_WAITING as the fallback).
- The wait ends at its own expiry (no one answered the check-in and nobody is talking) or at `MEETING_WAIT_MAX_MINUTES` (default 20, bounded 5 to 60, never past the 120-minute provider hard cap). Q says why it is leaving; the booking is untouched; the reason is in `meeting_host_notes.body` (WAIT_EXPIRED, WAIT_CAP) and the logs.
- Budgets (were: 2,400 spoken chars, 60 model calls, 2 sentences or 280 chars per answer, 0.02 USD per turn): now 20,000 chars, 150 model calls, 3 sentences or 520 chars, 0.03 USD per turn (0.04 with a frame). Per-meeting spend is at most 150 x 0.03 USD; max duration and concurrency limits are unchanged. Constants: `DEFAULT_HOST_LIMITS` in `packages/communication/src/meeting-host/host.ts`, `HOST_BUDGET` in `apps/q-api/src/composition/meeting-host-runtime.ts`.
- Diagnostics (no words): `meeting host utterance` per line (attributed, implicitJoin, echo, interpreted), `meeting host event dropped` with a `dropped` reason, `meeting host leaving the call` with the cause and stats.

## P3 (2026-10-11): Q as a conversational assistant in the call

- **Meeting Context Snapshot** (`packages/communication/src/meeting-host/snapshot.ts`, built by `apps/q-api/src/composition/meeting-snapshot.ts`): prepared when the bot is created (`urlFor`), versioned, four layers (SHARED, DISCLOSED, FOUNDER_PRIVATE, INVESTOR_PRIVATE). Reads only through firewall-scoped services, each side's private layer as that side's actor. The room is the intersection of who is present: a private layer is used only when everyone present is on that side; an unidentified person fails closed. Lines said to one side alone are withheld from the model once the other side is present.
- **Brain** (`brain.ts`): hearing check, correction ("hold on, that's not what I meant"), quiet/resume, "where are we", remember/note, and prepared company/mandate/deck/agenda/document answers are done by code (no model call, no extra read). Everything else goes to MEETING_HOST_TURN v5 with the room-permitted context and the working record; the model's only tools are NOTE and PROPOSE (organiser approves after the call).
- **Meeting memory** (`memory.ts`, table `communication.meeting_events`, migration 20261222140000): append-only; SUGGESTION vs TENTATIVE vs COMMITMENT; owner/due only on a commitment (also a DB check); a request becomes a commitment only when the addressee says yes; a time said in the call is PROPOSAL + PENDING_APPROVAL, resolved only by an explicit investor-side yes. Compaction adds SUMMARY events and never removes any. At close: a summary and PROPOSED follow-ups (never sent or booked).
- **Scheduling**: `schedule.proposal.{propose,review,accept,decline,counter}` app actions (route + Q tool), COMMITMENT consequence, idempotency keys; booking happens only after a recorded acceptance, as the accepting person.
- Assumption: the investor's declared sector/geography/stage/cheque headline is shared with the founder in a booked call; everything else on the mandate is investor-private.
