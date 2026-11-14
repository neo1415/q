# Founder–investor journey after CONNECTED: map (read-only, 14 Nov 2026)

Continues `audits/2026-11-13-founder-investor-journey.md` (row A11). This map comes from reading the code only; whether a step can be exercised live is inferred, not run.

## Steps

1. **Scheduling a first meeting.**
   - **Meeting-proposal flow.** Only the founder can propose (`packages/communication/src/schedule/proposal.ts`). The routes are `/v1/relationships/:id/meeting-proposals[...]`, exposed as app actions; no web page uses them.
     - When the investor accepts, booking goes through `schedule.schedule`, which refuses without a calendar (CALENDAR_NOT_CONNECTED). The proposal ends CONFIRMED with `booked:false` and no meeting record (**B1**).
     - `sendForReview` sends no notification (**B2**).
   - **`propose_meeting` without a calendar.** It drafts a chat-message card only, with no meeting record.
   - **Errand path** (`propose_errand` → `q.errand.start`):
     - Q offers slots in chat and sends a TIME_PROPOSED notice.
     - It reads the reply by meaning, and `schedule.recordAgreed` writes the meeting with no calendar, sending MEETING_SCHEDULED and MEETING_PREP_READY.
     - There is no invite or Meet link. Slots start at least 18 h ahead. Exercisable live over chat.
   - **Calls tab, find-slots and direct scheduling** need a calendar.
2. **Meeting prep, held, notes and commitments.**
   - Call prep is live-verified.
   - The meeting host (recording, notes, detected commitments) needs a Recall bot in a real Google Meet, which cannot be exercised from the sandbox (**B4**).
   - "Meeting held" without the bot goes through `relationship.outcome.meeting` → `confirmHeld`, which needs the meeting's end time to have passed.
3. **Diligence.**
   - `diligence_started` is written by `recordMeetingOutcome` (either side, from CONNECTED or MEETING_HELD).
   - The diligence area opens at IN_DILIGENCE: the investor requests documents; the founder shares, fulfils or declines.
   - Data-room access request and decision. All exercisable live.
4. **Decline and pass.**
   - A founder's decline of interest notifies nobody, by design.
   - An investor's pass, pause or resume sends RELATIONSHIP_OUTCOME to the company's people. The reason goes only if shared.
5. **Outcomes.**
   - `commitment_step` moves the relationship to INVESTED and sends COMMITMENT notices.
   - The deal's terms, signature and close go through `relationship_deal`. These are consequential.
6. **Q's role.** Every step has an approval card (PREPARE_APPROVE).

## Live scenarios (fictional accounts only)

| #   | Scenario                                                                                         | Pair                   | Model calls (approx.) |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------- | --------------------- |
| S1  | Errand meeting: Q books, founder picks a slot, meeting row with MEETING_SCHEDULED and PREP_READY | Savanna Seed × Watchly | ~5                    |
| S2  | Proposal → counter → accept (after B1: a meeting row is recorded)                                | Watchly → Savanna      | 0–4                   |
| S3  | Meeting held → diligence (the day after S1's slot)                                               | Savanna × Watchly      | ~2                    |
| S4  | Document request → fulfil; a second request → decline; data-room on-request ask and approval     | Savanna × Ajopot       | ~8                    |
| S5  | Founder declines a fresh interest (no notice); investor passes with a reason, then resumes       | new fictional company  | ~4                    |
| S6  | Commitment and deal terms (consequential: owner go-ahead or a fresh fictional pair)              | Savanna × Ajopot       | ~6                    |

## Blockers

- **B1:** accepting a proposal without a calendar records no meeting. Fix: fall back to the existing `recordAgreed`, as errands already do.
- **B2:** a proposal sends no TIME_PROPOSED notice.
- **B3:** there is no web UI for meeting proposals.
- **B4:** recording, notes and detected commitments need Recall and a real Meet; this cannot be done from the sandbox.
