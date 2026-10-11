# Performance baseline and measured first improvements

2026-10-11, source baseline `e40b1d0`; hosted baseline `b021d53b` freshly
verified through Railway. Measurements below are separate from historical
voice benchmarks in STATE. No production speedup is claimed before deployment.

| Path                              | Evidence                                                                               | Result / scope                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authenticated arrival snapshot    | Five sequential GETs to `/v1/q/arrival-snapshot`, Kathryn's existing account, cloud VM | 1,201, 388, 297, 304, 268 ms; all HTTP 200. Median 304 ms, maximum 1,201 ms. Includes network, authentication and body download. Five requests cannot establish a reliable p95.                        |
| Workforce claim scheduling before | New deferred-job regression executed against the original runner                       | Failed after its 1-second assertion window: second claimed job never started while first was held. Its lease was already running without its heartbeat.                                                |
| Workforce claim scheduling after  | Same regression against bounded concurrent runner; durable/job/authorization suites    | Second job starts and completes while first remains held; third stays queued; pass waits for both. 14 tests passed. Sequential steps and owner checks retained. No live queue benchmark yet.           |
| Presentation assembly             | Existing authorized relationship tool output projected into existing TIMELINE          | No added provider call or DB read. Strict output validation, one counterpart, at most 64 source milestones and 20 rendered events. This is a structural I/O observation, not a measured latency claim. |
| Chart correctness                 | New DOM regression run before and after                                                | Before: August value shown under July; after: category-aligned values, unknown cells and broken line across missing periods. Conflicting orders preserve original figures without a misleading plot.   |

Reproduce locally after package build:

```sh
pnpm exec vitest run --maxWorkers=2 apps/q-api/test/workforce-durable.test.ts apps/q-api/test/workforce-job.test.ts apps/q-api/test/workforce-ports-guard.test.ts
pnpm exec vitest run --maxWorkers=2 apps/web/test/chart-alignment.test.tsx packages/model-gateway/test/q-result-visuals.test.ts
```

Keep measuring the existing lanes separately: deterministic navigation,
prepared identity/mandate/research, company analysis, relationship actions,
document generation and GPT-Live first audio. Use correlation-bound model
usage and the existing round-trip counter. A health response, unit-test
duration or five arrival reads does not prove the requested end-to-end targets.

Remaining measured work: wider live p50/p95 samples, first-audio timing,
authenticated founder/investor journeys, provider-call counts and DB round trips.
The full local Supabase stack remains blocked by the 32 GB/vfs image expansion;
CI's existing pgTAP job is the database release gate.
