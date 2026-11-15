# Relationship actions: live check over HTTP (15 Nov 2026)

Production `84ac9afa7` on all four services (Railway deployments 14:36 UTC). HTTP API and hosted reads only: no browser, no Q turns, no model calls. Window 15:44:44–15:51:22 UTC. Follows `audits/2026-11-15-demo-readiness.md` §8 and `audits/2026-11-14-meetings-diligence-journey-map.md` (S4–S6).

## Setup

- **Sign-in:** Supabase password grant with `CQ_SEED_ACCOUNT_PASSWORD`. The public key came from the web service's variables, was kept in a scratch file, and was deleted after the run. Calls went to `capital-qapi-production`, and the digest to `capital-qq-api-production`, with a bearer token and, where a route takes one, an `idempotency-key` header.
- **Pairs.** A hosted read confirmed that every active member of both organisations in each pair is `@fictional.capitalq.local`. No Ledgerline or Baridi.

| Use                      | Pair                                        | Relationship | Members               |
| ------------------------ | ------------------------------------------- | ------------ | --------------------- |
| Data room: grant         | Savanna Seed (fictional) × Ajopot           | `3fa64633`   | Savanna 1, Ajopot 2   |
| Data room: decline       | Savanna Seed (fictional) × Nsuo Labs        | `aca80528`   | Savanna 1, Nsuo 2     |
| Interest decline (fresh) | Tidewater Growth (fictional) → Nsuo Labs    | `33bf85d3`   | Tidewater 1, Nsuo 2   |
| Pass, pause and resume   | Equator Line Capital (fictional) × Tarmacly | `39590df2`   | Equator 1, Tarmacly 3 |

- **Truth:** `hosted-read` against these tables:
  - `network.relationships` and `relationship_events`;
  - `evidence.data_room_access_requests` and `data_room_request_decisions`;
  - `permissions.disclosure_policies`;
  - `network.relationship_passes` and `relationship_reports`;
  - `communication.notifications`;
  - `ai_ops.model_usage`.
- **Digest:** `GET /v1/q/account-digest` for both sides, before and after each step.

## Routes and app actions used

| Step                       | Route                                                       | App action                        |
| -------------------------- | ----------------------------------------------------------- | --------------------------------- |
| Investor asks for document | `POST /v1/companies/:companyId/data-room/requests`          | `request_data_room_access` (tool) |
| Founder approves/declines  | `POST /v1/data-room/requests/:requestId/decision`           | `answer_data_room_request` (tool) |
| Investor opens document    | `GET /v1/companies/:companyId/data-room/documents/:id/open` | read                              |
| Founder revokes share      | `POST /v1/data-room/grants/:policyId/revoke`                | `document.access.revoke`          |
| Express interest           | `POST /v1/network/companies/:companyId/express-interest`    | express interest                  |
| Decline interest           | `POST /v1/network/interests/:interestId/decline`            | `relationship.interest.decline`   |
| Pass / pause / resume      | `POST /v1/network/relationships/:id/{pass,pause,resume}`    | `relationship.outcome.*`          |

## 1. Data room: on-request ask, grant, decline

**Verdict: FAIL.** The access logic, events, idempotency and digest all pass. **No notice reaches either side (D1).**

