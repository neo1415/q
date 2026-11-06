# Receipt — fallback policy after the Groq regression (`fix/q-fallback-policy`, `fix/q-fallback-policy-reland`)

- **Date:** 2026-11-06
- **Base:** `origin/fix/resume-asking-cv9ru3` @ `5a58671`, which includes the rollback `20261231310000`.
- **Status:** gates green locally. Not merged, not deployed, nothing applied to hosted. No live provider calls.

## The regression (13:00 UTC, production)

What happened, in order:

1. A typed turn's reading, a FAST_CLASSIFICATION request of about 17k tokens, timed out once on `gpt-5.6-luna`.
2. The gateway moved straight to the next model after a timeout whenever another model was waiting (CQ-VOICE-010). After `20261231290000`, that next model was Groq `gpt-oss-120b`.
3. Groq refused the request with 413 `rate_limit_exceeded`, because its account caps any single request at 8K tokens per minute. So did `gpt-oss-20b`.
4. The turn went unread, and the person saw "Sorry, I couldn't read that request just now".

Before the migration, the same timeout had no other configured model to move to, so luna was retried and answered.

That was my migration. The owner rolled it back with `20261231310000`.

## 1. A timed-out model is retried before any fallback (`fix/q-fallback-policy`, `b682a95`)

`model-gateway/src/gateway.ts`:

- **Retried on the same model first:** TIMEOUT, PROVIDER_OUTAGE, TRANSIENT and INVALID_MODEL_OUTPUT. Each model gets 2 attempts, as before.
- **When another model is asked:**
  - after the first model's retries fail;
  - at once for a spent account (PERMANENT with `accountExhausted`) or a refused key (AUTHENTICATION), which are not retryable.
- **Unchanged:** a RATE_LIMIT still moves on at once when another model waits, because a spent per-minute quota does not recover during a backoff. The size check below keeps that move from reaching a model that can't take the request.
- **Tests** (`model-gateway/test/gateway.test.ts`), replacing the CQ-VOICE-010 expectations:
  - luna times out once and then answers, and the fallback is never asked;
  - after two timeouts, the waiting model is asked;
  - a rate limit still moves on;
  - a shortened first attempt is followed by a full-budget retry on the same model.
- **Trade-off:** a voice turn whose primary hangs now waits for a second attempt before any fallback. That is the price of not handing a turn to a model that may not be able to take it.

## 2. Provider fit: a per-request token limit (`5299f02`, migration `20261231320000`)

- **New column `ai_ops.models.max_request_tokens`:** a nullable positive integer, additive. It is the most tokens one request may carry, counting input plus the output budget.
  - **Planning:** the gateway skips a model whose limit the request's estimate exceeds (`CONTEXT_WINDOW_TOO_SMALL`), before any call, whether that model would be the primary, a fallback or a hedge.
  - **Deploy order:** the catalog reads the column through `to_jsonb`, so the code may deploy before the migration.
- **Limits used: 8,000 tokens per request** for Groq `openai/gpt-oss-120b`, `openai/gpt-oss-20b` and `qwen/qwen3.8-27b`.
  - **Source:** Groq's documented limits at console.groq.com/docs/rate-limits, read on 2026-11-06. gpt-oss-120b and gpt-oss-20b are listed at 30 RPM, 1K RPD, **8K TPM** and 200K TPD. Qwen's 8K TPM was recorded in `20260918090000`.
  - **Consistent with production:** the live 413 on about 17k tokens.
  - **Assumption:** whether Groq counts `max_tokens` toward the request is undocumented, so the gateway counts the output budget (the conservative reading).
  - **If the account moves to a higher tier, raise the values.**
- **Unchanged:** routing, RLS and grants. `ai_ops.models` stays `INTERNAL_SERVER_ONLY`.
- **Rollback (no DROP):** `update ai_ops.models set max_request_tokens = null where max_request_tokens is not null;`
- **Tests:**
  - `model-gateway/test/request-limit.test.ts`: a 17k-token request is never sent to an 8K-limited fallback; a small request still falls back; the output budget counts. 2 of the 3 fail without the check.
  - pgTAP `rls/999_ai_ops_model_request_limits`: 5/5.

## 3. Integration tests consistent with v1 without Groq (`27ce670`)

