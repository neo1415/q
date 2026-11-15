# Demo readiness: locked V1 capabilities against production (15 Nov 2026, read-only)

Directive: [`../directives/2026-11-15-demo-readiness.md`](../directives/2026-11-15-demo-readiness.md), item 4.

**Scope.** This audit checks each demo capability that the locked V1 sources require against the newest live evidence:

- `docs/architecture/10_Capital_Q_MVP_V1_Release_Definition.docx`: §2.1 investor demo story, §15 release gate, §15.1 minimum investor demo acceptance;
- the PADL, the Product Specification and the Final System Review;
- the Q Pitch blueprint.

**Production** is `318577a8e`. The fix `7f218ec22` (meeting move response, D9/D10) is on the integration branch (`615791be8`) and not deployed.

**Method.**

- I read the handoff files, audits and code.
- I ran read-only hosted SQL for the seed and account state on 15 Nov, about 07:30 UTC.
- No browser, no model calls and no product code changes. Nothing was written to production.

## Status words (strict)

| Status                  | Meaning                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMPLEMENTED**         | Code exists, and no automated test covers the journey step.                                                                                              |
| **TESTED**              | Unit or integration tests in the gate cover it. This is not end-to-end proof.                                                                            |
| **PV `<sha>` `<date>`** | Production-verified: exercised live with stored rows or screenshots, cited. If it is older than the current head, the row says "not re-checked since …". |
| **INCOMPLETE**          | Missing, failing live, switched off, or never exercised live. The gap is named.                                                                          |

"Q changes since 13 Nov" means: TURN_READER v85 to v88, the account digest on every turn (`1af6e1954`), the uncertainty flow (`5dbc76d8a`), the fit exclusion (`949e17aa4`) and the turnNotes bound (`23413f400`).

## 1. Founder onboarding

| Capability (V1 source)                                              | Status                                                                         | Evidence / gap                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed and form onboarding, save and resume (§15)                    | PV `53271540e` / `a029a2f3d`, 12 Nov                                           | onboarding-e2e founder ALL PASS J1–J6; Lane H fresh founder (`BASELINE-LEDGER-2026-11-12.md`, "Integrated slice 1" and "Priority 0 journey"). **Not re-checked since the Q changes since 13 Nov.**                                                                                                                                                               |
| Voice answer during onboarding (§15.1 item 1)                       | INCOMPLETE                                                                     | The steer fix `e18a781f0` and the no-re-introduction fix are deployed. They have never been heard live: the sandbox has no UDP. Owner decision open: who leads the voice onboarding interview, the voice model or code (`HANDOFF-LOG.md`, 15 Nov). Demo fallback: "Use the form" (STATE, 9 Nov).                                                                 |
| Document-assisted; founder reviews Q-extracted material facts (§15) | PV `faa48e867`, 14 Nov                                                         | Deck → proposed figure cards (page-cited) → approve → USER_CLAIM/DOCUMENT_SUPPORTED claim; chat figure → approval card (`ACCEPTANCE-MATRIX` A8; ledger "A8 founder figures LIVE end to end"). This was proven as a post-onboarding Q flow. **Inside the onboarding run itself, a deck upload has not been live-checked since W4 (8 Nov, "deck still blocked").** |
| Pitch video upload (§15.1 item 2)                                   | PV 23 Oct (seed run, `HANDOFF-LOG.md` 2026-10-23)                              | `/pitch/new` as David (Capital Q): asset READY, Stream request 200. Hosted 15 Nov: 108 READY and 2 PROCESSING_FAILED (both Capital Q, 23 Oct); 88 companies have a READY pitch. **No upload on any November SHA.**                                                                                                                                               |
| Becomes marketplace-eligible after V1 checks (§2.1 step 3)          | PV for the synthetic path (A3/A4, 13 Nov); INCOMPLETE for a fresh real founder | PADL #57/#58: verification precedes discovery. The synthetic reviewer path (S4 guard `635c548d2`) is CERTIFIED in the gate only. A founder created live in a demo appears in Discover only after a four-eyes decision. The real-operator path has not been certified end to end (A4).                                                                            |
| "What is missing / how Q understands my company"                    | PV `3743dc48b`, 12 Nov (founder plan with research + Execute, A7)              | Not re-checked since the Q changes since 13 Nov, nor since search credit ran out.                                                                                                                                                                                                                                                                                |

## 2. Investor onboarding → personalised feed

