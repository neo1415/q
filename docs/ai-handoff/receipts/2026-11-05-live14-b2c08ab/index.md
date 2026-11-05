# live14: Q Intelligence steps 2+3 on production (`b2c08ab2a`)

- **Deploy:** 23:07 UTC 5 Nov, by fast-forwarding `recovery/2026-09-12` (`789a1ecbd` → `b2c08ab2a`). CI 42125008157 is fully green. All four Railway services are SUCCESS on `b2c08ab2a`.
- **Migration:** `20261231250000` was applied beforehand, at 22:35 UTC.
- **Rollback:** `789a1ecbd`.

## The OpenAI credit incident (22:50–23:10 UTC)

- **Cause:** the q-api `OPENAI_API_KEY` answered 429 `credit_balance_exhausted`. A live Q-IQ run spent the last of the balance.
- **Effect:** production Q replied "I can't reach my reasoning service right now".
- **Fix:** the owner added credit; the key was the same one, unchanged. The key answered from about 23:02 UTC. q-api kept its "account exhausted" block until this deploy restarted it.

## Check at 23:12 UTC

Signed in as the fictional investor `investor.savanna-seed@fictional.capitalq.local`, with 2 Q turns.

| Ask                                  | Reply                                                                                                                          | Verdict                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| "How big is Ledgerfold's loan book?" | "USD 410,000 in March 2026, self-reported by the company. It was reported as up from USD 150,000 in September 2025." + Sources | PASS: Q is back; the figure matches the live12 probe |
| "And what's its PAR30?"              | "Ledgerfold reported 30-day portfolio-at-risk (PAR30) of 3.8%." + Sources                                                      | PASS: "its" was bound to Ledgerfold; 3.8% is correct |

Screenshot: `two-turns-1440.png`.
