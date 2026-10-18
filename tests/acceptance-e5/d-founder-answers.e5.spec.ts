import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * Walkthrough F8/H2/H3 and the deck, re-run on the E5 stack (CQ-QX-007).
 * One Home conversation, the exact words the person used, and what they
 * see after each turn.
 */
const STATE_DIR = resolve(import.meta.dirname, "../../.playwright/e5");
test.use({ storageState: `${STATE_DIR}/founder-state.json` });

async function say(page: Page, text: string, shot: string): Promise<string> {
  const composer = page.getByPlaceholder("Or type to Q");
  await expect(composer).toBeEnabled({ timeout: 240_000 });
  const before = await page.locator('[data-q-answer="settled"]').count();
  await composer.fill(text);
  await composer.press("Enter");
  await expect(page.locator('[data-q-answer="settled"]')).toHaveCount(
    before + 1,
    { timeout: 300_000 },
  );
  await expect(composer).toBeEnabled({ timeout: 240_000 });
  await page.waitForTimeout(1_500);
  const answers = page.locator("[data-q-answer]");
  const text_ = await answers.nth(before).innerText();
  // Everything Q showed for this turn (a narration may follow the answer).
  const all = (await answers.allInnerTexts()).slice(before).join("\n---\n");
  await page.screenshot({ path: `${STATE_DIR}/${shot}.png`, fullPage: true });
  console.log(`\n=== ${text}\n${all}\n===`);
  return text_.length > 0 ? all : text_;
}

test("F1, H2, H3 and the deck", async ({ page }) => {
  await page.goto("/home");
  const f8 = await say(
    page,
    "remind me, who's our biggest customer and what share of our loads do they move?",
    "f8-provenance",
  );
  expect(f8).toContain("Mombasa Grain Millers");
  expect(f8).toMatch(/Sources?: [^\n]*kivu-one-pager/i);
  expect(f8).not.toMatch(/holds no authorised understanding of customers/i);
  expect(f8).not.toMatch(/\(F\d+\)|\bF\d+\b/);

  const h2 = await say(
    page,
    "quick correction, our monthly GMV in august was actually 380k, the 412 in the one-pager was a typo. so what's our GMV?",
    "h2-correction",
  );
  expect(h2).toMatch(/380/);

  const h3 = await say(
    page,
    "uh when would we be ready for a series eh, and the, the other thing investors always ask, the burn thing, do we even have that on file",
    "h3-next-turn",
  );
  // The corrected figure governs; the document's is never quoted as current.
  for (const sentence of h3.split(/(?<=[.!?])\s+/)) {
    if (/412/.test(sentence)) {
      expect(sentence).toMatch(/one-pager|document|deck|says/i);
    }
  }
  expect(h3).not.toMatch(/\(F\d+\)|\bF\d+\b/);

  const deck = await say(
    page,
    "ok, can you put together my investor deck now?",
    "deck-request",
  );
  expect(deck).toMatch(/investor deck/i);
  expect(deck).not.toMatch(
    /I have prepared|I am preparing|ready for your approval/i,
  );
  console.log("CONVERSATION URL", page.url());
});