| #   | Step                                                           | Verdict  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a  | Before: Savanna's view of the on-request document              | PASS     | "Ajopot financial summary, founder claim (fictional)" `f2437ed5` shows `ON_REQUEST`/`REQUESTABLE`. `…/open` returns 404.                                                                                                                                                                                                                                                                                                                |
| 1b  | Savanna asks for it (with a note)                              | PASS     | 201, request `fab67394-b2f1-4847-a75d-6abc1e43f869` `OPEN`. A replay with the same key returned 200 with the same id. One `data_room_access_requested` event (seq 18).                                                                                                                                                                                                                                                                  |
| 1c  | The founder sees the request                                   | PASS\*   | The owner's data room lists it `OPEN` with requester "Amara Diallo-Benson", the firm and the note. Ajopot's digest `waiting` has `dataroom:fab67394…` (`DOCUMENT_REQUEST`, decidable). \***No notification row was written (D1).**                                                                                                                                                                                                      |
| 1d  | The founder approves for 7 days; replays                       | PASS     | 200 `APPROVED`. The same key replayed returned 200 with the same body, and a new key got 409 "That request was already answered". Rows: decision `APPROVED`, expiring 22 Nov 15:46Z; one `data_room_access_granted` event (seq 19) with disclosure policy `4afb2591-832a-4b1f-8500-bb27f3d39dda`; one policy only.                                                                                                                      |
| 1e  | Savanna can now read it                                        | PASS     | The view shows `SHARED`/`OPEN` with `accessEndsAt` 22 Nov. `…/open` returns 200. The bytes come from a **Supabase Storage signed URL** (`<project>.supabase.co/storage/v1/object/sign/cq-documents-private/…`), which lives 60 s, with `downloadable: false` and the watermark "Amara Diallo-Benson · Savanna Seed Partners (fictional) · 2026-11-15 · view only". No bytes went through the app origin; the metadata only was fetched. |
| 1f  | Savanna is told it was shared                                  | **FAIL** | No notification (D1). The investor digest has no line for the share (D2).                                                                                                                                                                                                                                                                                                                                                               |
| 1g  | Second request: Savanna asks Nsuo Labs for its on-request file | PASS\*   | 201, request `f1dc934b-f21f-4b85-beed-553749c4cfd0`. Event `data_room_access_requested` (seq 6 on `aca80528`). The founder's view lists it. \*No notification (D1).                                                                                                                                                                                                                                                                     |
| 1h  | The Nsuo founder declines with no reason; replays              | PASS     | 200 `DECLINED`. The same key replayed returned 200 with the same body, and a new key got 409. Savanna's view shows `REQUESTABLE` with `declined: {note: null}`, which is honest and gives no reason.                                                                                                                                                                                                                                    |
| 1i  | Savanna is told about the decline                              | **FAIL** | No notification (D1). The decline writes no relationship event either (D2).                                                                                                                                                                                                                                                                                                                                                             |
| 1j  | Digests after                                                  | PASS     | Ajopot's `dataroom:fab67394` item is gone once approved, so nothing stale says "needs you". Nsuo has no item for the declined request. Savanna's stages are unchanged (IN_DILIGENCE, CONNECTED).                                                                                                                                                                                                                                        |
| 1k  | Clean-up: Ajopot revokes the share                             | PASS     | `POST …/grants/4afb2591…/revoke` returned 200 `{changed:1}` and the policy `revoked_at` is 15:50:29Z. `…/open` is 404 again and the document shows `REQUESTABLE`, so the demo ask can be run again.                                                                                                                                                                                                                                     |

## 2. Founder declines a fresh interest

**Verdict: PASS.**

| #   | Step                                              | Verdict | Evidence                                                                                                                                                                                                                               |
| --- | ------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2a  | Tidewater expresses interest in Nsuo Labs (fresh) | PASS    | 201, interest `03f94f61-c90e-41e5-850e-b011167e4341`, new relationship `33bf85d3-a813-4c6c-9dab-1ae0f5fa6fa0` (`discovered`, `interest_expressed`). One INTEREST_RECEIVED went to each of the 2 Nsuo members (`a9632a8c`, `e65b2588`). |
| 2b  | The Nsuo founder declines; replays                | PASS    | 201 `DECLINED`. The same key replayed returned 200 with the cached body; a new key returned 200 `deduplicated: true`. One `interest_declined` event (seq 3), and the relationship is `DECLINED`.                                       |
| 2c  | Nobody is notified                                | PASS    | No new notification for Tidewater or anyone else. The 2 INTEREST_RECEIVED notices were marked read at 15:48:18 (resolved, not deleted).                                                                                                |
| 2d  | Digests                                           | PASS    | Nsuo: stage DECLINED, next step NONE; both "waiting" items for Tidewater are gone; recent "Tidewater …: declined". Tidewater: stage DECLINED, recent "Nsuo Labs: declined". Nothing stale.                                             |

## 3. Investor pass with a shared reason, then pause and resume

**Verdict: PASS.**

