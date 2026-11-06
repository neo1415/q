# live19 — steps 9 (memory provenance + past-turn recall) and 10 (grounded workforce + adversarial) on production (`1ef895999`)

- **Migration:** `20261231271900` (GIN full-text index on `q_runtime.conversation_messages`) was applied to hosted at 03:43 UTC on 6 Nov. Hosted 274 = local 274, and the index is present.
- **CI:** 42157343033, all green, including the integration job.
- **Deploy:** 03:56 UTC. All four Railway services report SUCCESS.
- **Rollback:** `5ed2f21c8`. The index is additive; older code ignores it.

## Check (fictional investor, 1 Q turn)

**Asked:** "What did we talk about regarding Ledgerfold earlier?"

**Result: PASS.** Q recalled from the person's own past turns:

- the model: bookkeeping for Lagos market traders, then 14–60-day working-capital loans;
- 6,400 active traders and 2,150 borrowers;
- the loan book: USD 410,000 (March 2026) versus USD 150,000 (September 2025);
- PAR30 3.8% and monthly revenue of about USD 38,000;
- the diligence questions;
- the conditional-fit view.

All figures match the deck facts recorded in HANDOFF-2026-11-05 §10.5. Q also flagged that earlier chats used Ledgerfold and Ledgerline inconsistently, which is honest about the record.
