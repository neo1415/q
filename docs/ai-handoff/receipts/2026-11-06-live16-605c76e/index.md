# live16: step 4 (one reader) and the compound-follow-up fix on production (`605c76e59`)

- **Deploy:** 01:14 UTC 6 Nov, by fast-forwarding `recovery/2026-09-12` (`347b74a8c` → `605c76e59`).
- **CI:** run 42138230329 is green. Its pgTAP job was re-run once after a Docker Hub "toomanyrequests" rate-limit failure, so that was infrastructure, not code.
- **Railway:** all four services SUCCESS.
- **Rollback:** `347b74a8c`.

Check, signed in as the fictional investor `investor.savanna-seed@fictional.capitalq.local`:

| Ask                                                                                          | Reply                                                                                                                                                                                                      | Verdict                                               |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| "What does Ledgerfold do?" then "How many borrowers does it have, and what's its loan book?" | "Ledgerfold reports 2,150 borrowers. Its reported outstanding loan book was USD 410,000 in March 2026, up from USD 150,000 in September 2025. Both figures are company-reported and unverified." + Sources | PASS: both parts answered; the live15 defect is fixed |
