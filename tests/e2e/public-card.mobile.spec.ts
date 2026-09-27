import { expect, test } from "@playwright/test";

/**
 * `/@handle` as someone who just scanned a Q Card (BIZ-004, R26): a phone,
 * no Capital Q session. The page says who this is and offers its three
 * actions inside the first screen, with comfortable targets, no sideways
 * scroll, and nothing members-only.
 *
 * The local stack seeds no Q Card, so the card journey runs against a
 * handle created beforehand (profile -> Q Card -> Create), named by
 * CQ_E2E_CARD_HANDLE; without it only the not-found path runs.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const HANDLE = process.env.CQ_E2E_CARD_HANDLE;

test("an unknown handle is one plain not-found, never indexed", async ({
  page,
}) => {
  const response = await page.goto("/@no-such-card-e2e");
  expect(response?.status()).toBe(404);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});

test.describe("a scanned card", () => {
  test.skip(HANDLE === undefined, "set CQ_E2E_CARD_HANDLE to a live card");

  test("who, and what to do, in the first screen", async ({ page }) => {
    await page.goto(`/@${HANDLE ?? ""}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();

    const actions = page.getByRole("region", { name: "Actions" });
    const save = actions.getByRole("link", { name: "Save contact" });
    const connect = actions.getByRole("link", {
      name: "Connect on Capital Q",
    });
    await expect(save).toBeInViewport();
    await expect(connect).toBeInViewport();
    await expect(connect).toHaveAttribute(
      "href",
      `/auth/sign-in?next=${encodeURIComponent(`/@${HANDLE ?? ""}`)}`,
    );
    for (const link of await actions.getByRole("link").all()) {
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // An anonymous visitor never sees a members-only field.
    await expect(page.locator('[data-scope="network_visible"]')).toHaveCount(0);
    await expect(page.getByText("Shown to Capital Q members")).toHaveCount(0);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("Save contact downloads a vCard", async ({ page }) => {
    await page.goto(`/@${HANDLE ?? ""}`);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Save contact" }).tap();
    expect((await download).suggestedFilename()).toBe(`${HANDLE ?? ""}.vcf`);
    const vcf = await page.request.get(`/@${HANDLE ?? ""}.vcf`);
    expect(vcf.headers()["content-type"]).toContain("text/vcard");
    expect(await vcf.text()).toContain("BEGIN:VCARD");
  });
});
