import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Live check 2026-10-16: founder Capital scrolled sideways by 116 px at
 * 390 px. A tab's sr-only text (position: absolute) inside a sideways
 * scroller had no positioned ancestor inside it, so it escaped the
 * scroller's clip and widened the page. Every sideways scroller is a
 * positioned box, so what is absolutely placed inside it stays clipped by
 * it. (The 390 px page audit is scripts/handoff/live/overflow-390.mjs.)
 */

const ROOTS = ["src", "app"].map((dir) => join(import.meta.dirname, "..", dir));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("sideways scrollers contain what is positioned inside them", () => {
  it("every overflow-x-auto class list also makes the box positioned", () => {
    const offenders = ROOTS.flatMap(files).flatMap((path) =>
      (
        readFileSync(path, "utf8").match(
          /"[^"\n]*overflow-x-auto[^"\n]*"|`[^`]*overflow-x-auto[^`]*`/gu,
        ) ?? []
      )
        .filter((list) => !/\b(relative|absolute|fixed|sticky)\b/u.test(list))
        .map((list) => `${path}: ${list}`),
    );
    expect(offenders).toEqual([]);
  });
});
