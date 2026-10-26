# Onboarding loop — run log (onboarding worker)

Owner direction (23 Oct, relayed by the coordinator): sign up → full onboarding → judge → repeat on production until founder and investor onboarding are premium. Accounts: fictional `*@fictional.capitalq.local` created through the product's own sign-up (`/auth/sign-up`), plus the owner's two QA accounts for verification only. Nothing outward.

**Account deletion: the product has no deletion flow** (no Settings entry, no API). Admin-deleting an auth user would orphan its organisation, company or investor org, documents and sessions, which is how duplicate orgs pile up. So every loop uses a fresh fictional account. Reported to the coordinator 24 Oct as a separate packet that needs owner decisions.

Harness: Playwright on `/opt/pw-browsers/chromium` through the agent proxy, typed mode ("Prefer to type?"). Fictional deck: "Tamarind Ledger (fictional)", a 6-slide PDF. Scripts live in the session scratchpad and are not committed. Timings are wall clock from the script.

## Run 2 — 24 Oct 06:51 UTC, founder `loop-f-r2`, deploy 382e17901

| Check                                    | Result                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-up to /welcome                      | 3.8 s                                                                                                                                                                     |
| First Q words (typed)                    | 3.6 s ✓ (target < 2 s for voice)                                                                                                                                          |
| Deck dropped before naming               | Kept. Q's reply misread it as "not added": "you can add it with the upload button" (F-68)                                                                                 |
| "The company is called Tamarind Ledger." | Saved, 1/9. Turn settled in 12.1 s (slow). Reply echo "that's on your record: company name: Tamarind Ledger" (QO-20 key:value)                                            |
| Held deck after naming                   | Uploaded at once, processed ~10 s later. Q was told "read back" at that point, but its findings landed at +47 s, so Q said "add it whenever you're ready" (**F-69 root**) |
| Hosted read                              | PITCH_DECK COMPLETED 06:51:43; deck read 06:52:16; 14 suggestions 06:52:30                                                                                                |

Fixed: F-69 and F-68 wording in #403 (wait for findings from this document, honest "reading", late findings handed to Q).
Open from this run: turn latency 12 s; 45 s from upload to findings (target: seconds); QO-20 echo.

## Run 5 — 24 Oct 13:20–15:05 UTC, investors `loop-f80-*`, `loop-i-f80-1458`, `loop-i-f66b-1504`

