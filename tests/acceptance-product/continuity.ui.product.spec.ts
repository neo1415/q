import { expect, test } from "@playwright/test";

import {
  closeDb,
  interviewTurns,
  onboardingSessionFor,
  runsFor,
} from "./support/db.js";
import {
  completeInvestorMandateByForm,
  lastQAnswer,
  qLines,
  say,
  signUp,
  uniqueEmail,
  waitForQuiet,
} from "./support/ui.js";

/**
 * Continuity, in the real browser (the API suite covers meaning):
 *   - D7 a reload mid-onboarding restores the thread and greets once;
 *   - a refresh on Home keeps the same conversation, and Q still
 *     remembers what was said before the refresh.
 * Structure and authoritative state only; recall is checked on a value
 * the person introduced themselves.
 */

test.afterAll(closeDb);

test("D7 reload mid-onboarding: the thread comes back and Q greets once", async ({
  page,
}) => {
  const email = uniqueEmail("reload");
  await signUp(page, {
    name: "Amara Obi",
    organisation: "Lagoon Angels",
    email,
  });
  await page.goto("/onboarding/investor");
  await waitForQuiet(page, { timeoutMs: 180_000 });
  await say(
    page,
    "right so I'm an angel, Lagoon Angels is the vehicle, pre-seed, 20 to 60k dollars",
  );
  const scope = "[data-q-onboarding-workspace]";
  const before = await qLines(page, scope);
  const session = await onboardingSessionFor(email);
  const turnsBefore = (await interviewTurns(session.id)).length;

  await page.reload();
  await waitForQuiet(page, { timeoutMs: 180_000 });
  const after = await qLines(page, scope);
  const turnsAfter = await interviewTurns(session.id);
  test.info().annotations.push({
    type: "after-reload",
    description: JSON.stringify(after.slice(-4)),
  });

  expect
    .soft(after.length, "CAPABILITY: restore the thread on reload")
    .toBeGreaterThanOrEqual(before.length);
  expect
    .soft(
      after.length - before.length,
      "CAPABILITY: one coherent resume greeting, not several",
    )
    .toBeLessThanOrEqual(1);
  const newQTurns = turnsAfter
    .slice(turnsBefore)
    .filter((t) => t.role.toUpperCase() === "Q");
  expect
    .soft(
      newQTurns.length,
      `CAPABILITY: one resume turn persisted: ${JSON.stringify(newQTurns)}`,
    )
    .toBeLessThanOrEqual(1);
  expect(
    (await onboardingSessionFor(email)).id,
    "CAPABILITY: a reload continues the same onboarding session",
  ).toBe(session.id);
});

test("Home: a refresh keeps the same conversation and Q remembers the earlier turn", async ({
  page,
}) => {
  const email = uniqueEmail("refresh");
  await signUp(page, {
    name: "Folake Bello",
    organisation: "Ikoyi Seed",
    email,
  });
  await completeInvestorMandateByForm(page, {
    firm: "Ikoyi Seed",
    country: "Nigeria",
    stage: "Pre-seed",
  });
  await page.goto("/home");
  await waitForQuiet(page, { timeoutMs: 180_000 });
  const since = new Date();

  await say(
    page,
    "note for later: the founder I'm seeing next week is called Obiageli, runs a cold-chain startup",
  );
  const before = await qLines(page);
  await page.reload();
  await waitForQuiet(page, { timeoutMs: 180_000 });
  const restored = await qLines(page);
  expect
    .soft(
      restored.length,
      `CAPABILITY: a refresh shows the same conversation (before ${before.length} lines, after ${restored.length})`,
    )
    .toBeGreaterThanOrEqual(Math.max(1, before.length));

  await say(page, "what was the name of the founder I'm seeing next week?");
  const answer = await lastQAnswer(page);
  test
    .info()
    .annotations.push({ type: "answer", description: answer.slice(0, 800) });
  expect
    .soft(
      answer.toLowerCase(),
      "CAPABILITY: Q remembers an earlier turn across a refresh",
    )
    .toContain("obiageli");

  const runs = await runsFor(email, since);
  const conversations = new Set(runs.map((r) => r.conversation_id));
  expect(
    conversations.size,
    `CAPABILITY: both turns belong to one conversation (${JSON.stringify(runs)})`,
  ).toBe(1);
});

test.skip("D6 voice barge-in and voice proactivity — DEFERRED TO DEPLOYED (live audio)", () => {
  // Needs a public URL the speech provider can reach. The API suite's
  // run-cancel property is the local analogue of an interruption.
});
