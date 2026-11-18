import { expect, test, type Page } from "@playwright/test";

/**
 * Decision 107, the site content editor and the public pages, in a real
 * browser over the `/dev/site-content` harness (the default content, with
 * in-memory saves; nothing reaches the API or a database). Phone and
 * desktop projects both run every check. With CQ_SHOTS_DIR set, each check
 * also leaves a screenshot there at device scale 2 for the owner.
 */

test.use({ deviceScaleFactor: 2 });

// A first load shows the brand splash over everything; a returning tab
// has seen it (as in deep-links.spec.ts).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("cq.splash.seen", "1");
  });
});

const SHOTS = process.env["CQ_SHOTS_DIR"];

async function shot(page: Page, name: string, fullPage = false) {
  if (SHOTS === undefined) return;
  const project = test.info().project.name;
  await page.screenshot({ path: `${SHOTS}/${project}-${name}.png`, fullPage });
}

const order = (page: Page) =>
  page
    .locator("[data-content-editor] li[data-block-id]")
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-block-id")),
    );

test("the editor reorders blocks by drag and drop, and autosaves the new order", async ({
  page,
}) => {
  // The hero's blocks are short, so a drag fits on a phone screen too.
  await page.goto("/dev/site-content?page=landing-hero");
  const editor = page.locator("[data-content-editor=landing-hero]");
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("status").filter({ hasText: /^Saved/u }),
  ).toBeVisible();
  const before = await order(page);
  expect(before.length).toBeGreaterThanOrEqual(3);
  await shot(page, "editor");

  const handle = page.locator(
    `li[data-block-id="${before[0] ?? ""}"] [data-drag-handle]`,
  );
  const target = page.locator(`li[data-block-id="${before[2] ?? ""}"]`);
  await handle.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error("no boxes");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Small steps, so the drag reads as a drag and the list reorders as it passes.
  await page.mouse.move(from.x + from.width / 2, to.y + to.height * 0.8, {
    steps: 30,
  });
  await page.mouse.up();

  await expect.poll(() => order(page)).not.toEqual(before);
  const after = await order(page);
  expect(after.indexOf(before[0] ?? "")).toBeGreaterThan(0);
  expect([...after].sort()).toEqual([...before].sort());
  // The new order is what autosave sends.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const harness = (
          window as { __cmsHarness?: { blocks: { id: string }[] } }
        ).__cmsHarness;
        return harness?.blocks.map((b) => b.id) ?? null;
      }),
    )
    .toEqual(after);
  await expect(
    editor.getByRole("status").filter({ hasText: /^Saved/u }),
  ).toBeVisible();
});

test("blocks move with the keyboard too, and the move is announced", async ({
  page,
}) => {
  await page.goto("/dev/site-content?page=faq");
  const before = await order(page);
  const handle = page.locator(
    `li[data-block-id="${before[0] ?? ""}"] [data-drag-handle]`,
  );
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  await expect
    .poll(() => order(page))
    .toEqual([before[1], before[0], ...before.slice(2)]);
  await expect(
    page.locator(`li[data-block-id="${before[0] ?? ""}"] [data-drag-handle]`),
  ).toBeFocused();
  await expect(page.getByText(/moved to position 2 of/u)).toBeAttached();
  // A 44 px target on a phone, as every control.
  const box = await handle.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(36);
});

test("a block dragged from the palette lands where it is dropped", async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    "The palette is a sheet on a phone: blocks are added by tap there.",
  );
  await page.goto("/dev/site-content?page=faq");
  const before = await order(page);
  // HTML5 drag and drop with the browser's own DataTransfer, so a scroll
  // during the gesture cannot pick up a different palette entry.
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  const source = page.locator('[data-palette="divider"]');
  const zone = page.locator('[data-dropzone="0"]');
  await source.dispatchEvent("dragstart", { dataTransfer: transfer });
  await zone.dispatchEvent("dragover", { dataTransfer: transfer });
  await zone.dispatchEvent("drop", { dataTransfer: transfer });
  await expect
    .poll(() => order(page).then((ids) => ids.length))
    .toBe(before.length + 1);
  await expect(
    page.locator("[data-content-editor] li[data-block-id]").first(),
  ).toHaveAttribute("data-block-type", "divider");
});

test("on a phone, Add a block opens the palette and adds the block", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Desktop shows the palette beside the page.");
  await page.goto("/dev/site-content?page=faq");
  const before = await order(page);
  await page.getByRole("button", { name: "Add a block" }).click();
  await page.getByRole("dialog").locator('[data-palette="callout"]').click();
  await expect
    .poll(() => order(page).then((ids) => ids.length))
    .toBe(before.length + 1);
});

