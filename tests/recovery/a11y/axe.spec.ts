import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { axe, summarise } from "../support/axe.js";
import { CAST } from "../support/stack.js";

/**
 * WCAG 2.2 AA (CLAUDE.md) on the pages the recovery scenarios walk, as each
 * role sees them. Serious and critical violations fail; every violation is
 * attached to the report so moderate ones are visible too.
 */
const PAGES: ReadonlyArray<{ readonly who: string; readonly path: string }> = [
  { who: CAST.founder, path: "/home" },
  { who: CAST.founder, path: "/capital" },
  { who: CAST.founder, path: "/documents" },
  { who: CAST.founder, path: "/investors" },
  { who: CAST.founder, path: "/work" },
  { who: CAST.founder, path: "/relationships" },
  { who: CAST.investor, path: "/home" },
  { who: CAST.investor, path: "/discover" },
  { who: CAST.investor, path: "/settings" },
];

for (const { who, path } of PAGES) {
  test(`${path} as ${who.split("@")[0] ?? who}: no serious or critical WCAG violations`, async ({
    browser,
  }, info) => {
    const page = await (await contextAs(browser, who)).newPage();
    await page.goto(path);
    await page.locator("main").first().waitFor({ timeout: 60_000 });
    const violations = await axe(page);
    await info.attach("axe-violations.txt", {
      body: summarise(violations) || "none",
      contentType: "text/plain",
    });
    const blocking = violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(blocking, summarise(blocking)).toEqual([]);
  });
}
