# Live verification 7: 449301dbe (5 Nov 2026)

These checks used the fictional investor `investor.savanna-seed@fictional.capitalq.local` at 1440 and 390 px, with 5 Q turns. Two plans were run with "okay"; no step card was approved and nothing was sent. Full detail is in `results.json`.

Deploy: the integration owner pushed `7b9a267ce` → `449301dbe`. Web, api, q-api and workers were all SUCCESS at 01:09:08Z.

| Check                                                              | Result | Observed                                                                                                                                                              |
| ------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Plan request gives a plan card with Execute, not a research job | PASS   | Both widths. At 390 the page opened in the Chat view, the account's remembered view                                                                                   |
| 2. "okay" gives "Running it now…", steps start, card stays         | FAIL   | 390 PASS. At 1440 the running card was "Put … away as we moved on" and moved under "Earlier in this conversation"                                                     |
| 3. /work Moving shows the running plan                             | FAIL   | The 390 plan shows with its steps. The 1440 plan appears twice as "Your plan: Make me a plan to check Ledgerline's unit economics this week · Working", with no steps |
| 4. Only one Now chip while drafting                                | PASS   | No separate "Now" chip at either width                                                                                                                                |
| 5. "How far with the task I gave you?"                             | PASS   | "The plan has 6 steps; 1 of 6 is complete, and the Ledgerline unit-economics assessment is ready."                                                                    |
