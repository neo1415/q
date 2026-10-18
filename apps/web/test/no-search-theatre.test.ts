import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { describeQStage } from "@capital-q/api-client";
import { Q_VISIBLE_STAGES, Q_VISIBLE_STAGE_LABELS } from "@capital-q/contracts";

/**
 * R38: web research is never made obvious. No "Searching the web…",
 * "Checking the public web", "Browsing the internet" in the web app or in
 * the stage labels a person reads while Q works. Results arrive; their
 * sources are behind "Sources". (The voice modules have their own guard in
 * apps/q-api/test/voice-no-filler.test.ts.)
 *
 * The scan reads string literals and JSX text only; comments may quote
 * what was removed.
 */

const ROOTS = [
  join(import.meta.dirname, "../src"),
  join(import.meta.dirname, "../app"),
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every string a module can show: literals, template pieces and JSX text. */
function literals(path: string): string[] {
  const file = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const THEATRE = [
  /\bsearch(ing)?\s+(the\s+)?(public\s+)?(web|internet|online|public sources)\b/i,
  /\bchecking\s+(the\s+)?(public\s+)?(web|internet)\b/i,
  /\bbrowsing\s+(the\s+)?(web|internet)\b/i,
  /\blooking\s+(it|that|this)?\s*up\s+online\b/i,
  /\bgoogling\b/i,
];

const isTheatre = (text: string) => THEATRE.some((line) => line.test(text));

describe("no search theatre in the web app (R38)", () => {
  const files = ROOTS.flatMap(sourceFiles);

  it("scans the web app", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("shows no 'searching the web' line anywhere", () => {
    const offending = files.flatMap((path) =>
      literals(path)
        .filter(isTheatre)
        .map((text) => `${path}: ${text}`),
    );
    expect(offending).toEqual([]);
  });

  it("labels every visible stage without naming a web search", () => {
    for (const stage of Q_VISIBLE_STAGES) {
      expect(isTheatre(Q_VISIBLE_STAGE_LABELS[stage])).toBe(false);
      expect(isTheatre(describeQStage(stage) ?? "")).toBe(false);
    }
    expect(Q_VISIBLE_STAGE_LABELS.SEARCHING_PUBLIC_SOURCES).not.toMatch(
      /search|web|internet|online/i,
    );
  });

  it("catches the lines it guards against", () => {
    expect(isTheatre("Searching the web…")).toBe(true);
    expect(isTheatre("Checking the public web on that.")).toBe(true);
    expect(isTheatre("Searching public sources")).toBe(true);
    expect(isTheatre("Sources")).toBe(false);
  });
});
