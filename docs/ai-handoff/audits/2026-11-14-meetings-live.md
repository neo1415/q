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

## Re-check 14 Nov (78f8d72d5)

Production `78f8d72d5` (includes the meetings fix `0694fa3a2`). HTTP API and hosted reads only: no browser, no Q turns. Window 22:58–22:59 UTC. Same pair, members and sign-in as above; the relationship was CONNECTED before and after, and still no member of either organisation has a row in `integrations.google_accounts`.

| #   | Step                                                                                    | Verdict | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Founder proposes 17 Nov and 18 Nov, 10:00 WAT                                           | PASS    | Proposal C `7ae7ca6e-3767-490a-a6ef-a2048b89297c` returned 201 `INVESTOR_REVIEW`. One TIME_PROPOSED to Savanna, body "1. Tue 17 Nov, 10:00 West Africa Time / 2. Wed 18 Nov, 10:00 West Africa Time" (D2 fixed).                                                                                                                                                                                                                                                                                                     |
| 2a  | Savanna counters (20 Nov 10:00 and 15:00 WAT)                                           | PASS    | 200 `COUNTERPROPOSED`, `booked: false`. One TIME_PROPOSED to each of the 3 Watchly members (`…7ae7ca6e…:r1:counter`), times labelled "Fri 20 Nov, 10:00 West Africa Time".                                                                                                                                                                                                                                                                                                                                           |
| 2b  | Founder declines the counter                                                            | PASS    | 200 `DECLINED`, `booked: false`. Savanna got exactly one notice, "Watchly declined the times you suggested" (`…:r1:counter-declined`) (D3 fixed).                                                                                                                                                                                                                                                                                                                                                                    |
| 3   | Fresh proposal D, Savanna accepts option 0                                              | PASS    | D `dbc97d89-f4a7-4954-9322-24fe046cd22f` 201; accept 200 `CONFIRMED`, `booked: true`, `calendarInvite: false` (D1 fixed), meeting `0dd8ad3b-5437-4d37-8aa6-800d18f0a628`. Row: `SCHEDULED`, 23 Nov 09:00Z, `google_event_id` `nocal0dd8ad3b…` (D6 fixed), organiser Savanna. All 4 MEETING_SCHEDULED bodies start "Mon 23 Nov, 10:00 West Africa Time · No calendar invite was sent…"; Savanna's is the "Booked:" notice with the zone (D4 fixed). 4 MEETING_PREP_READY. One `meeting_scheduled` relationship event. |
| 4a  | Move the new meeting as organiser                                                       | NOT RUN | No HTTP route moves a meeting. `schedule.reschedule` is reachable only through Q's `meeting.reschedule` approval action (`apps/q-api/src/composition/schedule-actions.ts`), which needs a Q turn. The code path for a no-calendar row (`service.ts` reschedule: skips the calendar, sends "Call moved" to attendees once per new time) was read, not exercised. See D7.                                                                                                                                              |
| 4b  | Cancel `0dd8ad3b` as organiser (Savanna)                                                | PASS    | `POST /v1/meetings/0dd8ad3b…/cancel` 204. Row `CANCELLED`. One MEETING_CANCELLED "Call cancelled: Re-check 14 Nov: booked call" to each of the 3 Watchly members; one `meeting_cancelled` event. No calendar connected and no calendar error.                                                                                                                                                                                                                                                                        |
| 5   | Cancel the older meeting `460c95ba` (pre-fix row: Google-shaped id, key `:no-calendar`) | PASS    | 204, row `CANCELLED`, one "Call cancelled" to each Watchly member, one `meeting_cancelled` event, no calendar error (the `:no-calendar` key routes it past the calendar). Move not run (4a).                                                                                                                                                                                                                                                                                                                         |
| 6   | Replays with the same idempotency key (accept on D; each cancel)                        | PASS    | Accept replay 200 with the same `meetingId`, `booked: true`, `calendarInvite: false`. Each cancel replay 204. Still 2 meetings on the relationship, no notification created after the first call of each (0 after 22:59:22), 3 proposal events on D.                                                                                                                                                                                                                                                                 |
| 7   | No model calls                                                                          | PASS    | `ai_ops.model_usage`: 0 rows for the 4 profile ids and 4 auth ids since 22:58 UTC.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### New findings

