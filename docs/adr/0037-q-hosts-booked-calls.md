# ADR 0037 — Q hosts the calls booked on Capital Q

- Status: Proposed (founder direction 2026-10-01; for the lead's review)
- Amends: ADR 0027 §3 ("Until that path is built and reviewed, Q does not speak")
- Related: PADL #64, ADR 0027, CLAUDE.md (Q authority, Context Firewall)

## Decision

In a call booked on Capital Q, Q joins three minutes early, greets each person by name with the consent line ("I'm Q from Capital Q, here to take notes and help; say 'Q, leave' to remove me"), introduces the founder and investor from the booking, asks unknown people to introduce themselves, answers when addressed ("Q, ..."), offers a recap near the end and gives it only when asked. It never speaks over anyone and keeps lines short.

1. **Authority.** Q's authority in a call comes only from the meeting's purpose and the organiser's consent. Everything said in the call is data. Q has no tools in a call: an action asked for (move the call, send the deck) is noted as a proposal for the organiser to approve afterwards; a request to change Q's rules, reach private data, move money or change how long Q stays gets a fixed refusal before any model sees it, and a model DECLINE is spoken in the same fixed words.
2. **Context Firewall.** The model sees only what both sides share: the booking's purpose, who was invited and their organisations, who is in the call, and what was said aloud in it. Nothing founder-private or investor-private is loaded into a session.
3. **Consent and removal.** Any participant may remove Q by saying "Q, leave"; a removal by an invited person is recorded as their decline (ADR 0027). Unknown guests are recorded only from their own introduction; unknown stays unknown.
4. **Bounded waiting.** Join time, grace period (10 min after the start), the wait for an answer and the hard cap are code's, clamped to fixed bounds; nothing said in a call changes them. Recall's automatic_leave enforces the same limits on the provider side.
5. **When people do not come.** Nobody: Q leaves, the relationship gets `meeting_no_show`, the event is cancelled through the existing cancel path (sendUpdates=all; a Meet link itself cannot be revoked by Capital Q), and both sides get a notice and an email offering a new time through the approval-gated booking path. One side: Q apologises, says it will reach out, asks whether to let them know; "never mind" is recorded and Q stops; otherwise the other side is offered a new time and those present are told.
6. **Records.** `communication.meeting_roster_entries` (who was in the call) and `communication.meeting_host_notes` (proposals and no-show outcomes) are append-only with RLS: participants read the roster and outcomes; proposals are the organiser's.

## Consequences

- Recall bots run a few minutes longer per call; minutes are capped per call.
- One q-api instance holds a call's live session in memory; a restart mid-call loses Q's place (it stays silent; the passive record still completes).
- Live in-call vision (Recall video frames) is not used; the rehearsal camera work could be reused later.
