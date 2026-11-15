# Investor onboarding → personalised feed, live (15 Nov 2026, 84ac9afa7)

Production SHA `84ac9afa7` came from the caller and was not re-read from Railway. This run re-checks the investor rows of `audits/2026-11-15-demo-readiness.md` §2, which were last verified on `a029a2f3d` (12 Nov).

## Method

The method follows `audits/2026-11-15-founder-onboarding-live.md`:

- **Account.** A fresh fictional account was created through the Supabase admin API with `syntheticAccountMetadata`. The admin and publishable keys were fetched with the management token into a 0600 scratch file. They were never printed, and the file was shredded at the end.
- **Driver.** A phased scratch driver (built on the `onboarding-e2e.mjs` helpers) signed in with `CQ_SEED_ACCOUNT_PASSWORD` and drove the typed conversation, one line per call. Q's lines and the stored answers were read back through the product API as that person. The mandate, slate and approval rows were read with `hosted-read.mjs`.
- **Browser.** Playwright Chromium (`/opt/pw-browsers/chromium`), deviceScaleFactor 2.
- **Spend.** Checked on `ai_ops.model_usage` before the Q-heavy steps.

### Accounts and IDs

- **Main (1440):** `e2e-inv-202611151542-to47@fictional.capitalq.local`, "Wanjiru Kamau-Test", Acacia Ridge Capital (fictional).
  - auth `d9c9d3df…`, app user `cb2c0cf5…`
  - tenant `2a117a80…`, investor org `6d9382f4…`
  - onboarding session `1f459a6d…`, mandate `362eb5e7…`
- **Phone check (390):** `e2e-inv-202611151606-6chb@…`, "Otieno Achieng-Test", Rift Lantern Partners (fictional).
  - auth `8069c4b8…`, app user `9716b513…`

### Safety

- No Express Interest, Save or Pass.
- Nothing sent to any person.
- Baridi appeared at slate rank 9 and was never opened. Ledgerline was not touched.

### Evidence

