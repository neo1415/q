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
