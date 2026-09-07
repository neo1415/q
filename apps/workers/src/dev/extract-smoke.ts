/* eslint-disable no-console */
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

import type { ExtractedBlock } from "@capital-q/evidence/contracts";
import { planChunks, type PlannedChunk } from "@capital-q/q-knowledge";

import { EXTRACTION_PARSER_LIMITS } from "../parser/limits.js";
import { createParserSandbox } from "../parser/sandbox.js";
import { syntheticFixture, SYNTHETIC_FIXTURES } from "./fixtures.js";

/**
 * Extraction and chunking smoke (CQ-RAG-001 §77).
 *
 *   pnpm rag:extract-smoke -- --builtin deck
 *   pnpm rag:extract-smoke -- ./path/to/synthetic.pptx [--show-text]
 *
 * Runs one file through the real parser sandbox (child process, scrubbed
 * environment, the production limits) and the real chunker, then prints a
 * safe summary: parser and version, blocks by kind, locator coverage, and
 * every chunk's index, role, kind, size, hash prefix and locator. Text
 * excerpts are printed only for the built-in synthetic fixtures, or when
 * `--show-text` is passed for a file the operator knows to be synthetic.
 * No database, no storage, no model, no tenant.
 */

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
};

function parseArgs(argv: readonly string[]): {
  readonly builtin: string | undefined;
  readonly path: string | undefined;
  readonly showText: boolean;
} {
  let builtin: string | undefined;
  let path: string | undefined;
  let showText = false;
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at] ?? "";
    if (arg === "--builtin") {
      builtin = argv[at + 1];
      at += 1;
    } else if (arg === "--show-text") {
      showText = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag ${arg}`);
    } else {
      path = arg;
    }
  }
  return { builtin, path, showText };
}

function locatorSummary(locator: PlannedChunk["locator"]): string {
  const parts: string[] = [];
  if (locator.slide !== undefined) parts.push(`slide ${String(locator.slide)}`);
  if (locator.pageStart !== undefined) {
    parts.push(
      locator.pageEnd !== undefined && locator.pageEnd !== locator.pageStart
        ? `pages ${String(locator.pageStart)}-${String(locator.pageEnd)}`
        : `page ${String(locator.pageStart)}`,
    );
  }
  if (locator.headingPath !== undefined) {
    parts.push(`heading ${locator.headingPath.join(" > ")}`);
  }
  if (locator.sectionStart !== undefined) {
    parts.push(
      `sections ${String(locator.sectionStart)}-${String(locator.sectionEnd ?? locator.sectionStart)}`,
    );
  }
  if (locator.lineStart !== undefined) {
    parts.push(
      `lines ${String(locator.lineStart)}-${String(locator.lineEnd ?? locator.lineStart)}`,
    );
  }
  if (locator.sheet !== undefined) parts.push(`sheet ${locator.sheet}`);
  if (locator.range !== undefined) parts.push(`range ${locator.range}`);
  if (locator.rowStart !== undefined) {
    parts.push(
      `rows ${String(locator.rowStart)}-${String(locator.rowEnd ?? locator.rowStart)}`,
    );
  }
  return parts.length === 0 ? "(no locator)" : parts.join(" · ");
}

function blockLocatorCoverage(blocks: readonly ExtractedBlock[]): string {
  const with_ = (key: keyof ExtractedBlock["locator"]) =>
    blocks.filter((b) => b.locator[key] !== undefined).length;
  return [
    `page ${String(with_("page"))}`,
    `slide ${String(with_("slide"))}`,
    `section ${String(with_("section"))}`,
    `lines ${String(with_("lineStart"))}`,
    `sheet ${String(with_("sheet"))}`,
    `range ${String(with_("range"))}`,
  ].join(", ");
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  let content: Buffer;
  let filename: string;
  let mimeType: string;
  let synthetic = false;
  if (args.builtin !== undefined) {
    const fixture = syntheticFixture(args.builtin);
    if (fixture === undefined) {
      console.error(
        `unknown built-in fixture; choose one of: ${SYNTHETIC_FIXTURES.map((f) => f.name).join(", ")}`,
      );
      return 2;
    }
    content = fixture.build();
    filename = fixture.filename;
    mimeType = fixture.mimeType;
    synthetic = true;
    console.log(`fixture: ${fixture.name} — ${fixture.description}`);
  } else if (args.path !== undefined) {
    content = readFileSync(args.path);
    filename = basename(args.path);
    const mime = MIME_BY_EXTENSION[extname(filename).toLowerCase()];
    if (mime === undefined) {
      console.error(
        "unsupported extension; expected pdf, docx, pptx, xlsx, csv or txt",
      );
      return 2;
    }
    mimeType = mime;
    console.log(`file: ${filename} (${String(content.byteLength)} bytes)`);
  } else {
    console.error(
      `usage: rag:extract-smoke -- --builtin <${SYNTHETIC_FIXTURES.map((f) => f.name).join("|")}> | <path> [--show-text]`,
    );
    return 2;
  }

  const sandbox = createParserSandbox({
    timeoutMs: 30_000,
    maxOutputBytes: 16 * 1024 * 1024,
    maxOldSpaceMb: 512,
    limits: EXTRACTION_PARSER_LIMITS,
  });
  const started = Date.now();
  const result = await sandbox.run({
    content,
    mimeType,
    filename,
    sizeBytes: content.byteLength,
  });
  if (!result.ok) {
    console.log(
      `extraction refused: ${result.code} (${String(result.durationMs)} ms)`,
    );
    return 1;
  }
  const blocks = result.output.blocks;
  const byKind = new Map<string, number>();
  for (const block of blocks) {
    byKind.set(block.kind, (byKind.get(block.kind) ?? 0) + 1);
  }
  console.log(
    `parser: ${result.extractorId}@${result.extractorVersion} · ${String(result.durationMs)} ms · ${String(blocks.length)} blocks${result.output.metadata.truncated === true ? " · TRUNCATED" : ""}`,
  );
  console.log(
    `blocks by kind: ${[...byKind.entries()].map(([k, n]) => `${k} ${String(n)}`).join(", ")}`,
  );
  console.log(`locators present on blocks: ${blockLocatorCoverage(blocks)}`);

  const chunkStarted = Date.now();
  const plan = planChunks(blocks);
  const chunkMs = Date.now() - chunkStarted;
  const leaves = plan.chunks.filter((c) => c.role === "LEAF");
  const sizes = leaves.map((c) => c.tokenEstimate).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
  console.log(
    `chunking: ${plan.chunkingVersion} · strategy ${plan.strategy} · ${String(plan.chunks.length)} chunks (${String(leaves.length)} leaves) · ${String(chunkMs)} ms · leaf tokens min ${String(sizes[0] ?? 0)} median ${String(median)} max ${String(sizes[sizes.length - 1] ?? 0)}${plan.truncated ? " · TRUNCATED" : ""}`,
  );
  console.log("");
  for (const chunk of plan.chunks) {
    console.log(
      `#${String(chunk.index).padStart(3, " ")} ${chunk.role.padEnd(6)} ${chunk.kind.padEnd(17)} ${String(chunk.tokenEstimate).padStart(5)} tok  sha ${chunk.contentSha256.slice(0, 12)}  blocks ${String(chunk.blockIndexStart)}-${String(chunk.blockIndexEnd)}${chunk.parentIndex === null ? "" : `  parent #${String(chunk.parentIndex)}`}${chunk.instructionRiskSignals > 0 ? `  risk ${String(chunk.instructionRiskSignals)}` : ""}  ${locatorSummary(chunk.locator)}`,
    );
    if (synthetic || args.showText) {
      console.log(`     ${chunk.content.replace(/\s+/g, " ").slice(0, 160)}`);
    }
  }
  console.log("");
  console.log(
    `total ${String(Date.now() - started)} ms; no model, no database, no storage, no network`,
  );
  return 0;
}

process.exitCode = await main();
