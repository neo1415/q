# live21: the over-asking fix and the Q home tidy on production (`d8445aad4`)

- **Code:** identical to `8dec401e0`. Commit `d8445aad4` only merges the production rollback commit `917ddb4c3`, so the deploy branch fast-forwards.
- **CI 42177592489:** build, typecheck, test, pgTAP, format, lint and quality are green.
- **Integration job:** failed on one test, `packages/evidence/test/deck-batch-reads.integration.test.ts`. That is an order-dependent flake in untouched code, also seen by the reader-latency lane, and it has its own fix lane. The job's Docker pulls were also rate-limited.
- **Deploy:** 07:38 UTC on 6 Nov. All four Railway services SUCCESS.
- **Rollback:** `917ddb4c3`.

## Check

Signed in as the fictional investor, with 2 turns.

1. "Who are Ledgerfold's founders?" → Adaeze Nwachukwu (CEO) and Obinna Eze (CTO).
2. "What did the first one do before?" → "Adaeze previously led SME lending operations at a fictional Lagos microfinance bank for five years…", with 2 sources.

**PASS.** Before the fix, turn 2 got "I'm not sure who or what you mean by 'the first one'".

The UI tidy is visible: no always-on "Hide from Q" and no floating "Clear".

One small wording point: the reply opens with "In Capital Q,". It is noted for the live-gaps lane.
