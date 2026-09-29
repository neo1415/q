# ADR 0027 — Q attends every Capital Q meeting and keeps its record

- Status: Accepted (founder direction, 2026-09-29)
- Amends: PADL Decision #64 ("With the explicit consent of all participants,
  Q may attend meetings as a silent institutional meeting assistant")
- Related: Product Specification §6.6.12 (post-meeting execution), §6.6.14
  (commitment tracking), §6.6.15 (fundraising display); ADR 0026

## Context

Decision #64 makes Q an opt-in, silent attendee whose debriefs update the
relationship record. The founder directed on 2026-09-29 that Q be present in
every meeting booked on Capital Q, keep the full transcript and a structured
record (who attended, what was agreed, what money was mentioned), and be able
to speak. The business reason: Capital Q facilitates capital, so the meetings
it arranges are the evidence of that facilitation; a record that depends on
someone remembering to invite Q is not a record.

## Decision

1. **Default presence, consent at booking.** Every call booked through
   Capital Q is recorded by Q unless a participant removes it. Consent is
   captured where the call is made: the calendar invite says that Q from
   Capital Q joins to keep the meeting record for both sides, and any
   participant may ask Q to leave, in the call or on the meeting in Capital
   Q. The bot joins under the name "Q (Capital Q notes)" so every attendee
   sees it. This keeps #64's consent requirement; it changes when consent is
   asked for (once, at booking) and the default (present).
2. **The record.** For each call Q keeps the full transcript (the call's own
   captions) and writes a structured record: summary, attendees, agreements,
   money mentioned (as commitment signals with a firmness, never as
   committed capital: §6.6.14 still requires human confirmation), flags and
   follow-ups. Every participant reads what was said (transcript, attendees,
   agreements, money mentioned); Q's analysis (summary, flags, follow-ups)
   is written for the person Q attended for and stays theirs, because one
   side's private Q analysis never reaches the other (spec §6.9.6). A
   separate debrief for the other side (PADL #64) is later work. A `meeting_held` relationship event marks the call on
   the relationship's history.
3. **Speaking.** Q stays silent by default and speaks only when addressed,
   answering only from context every participant may see (relationship-shared
   scope). Until that path is built and reviewed, Q does not speak.
4. **Unchanged.** Q never records a meeting booked outside Capital Q, never
   joins after being removed, and money said in a call never becomes
   committed capital without confirmation.

## Consequences

- Recall.ai (EU) bots run for every booked call; cost is per call-hour.
- `communication.meeting_assistants` gains transcript, attendees, agreements
  and commitment signals; read access extends to every participant.
- The founder is the authority for this amendment; the PADL entry for #64
  should be updated to point here.
