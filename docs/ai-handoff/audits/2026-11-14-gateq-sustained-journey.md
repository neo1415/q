# GateQ sustained journey: live certification of atomic statements slice 2 (14 Nov 2026)

- **Production:** `1f9e33016` (slice 2 write path and decision 91).
- **Gateway:** Kilima Angel Network (fictional), `/g/gq_7aekqs9vfk8kvavm8k7tcacryn`.
- **Founder:** `founder.fb0158.juma-wekesa@fictional.capitalq.local`, Swiftix Works, KE, seed.
- **Investor:** `investor.kilima-angels.njeri-kamau@fictional.capitalq.local`.
- **Run window:** 12:12:51–12:28:33Z.
- **Cost:** 35 model calls, **$0.1173** (ai_ops.model_usage), recorded against reservation `3a089bbc`.
- **Records created:**
  - application `e6790b18-9a4c-4e78-b3f9-71c4be1e176d` (SUBMITTED 12:25:35Z);
  - 53 turns (26 PERSON), 41 statements, 3 links, 1 disagreement event, 26 turn readings;
  - 1 submission and 1 synthesis (READY);
  - 1 investor Q turn.
- **Evidence:** screenshots and scripts are in `/tmp/claude-0/-home-user/baac2e44-f461-5146-93f5-14f30f7b1f41/scratchpad/gq6/`, under `shots/` (F-_, G-_, I-*). The scratchpad is not durable.

## Journey (26 founder turns)

1. Form: Fintech, USD 350,000, deck and product brief ticked.
2. What it does.
3. "2,300 wallets opened and 600 weekly active."
4. "Nobody pays yet."
5. "1 platform to 4 since March."
6. "We don't know our CAC yet."
7. Team.
8. Topic change: "really a Series A company now, not seed."
9. "about 1,500 weekly active now."
10. Use of funds.
11. "Actually we're raising $400k, not $350k."
12. Problem.
13. "The main risk is licence renewal…"
14. Pricing.
15. "lead angel calls us seed… not sure which is right."
16. "Leave the stage open."
17. Volume.
18. Market unknown.
19. Founder raises 600 vs 1,500 ("two dashboards").
20. "Leave it open for now."
21. **The browser was closed. A new browser context signed in again and resumed.**
22. Further turns: "Still leave it open", acquisition, agents, trust account, "Anything else?", "I already said: leave the stage open", usage, "That's all".
23. Review, then submit.
24. Investor inbox, with no Q call.
25. One investor Q question.

## Invariants

### 1. PASS (with classification defects)

All 26 PERSON turns have a reading: 23 READ and 3 NO_STATEMENTS ("Leave the stage open", "Anything else?", "That's all"). 38 TURN statements each hold exact words and a source turn. Every statement is referenced by a reading's `recorded_statement_ids`.

### 2. PASS

There is exactly one raise CORRECTS link, `ddf6fa86`: 0a95e98b (USD 400,000, seq 20) corrects 474820b4 (form USD 350,000). No other statement was superseded. Use of funds, traction and team are intact. The review, inbox, dossier and synthesis all show USD 400,000.

### 3. FAIL for weekly active users; partial for stage

**Weekly active users:**

- 7f4ff41e (600, seq 4) and 5dc432e4 (1,500 "now", seq 16, ESTIMATED) share `claims.traction / weekly_active_users`. Both have `as_of` null.
- The model read 1,500 as NEW. Code detection skips a null as_of (`statement-plan.ts` ~803/827). So **no DISAGREES link was ever written**.
- "Leave it open for now" (seq 38) became **an UNKNOWN WAU statement** (bc43da47), not a LEFT_OPEN event.
- The founder review, inbox and dossier show only concatenated legacy text ("600 weekly active … About 1,500 weekly active now … Leave it open for now."). Dossier `contradictions: []`.
- Only the synthesis and investor Q call it unresolved, and both read that from the transcript.

**Stage:**

- DISAGREES link `894d2fc6` is LEFT_OPEN (seq 30).
- The frozen qualification is STAGE UNRESOLVED/STAGE_DISPUTED, MAY_APPLY (decision 91 works).
- But the review, dossier and inbox "Stage" field show "Seed", with no disagreement.

### 4. PASS

No settled item was asked again: team, revenue, CAC, raise, problem, pricing. Use of funds was asked four times, but it was unanswered each time.

### 5. FAIL

- Seq 39: straight after "Leave it open for now", Q asked again: "which one should I use … or leave weekly active users unknown?"
- Seq 47: Q asked again about the LEFT_OPEN stage ("Which description should I use?").

### 6. PASS (UX defect)

- The new browser context resumed the same application `e6790b18` with the full 53-turn transcript.
- 26 of 26 readings exist, and there was no interview claim left at the end.
- **Defect:** the gateway URL showed a blank form (sector, amount and documents reset; recovery is localStorage only). Continue was refused ("Pick one…") until the form was re-entered. Re-entering USD 400,000 added no duplicate statement.

