# Q Pitch — feature certification manifest

Referenced from the [master blueprint](Q_PITCH_MASTER_BLUEPRINT.md) §8–§9.

Every demonstration claim must map to an entry here that names three things:

- the authorised data it is shown on;
- the working code at a named revision;
- the verified behaviour, with a receipt.

No entry means no claim. An expired entry (`validUntil` passed, or the revision changed in the relevant area) must be re-verified before it is shown.

This file records the human-readable ledger. The machine-readable per-scene `SceneEvidence` records (blueprint §9) are introduced by QP-F05 and must stay consistent with it.

## Entry format

| Field                         | Meaning                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `featureId`                   | Atlas feature ID                                                                           |
| `status`                      | `PRODUCTION_LIVE_VERIFIED`, `CODE_VERIFIED`, `PARTIAL`, `NOT_IMPLEMENTED` or `CONCEPT`     |
| `actorContext`                | Authorised demo identity and role (never a real person's account)                          |
| `fixture`                     | Data the behaviour was verified on, with its classification                                |
| `appCommit`                   | Revision verified                                                                          |
| `verifiedAt` / `verifierType` | UTC time; `CODE`, `CI`, `BROWSER` or `HUMAN`                                               |
| `receipt`                     | Where the evidence is. Private receipts are referenced by path; never commit their content |
| `claimsAllowed`               | Exactly what may be said                                                                   |
| `claimsForbidden`             | What must not be said                                                                      |
| `validUntil`                  | Re-certification due                                                                       |

## Entries

### INV-DISCOVER-TOP3 — mandate-fit top three as cards

| Field                         | Value                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                      | PRODUCTION_LIVE_VERIFIED                                                                                                                                        |
| `actorContext`                | Fictional investor `investor.savanna-seed@fictional.capitalq.local` (Savanna Seed Partners)                                                                     |
| `fixture`                     | Existing fictional seeded companies (Ledgerfold, F2, Ledgerline)                                                                                                |
| `appCommit`                   | web `5ce3d76b`; q-api `c2f08536` (same server code)                                                                                                             |
| `verifiedAt` / `verifierType` | 2026-10-13 ~16:50 UTC; BROWSER (`scripts/handoff/live/investor-demo-rehearsal.mjs`)                                                                             |
| `receipt`                     | private `/tmp/cq-investor-demo-HZt53D` (not committed)                                                                                                          |
| `claimsAllowed`               | Q ranks the investor's top three by mandate fit and shows exactly those three canonical companies as cards (single run: text 3.0 s, cards 3.1 s, settled 3.4 s) |
| `claimsForbidden`             | "Instant"; fit = quality; any p95 claim                                                                                                                         |
| `validUntil`                  | Next change to the model-gateway fit path or answer-canvas                                                                                                      |

### INV-PROFILE-FINDINGS — selected-company analysis with native findings

| Field                                                                    | Value                                                                                                                                                                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                                                 | PRODUCTION_LIVE_VERIFIED                                                                                                                                               |
| `actorContext` / `appCommit` / `verifiedAt` / `verifierType` / `receipt` | as INV-DISCOVER-TOP3                                                                                                                                                   |
| `fixture`                                                                | Ledgerfold                                                                                                                                                             |
| `claimsAllowed`                                                          | Q answers about the selected company with evidence-labelled findings and a reference to exactly that company (7 findings; single run 5.5 s first text, 14.2 s settled) |
| `claimsForbidden`                                                        | "Verified" for founder-stated facts; any fixed latency claim                                                                                                           |
| `validUntil`                                                             | Next change to the analyst prompt/schema or result blocks                                                                                                              |

### INV-RISKS-FOLLOWUP — risks follow-up on the same company

| Field                                                                    | Value                                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `status`                                                                 | PRODUCTION_LIVE_VERIFIED                                                                                                       |
| `actorContext` / `appCommit` / `verifiedAt` / `verifierType` / `receipt` | as INV-DISCOVER-TOP3                                                                                                           |
| `fixture`                                                                | Ledgerfold                                                                                                                     |
| `claimsAllowed`                                                          | Q gives a sourced risk view with findings and stated uncertainty, still bound to the same company (8 findings; 4.8 s / 13.9 s) |
| `claimsForbidden`                                                        | Diligence completeness                                                                                                         |
| `validUntil`                                                             | As INV-PROFILE-FINDINGS                                                                                                        |

### INV-COMPARE-TABLE — two-company side-by-side comparison

| Field                                                                    | Value                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                                                 | PRODUCTION_LIVE_VERIFIED                                                                                                                                                                                |
| `actorContext` / `appCommit` / `verifiedAt` / `verifierType` / `receipt` | as INV-DISCOVER-TOP3                                                                                                                                                                                    |
| `fixture`                                                                | Ledgerfold vs F2                                                                                                                                                                                        |
| `claimsAllowed`                                                          | Q compares exactly the two named canonical companies against the mandate in one table; a measure a company lacks shows "Not recorded", never a low level (single run 14.2 s first text, 30.8 s settled) |
| `claimsForbidden`                                                        | Fast comparison; ranking as quality                                                                                                                                                                     |
| `validUntil`                                                             | Next change to the comparison card builders or answer-canvas                                                                                                                                            |

## Candidate certification (r3 premiere) — CODE_VERIFIED, 15 Oct 2026

Machine form: `PREMIERE_CERTIFICATION_LEDGER` (`packages/q-pitch/src/premiere.ts`).

- **How these were verified:** local `vitest` at `claude/rc-oct15-a` `a1bd84f3`. Provider keys were set to disabled values, no model or provider calls were made, and only test fixtures were used.
- **What CODE_VERIFIED means here:** the property holds in code. It does **not** mean the scene was seen in a browser.
- **Gate behaviour:** the gate's default (`PRODUCTION_LIVE_VERIFIED` only) suppresses these scenes. Only `?qpitch=premiere`, run as `INTERNAL_REHEARSAL`, opts into `CODE_VERIFIED` to rehearse the full cut.

| featureId (scene)              | Code receipt (PASS)                                                                                                              | claimsAllowed                                                                                                                                                                                        | claimsForbidden                                                                              | Steps to PRODUCTION_LIVE_VERIFIED                                                                                                                                                                                                                                                                                  | Paid?                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `GATEQ-INBOX-DOSSIER` (P5)     | `gateq-intake/test/inbox.test.ts` 17, `gateq/test/authority.test.ts` 13, `api/test/gateq-inbox-routes.test.ts` 4                 | c1: a firm's inbox shows its own gateway's applications; another firm's gateway or dossier is refused like one that does not exist. c2: a dossier holds only what the founder sent, never team notes | a live interview; investor Q reading the dossier (PR #98); counts or timings                 | (1) Confirm the fictional investor has a gateway with ≥1 submitted application (read-only). (2) Browser: `openRoute GATEWAY` + `selectTab tab.inbox` DONE receipts; inbox visible. (3) Browser negative: a second fictional investor gets a 404 for that gateway/dossier. (4) Record a receipt on the deployed SHA | **No** (navigation and reads only)              |
| `TRUST-CROSS-ROLE-DENIAL` (P6) | `q-firewall/test/policy.test.ts` 22, `q-tools/test/discovery-slate-network.test.ts` 3, `q-tools/test/visibility-tools.test.ts` 4 | c1: founder- and investor-private scopes are owner-only or explicitly shared; a founder-private company never enters an investor's discovery slate                                                   | that Q's on-screen answer was a refusal (until the browser receipt); "nothing can ever leak" | (1) Browser: `q.private-runway` on the Ledgerfold page as the fictional investor; the answer states the content is not shared, and the sources contain no founder-private ids. (2) API negative: a direct read of a founder-private document as the investor is refused (existing route). (3) Receipt              | **Yes**: one Q text run                         |
| `CRM-RELATIONSHIP-RECORD` (P7) | `network/test/state-projector-v2.test.ts` 16, `state-projector.test.ts` 11                                                       | c1: state is derived deterministically from recorded events; replay-safe; an illegal move changes nothing                                                                                            | events that are not seeded; team or server views                                             | (1) Browser: `openRoute RELATIONSHIPS` DONE, overview visible with the actor's canonical records (STATE: 9). (2) Receipt                                                                                                                                                                                           | **No**                                          |
| `REH-Q2Q-SHORT` (P8)           | `q-pitch/test/q2q-rehearsal.test.ts` 6, `q-api/test/rehearsal-readings.test.ts` 6, `demo-rehearsal-access.test.ts` 7             | c1: a labelled simulation through the existing rehearsal session, always ended explicitly, with its saved transcript and review read back                                                            | the counterpart is the real person; a score before the review is read                        | (1) Confirm the fictional investor has Ledgerfold as a rehearsal partner (read-only `GET` partners). (2) Browser: about 30 s run, explicit finish, review page DONE; transcript source tags recorded. (3) Mic test: a counterpart line containing "skip" does not move the tour. (4) Receipt + cost                | **Yes**: text model turns (within Lane P's cap) |
| `QP-HOME-HANDOFF` (P9)         | `q-pitch/test/tour-runner.test.ts`                                                                                               | c1: the tour ends on Home and hands control back                                                                                                                                                     | that later answers are scripted                                                              | Browser: `openRoute HOME` DONE                                                                                                                                                                                                                                                                                     | **No**                                          |

Timing if all five are promoted: P1–P4 3:10 + P6 0:35 + P5 0:55 + P7 0:40 + P8 0:50 + P9 0:20 ≈ **6:30**. With only the non-paid promotions (P5, P7, P9): ≈ **5:05**.

The four original investor entries remain due for re-certification on the deployed SHA (blueprint §16) before any audience run.

## Browser receipts — production `04a322ae`, 15 Oct 2026 05:25–05:33 UTC (Lane P, unpaid)

- **Method:** Playwright (Chromium 1194, 1440×900, recorded video), signed in through the product's own form as `investor.savanna-seed@fictional.capitalq.local`.
- **No-cost guard:** after sign-in, **every server-action POST and every non-GET to q-api was aborted** (logged), so no writes and no model calls were made. Receipts are private scratchpad files (`qpitch-review/`), not committed.

| Entry                                        | Result                                                                                                                                                                                                                                                                                                                                                                                     | Receipt                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `GATEQ-INBOX-VIEW` (new)                     | **PRODUCTION_LIVE_VERIFIED.** `/gateq?tab=inbox` 200, Inbox tab selected; 4 applications listed against the firm's rules; the fictional Maji Loop brief reads "Frozen from the founder's submission. Investment decisions remain with your team."                                                                                                                                          | `gateq-inbox-savanna.png`, `features-log.json` |
| `CRM-RELATIONSHIP-VIEW` (new)                | **PRODUCTION_LIVE_VERIFIED.** `/relationships?view=overview` 200, "Investment Hub" showing the firm's interest, connections, pipeline and commitments                                                                                                                                                                                                                                      | `relationships-savanna.png`                    |
| `GATEQ-INBOX-DOSSIER` (cross-firm isolation) | **Stays CODE_VERIFIED.** The application id is not exposed in the DOM, so the foreign-investor deep link could not be built without a privileged read, which was not done                                                                                                                                                                                                                  | —                                              |
| `QP-HOME-HANDOFF`                            | **Stays CODE_VERIFIED.** `/home` renders, but the premiere (and its close scene) is not deployed on `04a322ae`                                                                                                                                                                                                                                                                             | `home-savanna.png`                             |
| Tour host (QP-F08) `?qpitch=pilot`           | Overlay appeared; the Discover navigation DONE receipt was observed; FIXTURE_UNRESOLVED fallback said "won't describe it" and paused. **DEFECT:** with run creation blocked, scene 1 advanced: an older finished run was taken as the top-three DONE. Fixed in `20abe295` (`claude/p-cert-oct15`), **not deployed. Do not run the pilot for an audience until it is deployed and re-run.** | `pilot-log.json`, `pilot-0*.png`, video        |

**Flags:**

- The savanna inbox also lists Spheros and Tensorgate, which are not fictional-world records (see QP-F03). The GateQ scene must stay on Maji Loop.
- The Investment Hub shows figures (for example "Commitments 1 · USD 250,000"). These are fictional seed data and must never be narrated as Capital Q results.

**Default-gate cut now:** pilot P1–P4 (3:10) + GateQ (0:55) + relationship (0:40) = **4:45**. With the Home close certified after deploy, about 5:05. With privacy and Q-to-Q (paid, after 09:00), about 6:30.

## Browser receipts — production `242460c1`, 15 Oct 2026 06:11–06:15 UTC (Lane P)

- **`QP-HOME-HANDOFF`: PRODUCTION_LIVE_VERIFIED.** `?qpitch=premiere`, jump to "Your move": `openRoute HOME` produced a navigation DONE receipt at `/home`, the closing lines played after it, and the scene reached its checkpoint. Every non-GET request was aborted. Receipt: `qpitch-review/242460c1/premiere-log.json` + video.
- **CORRECTION to the 04a322ae entry above.** The guard there aborted server actions only, but Q questions use `POST /api/q-ask`. So both pilot runs (05:25 and 06:11 UTC) made **one real top-three Q run each**. The scene-1 DONE was a real run, **not** a stale-receipt defect. The `20abe295` change is kept as hardening (it binds the receipt to the exact run). Since 06:13 the guard aborts every non-GET request, and no Q run was made after that.
- **Fixture drift:** the actor's top three are now Duplo, Bumpa and MedTrail (all level at 8.8, cheque compatibility unknown). Ledgerfold and F2 are not among them, so `s.pilot.company` / `s.pilot.compare` correctly fall back with `FIXTURE_UNRESOLVED`. **These three are not fictional-world companies.** `INV-DISCOVER-TOP3` must not be narrated for an audience until the fixture companies are confirmed fictional, and its re-certification names them.
- **UX defect (host):** the tour opens the Q side sheet for its question, and the sheet is modal, so the tour controls are inert until it closes (Escape works). To fix in the host.

**Default-gate cut on 242460c1:** pilot P1–P4 + GateQ + relationship + Home = **about 5:05**. The pilot scenes are blocked by the fixture drift above. Privacy and Q-to-Q are pending the paid run (after 08:00 UTC).

## Browser receipts — production `41b3b4ee` (includes `p-pilotfix`), 15 Oct 2026 07:25–08:25 UTC (Lane P)

- **Method:** Playwright (Chromium 1194, 1440×900, recorded video), signed in through the product's own form as `investor.savanna-seed@fictional.capitalq.local`, `CQ_Q_PITCH_TOUR=1` on web.
- **Guard (paid run):** after sign-in, only `POST /api/q-ask` and the five rehearsal server actions were allowed. The actions were matched by action id to their exported names in the served chunks: `demoRehearsalCounterpartAction`, `start`/`say`/`finish`/`readRehearsalAction`. **Every other non-GET was aborted and logged**, for example `q-ui-acts`, `q-navigate`, notices, approvals, slate and fit actions. Receipts are private scratchpad files under `qpitch-review/41b3b4ee/`, not committed.

| Entry                                                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Receipt                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Tour host: in-panel controls (07:25, **unpaid**, every non-GET aborted)      | **PRODUCTION_LIVE_VERIFIED.** With the Q side sheet open (1 dialog), the in-panel toolbar appeared, and a pointer click on "Pause tour" paused the tour ("Scene 1 of 8 · Paused"). No keyboard was used. **Cosmetic defect:** the bar covered the panel subtitle. Fixed in `claude/p-cert2-oct15` (the bar is now an in-flow strip above the header). The fix was previewed on the live DOM (bar y 0–61, title from y 77, no overlap); it is **not deployed**                                                                               | `panel-log.json`, `panel-controls*.png`, `panel-controls-41b3b4ee.webm`, `panel-controls-fix-preview.png` |
| `?qpitch=premiere` attempt 1 (08:17)                                         | Scene 1 fell back with **ACK_TIMEOUT**: the top-three run finished, and its cards rendered, after the 20 s window. The tour stopped honestly and nothing was narrated. Not retried automatically                                                                                                                                                                                                                                                                                                                                            | `attempt1/`                                                                                               |
| `INV-DISCOVER-TOP3` (pilot scene 1)                                          | **PRODUCTION_LIVE_VERIFIED (receipt-bound).** Discover navigation DONE; the top-three run `4ee919cf` was answered and settled 2.8 s after the ask. Cards: Duplo, Bumpa, MedTrail (all 8.8; 5 of 7 measures known; "not a judgement of quality"). Snapshotted as `card-1`/`card-2`                                                                                                                                                                                                                                                           | `run-log.json`, `run-4ee919cf.sse.txt`, `cert2-01.png`                                                    |
| `INV-PROFILE-FINDINGS` + `INV-RISKS-FOLLOWUP` (scene 2, "the first card")    | **PRODUCTION_LIVE_VERIFIED (receipt-bound).** Navigation DONE to `/company/a9d8d2de…` (Duplo = `card-1`); two Q runs, each settled (18.5 s and 15.9 s from their asks); scene complete                                                                                                                                                                                                                                                                                                                                                      | `run-log.json`, `cert2-02.png`                                                                            |
| `INV-COMPARE-TABLE` (scene 3, "the first two")                               | **PRODUCTION_LIVE_VERIFIED (receipt-bound).** The comparison of `card-1` and `card-2` (Duplo and Bumpa) settled 17.7 s after the ask; scene complete                                                                                                                                                                                                                                                                                                                                                                                        | `run-log.json`, `cert2-03.png`                                                                            |
| `TRUST-CROSS-ROLE-DENIAL` (privacy scene, `card-1` from the scene-1 receipt) | **PRODUCTION_LIVE_VERIFIED** (browser step here; API negative passed at 08:30, see below). Run `942f77cc` was about Duplo (`card-1`); it settled 13.7 s after the ask. The answer said no documents are shared with the investor and the data room is locked until interest is accepted, and "founder-private notes and unshared documents aren't visible to you". Findings: 2 PLATFORM_VERIFIED facts and 1 GAP (UNKNOWN) about founder-private material; **every `evidenceRefs` is empty**, so no founder-private id is among the sources | `run-942f77cc.sse.txt`, `cert2-04.png`, `privacy-negative.json`                                           |
| `GATEQ-INBOX-VIEW` (scene 5)                                                 | Re-confirmed: `openRoute GATEWAY` DONE + `SELECT_TAB` ui-act DONE                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `run-log.json`, `cert2-05.png`                                                                            |
| `CRM-RELATIONSHIP-VIEW` (scene 6)                                            | Re-confirmed: `openRoute RELATIONSHIPS` DONE (`/relationships?view=overview`)                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `cert2-06.png`                                                                                            |
| `REH-Q2Q-SHORT` (scene 7)                                                    | **PRODUCTION_LIVE_VERIFIED (except mic step 3).** Read-only `GET /v1/q/rehearsals/partners` beforehand: Ledgerfold is among the actor's 9 partners. Rehearsal `4ad9f2bc`: counterpart resolved server-side; start → 3 `say` → explicit `finish` → review read; 16 s; status FINISHED, 7 turns, tagged `THEM`/`YOU`; review present ("82 / 100, from the ratings below"). The tour navigated to `/rehearsals/r/4ad9f2bc…` DONE. **Not run:** the microphone "skip" test (step 3)                                                             | `partners-check.json`, `rehearsal-4ad9f2bc.json`, `cert2-07.png`, `cert2-rehearsal-review.png`            |
| `QP-HOME-HANDOFF` (scene 8)                                                  | Re-confirmed: `openRoute HOME` DONE; "Tour complete"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `cert2-08.png`, `cert2-09.png`                                                                            |

Recording of the full 8-scene premiere: `qpitch-review/41b3b4ee/premiere-cert2-41b3b4ee.webm` (08:19–08:23 UTC).

**Flags:**

- **Fixture:** Duplo, Bumpa and MedTrail are still not fictional-world companies (see 242460c1). These scene receipts certify the **behaviour** (receipt-bound keys, honest fallback). They are not a licence to narrate these companies to an external audience.
- **Rehearsal review:** it contains a score. Per `claimsForbidden`, never say the score before the review is read on screen.
- **Ack timing (lead decision, applied):** one of the two top-three runs missed scene 1's 20 s ack window (ACK_TIMEOUT). The window is now 30 s in `pilot.ts`, with `tour-runner.test.ts` updated to match; 82/82 q-pitch tests pass. **Not deployed.**
- **Privacy negative test (step 2) PASSED, 08:30 UTC (lead-approved write, no model call):**
  - At 08:27 there was nothing to test: the fictional founders had zero documents (`GET /v1/documents`, `GET …/data-room` for Ledgerfold and Maji Loop).
  - The lead then approved ONE test document. As `founder.ledgerfold`, through the normal upload path (`POST /v1/documents/upload-sessions` → PUT → `…/complete`), I uploaded "Private runway note (test)", a 113-byte plain-text file holding no real data, document `ca437fd2…`. Its default scope was kept: the API reports `visibilityScope: organisation_private` (Ledgerfold's own organisation), data-room level `PRIVATE`, `sharedWith: 0`. The default is `organisation_private`, not the literal `founder_private` value.
  - `GET /v1/companies/84b9641f…/data-room/documents/ca437fd2…/open`: **founder 200**; the first try returned 404 while the version was still processing, about 5 s. **Investor (`savanna-seed`) 404.** Also as the investor: `GET /v1/data-room/documents/ca437fd2…/access` 404, and the data room (viewer INVESTOR) lists 0 documents.
  - Receipt: `qpitch-review/41b3b4ee/privacy-negative.json`. The test document stays in Ledgerfold's data room (PRIVATE), labelled "(test)".
- **Ledger:** `TRUST-CROSS-ROLE-DENIAL` is promoted to PRODUCTION_LIVE_VERIFIED in `PREMIERE_CERTIFICATION_LEDGER`, so the default gate now admits the privacy scene. Q-to-Q stays CODE_VERIFIED until the mic "skip" test runs (lead).

## Lane P cost log (15 Oct)

| Time (UTC)  | What                                                                       | Calls                                                                                                               | Cost                                                                                          |
| ----------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 05:25       | pilot rehearsal; guard missed `POST /api/q-ask`                            | 1 top-three Q text run                                                                                              | paid, about $0.01 (lead estimate for the two runs: $0.02; not reconciled with vendor billing) |
| 06:11       | pilot re-run (same gap)                                                    | 1 top-three Q text run                                                                                              | paid, about $0.01                                                                             |
| 06:13–07:25 | guard aborts every non-GET request (incl. 07:25 in-panel controls receipt) | 0                                                                                                                   | $0                                                                                            |
| 08:15–08:17 | read-only partners check + action-id probe (every non-GET aborted)         | 0                                                                                                                   | $0                                                                                            |
| 08:17       | premiere attempt 1 (ACK_TIMEOUT on scene 1)                                | 1 top-three Q text run                                                                                              | paid, about $0.01                                                                             |
| 08:19–08:23 | premiere full run (lead-approved, $2 cap)                                  | 5 Q text runs (top three, findings, risks, comparison, privacy) + 1 short rehearsal: 4 counterpart turns + 1 review | paid, estimate about $0.05 (Q) + about $0.05–0.10 (rehearsal); not reconciled with billing    |
| 08:24–08:25 | read-backs (run events, rehearsal) + live-DOM preview of the bar fix       | 0 (GET only; every non-GET aborted)                                                                                 | $0                                                                                            |
| 08:27–08:30 | privacy negative: read-only checks, then 1 approved test upload + GETs     | 0 model calls (1 storage write of 113 bytes)                                                                        | $0                                                                                            |
| **Total**   |                                                                            | 8 Q text runs + 1 rehearsal                                                                                         | **about $0.12–0.17 estimated**, well within the $2 cap                                        |

## Pilot change (lead decision, 15 Oct)

- **Companies:** scenes 2–3 no longer name a company. `card-1` and `card-2` resolve to the first and second company cards of scene 1's acknowledged DONE answer, snapshotted when the receipt arrives. A key never resolves from a name, from another run, or from the person's own typed text.
- **Narration:** the comparison intro is now "Let me put the first two side by side against your mandate." The company line no longer assumes founder statements. Narration states only what the receipt and the page show; never traction.
- **Q panel:** while the Q side panel (a modal) is open, the tour renders Back, Pause/Resume tour and Skip inside it, so no keyboard is needed.
- **Re-certification:** `INV-PROFILE-FINDINGS`, `INV-RISKS-FOLLOWUP` and `INV-COMPARE-TABLE` must be re-run on the receipt-bound pilot after deploy (paid Q runs, within the cap) before their fixture field changes from "Ledgerfold"/"F2".

Every other atlas feature currently has no certification entry and must not be presented as live.

## Premiere v5 acceptance — production `f28ab37d` (batch Q), 15 Oct 2026 21:55–22:20 UTC (Lane P)

- **Method:** Playwright (Chromium 1194, 1440×900, recorded video), signed in through the product's own form as `investor.savanna-seed@fictional.capitalq.local`, `?qpitch=premiere`, "Start the tour". **Nothing was blocked**: every request ran as a person's would. The microphone was denied (no WebRTC here), so after about 20 s the live line gave way to Q's standard voice. Receipts are private scratchpad files under `v5-acc/run1..3/` (run log, a screenshot per scene, video), not committed.
- **Runs:** runs 1 and 2 stopped at scene 3 (the driver idled after the honest fallback; nothing else ran). Run 3 is the full tour: the driver carried on past each fallback from the Tour menu (Chapters → the next scene), as a presenter would.
- **Run 3:** RUNNING 21 s after Start; 17 scenes in **6:28** (tour complete at 388 s); hand-over: the strip left by itself and Q stayed on `/home`. 2 honest fallbacks, 0 page errors, 0 console errors.

| #   | Scene                                 | Start (s) | Took (s) | Result                                                                                    |
| --- | ------------------------------------- | --------- | -------- | ----------------------------------------------------------------------------------------- |
| 1   | Hello, I'm Q                          | 0         | 41       | complete                                                                                  |
| 2   | Your mandate                          | 43        | 16       | complete                                                                                  |
| 3   | Discover: pitches                     | 60        | 4        | **FAILED**: `carousel.feed` NEXT never confirmed (fixed, see below)                       |
| 4   | Save one for later                    | 72        | 8        | complete; `button.feed-save` DONE, Saved list says the company isn't told                 |
| 5   | Top three                             | 82        | 13       | complete                                                                                  |
| 6   | Harbourline Cargo, deck and data room | 97        | 33       | complete                                                                                  |
| 7   | Harbourline vs Clinicrest             | 131       | 45       | complete, **with the live question**                                                      |
| 8   | GateQ: Maji Loop                      | 177       | 26       | complete; brief and rule fit on screen                                                    |
| 9   | CRM overview                          | 204       | 12       | complete                                                                                  |
| 10  | Clinicrest record                     | 217       | 9        | complete; stage on screen, history below the fold                                         |
| 11  | Preparing a meeting                   | 227       | 11       | complete; Book a call dialog open, nothing booked ("Google Calendar isn't connected")     |
| 12  | Q Work                                | 240       | 9        | complete                                                                                  |
| 13  | Documents                             | 250       | 7        | **FAILED**: the By Q filter was applied, but its act was not confirmed (fixed, see below) |
| 14  | Notifications                         | 266       | 6        | complete                                                                                  |
| 15  | Q-to-Q rehearsal                      | 274       | 79       | complete; review page `/rehearsals/r/e08621b7…`                                           |
| 16  | Capital Q's own profile               | 354       | 11       | complete                                                                                  |
| 17  | Your move (Home)                      | 366       | 20       | complete; tour complete, hand-over                                                        |

- **Live question (interrupt → answer → resume): PASS.** Typed into Q's panel during scene 7 ("What cheque range does my mandate allow?"). The tour showed "Paused for your question"; Q run `524b92cd` completed in 5 s ("cheques from USD 250,000 to USD 1 million, typical USD 600,000"); the tour resumed by itself 3 s later and finished the scene. The panel then listed older cards with "1 more on the Q page", so the new answer was not visible in the panel itself (the spoken answer played).
- **Narration audio: DEGRADED.** From 190 s, `POST /api/q-speech` returned 429: the standard voice allows 30 lines per person per 10 minutes (`SPEECH_QUOTA`, q-api), and the main cut has 48 lines plus the rehearsal turns. Scenes 8–17 ran on captions only, which is also why they were short. The live voice (GPT-Live) narrates without this quota; with sound, expect the tour at roughly 7–8 minutes. **Not changed here** (a cost cap: lead or owner decision).
- **Promoted to PRODUCTION_LIVE_VERIFIED** (ledger): `FEED-SAVE`, `MEETING-PREP-VIEW`, `NOTIFICATIONS-VIEW`.
- **Stay CODE_VERIFIED:** `FEED-VIEW` and `DOCUMENT-OPEN` (failed; fixed, not deployed). `GATEQ-DOSSIER-VIEW` and `CRM-RECORD-VIEW`: the scenes passed, but their claims (interview transcript and dossier; a dated history) sit below the fold and were not on screen in the receipt.
- **Fixes on `claude/p-premiere-fix-oct16`** (from `origin/build/int-rc`):
  - The investor feed never published its card in focus to the page manifest, so `carousel.feed` Next or Previous could never be confirmed, for the tour or for Q itself.
  - The By Q filter act now sets the filter and is DONE once it reads By Q.
- **Flags:** `/api/company-photo/<id>` still answers 404 for companies without a photo (13 times in run 3; the avatar falls back to initials). The Discover card in focus was Basketari, which is not a fictional-world company; the feed scene names no company.

## Premiere v5 acceptance run 4 — production `2c2010cb` (batch S), 16 Oct 2026 about 06:59–07:07 UTC (Lane P)

- **Method:** as run 3: Playwright, `investor.savanna-seed@fictional.capitalq.local`, `?qpitch=premiere`, "Start the tour", nothing blocked, the microphone denied (standard voice). `CQ_SPEECH_LINES_PER_10MIN=300` on q-api. Receipts: scratchpad `v5-acc/run4/` (run log, a screenshot per scene, the panel at the live answer, video), not committed.
- **Result:** RUNNING 32 s after Start; 17 scenes in **6:53** (tour complete at 413 s); hand-over: the strip left by itself, Q on `/home`. 1 fallback, 0 page errors, 0 console errors, **0 speech refusals** (narration audible as standard voice through scene 17).

| #   | Scene                     | Start (s) | Took (s) | Result                                                                       |
| --- | ------------------------- | --------- | -------- | ---------------------------------------------------------------------------- |
| 1   | Hello, I'm Q              | 0         | 38       | complete                                                                     |
| 2   | Your mandate              | 39        | 18       | complete                                                                     |
| 3   | Discover: pitches         | 58        | 10       | complete; two Next moves DONE, "AI presenter · AI-generated" label on screen |
| 4   | Save one for later        | 69        | 8        | complete                                                                     |
| 5   | Top three                 | 78        | 15       | complete                                                                     |
| 6   | Harbourline Cargo         | 94        | 57       | **ACK_TIMEOUT** (host defect, fixed below)                                   |
| 7   | Harbourline vs Clinicrest | 160       | 47       | complete, **with the live question**                                         |
| 8   | GateQ: Maji Loop          | 209       | 25       | complete; transcript scrolled to and opened                                  |
| 9   | CRM overview              | 236       | 11       | complete                                                                     |
| 10  | Clinicrest record         | 249       | 9        | complete; "What happened" on screen with dated entries                       |
| 11  | Preparing a meeting       | 260       | 9        | complete                                                                     |
| 12  | Q Work                    | 270       | 10       | complete                                                                     |
| 13  | Documents                 | 282       | 14       | complete; By Q, memo opened in the viewer                                    |
| 14  | Notifications             | 297       | 7        | complete                                                                     |
| 15  | Q-to-Q rehearsal          | 305       | 72       | complete; review `/rehearsals/r/c2e3b7a2…`                                   |
| 16  | Capital Q's own profile   | 379       | 12       | complete                                                                     |
| 17  | Your move (Home)          | 392       | 21       | complete; hand-over                                                          |

- **Live question: PASS, and now visible.** "What cheque range does my mandate allow?" during scene 7: paused, answered, resumed by itself. The Q panel showed the question and the answer in full ("USD 250,000–1,000,000 … typical USD 600,000"), above the Board (`ask-14000.png`).
- **Scene 6 defect (fixed on `claude/p-premiere-fix2-oct16`):** opening Harbourline loaded its Q conversation, whose history held run 3's typed question. The host took that loaded turn for a new viewer question and paused the tour ("Paused for your question" with nothing asked), and the scene's own question then timed out. Now only a question first seen unconfirmed (typed on this page) pauses the tour; loaded history never does (`viewerQuestions`, with tests).
- **Promoted to PRODUCTION_LIVE_VERIFIED:** `FEED-VIEW`, `GATEQ-DOSSIER-VIEW`, `DOCUMENT-OPEN`.
- **Stays CODE_VERIFIED:** `CRM-RECORD-VIEW`. The history is on screen with dates, but the tour strip covers part of it, and "each entry marked with who can see it" was not legible in the receipt.
- **Speech:** with the allowance at 300, no 429 in the whole run; narration ran to the end.

## Premiere v5 acceptance run 5 — production `7735ec77` (batches T+U), 16 Oct 2026 09:15–09:22 UTC (Lane P, lead-approved)

- **Method:** as runs 3–4: Playwright, `investor.savanna-seed@fictional.capitalq.local`, `?qpitch=premiere`, "Start the tour", nothing blocked, microphone denied (standard voice), `CQ_SPEECH_LINES_PER_10MIN=300`. Receipts: scratchpad `v5-acc/run5/`, not committed.
- **Result:** RUNNING 27 s after Start; **17 of 17 scenes complete, 0 fallbacks, in 6:43** (tour complete at 403 s); hand-over: the strip left by itself, Q on `/home`. 0 page errors, 0 console errors, 0 speech refusals; 61 narration lines played (about 7 minutes of audio, including the rehearsal's two voices and the spoken answer).

| #   | Scene                                       | Start (s) | Took (s) |
| --- | ------------------------------------------- | --------- | -------- |
| 1   | Hello, I'm Q                                | 0         | 39       |
| 2   | Your mandate                                | 40        | 19       |
| 3   | Discover: pitches                           | 60        | 11       |
| 4   | Save one for later                          | 72        | 8        |
| 5   | Top three                                   | 82        | 15       |
| 6   | Harbourline Cargo                           | 98        | 33       |
| 7   | Harbourline vs Clinicrest (+ live question) | 132       | 42       |
| 8   | GateQ: Maji Loop                            | 175       | 27       |
| 9   | CRM overview                                | 203       | 11       |
| 10  | Clinicrest record                           | 216       | 10       |
| 11  | Preparing a meeting                         | 227       | 10       |
| 12  | Q Work                                      | 238       | 10       |
| 13  | Documents                                   | 249       | 15       |
| 14  | Notifications                               | 265       | 7        |
| 15  | Q-to-Q rehearsal                            | 274       | 92       |
| 16  | Capital Q's own profile                     | 369       | 13       |
| 17  | Your move (Home)                            | 383       | 20       |

- **Live question: PASS.** Asked during scene 7; paused 8 s later, answered (run at 09:17:39, "USD 250,000–1,000,000"), visible in the Q panel, resumed by itself 3 s later. No false pause from loaded history (the run-4 defect is gone).
- **Promoted:** `CRM-RECORD-VIEW`. The history is on screen above the strip, each dated entry marked "Only your side can see this" (`scene-10.png`).
- **DEFECT, scene 6 (content, not timing):** the scene completed, but Q's answer described **Basketari** (the feed's last card, `5be654c3…`), not Harbourline. Evidence: run at 09:16:47 has `screen.companyId` = Harbourline, but its page manifest was still `LOADING` with no focus, and `subject_refs` lists `5be654c3…` first. The question went while the profile was loading, and "this company" resolved from the conversation's earlier subject. **Scene 6 is not certified by this run.**
  - **Fix (tour):** `claude/p-premiere-fix3-oct16`: before every tour question, wait (up to 8 s) until the page has stopped loading and, on a company page, declares that company in focus (`pageSettled`, with tests).
  - **Open (q-api, not changed here):** when the screen names a company but the manifest has no focus yet, "this company" should resolve to `screen.companyId`, not to an older subject in the conversation. This also affects a person who asks quickly after opening a profile.
- **Provider usage (estimate, not reconciled with billing):** 4 Q text runs (top three, profile, comparison, the live question) plus 1 short rehearsal (counterpart turns and review), and about 7 minutes of standard-voice speech. Roughly $0.3–0.6.

## Premiere v5 acceptance run 6 — production `db16ca36` (releases V+W), 16 Oct 2026 11:39–11:46 UTC (Lane P, lead-approved)

- **Attempt 1 (11:22):** the browser crashed in "Opening Q's voice…" (`page.screenshot: Target crashed`, the VM shared with other agents' builds). The tour never started; no Q run, no speech. **Retried once.**
- **Run (retry):** RUNNING 27 s after Start; **17 of 17 scenes complete, 0 fallbacks, 0 page or console errors, 0 speech refusals, in 6:19** (tour complete at 379 s); hand-over: the strip left by itself, Q on `/home`. The live question passed: paused, answered, visible in the panel, resumed by itself.
- **Scene 6: NOT certified (content).** Run `1f490098` (11:40:30) answered about **Brancheon Works**, the feed's last card. Its subjects in order: `5be654c3` (Brancheon Works), `ceb6ec2d` (Harbourline), Savanna's organisation. The screen was right: `companyId` and manifest focus were both Harbourline (the page-settled fix held). The cause is one level up: the session's page subject was still the feed's card, and it went as the subject **named** with the question, which `screenCompanyFirst` deliberately leaves in place.
  - **Fix (tour):** `claude/p-premiere-fix4-oct16`: on a company page, a tour question also waits until Q's subject is that company (`pageSettled`, with a test).
  - **Open (web, real users):** a person who asks right after opening a profile can send the previous page's subject. Either the page subject should follow the route at once, or the server should let the screen's company lead over a named one that contradicts it on a company route. That is a rule change, for the lead to decide.
- The other three Q runs had Harbourline first: the comparison, the live question and the run-5 profile order are unchanged.

## Premiere v5 acceptance run 7 — production `f688c48e` (release X), 16 Oct 2026 12:32–12:39 UTC (Lane P, lead-approved)

- **Method:** as runs 3–6 (Playwright, savanna-seed, nothing blocked, microphone denied: standard voice). Receipts: scratchpad `v5-acc/run7/`, not committed.
- **Result:** RUNNING 28 s after Start; **17 of 17 scenes complete, 0 fallbacks, 0 page or console errors, 0 speech refusals, in 6:52** (tour complete at 412 s); 60 narration lines; hand-over: the strip left by itself, Q on `/home`. The live question passed: paused, answered (run `cae4abff`), visible in the panel, resumed by itself.
- **Scene 6: CERTIFIED (PRODUCTION_LIVE_VERIFIED, content and timing).** Run `bec093d3` (12:33:10). Subjects in order: Harbourline (`ceb6ec2d`), then Savanna's organisation; no stale feed card. Its answer opens "Harbourline Cargo provides port-to-warehouse container trucking for Lagos importers…" and states the fit with unknowns kept unknown (`scene-06.png`). The comparison (`f26b1723`) and the live question also carried Harbourline first.
- **Certified scenes now: 15 of 17** in the main cut (every feature PRODUCTION_LIVE_VERIFIED). Not yet:
  - **15, Q-to-Q rehearsal:** `REH-Q2Q-SHORT` waits on the microphone "skip" test, which only a human can run.
  - **16, Capital Q's own profile:** `QP-SUBJECT` is CODE_VERIFIED. The scene completed in runs 3–7; promoting it needs a lead decision on its claims.
- **Defect (cosmetic, not tour-specific):** the scene 6 answer showed a literal `\n\n` between paragraphs ("Apapa.\n\nThe fit…"). An escaped newline in the model's text reached the panel unrendered.
- **Provider usage (estimate):** 4 Q text runs (top three, profile, comparison, live question), 1 short rehearsal, about 7 minutes of standard voice. Roughly $0.3–0.5.

## Scene 16 (Capital Q's own profile): promoted, conditional on migration 20261228141700 (16 Oct, lead decision)

- **Rule (lead):** Capital Q's profile may claim only what is on its record: pre-seed, bootstrapped, the USD 2M raise as a founder claim, and the product description. No verified traction, customers, revenue or investors; every claim labelled with its evidence status.
- **Run 7 check (`scene-16.png` and the scene's narration):**
  - Pre-seed; "$2M · Said in their pitch"; the product description; "Traction: Nothing stated in their pitch yet"; "Q's view · not verified".
  - The narration calls the fundraising details the founders' own statements.
  - No traction, customers, revenue or investors are claimed. Compliant, except one statement:
- **The one breach:** the badge **"Demo verified (synthetic)"** under the name. Its source is data: Capital Q's organisation (`f95c3469…`) has a current `evidence.verification_claims` revision 2, VERIFIED by `SYNTHETIC_DEMO_ATTESTATION` (15 Oct 10:48 UTC, on a request from a synthetic-marked account).
  - **Fix:** `supabase/migrations/20261228141700_capital_q_revoke_synthetic_attestation.sql` appends a REVOKED revision naming that row. It runs only while that attestation is current, updates and deletes nothing, and changes no grant or policy.
  - **pgTAP:** `rls/972_capital_q_synthetic_revocation.test.sql`.
- **Status:** `QP-SUBJECT` is **PRODUCTION_LIVE_VERIFIED once the migration is applied in production** and the profile shows no verification badge (a read-only check: the current revision is REVOKED). The ledger entry in `premiere.ts` stays CODE_VERIFIED until then, so no audience run shows the badge. With it, **16 of 17** scenes are certified; scene 15 waits on the human microphone test.

## Scene 16 (Capital Q's own profile): PRODUCTION_LIVE_VERIFIED, production `6d7b521d` (release Y), 16 Oct 2026 about 13:10 UTC

- **Hosted read:** Capital Q's organisation (`f95c3469…`) shows revision 3 REVOKED (`c3c9a446…`, 12:59 UTC, migration 20261228141700), ending the synthetic attestation (revision 2). Revisions 1 and 2 are kept unchanged.
- **Browser, as savanna-seed (GET only on the profile; the tour in captions only):**
  - `/company/ee75a7d8…` shows no "Demo verified (synthetic)" and no verification badge.
  - Q Pitch reached scene 16 ("Capital Q, on its own platform · Scene 16 of 17 · Done on screen") on the same page, also without a badge.
  - Receipts: scratchpad `v5-acc/badge/capital-q-profile.png` and `capital-q-scene16.png`.
- **Ledger:** `QP-SUBJECT` promoted in `premiere.ts`. The forbidden list now names verified traction, customers, revenue and investors.
- **Certified scenes: 16 of 17.** Scene 15 (Q-to-Q rehearsal) waits on the human microphone "skip" test.

## Founder track v6 (`tour.founder-v6`): local browser runs, 16–17 Oct 2026 (Lane qpf)

- **Setup:**
  - Web: `claude/qpf-oct16` run locally (merged with `claude/qpitch-v6-oct16@723c023d`).
  - Services: production api, q-api and Supabase.
  - Account: fictional founder `babatunde.tunde-cargo@fictional.capitalq.local`.
  - Mode: captions only.
  - Driver: scratchpad `qpf/frun.mjs`. Logs are in `qpf/run2` (steps 1–5), `run4` (6–11), `run5` (12–16) and `run6` (3–8, a screenshot per lit section).
- **Result:**
  - All 16 steps completed and every anchored section was lit.
  - Page moves took under 1 s, except the pipeline at about 2.4 s.
  - The ledger stays `CODE_VERIFIED`: this was not the production web, so no entry is promoted until a run on the deployed SHA.
- **Testing residue:**
  - Rehearsal `04b2ac3c-0858-4533-8dc8-1e491bb33732` on babatunde, with Savanna Seed Partners, came from testing. It was a live runShortRehearsal from an earlier draft of step 12.
  - It is finished, private to the fictional account, and sent nothing.
  - There is no delete endpoint, so it remains.
  - No GateQ application was created.
- **Step 12 change:** a live persona rehearses the signed-in founder's own company. On babatunde it questioned Harbourline Cargo while Q presented Capital Q. Step 12 is now a prepared exchange, labelled aloud as one, on the rehearsal lobby. It uses no paid session and no Tavus.
- **Capital (update, 17 Oct):**
  - Hotfix AK (production `ae393b39`, live 23:57 UTC) fixed the founder Capital crash (digest 2735418325).
  - Re-checked on production as babatunde with a read-only browser look: `/relationships?view=capital` and `&tab=raise` return 200, showing "Your raise", "Commitments" and "Your rounds".
  - Capital is now its own founder step 8 (`s.fdr.08.capital.raise`): the round, commitments and the rounds timeline, each anchored. Later steps move up by one, to 17 steps in all.
  - Step 8 is code-verified only: it has not been run in a browser, because its anchors are not deployed.
  - The run receipts above use the old numbering: their steps 8–16 are now 9–17.

## Q Pitch v6 certification — production AP `c1b90393` and AQ `7161cedb`, 17 Oct 2026 about 05:50–07:40 UTC (Lane P)

- **Setup:**
  - Production web, api and q-api; Chromium, captions only; 1440×900.
  - Accounts: fictional `investor.savanna-seed@` and `babatunde.tunde-cargo@fictional.capitalq.local`.
  - Driver: scratchpad `v6-run.mjs`. Each run's private receipts (`run-log.json`, `summary.json`, per-step screenshots, video) are in scratchpad `v6/<run>/` and are not committed.
- **What a run checks:**
  - every narrated line with an anchor has its section lit (`[data-qp-lit][data-qp-anchor~=id]`) within 3 s of its caption;
  - every `<video>` on Discover is muted;
  - typed step commands move to the expected step;
  - bank questions answer on the overlay with no Q run (POSTs to `/api/q-ask` counted).

### Natural-language trigger (Q_PITCH)

| Asked, from Discover                           | Account   | Release | Result                                                                               |
| ---------------------------------------------- | --------- | ------- | ------------------------------------------------------------------------------------ |
| "Can you pitch Capital Q to me?"               | Savanna   | AP, AQ  | Q navigates to `/home?qpitch=investor-v6` in 2–4 s; AQ: the tour starts and runs     |
| "Peux-tu me présenter Capital Q ?"             | Savanna   | AP, AQ  | Same; AQ run `c-inv-fr`: steps 1–12 all lit (then a driver timeout, not the product) |
| "Could you walk me through what Capital Q is?" | Babatunde | AP, AQ  | `/home?qpitch=founder-v6`; AQ run `c-fdr-en`: all 17 steps ran                       |
| "¿Puedes explicarme Capital Q?"                | Babatunde | AQ      | Run `c-fdr-es`: the tour started and ran                                             |

- On AN and AO the trigger did not work; three fixes were needed:
  - `9863aff6`: the words gate.
  - `75499404`: the reader filed the request as QUESTION_TO_Q with NAVIGATE Q_PITCH.
  - `65609b9c`: the tour entry ignored client navigation.
- Each trigger is one Q run; the reader is TURN_READER v53.

### Investor track (`tour.investor-v6`, 22 steps) — PRODUCTION_LIVE_VERIFIED

- **Straight through, run `inv5`** (AP, direct start):
  - all 22 steps complete in 413 s; 47 anchors lit, none unlit;
  - Discover muted at 5 of 5 checks;
  - the bank answered "How do you make money?" after the end, with 0 Q runs.
- **Trigger run `c-inv-en`** (AQ):
  - step commands: "back two steps" 5→3, "forward 3" 3→6, "go to step 9" 6→9, "next" 9→10;
  - 37 anchors lit, none unlit; Discover muted 4 of 4;
  - bank mid-tour ("What makes Capital Q defensible?") and after the end, each with 0 Q runs.
- **Fixed on the way:** `c9abf3b2` (steps 12–13 were verified without a push, so 3 lines were unlit on AO).
- **Ledger:** all 22 `INVESTOR_V6_LEDGER` entries are promoted in `investor-v6.ts`.

### Founder track (`tour.founder-v6`, 17 steps) — PRODUCTION_LIVE_VERIFIED

- **Straight through, run `fdr4`** (AP, direct start):
  - all 17 steps complete in 534 s; 51 anchors lit, none unlit;
  - step 2 (the 14-section board, `a037d223`) took 76 s;
  - Discover muted; bank during and after the tour, each with 0 Q runs.
- **Trigger run `c-fdr-es`** (AQ):
  - all four step commands correct; bank with 0 Q runs; Discover muted;
  - 2 lines unlit: step 1.
- **Trigger run `c-fdr-en`** (AQ):
  - 17 of 17 steps; 42 lit;
  - 9 unlit: step 1 (2) and step 9 (7).
- **Causes, both only when the tour is started from Q's answer:**
  - Step 1: /home kept the ask's conversation. Fixed by `e85f5600` (`new=1`).
  - Step 9: the move back to step 4's investor page returned the old receipt within Q's turn. Fixed by `79492cfc` (each tour move gets its own turn).
- **Re-run on AR `c3044b70`** (web; q-api `7161cedb`), run `r-fdr-en`, started by the English trigger and run straight through:
  - Q navigated to `/home?qpitch=founder-v6&new=1`;
  - all 17 steps complete in 549 s; 51 anchors lit, none unlit (steps 1 and 9 fully lit);
  - step 2 took 76 s; Discover muted;
  - bank during and after the tour, each with 0 Q runs.
- **Ledger:** all 17 `FOUNDER_V6_LEDGER` entries are promoted in `founder-v6.ts`.

### Investor track on AR, started by the French trigger (run `r-inv-fr`)

- "Peux-tu me présenter Capital Q ?" opened `/home?qpitch=investor-v6&new=1`.
- All 22 steps complete in 413 s; 47 anchors lit, none unlit.
- Discover muted at 5 of 5 checks.
- Bank mid-tour and after the end, each with 0 Q runs.

### Short of the v6 definition of done

- **Voice is not certified.** Every run here is captions only.
  - Spoken step commands and spoken Q&A use the same parser and bank (code-tested), but no microphone run was made.
  - Natural-language triggers were typed, not spoken.
- **Q-to-Q is a prepared exchange** (founder step 13), by lane decision: no Tavus session was run or certified.
- **Languages:** the trigger is certified in English, French and Spanish. The narration itself is English.
- **Console:**
  - The AR runs logged no console errors and no page errors, except failed resource loads, which the driver does not count.
  - Unfiltered probes saw several `404` resource loads on the CRM and Capital views; the resource was not identified. That is still open against "no console errors".

### Spend

- About 15 Q runs for triggers and diagnosis, about $0.004 each (q-api logs: `gpt-5.6-luna`, NORMAL_DIALOGUE), so **about $0.06** in total.
- Bank answers: no model calls.
- No Tavus, no voice sessions; captions only.