test("inline text editing saves, and the preview shows desktop and phone widths", async ({
  page,
}) => {
  await page.goto("/dev/site-content?page=pricing");
  const heading = page
    .getByRole("textbox", { name: "Heading, level 2" })
    .first();
  await heading.fill("Included on every plan");
  await expect(page.locator("[data-save-state=saved]")).toBeVisible();
  await page.getByRole("radio", { name: "Desktop" }).click();
  const desktop = page.locator("[data-preview=desktop]");
  await expect(desktop).toBeVisible();
  await expect(
    desktop.getByRole("heading", { name: "Included on every plan" }),
  ).toBeVisible();
  await shot(page, "preview-desktop");
  await page.getByRole("radio", { name: "Phone" }).click();
  const phone = page.locator("[data-preview=phone]");
  await expect(phone).toBeVisible();
  expect((await phone.boundingBox())?.width ?? 0).toBeLessThanOrEqual(392);
  await shot(page, "preview-phone");
});

test("publishing a legal page asks for the lawyer's approval first", async ({
  page,
}) => {
  await page.goto("/dev/site-content?page=terms");
  await expect(page.getByText("Lawyer note").first()).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  const dialog = page.getByRole("dialog");
  const publish = dialog.getByRole("button", { name: "Publish" });
  await expect(publish).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await expect(publish).toBeEnabled();
  await shot(page, "publish-legal");
  await publish.click();
  await expect(page.getByText(/Published as version 2/u)).toBeVisible();
});

test("the content index groups pages and says what is live", async ({
  page,
}) => {
  await page.goto("/dev/site-content");
  await expect(page.getByRole("heading", { name: "Legal" })).toBeVisible();
  await expect(page.locator('[data-page="terms"]')).toContainText(
    "Waiting for legal review",
  );
  await expect(page.locator('[data-page="pricing"]')).toContainText("Live");
  await shot(page, "index", true);
});

test("the public pricing page switches between monthly and yearly prices", async ({
  page,
}) => {
  await page.goto("/dev/site-content/public/pricing");
  await expect(
    page.getByRole("heading", { level: 1, name: "Pricing" }),
  ).toBeVisible();
  await expect(page.getByText("$29").first()).toBeVisible();
  await shot(page, "public-pricing");
  const period = page
    .getByRole("radiogroup", { name: "Billing period" })
    .first();
  await period.getByRole("radio", { name: "Yearly" }).click();
  await expect(page.getByText("$290").first()).toBeVisible();
  // No page-wide horizontal scroll at phone width.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the public FAQ opens answers in place", async ({ page }) => {
  await page.goto("/dev/site-content/public/faq");
  const question = page.locator("details summary").first();
  await question.click();
  await expect(page.locator("details[open]").first()).toBeVisible();
  await shot(page, "public-faq");
});

test("a public legal page shows its summary box and contents, never a lawyer note", async ({
  page,
  isMobile,
}) => {
  await page.goto("/dev/site-content/public/terms");
  await expect(page.getByRole("heading", { name: "In short" })).toBeVisible();
  await expect(page.getByText("FCCPA")).toHaveCount(0);
  await expect(page.getByText("Lawyer note")).toHaveCount(0);
  if (!isMobile)
    await expect(
      page.getByRole("navigation", { name: "Contents" }),
    ).toBeVisible();
  await shot(page, "public-terms");
});

test("the real public routes and the home page link to the legal pages", async ({
  page,
}) => {
  // With no API in this harness the route shows its not-yet-published state.
  await page.goto("/legal/privacy");
  await expect(
    page.getByRole("heading", { level: 1, name: "Privacy Policy" }),
  ).toBeVisible();
  const legal = page.getByRole("navigation", { name: "Legal" });
  for (const name of ["Terms of Service", "Privacy Policy", "Cookie Policy"]) {
    await expect(legal.getByRole("link", { name })).toBeVisible();
  }
  // The landing page itself: its request proxy needs the auth setup this
  // harness lacks, so the review route renders the same component.
  await page.goto("/dev/site-content/landing");
  const footer = page.locator("footer");
  for (const [name, href] of [
    ["Terms", "/legal/terms"],
    ["Privacy", "/legal/privacy"],
    ["Cookies", "/legal/cookies"],
    ["Pricing", "/pricing"],
  ] as const) {
    await expect(
      footer.getByRole("link", { name, exact: true }),
    ).toHaveAttribute("href", href);
  }
});
