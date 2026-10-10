#!/usr/bin/env node
// Whole-repo lint in bounded batches. One `eslint .` process with
// type-aware rules loads every workspace's TypeScript program at once and
// outgrew a 4 GB heap (CI quality job, 2026-10-10: heap OOM). The rules and
// the file set are unchanged: every file `eslint .` would lint is linted by
// exactly one batch below, with the same config and --max-warnings=0.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const dirs = (parent) =>
  readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${parent}/${entry.name}`)
    .sort();

const packages = dirs("packages");
const chunk = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, i * size + size),
  );

const batches = [
  ...dirs("apps").map((app) => [app]),
  ...chunk(packages, 8),
  // Everything outside apps/ and packages/ (tests, scripts, root configs).
  [".", "--ignore-pattern", "apps/**", "--ignore-pattern", "packages/**"],
];

let failed = false;
for (const batch of batches) {
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/eslint/bin/eslint.js",
      "--max-warnings=0",
      "--no-warn-ignored",
      ...batch,
    ],
    { stdio: "inherit" },
  );
  const label = batch.filter(
    (arg) => !arg.startsWith("-") && !arg.includes("*"),
  );
  console.log(
    `lint ${label.join(" ")}: ${result.status === 0 ? "ok" : "FAILED"} (${Math.round((Date.now() - started) / 1000)}s)`,
  );
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
