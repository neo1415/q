import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  ParserOutputSchema,
  type ParserOutput,
} from "@capital-q/evidence/contracts";
import { z } from "zod";

import {
  PARSER_INPUT_FILE,
  PARSER_REQUEST_FILE,
  ParserRefusalCodeSchema,
  type ParserLimits,
  type ParserRefusalCode,
} from "./protocol.js";

/**
 * Runs the parser out of process, on purpose (doc 15 §28, doc 16 TM-FILE-05).
 *
 * Everything here is a boundary control:
 *
 * - an argument array, never a shell, so no filename can become a command;
 * - an environment built from nothing, so no database URL, storage key, model
 *   key, connector token or mail credential exists inside the parser;
 * - a private directory per run, removed in `finally` even after a timeout;
 * - a wall-clock timeout and a bounded stdout, so a crafted file can consume
 *   neither the worker nor its memory;
 * - Zod revalidation of everything that comes back, because the child's
 *   output is exactly as untrusted as the document that produced it.
 *
 * A refusal is a result, not an exception: a document that cannot be parsed
 * is a fact about the document, and the pipeline records it.
 */

const run = promisify(execFile);

const ChildResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      extractorId: z.string().min(1).max(64),
      extractorVersion: z.string().min(1).max(32),
      output: ParserOutputSchema,
    })
    .strict(),
  z.object({ ok: z.literal(false), code: ParserRefusalCodeSchema }).strict(),
]);

export type ParserResult =
  | {
      readonly ok: true;
      readonly extractorId: string;
      readonly extractorVersion: string;
      readonly output: ParserOutput;
      readonly durationMs: number;
    }
  | {
      readonly ok: false;
      readonly code: ParserRefusalCode;
      readonly durationMs: number;
    };

export type ParserSandboxOptions = {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly maxOldSpaceMb: number;
  readonly limits: ParserLimits;
  /** Overridable for tests; defaults to the compiled sibling of this module. */
  readonly entryPath?: string | undefined;
  readonly tempRoot?: string | undefined;
};

export type ParserSandboxInput = {
  readonly content: Buffer;
  readonly mimeType: string;
  readonly filename: string;
  readonly sizeBytes: number;
};

export type ParserSandbox = {
  readonly run: (input: ParserSandboxInput) => Promise<ParserResult>;
};

/**
 * The child lives beside this module. Resolving it from `import.meta.url`
 * keeps the path server-owned: nothing a document or a job payload contains
 * can influence which program runs.
 */
export function defaultParserEntryPath(): string {
  const here = fileURLToPath(import.meta.url);
  return here.replace(/sandbox\.(ts|js)$/, (_match, extension: string) =>
    extension === "ts" ? "child.ts" : "child.js",
  );
}

/**
 * A parser process starts with an empty environment.
 *
 * The operating system still injects a small fixed set of its own (a home
 * path, a temp path, a user name); that is unavoidable and harmless. What
 * matters is what is absent: no DATABASE_URL, no storage key, no model
 * provider key, no connector token, no mail credential. A compromised parser
 * has nothing to steal.
 */
function sandboxEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  if (process.platform === "win32") {
    for (const name of ["SystemRoot", "windir"]) {
      const value = process.env[name];
      if (value !== undefined) environment[name] = value;
    }
  }
  return environment;
}

export function createParserSandbox(
  options: ParserSandboxOptions,
): ParserSandbox {
  const entryPath = options.entryPath ?? defaultParserEntryPath();

  return {
    run: async (input) => {
      const started = Date.now();
      const workspace = await mkdtemp(
        join(options.tempRoot ?? tmpdir(), "cq-parse-"),
      );
      try {
        await writeFile(join(workspace, PARSER_INPUT_FILE), input.content, {
          mode: 0o600,
        });
        await writeFile(
          join(workspace, PARSER_REQUEST_FILE),
          JSON.stringify({
            mimeType: input.mimeType,
            filename: input.filename,
            sizeBytes: input.sizeBytes,
            limits: options.limits,
          }),
          { mode: 0o600 },
        );

        const { stdout } = await run(
          process.execPath,
          [
            `--max-old-space-size=${options.maxOldSpaceMb}`,
            entryPath,
            workspace,
          ],
          {
            cwd: workspace,
            env: sandboxEnvironment(),
            timeout: options.timeoutMs,
            maxBuffer: options.maxOutputBytes,
            windowsHide: true,
            shell: false,
            encoding: "utf8",
          },
        );

        const parsed = ChildResultSchema.safeParse(
          JSON.parse(stdout.trim().split("\n").at(-1) ?? "null"),
        );
        const durationMs = Date.now() - started;
        if (!parsed.success) {
          return { ok: false, code: "PARSER_INVALID_OUTPUT", durationMs };
        }
        return parsed.data.ok
          ? {
              ok: true,
              extractorId: parsed.data.extractorId,
              extractorVersion: parsed.data.extractorVersion,
              output: parsed.data.output,
              durationMs,
            }
          : { ok: false, code: parsed.data.code, durationMs };
      } catch (error: unknown) {
        return {
          ok: false,
          code: classifyChildFailure(error),
          durationMs: Date.now() - started,
        };
      } finally {
        // Always, including after a timeout kill: a document's bytes must not
        // outlive the run that read them.
        await rm(workspace, { recursive: true, force: true });
      }
    },
  };
}

function classifyChildFailure(error: unknown): ParserRefusalCode {
  const details = error as {
    readonly killed?: boolean;
    readonly signal?: string | null;
    readonly code?: string | number | null;
  };
  if (details.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return "PARSER_OUTPUT_TOO_LARGE";
  }
  if (details.killed === true || details.signal === "SIGTERM") {
    return "PARSER_TIMEOUT";
  }
  if (error instanceof SyntaxError) return "PARSER_INVALID_OUTPUT";
  return "PARSER_CRASHED";
}
