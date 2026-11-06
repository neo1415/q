# live17: steps 7 (adaptive reasoning) and 8 (agentic loop, promise check) on production (`f08525117`)

- **Migration:** `20261231260000` was applied to hosted at 01:35 UTC 6 Nov. Hosted 273 = local 273. The three ACTIVE policies carry `reasoning_levels`: CHAT/LOOKUP NONE, FOLLOW_UP LOW, COMPARISON/ANALYSIS/DOCUMENT MEDIUM.
- **CI:** 42142537720 is all green.
- **Deploy:** 01:47 UTC. All four Railway services SUCCESS.
- **Rollback:** `605c76e59`. The migration is additive: older code ignores the new column.

## Check

Signed in as the fictional investor `investor.savanna-seed@fictional.capitalq.local`, with one Q turn (ANALYSIS).

Asked: "Is Ledgerfold a good fit for my mandate, and what are the two biggest risks?"

Result: **PASS**.

- Both parts are answered: fit, then two numbered risks (credit underwriting, funding and scaling).
- Only grounded figures are used: PAR30 3.8% and the mandate's USD 250,000–1 million.
- Unknowns stay unknown: funding structure, cost of capital and runway are "not stated".
- It gives a conditional view and says what would change it.
- There's a PDF and Sources.

Not measured: the reasoning level per turn in logs, and follow-up p50. Live Q-IQ measures both, and runs only with the owner's OK.
