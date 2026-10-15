#!/usr/bin/env node
/**
 * Recovery G: runs the release gates one at a time and writes what happened
 * to docs/recovery/evidence/<date>/ — exact command, exit code, duration,
 * the counts each tool printed itself, and a raw tail. A gate that was not
 * run is written NOT RUN, never PASS.
 *
 *   node scripts/recovery/release-evidence.mjs                 # every gate
 *   node scripts/recovery/release-evidence.mjs --only recovery,perf
 *   node scripts/recovery/release-evidence.mjs --skip lint,build
 *
 * Gates run sequentially: the VM has 4 shared CPUs and eslint must run
 * alone (CLAUDE.md). The recovery browser suite needs the local stack up
 * (scripts/recovery/local-stack.sh start && ... seed); its results are MOCK.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const RUN =
  process.env.CQ_RECOVERY_RUN_DIR ??
  resolve(ROOT, ".playwright/recovery-stack");
const args = process.argv.slice(2);
const list = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? null : new Set(args[at + 1].split(","));
};
const only = list("only");
const skip = list("skip") ?? new Set();
const date = new Date().toISOString().slice(0, 10);
const OUT = resolve(ROOT, "docs/recovery/evidence", date);
mkdirSync(resolve(OUT, "raw"), { recursive: true });

const DISABLED = "disabled-locally-000000000000";
const env = {
  ...process.env,
  // No gate may reach a provider (CLAUDE.md): non-empty, disabled.
  OPENAI_API_KEY: DISABLED,
  GEMINI_API_KEY: DISABLED,
  GROQ_API_KEY: DISABLED,
  ELEVENLABS_API_KEY: DISABLED,
  DEEPGRAM_API_KEY: DISABLED,
  TURBO_CACHE_DIR: process.env.TURBO_CACHE_DIR ?? "/home/user/q/.turbo/cache",
};

/** Each gate: the command, and how to read its own summary. */
const GATES = [
  {
    id: "format",
    cmd: ["pnpm", "format:check"],
    counts: (t) => ({
      unformatted: (t.match(/\[warn\] (?!Code style)/gu) ?? []).length,
    }),
  },
  {
    id: "lint",
    cmd: ["pnpm", "lint"],
    counts: (t) => ({
      problems: Number(t.match(/(\d+) problems?/u)?.[1] ?? 0),
    }),
  },
  {
    id: "typecheck",
    cmd: ["pnpm", "typecheck"],
    counts: (t) => ({ errors: (t.match(/error TS\d+/gu) ?? []).length }),
  },
  {
    id: "recovery-typecheck",
    cmd: ["npx", "tsc", "--noEmit", "-p", "tests/recovery/tsconfig.json"],
    counts: (t) => ({ errors: (t.match(/error TS\d+/gu) ?? []).length }),
  },
  {
    id: "unit",
    cmd: ["pnpm", "test"],
    counts: (t) => ({
      files: t.match(/Test Files\s+([^\n]+)/u)?.[1]?.trim() ?? "?",
      tests: t.match(/\n\s+Tests\s+([^\n]+)/u)?.[1]?.trim() ?? "?",
    }),
  },
  {
    id: "pgtap",
    cmd: ["npx", "supabase", "test", "db"],
    counts: (t) => ({
      result: t.match(/Result: (\w+)/u)?.[1] ?? "?",
      files: t.match(/Files=(\d+)/u)?.[1] ?? "?",
      tests: t.match(/Tests=(\d+)/u)?.[1] ?? "?",
    }),
  },
  {
    id: "build",
    cmd: ["pnpm", "build"],
    counts: (t) => ({
      tasks: t.match(/Tasks:\s+([^\n]+)/u)?.[1]?.trim() ?? "?",
    }),
  },
  {
    id: "recovery",
    cmd: [
      "npx",
      "playwright",
      "test",
      "-c",
      "tests/recovery/playwright.recovery.config.ts",
      "--project",
      "permissions",
      "--project",
      "scenarios",
      "--project",
      "voice",
      "--project",
      "promises",
      "--project",
      "a11y",
      // Live specs refuse at once in a MOCK stack: reported LIVE-PENDING.
      "--project",
      "live",
    ],
    counts: (t) => ({
      passed: Number(t.match(/(\d+) passed/u)?.[1] ?? 0),
      failed: Number(t.match(/(\d+) failed/u)?.[1] ?? 0),
      didNotRun: Number(t.match(/(\d+) did not run/u)?.[1] ?? 0),
      mode: existsSync(resolve(RUN, "mode"))
        ? readFileSync(resolve(RUN, "mode"), "utf8").trim().toUpperCase()
        : "UNKNOWN",
    }),
    after: () =>
      run(["node", "scripts/recovery/results-table.mjs", "--out", OUT]),
  },
  {
    id: "perf",
    cmd: [
      "node",
      "scripts/recovery/perf-report.mjs",
      resolve(RUN, "q-api.log"),
    ],
    counts: (t) => ({
      metrics: (t.match(/^\| (voice|q answer|duplex)/gmu) ?? []).length,
    }),
    keepOutput: "perf.md",
  },
];

function run(cmd) {
  const started = Date.now();
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd: ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    code: result.status ?? -1,
    ms: Date.now() - started,
    text: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

const lines = [
  `# Release evidence, ${date}`,
  "",
  `Commit \`${run(["git", "rev-parse", "HEAD"]).text.trim()}\` on \`${run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).text.trim()}\`. Provider keys disabled for every gate. Browser results are MOCK; live voice is LIVE-PENDING (scripts/recovery/voice/LIVE-PROCEDURE.md).`,
  "",
  "| gate | command | exit | result | seconds | counts (as the tool printed them) |",
  "|---|---|---|---|---|---|",
];
for (const gate of GATES) {
  const selected = (only === null || only.has(gate.id)) && !skip.has(gate.id);
  if (!selected) {
    lines.push(
      `| ${gate.id} | \`${gate.cmd.join(" ")}\` | - | NOT RUN | - | - |`,
    );
    continue;
  }
  console.log(`[evidence] ${gate.id}: ${gate.cmd.join(" ")}`);
  const result = run(gate.cmd);
  const tail = result.text.split("\n").slice(-80).join("\n");
  writeFileSync(
    resolve(OUT, "raw", `${gate.id}.txt`),
    `$ ${gate.cmd.join(" ")}\n(exit ${String(result.code)})\n${tail}\n`,
  );
  if (gate.keepOutput !== undefined)
    writeFileSync(resolve(OUT, gate.keepOutput), result.text);
  gate.after?.();
  lines.push(
    `| ${gate.id} | \`${gate.cmd.join(" ")}\` | ${String(result.code)} | ${result.code === 0 ? "PASS" : "FAIL"} | ${(result.ms / 1000).toFixed(0)} | ${JSON.stringify(gate.counts(result.text)).replace(/\|/gu, "/")} |`,
  );
}
writeFileSync(resolve(OUT, "gates.md"), `${lines.join("\n")}\n`);
// The format gate covers docs/: what this writes is formatted like the rest.
spawnSync("npx", ["prettier", "--write", OUT], { cwd: ROOT, encoding: "utf8" });
console.log(`[evidence] wrote ${resolve(OUT, "gates.md")} (prettier applied)`);
