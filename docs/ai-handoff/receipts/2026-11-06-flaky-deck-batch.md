# Receipt — flaky deck batch reads test (2026-11-06)

Branch `fix/flaky-deck-batch-reads` from `origin/fix/resume-asking-cv9ru3` (d8445aa). Test-only change; no product code, migration, deploy or live call.

## Symptom

`packages/evidence/test/deck-batch-reads.integration.test.ts` › "reads the decks and their readings of many companies in one round trip each, as one by one" failed intermittently (CI run 42177592489: `expected '0ec918a4-…' to be '5a5b8932-…'`) at `expect(decks.get(a.companyId)?.versionId).toBe(newer.versionId)`.

## Root cause (fixture, not product)

The fixture created each deck with an INSERT and then `update evidence.documents set current_version_id = …, updated_at = …`. That UPDATE fires the `set_updated_at` trigger (`private.set_updated_at()`, unconditional `new.updated_at := now()`), so both of company A's decks got `updated_at = now()`: the same instant, because the whole test runs in one transaction. "The newest deck" then fell to the query's `d.id` tiebreak, and the ids are random UUIDs, so the expected "newer" deck won about half the time.

Product code is deterministic and the batch and one-by-one reads cannot disagree:

- `currentDeck` and `currentDecks` both order by `d.updated_at desc, d.id` with `limit 1`. The id is a total tiebreak.
- `extractionFor` and `extractionsFor` order by `prompt_version desc, reading_number desc, created_at desc`. `(document_version_id, prompt_version, reading_number)` is unique (`deck_extractions_version_reading_key`), so the order is total.

The test's equivalence assertions (batch == one by one) always passed. Only the "newer deck wins" assertion was flaky, because the fixture never actually produced a newer deck.

## Fix

The fixture sets `current_version_id` in the INSERT. `documents_current_version_fkey` is `deferrable initially deferred`, so the version row can follow. With no UPDATE, the trigger never fires and the intended `updated_at` sticks. A guard assertion checks that the stored `updated_at` equals the intended timestamp, so the fixture cannot silently collapse again. No assertion was weakened.

## Evidence (local PostgreSQL via `scripts/local-pg/setup.sh`, `DATABASE_URL` = `CQ_TEST_DATABASE_URL` = local)

| Run                                                                                      | Result                                                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Base, file ×30 (`vitest run --config vitest.integration.config.ts <file>`)               | 20 pass / 10 fail, same `AssertionError … Object.is equality` |
| Trigger check (temp table + `private.set_updated_at`, UPDATE with an explicit timestamp) | `updated_at = now()` → `t`: the explicit value was discarded  |
| Fixed, file ×30                                                                          | 30 pass / 0 fail                                              |
| `vitest run packages/evidence` (unit config)                                             | 19 files, 182 tests passed                                    |
| `pnpm exec turbo run build --filter=./packages/*`                                        | 54/54 successful                                              |
| Root `tsc --noEmit -p tsconfig.json`                                                     | exit 0                                                        |
| eslint and prettier on the touched file                                                  | exit 0, clean                                                 |
