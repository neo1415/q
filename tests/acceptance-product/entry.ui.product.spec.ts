import { expect, test } from "@playwright/test";

import { closeDb, onboardingSessionFor } from "./support/db.js";
import {
  completeInvestorMandateByForm,
  qLines,
  returningPage,
  say,
  signUp,
  uniqueEmail,
  waitForQuiet,
} from "./support/ui.js";

/**
 * A (entry / proactivity), K (voice-first shell) and the returning-person
 * cases:
 *   - incomplete returning user -> proactive resume choices
 *   - completed returning user -> contextual welcome + useful quick actions
 *   - no duplicate welcome messages
 * Structure and continuity only: how many greetings, where the way back
 * leads, whether Q's voice controls are the first thing there.
 */

test.afterAll(closeDb);

test("incomplete returning investor: one greeting, and a way straight back into setup", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("inc");
  await signUp(page, {
    name: "Kofi Asante",
    organisation: "Gold Coast Angels",
    email,
  });
  await page.goto("/onboarding/investor");
  await say(page, "I'm an angel investor, mostly pre-seed in Ghana");
  const session = await onboardingSessionFor(email);
  expect(session.status).not.toBe("COMPLETED");

  const again = await returningPage(browser, page);
  await again.goto("/");
  await waitForQuiet(again, { timeoutMs: 120_000 });
  const url = new URL(again.url());

  // K: the landing is Q's own surface, with voice one tap away.
  await expect
    .soft(again.getByRole("button", { name: /Talk with Q/ }).first())
    .toBeVisible();
  // A: Q offers the way back into the unfinished setup as a choice.
  const resume = again.locator(
    'a[href*="/onboarding"], button:has-text("onboarding"), button:has-text("setup")',
  );
  const onOnboarding = url.pathname.startsWith("/onboarding");
  expect
    .soft(
      onOnboarding || (await resume.count()) > 0,
      `landed on ${url.pathname} with no resume choice`,
    )
    .toBe(true);
  // B: exactly one greeting.
  expect
    .soft(await again.getByRole("heading", { level: 1 }).count())
    .toBeLessThanOrEqual(1);
  const lines = await qLines(again);
  expect
    .soft(
      lines.length,
      `Q lines before the person spoke: ${JSON.stringify(lines)}`,
    )
    .toBeLessThanOrEqual(onOnboarding ? 30 : 1);
  await again.context().close();
});

test("completed returning investor: one contextual welcome and useful quick actions", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("done");
  await signUp(page, {
    name: "Ngozi Adeyemi",
    organisation: "Delta Seed",
    email,
  });
  await completeInvestorMandateByForm(page, {
    firm: "Delta Seed",
    country: "Nigeria",
    stage: "Pre-seed",
  });

  const again = await returningPage(browser, page);
  await again.goto("/");
  await waitForQuiet(again, { timeoutMs: 120_000 });

  await expect
    .soft(again.getByRole("button", { name: /Talk with Q/ }).first())
    .toBeVisible();
  const headings = await again
    .getByRole("heading", { level: 1 })
    .allInnerTexts();
  expect.soft(headings.length, JSON.stringify(headings)).toBe(1);
  // Contextual: the welcome names the person (a value they gave at sign-up).
  expect.soft(headings.join(" ")).toContain("Ngozi");
  // Quick actions: at least two things to tap that go somewhere real.
  const actions = again.locator("main li a, main li button");
  expect.soft(await actions.count()).toBeGreaterThanOrEqual(2);
  // B: the heading is the greeting; no extra welcome lines in the thread.
  expect.soft((await qLines(again)).length).toBe(0);
  await again.context().close();
});
