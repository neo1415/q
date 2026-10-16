import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(join(import.meta.dirname, path), "utf8");

/**
 * Run 4, 16 Oct: the tour strip, fixed over the page's foot, covered the
 * CRM record's history, the last part of the page, which could not scroll
 * any higher. While a tour runs, the page gets room below its content.
 */
describe("the Q Pitch strip leaves the page's foot readable", () => {
  const css = read("../app/globals.css");
  const rules = [
    ...css.matchAll(
      /:root:has\(section\[data-q-pitch\]\)[^{]*\.cq-shell-main\s*\{([^}]*)\}/gu,
    ),
  ].map((match) => match[1] ?? "");

  it("gives the page at least the strip's height of room, on phones and desktops", () => {
    expect(rules.length).toBe(2);
    for (const body of rules) {
      const rem = /(\d+(?:\.\d+)?)rem/u.exec(body);
      expect(rem).not.toBeNull();
      // The desktop strip: 1.5rem from the foot plus about 7rem tall.
      expect(Number(rem?.[1])).toBeGreaterThanOrEqual(9);
    }
  });

  it("is keyed to the strip the tour host renders", () => {
    const host = read("../src/features/q-pitch/tour-host.tsx");
    expect(host).toMatch(
      /<section\s+aria-label="Q Pitch tour"\s+data-q-pitch/u,
    );
  });

  it("leaves full-height stages and threads alone", () => {
    for (const rule of css.matchAll(
      /:root:has\(section\[data-q-pitch\]\)[^{]*\{/gu,
    )) {
      expect(rule[0]).toMatch(/\.cq-q-home/u);
      expect(rule[0]).toMatch(/data-feed-immersive/u);
      expect(rule[0]).toMatch(/data-chat-thread/u);
    }
  });
});
