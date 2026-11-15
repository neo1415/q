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

## Re-certification 14 Nov (06910b145)

- **Production:** `06910b145` (includes GateQ fix `4dd353859`: P1a, P1b, P2a, P2b).
- **Founder:** `founder.fb0128.baraka-kipchoge@fictional.capitalq.local`, Quilla, KE, profile stage `series_b` (fresh, no prior GateQ application). **Investor:** `investor.kilima-angels.njeri-kamau@fictional.capitalq.local`.
- **Window:** 18:27:29–18:37:40Z. **Cost:** 34 model calls, **$0.1155** (ai_ops.model_usage), recorded against reservation `56b5d15e`.
- **Records created:** application `1e9fd48e-0ad1-4233-87c4-d5e909423b2f` (created on first page load 18:27:47Z; SUBMITTED 18:34:25Z, ref `ga_0kfbp0rxgzjzrt6fq08bf828yp`); 49 turns (24 PERSON), 24 readings (19 READ, 5 NO_STATEMENTS), 40 statements (10 FORM, 30 TURN), 5 links, 3 disagreement events; submission `1a0d3276` (dossier `gateq-dossier.v2`, snapshot v3); synthesis READY (`GATEQ_DOSSIER_SYNTHESIS@v2`, 16 points, complete, 49/49 turns read, uncitedDropped 0); 1 investor Q turn.
- **Evidence:** `/tmp/claude-0/-home-user/baac2e44-f461-5146-93f5-14f30f7b1f41/scratchpad/gq8/` (`shots/J-*`, `K-*`, `I-*`; `sub.json`, `review.txt`, `inbox.txt`, `st1.txt`). Not durable.
- **Journey:** same script, adapted to the company (exam-prep edtech): form Seed / Software / USD 350,000 / deck and product brief ticked; 2,300 students and 600 WAU; nobody pays; 1→4 partner schools; CAC unknown; team; Series A topic change; "about 1,500 weekly active now"; "Leave it open for now"; use of funds; 350k→400k; market unknown; KICD approval risk; pricing; lead angel says seed → "Leave the stage open for now"; revenue zero; two dashboards → "Leave it open for now"; **browser closed; new context signed in and resumed**; 5 more turns; review; submit; investor inbox; one investor Q turn.

### Live re-check list