- **D7 (medium): a meeting cannot be moved without Q, and a "move" proposal does not move anything.**
  - No HTTP route calls `schedule.reschedule`; only Q's `meeting.reschedule` action does.
  - `ProposeMeetingTimeRequest.rescheduleOfMeetingId` is stored (`proposal-postgres.ts`) but never read when the proposal is confirmed, so accepting a "move" proposal books a second meeting and leaves the original scheduled.
  - Files: `packages/communication/src/schedule/proposal.ts` / `proposal-port.ts` (booking on confirm), `packages/contracts/src/http/schedule.ts` (no move route).
- **D8 (low): the investor's decline notice points at an action the investor cannot take.**
  - "Watchly declined the times you suggested … You can propose other times on the relationship page." The investor cannot propose (`propose` refuses `ROLE_NOT_ALLOWED` for the investor side); they can only counter an open proposal.
  - File: `packages/communication/src/schedule/proposal-port.ts` (decline notice body).
- **Watchly members have no profile time zone** (`identity.user_profiles.timezone` null), so their notices use the option's own zone. Correct here, but untested for a founder in another zone.

### Rows left in production (fictional pair)

- Proposals `7ae7ca6e` (DECLINED) and `dbc97d89` (CONFIRMED).
- Meetings `0dd8ad3b` and `460c95ba`, both `CANCELLED`.
- 6 TIME_PROPOSED-kind notices, 4 MEETING_SCHEDULED, 4 MEETING_PREP_READY, 6 MEETING_CANCELLED.
- Relationship events: one `meeting_scheduled`, two `meeting_cancelled`.

## Move re-check 15 Nov (318577a8e)

Production `318577a8e` (includes the move fix `b4c18bb25`). HTTP API and hosted reads only: no browser, no Q turns. Window 06:22–06:26 UTC. Same pair, members and sign-in as above. The relationship was CONNECTED before and after. No member of either organisation has a row in `integrations.google_accounts` (checked by auth id and profile id).

| #   | Step                                                                     | Verdict | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Founder proposes 18 Nov 10:00 and 19 Nov 11:00 WAT; Savanna accepts 0    | PASS    | Proposal `ecc4c7be` 201, then accept 200 `CONFIRMED`, `booked: true`, `calendarInvite: false`. Meeting M `dde03ec2-8905-4a31-ba2e-aaa905fc47ab`: `SCHEDULED`, 18 Nov 09:00Z, `google_event_id` `nocal…`, organiser Savanna.                                                                                                                                                                                                                                                                                                                                 |
| 2   | Founder proposes a move of M (20 Nov 14:00, 24 Nov 10:00 WAT)            | PASS\*  | `POST …/meeting-proposals` with `rescheduleOfMeetingId` M: 201 `INVESTOR_REVIEW`, and `reschedule_of_meeting_id` is stored. \*The TIME_PROPOSED to Savanna does not say it is a move: title "Watchly proposed times for a call", body ends "Nothing is booked until a time is accepted." The DTO has no `rescheduleOfMeetingId` either. Only Q's card says "This moves the call…". See D10.                                                                                                                                                                 |
| 3   | Savanna accepts option 0                                                 | PARTIAL | The move itself is correct. M is the same row, still `SCHEDULED`, now 20 Nov 13:00Z–13:45Z. One `meeting_rescheduled` event. "Call moved: … Now Fri 20 Nov, 14:00 West Africa Time. No calendar invite was sent…" went once to each of the 3 Watchly members, and nothing went to Savanna, who moved it. Still 3 meetings on the relationship (2 old cancelled plus M), so no second meeting was booked. **But the response is wrong:** 200 `CONFIRMED` with `meetingId: null` and `booked: false`, and the proposal row's `meeting_id` stays null. See D9. |
| 4   | Accept repeated with the original key (`live-move-am-…`), then a new key | PASS    | The same key returned 200 with the same (wrong) body: still `meetingId: null`, `booked: false`. A new key got 409 "That proposal has moved on". Still 3 meetings. M's `updated_at` was unchanged. Still 1 `meeting_rescheduled`, 3 proposal events, and 0 notices after the first accept.                                                                                                                                                                                                                                                                   |
| 5   | Propose a move of cancelled `0dd8ad3b` and of cancelled `460c95ba`       | PASS    | Both returned 409 `RESOURCE_CONFLICT`, detail "That call can't be moved: it was cancelled, has already started, or its organiser has to move it. Propose a new call instead." (the HTTP form of MEETING_NOT_MOVABLE). No proposal row was created for either.                                                                                                                                                                                                                                                                                               |
| 6   | Founder declines a Savanna counter (proposal `98ba7050`)                 | PASS    | Savanna got exactly one "Watchly declined the times you suggested", ending "Nothing is booked. They may suggest new times, or you can message them on the relationship page." (D8 fixed).                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | Cancel M as organiser (Savanna), then replay with the same key           | PASS    | 204 and 204. M is `CANCELLED`. One `meeting_cancelled` event. One "Call cancelled: Move re-check 15 Nov: booked call" went to each of the 3 Watchly members, and nothing more on the replay.                                                                                                                                                                                                                                                                                                                                                                |
| 8   | No model calls from this run                                             | PASS\*  | `ai_ops.model_usage`: 0 rows for the Watchly members. There were 0 rows for anyone during steps 1–5 (06:22–06:25:05). Savanna has 27 rows from 06:25:06. They come from 4 browser Q runs ("How solid is Kazikit's revenue?…", "What's waiting for me?", screens `HOME`/`COMPANY`) in the parallel live browser test signed in as Savanna, not from these HTTP calls.                                                                                                                                                                                        |

