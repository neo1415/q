# Receipt — Premium Plan P1 "Never down again" (`feat/q-reliability`)

- **Date:** 2026-11-06
- **Base:** `origin/fix/resume-asking-cv9ru3` @ `0cc7879`
- **Branch:** `feat/q-reliability`
- **Status:** gates green locally. Not merged, not in CI, not deployed. No live calls, no hosted DB, no migration.
- **Owner of next step:** the integration owner (merge, CI, deploy) and the `feat/q-claude-reasoning` lane (routing data).

## 1. Why the fallback did not fire on 5 Nov (read-only finding)

**Groq is in no active routing policy. It was not filtered out; it was never a candidate.**

1. `20261008130000_ai_ops_openai_primary.sql` **replaced** `preferred_models` and `fallback_models` on all seven ACTIVE text policies:
   - `normal_dialogue`, `fast_classification`, `structured_extraction` and `taxonomy_mapping`: preferred `gpt-5.6-luna` (OpenAI); fallbacks `gemini-3.5-flash-lite`, then `gemini-3.5-flash` (Google).
   - `evidence_synthesis`, `comparison` and `deep_investigation`: the same three models, with the two Gemini fallbacks in the other order.
   - `20261110000000` later moved `gemini-3.5-flash-lite` first for `fast_classification`.
   - The Groq model ids (`a2…0003` gpt-oss-20b, `a2…0004` gpt-oss-120b, `a2…0005` qwen3.8-27b) appear in no migration after `20260922090000`. `20261008110000` had already removed a Gemini model from dialogue; `20261008130000` overwrote what remained, so Groq left every policy.
2. `planRoute` considers only a policy's preferred and fallback models (`model-gateway/src/policy/eligibility.ts:245`). The CONFIDENTIAL ceiling on the Groq models (`20260914090000`) is therefore never read for any request.
3. The only fallbacks left are Google's:
   - Their ceiling is PUBLIC: the provider is UNREVIEWED and "NOT approved for confidential customer data" (`20260914090000`).
   - Gemini is off in production unless `CQ_GEMINI_ENABLED=1` (`apps/q-api/src/main.ts:1186`).
   - So a CONFIDENTIAL or INTERNAL Q turn had exactly one eligible model: `gpt-5.6-luna`.
4. With OpenAI exhausted, every model-needing turn planned `openai/gpt-5.6-luna: PROVIDER_TEMPORARILY_FAILING` plus Google `SENSITIVITY_EXCEEDS_CEILING` or `PROVIDER_UNCONFIGURED`. The result was `POLICY_INELIGIBLE` and the reply "I can't reach my reasoning service".

### Routing change needed (for the Claude lane and the owner; NOT made here)

The aim is two CONFIDENTIAL-eligible providers on every text policy. One additive migration, owned by `feat/q-claude-reasoning`:

| Policy                                                   | Preferred                                           | Fallbacks, in order                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `normal_dialogue`, `structured_extraction`               | Claude reasoning model (DECISIONS 62, after parity) | `gpt-5.6-luna`, then Groq `openai/gpt-oss-120b` (`a2…0004`), then the Gemini models (PUBLIC only)   |
| `evidence_synthesis`, `comparison`, `deep_investigation` | as above                                            | as above (gpt-oss-120b is quality HIGH)                                                             |
| `fast_classification`, `taxonomy_mapping`                | as today                                            | add Claude, then `gpt-5.6-luna`, then Groq `openai/gpt-oss-20b` (`a2…0003`), before or after Gemini |

- **Until Claude reaches parity:** the minimum fix is to append Groq `a2…0004` (and `a2…0003` for the fast classes) after `gpt-5.6-luna` on all seven policies. Both models support tools and structured output with a 131k context (`20260907090000`).
- **Owner checks before adding Groq:**
  - Groq's zero-retention terms were the operator's assertion, recorded on 2026-09-08 and not verified (`20260914090000`). The owner should confirm that they still stand.
  - Confirm that `GROQ_API_KEY` is set on q-api and workers. Without it Groq is `PROVIDER_UNCONFIGURED`.
- **Evidence:** the chaos test's second scenario (`model-gateway/test/chaos-provider-failures.test.ts`, "with a CONFIDENTIAL-eligible backup") shows that with such a backup every confidential turn is answered through all five failure classes.

## 2. Probe recovery: why a topped-up account still failed until a restart

**Cause (code):** one Q turn asks several models at once: the turn skim, the early reading, the reading and voice speculation. While OpenAI's account was blocked, only one of those calls could be the half-minute probe (`admit`).

