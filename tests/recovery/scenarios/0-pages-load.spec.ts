import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { CAST } from "../support/stack.js";

/**
 * Before any scenario: every page the scenarios use loads for each role,
 * with no uncaught page error and no "This page couldn't load".
 */
const PAGES: ReadonlyArray<readonly [string, string]> = [
  [CAST.founder, "/home"],
  [CAST.founder, "/capital"],
  [CAST.founder, "/documents"],
  [CAST.founder, "/investors"],
  [CAST.founder, "/relationships"],
  [CAST.founder, "/work"],
  [CAST.founder, "/settings"],
  [CAST.investor, "/home"],
  [CAST.investor, "/discover"],
  [CAST.investor, "/work"],
];

for (const [who, path] of PAGES) {
  test(`${path} loads for ${who.split("@")[0] ?? who}`, async ({ browser }) => {
    const page = await (await contextAs(browser, who)).newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Regression for the integration /home crash (2026-10-08): a TypeError
    // caught by an error boundary is logged to the console, not thrown.
    page.on("console", (message) => {
      if (message.type() === "error" && /TypeError/u.test(message.text())) {
        errors.push(message.text().slice(0, 200));
      }
    });
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(
      page.getByRole("heading", { name: "This page couldn't load." }),
    ).toHaveCount(0);
    expect(errors, "uncaught page errors").toEqual([]);
  });
}
