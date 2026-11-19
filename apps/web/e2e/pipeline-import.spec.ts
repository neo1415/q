import { expect, test, type Page } from "@playwright/test";

/**
 * Decision 106, the CRM import, in a real browser over the
 * `/dev/pipeline-import` harness (fictional data, in-memory ops; nothing
 * reaches the API, storage or a model): upload a file, see Q's column
 * mapping and change it, read again, resolve an ambiguous row, approve,
 * and land on the result with links. Phone and desktop projects both run
 * every check. With CQ_SHOTS_DIR set, each step also leaves a screenshot
 * there at device scale 2.
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
  await page.screenshot({
    path: `${SHOTS}/${project}-${name}.png`,
    fullPage,
  });
}

const CSV = [
  "Organization,Domain,Status,Owners,Deal Source,Ticket,Currency,Priority,Notes,Fund",
  "Northwind Logistics,northwind.example,Deep dive,Ada Obi,Warm intro,500000,USD,High,,Fund I",
].join("\n");

test("upload, map, preview and approve an imported pipeline", async ({
  page,
}) => {
  await page.goto("/dev/pipeline-import");
  const screen = page.locator("[data-import-step]").first();
  await expect(screen).toHaveAttribute("data-import-step", "file");
  await expect(page.getByText("Choose a CSV or Excel file")).toBeVisible();
  await shot(page, "import-1-file");

  // Upload: the file goes through the harness's in-memory upload.
  await page.locator("[data-import-file]").setInputFiles({
    name: "affinity-deal-pipeline.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV),
  });
  // The safety check runs first, then Q's proposal.
  await expect(page.locator("[data-import-step=review]")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator("[data-import-counts]")).toContainText("4");
  await expect(
    page.getByText(
      "Q matched your columns to Capital Q's fields. Change any that look wrong.",
    ),
  ).toBeVisible();
  await shot(page, "import-2-review", true);

  // Map: Q left "Fund" unmapped; the person maps it to Tags, which means
  // the file must be read again before it can be approved.
  const fund = page.getByLabel("Fund", { exact: true });
  await expect(fund).toHaveValue("");
  await fund.selectOption("tags");
  const approve = page.locator("[data-import-approve-button]");
  await expect(approve).toBeDisabled();
  await page.locator("[data-import-columns]").scrollIntoViewIfNeeded();
  await shot(page, "import-3-mapping");
  await page.locator("[data-import-read-again]").click();
  await expect(
    page.getByText("Read with the columns you chose."),
  ).toBeVisible();
  await expect(approve).toBeEnabled();

  // Preview: the rows by match. An ambiguous row needs a choice.
  await expect(page.locator("[data-import-group=ambiguous]")).toBeVisible();
  // Fictional names show without their marker on screen.
  await page.getByLabel(/^Atlas Robotics Inc/u).check();
  await page.getByRole("radio", { name: /^Kept private/u }).click();
  await expect(page.locator("[data-import-group=new]")).toContainText(
    "Harmattan Foods",
  );
  await page.getByRole("radio", { name: /^Can't import/u }).click();
  await expect(page.locator("[data-import-group=invalid]")).toContainText(
    "This row has no company name.",
  );
  await page.locator("[data-import-approve]").scrollIntoViewIfNeeded();
  await shot(page, "import-4-preview");

  // Approve: the exact proposal, with the person's choice.
  await approve.click();
  await expect(page.locator("[data-import-step=done]")).toBeVisible({
    timeout: 15_000,
  });
  const sent = await page.evaluate(
    () =>
      (window as { __importHarness?: Record<string, unknown> })
        .__importHarness ?? null,
  );
  expect(sent).toMatchObject({
    proposalHash: "b".repeat(64),
    resolutions: [{ rowNumber: 5 }],
  });
  await expect(page.locator("[data-import-result]")).toContainText("5");
  const links = page.locator("[data-import-links] a");
  await expect(links).toHaveCount(5);
  await expect(links.first()).toHaveAttribute(
    "href",
    /^\/relationships\/company\//u,
  );
  await shot(page, "import-5-done", true);
});

test("the private prospects and a record's own pipeline fields", async ({
  page,
}) => {
  await page.goto("/dev/pipeline-import");
  await expect(page.locator("[data-prospects] [data-prospect]")).toHaveCount(2);
  await page.locator("#prospects").scrollIntoViewIfNeeded();
  await shot(page, "prospects");

  const card = page.locator("[data-side-details]");
  await expect(card).toContainText("USD 500,000");
  await page.locator("[data-side-details-edit]").click();
  const form = page.locator("[data-side-details-form]");
  await form.getByLabel("Priority").selectOption("LOW");
  // Kwame Mensah (fixtures.ts), by the membership id the select carries.
  await form
    .getByLabel("Deal owner")
    .selectOption("00000000-0000-4000-8000-000000000302");
  await form.scrollIntoViewIfNeeded();
  await shot(page, "side-details-edit");
  await page.locator("[data-side-details-save]").click();
  await expect(page.locator("[data-side-details]")).toContainText(
    "Kwame Mensah",
  );
  const sent = await page.evaluate(
    () =>
      (window as { __sideHarness?: Record<string, unknown> }).__sideHarness ??
      null,
  );
  expect(sent).toMatchObject({ revision: 3, priority: "LOW" });
  await page.locator("[data-side-details]").scrollIntoViewIfNeeded();
  await shot(page, "side-details");
});
