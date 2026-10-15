#!/usr/bin/env node
/**
 * Recovery G: latency from the logs the services already write. No
 * invented numbers: every figure is a nearest-rank percentile of observed
 * samples, printed with its n; fewer than 5 samples prints "insufficient".
 *
 *   node scripts/recovery/perf-report.mjs <log.ndjson>... [--json]
 *   cat q-api.log | node scripts/recovery/perf-report.mjs -
 *
 * Lines read (pino NDJSON, `msg`):
 *   "voice turn timed"         apps/q-api/src/voice/turn-timing.ts:168-194
 *   "q answer produced"        packages/model-gateway/src/q/index.ts:4195-4219
 *   "duplex voice line ended"  apps/q-api/src/voice/duplex/broker.ts:1141-1158
 * The report says MOCK or LIVE (from the stack's mode file): a MOCK run
 * times our own code with a loopback fake vendor, never a vendor.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUN =
  process.env.CQ_RECOVERY_RUN_DIR ??
  resolve(import.meta.dirname, "../../.playwright/recovery-stack");
const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const asJson = process.argv.includes("--json");
const modeFile = resolve(RUN, "mode");
const mode = existsSync(modeFile)
  ? readFileSync(modeFile, "utf8").trim().toUpperCase()
  : "UNKNOWN";

const FIELDS = {
  "voice turn timed": [
    "reasoningStartMs",
    "firstTextMs",
    "ttsRequestMs",
    "firstAudioMs",
    "endMs",
    "modelMs",
  ],
  "q answer produced": ["latencyMs", "firstPublishedMs", "totalMs"],
  "duplex voice line ended": [
    "seconds",
    "rejoins",
    "line.firstAudioP50Ms",
    "line.firstAudioMaxMs",
  ],
};

function get(object, path) {
  return path
    .split(".")
    .reduce(
      (value, key) =>
        value === null || value === undefined ? undefined : value[key],
      object,
    );
}

function percentile(sorted, p) {
  // Nearest rank: the smallest value with at least p% of samples at or below it.
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const text =
  files.length === 0 || files[0] === "-"
    ? readFileSync(0, "utf8")
    : files.map((file) => readFileSync(file, "utf8")).join("\n");
const samples = {};
const outcomes = {};
for (const line of text.split("\n")) {
  if (!line.startsWith("{")) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  const fields = FIELDS[entry.msg];
  if (fields === undefined) continue;
  if (entry.msg === "voice turn timed") {
    outcomes[entry.outcome ?? "?"] = (outcomes[entry.outcome ?? "?"] ?? 0) + 1;
  }
  for (const field of fields) {
    const value = get(entry, field);
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    (samples[`${entry.msg} :: ${field}`] ??= []).push(value);
  }
}

const rows = Object.entries(samples).map(([key, values]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length < 5
    ? {
        metric: key,
        n: sorted.length,
        p50: null,
        p95: null,
        max: null,
        note: "insufficient",
      }
    : {
        metric: key,
        n: sorted.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        max: sorted.at(-1),
        note: "",
      };
});

if (asJson) {
  console.log(
    JSON.stringify({ mode, rows, voiceTurnOutcomes: outcomes }, null, 2),
  );
} else {
  console.log(
    `Latency from logs (${mode}${mode === "MOCK" ? ": loopback fake vendor, measures our code only" : ""})`,
  );
  if (rows.length === 0)
    console.log(
      "no timing lines found: nothing to report (no numbers invented)",
    );
  console.log("| metric | n | p50 | p95 | max |");
  console.log("|---|---|---|---|---|");
  for (const row of rows) {
    console.log(
      `| ${row.metric} | ${String(row.n)} | ${row.p50 ?? row.note} | ${row.p95 ?? row.note} | ${row.max ?? row.note} |`,
    );
  }
  if (Object.keys(outcomes).length > 0) {
    console.log(
      `voice turn outcomes: ${Object.entries(outcomes)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(", ")}`,
    );
  }
}