| Capability                                                               | Status                                         | Evidence / gap                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mandate captured option-led; confirmed Discovery Profile; mandate ACTIVE | PV `a029a2f3d`, 12 Nov                         | Lane H mandate `ce1e622d…`; onboarding-e2e investor ALL PASS (ledger). Not re-checked since 12 Nov.                                                                                                                                                                                                     |
| First personalised slate without a synchronous LLM                       | PV (hosted read, 15 Nov)                       | The newest investor organisations (12 Nov) got a deterministic slate 61–76 s after creation, with 43–44 items. The demo slates are CURRENT: Savanna has 35 items (22:58Z, 14 Nov) and Kilima has 37 (06:25Z, 15 Nov), both `deterministic-ranker.v1`. 3,500 slates exist; the newest is 06:57Z, 15 Nov. |
| Mandate summary shown after onboarding (§15.1 item 3)                    | PV 9 Nov (`811202101`: finish → /verification) | Not re-checked since.                                                                                                                                                                                                                                                                                   |
| Voice mandate capture                                                    | INCOMPLETE                                     | Same as the founder voice row. The owner's 9 Nov run took the cheques by voice on `d9dc487e3`. Nothing has been heard since.                                                                                                                                                                            |
| Curated investor mandates coherent (A3)                                  | INCOMPLETE                                     | NOT AUDITED (matrix A3).                                                                                                                                                                                                                                                                                |

## 3. GateQ