### 7. FAIL

- At seq 39 and 41 Q said "I'll leave the two dashboard figures unresolved". There is no matching DISAGREES link or LEFT_OPEN event; only an UNKNOWN statement exists.
- The stage claims at seq 31 and 49 match LEFT_OPEN `894d2fc6`. Seq 48 also wrote a stray UNKNOWN stage statement.

### 8. FAIL (readers still on legacy facts; slice 3 not shipped)

**Where the surfaces disagree:**

- The dossier is `gateq-dossier.v1`, snapshot v2.
- Stage: the qualification and synthesis say UNRESOLVED. The review, dossier, inbox field and Sent page say "Seed". The founder's Sent page says "Stage: Meets", while the investor inbox says "Two answers to review", and its list row says "1 rule not answered".
- CAC unknown, the licence risk and the trust account appear only inside "Founder's note" in the inbox. They are not in the founder review's facts.

**What passes:**

- Synthesis (decision 97): complete=true, 14 points (5 RISK HIGH/MED…), uncitedDropped 0, coverage 53 of 53 turns read. The compact view has "Show all 14 points", and all 14 rendered (`I-02-synthesis-all.png`).
- Investor Q (`I-03-investor-q.png`):
  - It labelled the sources correctly: application USD 400,000 against the deck's KES 214,000,000.
  - It gave the WAU as unresolved, 600 against 1,500, from two dashboards.
  - It did not mention the 350k→400k correction.

## Defects, ranked

1. **P1 (invariants 3, 5, 7):** a numeric disagreement with a null as_of is never linked. The model reads the second figure as NEW, and code detection requires a non-null as_of. LEAVE_OPEN then has no link to act on, so it is stored as an UNKNOWN statement. Q still says "I'll leave … unresolved" and asks again.
2. **P1 (invariant 8):** the founder review, dossier v1 and inbox still render legacy concatenated facts. Stage shows "Seed" despite the LEFT_OPEN disagreement and the UNRESOLVED qualification, and dossier `contradictions` is empty. Slice 3 is required.
3. **P2 (invariant 8):** the stage verdict differs between surfaces: "Meets" on the founder form, panel and Sent page; UNRESOLVED in the frozen qualification; "not answered" in the inbox list row.
4. **P2 (invariant 5):** LEFT_OPEN stage was asked again at seq 47, despite the event existing.
5. **P2:** a stage CODE statement stored garbage, `our_lead_angel_calls_us_seed_though_and_honestly_by_revenue_we_r`, instead of a valid code.
6. **P3:**
   - Live form answers are stored with `origin` BACKFILL, not FORM.
   - Misclassification: "same day instead of waiting a week" is stored as traction, and "averaging $2,500 each" is a separate business-model fragment.
   - CAC and the main risk go to `application.note`, which is missing from the founder review.
7. **P3:** a resume on a new device shows a blank form that must be re-entered before the interview reopens.

## Re-certification 14 Nov (d2ce8c91e)

- **Production:** `d2ce8c91e` (atomic statements slices 1–3; every reader on one statement view).
- **Founder:** `founder.fb0019.kamau-barasa@fictional.capitalq.local`, Coverisk Africa, KE (fresh, no prior GateQ application). **Investor:** `investor.kilima-angels.njeri-kamau@fictional.capitalq.local`.
- **Window:** 16:46:50–16:59:07Z. **Cost:** 33 model calls, **$0.1150** (ai_ops.model_usage), recorded against reservation `74bca3f5`.
- **Records created:** application `c4cf20bd-d1b0-44ab-a081-2b1279d4726b` (SUBMITTED 16:57:23Z, ref `ga_2rcny7mk7y9e2qa5z0v0vnrvwq`); 49 turns (24 PERSON), 24 readings, 81 statements (31 TURN), 50 links, 3 disagreement events; submission `0321d3ab` (dossier `gateq-dossier.v2`, snapshot v3); synthesis READY (`GATEQ_DOSSIER_SYNTHESIS@v2`, 13 points); 1 investor Q turn.
- **Evidence:** `/tmp/claude-0/-home-user/baac2e44-f461-5146-93f5-14f30f7b1f41/scratchpad/gq7/` (`shots/F-*`, `G-*`, `I-*`; `sub.json` is the frozen submission; `review.txt`, `inbox.txt`). Not durable.
- **Journey:** same script as the earlier run (form Seed / Fintech / USD 350,000; 2,300 wallets and 600 WAU; nobody pays; 1→4 platforms; CAC unknown; team; Series A topic change; "about 1,500 weekly active now"; leave it open; use of funds; 350k→400k; market unknown; licence renewal risk; lead angel says seed → leave the stage open; two dashboards → leave it open; browser closed; new context resumed; submit).

### Invariants