| #   | Step                                                              | Verdict | Evidence                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3a  | Equator passes (TIMING, with a note, `shareWithFounder: true`)    | PASS    | 201. Pass `9d1371e5-5071-48ce-989f-354c88f80e6d` `share_with_founder` true. Event `relationship_passed` (seq 4, `reasonShared: true`). State PASSED. The PASS report `01571611` is `investor_private`. The same key replayed returned 200; a new key returned 200 `deduplicated: true`, with no second pass row or event. |
| 3b  | Tarmacly's members get RELATIONSHIP_OUTCOME once, with the reason | PASS    | One notice to each of the 3 members ("Equator Line Capital (fictional) has decided not to proceed for now"), body `Their reason: Timing. "Live check 15 Nov (fictional): our fund is fully deployed this quarter."` (dedupe `relationship_outcome:0c8686f4…`). Equator received none.                                     |
| 3c  | Resume from the pass; pause; resume; each replayed                | PASS    | Each first call returned 201 and each replay 200 `deduplicated: true`. Events: `relationship_resumed` (5), `relationship_paused` (6), `relationship_resumed` (7), one each. The state went PASSED → CONNECTED → PAUSED → CONNECTED. Events are append-only: 4 new rows, nothing changed.                                  |
| 3d  | Notices once each                                                 | PASS    | 3 × "has picked things up again", 3 × "has paused for now" ("Nothing else changes; they can pick it up again."), and 3 × "has picked things up again", each with its own dedupe key. In total, 4 notices per Tarmacly member and none for replays.                                                                        |
| 3e  | Digests follow the stage                                          | PASS    | After the pass, both sides show PASSED, next NONE, and the "call not booked" item drops. After the pause: PAUSED, with the investor's next step RESUME. After the final resume: CONNECTED, SCHEDULE_MEETING, and the "call not booked" item returns. Nothing stale. (See O2.)                                             |

## 4. Deal and commitment (inspected, not executed)

The state machine is `deal-stage.v1` (`packages/network/src/domain/deal-stage.ts`): MET → DILIGENCE → SOFT_COMMIT → TERMS → SIGNED → FUNDS_RECEIVED → CLOSED. The read-only `GET /v1/network/relationships/3fa64633…/deal` for Savanna shows `current: DILIGENCE`, `nextSteps: [SOFT_COMMIT, PASS]`, no terms and no commitments.

A demo of the full chain needs these steps, each consequential (MONEY or TERMS) and each idempotent by key:

1. **Soft commit.** One side states an amount: `POST /v1/network/relationships/:id/commitments` (`amount` as a decimal string plus `currencyCode`, `level` SOFT/FIRM/INVESTED; connected only). The **other** side confirms it: `POST /v1/network/commitments/:id/confirm`. SOFT_COMMIT is reached only on `commitment_confirmed`. The statement route is a plain route in `apps/api/src/http/commitments.ts` and not a declared app action, so Q cannot state an amount (O5).
2. **Terms:** `POST …/deal/terms` (`relationship.deal.terms`) needs SOFT_COMMIT and nothing SIGNED. Any `termsDocumentId` must already be shared on the relationship.
3. **Signed:** `POST …/deal/signed` takes `termsId` (it must equal the current version, otherwise TERMS_CHANGED) and `signedDocumentId`. That document must be shared on the relationship (a `document_shared` or `data_room_access_granted` event). The fictional pair therefore needs a signed copy uploaded and shared first.
4. **Funds:** the investor marks the money sent (`capital.commitment.mark_sent`), then the company confirms receipt (`capital.commitment.confirm_received`). That gives FUNDS_RECEIVED, and the relationship goes to INVESTED (relationship-state.v2). COMMITMENT notices go to the other side.
5. **Close:** `POST …/deal/close` needs SIGNED, FUNDS_RECEIVED, a terms id and a commitment id, and writes the closing report. After that come the checklist ticks.

This should run on a fresh fictional pair, not Savanna × Ajopot: the money and terms rows are permanent, and INVESTED changes the pair's demo story. The owner's go-ahead is needed.

## No model calls

`ai_ops.model_usage` had 0 rows since 15:44:00 UTC for the 10 profile ids and 10 auth ids involved. All 50 rows in the window belong to the parallel browser test's new investor account (`e2e-inv-2026…@fictional.capitalq.local`, `cb2c0cf5`), plus 1 row with no user.