| Check                                                          | Result                                                                                                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-80 on 18d7884c4 (API, after the firm's name)                 | `[I0.investor_type, I2.currency]` batch → **409 VERSION_CONFLICT** every time; type alone and `[type, deployment]` commit. QA session fe6bc5d7: every answer held, investor type included |
| F-80 after the fix deployed (db45f2ae, API)                    | `[type, currency, cheque_min, stages]` → all COMMITTED, firm bound ✓                                                                                                                      |
| One typed sentence (type + cheques + sectors + places + never) | **Essentials 6 of 9**, settled 14.6–18.2 s. Receipt: firm, VC fund, USD, $100,000 / $500,000, Seed, Fintech + Clean Energy, Gambling + Tobacco ✓                                          |
| F-66 coverage panel                                            | "Minimum cheque: USD 100,000", "Geography: Egypt, Morocco" ✓                                                                                                                              |
| Receipt vs record                                              | Receipt said "the Gulf (geography)"; record holds Egypt + Morocco with "the Gulf" in their words (it names no single node). Fixed in #433                                                 |
| Not saved                                                      | "crypto" (never invest) → not mapped to Speculative crypto; left for a product call                                                                                                       |

Fixed: F-80 in #428 (deferred stage/cheque update bound the firm against a stale session version). Open: "crypto" mapping; turn latency ~15 s.

## Run 6: 25 Oct 07:46–10:30 UTC, founder `loop-f-b9-0746` (one account, reused under the owner's spend rule)

| Check                                                | Result                                                                                                                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #452 on b9202164: Q's line after a reload            | Shown once, before and after the reload ✓                                                                                                                                                                                |
| #454 on b9202164: deck panel vs Q                    | **Fail.** The panel had 10 "I picked up" facts (Stage · Seed, …); Q said "I can't read back the deck's findings … nothing from it has been saved yet" and asked for the stage                                            |
| Hosted read                                          | 15 `EVIDENCE_DOCUMENT` suggestions at 07:47:38, the upload announcement at 07:47:40, Q at 07:47:45. `interview_readings` stated `F2.materials` for the announcement turn                                                 |
| Root cause                                           | The reader read "I've just uploaded the deck" as stating the upload step; the refused write's reason said "add it with the upload button". A replay without that reading read the deck back                              |
| Composer hint before a reload                        | General "Ask Q about companies, capital or relationships" under "what does the company do?"                                                                                                                              |
| #484 on 07a748ac8: deck re-upload, 2 automatic turns | Q: "I'm reading tl-payroll-deck.pdf now …", then "I found these points in the uploaded deck: … seed stage, payroll and compliance for Ghanaian SMEs, two people on the team. Is that right?" ✓ Hint "Type your answer" ✓ |

Fixed: #484 (the reader is never offered upload-only steps; once findings wait, the refusal says to read them back; a step without its own hint shows "Type your answer").
Open from this run: a second deck's findings for the same steps appear in the panel beside the first deck's (Stage · Seed twice), not merged; "Type your answer" is not translated (Arabic deferred).

## Run 7: 25 Oct 14:03–14:20 UTC, owner-approved fresh founder `e2e-f-1403` and investor `e2e-i-1403` on 2632e2cb9 (11 typed turns of 15, no voice)

Founder (session cad1561f-0885-48af-bd2f-a28466af4d16):

| Step                                     | Result                                                                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-up                                  | ✓ 4.3 s to /welcome; Q's first words about 8 s                                                                                                                                                                          |
| Turn 1 (name + what it does)             | ✓ company name and Ghana saved, description held for their yes; 16.7 s                                                                                                                                                  |
| Turn 2 (yes, seed, CEO)                  | ✓ description, Seed and CEO saved (6 responses; the description suggestion EXPIRED once answered); 17.2 s                                                                                                               |
| Reload mid-interview                     | **Partial.** The thread resumed, but the "That's right" confirm control was gone; the cursor's upload step showed                                                                                                       |
| Deck upload                              | ✓ read back 64 s after upload, with no "not read" and no upload-button line. **Stale heading** (Q's previous question)                                                                                                  |
| Duplicate offers                         | **Defect.** On the read-back turn Q's recommend wrote 6 Q_RECOMMENDATION offers equal to the deck's, 5 s later                                                                                                          |
| "Keep all"                               | **Defect.** 5 accepted, then "That didn't go through: The onboarding session does not allow this action right now" beside Q's "All kept. Thank you."                                                                    |
| Turn 3 (raising, $900k SAFE, category)   | ✓ raising, USD, SAFE, amount and categories saved (17 responses). **"210 customers is right" went to the F7 note**: F5.customers is off a seed company's path (laterStage only), so the deck's offer could never settle |
| Turn 4 ("finish and go to my home page") | **Fail.** "we'll pause here … How many founders?": next question appended, no navigation, session ACTIVE. "Continue later" → /home works                                                                                |
| Home                                     | **No proactive first answer** ("Welcome back, Abena. What's on your mind today?")                                                                                                                                       |
| Turn 5 "How investor-ready am I?"        | ✓ 27 s, grounded and sourced; lists traction as open (customers not saved)                                                                                                                                              |

Investor (session b087386d-0762-417c-8e44-af1944a9810b):

| Step                     | Result                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-up                  | ✓ 6.9 s                                                                                                                                             |
| Turn 1 (one sentence)    | ✓ 6 of 9 essentials in 20 s with an exact receipt (firm, VC, USD 250k–1M, Seed + Series A, Fintech + Logistics, NG/KE/GH, avoid gambling + tobacco) |
| Turns 2–5                | ✓ deploying, discovery Balanced, inbound Qualified, "make it live": 11 responses; core.investor_mandates ACTIVE; recommendation slate CURRENT       |
| Reload / page load       | **Fail, 3 repros.** The asked step's chips (deployment, discovery, "Looks right") vanish; only "Skip", from session.current_step_key I0.website     |
| Discover                 | ✓ personalised card (Silo Credit) with "Why it's here" stage, location, sector; suitability 88                                                      |
| Turn 6 top-five question | ✓ Dawaledger, Watchly, Portside, Silo Credit, Umoja Cover; the tie at 8.8 explained; "not a judgement of quality"                                   |

Composer hints were right throughout ("Type your answer" / "Or say it in your own words"). Latency: 14–20 s per typed turn; 64 s from upload to read-back.
Fixes: branch fix/e2e-onboarding-defects (reload asked step, Keep all, leaving for now, duplicate Q recommendations); seed paying customers in its own PR (definition version + migration).
