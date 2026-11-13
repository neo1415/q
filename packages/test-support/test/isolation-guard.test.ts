import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { NEEDS_ISOLATION } from "../../../vitest.config.js";

/**
 * Release gate (13 Nov): node-side tests share module graphs (vitest.config
 * project "node", isolate false). A module mock (vi.mock / vi.doMock) only
 * applies to a graph that has not loaded the real module, so every such
 * file must run isolated. Structural check over test source, not a rule
 * about anyone's words.
 */
const ROOT = resolve(import.meta.dirname, "../../..");
const NODE_SIDE_DIRS = ["packages", "apps/api", "apps/q-api", "apps/workers"];
const MOCKS = /\bvi\.(?:mock|doMock)\(/u;

function testFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) {
      continue;
    }
    const path = join(dir, name);
    if (statSync(path).isDirectory()) testFiles(path, out);
    else if (/\.(?:test|spec)\.tsx?$/u.test(name)) out.push(path);
  }
  return out;
}

describe("node-side tests that mock modules run isolated", () => {
  it("every one is listed in NEEDS_ISOLATION", () => {
    const listed = new Set(NEEDS_ISOLATION);
    const unlisted = NODE_SIDE_DIRS.flatMap((dir) => testFiles(join(ROOT, dir)))
      .filter(
        (path) =>
          !/\.(?:integration|live)\.test\.ts$/u.test(path) &&
          MOCKS.test(readFileSync(path, "utf8")),
      )
      .map((path) => relative(ROOT, path))
      .filter((path) => !listed.has(path));
    expect(unlisted).toEqual([]);
  });
});
