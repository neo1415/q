# Meetings through Q: live browser run (15 Nov 2026)

Production `84ac9afa7`. A browser run on the production web app, with Q turns, 16:12–16:29 UTC. Fictional pair only.

**Evidence** is in `docs/ai-handoff/evidence/2026-11-15-meetings-q/`:

- screenshots at 1440 px, and one at 390 px;
- `run-log.jsonl`, which has Q's words, timings and the card text.

## Setup

- **Relationship:** `3b5b294f-8bd1-426c-bfa9-61ebe90f13d0`, Watchly × Savanna Seed Partners (fictional). It was CONNECTED at the start and is still CONNECTED at the end.
- **Members**, all `@fictional.capitalq.local`:
  - Watchly: Ama Okafor `ea854270` (`founder.fb0005.ama-okafor@`), Kelechi Nwosu `db06daee` and Segun Nwosu `760e2a3a`;
  - Savanna: Amara Diallo-Benson `d2ac720a` (`investor.savanna-seed@`).
- **Starting state:** no SCHEDULED meeting on the relationship, no Google account and no profile time zone on either side.
- **Sign-in:** the browser form with `CQ_SEED_ACCOUNT_PASSWORD`, one persistent Chromium profile per person.
- **Budget:** reservation `dd686929`. I used 7 Q turns and recorded **$0.1837**: Ama $0.1520 (56 rows) and Savanna $0.0317 (14 rows). The figure includes the errand's own model calls and the rehearsal persona build.

## Steps

