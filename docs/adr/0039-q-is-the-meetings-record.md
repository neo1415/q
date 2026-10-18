# ADR 0039 — Q is the meeting's record for both sides; only the organiser removes it

- Status: Proposed (founder direction 2026-10-02, after the live Zino↔Nixo call cfccb9a9)
- Amends: ADR 0027 §1 (consent wording: "any participant may ask Q to leave, in the call or on the meeting in Capital Q") and ADR 0037 §3 ("Q, leave" removes Q at once)

## Context

On the first live hosted call, Q greeted the founder with "say 'Q, leave' to remove me". Google Meet's captions gave Q's own words to an "Unknown" speaker; Q read them as a participant's command and left before anyone spoke. The founder also rejected the policy itself: "how is it supposed to monitor the meeting if you can just send it out like that?" Capital Q facilitates capital; the meetings it arranges are the evidence of that facilitation, for both sides.

## Decision

1. **Q never hears itself.** Only people who joined the call are heard (a caption from an unknown speaker is ignored), and anything that repeats what Q said in the last 45 s is its own echo.
2. **Greeting.** "I'm Q from Capital Q; I'll take notes for both sides and help when asked." No removal instruction is spoken.
3. **Asked to leave in the call, Q stays.** It says: "I'm here as Capital Q's record of this meeting for both sides; I can stay quiet. If you'd like to end recording, the organiser can do that from Capital Q." The request is recorded (who, when) as an append-only host note both sides read. Whether a line asks Q to leave is read by meaning (MEETING_HOST_TURN v2), never by a phrase in code.
4. **"Be quiet" is honoured.** Q stops speaking unprompted and keeps taking notes; it still answers when addressed.
5. **Only the organiser removes Q**, from Capital Q (an authenticated action, never speech). The removal is recorded, append-only and visible to both sides: "Q was removed by <name> at <time>", with "Unrecorded portion: <from>–<to>, removed by <name>", and `meeting_recording_declined` on the relationship's history. A call Q was never admitted to, or heard nothing in, is marked "Unrecorded" the same way, so nobody can later claim it happened unwitnessed.

## Consent and the law

Some jurisdictions require every party's consent to record a call. Consent here is given at booking (the invite says Q from Capital Q keeps the meeting record for both sides) and announced on joining; anyone who does not consent can decline at booking, or not join, and the organiser can end recording at any time from Capital Q. This is a product position, not legal advice; counsel should confirm it for the jurisdictions Capital Q serves before general availability.

## Consequences

- A participant who is not the organiser cannot stop the recording on their own; the record says they asked.
- Migration 20261111030000 adds the host-note kinds LEAVE_REQUESTED, REMOVED and UNRECORDED.
