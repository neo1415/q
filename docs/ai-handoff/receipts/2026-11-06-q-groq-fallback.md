# Receipt — interim CONFIDENTIAL fallback to Groq (`feat/q-groq-fallback`)

- **Date:** 2026-11-06
- **Base:** `origin/fix/resume-asking-cv9ru3` @ `4211ca9` (includes the Claude lane's `20261231280000`, v2 policies RETIRED)
- **Asked by:** the integration owner, following `receipts/2026-11-06-q-reliability.md` §1 ("minimum until Claude parity").
- **Status:** gates green locally. Not applied to hosted, not merged, not deployed.

## Migration `20261231290000_ai_ops_groq_confidential_fallback.sql`

One additive `update` on the seven ACTIVE version-1 Q text policies.

- Groq `openai/gpt-oss-120b` (`a2…0004`) is placed directly after `gpt-5.6-luna`.
- `fast_classification` and `taxonomy_mapping` also get `openai/gpt-oss-20b` (`a2…0003`).
- Every other entry keeps its place, Gemini included.
- A guard block raises an error unless all seven policies carry `a2…0004`.
- **Not touched:** the v2 policies, `ui_translation.v1`, models, providers, prices, RLS policies and grants. Nothing is dropped and no table is added, so no schema-guard classification is needed.

| Policy                                                   | Order after the migration                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `normal_dialogue`, `structured_extraction`               | gpt-5.6-luna → gpt-oss-120b → gemini-3.5-flash-lite → gemini-3.5-flash               |
| `evidence_synthesis`, `comparison`, `deep_investigation` | gpt-5.6-luna → gpt-oss-120b → gemini-3.5-flash → gemini-3.5-flash-lite               |
| `taxonomy_mapping`                                       | gpt-5.6-luna → gpt-oss-120b → gpt-oss-20b → gemini-3.5-flash-lite → gemini-3.5-flash |
| `fast_classification`                                    | gemini-3.5-flash-lite → gpt-5.6-luna → gpt-oss-120b → gpt-oss-20b → gemini-3.5-flash |

**Eligibility basis:**

- Groq is `NO_TRAINING_ZERO_RETENTION` with `supports_zero_retention`, and its models have a CONFIDENTIAL ceiling. Both rest on the operator assertion recorded in `20260914090000`, which the owner has confirmed is the basis.
- `GROQ_API_KEY` and `GROQ_API_KEY_2` are set on q-api and workers (the owner checked the names on Railway).
- `gpt-oss-120b` is quality HIGH, which meets the synthesis classes' floor. Both Groq models support tools and structured output.

## Rollback (one statement)

```sql
update ai_ops.routing_policies
   set fallback_models = array_remove(array_remove(fallback_models,
         'a2000000-0000-4000-8000-000000000004'::uuid),
         'a2000000-0000-4000-8000-000000000003'::uuid)
 where status = 'ACTIVE' and version = 1
   and code in ('normal_dialogue.v1', 'evidence_synthesis.v1',
     'comparison.v1', 'deep_investigation.v1', 'fast_classification.v1',
     'structured_extraction.v1', 'taxonomy_mapping.v1');
```

I verified it on local PG inside a rolled-back transaction: it restores the exact previous lists (7 rows).

## Tests

- **New pgTAP `rls/999_ai_ops_groq_confidential_fallback.test.sql`: 7/7.**
  - Every active Q text policy has CONFIDENTIAL-eligible models on two providers, and at least two such models.
  - Every Gemini model is PUBLIC-only, and Google stays unreviewed with no owner-approved ceiling, so Gemini never serves CONFIDENTIAL.
  - Groq sits directly after luna on all seven; `gpt-oss-20b` is only on the two fast classes.
  - Still exactly 7 active Q policies; v2 is still staged.
  - **Failing-first:** with the rollback applied, tests 1, 2, 5 and 6 fail.
- **Updated pgTAP `rls/590_fast_classification_routing.test.sql`: 4/4.** The exact `fast_classification.v1` fallback list now includes Groq.
- **Neighbouring pgTAP:** `999_ai_ops_anthropic_claude_reasoning` 24/24; `999_ai_ops_routing_reasoning_levels`, `320_ai_ops` and `130_schema_guard` show no `not ok`.
- **New integration test in `model-gateway/test/gateway-postgres.integration.test.ts`:** a CONFIDENTIAL request falls back to Groq when OpenAI's credit is spent.
  - **Setup:** the real catalog from Postgres; fake providers under the real codes; OpenAI scripted to `credit_balance_exhausted`.
  - **Result:** for NORMAL_DIALOGUE, STRUCTURED_EXTRACTION, FAST_CLASSIFICATION and EVIDENCE_SYNTHESIS, `groq / openai/gpt-oss-120b` serves with `fallbackUsed`. OpenAI is asked once per request; Gemini is asked 0 times.
  - **Failing-first:** with the rollback applied, it fails with the 5 Nov error (`PERMANENT`, `accountExhausted`, no route).

## Gates (exact results)

| Gate                                                                                       | Result                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `pnpm exec turbo run build --filter=./packages/*`                                          | completed (rebuilt for the Anthropic adapter on the new base)            |
| root `tsc --noEmit -p tsconfig.json` (`--max-old-space-size=7168`)                         | exit 0                                                                   |
| eslint and prettier on the changed `.ts` file                                              | exit 0, clean                                                            |
| vitest `packages/model-gateway packages/q-evals`                                           | 192 files, 1,738 tests passed                                            |
| integration on local PG: `packages/q-evals packages/model-gateway packages/platform-admin` | 9 files, 43 tests passed (includes q-evals CI_CORE)                      |
| scripted Q-IQ `CQ_Q_IQ_ALL=1`                                                              | 4/4; 573 turns, 0 failing turns (the same as the reliability lane's run) |
| pgTAP (local PG, the files above)                                                          | all ok                                                                   |

**Not run here:** q-api and workers tsc and suites (no app code changed) and the full pgTAP suite. CI runs pgTAP.

## Apply order

1. Wait for the CI pgTAP run to pass.
2. Apply with `node scripts/handoff/hosted-migrate-https.mjs --apply 20261231290000`. It is data-only and needs no deploy.
3. On the next CONFIDENTIAL turn, a failed OpenAI attempt falls back to Groq.
4. When Claude's v2 policies are switched on, these v1 rows become inactive history. Nothing else needs undoing.
