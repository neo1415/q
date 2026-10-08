import { expect, test, type Page } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { awaits } from "../support/expected-red.js";
import {
  ask,
  expectLastTurnTerminal,
  expectReceipt,
  operateScreen,
  recordReceipts,
  send,
} from "../support/q.js";
import {
  answer,
  reading,
  useScript,
  vendorMark,
  vendorRequestsSince,
} from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * Navigate from anywhere, and SPEC §5 Scenario A: Capital → Readiness tab →
 * scroll to Risks → "explain the second one". The model's choices are
 * scripted; what is under test is that the product carries them out, says
 * so with a receipt, and resolves "the second one" against what is on screen.
 */

let page: Page;

test.beforeAll(async ({ browser }) => {
  const context = await contextAs(browser, CAST.founder);
  page = await context.newPage();
  await recordReceipts(page);
});

test.afterAll(async () => {
  await page.context().close();
});

const SURFACES = [
  {
    say: "open discover",
    destination: "DISCOVER",
    url: /\/discover/u,
    heading: /Discover/u,
  },
  {
    say: "take me to my documents",
    destination: "DOCUMENTS",
    url: /\/documents/u,
    heading: /Documents/u,
  },
  {
    say: "show me relationships",
    destination: "RELATIONSHIPS",
    url: /\/relationships/u,
    heading: /Relationships/u,
  },
  {
    say: "go to capital",
    destination: "CAPITAL",
    url: /\/capital/u,
    heading: /Capital/u,
  },
  {
    say: "open settings",
    destination: "SETTINGS",
    url: /\/settings/u,
    heading: /Settings/u,
  },
] as const;
const STARTS = [
  "/home",
  "/documents",
  "/relationships",
  "/settings",
  "/capital",
] as const;

for (const start of STARTS) {
  for (const surface of SURFACES) {
    if (surface.url.test(start)) continue;
    test(`from ${start}, "${surface.say}" arrives`, async () => {
      if (start !== "/home") {
        // Defect G-D5 (baseline fe5579c3): asked from the Q dock on any page
        // but the Q page, Q says "Discover is up." and shows an "Open
        // Discover" card (twice) but the page never changes.
        awaits(
          ["C3"],
          "defect G-D5: dock navigation is claimed, not performed",
        );
      }
      await useScript([
        reading("TOOL_REQUEST", {
          tool: {
            kind: "NAVIGATE",
            destination: surface.destination,
            visibility: null,
          },
        }),
        {
          name: "nav-answer",
          when: { task: "COMPANY_ANALYST" },
          reply: answer("Here you are."),
        },
      ]);
      await page.goto(start);
      await send(page, surface.say);
      // The proof is the arrival itself: the URL and the page's own heading.
      await expect(page).toHaveURL(surface.url, { timeout: 60_000 });
      await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(
        surface.heading,
      );
    });
  }
}

test("Scenario A: Capital, the Readiness tab, scroll to risks, explain the second one", async () => {
  awaits(
    ["C1", "C2", "C3", "B6", "G-R1", "G-R3"],
    "operate_screen, control ids tab.readiness / section.risks, receipts and reference resolution are not in the baseline",
  );
  await page.goto("/home");
  await useScript([
    {
      name: "open-readiness",
      when: { task: "COMPANY_ANALYST", user: "readiness tab", afterTool: null },
      reply: { toolCalls: [operateScreen("SELECT_TAB", "tab.readiness")] },
    },
    {
      name: "after-open",
      when: {
        task: "COMPANY_ANALYST",
        user: "readiness tab",
        afterTool: "operate_screen",
      },
      reply: answer("This is your readiness."),
    },
    {
      name: "scroll-risks",
      when: {
        task: "COMPANY_ANALYST",
        user: "scroll to the risks",
        afterTool: null,
      },
      reply: { toolCalls: [operateScreen("SCROLL_TO", "section.risks")] },
    },
    {
      name: "after-scroll",
      when: {
        task: "COMPANY_ANALYST",
        user: "scroll to the risks",
        afterTool: "operate_screen",
      },
      reply: answer("These are the risks."),
    },
    {
      name: "explain",
      when: { task: "COMPANY_ANALYST", user: "explain the second one" },
      reply: answer("The second risk is explained here."),
    },
  ]);
  await ask(page, "Open Capital on the readiness tab");
  await expect(page).toHaveURL(/\/capital/u);
  await expect(page.getByRole("tab", { name: "Readiness" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expectReceipt(page, { target: "tab.readiness", status: "DONE" });
  await expectLastTurnTerminal(page, ["ACTED", "ANSWERED"]);

  await ask(page, "scroll to the risks");
  await expectReceipt(page, { target: "section.risks", status: "DONE" });
  const risks = page.locator('[data-q-control="section.risks"]');
  await expect(risks).toBeInViewport();

  // "The second one" is whatever is second on screen: the model must have
  // been shown it (B6). Its title is read from the page, not assumed.
  const second =
    (await risks.locator("li").nth(1).innerText()).split("\n")[0] ?? "";
  expect(second.length).toBeGreaterThan(0);
  const mark = await vendorMark();
  await ask(page, "explain the second one");
  const seen = await vendorRequestsSince(mark);
  expect(
    seen.some((request) => (request.input ?? "").includes(second)),
    `the model was shown the second risk ("${second}")`,
  ).toBe(true);
  await expectLastTurnTerminal(page, ["ANSWERED"]);
});

test("an act on a control the page does not have is reported TARGET_MISSING, never done", async () => {
  awaits(
    ["C1", "C2", "G-R1", "G-R3"],
    "receipts and dispositions are not rendered yet",
  );
  await page.goto("/settings");
  await useScript([
    {
      name: "missing",
      when: { task: "COMPANY_ANALYST", user: "mandate tab", afterTool: null },
      reply: { toolCalls: [operateScreen("SELECT_TAB", "tab.mandate")] },
    },
    {
      name: "after-missing",
      when: { task: "COMPANY_ANALYST", afterTool: "operate_screen" },
      reply: answer("Done."),
    },
  ]);
  await ask(page, "open the mandate tab");
  await expectReceipt(page, {
    target: "tab.mandate",
    status: "TARGET_MISSING",
  });
  // Q must not claim it happened.
  const disposition = await expectLastTurnTerminal(page);
  expect(disposition).not.toBe("ACTED");
});
