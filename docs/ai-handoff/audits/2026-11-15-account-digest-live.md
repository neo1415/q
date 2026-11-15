# Account digest: live check over HTTP (15 Nov 2026)

Production `30c99ccc5` (includes the account digest `1af6e1954`). HTTP API and hosted reads only: no browser, no Q turns. Window 02:54:01–02:54:13 UTC (digest calls); hosted reads to 03:00 UTC.

## Setup

- **Route:** `GET /v1/q/account-digest` on `capital-qq-api-production`, bearer token from a Supabase password grant (`CQ_SEED_ACCOUNT_PASSWORD`, public key from the web service's variables in a scratch file, deleted after the run). Three calls per account, the last body compared.
- **Accounts** (all `@fictional.capitalq.local`; profile ids):
  - Savanna: `investor.savanna-seed@` `d2ac720a` (investor org `1c4b9266`, tenant `dd0c703a`, gateway `bea02a7a`).
  - Watchly: `founder.fb0005.ama-okafor@` `ea854270` (company `526c2d72`).
  - Ajopot: `founder.ajopot@` `3acf2825` (company `91de2a77`).
  - Kilima: `investor.kilima-angels.njeri-kamau@` `d48458ac` (investor org `3f414d21`, gateway `1b4dfdfb`).
  - GateQ founder: `founder.fb0018.zawadi-abdi@` `42e39856` (Schemaora Systems, application `6f16ad1a` to Kilima, submitted 14 Nov 23:03).
- **Truth:** `hosted-read.mjs` against `network.relationships`, `communication.messages`, `q_runtime.approvals`/`actions`, `communication.meetings`, `q_runtime.delegations`/`errands`/`instruction_delegations`/`workforce_jobs`, `network.diligence_requests`/`diligence_fulfilments`, `gateq.application_submissions`/`inbox_user_state`/`inbox_messages`, `communication.notifications`.
- **Global facts:** no meeting in the next 14 days is live anywhere (the two Watchly × Savanna calls `460c95ba` and `0dd8ad3b` are `CANCELLED` since 14 Nov 22:59). No delegations, standing instructions or errands for any of the five. No gateway has a reply promise (`inbox_settings.reply_within_days` null).

## Results per account

### Savanna (investor)

| Section       | Match | Evidence                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relationships | Y     | Total 13; byStage CONNECTED 9, INTEREST_EXPRESSED 3, IN_DILIGENCE 1 equal the DB once the 2 DISCOVERED rows (Spheros `9187d708`, Tensorgate `06367f56`) are left out, as the relationships screen's party view leaves them out. 12 listed (cap), Kazikit `0989a281` only in `relationshipCounterpartIds`. Stage and stage-since match per id.                                                      |
| Owed replies  | Y     | YOU_OWE_REPLY: Watchly `3b5b294f` (company wrote last 13 Nov 23:25:59) and Clinicrest `e583f4d5` (4 Oct 07:34). AWAITING_THEM: Tallyloom, Ledgerfold, Maji Loop, Brightkloof, Tarmacly, Nsuo, Ajopot `3fa64633` (investor wrote last), plus Kivu `fbdd612e` and Sahel `3fa0cfcd` by AWAIT_ANSWER. Harbourline `fd009a3e` null (no messages). Every `lastMessageAt` equals the DB's latest message. |
| Approvals     | Y     | `waiting` holds `e57add5b`, `26cf5c25`, `7850ac2b` ("Message Ajopot"); DB: exactly these 3 PENDING, actions `e568cbc3`, `548927bc`, `5d8bec51`, all `chat.message.send` AWAITING_APPROVAL. `waitingTotal` 21, 10 listed (cap).                                                                                                                                                                     |
| Meetings      | Y     | `[]`; both calls in the window are CANCELLED. The "a call is not booked yet" items for Watchly agree with that.                                                                                                                                                                                                                                                                                    |
| Work/errands  | Y\*   | `[]`; no delegations, instructions or errands. \*See O2: three lead-Q jobs finished 12 Nov are not a WORK source.                                                                                                                                                                                                                                                                                  |
| Diligence     | Y     | Ajopot `3fa64633`, FROM_YOU, open 0, answered 2. DB: `8a4c795f` (cap table) and `77a16cba` (cohort table, 14 Nov 23:19) each have 1 fulfilment, no declines.                                                                                                                                                                                                                                       |
| GateQ         | Y     | Inbox "Savanna Seed Partners (fictional)": unread 0, fits 4, partial 0, not a fit 0, needs judgement 0. DB: 6 submissions, all QUALIFIED, all read by Amara, none answered; 4 carry rules (FITS view needs rules), 2 have none (Tensorgate `77e7304f`, Spheros `5bc3daac`). No reply promise, so 0 needing judgement is right. Top 3: `9ac8e432`, `ef8b98c9`, `496a4f85`, all open.                |
| Recent        | Y     | 4 Watchly events (13 Nov): message, connected, interest, discovered, matching the message and events. No other movement in 3 days.                                                                                                                                                                                                                                                                 |
| Unread        | Y     | `[]`.                                                                                                                                                                                                                                                                                                                                                                                              |

### Watchly founder (Ama Okafor)

| Section       | Match | Evidence                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Relationships | Y     | 2: Savanna `3b5b294f` CONNECTED since 13 Nov 21:49; The Vaultlyne `127884aa` INTEREST_EXPRESSED since 28 Oct (ANSWER_INTEREST). DB identical.                                                                                                                                                                                                                                                    |
| Owed replies  | Y     | Savanna AWAITING_THEM, last 13 Nov 23:25:59 (company wrote last). Vaultlyne null.                                                                                                                                                                                                                                                                                                                |
| Approvals     | Y     | None in `waiting`; DB has 0 PENDING for `ea854270`.                                                                                                                                                                                                                                                                                                                                              |
| Waiting       | **N** | 6 items, 3 of them stale (O1): notices `7432062d` and `745f7eb6` "Savanna suggested other times" for proposals `d3ed305c` and `7ae7ca6e`, both DECLINED; notice `90c9e877` "Savanna sent you a message" (13 Nov 21:56) though Watchly replied at 23:25. The meeting cancellations are unread too but not shown. `7432062d` also prints `2026-11-19T09:00:00.000Z (Africa/Lagos)` (D2 of 14 Nov). |
| Meetings      | Y     | `[]` (both calls cancelled).                                                                                                                                                                                                                                                                                                                                                                     |
| Work          | Y     | `[]`; none in DB.                                                                                                                                                                                                                                                                                                                                                                                |
| Diligence     | Y     | `[]`; no IN_DILIGENCE relationship.                                                                                                                                                                                                                                                                                                                                                              |
| GateQ         | Y     | `null`; Ama has no `gateq.application_founders` row.                                                                                                                                                                                                                                                                                                                                             |
| Recent        | Y     | Wrote to Savanna, connected, interest expressed (13 Nov). DISCOVERED is not shown to the company side.                                                                                                                                                                                                                                                                                           |
| Unread        | Y     | `[]`.                                                                                                                                                                                                                                                                                                                                                                                            |

### Ajopot founder

| Section       | Match | Evidence                                                                                                                                                                                                                                               |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Relationships | Y     | 6: Zino `e3f6fa11` CONNECTED, Savanna `3fa64633` IN_DILIGENCE, Vaultlyne `07ce1f8a` INTEREST_EXPRESSED, Voltron `5ef4d83d` and Ventures Platform `edd7a46f` CONNECTED, Lagoon `c3853533` DECLINED (listed last). States and dates identical to the DB. |
| Owed replies  | Y     | YOU_OWE_REPLY for Zino (investor wrote 8 Nov 07:14) and Savanna (investor wrote 3 Oct 08:56). Others null, with no messages in the DB.                                                                                                                 |
| Approvals     | Y     | None; DB 0 PENDING for `3acf2825`.                                                                                                                                                                                                                     |
| Meetings      | Y     | `[]`.                                                                                                                                                                                                                                                  |
| Work          | Y     | `[]`.                                                                                                                                                                                                                                                  |
| Diligence     | Y     | Savanna `3fa64633`, TO_YOU, open 0, answered 2 (`8a4c795f`, `77a16cba`, both fulfilled). Same two requests as Savanna's side, opposite direction.                                                                                                      |
| GateQ         | Y     | `null`; no applications.                                                                                                                                                                                                                               |
| Recent        | Y\*   | `[]`. No milestone or message in 3 days. \*Ajopot fulfilled `77a16cba` on 14 Nov 23:19, and a fulfilment is not a `recent` event source (O3).                                                                                                          |
| Unread        | Y     | `[]`.                                                                                                                                                                                                                                                  |

### Kilima (investor, GateQ inbox)

| Section       | Match | Evidence                                                                                                                                                                                                                                                                                                                |
| ------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relationships | Y     | 9, all INTEREST_EXPRESSED with ANSWER_INTEREST, owed null (Schemaora `bd316b23`, Quilla `b0e8085e`, Coverisk `9a22f570`, Swiftix `5567f72f`, Vendoreon `71f48a66`, Layerum `1b8759a8`, Routeix `66feaeae`, Branchari `e352c715`, Kazikit `dad0d418`). DB identical, no messages.                                        |
| Approvals     | Y     | None; DB 0 PENDING.                                                                                                                                                                                                                                                                                                     |
| Waiting       | Y     | `waitingTotal` 16: 8 interest requests listed plus "(and 1 more like this)" = 9, then NEEDS_YOU notices.                                                                                                                                                                                                                |
| Meetings      | Y     | `[]`.                                                                                                                                                                                                                                                                                                                   |
| Work          | Y     | `[]`.                                                                                                                                                                                                                                                                                                                   |
| Diligence     | Y     | `[]`; nothing IN_DILIGENCE.                                                                                                                                                                                                                                                                                             |
| GateQ         | Y     | Inbox "Kilima Angel Network (fictional) gate": unread 0, fits 6, partial 3, not a fit 0, needs judgement 0. DB: 9 submissions, 6 QUALIFIED (1 answered) and 3 UNRESOLVED, all read by Njeri, every one with 5 applicable rules, no reply promise. Top 3: Coverisk `c4cf20bd`, Vendoreon `53c68bb7`, Layerum `cdcf286b`. |
| Recent        | Y     | 6 newest "interest expressed" events of 13–14 Nov, newest first (cap 6).                                                                                                                                                                                                                                                |
| Unread        | Y     | `[]`.                                                                                                                                                                                                                                                                                                                   |

### GateQ founder (Zawadi Abdi, Schemaora Systems)

| Section       | Match | Evidence                                                                                                                                                                                  |
| ------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relationships | Y     | 1: Kilima `bd316b23` INTEREST_EXPRESSED, AWAIT_ANSWER, owed AWAITING_THEM.                                                                                                                |
| Waiting       | Y     | 0 items; no pending approvals or unread notifications in the DB.                                                                                                                          |
| GateQ         | Y     | applications `[6f16ad1a]`, fund "Kilima Angel Network (fictional)", SENT, sent 14 Nov 23:03:47, replyBy null (no reply promise); total 1; inbox null. DB: 1 submission, no inbox message. |
| Recent        | Y     | Kilima interest expressed and discovered (14 Nov 23:03).                                                                                                                                  |
| Others        | Y     | Meetings, work and requests `[]`; unread `[]`.                                                                                                                                            |

## Firewall

| Check                               | Result | Evidence                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Savanna: nothing of another tenant  | PASS   | Every relationship id and counterpart id is one of Savanna's own relationships. No Ajopot, Watchly or Kilima tenant id (`5eb18cdf`, `11e1bc01`, `a27357f9`), org id or user id. None of Ajopot's other investors (Vaultlyne, Zino, Lagoon, Voltron, Ventures Platform) or Kilima's applicants appear. |
| Savanna: no founder-private items   | PASS   | None of Ajopot's 8 `organisation_private` documents (ids or titles: financial model `0e8c5b8c`, seed deck `0302150a`, overview `42f6e840`, financial summary `f2437ed5`, product brief `0db0efaa`, investor deck `26b91f77`, two `acceptance-note`) appears. The diligence entry carries counts only. |
| Founders: no investor-private notes | PASS   | Savanna's only `network.relationship_notes` row (`f016bed1`, "M-verify private note …") and its id are absent from the Ajopot, Watchly and Zawadi digests, as are Savanna's approval ids and her other companies.                                                                                     |
| Kilima and Zawadi                   | PASS   | Kilima's digest has nothing of Savanna, Ajopot or Watchly. Zawadi's has no other applicant and no inbox counts (`inbox: null`).                                                                                                                                                                       |
| No model calls                      | PASS   | `ai_ops.model_usage`: 0 rows since 02:50 UTC for the 5 profile ids and their auth ids. The table was live: newest row 02:59:26, from other users.                                                                                                                                                     |

## Latency (3 sequential calls each, ms)

| Account | Calls          | p50 |
| ------- | -------------- | --- |
| Savanna | 545, 835, 1653 | 835 |
| Watchly | 250, 279, 309  | 279 |
| Ajopot  | 410, 460, 493  | 460 |
| Kilima  | 241, 283, 302  | 283 |
| Zawadi  | 228, 248, 268  | 248 |

Savanna is the largest account (15 relationships, 6 submissions, 36 unread notifications). One of her calls took 1.65 s, beyond the 1.5 s per-section deadline. No section was reported as `unread` in the body that was kept.

## Observations

- **O1 (medium): stale "waiting" notices reach the digest.**
  - The attention NOTICE source lists every unread `NEEDS_YOU` notification, with no check against current state.
  - Watchly's digest therefore tells Q that Savanna "suggested other times" for two proposals that are DECLINED, and that Savanna "sent you a message" after Watchly had already replied.
  - This is inherited from the attention report, not new in the digest, but the digest now gives it to every Q turn.
  - File: `apps/q-api/src/composition/attention-sources.ts` (NOTICE). Possible fixes: reconcile TIME_PROPOSED against `meeting_time_proposals.state` and CHAT_MESSAGE against the last sender, or mark them read when superseded.
- **O2 (low): lead-Q jobs are not a WORK source.**
  - WORK is read from `createWorkPort.list` (delegations and standing instructions) and errands.
  - Savanna's `q_runtime.workforce_jobs` `072918f2`, `0cc22b2f` and `1f8d3ce4` finished on 12 Nov, inside the 3-day "finished lately" window, and are absent. So is her HELD job `c6a39428` of 15 Oct, which is also older than the attention report's 14 days.
  - Files: `apps/q-api/src/composition/work/actions.ts` (`list`) and `packages/q-tools/src/tools/account-digest.ts` (`digestWork`).
- **O3 (low): diligence fulfilments are not `recent` events.**
  - `recent` holds stage milestones, the last message and Q activity only.
  - Ajopot's fulfilment of `77a16cba` (14 Nov 23:19) shows in neither side's `recent`. The REQUESTS counts are correct.
- **O4 (info): the meeting positive path is unverified live.**
  - No call is scheduled in the next 14 days in production, so the `startsAt` plus `timeZone` pair could not be checked on a real row.
  - The contract carries UTC plus the zone, not a pre-rendered local label. The "labelled time" depends on the consumer formatting it.
- **O5 (info): DISCOVERED-only relationships are not listed.**
  - Savanna's Spheros and Tensorgate rows are left out of the totals and `byStage`.
  - This is consistent with the relationships screen (party-visible projection), so it is not a digest defect.
