import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Production, 12 Nov 2026: three stores wrote `${JSON.stringify(x)}::jsonb`
 * (conversation tool results, conversation core state, awaiting actions).
 * postgres.js sends that as a JSON string, so every row held a string: a
 * follow-up turn saw 240 characters of escaped JSON instead of the earlier
 * research, the core state never saved, and Q's pending question was never
 * found. jsonbParam (packages/database/src/jsonb.ts) has existed since
 * 2026-10-01; this keeps every new `::jsonb` parameter on it.
 */
const root = fileURLToPath(new URL("../../..", import.meta.url));
const SAFE = /^(?:jsonbParam\(|(?:tx\.)?sql\.json\(|literal\(|null$)/u;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (["node_modules", "dist", ".next", ".turbo", "test"].includes(name)) {
      return [];
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [path] : [];
  });
}

/** The expression inside the `${…}` that ends right before `index`. */
function expressionBefore(text: string, index: number): string {
  let depth = 0;
  for (let at = index - 1; at > 0; at -= 1) {
    const char = text[at];
    if (char === "}") depth += 1;
    else if (char === "{") {
      depth -= 1;
      if (depth === 0 && text[at - 1] === "$")
        return text.slice(at + 1, index - 1);
    }
  }
  return "";
}

/** Splits at `separator` where it stands outside brackets and calls. */
function topLevel(expression: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < expression.length; at += 1) {
    const char = expression[at];
    if (char === "(" || char === "{" || char === "[") depth += 1;
    else if (char === ")" || char === "}" || char === "]") depth -= 1;
    else if (
      depth === 0 &&
      char === separator &&
      // `?.` and `??` are not a conditional; `::` is a cast.
      expression[at + 1] !== separator &&
      expression[at - 1] !== separator &&
      !(separator === "?" && expression[at + 1] === ".")
    ) {
      parts.push(expression.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(expression.slice(start));
  return parts;
}

/**
 * Safe when the value is built by jsonbParam / sql.json (or is a SQL
 * literal, or null), directly, through a variable assigned from one, or in
 * every branch of a conditional.
 */
function safe(expression: string, file: string): boolean {
  const value = expression.trim();
  if (SAFE.test(value)) return true;
  if (/^[A-Za-z_$][\w$]*$/u.test(value)) {
    return new RegExp(
      `\\b${value}\\s*=\\s*(?:jsonbParam\\(|(?:tx\\.)?sql\\.json\\()`,
      "u",
    ).test(file);
  }
  const conditional = topLevel(value, "?");
  if (conditional.length !== 2) return false;
  const branches = topLevel(conditional[1] ?? "", ":");
  return (
    branches.length === 2 && branches.every((branch) => safe(branch, file))
  );
}

/** Source text with comments blanked, so prose naming the pattern is not code. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, " "))
    .replace(
      /(^|[^:"'`])\/\/[^\n]*/gu,
      (line, lead: string) => lead + " ".repeat(line.length - lead.length),
    );
}

describe("jsonb parameters go through jsonbParam or sql.json", () => {
  it("has no pre-stringified ::jsonb parameter in application source", () => {
    const offenders: string[] = [];
    for (const top of ["apps", "packages"]) {
      for (const file of sources(join(root, top))) {
        const text = code(readFileSync(file, "utf8"));
        for (const match of text.matchAll(/\}::jsonb/gu)) {
          const expression = expressionBefore(text, match.index + 1).trim();
          if (!safe(expression, text)) {
            offenders.push(
              `${relative(root, file)}: \${${expression.replace(/\s+/gu, " ").slice(0, 80)}}::jsonb`,
            );
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the guard itself", () => {
  it("flags a pre-stringified value and accepts the helpers", () => {
    expect(safe("value", "const value = JSON.stringify(x);")).toBe(false);
    expect(safe("text", "")).toBe(false);
    expect(safe("a ? JSON.stringify(b) : null", "")).toBe(false);
    expect(safe("jsonbParam(sql, x)", "")).toBe(true);
    expect(safe("tx.sql.json(x)", "")).toBe(true);
    expect(safe("a ?? b ? null : jsonbParam(sql, c?.d ?? {})", "")).toBe(true);
    expect(safe("idsJson", "const idsJson = jsonbParam(sql, ids);")).toBe(true);
  });

  it("does not read a comment as code", () => {
    expect(code("// ${value}::jsonb\nconst a = 1;")).not.toContain("::jsonb");
    expect(code("/* ${value}::jsonb */")).not.toContain("::jsonb");
    expect(code('const url = "https://x"; ${v}::jsonb')).toContain("::jsonb");
  });
});
