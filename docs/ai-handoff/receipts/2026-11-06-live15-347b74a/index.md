# live15: Q Intelligence step 5 on production (`347b74a8c`)

- **Deploy:** 23:58 UTC 5 Nov, by fast-forwarding `recovery/2026-09-12` (`b2c08ab2a` → `347b74a8c`).
- **CI:** 42130822191, all jobs green.
- **Railway:** all four services SUCCESS.
- **Rollback:** `b2c08ab2a`.

Checked 00:05 UTC 6 Nov as the fictional investor `investor.savanna-seed@fictional.capitalq.local`.

| Ask                                                                                          | Reply                                                                                                                                             | Verdict                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| "What does Ledgerfold do?" then "How many borrowers does it have, and what's its loan book?" | "It" was bound to Ledgerfold. Loan book USD 410,000 (up from 150,000) and PAR30 3.8%, marked self-reported. Then "I don't have a borrower number" | **PARTIAL** (see below) |
| "How many borrowers does Ledgerfold have?"                                                   | "Ledgerfold reports 2,150 borrowers… self-reported"                                                                                               | PASS                    |

- **The defect:** in a compound pronoun follow-up, the borrower count (2,150, from the company profile's traction snapshot) does not reach the answer, although a direct ask finds it.
- **Why no rollback:** nothing was invented, and the unknown was stated honestly, not as zero.
- **Next:** sent to the step 5 lane (`session_01Wncmn7LogXnzLfccC3CVMw`) for a root cause and fix on `fix/q-compound-retrieval`. It will also check whether the defect predates step 5.
