import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth";
import { installDeepgramFake } from "../support/deepgram-fake";
import { awaits } from "../support/expected-red";
import { ask, composer, expectLastTurnTerminal } from "../support/q";
import { answer, useScript, vendorMark, vendorRequestsSince } from "../support/script";
import { CAST } from "../support/stack";

/**
 * SPEC §5 Scenario G: voice → text → voice continuity. Something said by
 * voice is the context for a typed follow-up, and the typed turn is the
 * context for the next spoken one: one conversation, one history, whatever
 * the modality (B3, B6). Standard line, Deepgram faked at its socket.
 */
test("Scenario G: say it, type the follow-up, say the next: one conversation", async ({ browser }) => {
  awaits(["G-R2", "B3", "B6", "G-R3"], "no offline voice credential (G-R2); cross-modal references are B3/B6");
  const context = await contextAs(browser, CAST.founder);
  const page = await context.newPage();
  const line = await installDeepgramFake(page);
  await useScript([
    { name: "v1", when: { user: "Savanna Seed" }, reply: answer("Savanna Seed accepted your interest.") },
    { name: "t1", when: { user: "what did they invest in" }, reply: answer("They invest at seed in fintech.") },
    { name: "v2", when: { user: "draft them a thank you" }, reply: answer("I can draft that for Savanna Seed.") },
  ]);
  await page.goto("/home");
  await page.getByRole("button", { name: /Talk with Q/u }).click();
  await expect.poll(() => line.settings() !== null, { timeout: 60_000 }).toBe(true);
  expect(line.frames(), "the fake microphone's audio reached the line").toBeGreaterThan(0);

  await line.say("Where are we with Savanna Seed?");
  await expect(page.getByText("Savanna Seed accepted your interest.")).toBeVisible();

  // Typed follow-up with a pronoun: the model must see the spoken turn.
  const mark = await vendorMark();
  await composer(page).fill("what did they invest in?");
  await composer(page).press("Enter");
  await expect(page.getByText("They invest at seed in fintech.")).toBeVisible();
  const typed = await vendorRequestsSince(mark);
  expect(typed.some((request) => (request.input ?? "").includes("Where are we with Savanna Seed?"))).toBe(true);

  // Spoken again: the model sees the typed turn.
  const mark2 = await vendorMark();
  await line.say("draft them a thank you");
  const spoken = await vendorRequestsSince(mark2);
  expect(spoken.some((request) => (request.input ?? "").includes("what did they invest in?"))).toBe(true);
  await expectLastTurnTerminal(page, ["ANSWERED", "ACTED"]);

  // One conversation: reload shows all three exchanges in order.
  await page.reload();
  const texts = await page.locator('[data-q-answer="settled"]').allInnerTexts();
  expect(texts.join("\n")).toMatch(/accepted your interest[\s\S]*seed in fintech[\s\S]*thank you/u);
  await context.close();
});

test("a typed turn while the line is up is heard by the same conversation", async ({ browser }) => {
  awaits(["G-R2"], "no offline voice credential");
  const context = await contextAs(browser, CAST.founder);
  const page = await context.newPage();
  await installDeepgramFake(page);
  await useScript([{ name: "typed", when: { user: "typed while talking" }, reply: answer("Got your typed note.") }]);
  await page.goto("/home");
  await page.getByRole("button", { name: /Talk with Q/u }).click();
  await expect(composer(page)).toHaveAttribute("placeholder", /Type instead/u, { timeout: 60_000 });
  await ask(page, "typed while talking");
  await context.close();
});
