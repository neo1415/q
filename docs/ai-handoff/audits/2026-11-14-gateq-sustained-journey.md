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
