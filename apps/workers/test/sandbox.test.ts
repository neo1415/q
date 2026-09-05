import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createParserSandbox } from "../src/parser/sandbox.js";
import { EXTRACTION_PARSER_LIMITS } from "../src/parser/limits.js";

/**
 * The sandbox's controls, exercised against real child processes.
 *
 * Each test here is a containment property: what the parser can see, how long
 * it may run, how much it may say, and what happens to the bytes afterwards.
 * They use fixture children rather than the real parser so that a failure
 * points at the boundary rather than at an extractor.
 */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "cq-sandbox-test-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function sandbox(entry: string, overrides: Record<string, unknown> = {}) {
  return createParserSandbox({
    timeoutMs: 3_000,
    maxOutputBytes: 256 * 1024,
    maxOldSpaceMb: 256,
    limits: EXTRACTION_PARSER_LIMITS,
    entryPath: join(fixtures, entry),
    tempRoot,
    ...overrides,
  });
}

const input = {
  content: Buffer.from("document bytes", "utf8"),
  mimeType: "text/plain",
  filename: "quarterly.txt",
  sizeBytes: 14,
};

describe("parser sandbox", () => {
  it("passes the request and the bytes through files, and returns validated output", async () => {
    const result = await sandbox("echo-request.mjs").run(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.extractorId).toBe("fixture");
    expect(result.output.blocks[0]).toMatchObject({ text: "quarterly.txt" });
    expect(result.output.blocks[1]).toMatchObject({ text: "document bytes" });
  });

  it("treats a filename containing shell metacharacters as data", async () => {
    // No shell is involved, so this is a string in a JSON file and nothing
    // more. If it were interpolated into a command line it would not be.
    const hostile = `q"; rm -rf / #$(whoami)\`id\`.txt`;
    const result = await sandbox("echo-request.mjs").run({
      ...input,
      filename: hostile,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.blocks[0]).toMatchObject({ text: hostile });
  });

  it("gives the parser no credentials from this process", async () => {
    // The operating system injects a small fixed set (a home path, a temp
    // path, a user name) into every child it starts. Nothing the application
    // holds is in it, which is the property that matters: a compromised
    // parser finds no database URL, no storage key and no model key.
    const OS_INJECTED = new Set([
      "HOMEDRIVE",
      "HOMEPATH",
      "LOGONSERVER",
      "PATH",
      "SYSTEMDRIVE",
      "SYSTEMROOT",
      "SystemRoot",
      "TEMP",
      "TMP",
      "USERDOMAIN",
      "USERNAME",
      "USERPROFILE",
      "WINDIR",
      "windir",
      "NODE_ENV",
    ]);
    process.env.DATABASE_URL = "postgres://never-visible";
    process.env.SUPABASE_SECRET_KEY = "never-visible";
    process.env.ANTHROPIC_API_KEY = "never-visible";
    try {
      await sandbox("report-env.mjs").run(input);
      const report: unknown = JSON.parse(
        await readFile(join(tempRoot, "env-report.json"), "utf8"),
      );
      const keys = (report as { keys: string[] }).keys;
      expect(keys).not.toContain("DATABASE_URL");
      expect(keys).not.toContain("SUPABASE_SECRET_KEY");
      expect(keys).not.toContain("ANTHROPIC_API_KEY");
      expect(keys.filter((key) => !OS_INJECTED.has(key))).toEqual([]);
      expect(keys).toContain("NODE_ENV");
    } finally {
      delete process.env.DATABASE_URL;
      delete process.env.SUPABASE_SECRET_KEY;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("kills a parser that will not finish", async () => {
    const result = await sandbox("hang.mjs", { timeoutMs: 500 }).run(input);
    expect(result).toMatchObject({ ok: false, code: "PARSER_TIMEOUT" });
  });

  it("refuses a parser that floods its output", async () => {
    const result = await sandbox("flood.mjs", {
      maxOutputBytes: 64 * 1024,
    }).run(input);
    expect(result).toMatchObject({
      ok: false,
      code: "PARSER_OUTPUT_TOO_LARGE",
    });
  });

  it("refuses output that is not a parser result", async () => {
    const result = await sandbox("garbage.mjs").run(input);
    expect(result).toMatchObject({ ok: false, code: "PARSER_INVALID_OUTPUT" });
  });

  it("reports a parser that dies without answering", async () => {
    const result = await sandbox("crash.mjs").run(input);
    expect(result).toMatchObject({ ok: false, code: "PARSER_CRASHED" });
  });

  it("removes the workspace after every outcome, including a timeout", async () => {
    await sandbox("echo-request.mjs").run(input);
    await sandbox("hang.mjs", { timeoutMs: 400 }).run(input);
    await sandbox("crash.mjs").run(input);
    const left = await readdir(tempRoot);
    expect(left.filter((name) => name.startsWith("cq-parse-"))).toEqual([]);
  });
});
