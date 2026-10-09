// Builds the measured part of the GPT-Live scorecard from the harness's
// per-scenario JSON files. Metrics only: whether Q sounds human is the
// founder's call, by ear; nothing here claims it.
//
//   node scripts/recovery/live/scorecard.mjs <recordings dir> > table.md
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] ?? ".");
const rows = readdirSync(dir)
  .filter((f) => /^\d\d-.*\.json$/.test(f))
  .sort()
  .map((f) => ({
    file: f,
    ...JSON.parse(readFileSync(resolve(dir, f), "utf8")),
  }));

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

console.log(
  "| # | Scenario | Line | Model (provider-reported) | Billed s | Cost | Latency ms (median, max) | Filler hits | Delegations (Q Brain) | Usage confirmed |",
);
console.log("| - | - | - | - | - | - | - | - | - | - |");
for (const r of rows) {
  const lat = r.latenciesMs.map((l) => l.ms);
  const dels = r.delegations ?? [];
  console.log(
    `| ${r.scenario} | ${r.name} | ${r.provider === "live" ? "A" : "B"} | ${r.reportedModel ?? "?"} | ${r.billedSeconds} | $${(r.costUsd + r.ttsCostUsd).toFixed(3)} | ${median(lat) ?? "–"}, ${lat.length ? Math.max(...lat) : "–"} | ${r.fillerHits.length} | ${dels.length === 0 ? "0" : `${dels.length} (${r.backend})`} | ${r.usageConfirmed === true ? "yes" : String(r.usageConfirmed)} |`,
  );
}
