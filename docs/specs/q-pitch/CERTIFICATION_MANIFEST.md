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

## Lane P cost log (15 Oct)

| Time (UTC)   | What                                            | Calls                  | Cost                                                                                          |
| ------------ | ----------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| 05:25        | pilot rehearsal; guard missed `POST /api/q-ask` | 1 top-three Q text run | paid, about $0.01 (lead estimate for the two runs: $0.02; not reconciled with vendor billing) |
| 06:11        | pilot re-run (same gap)                         | 1 top-three Q text run | paid, about $0.01                                                                             |
| 06:13 onward | guard aborts every non-GET request              | 0                      | $0                                                                                            |

## Pilot change (lead decision, 15 Oct)

- **Companies:** scenes 2–3 no longer name a company. `card-1` and `card-2` resolve to the first and second company cards of scene 1's acknowledged DONE answer, snapshotted when the receipt arrives. A key never resolves from a name, from another run, or from the person's own typed text.
- **Narration:** the comparison intro is now "Let me put the first two side by side against your mandate." The company line no longer assumes founder statements. Narration states only what the receipt and the page show; never traction.
- **Q panel:** while the Q side panel (a modal) is open, the tour renders Back, Pause/Resume tour and Skip inside it, so no keyboard is needed.
- **Re-certification:** `INV-PROFILE-FINDINGS`, `INV-RISKS-FOLLOWUP` and `INV-COMPARE-TABLE` must be re-run on the receipt-bound pilot after deploy (paid Q runs, within the cap) before their fixture field changes from "Ledgerfold"/"F2".

Every other atlas feature currently has no certification entry and must not be presented as live.