1. The other calls were turned away at once, so the turn's reading failed and the person got the unreachable reply.
2. The probe's own request was then cancelled with the turn: K6 aborts the reading, speculation is cancelled, and a client disconnect aborts the run.
3. A cancelled attempt records `CANCELLED`, which said nothing to the health port, so no verdict ever arrived.
4. The probe slot stayed spent for 30 s, and every later turn repeated the same pattern.
5. The block lapsed only ten minutes after the last real refusal (`ACCOUNT_EXHAUSTED_OPEN_MS`). That matches "about 10 min after the key worked", and the restart cleared it sooner.
6. A second gap: a probe the account _answered_, but with an unusable reply (`INVALID_MODEL_OUTPUT`, 400, 429 rate limit), did not clear the block either.

**Fix (`4496c55`, `packages/model-gateway/src/policy/health.ts`, `gateway.ts`, `ports.ts`):**

- **In-flight probes are tracked.**
  - While a probe is in flight, a blocked model plans as usual.
  - Other calls wait up to 8 s (`probeWaitMs`, capped by their own attempt timeout) for its verdict and then ask `admit` again. A fixed account therefore serves every call of the turn that noticed the fix.
  - An exhausted account refuses in under a second, so waiting on a failing probe is short.
- **A probe that ends without a verdict is given back** (cancelled, the caller's own short timeout, or admitted but never sent). The next request probes at once.
- **Any answer from the account ends the block:** success, invalid output, a 400, a context limit or a non-quota 429.
- **Failing-first tests** (`model-gateway/test/probe-recovery.test.ts`): 3 of 5 fail on the old code and pass now. Two existing expectations in `blocked-provider-probe.test.ts` changed on purpose: concurrent turns are now served after the probe instead of being turned away.

## 3. Balance and spend alerts (DECISIONS 63)

- **Immediate alert:** the gateway gets an `onProviderBlocked` hook that fires where the ERROR line is logged today (credit or quota spent, or key refused).
  - q-api and workers send it as an operator alert: a structured `qAlert: "OPERATOR"` ERROR line, plus an email to every platform admin.
  - This is the existing operator path, used by the paused-account notice: `identity.platform_admins` and the app email sender, recorded in the Email panel.
  - Alerts are de-duplicated per provider for six hours. Sender failures never reach the request.
- **Runway alert:** workers check hourly (`apps/workers/src/reliability/provider-balance.ts`).
  - **Input:** each `CQ_PROVIDER_BALANCE_<CODE>=<usd>@<ISO time>` the owner sets.
  - **Spend:** recorded spend since that time and over the last 3 days, read from `ai_ops.model_usage` (priced from `ai_ops.model_prices` at call time).
  - **Alert:** when the balance would last fewer than 7 days (LOW), or when the ledger has spent it (EXHAUSTED).
  - **Unpriced calls:** counted and named in the alert, never treated as zero.
  - **No cap:** nothing is stopped.
- **Why the owner states the balance:** none of OpenAI, Anthropic, Groq or Google exposes a prepaid balance to an inference key. With no setting, no runway check runs; the immediate alert still does.
- **Code:**
  - `model-gateway/src/policy/balance-watch.ts`: pure arithmetic and wording.
  - `infrastructure/postgres-provider-spend.ts`: the spend reader.
  - `platform-admin/src/operator-alerts.ts`: alert delivery.
- **Tests:** deterministic `balance-watch.test.ts`, `operator-alerts.test.ts` and `workers/test/provider-balance.test.ts`. The integration test `provider-spend.integration.test.ts` runs on local PG.
- **No migration.** An in-app notice needs a new `communication.notifications.kind` value (for example `PROVIDER_ALERT`), which is an additive widening of `notifications_kind_check`. That is a follow-up for the owner to approve; the email and log line cover the alert until then.
- **Not built (P1 also lists these):**
  - Push delivery.
  - A pre-run guard for live evals (refuse to start below a stated balance).
  - A search provider resting more than 24 h raising the same alert.

## 4. Honest degradation

- **Checked:**
  - A recall of the person's own mandate is composed by code with no model call (`model-gateway/src/q/index.ts:7694`). It is answered during an outage, proven through the real runtime for all five failure classes (`q-evals/test/q-outage.integration.test.ts`).
  - Every other turn either stores an honest reply or ends its run `FAILED` with a retryable provider code. The app shows that as "Q isn't available right now. Please try again shortly" and "your conversation is kept".
  - The person's message is always kept.
- **Changed wording** (`q-specialists` `TURN_UNREACHABLE_REPLY`, `q-core` MODEL notice): the reply now says the fault is temporary and on Q's side. The only ETA Q knows is its own re-check interval, so it says "I check again about every 30 seconds". It never promises when a provider will be back.
- **Not claimed:** the reply does not say "I can still read your records", because founders have no mandate and the founder lookups were not verified without a model.
- **Eval-world fidelity fix:**
  - The Q-IQ world's health wrapper dropped `admit` and the exhausted flag, so a scripted credit failure never blocked anything there. It now forwards the whole port.
  - New options: `outage` (scripted failure per turn) and `investorOwnOrganisation` (send the investor's own organisation, as the app does).

## 5. Research rotation (DECISIONS 65)

- `CQ_RESEARCH_PROVIDERS_RETIRED` defaults to `serper,scrapingbee`. Those credentials are dropped at composition, so Brave and Tavily carry public research with no failed-first calls.
- Setting the variable to an empty value brings them back. The adapters are unchanged.
- An unknown code is ignored rather than failing the service's start.
- `.env.example` documents both new settings.

## 6. Chaos test

- **Gateway** (`model-gateway/test/chaos-provider-failures.test.ts`):
  - **Setup:** the CONFIDENTIAL provider fails with each class: credit or quota, auth, rate limit, timeout and 5xx. Each run is 24 turns over 2 minutes, with PUBLIC work alongside.
  - **Turns:** 100% are answered or degrade honestly, never with a raw error.
  - **Privacy:** 0 CONFIDENTIAL requests reach the PUBLIC-only provider, while PUBLIC work stays served.
  - **Recovery:** after healing, the same gateway serves confidential turns within 30 s, with no restart.
  - **With a CONFIDENTIAL backup:** 100% of turns are answered.
- **Runtime** (`q-evals/test/q-outage.integration.test.ts`): the same five classes through real Q turns on local PG (see §4).

## Gates (exact results, this container)

| Gate                                                                                            | Result                                                                                           |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm exec turbo run build --filter=./packages/*`                                               | 54/54 successful                                                                                 |
| root `node --max-old-space-size=7168 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | exit 0                                                                                           |
| `apps/q-api` tsc, `apps/workers` tsc (`NODE_OPTIONS=--max-old-space-size=6144`)                 | exit 0, exit 0                                                                                   |
| eslint on all 27 changed `.ts` files (`NODE_OPTIONS=--max-old-space-size=6144`)                 | exit 0                                                                                           |
| prettier `--check` on changed files                                                             | clean (`.env.example` has no parser)                                                             |
| vitest: model-gateway, platform-admin, config, q-core, q-specialists, q-evals                   | 441 files passed, 1 skipped; 4,275 tests passed, 1 skipped                                       |
| vitest: apps/workers, apps/q-api                                                                | 384 files passed, 1 skipped; 3,410 tests passed, 3 skipped                                       |
| integration (local PG `scripts/local-pg/setup.sh`): model-gateway, platform-admin, q-evals      | 11 files, 47 tests pass (see note)                                                               |
| scripted Q-IQ `CQ_Q_IQ_ALL=1`                                                                   | 4/4 pass; 573 turns, 0 failing turns; identical summary to the base `0cc7879` run on the same DB |

**Note on QEXPL-008:**

- With `CAPITAL_Q_ENV=local` exported, `q-evals.integration` CI_CORE fails on QEXPL-008 ("attested synthetic demo traffic never reached the free tier"): `gpt-5.6-luna` is every policy's primary and is healthy, so Gemini is never tried.
- Without that variable the attestation does not hold, QEXPL-008 is BLOCKED and the test passes. The earlier full run above used it unset.
- The failure follows from the routing migrations, not from this branch: no routing or eligibility code changed here.
- Worth a look by whoever owns QEXPL-008 when routing changes.

## Files

- **model-gateway:** `src/policy/health.ts`, `src/gateway.ts`, `src/ports.ts`, `src/index.ts`, `src/policy/balance-watch.ts` (new), `src/infrastructure/postgres-provider-spend.ts` (new).
  - Tests: `probe-recovery`, `chaos-provider-failures`, `balance-watch`, `provider-spend.integration` (new); `blocked-provider-probe` (updated).
- **platform-admin:** `src/operator-alerts.ts` (new), `src/index.ts`, `test/operator-alerts.test.ts`.
- **workers:** `src/reliability/provider-balance.ts` (new), `src/main.ts`, `src/model-gateway.ts`, `test/provider-balance.test.ts`.
- **q-api:** `src/main.ts` (operator alert wiring).
- **config:** `src/research-providers.ts`, `test/research-providers.test.ts`, `.env.example`.
- **q-core:** `src/conversation/failures.ts`.
- **q-specialists:** `src/answer.ts` (`TURN_UNREACHABLE_REPLY`), `test/answer-turn-reading.test.ts`.
- **q-evals:** `src/fixtures/world.ts`, `src/runner/q-iq-world.ts`, `test/q-outage.integration.test.ts` (new).

## For the integration owner after deploy

1. Set `CQ_PROVIDER_BALANCE_OPENAI` (and `_ANTHROPIC` once Claude is live) on workers, in the form `<usd>@<ISO time>`, from the provider consoles. Update it on each top-up.
2. Expect `serper` and `scrapingBee` to read `unconfigured` in the research status. That is the retirement working.
3. Watch for `qAlert":"OPERATOR"` lines. The first credit failure emails platform admins once per six hours per provider.
4. Apply the routing change in §1 through the Claude lane's migration. Until then, an OpenAI outage still takes confidential reasoning down. The difference now is that it is noticed, alerted and recovered within about 30 s of the fix, with no restart.
