import { expect, test, type Page } from "@playwright/test";

/**
 * Mobile-first shell journey at 390 × 844 with touch. This is the canonical
 * Capital Q experience, verified first.
 */

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test.describe("mobile application shell", () => {
  test("Home loads with bottom navigation, no sidebar, and a focusable Q composer", async ({
    page,
  }) => {
    await page.goto("/home");
    await expect(
      page.getByRole("heading", { name: "Home", level: 1 }),
    ).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(4);
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // The desktop sidebar is not in the accessibility tree on a phone.
    await expect(page.getByRole("complementary")).toHaveCount(0);

    const composer = page.getByRole("textbox", { name: "Ask Q" });
    await expect(composer).toBeVisible();
    await composer.focus();
    await expect(composer).toBeFocused();

    // Bottom navigation reserves real space rather than covering content.
    const geometry = await page.evaluate(() => {
      const main = document.querySelector("main");
      // Both navigations share the Primary label; only the mobile one is laid out.
      const bottomNav = [
        ...document.querySelectorAll('nav[aria-label="Primary"]'),
      ].find((element) => element.getBoundingClientRect().height > 0);
      if (main === null || bottomNav === undefined) {
        return null;
      }
      return {
        mainPaddingBottom: Number.parseFloat(
          getComputedStyle(main).paddingBottom,
        ),
        navHeight: bottomNav.getBoundingClientRect().height,
        navTop: bottomNav.getBoundingClientRect().top,
        viewport: window.innerHeight,
      };
    });
    expect(geometry).not.toBeNull();
    expect(geometry?.mainPaddingBottom ?? 0).toBeGreaterThanOrEqual(
      geometry?.navHeight ?? 1,
    );
    expect(geometry?.navTop ?? 0).toBeGreaterThan(
      (geometry?.viewport ?? 0) - 120,
    );

    // Every tab is a comfortable touch target.
    for (const name of ["Home", "Discover", "Capital", "Profile"]) {
      const box = await nav.getByRole("link", { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }

    await expectNoHorizontalOverflow(page);
  });

  test("navigates Home → Discover → Capital → Profile → Home by tapping the tabs", async ({
    page,
  }) => {
    await page.goto("/home");
    const nav = page.getByRole("navigation", { name: "Primary" });

    await nav.getByRole("link", { name: "Discover" }).tap();
    await expect(page).toHaveURL(/\/discover$/);
    await expect(
      page.getByRole("heading", { name: "Discover", level: 1 }),
    ).toBeVisible();
    await expect(nav.getByRole("link", { name: "Discover" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expectNoHorizontalOverflow(page);

    await nav.getByRole("link", { name: "Capital" }).tap();
    await expect(page).toHaveURL(/\/capital$/);
    await expect(
      page.getByRole("heading", { name: "Capital", level: 1 }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await nav.getByRole("link", { name: "Profile" }).tap();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(
      page.getByRole("heading", { name: "Profile", level: 1 }),
    ).toBeVisible();
    // The verified account, and no fabricated organisation.
    await expect(page.getByText(/@example\.invalid/)).toBeVisible();
    // The sidebar's chip is first in DOM order but hidden on a phone.
    await expect(
      page.getByText("No context set").filter({ visible: true }).first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await nav.getByRole("link", { name: "Home" }).tap();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("textbox", { name: "Ask Q" })).toBeVisible();
  });

  test("the Q composer takes keyboard input and never fabricates an answer", async ({
    page,
  }) => {
    await page.goto("/home");
    const composer = page.getByRole("textbox", { name: "Ask Q" });
    const send = page.getByRole("button", { name: "Send to Q" });
    await expect(send).toBeDisabled();

    await composer.fill("What should I prepare before a Series A?");
    await expect(send).toBeEnabled();
    await send.tap();

    await expect(
      page.getByRole("status").filter({ hasText: "Nothing was sent" }),
    ).toBeVisible();
    await expect(composer).toHaveValue(
      "What should I prepare before a Series A?",
    );
    await expect(page.getByText(/thinking|analysing|agent/i)).toHaveCount(0);
  });

  test("long context and headings wrap or truncate without horizontal overflow", async ({
    page,
  }) => {
    await page.goto("/home");
    await page.evaluate(() => {
      const chip = document.querySelector("header [data-scope] .truncate");
      if (chip !== null) {
        chip.textContent =
          "Relationship shared · Northwind Capital Partners International Holdings Limited";
      }
      const heading = document.querySelector("h1");
      if (heading !== null) {
        heading.textContent =
          "Home for a very long organisation name that keeps going and going";
      }
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const wordmark = await page
      .getByRole("banner")
      .getByRole("link", { name: "Capital Q" })
      .boundingBox();
    expect(wordmark?.height ?? 0).toBeLessThan(40);
  });

  test("keyboard users can reach the skip link, composer and navigation with visible focus", async ({
    page,
  }) => {
    await page.goto("/home");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await skip.press("Enter");

    await page.getByRole("textbox", { name: "Ask Q" }).focus();
    const outline = await page
      .getByRole("textbox", { name: "Ask Q" })
      .evaluate((element) => {
        const form = element.closest("form");
        return form === null ? "" : getComputedStyle(form).borderColor;
      });
    expect(outline).not.toBe("");

    const discover = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Discover" });
    await discover.focus();
    await expect(discover).toBeFocused();
    const focusRing = await discover.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    );
    expect(focusRing).not.toBe("none");
  });
});