## Defects and observations

- **D1 (high): data-room and founder-documents notices are never written.**
  - `createCounterpartNotices` (`packages/communication/src/counterpart-notices.ts`) builds `link_path` as follows:
    - `/documents?tab=requested&item=<id>` for target `DOCUMENTS`;
    - `/company/<id>#data-room` for `COMPANY_PROFILE`.
  - Both break `notifications_link_path_check` (`^/[A-Za-z0-9/_-]{0,200}$`, migration `20261019090000_communication_meetings_reminders.sql`).
  - The data-room service's `notifyQuietly` (`packages/permissions/src/application/data-room.ts`) swallows the error with no log.
  - Effect: the founder is never told of a data-room ask, and the investor is never told of a share or a decline. The same applies to `notifyRequests` in `apps/api/src/profile-material.ts`, which maps REQUESTS → DOCUMENTS.
  - Production has had no `DILIGENCE` notice since 8 Oct 07:08. The `DOCUMENTS`/`COMPANY_PROFILE` targets came with `c564c0aa2`.
  - Fix: a forward migration that allows `?=&#` in the check, or links without a query or fragment. Log the failure instead of swallowing it, and add a test that inserts each target's `link_path` against the real constraint.
- **D2 (low): no trace of a data-room decline, and no investor-side digest line for a share or a decline.**
  - `decide` (DECLINE) appends no relationship event; APPROVE appends `data_room_access_granted`.
  - The digest's `recent` shows neither.
  - With D1, the investor learns of an answer only by opening the data room.
  - Files: `packages/permissions/src/application/data-room.ts` (`decide`), and the q-api digest's recent-events mapping.
- **O1 (low): replays are inconsistent.**
  - A same-key replay of interest decline and pass returns 200 with the cached first body, `deduplicated: false`. A different key returns `deduplicated: true`.
  - A data-room decision with a new key returns 409 "already answered", not the decision.
  - No duplicate rows or notices in any case.
- **O2 (low): the digest's `recent` labels a resume "connected"** ("Equator Line Capital (fictional): connected"), although the event is `relationship_resumed`.
- **O3 (medium, read only): the deal treats a revoked share as still shared.**
  - `sharedDocumentIds` (`packages/network/src/application/deal-close.ts`) is derived from `data_room_access_granted` events and ignores revocation.
  - After 1k, `/deal` still lists `f2437ed5` in `sharedDocumentIds`, so `deal/terms` and `deal/signed` would accept a document whose share was revoked.
- **O4 (low, copy):** the decline-interest card says "{investor} is told you're not taking it forward". No notice is sent (by design); the investor sees it only as stage DECLINED. File: `packages/app-actions/src/actions/interest.ts`.
- **O5 (low):**
  - Stating a commitment amount has no app action, so Q can prepare `confirm`/`mark_sent`/`confirm_received` but not the first statement (`apps/api/src/http/commitments.ts`).
  - Pre-existing: an open interest appears twice in the founder's `waiting` (an `INTEREST_REQUEST` and the matching `NOTICE`).

## Rows left in production (all fictional)

- **Savanna × Ajopot `3fa64633`:**
  - request `fab67394` with decision APPROVED;
  - policy `4afb2591`, revoked at 15:50:29Z;
  - events 18 and 19;
  - a `data_room_views` row (first open, 15:46:51Z).
  - The relationship is still IN_DILIGENCE.
- **Savanna × Nsuo `aca80528`:** request `f1dc934b` with decision DECLINED, and event 6. Still CONNECTED.
- **Tidewater × Nsuo `33bf85d3`:**
  - a new relationship, now **DECLINED**;
  - interest `03f94f61` and its response;
  - 3 events;
  - 2 INTEREST_RECEIVED notices, now read.
- **Equator × Tarmacly `39590df2`:**
  - pass `9d1371e5`;
  - PASS report `01571611` (investor-private);
  - events 4–7;
  - 12 RELATIONSHIP_OUTCOME notices.
  - The relationship is back to **CONNECTED**.
- Audit rows and outbox messages for each step.
