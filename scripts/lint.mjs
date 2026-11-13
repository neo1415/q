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

// Type-aware rules resolve workspace packages through their built
// declarations, as `pnpm typecheck` does (turbo `^build`). Without them every
// cross-package type reads as unresolved `any` (CI, 2026-10-10). Turbo caches
// the build, so a warm run costs seconds.
// CQ_LINT_PREBUILT=1: the gate already built the packages at this commit.
const built =
  process.env["CQ_LINT_PREBUILT"] === "1"
    ? { status: 0 }
    : spawnSync(
        "pnpm",
        [
          "exec",
          "turbo",
          "run",
          "build",
          "--filter=./packages/*",
          "--output-logs=errors-only",
        ],
        { stdio: "inherit" },
      );
if (built.status !== 0) {
  console.log("lint: workspace packages failed to build");
  process.exit(1);
}

let failed = false;
for (const batch of batches) {
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      // One batch at a time, so a larger heap per process is safe on the
      // 16 GB CI runner; apps/web's typed program alone nears the 4 GB default.
      "--max-old-space-size=7168",
      "node_modules/eslint/bin/eslint.js",
      "--max-warnings=0",
      "--no-warn-ignored",
      // CQ_LINT_CONCURRENCY (the gate sets 2): ESLint's own worker threads
      // per batch. Measured 13 Nov on apps/web: off 243 s / 5.0 GB peak, 2
      // 167 s / 8.3 GB, 4 killed for memory (14 GB). Default: one thread.
      ...(/^[1-9]$/.test(process.env["CQ_LINT_CONCURRENCY"] ?? "")
        ? ["--concurrency", String(process.env["CQ_LINT_CONCURRENCY"])]
        : []),
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
