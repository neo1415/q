# Meeting proposals B1/B2: live check over HTTP (14 Nov 2026)

Production `06910b145` (includes `2e1fb1d33`). HTTP API and hosted reads only: no browser, no Q turns. Window 18:28–18:31 UTC.

## Setup

- **Pair:** Watchly × Savanna Seed Partners (fictional), relationship `3b5b294f-8bd1-426c-bfa9-61ebe90f13d0`. It was CONNECTED before the run and is still CONNECTED after it.
- **Watchly members** (all `@fictional.capitalq.local`, profile ids):
  - Ama Okafor `ea854270`, the founder who acts;
  - Kelechi Nwosu `db06daee`;
  - Segun Nwosu `760e2a3a`.
- **Savanna member:** Amara Diallo-Benson `d2ac720a` (`investor.savanna-seed@`), the only member.
- **Starting state:**
  - Nobody in either organisation has a row in `integrations.google_accounts`, so no calendar is connected and no real invite can go out.
  - The relationship had no earlier proposals or meetings.
- **How the run signed in:** Supabase password grant using the public key from the web service's variables. Calls went to `capital-qapi-production` with a bearer token and an `idempotency-key` header.
- **Re-proposal:** the HTTP routes have no re-propose step (the state machine's `REPROPOSE` is not routed). The founder therefore declined the counter and sent a fresh proposal with the counter's times.

## Steps

| #   | Step                                                                           | Verdict | Evidence                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Founder proposes 3 Lagos-hour slots (17 Nov 10:00 and 14:00; 18 Nov 11:00 WAT) | PASS    | Proposal A `d3ed305c-86e2-4b74-9e5d-9054e2450ea7` returned 201 in `INVESTOR_REVIEW`. Exactly one TIME_PROPOSED went to the single Savanna member (dedupe `time_proposed:proposal:d3ed305c…:r1`, count 1).                                                                                                                                       |
| 2   | Savanna counters (19 Nov 10:00 and 15:00 WAT)                                  | PASS    | 200, `COUNTERPROPOSED`. Exactly one TIME_PROPOSED went to each of the three Watchly members (dedupe `…:r1:counter`, count 3). Title: "Savanna Seed Partners (fictional) suggested other times for the call".                                                                                                                                    |
| 3a  | Founder declines the counter, then proposes again                              | PASS    | A returned 200 `DECLINED` (event `COUNTER_DECLINED`). Proposal B `5758eff7-bdac-4f34-82ae-1ab38c2d6d97` returned 201 `INVESTOR_REVIEW`, with one TIME_PROPOSED to Savanna (`…5758eff7…:r1`).                                                                                                                                                    |
| 3b  | Savanna accepts option 0                                                       | PASS\*  | 200, `state: CONFIRMED`, `confirmed: true`, `meetingId: 460c95ba-af54-4ebb-85d7-8753137d009b`. \*The HTTP DTO has no `booked` or `calendarInvite` field (see D1). Booking is shown by the non-null `meetingId` and by the meeting row's `idempotency_key` ending `:booking:no-calendar` (the `recordAgreed` fallback).                          |
| 4   | Meeting row and notices                                                        | PASS    | One meeting row: `SCHEDULED`, 19 Nov 09:00Z (10:00 WAT), `meet_link` null, organiser Savanna, `origin: BOOKED`. Relationship event `meeting_scheduled` was written. MEETING_SCHEDULED went to all 4 people (3 Watchly, 1 Savanna), each with "No calendar invite was sent: no Google Calendar is connected…". MEETING_PREP_READY went to all 4. |
| 5   | Accept repeated with the same idempotency key                                  | PASS    | 200, the same proposal and the same `meetingId`. Still 1 meeting. Still 4 MEETING_SCHEDULED and 4 MEETING_PREP_READY, with no newer `created_at`. No new proposal event.                                                                                                                                                                        |
| 6   | No model calls                                                                 | PASS    | `ai_ops.model_usage`: 0 rows for the 4 profile ids and the 2 auth ids since 18:28 UTC.                                                                                                                                                                                                                                                          |

## Defects and observations

- **D1 (low): the HTTP accept response has no `booked` or `calendarInvite`.**
  - `respondHttp` returns only `proposalDto`.
  - So a web client cannot tell a calendar booking from a no-invite booking, and cannot show the "no calendar invite" line that Q's `done` text gives.
  - Files: `packages/app-actions/src/actions/schedule-proposals.ts` (`respondHttp`) and `packages/contracts/src/http/schedule.ts` (`MeetingTimeProposalDtoSchema`).
- **D2 (low): proposal times are printed in UTC under a Lagos label.**
  - The TIME_PROPOSED body prints raw UTC ISO strings tagged with the zone, for example `2026-11-17T09:00:00.000Z (Africa/Lagos)`.
  - That reads as 09:00 Lagos when the slot is 10:00 WAT.
  - File: `packages/communication/src/schedule/proposal-port.ts` (`timesOf`). The `when` helper in `schedule-proposals.ts` does the same on Q cards.
- **D3 (low): the other side is not told about a decline.**
  - The founder's `COUNTER_DECLINED` sent nothing to Savanna: 0 notices between 18:29:35 and 18:29:41.
  - The decline action's `does` text says "the other side is told".
  - File: `packages/communication/src/schedule/proposal.ts` (respond: `tell` covers only COUNTERPROPOSED and PROPOSED).
- **D4 (info): the founder side's MEETING_SCHEDULED body has no time.**
  - The Watchly side's body is the no-invite note alone. The organiser's "Booked" notice has "Thu 19 Nov, 10:00" but no zone.
  - File: `packages/communication/src/schedule/service.ts` (recordAgreed notices).
- **D5 (info): re-proposing is not routed.**
  - `REPROPOSE` exists in the state machine, but there is no HTTP route or Q tool for it.
  - The only path is decline plus a new proposal.
- **D6 (info): a calendar event id is stored although no calendar event exists.**
  - `google_event_id` is filled with the deterministic `googleEventIdFor(meetingId)` value.
  - A later move or cancel of this meeting would call the calendar adapter for an event that does not exist. This was not exercised here.

## Rows left in production (fictional pair)

- Proposals `d3ed305c` (DECLINED) and `5758eff7` (CONFIRMED).
- Meeting `460c95ba-af54-4ebb-85d7-8753137d009b`, scheduled for 19 Nov 09:00Z.
- 5 TIME_PROPOSED, 4 MEETING_SCHEDULED and 4 MEETING_PREP_READY notifications.
- One `meeting_scheduled` relationship event.