### New findings

- **D9 (medium): an accepted move answers `booked: false, meetingId: null`, although the meeting moved.**
  - `bookAccepted` (`packages/communication/src/schedule/proposal.ts`) calls `store.attachMeeting(proposal.id, M)` after the move.
  - The partial unique index `meeting_time_proposals_meeting_idx` on `meeting_id` (migration `20261222130000_communication_meeting_time_proposals.sql`) already holds M for the original proposal `ecc4c7be`. The update therefore fails, the `catch` logs "not booked yet; it stays accepted and is retried", and the response says not booked.
  - Effects:
    - The web client and Q's accept outcome read it as not moved; Q's text would be "The call hasn't moved yet; it stays at its old time".
    - Every retry re-runs `moveAgreed`, which is harmless because it is idempotent by time.
    - The proposal never links to its meeting.
  - The unit tests use an in-memory store without the index.
  - Possible fix: for a move, return the moved meeting without attaching it, or link it through `reschedule_of_meeting_id`. The alternative, scoping the index, would need a migration.
- **D10 (low): the move proposal's notice does not say it is a move.**
  - The investor reads "proposed times for a call … Nothing is booked until a time is accepted." while a call is already booked.
  - The HTTP DTO has no `rescheduleOfMeetingId`, so the web page cannot say it either.
  - Files: `packages/communication/src/schedule/proposal-port.ts` (`noticesFor`) and `packages/contracts/src/http/schedule.ts` (`MeetingTimeProposalDtoSchema`).

### Rows left in production (fictional pair)

- Proposals:
  - `ecc4c7be` (CONFIRMED, meeting M);
  - `77f82b39` (CONFIRMED move of M, `meeting_id` null: D9);
  - `98ba7050` (DECLINED).
- Meeting `dde03ec2` is `CANCELLED`; its last time was 20 Nov 13:00Z.
- Notifications:
  - 7 TIME_PROPOSED-kind;
  - 7 MEETING_SCHEDULED-kind (3 "New call", 1 "Booked", 3 "Call moved");
  - 4 "Rehearse your call";
  - 3 MEETING_CANCELLED.
- Relationship events: one each of `meeting_scheduled`, `meeting_rescheduled` and `meeting_cancelled`.