1. **PASS.** 24/24 PERSON turns read (19 READ, 5 NO_STATEMENTS). All 31 TURN statements have words and a source turn, and every one is referenced by a reading. Minor: seq 30 stored paraphrased words ("…by revenue I'm seed" for "we're seed").
2. **FAIL.** The raise correction is clean: one CORRECTS link `b497c7f9` (af15d419 USD 400,000 corrects form 81f535d1). However, loading the gateway page on resume auto-posted the profile-prefilled form (stage `series_b`) at 16:55:21Z, before the founder did anything. Its FORM statement `95a1d7e6` CORRECTS three interview stage statements: `26cb87f8`→eff8b24c Series A t14, `4e33a464`→9056c785 seed t30, and `134d67c2`→961e4a20 unknown t30. Link `92f2ffea` also corrects the interview description e5782dd3 (t2) with profile text.
3. **FAIL for stage, PASS for WAU.**
   - **WAU:** DISAGREES `e6a9844a` (600 vs 1,500) is now written. It shows with both values and turn sources on review, dossier v2 (`contradictions` = 3), inbox and synthesis.
   - **Stage:** LEFT_OPEN `2e490869` is `active:false` after the resume form overwrite. Review, dossier, inbox and Sent page show "Stage: Seed (Given in the form)" and list Series A/seed as "Earlier, corrected". The frozen qualification says STAGE MATCH, with `unresolved: []`.
4. **PASS (note).** No settled item was re-asked. At seq 45 Q asked "What does the four refer to?", caused by misclassifying "1 platform to 4" as customers = 4.
5. **PASS.** After LEFT_OPEN on the stage (seq 32) and on WAU (seq 38), neither was asked again.
6. **FAIL (no data loss, but state corrupted).** The new context resumed the same application with 49 turns, 24/24 readings and no claim left. But the form was blank again (`G-01b-resume-form-full.png`): Continue stayed disabled until stage, sector, amount, country and documents were re-entered, and the contact role step reappeared. The page-load autosave, plus the re-entry, superseded the open stage disagreement (see 2).
7. **PASS.**
   - Seq 33 "I'll leave the stage open" matches LEFT_OPEN `2e490869`.
   - Seq 39 "I'll leave the dashboard difference open" matches LEFT_OPEN `e6a9844a` and `c6ecb7f9`.
   - At seq 19, when the first "Leave it open" was not recorded, Q honestly said "I haven't marked those two answers as left open yet".
8. **FAIL.**
   - **WAU and raise:** these now agree across review, dossier, inbox and synthesis, with statement ids and turn sources (fixed since `1f9e33016`).
   - **Stage:**
     - Review, dossier, inbox, Sent page ("Stage: Meets") and investor Q say "Seed".
     - The synthesis says "stage description is unresolved … founder asked Kilima to judge".
     - The verdict "Needs your judgement: answers disagree" appears nowhere for this application. The inbox row reads "Meets every rule of your gate". The Swiftix row does show the new label.
   - **False disagreement:** "Leave it open for now" (seq 38) was stored as an UNKNOWN WAU statement `9af60617`, with DISAGREES `d942b2e1` (600 vs "Not known"), state OPEN. This third "open, not yet settled" contradiction appears on every surface and in investor Q.
   - **Investor Q** (`I-03-investor-q.png`):
     - It agreed with the dossier on WAU (unresolved, two dashboards), the stage (Seed) and the raise (USD 400,000), and labelled the profile as a separate source (Series B, KES 2.25bn).
     - It did not mention the 350k→400k correction or the interview stage disagreement.

### Defects, ranked

1. **P1 (invariants 2, 3, 6, 8):** opening the gateway page on resume autosaves the profile-prefilled form, and FORM statements CORRECT interview (TURN) statements on the same dimension. This erased the LEFT_OPEN stage disagreement and the interview description. Two rules are needed: a form save must never supersede a TURN statement or an open or left-open disagreement it did not change; and resume must restore the stored form answers.
2. **P1 (invariant 8):** a leave-open reply is read as an UNKNOWN statement, which code then links as DISAGREES against the known value. The result is a false OPEN contradiction (600 vs "Not known") on every surface. An UNKNOWN must never form a disagreement.
3. **P2 (invariant 8):** the stage verdict differs between surfaces: synthesis "unresolved"; qualification, dossier, inbox and Sent page "Meets"/"Seed".
4. **P2:** every form save rewrites all FORM statements as CORRECTS of identical values. There are 4 copies of the name, contact, country and stage, and the review shows "Earlier answers, corrected (35)".
5. **P3:**
   - The same WAU 1,500 is recorded twice (t16, t36), so the review and dossier show two left-open pairs.
   - "1 platform to 4" is stored as `customers` = 4, which caused a re-ask.
   - Paraphrased words are stored at t30.
   - The first "Leave it open for now" (t18) was not applied to the existing link `e6a9844a`.
