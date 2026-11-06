import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * Q Workspace W3 in a real browser, over the `/dev/deep-links` harness's
 * fictional data: every new deep link round-trips (link → page → the
 * target element in view and marked), Q's move focuses the heading and
 * Back returns to the page before it, typing to Q is never interrupted,
 * and reduced motion marks without a fade. Nothing reaches the API, the
 * database or a provider. Screenshots go to CQ_E2E_SHOTS when it is set.
 */

const ITEM = "00000000-0000-4000-8000-0000000b0a2d";
const MESSAGE = "00000000-0000-4000-8000-00000000a5e5";
const COMPANY = "6f1d3c2a-4b5e-4f70-8a91-0b2c3d4e5f60";
const USE_OF_FUNDS = "00000000-0000-4000-8000-000000000102";

// A first load shows the brand splash over everything; a returning tab
// has seen it (as in rehearsal-video-tablet.spec.ts).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("cq.splash.seen", "1");
  });
});

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env["CQ_E2E_SHOTS"];
  if (dir === undefined) return;
  const width = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: join(dir, `${name}-${String(width)}.png`) });
}

async function inView(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await expect(target).toBeInViewport();
  await expect(target).toHaveAttribute("data-q-arrived", "");
}

test("a Board item link lands on that item", async ({ page }) => {
  await page.goto(`/dev/deep-links/board?item=${ITEM}`);
  await inView(page, `[data-board-item="${ITEM}"]`);
  await shot(page, "board-item");
});

test("a message link lands on that message", async ({ page }) => {
  await page.goto(`/dev/deep-links/thread?message=${MESSAGE}`);
  await inView(page, `[data-q-message="${MESSAGE}"]`);
  await shot(page, "thread-message");
});

test("a section link lands on that QSection, and #latest on the last entry", async ({
  page,
}) => {
  await page.goto("/dev/deep-links/sections#section-commitments");
  const heading = page.getByRole("heading", { name: "Commitments" });
  await expect(heading).toBeInViewport();
  await expect(
    page.locator('[data-q-section="commitments"] > section'),
  ).toHaveAttribute("data-q-arrived", "");
  await shot(page, "section");
  await page.goto("/dev/deep-links/thread#latest");
  await inView(page, "[data-q-message] >> nth=-1");
});

test("a data-room link opens that document in the viewer", async ({ page }) => {
  const opens: string[] = [];
  await page.route("**/dev/deep-links/dataroom**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") opens.push(request.postData() ?? "");
    await route.continue();
  });
  await page.goto(`/dev/deep-links/dataroom?tab=dataroom&doc=${USE_OF_FUNDS}`);
  // The open is the server action the Open button makes, for this id
  // (the harness has no session, so it answers that it cannot).
  await expect.poll(() => opens.join("\n")).toContain(USE_OF_FUNDS);
  expect(opens.join("\n")).toContain(COMPANY);
  expect(opens).toHaveLength(1);
  await shot(page, "dataroom-doc");
});

test("Q's move focuses the heading, and Back returns to the page before it", async ({
  page,
}) => {
  await page.goto("/dev/deep-links");
  await page.locator('[data-harness-q-move="thread"]').click();
  await expect(page).toHaveURL(new RegExp(`message=${MESSAGE}`));
  await inView(page, `[data-q-message="${MESSAGE}"]`);
  await expect(page.getByRole("heading", { name: "Messages" })).toBeFocused();
  const mark = await page.evaluate(() => {
    const state = window.history.state as { cqQMove?: { from?: string } };
    return state.cqQMove?.from ?? null;
  });
  expect(mark).toMatch(/\/dev\/deep-links$/u);
  await shot(page, "q-move");
  await page.goBack();
  await expect(page).toHaveURL(/\/dev\/deep-links$/u);
  await expect(page.locator("[data-harness-hub]")).toBeVisible();
});

test("while they type to Q, Q's move does not take their caret", async ({
  page,
}) => {
  await page.goto("/dev/deep-links");
  const composer = page.locator("[data-harness-composer]");
  // Clicking the move button takes focus; typing again is what matters.
  await page.locator('[data-harness-q-move="board"]').focus();
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>(
      '[data-harness-q-move="board"]',
    );
    button?.click();
    document
      .querySelector<HTMLTextAreaElement>("[data-harness-composer]")
      ?.focus();
  });
  await composer.pressSequentially("show me the");
  await expect(page).toHaveURL(new RegExp(`item=${ITEM}`));
  await expect(page.locator(`[data-board-item="${ITEM}"]`)).toBeVisible();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue("show me the");
  await expect(page.locator("[data-q-arrived]")).toHaveCount(0);
});

test.describe("reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("lands at once and marks without a fade", async ({ page }) => {
    await page.goto(`/dev/deep-links/board?item=${ITEM}`);
    const item = page.locator(`[data-board-item="${ITEM}"]`);
    await expect(item).toBeInViewport();
    await expect(item).toHaveAttribute("data-q-arrived", "");
    expect(
      await item.evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("none");
    await shot(page, "reduced-motion");
  });
});
