import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PROMPT_DEFINITIONS } from "@capital-q/q-core";

/**
 * Q can search the open web (founder report 2026-10-06: "Q still says it
 * can't search the internet"). No prompt, note, tool description or line
 * of Q's in the source may tell the model, or the person, that it cannot.
 * "Never say you cannot search" is the opposite and is allowed.
 */

const DENIAL = [
  /\b(?:i|you|q|we)\s+(?:can(?:'|’)?t|cannot|can not|am unable to|are unable to|is unable to|am not able to|are not able to|do(?:n'|n’| no)t have the ability to)\s+(?:search|browse|access|use|go on|look (?:things |it |that )?up on)\s+(?:the\s+)?(?:internet|web|online)\b/iu,
  /\b(?:i|you|q)\s+(?:do(?:n'|n’| no)t|does(?:n'|n’| no)t)\s+have\s+(?:access to\s+)?(?:the\s+)?(?:internet|web|real-time web|live web)\b/iu,
  /\b(?:no|without)\s+(?:internet|web|browsing)\s+access\b/iu,
  /\bnot connected to the internet\b/iu,
];
/** "never say you cannot search", "never claim you cannot ...": the opposite. */
const ALLOWED_BEFORE =
  /\bnever\s+(?:say|claim|tell\b[^.]{0,20})\b[^.]{0,20}$/iu;

function denials(text: string): readonly string[] {
  const found: string[] = [];
  for (const pattern of DENIAL) {
    const global = new RegExp(pattern.source, "giu");
    for (const match of text.matchAll(global)) {
      const before = text.slice(Math.max(0, match.index - 40), match.index);
      if (!ALLOWED_BEFORE.test(before)) found.push(match[0]);
    }
  }
  return found;
}

const ROOT = resolve(import.meta.dirname, "..", "..", "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (
      entry === "node_modules" ||
      entry === "dist" ||
      entry === "test" ||
      entry === ".next" ||
      entry === "e2e"
    ) {
      continue;
    }
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) sourceFiles(path, out);
    else if (
      /\.(?:ts|tsx)$/u.test(entry) &&
      !/\.(?:test|spec)\.tsx?$/u.test(entry)
    ) {
      out.push(path);
    }
  }
  return out;
}

describe("no prompt or line of Q's denies web search", () => {
  it("the denial patterns catch what Q said in production, and allow the opposite", () => {
    expect(denials("Sorry, I can't search the internet.")).toHaveLength(1);
    expect(denials("I don't have access to the web.")).toHaveLength(1);
    expect(denials("I cannot browse the web")).toHaveLength(1);
    expect(
      denials("never say you cannot search the internet or browse"),
    ).toHaveLength(0);
  });

  it("no published prompt template, of any version", () => {
    for (const definition of PROMPT_DEFINITIONS) {
      expect(
        denials(definition.template),
        `${definition.id} v${String(definition.version)}`,
      ).toEqual([]);
    }
  });

  it("no source file of a package or app that reaches Q", () => {
    const files = [
      ...sourceFiles(join(ROOT, "packages")),
      ...sourceFiles(join(ROOT, "apps", "q-api", "src")),
      ...sourceFiles(join(ROOT, "apps", "workers", "src")),
    ];
    expect(files.length).toBeGreaterThan(100);
    const offending = files.flatMap((file) =>
      denials(readFileSync(file, "utf8")).map(
        (text) => `${relative(ROOT, file)}: ${text}`,
      ),
    );
    expect(offending).toEqual([]);
  });
});
