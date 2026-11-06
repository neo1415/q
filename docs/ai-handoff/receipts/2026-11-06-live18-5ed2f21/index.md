# live18: step 11 (speed pass + CI integration job) on production (`5ed2f21c8`)

- **Deploy:** 03:19 UTC 6 Nov, by fast-forwarding `recovery/2026-09-12` (`f08525117` → `5ed2f21c8`).
- **CI:** 42153085615 is all green, including the first run of the new `integration (local database)` job.
- **Railway:** all four services SUCCESS.
- **Rollback:** `f08525117`.

## Check

Signed in as the fictional investor, with 2 Q turns.

- Turn 1, "How big is Ledgerfold's loan book?": USD 410,000.
- Turn 2, "And what's its PAR30?": "Ledgerfold reports a PAR30 of 3.8%… company-reported and unverified", with 4 sources.
- Verdict: **PASS**.

## First production latency numbers (q-api logs, step 11 fields)

| Turn                                | readMs (turn reader) | stateMs / cached | reasoning            | firstSentenceSinceMessageMs | totalSinceRunMs |
| ----------------------------------- | -------------------- | ---------------- | -------------------- | --------------------------- | --------------- |
| Loan book (PUBLIC_FACTS)            | 4,894                | 78 / no          | NONE (ANSWER_LOOKUP) | **6,205**                   | 12,725          |
| PAR30 follow-up (THEIR_OWN_RECORDS) | 3,881                | 1 / **yes**      | NONE (ANSWER_LOOKUP) | **4,417**                   | 11,317          |

What the numbers show:

- The step 11 state cache works: 1 ms on the follow-up.
- Step 7 works: lookups ran at reasoning NONE.
- The bar (first sentence p50 ≤ 2.5 s) is **not met**.
- The turn reader (4–5 s, on the critical path before the answer) is the dominant cost, so that is the next speed target.