`evidence/2026-11-15-investor-onboarding/`: 28 JPEGs, all under 310 KB, and `run-log.jsonl` (every line sent, Q's replies and the timings).

## Verdict per step

| Step                                                                   | Verdict                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firm, type, role, deployment, stages, currency and cheques in one line | PASS                           | One turn (8 s) stored the type (`vc`), firm, role, stages and currency. The cheques were held until a read-back ("Minimum cheque: $100,000; Typical cheque: $250,000; Maximum cheque: $500,000 … is that right?") and stored on yes.                                                                                                                                                                                                                                                                                                                                                                            |
| Sectors, geography and exclusion in one line                           | PASS, with a defect (D3)       | "Kenya. We invest in fintech and healthtech across East Africa, and we never want to see crypto companies." This stored `I0.hq_country`, `I3.geography` (East Africa), `I3.sectors` (Fintech, Digital Health) and `I7.hard_exclusions` (`crypto_speculation`).                                                                                                                                                                                                                                                                                                                                                  |
| Skip one optional item                                                 | FAIL (D1)                      | Skipping "company fit" was answered "That information is needed to make your profile, matching and verification accurate", and the question came back 2 turns later. Skipping portfolio (`I8.portfolio`, `required: false`) blocked the finish ("This is the one answer I still need before I can finish"). "None yet, it's a new fund." was not taken as an answer, and the final read-back said "Portfolio: I don't know".                                                                                                                                                                                    |
| Finish                                                                 | PASS, with defects (D2, D4)    | "Finish setup" (labelled "Everything essential is in") only sent "That's everything for now. Please finish my setup." The person got a full read-back and had to type "Yes". After that it finished in 5.8 s: session COMPLETED, landed on `/verification`, and Q said: "Your mandate is saved and live: Discover will show you companies matched to it." Total about 18 minutes and 22 typed turns.                                                                                                                                                                                                            |
| Personalised feed appears                                              | PASS                           | Mandate ACTIVE `effective_from` 16:00:03Z. Slate `53380664…` (`deterministic-ranker.v1`) CURRENT at 16:00:11Z (8 s), with 37 items. The first card was visible **19.5 s after the final "Yes"**, via `/verification` and then `/discover`. The first card was Afyascan (Seed · Uganda · Digital Health), with "Why it's here: Seed, in your range · In a region you invest in · A category you named". Suitability 86.                                                                                                                                                                                          |
| Five cards against the mandate                                         | PARTIAL (D5)                   | 1 Afyascan (Seed, UG, digital health): all match. 2 Umoja Cover (Seed, KE, embedded finance/insurance): stage and region match; the card says "Your sector exclusion can't be checked yet". 3 Maji Loop (Seed, KE, energy): sector not named. 4 Clinicly (Series C+, KE): "Outside your mandate". 5 Dawaledger (Series A, KE, fintech): "Outside your mandate". The labels are honest.                                                                                                                                                                                                                          |
| Whole slate against the mandate                                        | See right                      | 37 items. Crypto or blockchain companies: **0**, so the exclusion held. Geography mismatch: **25 of 37**, although East Africa was declared "must-match": Nigeria, Mexico, UK, US, France, India, Germany, Canada, UAE. Stage mismatch: 16. Not in a named sector: 29.                                                                                                                                                                                                                                                                                                                                          |
| Q on Home: "What does my mandate look like?"                           | PASS                           | Answered in 14 s: "an actively investing VC mandate at Acacia Ridge Capital: typically $250,000 per investment, within a $100,000–$500,000 USD range … pre-seed and seed companies in East Africa, digital health and fintech, usually investing alongside others … crypto speculation is a hard exclusion." Every point is correct. It cites one source.                                                                                                                                                                                                                                                       |
| Change the cheque range through Q                                      | PASS, with a defect (D6)       | Asked for "$200,000 to $750,000, typically $400,000". Approval card: "Cheque: USD from 100,000, typically 250,000, up to 500,000 → USD from 200,000, typically 400,000, up to 750,000". The card was gone after a reload of `/home`. Asking again reused the same pending action (one approval row, idempotent). On Approve: mandate v16 written in 0.7 s, new slate `2e81a64c…` CURRENT in **7.4 s**, old one SUPERSEDED. `/capital` shows "USD 200,000 to 750,000, typically 400,000". Ranks, scores and membership did not change (only 1 item has a known round for the cheque check), so this is expected. |
| 390 phone: onboarding                                                  | PASS, with a minor defect (D7) | No horizontal scroll, no target under 44 px, and the form step renders. Q's newest question shows as a very large heading that runs under the composer (`390-33-dense.jpg`).                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 390 phone: feed                                                        | PASS                           | Full-bleed card, Save, Pass, Ask Q and More on the right rail, the "Seed, in your range +2" chip, and the tab bar. No horizontal scroll (`390-30-discover.jpg`).                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Stored mandate (hosted read)

### `core.investor_mandates` `362eb5e7…`

- ACTIVE, USD.
- Cheques 100000–500000; after the change, 200000–750000 (v16).
- Stages `pre_seed`–`seed`.
- **`discovery_mode` null.** The required step `I9.discovery_mode` was never asked and never answered.

### Constraints

| Constraint                 | Value                     | Importance                               |
| -------------------------- | ------------------------- | ---------------------------------------- |
| stage IN                   | pre_seed, seed            | MUST                                     |
| investment_role            | co_invest                 | STRONG                                   |
| cheque.typical             | 250000, then 400000 USD   | —                                        |
| founder.business_attribute | repeat_founder_experience | NICE                                     |
| green_flag                 | capital_efficiency        | NICE                                     |
| red_flag                   | crypto_speculation        | HARD_EXCLUSION, `is_hard_exclusion` true |
| custom.text                | "Execution risk"          | NICE                                     |

"Execution risk" was Q's own "why" follow-up answer, stored as a criterion.

### `taxonomy.mandate_preferences`

- `fintech` STRONG
- `digital_health` STRONG
- `east_africa` MUST

## Defects (ranked)

1. **D1: an optional skip is not honoured, and portfolio blocks the finish.** `I8.portfolio` is `required: false` in `packages/investor-onboarding/src/definition/investor-v1.ts`, but the finish gate asked for it as "the one answer I still need". "None yet" was refused. The skipped "company fit" step was called "needed" and asked again. This breaks the CLAUDE.md onboarding rule: "skip allowed; unknown valid". It is probably the D78 "every profile field mandatory" completeness check in the onboarding finish/readiness path (`packages/onboarding/src/application/…`, the q-api onboarding turn handler). It does not separate a declined optional step from a missing required one.
2. **D2: "Finish setup" does not finish.** The button (labelled "Everything essential is in") posts a chat line. Q then reads back about 30 fields and waits for a typed "Yes" (60 s with no navigation in this run). The likely file is the web `q-onboarding-workspace.tsx` finish handler, which should call finish directly or show a one-tap confirm.
3. **D5: a declared "must-match" geography is ranked as soft.** Q offers "must-match, strong preference, or nice to have" and stores `east_africa` MUST. Even so, 25 of 37 slate items are GEOGRAPHY_MISMATCH, and two in the top 5 are "Outside your mandate" (stage). `packages/discovery/src/slates/builder.ts` (`declaredGeographyCounts` comment) treats geography as never hard. The cards are honest, but the option Q offers promises more than the ranker does. Either the MUST geography or stage should be a declared hard-eligibility rule, or Q should not offer "must-match". This needs the owner's call (doc 19).
4. **D3: Q asks a question and withdraws it in the same turn.** "What makes crypto a hard no for you?" was followed immediately by "No need to answer that one: your last message already covered it. That's your mandate. Shall I make it live…". Then "Yes, make it live" did not make it live, and the interview carried on. Later, "Anything on sectors you'd rather not see, rather not see or excluded sectors" was a garbled re-ask of exclusions already answered "None beyond crypto". The likely file is the q-api onboarding interviewer, around the read-back and "why" step sequencing.
5. **D4: the required `I9.discovery_mode` was never asked.** It is null on the mandate. The finish counted "5 more answers" and then "one more" (portfolio) but skipped it.
6. **D6: a pending Q approval is lost on reload.** After a reload of `/home` the approval card is gone. Only the "1" badge and the greeting "One thing needs you" remain. The person had to ask again to get the card back. The likely file is the web Home Q thread, which does not rebuild cards from `q_runtime.approvals` PENDING.
7. **D7 (minor): the 390 onboarding question heading is very large.** Q's newest question renders as a hero heading that runs under the fixed composer. Also, a reload adds a fresh "Picking up where we left off." Q turn to the thread each time, and the big heading showed a stale earlier question (`1440-09-stuck.jpg`).

Minor note: the final read-back attached "(you also said 'I'll skip listing portfolio companies for now. Yes, make it live')" to "Never show: Speculative crypto". That is a misattributed aside.

## Cost

`ai_ops.model_usage` for both fictional users totals **$0.1207**: 99 calls for the main account ($0.1153) and 5 for the phone check ($0.0054). The classes were FAST_CLASSIFICATION, NORMAL_DIALOGUE and STRUCTURED_EXTRACTION. It was recorded against reservation `6f755f1a` as $0.13.
