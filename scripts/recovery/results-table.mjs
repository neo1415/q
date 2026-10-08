#!/usr/bin/env node
/* global process, console */
/**
 * Recovery G: turns the recovery suite's Playwright JSON report into tables
 * a person can read, honestly classified.
 *
 *   node scripts/recovery/results-table.mjs [report.json] [--out dir]
 *
 * Every row is labelled MOCK (or LIVE, only from the founder's own run;
 * live tests in a MOCK run are LIVE-PENDING). Verdicts:
 *   GREEN                  passed
 *   GREEN, WAS EXPECTED RED  passed while annotated: remove the annotation
 *   EXPECTED RED (rows)    failed, and the annotation names the work it awaits
 *   UNEXPECTED RED         failed with no such annotation: a defect or a test bug
 *   LIVE-PENDING           a live test in a MOCK run
 *   NOT RUN                skipped, interrupted or never reached
 * Writes results.md and promises.md (promise x step) when --out is given.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt === -1 ? null : resolve(args[outAt + 1]);
const reportPath = resolve(
  args.find((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--out") ??
    resolve(import.meta.dirname, "../../.playwright/recovery/report.json"),
);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const mode = report.config?.metadata?.mode ?? "MOCK";

const rows = [];
function walk(suite, file) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const result = t.results?.at(-1);
      const status = result?.status ?? "skipped";
      const notes = [...(t.annotations ?? []), ...(result?.annotations ?? [])];
      const expected = notes
        .filter((a) => a.type === "expected-red")
        .map((a) => a.description);
      const steps = notes
        .filter((a) => a.type === "promise-step")
        .map((a) => a.description);
      const live =
        notes.some((a) => a.type === "live") || t.projectName === "live";
      let verdict;
      if (status === "passed")
        verdict = expected.length > 0 ? "GREEN, WAS EXPECTED RED" : "GREEN";
      else if (status === "skipped" || status === "interrupted")
        verdict = "NOT RUN";
      else if (live && mode !== "LIVE") verdict = "LIVE-PENDING";
      else if (expected.length > 0)
        verdict = `EXPECTED RED (${expected.map((e) => e.split(":")[0]).join("; ")})`;
      else verdict = "UNEXPECTED RED";
      const error = (result?.error?.message ?? "")
        .split("\n")[0]
        .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu"), "")
        .slice(0, 140);
      rows.push({
        project: t.projectName,
        file: spec.file ?? file,
        title: spec.title,
        status,
        verdict,
        label: live && mode !== "LIVE" ? "LIVE-PENDING" : mode,
        expected,
        steps,
        error,
        ms: result?.duration ?? 0,
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child, suite.file ?? file);
}
for (const suite of report.suites ?? []) walk(suite, suite.file);

const count = (prefix) =>
  rows.filter((r) => r.verdict.startsWith(prefix)).length;
const lines = [
  `# Recovery verification results (${mode})`,
  "",
  `Report: \`${reportPath}\`, generated ${new Date().toISOString()}.`,
  "",
  `| GREEN | GREEN, WAS EXPECTED RED | EXPECTED RED | UNEXPECTED RED | LIVE-PENDING | NOT RUN | total |`,
  `|---|---|---|---|---|---|---|`,
  `| ${count("GREEN") - count("GREEN, WAS")} | ${count("GREEN, WAS")} | ${count("EXPECTED RED")} | ${count("UNEXPECTED RED")} | ${count("LIVE-PENDING")} | ${count("NOT RUN")} | ${rows.length} |`,
  "",
  "| label | project | test | verdict | first error line |",
  "|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| ${r.label} | ${r.project} | ${r.title.replace(/\|/gu, "/")} | ${r.verdict} | ${r.verdict === "GREEN" ? "" : r.error.replace(/\|/gu, "/")} |`,
  ),
];
const results = `${lines.join("\n")}\n`;

// Promise matrix: Q.0x x steps 1-12.
const promises = new Map();
for (const r of rows) {
  for (const step of r.steps) {
    const [promise, number, title] = step.split("|");
    if (!promises.has(promise)) promises.set(promise, new Map());
    promises
      .get(promise)
      .set(Number(number), { title, verdict: r.verdict, label: r.label });
  }
}
const short = (v) =>
  v === undefined
    ? "-"
    : v.startsWith("EXPECTED RED")
      ? "EXP-RED"
      : v.replace("GREEN, WAS EXPECTED RED", "GREEN*");
const promiseLines = [
  `# Promise acceptance Q.01-Q.08 (${mode})`,
  "",
  "Steps: 1 journey, 2 data, 3 backend, 4 UI, 5 text, 6 voice, 7 persistence, 8 authorization, 9 failure, 10 integration, 11 honesty, 12 measurement.",
  "",
  `| promise | ${Array.from({ length: 12 }, (_, i) => String(i + 1)).join(" | ")} |`,
  `|---|${Array.from({ length: 12 }, () => "---").join("|")}|`,
  ...[...promises.keys()].sort().map((promise) => {
    const steps = promises.get(promise);
    return `| ${promise} | ${Array.from({ length: 12 }, (_, i) => short(steps.get(i + 1)?.verdict)).join(" | ")} |`;
  }),
  "",
  "GREEN* passed while still annotated expected red. Voice steps in a MOCK run use faked transports; their LIVE result is LIVE-PENDING.",
];
const promisesMd = `${promiseLines.join("\n")}\n`;

if (out === null) {
  console.log(results);
  if (promises.size > 0) console.log(promisesMd);
} else {
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "results.md"), results);
  writeFileSync(resolve(out, "promises.md"), promisesMd);
  console.log(`wrote ${resolve(out, "results.md")} and promises.md`);
}