- **`answer-seam` "answers a public run" and "offers the registry's tools":** back to Gemini flash-lite serving PUBLIC when luna is unregistered. Only the stale comments changed against their pre-Groq form.
- **`answer-seam` Claude v2 backup test:** the OpenAI → Claude half is unchanged. Its "Claude out too, Groq answers" half was false against the real limit: a full answer turn is far above 8K. It now asserts that the run fails retryably (`MODEL_PROVIDER_UNAVAILABLE`) and that Groq and Gemini are never asked. With the limit cleared, Groq answered (checked), so the size check is what excludes it.
- **`gateway-postgres`:** the v1 Groq test became "no second CONFIDENTIAL route on v1; Groq and Gemini never asked". The v2 (OpenAI → Claude → Groq) test is kept.

## 4. Re-land, only after 1–2 (`fix/q-fallback-policy-reland`, migration `20261231330000`)

- **What it does:** re-adds Groq `gpt-oss-120b` after luna on the seven v1 policies, plus `gpt-oss-20b` on the two fast classes.
- **Guard:** it refuses to apply unless `20261231320000` is in place.
- **Effect:** with the retry rule and the limit, Groq now serves only requests it can take (small classification or extraction) when OpenAI is spent or still failing after retries. Turn readings and full answers are never sent to it.
- **Rollback:** the one-statement update in the migration's header, the same as `20261231310000`.
- **Tests:**
  - pgTAP `rls/999_ai_ops_groq_fallback_reland`: 8/8, adding "every Groq model in an active policy carries its limit". `590` updated to 4/4.
  - Integration in `gateway-postgres`:
    - a ~17k-token CONFIDENTIAL reader request whose luna times out once is answered by luna on retry, and Groq is never asked;
    - when luna keeps timing out, the request fails with TIMEOUT. Groq's two models are planned out as `CONTEXT_WINDOW_TOO_SMALL`, and neither Groq nor Gemini is called;
    - a small CONFIDENTIAL request with OpenAI's credit spent is served by Groq.
- **My recommendation: apply 1–3 and `20261231320000` first.** Groq covers only small requests, so the re-land adds little resilience for real Q turns. Claude v2 is the backup that can take them; apply `20261231330000` only if small-request cover is still wanted.

## Gates (exact results)

| Gate                                                                                                                         | Result                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec turbo run build --filter=./packages/*`                                                                            | 54/54                                                                                                                                 |
| root `tsc` (`--max-old-space-size=7168`); `apps/q-api` and `apps/workers` `tsc`                                              | 0, 0, 0                                                                                                                               |
| eslint on changed `.ts`; prettier on changed files                                                                           | 0; clean                                                                                                                              |
| vitest `packages apps/q-api apps/workers apps/api` (items 1–3)                                                               | 1,432 files, 16,066 tests passed, 4 skipped                                                                                           |
| FULL `pnpm test:integration`, items 1–3 (local PG)                                                                           | 112 files passed, 1 skipped, 2 failed (739 tests passed, 23 failed, 12 skipped)                                                       |
| FULL `pnpm test:integration`, re-land, fresh DB                                                                              | 112 files passed, 1 skipped, 2 failed (739 tests passed, 23 failed, 12 skipped): the same two sandbox files as above                  |
| re-land run with `CQ_Q_IQ_ALL=1` (Q-IQ every case)                                                                           | Q-IQ 573 turns, 0 failing in every block. Two `discovery` count tests then failed on data left by that run; on a rebuilt DB both pass |
| pgTAP (local PG): reland 8/8, request limits 5/5, 590 4/4, anthropic 24/24, claude backup 8/8, 320 35/35, schema guard 12/12 | all ok                                                                                                                                |

The two failing integration files fail on limits of the sandbox's local Postgres, unrelated to this change. They fail identically on every run here, and CI runs them on the full Supabase stack:

- `eventing/outbox.integration` (21 tests): `relation "pgmq.q_domain-events" does not exist`. The local setup ships only a pgmq stub.
- `security/supabase-auth.integration` (2 tests): `local sign-up failed: fetch failed`. There is no local auth server.

## Apply order

1. CI on `fix/q-fallback-policy`.
2. Apply `20261231320000`. It adds the column only; code that does not yet read it ignores it.
3. Deploy, so the retry rule and the size check are live.
4. Optionally, `fix/q-fallback-policy-reland`: CI, then apply `20261231330000`.
