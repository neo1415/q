# Fix: compound pronoun follow-up missed a part's fact — 2026-11-06

Branch `fix/q-compound-retrieval` from `origin/fix/resume-asking-cv9ru3` @ `347b74a`. Built and checked locally only: no live calls, no deploy, no migration.

## Defect (production `347b74a8c`, fictional investor)

1. "What does Ledgerfold do?"
2. "How many borrowers does it have, and what's its loan book?"

Q answered the loan book but said "I don't have a borrower number". The company's published figures have 2,150 borrowers. A direct "How many borrowers does Ledgerfold have?" answered correctly.

## Root cause

The answer path reads a company's profile, published figures and deck before the model only when the company is **named in the turn's words** (`visibleNamedRead` → `readNamedVisibleCompany`, `packages/model-gateway/src/q/index.ts`). A company the step-3 reader bound a pronoun to ("it" = Ledgerfold) was never read.

So for a pronoun follow-up, the figures depended on which tools the model chose to call. Here it used what it already had for the loan book, ran a public search for the rest, and never read `read_company_figures`. The direct ask works because the name is in the words.

**It predates step 5.**

- `packages/model-gateway` is unchanged between `b2c08ab2a` and `347b74a`.
- On `b2c08ab2a`, no structured binding reached the gateway at all, only the `references` note text.
- Retrieval is not the cause. With "it" bound, step-5 retrieval brings both the borrowers chunk and the loan-book chunk into the final 8, even among 12 same-company noise chunks and another lender's borrower chunk. There is a new test for this in `q-evals/test/q-iq-retrieval.test.ts`.

## Fix

- **`boundCompaniesOf(request.retrievalFocus)`** (new file `packages/model-gateway/src/q/bound-companies.ts`): returns the company ids of the refs the reader bound this turn.
  - It uses only refs that step 3 checked against the shown ledger, never recency.
  - A bound FIGURE or DOCUMENT maps to its company.
  - At most 4.
- **`visibleNamedRead`** now also reads those companies by id with the new `readVisibleCompanyById`. This was split out of `readNamedVisibleCompany`, so it uses the same three reads (profile, figures, deck) through the same tool port, authorize step and plan. A refused read adds nothing, and the company on screen isn't read twice.
- **Remaining gap:** a pronoun the reader didn't bind still gets no pre-read. The model's own tools still apply in that case.

## Tests (failing first)

`packages/model-gateway/test/q-answer-bound-company-read.test.ts` runs the real gateway seam with a fake model.

| Test                                                                                                             | Before the fix | After |
| ---------------------------------------------------------------------------------------------------------------- | -------------- | ----- |
| Bound company: profile and figures are read, and both "2,150 active borrowers" and "USD 410,000" reach the model | **fail**       | pass  |
| A ledger-recalled company with no binding is not read                                                            | pass           | pass  |
| A bound company whose reads are refused: the read goes through the tool, and nothing reaches the model           | **fail**       | pass  |

## Gates

| Gate                                                                         | Result                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package build                                                                | 54/54                                                                                                                                                                                                                                       |
| Root tsc                                                                     | exit 0                                                                                                                                                                                                                                      |
| q-api tsc                                                                    | exit 0                                                                                                                                                                                                                                      |
| eslint (model-gateway, q-evals)                                              | 0 problems                                                                                                                                                                                                                                  |
| vitest: q-api, model-gateway, q-evals, q-knowledge, q-specialists, q-runtime | 635 files passed and 1 skipped; 6506 tests passed and 3 skipped                                                                                                                                                                             |
| Integration (local PG): model-gateway, q-evals, q-knowledge                  | 93/96. All 3 failures are **pre-existing on base `347b74a`**: the 2 `q-knowledge.integration` chunk-set tests (as in the step-5 receipt), and `gateway-postgres.integration` "ten models" (the seed now has 12, checked in a base worktree) |
| Scripted Q-IQ, all 150                                                       | 571/573. Same MEM-134 #0 and MEM-135 #0 as before                                                                                                                                                                                           |
| Prettier                                                                     | clean                                                                                                                                                                                                                                       |
