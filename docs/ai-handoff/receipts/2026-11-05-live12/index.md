# Live check: `fdcf86871` (situation header + claim check) — 2026-11-05

**Build:** Railway q-api and web reached SUCCESS on `fdcf86871` at 13:07Z (deployment created 12:52:33Z). Rollback: q-api `fad7f0288`, web `3f813b9b9`.

**Method:**

- Account `investor.savanna-seed@fictional.capitalq.local` (fictional).
- 4 Q turns in one new Chat conversation at 1440.
- Full answers are in `turns.json`.

**Reference:** Ledgerfold's own records in the app, read first on `/company/…?tab=overview` and `tab=deck`:

- monthly revenue "About USD 38,000";
- raising USD 2.5M;
- deck figures 6,400 and 2,150;
- "The deck does not state milestones, runway or committed investors."

| #   | Check                            | Q's answer (quoted)                                                                                                                                                                                                                                                                                                                    | Result                                                                       |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| a   | Date and tomorrow                | "Today is Thursday, 5 November 2026. Tomorrow is Friday, 6 November 2026."                                                                                                                                                                                                                                                             | **PASS**                                                                     |
| b   | A figure the deck states         | "Ledgerfold's pitch deck states monthly revenue of approximately USD 38,000. It is a self-reported company figure, not independently verified."                                                                                                                                                                                        | **PASS**: the real figure is kept and labelled as a company claim            |
| c   | A figure the deck does not state | "The deck does not state Ledgerfold's runway in months. I have no runway figure on record."                                                                                                                                                                                                                                            | **PASS**: honest, no zero                                                    |
| d   | "Tell me about Ledgerfold."      | "…reports 6,400 active bookkeeping users, 2,150 borrowers, a USD 410,000 outstanding loan book in March 2026—up from USD 150,000 in September 2025—30-day portfolio-at-risk of 3.8%, and monthly revenue of around USD 38,000. These figures are self-reported. The team is Adaeze Nwachukwu … and Obinna Eze … Runway is not stated…" | **PASS**: figures and names intact, nothing truncated, unknowns stay unknown |

**Response times:** (a) 11 s, (b) 16 s, (c) 10 s, (d) 29 s.

**Screenshots:** `turn-{a,b,c,d}-1440.png`.