| Capability                                          | Status                                                                   | Evidence / gap                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway setup: create a new gateway                 | INCOMPLETE (never checked live this cycle)                               | All 16 gateways are ACTIVE, and the newest was created on 10 Nov. Every live run used the existing Kilima and Lagos Forge gateways.                                                                                                                                                                                                   |
| Rules drafted with Q (B2)                           | TESTED (`412eec74e`)                                                     | LOCAL_TESTED. Fully automatic drafting needs a `policy_extractions.source_kind` change (owner sign-off).                                                                                                                                                                                                                              |
| Pause / reopen, accent, embed sites (B6/B7)         | PV `d2ce8c91e`, 14 Nov                                                   | `audits/2026-11-14-gateq-gateway-self-service-live.md`. The member read-only view is unit-tested only.                                                                                                                                                                                                                                |
| Brand from real websites and logos (B6)             | PV `30c99ccc5`, 15 Nov                                                   | Stripe, Flutterwave, Linear and Capital Q: name, SVG logo and colour in about 1–1.6 s; public page and embed; persistence as revisions (`audits/2026-11-14-gateq-branding-live.md`, `evidence/2026-11-15-branding/`). The P3 polish `be6e54bde` is in `318577a8e` and has not been re-checked live.                                   |
| Embed: frame and launcher on another origin         | PV `d2ce8c91e`, 14 Nov (render, headers, pause)                          | A full applicant submit through the embed was never run: it needs a contact code the sandbox cannot read.                                                                                                                                                                                                                             |
| Applicant text interview (adaptive, investor-aware) | PV `318577a8e`, 15 Nov (8/8 invariants)                                  | `audits/2026-11-14-gateq-sustained-journey.md` §"Re-certification 15 Nov"; `evidence/2026-11-15-gateq-2/`. **Live FAIL (UX):** when nothing is left, Q loops "What would you like to cover next?" and never points to "Finish and review". Two replies kept garbled fragments of a removed question (t15, t21).                       |
| Applicant contact verification                      | PV for a signed-in founder (account path), 14 Nov; INCOMPLETE for guests | Guest code mail to reserved domains is suppressed by design, so it cannot be verified from the sandbox (`audits/2026-11-14-gateq-applicant-journey-map.md`). Prefill misses Full name, and the deck is pre-ticked although the copy says "only if you tick it" (B11).                                                                 |
| Inbox, one-page summary, synthesis, investor Q      | PV `318577a8e`, 15 Nov                                                   | Synthesis READY first time (v2, 17 points, 51/51 turns read), stage row "answers disagree", both disagreements shown. P3: summary rows run their labels together, and "Estimated" vs "Said in the application" is inconsistent. The reply goes through Capital Q's sender after approval (B10). Connected Gmail outreach: INCOMPLETE. |
| GateQ voice interview (ElevenLabs)                  | IMPLEMENTED and TESTED (`6cb85a20f`, in prod); switched OFF              | It needs `CQ_GATEQ_VOICE_INTERVIEW=1`, `ELEVENLABS_GATEQ_SPEECH_ENGINE_ID` (q-api's `ELEVENLABS_API_KEY` reused) and `CQ_GATEQ_VOICE_SEAL_KEY` (or the video seal key) on **api**. It has never been heard.                                                                                                                           |
| Tavus video interview (B5) and plan gate (B12)      | INCOMPLETE                                                               | NOT AUDITED. The Tavus disposable key ran out in Oct; the current credit is unknown.                                                                                                                                                                                                                                                  |

## 4. Voice

| Capability                            | Status                                        | Evidence / gap                                                                                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q voice line speaks Q's words (one Q) | TESTED (`1a512590c`, deployed in `30c99ccc5`) | Audit `audits/2026-11-14-q-voice-context-audit.md`: before the fix, GPT-Live answered on its own, ad-libbed and claimed false progress. The fix is **not heard live**: the sandbox has no UDP.                                                                  |
| Voice survives Q opening a page       | TESTED (web `600cca432`, 10 Nov)              | Not voice-tested live.                                                                                                                                                                                                                                          |
| Spoken yes to a read-back             | PV owner session, 9 Nov (`d9dc487e3`)         | Re-asks fixed on `811202101`. Not re-heard.                                                                                                                                                                                                                     |
| Q Pitch spoken start / narration      | PV typed only, `74d33a828`, 10 Nov            | Start plays, and the typed ask opens the investor cut. The spoken split-transcript ask is parked. Not re-checked since the Q changes since 13 Nov. Most blueprint scenes are IMPLEMENTED or CODE_VERIFIED only (`docs/specs/q-pitch/IMPLEMENTATION_STATUS.md`). |

## 5. Q intelligence

| Capability                                                   | Status                                                  | Evidence / gap                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grounded answers from authorised records; firewall           | PV `4d61457fd`, 14 Nov; PV `318577a8e`, 15 Nov          | The Maji Loop private MRR did not leak (ledger 14 Nov). Kazikit and Ajopot "how solid" answers labelled self-reported (`audits/2026-11-14-investor-uncertainty-live.md` §318577a8e).                                                                         |
| Uncertainty → one offer → diligence request carrying `about` | PV `30c99ccc5`, 15 Nov; request state PV `318577a8e`    | Same audit, §30c99ccc5 and §318577a8e. Lows on `318577a8e`: D19 (title cut mid-word, ISO dates), D20 (stage line said twice).                                                                                                                                |
| Contradictions coexist                                       | PV (GateQ, `318577a8e`); PV founder figures `faa48e867` | C8 is not certified across one full investigation journey. There is no contradiction screen for founders (A8 remaining).                                                                                                                                     |
| Account context ("what's waiting for me")                    | PV `30c99ccc5` (HTTP digest), PV `318577a8e` (Q turn)   | `audits/2026-11-15-account-digest-live.md`. On `318577a8e` it answered "21 things need you", which included 8 MEETING "not booked yet" items from test residue, and D22 counted the Watchly message twice.                                                   |
| Fit ranking ("five strongest fits"), §2.1 step 7             | PV `318577a8e`, 15 Nov                                  | Exclusion of current contacts works. D17b: the left-out line under-reports ("None of these is a company you're already in touch with" instead of naming the 13 left out).                                                                                    |
| Research and public sources (C7)                             | **INCOMPLETE (provider credit out)**                    | Serper 402, Brave 402, Tavily 432 on every turn on `318577a8e` (D3/D4 info). Answers now say that search was unavailable. Paystack cited answer PV `4d61457fd`, 14 Nov, when Brave still had credit.                                                         |
| Charts, company media, inline artifacts                      | PV `0a6f0e298` / `c455c03d2` / `a37e844d5`, 13 Nov      | Not re-checked since the Q changes since 13 Nov. The live chart-intent eval was prepared and not run.                                                                                                                                                        |
| Contextual navigation (decision 98)                          | PV v85 typed 7/7 `f3589102d`, 13 Nov; **D18 open**      | On `318577a8e`, Q moved to /work for an OFFER decision and to Overview on a "how solid" question. Decision 98 (15 Nov) now says to move when it advances the immediate task and never merely because something is mentioned. Not yet implemented against 98. |

## 6. Discovery and video feed

| Capability                                                  | Status                                                       | Evidence / gap                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic, versioned ranking from precomputed slates    | PV (hosted read, 15 Nov) and TESTED                          | `deterministic-ranker.v1` slates CURRENT for the demo investors. P1-9 tie-break deployed `a029a2f3d`; tier/tie orderings are test-only (ledger).                                                                                                                                                   |
| Save, neutral Pass, Undo, server-confirmed Express Interest | PV `d96c63ee1`, 13 Nov (desktop and 390 px)                  | `audits/2026-11-13-founder-investor-journey.md` A1–A4. D12 (low): a company can be saved and passed at once. Not re-checked since 13 Nov.                                                                                                                                                          |
| **Video playback, first video fast, next/swipe**            | **INCOMPLETE**                                               | Never verified in a codec-capable browser on a November SHA. 4 Nov headless: spinner, `readyState` 0, inconclusive (`Q_MULTIMODAL_DEMO_AUDIT_2026-11-04.md`). 23 Oct: Stream request 200. The sandbox Chromium cannot prove H.264/HLS playback. LCP/INP/CLS for the feed have never been measured. |
| Reduced motion: poster plus explicit Play                   | TESTED only                                                  | Not live-checked.                                                                                                                                                                                                                                                                                  |
| Profile → evidence → Ask Q without losing context           | PV `d96c63ee1`, 13 Nov (tabs); PV `a029a2f3d` (Q on profile) | The deck is watermarked, with figures labelled "Founder's claim, not verified".                                                                                                                                                                                                                    |

## 7. Comparisons

| Capability                                                    | Status                                    | Evidence / gap                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q comparison of named companies (2–5)                         | PV `61b94f9d6`, 13 Nov                    | "Compare Ajopot, Ledgerline and Clinicrest" with no markdown duplicate table; Traction from the deck, labelled (ledger 13 Nov). The comparison is decided by the reading (`c455c03d2`). Not re-checked since the Q changes since 13 Nov. |
| Visual compare `/discover/saved/compare`, absent stays absent | INCOMPLETE (not live-checked in November) | Lane H 12 Nov checked it only with an unverified company (correctly refused). There has been no live run of 2–5 saved, ready companies.                                                                                                  |

## 8. Relationship actions

| Capability                                                    | Status                                                                  | Evidence / gap                                                                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Interest → founder accept → CONNECTED; one canonical row      | PV `d96c63ee1`, 13 Nov; INTEREST_ACCEPTED notice PV `7e3e22153`, 14 Nov | `audits/2026-11-13-founder-investor-journey.md`; matrix A11 re-check. D4 partial: at 390 px an opened briefing covers Accept/Decline. |
| Messages both ways; Q draft → human approval → send           | PV `d96c63ee1`, 13 Nov                                                  | Same audit.                                                                                                                           |
| Data room per rules                                           | PV `d96c63ee1`, 13 Nov                                                  | "5 documents, 3 open to you". **On-request ask → founder grant has never been run live.**                                             |
| Diligence document request → fulfil                           | PV `30c99ccc5`, 15 Nov                                                  | Through the uncertainty flow (Ajopot × Savanna, IN_DILIGENCE). The founder decline path has never been run live.                      |
| Decline interest; investor pass/pause/resume; commitment/deal | INCOMPLETE (never run live)                                             | Map only: `audits/2026-11-14-meetings-diligence-journey-map.md` S5/S6.                                                                |

## 9. Meetings

| Capability                                      | Status                                                                 | Evidence / gap                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Propose, counter, decline, accept (no calendar) | PV `78f8d72d5`, 14 Nov (HTTP); decline wording PV `318577a8e`          | `audits/2026-11-14-meetings-live.md`. Through HTTP only: **no web page uses the proposal routes** (B3, confirmed by grep on 15 Nov). The calls week and direct invites need a Google Calendar, and no fictional demo account has one. Accept-by-Q and propose-by-Q have not been run live since the fix. |
| Move                                            | PV PARTIAL `318577a8e`, 15 Nov                                         | The row moved correctly, but the response said `booked:false, meetingId:null` (D9), and the notice does not say it is a move (D10). Fixed in `7f218ec22`, **not deployed**. A move through Q's `meeting.reschedule` action has never been run live.                                                      |
| Cancel (idempotent)                             | PV `318577a8e`, 15 Nov                                                 | Same audit.                                                                                                                                                                                                                                                                                              |
| Prep brief                                      | PV (call prep "live-verified", per the journey map), date not recorded | The 13 Nov rehearsal offer → lobby is PV `3293f344e`. Hosted 15 Nov: **0 future SCHEDULED meetings on the whole platform.** 13 past meetings are still SCHEDULED and none is held, so there is nothing current to prepare for.                                                                           |
| Held, notes, commitments, outcomes              | INCOMPLETE                                                             | It needs Recall in a real Meet (B4). The no-bot `confirmHeld` path has never been run live.                                                                                                                                                                                                              |
| Errand meeting via Q chat (S1)                  | IMPLEMENTED; never run live                                            | Journey map S1.                                                                                                                                                                                                                                                                                          |

## Demo blockers, ranked

"Visible" means it would fail or look wrong in the 12-minute investor demo or in the owner's hands-on QA. Costs use about $0.10 per Q turn (ledger, 14 Nov), the top of the $0.03–0.10 range.

1. **Public web search is out on all three providers.** Serper 402, Brave 402 and Tavily 432.
   - Effect: every "public sources" or research answer says that search was unavailable. This hits plans, the uncertainty "what I checked" answer and "find X online".
   - Scenario: as `investor.savanna-seed`, ask "How much funding has Paystack raised, according to public reports?" Expect dated cited sources and "Public reports differ".
   - Cost: 1 turn, about $0.10. **Owner action:** top up one provider.
2. **Video playback has never been proven in a real browser on a November SHA.**
   - Scenario: on a phone (Safari or Chrome) and a desktop Chrome, as Savanna open `/discover`. The first pitch should play muted and inline within about 2 s, and Next/swipe should advance without a spinner. Then switch on reduced motion: expect a poster with Play and audio off.
   - Cost: no model; Cloudflare Stream delivery minutes (owner-paid, small). **Owner action:** real device, because the sandbox Chromium lacks the codecs.
3. **Voice has not been heard on any current SHA:** the Q voice line one-Q fix `1a512590c` and voice onboarding.
   - Scenario: on the owner's device as Savanna:
     - Open the voice line and ask "What are my top three matches?"
     - Then "open Clinicrest" and "compare it with Ajopot".
     - Expect Q's own words (no ad-lib, no false progress), the line to survive the page move, and one holding line during long work.
   - Cost: about 3–5 Q turns ($0.30–0.50) plus realtime audio minutes (provider-billed; the daily cap is `CQ_VOICE_LIVE_DAILY_CAP_USD`).
   - **Owner action:** a real call; the sandbox has no UDP. Owner decision is still open: who leads voice onboarding.
4. **Meetings cannot be shown in the web UI on the demo accounts.**
   - Causes:
     - no proposal page (B3);
     - the calls week needs a Google Calendar, and no fictional account has one;
     - 0 future meetings exist;
     - the move response D9 is wrong until `7f218ec22` deploys.
   - Scenario: deploy `7f218ec22`. Then:
     - As the Watchly founder, ask Q "propose a call with Savanna next Tuesday or Wednesday at 10 Lagos time". Expect an approval card, then a TIME_PROPOSED notice to Savanna.
     - As Savanna, accept through Q or the notice. Expect one meeting row plus MEETING_SCHEDULED and PREP_READY.
     - As Savanna, ask "move it to Thursday". Expect "moved", one row, and "Call moved" sent once to each member.
     - Open the prep brief.
   - Cost: 4–6 turns, $0.40–0.60.
   - **Owner decision:** present the no-invite path, or connect a real Google calendar to one demo account (a real Google identity on a fictional organisation).
5. **The demo accounts are cluttered with test residue.**
   - Savanna: 42 unread of 73 notifications, 3 PENDING "Message Ajopot" approvals, "21 things need you" including 8 stale meeting items.
   - Watchly has 15 unread and Kilima has 12. The Kilima gateway inbox is full of certification applications.
   - Scenario: ask "What's waiting for me?" as Savanna, and open the bell. Expect a short, true list.
   - Cost: 1 turn, $0.10.
   - **Owner approval needed:** a cleanup on production (reject the approvals and mark the notices read through the UI as each person), or a fresh curated demo investor and gateway.
6. **Q moves the page when not asked (D18), against decision 98.**
   - Scenario:
     - As Savanna, ask "How solid is Ajopot's active users figure?" Expect it to stay on the current page.
     - Then "What's waiting for me?" Move or offer only if opening Work advances the task; an ambiguous case should offer.
     - Then "show me my pipeline". Expect an automatic move.
   - Cost: 3 turns, $0.30. Code only, no owner action (decision 98 is given).
7. **The GateQ interview has no finish guidance.** Q loops "What would you like to cover next?" and never points to "Finish and review". Garbled question fragments also appeared.
   - Scenario: as a fresh fictional founder at the Kilima gate, answer every topic, then ask "Anything else you need from me?" Expect "Finish and review".
   - Cost: a full interview is 25 turns, about $0.10 total (measured $0.104 on `318577a8e`).
8. **Investor Q text glitches on `318577a8e`:**
   - D17b: the left-out line under-reports;
   - D19: a request title cut mid-word, with ISO dates;
   - D20: the stage line said twice;
   - D21: the fit dialog stays open after the next turn;
   - D22: a message counted twice.

   Scenario: replay the four asks in `audits/2026-11-14-investor-uncertainty-live.md` §318577a8e. Cost: 4 turns, about $0.13 (measured).

9. **Fresh onboarding has not been re-checked since 12 Nov,** after many Q changes.
   - The founder deck-in-onboarding path has not been live since W4.
   - A fresh founder reaches Discover only through a verification decision.
   - Scenario: run `onboarding-e2e` for both sides (typed and form). Then make the founder visible, submit verification and take the synthetic reviewer decision. Expect the company in a fresh investor's slate.
   - Cost: about 10–20 model-backed turns, $0.50–1.50 (estimate; the onboarding turns are not metered in this audit).
10. **The visual compare and the Q Pitch tour have not been checked on a current SHA.**
    - Compare: save 3 ready companies and open `/discover/saved/compare`. Expect absent values blank and never invented.
    - Q Pitch: open `/q-pitch`, press Start, then type "Pitch yourself to investors".
    - Cost: compare has none; Q Pitch is 1–3 turns plus narration audio (owner-paid).
    - Only if the demo uses the Q Pitch tour: the 12-minute script's scenes are mostly IMPLEMENTED or CODE_VERIFIED, not browser-certified.

Below the top 10:

- The GateQ voice interview is OFF (blocker only if it is shown). **Owner action:** set `CQ_GATEQ_VOICE_INTERVIEW=1`, `ELEVENLABS_GATEQ_SPEECH_ENGINE_ID` and a seal key on api, then make a real call.
- Tavus GateQ video and rehearsal video: credit unknown, not audited.
- B11: prefill misses Full name, and the deck is pre-ticked.
- B8: the first signed-in visit creates a draft.
- 390 px: an opened briefing covers Accept/Decline (D4).
- D12: saved and passed at once.

## Never checked live at all (this cycle or ever)

- **Pitch feed:**
  - video playback in a codec-capable browser;
  - feed LCP, INP and CLS;
  - reduced-motion playback.
- **Voice:** every voice line on current SHAs, the GateQ voice interview, Tavus GateQ video and rehearsal video (November).
- **GateQ:**
  - creating a new gateway, and a new investor's GateQ setup from scratch;
  - B2 Q-drafted rules live;
  - the member read-only view;
  - a guest applicant's contact code;
  - a full submit through the embed;
  - connected Gmail or Calendar outreach;
  - the interview plan gate (B12).
- **Meetings:**
  - calendar-connected booking and invites;
  - the Q errand meeting (S1);
  - accept and move through Q's actions;
  - held, notes and commitments (Recall);
  - `confirmHeld` without a bot;
  - meeting outcome → diligence.
- **Relationships:**
  - data-room on-request ask → grant;
  - founder declines a diligence request;
  - decline interest, investor pass, pause and resume;
  - commitment and deal terms.
- **Product checks:**
  - visual compare of 2–5 ready companies;
  - C5 cross-feature scenarios 1–10;
  - curated investor mandate coherence (A3);
  - the real-operator verification workflow end to end (A4).
- **Measurement:** the live chart-intent eval (prepared, about $0.40–1.15).

## Owner actions

1. Top up one search provider: Serper, Brave or Tavily.
2. Make a real-device check of pitch video playback and the Q voice line on the deployed SHA.
3. Decide how meetings are shown in the demo: the no-invite path, or connect a real Google calendar to one demo account.
4. Approve a cleanup of the demo accounts (Savanna, Watchly, Kilima) or a fresh curated demo pair.
5. If GateQ voice or video is in the demo:
   - set the GateQ voice variables on api;
   - confirm the Tavus credit.
6. Open decisions:
   - who leads voice onboarding;
   - a paused-gateway notice for founders;
   - whether a revoked raise should hide a confirmed deck (A5).
7. Rotate the exposed credentials (START-HERE table).
