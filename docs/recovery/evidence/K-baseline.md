# K baseline (Part 10): production, before B/D/C/V/F

Label: **LIVE (production, read-only metadata aggregates)**. No provider calls were made. No row contents were copied.

- Script: `SUPABASE_ACCESS_TOKEN=… node scripts/recovery/perf/k-baseline.mjs --source hosted --days 4 --out docs/recovery/evidence/K-baseline.generated.md`
- Run on 2026-10-09 at 16:41Z over the window 2026-10-05 to 2026-10-09: 245 runs.
- The full table is in [K-baseline.generated.md](K-baseline.generated.md). After the fixes land, rerun the same command (or `--source local`) to compare.

## Headline (p50 / p95, ms, nearest rank)

| journey                                  | runs | speech heard → run accepted | context assembly | model calls / turn | first card    | terminal answer |
| ---------------------------------------- | ---- | --------------------------- | ---------------- | ------------------ | ------------- | --------------- |
| typed question, model-answered           | 137  | n/a                         | 699 / 1450       | 2 / 5              | 11500 / 49385 | 13588 / 62499   |
| voice question, model-answered           | 54   | 32 / 93                     | 548 / 1066       | 1 / 4              | n=4           | 3923 / 1149327  |
| prepared action (code-built, approval)   | 50   | n/a                         | n/a              | 0 / 0              | n/a           | approval wait\* |
| typed question, code-answered (fit etc.) | 4    | n/a                         | n=2              | n=4                | n/a           | n=4             |

\* The terminal time for PREPARE_ACTION is time to approve, expire or cancel (about 24 h). It is not answer latency, so exclude it.

## What the numbers say

- **A typed answer takes 13.6 s at the median and 62 s at p95, and cards take 11.5 s / 49 s.** Every typed question goes through the model, at 2 calls per turn (p95 5). Only 4 of 245 runs were answered by code in the window. This is the Part 1/8 target, since "three fintech companies" should be a code-built DISCOVER fast path with 0 model calls.
- **Voice median 3.9 s, but p95 is 19 min.** The cause of this tail is not established from metadata. Some runs reach a terminal event long after they start, which matches the lost or late-turn class of defect (G-D3/G-D21) rather than model latency. V should confirm this.
- **Context assembly is not the bottleneck** (0.55–0.7 s p50, 1.1–1.45 s p95). Model time dominates.
- **Speech heard → run accepted is 32 / 93 ms.** It is measured from the server's voice_line_turns row to runs.created_at. It **excludes** the end of speech → transcript time at the vendor, which is not stored. That needs the browser or vendor timestamps from V's telemetry (Part 6).

## Gaps (stated, not estimated)

- **DB query count per turn:** not logged anywhere in apps/ (no query counter exists). It cannot be baselined until B/D add a per-run counter to "q answer produced".
- **Railway log metrics:** `railway logs` failed here with an invalid RAILWAY_TOKEN. Lead: please run `railway logs <deploymentId> --service @capital-q/q-api --since 2026-10-05 --until 2026-10-09 -n 5000 > logs.ndjson`. Then run `node scripts/recovery/perf-report.mjs logs.ndjson` to get the "voice turn timed" and "q answer produced" p50/p95.
- **Time to first card** has only n=15 typed runs, because most answers carried no ANSWER_CARDS block.
- **Statuses:** COMPLETED 189, EXPIRED 29, CANCELLED 14, AWAITING_APPROVAL 9, FAILED 4.
