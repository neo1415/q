import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Server components may render a "use client" module's components, but must
 * never CALL one of its exports or read a property of one: on the server
 * every export of a client module is a client reference, so
 * `needsYouCount(ledger)` throws "Attempted to call needsYouCount() from the
 * server". jsdom tests cannot see this (they import the real function), so a
 * release that added "use client" to capital-overview.tsx and round-card.tsx
 * (2026-10-16) took down every founder Capital view in production.
 *
 * This walks the server module graph from the app router's entries (stopping
 * at "use client" boundaries) and fails when a server module calls, indexes
 * or dots into a value it imported from a client module.
 */

const WEB = resolve(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "node_modules" ? [] : walk(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

const sources = new Map<string, string>(
  [...walk(join(WEB, "app")), ...walk(join(WEB, "src"))].map((path) => [
    path,
    readFileSync(path, "utf8"),
  ]),
);

const DIRECTIVE =
  /^\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*["']use (client|server)["']/;
const directive = (path: string) =>
  DIRECTIVE.exec(sources.get(path) ?? "")?.[1];

function resolveImport(from: string, spec: string): string | undefined {
  let base: string;
  if (spec.startsWith("@/")) base = join(WEB, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
  else return undefined;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (sources.has(base + ext)) return base + ext;
  }
  return undefined;
}

const IMPORT =
  /import\s+(type\s+)?(?:([\w*{][^;]*?)\s+from\s+)?["']([^"']+)["']/g;
const NAMED = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;

function serverGraph(): Set<string> {
  const entries = [...sources.keys()].filter(
    (path) =>
      path.startsWith(join(WEB, "app")) &&
      /\/(page|layout|template|default|not-found|loading)\.tsx?$/.test(path) &&
      directive(path) === undefined,
  );
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length > 0) {
    const path = stack.pop();
    if (path === undefined || seen.has(path)) continue;
    seen.add(path);
    for (const match of (sources.get(path) ?? "").matchAll(IMPORT)) {
      if (match[1] !== undefined) continue;
      const target = resolveImport(path, match[3] ?? "");
      if (target !== undefined && directive(target) === undefined)
        stack.push(target);
    }
  }
  return seen;
}

function violations(): string[] {
  const found: string[] = [];
  for (const path of serverGraph()) {
    const source = sources.get(path) ?? "";
    for (const match of source.matchAll(NAMED)) {
      if (match[1] !== undefined) continue;
      const target = resolveImport(path, match[3] ?? "");
      if (target === undefined || directive(target) !== "client") continue;
      // Block comments are not code: "see PlanBoard." in a doc comment is
      // no call.
      const rest = source
        .slice((match.index ?? 0) + match[0].length)
        .replace(/\/\*[\s\S]*?\*\//g, "");
      for (const raw of (match[2] ?? "").split(",")) {
        const item = raw.trim();
        if (item === "" || item.startsWith("type ")) continue;
        const local =
          item
            .split(/\s+as\s+/)
            .pop()
            ?.trim() ?? "";
        // Hooks only run inside components, which a client parent renders.
        if (local === "" || /^use[A-Z]/.test(local)) continue;
        const use = new RegExp(`(?<![\\w<./])${local}\\s*[(.[]`);
        if (use.test(rest))
          found.push(
            `${relative(WEB, path)} uses ${local} from ${relative(WEB, target)}`,
          );
      }
    }
  }
  return found.sort();
}

describe("server components and client modules", () => {
  it("finds the server graph (the guard is not vacuous)", () => {
    const graph = serverGraph();
    expect(
      graph.has(join(WEB, "src/features/capital/capital-screen.tsx")),
    ).toBe(true);
  });

  it("never call, index or dot into a client module's export", () => {
    expect(violations()).toEqual([]);
  });
});