- **Resume, no writes on load: PASS.** The new context made 4 server-action POSTs on load, none carrying answers (start + progress reads). Statement count stayed 35, links 5, events 3 (checked before and after load). No FORM statement was written after 18:28Z; the FORM total is 10 at submission. The page opened straight into the interview with all 39 turns, and no role step (`K-01-resume.png`).
- **Form shows stored answers: PASS, with a defect.** No path back to the form after resume (only the interview and review). The review showed stored answers: stage disagreement, USD 400,000, Kenya, Software. **But the 2 documents ticked before the break were dropped:** the review says "No documents" and dossier `documents: []`. `answersFromRecord` does not restore `materials`, and the reopened draft is seeded from the profile (`materials: []`).
- **Stage: PASS.** CORRECTS `24179a6e` (t14 Series A corrects the form's seed, since the founder said "not seed"). DISAGREES `6568347a` (t30 "seed by revenue … Series A by age" vs Series A) is LEFT_OPEN at t32 and stays LEFT_OPEN through resume and submit. The frozen qualification is STAGE UNRESOLVED / STAGE_DISPUTED, `unresolved` = [stage], MAY_APPLY.
  - Investor inbox row and mandate panel: "Needs your judgement: answers disagree".
  - Founder gateway panel and Sent page: "Stage we invest at: Your answers disagree".
  - The synthesis says the stage is unresolved.
- **WAU "Leave it open for now": PASS.** DISAGREES `c1dbb4d6` (1,500 vs 600) is LEFT_OPEN at t18. t18 is NO_STATEMENTS. There is no UNKNOWN WAU statement (the only UNKNOWN is the market, t24) and no false disagreement against "Not known".
- **No growing "Earlier answers, corrected": PASS.** The review shows "(2)": the form's seed and USD 350,000. No form re-save happened, because no page path offers one after resume.
- **Investor Q: PASS** (`I-02`, one turn). It gives WAU 600 vs about 1,500 as unresolved, with the two dashboards; stage Series A vs "seed by revenue…" as unresolved; and "the earlier form recorded Seed, but that was superseded". It says the raise was **corrected from USD 350,000 to USD 400,000**. This agrees with the review, dossier and inbox.
- **Old application c4cf20bd, link `d942b2e1`: NOT FIXED ON ANY LIVE SURFACE.** The link is still stored (DISAGREES, UNKNOWN→COUNT, no events). The projector code now treats it as inactive, but the investor inbox renders the frozen v2 dossier. It still shows "Traction: answers disagree (open, not yet settled): '600 weekly active' and 'Not known'" in Conflicting answers and in diligence questions (`I-04-coverisk.png`). There is no re-projection or backfill of frozen submissions.

### Invariants

1. **FAIL.** 24/24 PERSON turns are read, and all 30 TURN statements are referenced by a reading. But t10 "We don't know our CAC yet" wrote **no statement**. The reading's UNKNOWN on `claims.traction` was converted to a LEAVE_OPEN on the unrelated 1-vs-4 partner-schools disagreement `88759f2c` (event at t10). So CAC unknown survives only in the transcript and the synthesis.
2. **PASS.** One raise CORRECTS, `2c436b22` (t22 USD 400,000 corrects form 350,000). The stage CORRECTS `24179a6e` is the founder's own "not seed". No other statement was superseded. The form never rewrote an interview statement.
3. **PASS** for stage and WAU: both stay visible as left open on every surface. **Defect:** a false contradiction. "we went from 1 partner school to 4 since March" (t8) was split into pilots=1 and pilots=4 and CODE_DETECTED as DISAGREES `88759f2c`. It shows on review, dossier (`contradictionsTotal` 3) and inbox as "answers disagree" between identical words.
4. **FAIL.** "Nobody pays yet" (t6) was read only as `paying_customers` = 0. Q then asked for revenue five times (t23 "What did you bill…", t25, t27, t29, t33). After "Revenue is zero today… as I said" (t34), Q asked for that zero's period (t35). t11 re-asked the false 1-vs-4 contradiction.
5. **PASS (note).** After LEFT_OPEN on the stage (t32), it was never asked again. At t37 Q asked "Which dashboard should I use?", but only after the founder reopened the WAU topic himself.
6. **PASS (with defect).** Resume in a new context kept the application, all turns and readings, and every statement. It wrote nothing on load, showed no role step and no blank form, and no interview claim was left. **Defect:** the ticked documents were lost on resume, so the submission went with 0 of 2.
7. **PASS.** Each success claim has a matching record:
   - t19 "I'll leave those two weekly-active figures open" matches LEFT_OPEN `c1dbb4d6` (t18).
   - t33 "leave the stage unresolved" matches `6568347a` (t32).
   - t15 and t23 "correcting" match CORRECTS `24179a6e` and `2c436b22`.
   - **Defect (false negative):** at t39 and t41 Q said "I haven't marked those two answers as left open yet", though `c1dbb4d6` was LEFT_OPEN since t18. The repeat "Leave it open" was read as an `application.note` TEXT statement (t38, t40), and `replyHeldToReading` counts only this turn's LEFT_OPENs.
8. **FAIL (narrow; the P2a items now agree).** Stage, WAU and raise agree, with statement ids and turn sources, across review, dossier, inbox, Sent page, qualification, synthesis and investor Q. Remaining disagreements:
   - **1→4 partner schools:** a contradiction on review, dossier and inbox, but growth in the synthesis.
   - **CAC unknown:** only in the synthesis.
   - **Stage header:** dossier `company.stage` and the inbox "Company" block show the single value "Series A", beside "answers disagree".
   - **Founder's note:** includes "Leave it open for now." and "Still leave it open for Kilima." as note text.

### Defects, ranked

1. **P1 (invariants 1, 3):** the implicit LEAVE_OPEN matches any standing disagreement on the same dimension, ignoring `quantity`. An unrelated UNKNOWN on `claims.traction` (CAC) is swallowed into a LEAVE_OPEN on another quantity's disagreement. Fix in `packages/gateq-intake/src/application/statement-plan.ts`, `standingOn` (~897–912): match dimension and quantity, or require the op's target.
2. **P1 (invariants 3, 4, 8):** a range in one sentence ("from 1 to 4") becomes two same-turn, same-quantity statements, and code detection links them as DISAGREES. Code detection should skip statements from the same source turn and words (`statement-plan.ts` ~870–885). The reading should keep only the current value, or tag the earlier one as `as_of`.
3. **P2 (invariant 6):** resume on a new device drops the document selection, so the submission went with 0 of 2 documents with no warning. Materials are client-only. Fix in `apps/web/src/features/gateq/form/form-model.ts` `answersFromRecord` and `gateq-form.tsx` reopen (`initialAnswers` from the profile): persist or restore `materials` from the record.
4. **P2 (invariant 4):** zero paying customers does not settle revenue, so revenue is re-asked five times, then a zero's period is asked. Coverage or next-question logic should treat `paying_customers` ZERO plus "nobody pays" as revenue ZERO, or not ask for a period of a zero.
5. **P2 (invariant 7, false negative):** a repeated "leave it open" on an already LEFT_OPEN disagreement is read as a note. `replyHeldToReading` (`statement-plan.ts` ~1286) then replaces Q's true sentence with `NOT_LEFT_OPEN_LINE`. It should count standing LEFT_OPEN disagreements named by the reply, not only this turn's events.
6. **P2 (invariant 8):** frozen pre-fix submissions are not re-projected. `c4cf20bd` still shows the false "600 vs Not known" OPEN contradiction to the investor.
7. **P3:**
   - Dossier `company.stage` and the inbox header show one stage value during a disagreement.
   - Leave-open phrases are stored in `application.note`.
   - "40 percent of signed-up students are girls" is stored as a `users` PERCENT.
   - First page load creates an IN_PROGRESS application before the founder acts (`startFormAction` on entry).

## Re-certification 14 Nov (78f8d72d5)

- **Production:** `78f8d72d5`. It includes the shared-cause fix `715f55bbc` (restored in `1ebe465ea`) and the document-selection fix `fc68b217a`. Migration `20261231590000` is applied, and `gateq.application_document_selections` exists.
- **Founder:** `founder.fb0018.zawadi-abdi@fictional.capitalq.local`, Schemaora Systems, KE. The profile stage is "Later" (`series_c_plus`). The founder was fresh, with no `application_founders` row. **Investor:** `investor.kilima-angels.njeri-kamau@fictional.capitalq.local`.
- **Window:** 22:56:37–23:06:28Z. **Cost:** 35 model calls, **$0.1202** (ai_ops.model_usage; the investor accounts for $0.0848 of it), recorded against reservation `3ca38fd7`.
- **Records created:**
  - application `6f16ad1a-0c7c-4f29-9f25-d9d1c28814c3`, created 22:57:24Z on the first form action and SUBMITTED 23:03:47Z (ref `ga_3zsmdea98fpqtk4jjcjsqn1z46`);
  - 53 turns (26 PERSON) and 26 readings (19 READ, 7 NO_STATEMENTS);
  - 41 statements (10 FORM), 6 links and **1** disagreement event;
  - submission `dd96b0b6` (dossier snapshot v3, `documentsTotal` 2);
  - synthesis READY (`GATEQ_DOSSIER_SYNTHESIS@v2`, 17 points, complete, 53/53 turns read, uncitedDropped 0);
  - 1 investor Q turn.
- **Evidence:** `/tmp/claude-0/-home-user/baac2e44-f461-5146-93f5-14f30f7b1f41/scratchpad/gq9/`. It holds `shots/J-*` (first browser), `K-*` (resumed browser, deviceScaleFactor 2), `I-*` (investor, deviceScaleFactor 2), `sub.json`, `review.txt`, `inbox.txt` and `resume-before.txt`. Not durable.
- **Journey:**
  - Form: Seed, Software, USD 350,000, deck and product brief ticked.
  - 2,300 pipelines and 600 WAU; "Nobody pays yet"; "from 1 pilot company to 4 since March"; "We don't know our CAC yet"; team; "really a Series A company now, not seed".
  - "Back to users: about 1,500 weekly active users" (undated); use of funds; 350k→400k; market not sized; data-residency risk; pricing.
  - "Lead angel calls us seed…" → "Leave the stage open for now", then a second request to leave the stage open.
  - "600 … and about 1,500 … two different dashboards" → "Leave it open for now".
  - **Browser closed. A new context signed in and resumed:** "Still leave it open", acquisition, "Anything else?", confirmation, "That's all".
  - Review, submit, investor inbox, one investor Q turn.
- **Operator error:** after resume, the driver also sent three lines left in a copied script from the Quilla run (t38, t40, t42: "students who finished a practice set", "exam coordinators at our 4 partner schools", "Anything else?"). The founder then said at t50 that the school line was pasted by mistake. Q flagged the mismatch itself (t41, t43, t47). The run has 26 founder turns instead of 23. No verdict below rests on those turns.

### Live re-check list

- **First page load creates no application: PASS.** The gateway had 12 applications before the load (22:56:37Z). After the load it still had 12, and the founder had 0 `application_founders` rows (22:57:17Z). The only POST was a read. The draft was created at 22:57:24Z, on the first tick.
- **"From 1 to 4" makes no disagreement link: PASS.** It became one statement, `3520d2da` (pilots = 4, all words), with no link.
- **CAC unknown is stored as a statement, with no leave-open event: PASS.** It is `dc616a24` (`application.note` TEXT "We don't know our CAC yet."). Zero events at t10. Investor Q reports "No CAC figure … 'We don't know our CAC yet.'"
- **"Nobody pays yet" settles revenue: PASS.** `9cae8d81` is a revenue ZERO and `9de4ce92` is a paying_customers ZERO, both at t6. Q never asked for revenue or its period again. The t27 question was about conversion.
- **An undated 600 vs 1,500 stays a visible disagreement: FAIL until the founder raised it again.**
  - At t16, "Back to users: about 1,500 weekly active users" was read as **CORRECTS** `97042ca6` (1,500 supersedes 600, `d036b462`), although no correction words were used. Q replied that this "clears up the earlier figure".
  - The disagreement exists only because the founder restated 600 at t34. That created a new statement, `911cb743`, and DISAGREES `c3487431`.
  - The original 600 is listed under "Earlier answers, corrected".
- **Leave-open: FAIL.** "Leave the stage open for now; let Kilima judge" (t30), "Please leave that disagreement open" (t32) and "Leave it open for now" (t36) each wrote nothing (NO_STATEMENTS, empty `not_recorded`).
  - **Cause, confirmed in `application_turns.intent`:** Q's turns t31, t33 and t37 are intent `QUESTION_FOR_Q`. `interviewer.ts` (~854–861) sets `discardedByIntent`. Then `statement-plan.ts` (~1157, `for (const action of input.discard ? [] : actions)`) drops the `disagreementActions` together with the facts.
  - On the earlier prompt (`1e9fd48e`), the same phrases were intent ANSWER or UNKNOWN_OR_SKIP and were recorded.
  - Every reading at `reading_version` 3 so far has produced no LEFT_OPEN from a bare leave-open.
  - The only event in this run, LEFT_OPEN on `c3487431`, came at t44. That turn was intent CORRECTION, because it also carried new words.
- **A repeated leave-open keeps Q's correct sentence: partial.**
  - t45 "I'll leave those figures open" is true, matching the t44 event.
  - t31, t33 and t37 said "I haven't marked those two answers as left open yet". That was true to state, but each time the founder's request was lost.
  - **t39 is a false success claim.** Q said "I'll leave the weekly-active figures open for Kilima; what would you like to know…?", and no event exists. The claim shares a sentence that ends in "?", so the `CLAIMS_LEFT_OPEN` guard (`statement-plan.ts` ~1365–1402), which skips questions, let it through.
- **Resume: PASS.**
  - **No answer POST on load:** 5 server-action POSTs. The first was `{reopenOnly:true}`; the other 4 carried only the session credential.
  - **Counts unchanged:** statements 36, links 5, events 0, turns 37 and selection revision 2, both before and after the load.
  - **Stored answers shown:** the page opened straight into the interview with the full transcript and no role step.
  - **Documents:** both ticked documents were restored. Review lists "Documents you ticked: Schemaora Systems investor deck (fictional), Schemaora Systems product brief (fictional)". The dossier has `documents` = 2 and `documentsTotal` 2 (`K-01-resume.png`, `K-review-full.png`).
- **Stage header: FAIL (P3).** The inbox "Company and founder" block and dossier `company.stage` show only "Series A", beside "answers disagree". Review lists both stage statements.
- **Old applications: PASS.**
  - Coverisk (`c4cf20bd`) no longer shows "600 vs Not known". Its Conflicting answers list only the two left-open WAU pairs.
  - Quilla (`1e9fd48e`) shows no "1 vs 4 partner schools" contradiction: only stage and WAU, both left open. The synthesis calls it growth (`I-04-Coverisk.png`, `I-04-Quilla.png`).

### Invariants

1. **PASS.** All 26 PERSON turns have a reading (19 READ, 7 NO_STATEMENTS). Every TURN statement has words and a source turn. The NO_STATEMENTS readings are leave-open and conversational turns.
2. **FAIL (narrow).**
   - Raise: one CORRECTS, `c4b368ad` (t20 USD 400,000 corrects form `8a57f0be`).
   - Stage: CORRECTS `a9ac65f5` is the founder's own "not seed".
   - No form re-save happened after resume (FORM total 10).
   - **But** CORRECTS `97042ca6` superseded the 600 WAU without any correction from the founder (see 3).
3. **FAIL.**
   - The undated 1,500 silently corrected 600 at t16. The disagreement exists only after the founder's t34 restatement.
   - The stage DISAGREES `91025060` stays visible on every surface. It is OPEN, not left open, against the founder's two requests.
4. **PASS (note).** Revenue, CAC, raise, team and pilots were not asked again. At t43 Q asked about the stage again. The stage was OPEN in state, but only because the founder's leave-open was dropped. At t11 Q asked "how many customers or users are live" after users were given.
5. **FAIL.** The stage leave-open (t30, t32) and the WAU leave-open (t36) were never recorded, and Q came back to the stage at t43.
6. **PASS.** Same application, all 53 turns and 26 readings kept. No writes on load, no role step, documents restored and submitted (2), no interview claim left.
7. **FAIL.**
   - t39 claims "I'll leave the weekly-active figures open" with no LEFT_OPEN event.
   - Other claims match records: t45 matches LEFT_OPEN on `c3487431`, t21 "the raise is four hundred thousand" matches `c4b368ad`, and t15 "Series A, not seed" matches `a9ac65f5`.
8. **FAIL (narrow; values agree).**
   - These agree: USD 400,000 (corrected from 350,000), WAU 1,500 vs 600 left open, the stage dispute, zero revenue and the 2 documents. They match across review, dossier, inbox, Sent page ("Stage we invest at: Your answers disagree"), the frozen qualification (STAGE UNRESOLVED / STAGE_DISPUTED, MAY_APPLY), the inbox row ("Needs your judgement: answers disagree") and investor Q (`I-03-investor-q.png`). Investor Q also gives the 350k→400k correction and "CAC not known".
   - These disagree:
     - The stage state is "open, not yet settled" on review, dossier and inbox, while the synthesis says the founder "explicitly leaves the … disagreement open".
     - The synthesis says "the form says Series A", but the form said Seed.
     - The stage header shows one value.
     - "Still leave it open for Kilima." is in the Founder's note.
     - The inbox summary repeats "Founder stated" without separators.

### Defects, ranked

1. **P1 (invariants 3, 5, 7, 8):** a bare leave-open is classified `QUESTION_FOR_Q`, and `discardedByIntent` then drops its `disagreementActions`. Fix in `packages/gateq-intake/src/application/statement-plan.ts` ~1157: never discard disagreement actions by intent. Also fix `interviewer.ts` ~854–861, and possibly the prompt v8 intent rule (`packages/q-core/src/prompts/tasks/gateq-interviewer.v8.ts`), which says a leave-open is "never a statement, never a note".
2. **P1 (invariants 2, 3):** an undated restatement of a metric ("about 1,500 weekly active users", with no "actually" and no date) is read as CORRECTS, and the earlier figure is hidden. A CORRECTS should require correction language from the founder. Otherwise the second figure should be NEW, and `relatable` code detection should link the pair as DISAGREES. Fix in the prompt v8 CORRECTS rule, plus a write-path check in `statement-plan.ts` that an undated, unmarked restatement cannot correct.
3. **P2 (invariant 7):** a left-open claim joined to a question in one sentence escapes the reply guard (`CLAIMS_LEFT_OPEN` skips sentences ending in "?"; `statement-plan.ts` ~1365–1402). The guard should split clauses on ";" or "—", or test the claim regardless of the trailing "?".
4. **P3:**
   - The stage header shows one value during a dispute (`company.stage` and the inbox company block; `dossierStageWords` is not applied there).
   - Leave-open words go into `application.note`.
   - "We haven't sized the market" is stored as an `application.note` UNKNOWN, so Market shows as "Missing", not "Unknown".
   - The same acquisition line is stored twice (t46 COUNT and TEXT; duplicated on review).
   - The synthesis attributes Series A to the form.

## Re-certification 15 Nov (30c99ccc5)

- **Production:** `30c99ccc5`, which includes GateQ fix `ce4bf65e5`: intent never gates disagreement acts; CORRECTS only when signalled; per-clause reply check; dedupe; leave-open words kept out of the note; unknown answers the asked dimension; stage rows show every answer; interviewer prompt v9, `reading_version` 4.
- **Founder:** `founder.fb0217.zawadi-wambui@fictional.capitalq.local`, Clinicly, KE. The profile stage is "Later" (`series_c_plus`). The founder was fresh, with no prior GateQ application. **Investor:** `investor.kilima-angels.njeri-kamau@fictional.capitalq.local`.
- **Window:** 02:54:21–03:04Z. **Cost:** 34 model calls, **$0.1199** (ai_ops.model_usage: interview 26 calls and $0.0300; synthesis $0.0039; investor 7 calls and $0.0859). Recorded against reservation `ad6602c7`.
- **Records created:**
  - application `f08ea19a-b361-4471-aece-c7f4424be52a`, created 02:55:16Z on the first form action and SUBMITTED 02:59:51Z (ref `ga_56cmf73m56wexxrwmxrgmakppw`);
  - 51 turns (25 PERSON) and 25 readings, all `reading_version` 4;
  - 36 statements (10 FORM), 5 links and 2 disagreement events;
  - submission `7b81e402` (dossier `gateq-dossier.v2`, snapshot v3, `documentsTotal` 2, `contradictionsTotal` 3);
  - synthesis READY (`GATEQ_DOSSIER_SYNTHESIS@v2`, 15 points, complete, 51/51 turns read, uncitedDropped 0);
  - 1 investor Q turn.
- **Evidence (durable):** `docs/ai-handoff/evidence/2026-11-15-gateq/` holds:
  - `01-founder-resume-form.jpg`
  - `02-founder-review-disagreements.jpg`
  - `03-investor-inbox-needs-judgement.jpg`
  - `04-investor-dossier-stage-row.jpg`
  - `05-investor-comparison-stage.jpg`
  - `06-investor-q-answer.jpg`

  Scripts and raw reads are in the non-durable scratchpad `gq10/`.

- **Driver fix:** the 14 Nov run sent three leftover lines from a copied script. `drv.cjs` now deletes every stale `cmd/out/ready` file for its tag on start and refuses any command file older than the driver. `run.sh` refuses to reuse a command number. Every sent line is logged with its time (`s.sent`). The sent log matches the 25 PERSON turns exactly.
- **Journey (25 founder turns):**
  - Form: Seed, Health, USD 350,000, deck and product brief ticked.
  - Turns 1–8: what it does; "2,300 patient records digitised and 600 weekly active users"; "Nobody pays yet"; "from 1 clinic to 4 since March"; "We don't know our CAC yet"; team; "really a Series A company now, not seed"; "Back to users: about 1,500 weekly active users." (undated, with no correction words).
  - Turns 9–18: bare "Leave it open."; use of funds; "Sorry, I meant 400k, not 350k."; "We haven't sized the market."; problem; risk; pricing; "lead angel calls us seed… by age I'd say Series A. I'm not sure which is right."; bare "Leave it open." twice.
  - **Break: the browser was closed. A new context signed in and resumed.**
  - Turns 19–25: "Leave it open for now."; solution; "On weekly users, leave it open for Kilima."; acquisition; "Anything else you need from me?"; "Four clinics, the same four pilots…"; "That's all from me for now."
  - Then review, submit, investor inbox, comparison and one investor Q turn.

### Live re-check list

- **First page load creates no application: PASS.** The gateway had 13 applications before the load and 13 after it. The founder had 0 founder rows. The two load POSTs were reads. The draft was created at 02:55:16Z, on Continue.
- **Every leave-open is recorded: PASS.**
  - t18, a bare "Leave it open.", was read as NO_STATEMENTS and wrote LEFT_OPEN on WAU DISAGREES `999b411e`.
  - t34, a bare "Leave it open.", wrote LEFT_OPEN on stage DISAGREES `fb6195f5`.
  - The repeats at t36, t38 and t42 met links that were already LEFT_OPEN. Each wrote nothing (NO_STATEMENTS) and created no statement, note or false link.
- **Q's left-open claims are all backed: PASS.** Every Q turn was checked, questions included. The only left-open claim is t19, "I'll leave the weekly-active-user figures as they are", which matches the t18 event. The repeats got "Fair enough.", with no false negative and no false positive.
- **An undated restatement becomes DISAGREES: PASS.** The t16 "about 1,500" is NEW `86e84c7a`, linked by DISAGREES `999b411e` against 600 `b9e75a66`. It is not a CORRECTS. Q asked "Which figure should I use?". Both values are visible as "left open by the founder" on the review, dossier, inbox Conflicting answers, synthesis ("remains unresolved") and investor Q.
- **The real correction is CORRECTS for the raise only: PASS.**
  - Raise: `90d7add3` (t22 USD 400,000 corrects form `a1d913ef`).
  - Stage: `078ad774` is the founder's own "not seed".
  - There are no other CORRECTS links. The review shows "Earlier answers, corrected (2)".
- **No leave-open words in the note: PASS.** The note statements are the form note, the free pilot, CAC unknown, four years operating, the risk and acquisition.
- **Market is a stated unknown: PASS, except the summary row.** `bd15481f` is `company.market` UNKNOWN (t24). The dossier `unknowns` is [Market], and `missing` holds only website, instrument and lead. The review shows "Market: You don't know yet". **Defect:** the inbox one-page summary shows "Market: Not covered".
- **No duplicate statements within a turn: PASS.** No same-turn, same-dimension repeats. The t6 revenue ZERO and paying_customers ZERO share their words, but they are different quantities.
- **Stage rows show every answer: PASS.**
  - The inbox "Company and founder" Stage reads "Series A or Our lead angel calls us seed… (answers disagree)" (`04`).
  - The comparison "Declared stage" shows the same (`05`).
  - The review lists both stage statements, marked "Left open by the founder".
  - Still single-valued: dossier JSON `company.stage` = "Series A".
- **Synthesis wording: PASS.** Stage and traction are "remains unresolved", with no "left open" claim on an OPEN pair. "The form describes a monthly primary-care teleconsultation plan" refers to a real FORM statement (the profile-prefilled description). No interview answer is attributed to the form.
- **Resume: PASS.**
  - **No answer POST on load:** 5 POSTs, the first `{reopenOnly:true}` and the other 4 carrying only the session credential.
  - **Counts unchanged:** statements 31, links 5, events 2, turns 37 and selection rows 1, both before and after the load.
  - **No role step:** the page opened straight into the interview with the full transcript (`01`).
  - **Documents:** both documents were restored. The review lists both, and the dossier has `documents` 2.
  - **No interview claim** was left after submit.

### Invariants

1. **PASS (minor).** 25/25 PERSON turns read (18 READ, 7 NO_STATEMENTS). All 26 TURN statements have words and a source turn, and every one is referenced by a reading (unreferenced 0). Minor: `e204dcb1` (t32) stores paraphrased words, "by revenue I'd say seed", where the founder said "we're seed".
2. **PASS.** The only CORRECTS links are `90d7add3` (raise, signalled) and `078ad774` (the founder's own "not seed"). The undated 1,500 did not supersede 600. No FORM statement was written after 02:55:18Z (FORM total 10).
3. **PASS for WAU and stage. Defect: a false contradiction.**
   - Both disagreements, `999b411e` and `fb6195f5`, are visible and LEFT_OPEN on every surface until submit.
   - **Defect:** "2,300 patient records digitised" (t4) was read as `customers` = 2,300. "From 1 clinic to 4" (t8) became `customers` = 4. Code detection then linked DISAGREES `cc176a9a` (OPEN). It shows on the review, dossier, inbox, synthesis and investor Q as "answers disagree (open, not yet settled)".
4. **FAIL (narrow).**
   - t15 asked "where is Clinicly based today — which country?", though Kenya was given in the form (`908ca5a4`).
   - t45 asked "How many clinics are using Clinicly today?" after "1 clinic to 4". This follows from the customers misclassification.
   - t31–t39 asked "What does the product do day to day" four times. Turn 2 had given the description, though the solution dimension was formally unanswered until t40.
5. **PASS.** After LEFT_OPEN on WAU (t18) and on the stage (t34), Q never asked about either again, including after resume.
6. **PASS.** Same application, all turns, readings and statements kept. No writes on load, no role step, documents restored and submitted (2), no claim left.
7. **PASS.** Each success claim has a matching record:
   - t19 "leave the weekly-active-user figures" matches LEFT_OPEN `999b411e`.
   - t23 "the raise is four hundred thousand… rather than three hundred and fifty" matches `90d7add3`.
   - t15 "Series A, rather than seed" matches `078ad774`.
   - t25 "the market isn't sized yet" matches `bd15481f`.
8. **FAIL (narrow; values and states agree).**
   - **These agree:** USD 400,000 (corrected from 350,000), WAU 600 vs 1,500 left open, stage Series A vs "seed by revenue…" left open, zero revenue, CAC unknown, market unknown and 2 documents. They match across the review, dossier, inbox detail, list row ("Needs your judgement: answers disagree"), comparison, Sent page ("Stage we invest at: Your answers disagree"), frozen qualification (STAGE UNRESOLVED / STAGE_DISPUTED, MAY_APPLY), synthesis and investor Q (`06`, which also gives both corrections).
   - **These disagree:**
     - The inbox one-page summary shows "Market: Not covered", where the same panel says "Market: Not known".
     - Its Traction row shows only "2,300 … 600 weekly active users", the first two facts, without the left-open 1,500.
     - Dossier `company.stage` is single-valued.
     - The false 2,300-vs-4 contradiction (see 3).

### Defects, ranked

1. **P2 (invariants 3, 4, 8):** a count of a non-customer unit is classified as `customers`. "2,300 patient records digitised" became `customers` = 2,300, and code detection paired it with "1 clinic to 4" as DISAGREES `cc176a9a`. The re-ask at t45 follows from this. Fix in the reading quantity rules (prompt v9, `packages/q-core/src/prompts/tasks/gateq-interviewer.v9.ts`). Also add a guard in `packages/gateq-intake/src/application/statement-plan.ts` code detection: do not link two `customers` counts whose words name different units ("records" vs "clinic").
2. **P2 (invariant 8):** `onePageSummary` in `apps/web/src/features/gateq/page/inbox-model.ts` (~575–615) has two faults.
   - It drops UNKNOWN facts, so a stated-unknown Market reads "Not covered". It should say "Not known".
   - It shows `facts.slice(0, 2)`, which hides one side of a left-open disagreement (the 1,500). It should show both sides of a disagreement, or mark the row "answers disagree".
3. **P3 (invariant 4):**
   - Q asked for the country, which the form had answered (t15). Coverage should treat the FORM `company.country` as settled.
   - Q asked "day to day" four times while the description was given at t2.
4. **P3:**
   - Dossier JSON `company.stage` is still one value during a dispute (the inbox and comparison now render every answer).
   - The t32 stored words are paraphrased.
   - "They get paid faster because fewer claims are rejected" is stored as `company.description`.

## Re-certification 15 Nov (318577a8e)

- **Production:** `318577a8e`, which includes GateQ fix `ee113ff40`: a count names a metric only when its unit fits; one settled-for-asking predicate (`askingState` / `mayAskAbout`) checks Q's own question; stored words are a span of what was said; dossier `company.stage` holds every answer while disputed; the inbox one-page summary shows stated unknowns as "Not known" and every side of a disagreement; interviewer prompt v10, `reading_version` 5.
- **Founder:** `founder.fb0002.otieno-wekesa@fictional.capitalq.local`, Solaix Co (pay-as-you-go solar), KE. The profile stage is Series B; the founder said Seed in the form, then Series A and "seed by revenue". The founder was fresh, with no prior GateQ application. **Investor:** `investor.kilima-angels.njeri-kamau@fictional.capitalq.local`.
- **Window:** 06:36:44–06:49Z. **Cost:** 34 model calls, **$0.1044** (ai_ops.model_usage: interview and synthesis 27 calls and $0.0349; investor 7 calls and $0.0695). Recorded against reservation `f66832e7`.
- **Records created:**
  - application `24bc5d5c-b3ff-4c94-967b-67cee6af36f6`, created 06:37:17Z on Continue and SUBMITTED 06:46:47Z (ref `ga_20jfsmwyhseqt38bjcsrh8czq3`);
  - 51 turns (25 PERSON) and 25 readings (18 READ, 7 NO_STATEMENTS), all `reading_version` 5;
  - 35 statements (10 FORM, 25 TURN), 4 links and 2 disagreement events;
  - submission `efc76d00` (snapshot v3, `documentsTotal` 2, `contradictionsTotal` 2);
  - synthesis READY (`GATEQ_DOSSIER_SYNTHESIS@v2`, 17 points, complete, 51/51 turns read, uncitedDropped 0);
  - 1 investor Q turn.
- **Evidence (durable):** `docs/ai-handoff/evidence/2026-11-15-gateq-2/` holds:
  - `01-founder-resume.jpg`
  - `02-founder-review-disagreements.jpg`
  - `03-investor-inbox-summary.jpg`
  - `04-investor-dossier-stage-row.jpg`
  - `05-investor-conflicts-synthesis.jpg`
  - `06-investor-q-answer.jpg`

  Scripts and raw reads are in the non-durable scratchpad `gq11/`. The driver is the fixed `drv.cjs` from `gq10` (it refuses stale command files and logs every sent line).

- **Journey (25 founder turns):**
  - Form: Seed, Climate, USD 350,000, Kenya (prefilled from the profile), deck and product brief ticked.
  - Turns 1–8: what it does; "12,000 transactions processed and 600 weekly active users"; "Nobody pays yet"; "from 1 school to 4 since March"; "We don't know our CAC yet"; team; "really a Series A company now, not seed"; "Back to users: about 1,500 weekly users." (undated, with no correction words).
  - Turns 9–18: bare "Leave it open."; use of funds; "Sorry, I meant 400k, not 350k."; "We haven't sized the market."; problem; risk; pricing; "lead angel calls us seed… by age I'd say Series A. I'm not sure which is right."; bare "Leave it open." twice.
  - **Break: the browser was closed. A new context signed in and resumed.**
  - Turns 19–25: "Leave it open for now."; day-to-day; "On weekly users, leave it open for Kilima."; acquisition; "Anything else you need from me?"; what Kilima could bring beyond capital; "That's all from me for now."
  - Then review, submit, investor inbox and one investor Q turn.
- **Transport incident:** at t16 the browser lost its connection (`ERR_NETWORK_CHANGED`). The server recorded t16 and Q's t17 reply. After a reload the page showed "Not sent. Your last answer needs confirmation", with Send disabled. One "Leave it open." typed at 06:42:43Z was never sent (the driver's sent log has 26 lines; 25 reached the server). "Try again" recovered Q's reply with no duplicate turn (turns stayed 17).

### Live re-check list

- **The form answered the country, and Q never asked it: PASS.** No Q turn has `asking_dimension` `company.country`, and no question names the country.
- **The range is settled for asking: PASS.** "From 1 school to 4" became one statement, `0368032a` (customers = 4, all words), with no link. After it, Q never asked "how many …". The only "How many households are paying" questions were t3 and t5, before the range, and "Nobody pays yet" (t6) settled them.
- **Nothing was asked more than twice: PASS, with garbled fragments.** Per dimension: customers t3 and t5; problem t7 and t9; use of funds t11 and t13; market t15 and t19; instrument t23 and t25; stage t33 once. After its second ask, no dimension came back. **Defect:** two replies keep a fragment of a removed question: t15 "…operating for four years. roughly in amounts? If you size the market…" and t21 "…lockout software. if any?". Both are stored in the transcript that the investor receives.
- **An unusual-unit count makes no link: PASS.** "12,000 transactions processed" is `9a4a457a`, quantity `transactions`. No link touches it. Unlike Clinicly, it is not read as `customers`.
- **Words are verbatim: PASS.** All 25 TURN statements' words are a substring of their source turn (0 not verbatim). The stage statement `facd72f4` keeps "Our lead angel calls us seed, though, and honestly by revenue we're seed".
- **An undated restatement becomes DISAGREES: PASS.** The 1,500 is NEW `8a093f45`, linked by DISAGREES `0c2739a6` against 600 `b9c508be`. It is not a CORRECTS.
- **Leave-open: PASS.**
  - The bare t18 wrote LEFT_OPEN on `0c2739a6`.
  - The bare t34 wrote LEFT_OPEN on stage DISAGREES `28390c65`.
  - The repeats at t36, t38 and t42 wrote nothing (NO_STATEMENTS), with no note and no false link.
- **Dossier stage: PASS.** Dossier `company.stage` = "Series A or Seed". The inbox "Company and founder" Stage row reads "Series A or Seed (answers disagree)" (`04`).
- **One-page summary: PASS.**
  - Market: "Not known".
  - Traction shows 600 and "about 1,500 weekly users" with "Answers disagree: left open by the founder", and "And 1 more in the dossier" (`03`).
  - Both disagreements are listed with both sides.
  - Readability (P3): the rows run labels together with no separator ("Founder stated And 3 more…", "Estimated Answers disagree…"). The 1,500 is tagged "Estimated" there but "Said in the application" elsewhere.
- **Guidance when nothing is left: FAIL (UX).** From t35 to t43, Q answered five turns with "What would you like to cover next?" (t35, t37, t39, t43; also at the end of t41). It never pointed the founder to "Finish and review". t45 ended with no next step at all. The close at t51 ("there's nothing else I need from you right now") also gives no review or submit step. The founder must find "Finish and review" alone.
- **Resume: PASS.**
  - **No answer POST on load:** 5 POSTs, the first `{reopenOnly:true}` and the other 4 carrying only the session credential.
  - **Counts unchanged:** statements 32, links 4, events 2, turns 37 and selection rows 1, both before and after the load.
  - **No role step:** the page opened straight into the interview with the full transcript (`01`).
  - **Documents:** both documents were restored and submitted (`documentsTotal` 2).
  - **No interview claim** was left after submit.
  - **No FORM writes after 06:37:18Z** (FORM total 10).

### Invariants

1. **PASS.** 25/25 PERSON turns read (18 READ, 7 NO_STATEMENTS). All 25 TURN statements have verbatim words and a source turn, and every one is referenced by a reading (unreferenced 0).
2. **PASS.** The only CORRECTS links are `2d82c791` (t22 USD 400,000 corrects form `983e3a64`, signalled) and `2582fdb0` (t14 Series A corrects the form's seed: the founder's own "not seed"). The undated 1,500 superseded nothing.
3. **PASS.** WAU `0c2739a6` and stage `28390c65` are both LEFT_OPEN and visible on every surface until submit. There is no false contradiction: transactions, the 1→4 range and the CAC unknown form no link.
4. **PASS (with fragments).**
   - The form's country was never asked.
   - No "how many" question came after the range.
   - No dimension was asked more than twice, and settled items (revenue, CAC, team, raise, problem) were not asked again.
   - Defect: the question fragments at t15 and t21 (see above).
5. **PASS.** After LEFT_OPEN on WAU (t18) and on the stage (t34), Q never asked about either again, including after resume. t51 restates the stage as open without asking.
6. **PASS.** Same application; all turns, readings and statements kept; no writes on load; no role step; documents restored and submitted (2); no claim left. A separate transport fault (t16) recovered without a duplicate turn, but it left Send disabled until "Try again" was pressed.
7. **PASS.** Each success claim has a matching record:
   - t15 "Series A rather than seed" matches `2582fdb0`.
   - t23 "correcting the raise from three hundred and fifty thousand… to four hundred thousand" matches `2d82c791`.
   - t51 "the stage question remains between Series A and seed" matches LEFT_OPEN `28390c65`.
   - Q made no left-open claim that lacks an event.
8. **PASS.** These agree across the review (`02`), dossier, inbox one-page summary (`03`), Company block (`04`), Conflicting answers and synthesis (`05`), list row ("Needs your judgement: answers disagree"), Sent page ("Stage we invest at: Your answers disagree"), frozen qualification (STAGE UNRESOLVED / STAGE_DISPUTED, MAY_APPLY) and investor Q (`06`):
   - USD 400,000, corrected from 350,000;
   - WAU 600 vs about 1,500, left open;
   - stage Series A vs Seed, left open;
   - zero revenue;
   - CAC not known;
   - market not known;
   - 2 documents.

   Minor display gaps:
   - "1 school to 4" is held as quantity `customers` under traction, yet the review and dossier list Customers as "Missing" and the summary says "Customers: Not covered".
   - The day-to-day answer (t40) is stored as `company.business_model`, so Solution shows "Missing".
   - "By age I'd say Series A. I'm not sure which is right." sits in the Founder's note.

### Defects, ranked

1. **P2 (invariant 4, transcript quality):** when `mayAskAbout` replaces or drops Q's question, the tail of the original question is left in the stored reply: t15 "roughly in amounts?" and t21 "if any?". The cleanup should cut the whole question sentence, not just its leading clause. Investors receive these lines verbatim.
2. **P2 (UX):** when the picker has nothing left, Q says "What would you like to cover next?" five times, or ends with no next step. It never points to "Finish and review" or submit. The end-of-interview reply should name the review step.
3. **P3:** after a dropped connection, the reloaded page shows "Your last answer needs confirmation" with Send disabled, although the server had recorded the turn and Q's reply. "Try again" recovers without a duplicate, but a founder's typed answer was silently not sent.
4. **P3:**
   - The one-page summary rows lack separators, and the 1,500 is tagged "Estimated" there but "Said in the application" elsewhere.
   - The held customers count (4 schools) shows as Customers "Missing" or "Not covered".
   - The day-to-day answer is classed as business model, so Solution shows "Missing".
   - Part of the stage sentence goes into the Founder's note.