| #   | Step                                                                                                                     | Verdict                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a  | Ama: "Set up a call with Savanna Seed next week" (turn 1, 20 s)                                                          | **FAIL** (wrong card)        | Q took the old `propose_meeting` chat-message path ("Your Google Calendar isn't connected… I've drafted a message proposing the time"). The card was a `chat.message.send` with "Would Mon 16 Nov, 10:00 (Africa/Lagos) work… I'll send an invite." It was approved and sent (action `75f68824`, message `4bf09eb9`). No proposal and no meeting were made. The slot is 17 h ahead (under the 18 h floor), and "I'll send an invite" cannot be kept without a calendar.                                                                                                                                                                                                                               |
| 1b  | Ama: "Propose call times to Savanna Seed next week: Tuesday or Wednesday at 10:00 Lagos time" (turn 2, 24 s)             | **FAIL**                     | It took the same chat-message path again: a card for Tue 17 Nov 10:00 only (`f86bab24`). Next to it, a "Suggested without your calendar" panel listed different slots (Mon 10:00, Tue 14:00, Wed 11:00). `schedule.proposal.propose` was never chosen. I did not approve this card and dropped it later.                                                                                                                                                                                                                                                                                                                                                                                              |
| 1c  | Ama: "Take this on for me as an errand: chat with Savanna Seed and book a first call with them next week" (turn 3, 12 s) | PASS\*                       | A `q.errand.start` card (`385ea0d1`). I approved it on /work at 16:16:04, and errand `a1510924` was created. 36 s later it sent the opening message plus 3 slots: Mon 16 Nov 14:00, Tue 17 Nov 10:00 and Wed 18 Nov 10:00 **UTC**, all at least 18 h ahead. Savanna got Q_MESSAGE, CHAT_MESSAGE and TIME_PROPOSED ("Q, on behalf of Ama Okafor, proposed times for a call"). Ama got 2 Q_ERRAND notices, one saying "No Google calendar is connected, so Q is arranging it in the chat". \*The card promised "with a Google Meet invite to their people", which is untrue without a calendar (D-Q3).                                                                                                  |
| 2   | Savanna sees the notice and accepts through Q (turn 4, 20 s)                                                             | PASS\* (via the errand)      | The TIME_PROPOSED notice and the chat both label the times "UTC" (labelled, but not Savanna's local time; she has no profile zone). In the side panel, Q moved to the Calls tab and drafted "Would Tue 17 Nov, 10:00 (UTC) work for a 30-minute call about Introductory call?", which is a question, not an acceptance. It was approved and sent at 16:18:42. The errand read it as agreement and recorded the meeting at 16:19:42, 60 s later. It did not use `accept_meeting_time` (there was no proposal row).                                                                                                                                                                                     |
| 3a  | Meeting appears on both sides                                                                                            | PASS                         | Meeting `84c25589-60ba-48db-8dd5-fcbe35d94124`: SCHEDULED, 17 Nov 10:00–10:30Z, organiser Ama, `meet_link` null, `google_event_id` `nocal…` (marker present), `origin` BOOKED, key `errand:a1510924…:agreed:…`. Relationship event `meeting_scheduled` (seq 22). Both Calls tabs show it at Tue 10:00 (`1440-07-*`).                                                                                                                                                                                                                                                                                                                                                                                  |
| 3b  | MEETING_SCHEDULED and PREP_READY; no invite stated honestly                                                              | **PARTIAL**                  | Savanna got MEETING_SCHEDULED "New call: Introductory call / Tue 17 Nov, 11:00 West Africa Time" (a labelled local time). It has **no** "no calendar invite" line. Ama and Savanna each got MEETING_PREP_READY "Rehearse your call", linking to `/rehearsals/meeting/84c25589…`. Kelechi and Segun got nothing. **D-Q1:** the errand posted in the chat, as Ama: "Booked for Tue 17 Nov, 10:00 UTC. **A calendar invite is in your email.** A video link will follow." (`390-11-savanna-messages-phone.jpg`). `sendInvites` emails an .ics through the app mailer and did not throw, but the recipients are `.local` addresses, and every Q card and the Calls tab say that no invite can be created. |
| 3c  | Prep brief for Savanna, grounded                                                                                         | **PARTIAL**                  | The PREP_READY link opens the rehearsal lobby (persona build: $0.0026, 30 s). It reads as grounded: a founder who is "concise… two early pilots… $1 million seed raise", and each point is tagged "from their pitch" or "from their messages", with "What Q read (11)". The $1M figure was not cross-checked. **This is not a prep brief.** The stored prep brief (`composePrepBrief`) is written only for the **organiser**, and only within 24 h of the start. Savanna never gets one. Its text says "Link: in your calendar invite" even for a no-calendar meeting (D-Q4). There was nothing to open on 15 Nov: `meeting_briefs` had 0 rows for the meeting.                                       |
| 4   | Ama: "Move the call with Savanna to Thursday afternoon" (turn 5, 22 s)                                                   | **FAIL**                     | Q prepared an **"Update your profile: Time zone: Africa/Accra"** card instead (`ea07b6c7`; Accra was inferred). Nothing about the call was moved. I did not approve it and dropped it later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4b  | Ama: "Move my Introductory call with Savanna Seed to Thursday 19 Nov at 15:00 Lagos time" (turn 6, 26 s)                 | **FAIL**                     | It took the chat-message path again: "Would Thu 19 Nov, 15:00 (Africa/Lagos) work for a 30-minute call about Introductory call?…". This was approved and sent (`94b41ee2`). No reschedule proposal and no `meeting.reschedule`; the meeting stayed at 17 Nov 10:00Z. No "Call moved". The move flow through Q is **not reachable** by these phrasings.                                                                                                                                                                                                                                                                                                                                                |
| 5   | Ama: "Mark the Introductory call with Savanna Seed as held" (turn 7, 14 s)                                               | **FAIL** (no honest refusal) | Q did not refuse. It prepared "Record how the meeting went: On the relationship, both sides see that things are moving forward." (`f5bd353d`, `app.relationship.outcome.change`, payload `{outcome: OTHER}`, **no `meetingId`**). Without `meetingId` the action skips `confirmHeld` (and its `endsAt > now` INVALID_TIME check) and would record a meeting outcome for a call 2 days in the future (D-Q2). I did not approve it and dropped it.                                                                                                                                                                                                                                                      |
| 6   | Cancel                                                                                                                   | PASS (UI, not Q)             | No Q turns were left within the 7-turn cap. I cancelled as Ama on the Calls tab ("Cancel call"), with no confirm step. The page said "Cancelled. Everyone invited has been told." The meeting is CANCELLED at 16:28:04, with event `meeting_cancelled` (seq 25). One "Call cancelled: Introductory call" notice went to Savanna. Cancel through Q was **not run**.                                                                                                                                                                                                                                                                                                                                    |

**Cleanup.** I dropped the 3 pending cards (`f86bab24`, `ea07b6c7`, `f5bd353d`, all now REJECTED). Errand `a1510924` is FINISHED. The relationship is still CONNECTED.

## Findings

- **D-Q1 (high, demo-visible).** The errand's booking message says "A calendar invite is in your email", while everything else says no invite is possible.
  - Source: `apps/q-api/src/composition/errands.ts` around line 1034 (`invited` stays true when the app mailer accepts the email).
  - Either say that an invite file was emailed, or drop the line when there is no calendar. Fictional `.local` recipients cannot receive it.
- **D-Q2 (high).** "Mark … as held" gives a `relationship.outcome.meeting` card with no `meetingId`, for a meeting that has not happened yet.
  - Approving it would record an outcome and bypass `confirmHeld`.
  - Q should resolve the meeting and pass `meetingId`, or refuse until after `ends_at`.
  - Also, when it does refuse, INVALID_TIME is reported as `NOT_FOUND` (`packages/app-actions/src/actions/outcomes.ts`, about line 325).
- **D-Q3 (medium).** For a founder without a calendar, Q chooses the old `propose_meeting` chat message ("I'll send an invite") over `schedule.proposal.propose`, even when asked to "propose call times".
  - The errand card promises "a Google Meet invite to their people".
  - A move request never reaches the reschedule path. It gives either a profile time-zone card or a new chat proposal.
- **D-Q4 (low).** For a no-calendar meeting:
  - the prep brief says "Link: in your calendar invite";
  - Savanna, who is not the organiser, never gets a stored brief;
  - her MEETING_SCHEDULED notice lacks the no-invite line that the proposal path has.
- **D-Q5 (info).**
  - The errand slots are labelled UTC, not the recipient's local time; neither profile has a zone.
  - The Calls tab lists future cancelled calls (19–23 Nov) under "Earlier".
  - The first chat proposal offered a slot 17 h ahead.

## What a "meeting held" demo needs

1. A SCHEDULED meeting on the fictional pair whose `ends_at` is already past. Either:
   - seed one through a reviewed fixture; or
   - book one at least 18 h ahead and run the demo after it ends. For example, an errand slot the day before the demo.
2. Fix D-Q2, so that Q passes `meetingId` and `confirmHeld` writes `meeting_held` before any outcome.
3. Optionally, a no-bot "how did it go" prompt after the end time. Recall notes still need a real Meet (B4).

## Rows left in production (fictional pair)

- **Meeting** `84c25589` (CANCELLED).
- **Errand** `a1510924` (FINISHED).
- **Messages:**
  - 3 from Q for Ama: the Mon 16 proposal, the opening, and "Booked…";
  - the errand's slot message;
  - Savanna's "Would Tue 17…";
  - Ama's "Would Thu 19…".
- **Notifications:** TIME_PROPOSED, MEETING_SCHEDULED, 2 MEETING_PREP_READY and MEETING_CANCELLED, plus chat and errand notices.
- **Relationship events:** seq 18–25, of which 6 are `message_sent`, plus `meeting_scheduled` and `meeting_cancelled`.
- **Actions:** 3 REJECTED cards, plus executed `chat.message.send` ×3 (2 by Ama, 1 by Savanna) and `q.errand.start`.
