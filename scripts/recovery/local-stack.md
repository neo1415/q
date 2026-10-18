# Recovery local stack (workstream G)

The whole of Capital Q on one machine, with **no live provider calls**. It is what the recovery browser suite (`tests/recovery/`) runs against. Every result it produces is **MOCK**. Live voice is **LIVE-PENDING**: the founder runs it later on his own machine (`scripts/recovery/voice/LIVE-PROCEDURE.md`). The build budget for live AI calls is $0.

## Start, seed, run, stop

```bash
scripts/recovery/local-stack.sh start            # db fake api q-api workers web, one at a time
scripts/recovery/local-stack.sh seed             # the fictional world (12 companies, 8 investors)
npx playwright test -c tests/recovery/playwright.recovery.config.ts --project permissions
node scripts/recovery/results-table.mjs          # MOCK verdicts: GREEN / EXPECTED RED / UNEXPECTED RED
scripts/recovery/local-stack.sh stop             # stops only what it started; the database stays up
scripts/recovery/local-stack.sh status           # mode, services, egress refusals
```

You can start a subset: `start fake api q-api`. Start the web app (`next dev`, port 3200) only when a browser test needs it. It is the heaviest process on 4 shared CPUs.

## What each part is

| Service             | How it runs                                                                                                                                    | Port          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| db                  | Local Supabase in docker. `dockerd` is started if a VM restart stopped it, and storage and realtime are started if they were left stopped      | 54321 / 54322 |
| fake                | `fake-vendors.mjs`: a loopback stand-in for the OpenAI Responses and embeddings APIs (and for the voice credential endpoints, once G-R2 lands) | 3990          |
| api, q-api, workers | `node --import scripts/dev-env.mjs src/main.ts`, from source against the built packages                                                        | 3201, 3202, – |
| web                 | `next dev`                                                                                                                                     | 3200          |

## Why no call can leave the machine

1. **Clean environment.** Each service starts from an empty environment plus `stack.env`, which holds only loopback values from `supabase status`. A cloud shell carries real credentials: on 2026-10-08, q-api inherited `SMTP_API_KEY` and tried to email through `api.brevo.com`.
2. **Disabled keys.** Every provider key is `disabled-locally-000000000000`, so no `.env.local` fallback can supply a real one.
3. **Egress guard.** `egress-guard.mjs` is preloaded into every Node service. It refuses any TCP connection that is not to loopback before a byte is sent, and logs `"recovery egress refused"` with the host. `local-stack.sh status` counts the refusals.
4. **Fake vendor.** `OPENAI_BASE_URL` points the real OpenAI adapter (openai-node reads it) at `fake-vendors.mjs`. The gateway, routing, structured-output checks and the Q answer path all run unchanged.

## Scripting Q

Tests decide what the "model" says. The product is then checked for carrying it out. Rules are first-match, and are PUT by `tests/recovery/support/script.ts` in front of the baseline in `tests/recovery/fixtures/q-script.json`:

- `when.task` matches a prompt template (`TURN_READER`, `COMPANY_ANALYST`, `MEMORY_EXTRACTOR`, …).
- `when.user` is a regex over the user message, which carries the person's words.
- `when.tool` requires a tool to be offered. `when.afterTool` matches the round after a tool answered; `null` means the first round.
- `reply` is `{json}` / `{text}` / `{toolCalls}` / `{status}` / `{hang}`, each with an optional `delayMs`.

A request no rule matches gets a recognisable "[scripted vendor] No rule matched" answer. Every request, with everything the model would read (tool results included), is logged to `.playwright/recovery-stack/fake-vendors.ndjson` and served at `GET /__fake/requests`. That is how the Context Firewall tests check that founder-private words never reach an investor's turn.

## Measuring

- `node scripts/recovery/perf-report.mjs .playwright/recovery-stack/q-api.log`: p50/p95 with n, from the services' own timing lines. MOCK timings measure our code only.
- `node scripts/recovery/live-cost.mjs estimate | actual --since <ISO>`
- `node scripts/recovery/release-evidence.mjs [--only …]`: the gates, written to `docs/recovery/evidence/<date>/`.
