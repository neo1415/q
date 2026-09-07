#!/usr/bin/env node
/* global process, console, URL */
/**
 * Runs the live model smoke suites (CQ-Q-005 §52-53).
 *
 * Reads ONLY the two provider key names from `.env.local` (if present) and
 * passes them to a child vitest process. Nothing is printed, no other
 * variable from that file is loaded, and the values never touch a shell.
 * Presence is reported by name; values are never reported.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAMES = ["GEMINI_API_KEY", "GROQ_API_KEY"];
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const envFile = resolve(root, ".env.local");
const env = { ...process.env };

if (existsSync(envFile)) {
  const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (
      match === null ||
      !NAMES.includes(match[1]) ||
      env[match[1]] !== undefined
    ) {
      continue;
    }
    let value = match[2];
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) {
      env[match[1]] = value;
    }
  }
}

for (const name of NAMES) {
  console.log(`${name}: ${env[name] === undefined ? "MISSING" : "PRESENT"}`);
}
env.CQ_LIVE_MODEL_TESTS = "1";

const vitest = resolve(root, "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(
  process.execPath,
  [
    vitest,
    "run",
    "--config",
    "vitest.live-model.config.ts",
    ...process.argv.slice(2),
  ],
  { cwd: root, env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
