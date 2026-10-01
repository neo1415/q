import { expect, test, type Page } from "@playwright/test";

/**
 * Mobile-first shell journey at 390 × 844 with touch. This is the canonical
 * Capital Q experience, verified first.
 *
 * The session here is a new person who has not been onboarded, on a stack
 * with no Q API. Q's page is the onboarding interview until onboarding is
 * done (founder direction 2026-09-30), and without a Q API there is no
 * interview, so /home arrives in Discover. Q is then the floating dock
 * (ADR 0017 F1), whose sheet holds the composer.
 */

async function openQ(page: Page) {
  await page.getByRole("button", { name: /^Q, / }).tap();
  const sheet = page.getByRole("dialog", { name: "Q" });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

test.describe("mobile application shell", () => {
  test("home arrives in Discover with bottom navigation, no sidebar, and Q's composer one tap away", async ({
    page,
  }) => {
    await page.goto("/home");
    await expect(page).toHaveURL(/\/discover$/);
    await expect(
      page.getByRole("heading", { name: "Discover", level: 1 }),
    ).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(4);
    await expect(nav.getByRole("button", { name: "More" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Discover" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // The desktop sidebar is not in the accessibility tree on a phone; the
    // only complementary landmark is Q's dock.
    await expect(page.locator("[data-sidebar]")).toBeHidden();
    await expect(page.getByRole("complementary")).toHaveCount(1);
    await expect(
      page.getByRole("complementary", { name: "Q dock" }),
    ).toBeVisible();

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
    for (const name of ["Q", "Discover", "Capital", "Relationships"]) {
      const box = await nav.getByRole("link", { name }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    const more = await nav.getByRole("button", { name: "More" }).boundingBox();
    expect(more?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(more?.width ?? 0).toBeGreaterThanOrEqual(44);

    await expectNoHorizontalOverflow(page);

    const composer = (await openQ(page)).getByRole("textbox", {
      name: "Ask Q",
    });
    await expect(composer).toBeVisible();
    await composer.focus();
    await expect(composer).toBeFocused();
  });

  test("navigates Q → Discover → Capital → Profile → Q by tapping the tabs", async ({
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

    await nav.getByRole("button", { name: "More" }).tap();
    await page
      .getByRole("navigation", { name: "More sections" })
      .getByRole("link", { name: "Profile" })
      .tap();
    await expect(page).toHaveURL(/\/profile$/);
    // The page is headed by the person: here, their verified account, and
    // no fabricated organisation.
    await expect(
      page.getByRole("heading", { name: /@example\.invalid/, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Company or investor organisation" }),
    ).toContainText("You haven't set one up yet");
    // The context is shown in the phone's header, as its compact chip.
    await expect(
      page.getByRole("banner").getByRole("img", { name: "No context set" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await nav.getByRole("link", { name: "Q" }).tap();
    // Not onboarded and no Q API: Q's page arrives in Discover again, and
    // Q is the dock.
    await expect(page).toHaveURL(/\/discover$/);
    await expect(
      page.getByRole("complementary", { name: "Q dock" }),
    ).toBeVisible();
  });

  test("the Q composer takes keyboard input and, with no Q to answer, says so and never fabricates an answer", async ({
    page,
  }) => {
    await page.goto("/discover");
    const sheet = await openQ(page);
    const composer = sheet.getByRole("textbox", { name: "Ask Q" });
    const send = sheet.getByRole("button", { name: "Send to Q" });
    await expect(send).toBeDisabled();

    await composer.fill("What should I prepare before a Series A?");
    await expect(send).toBeEnabled();
    await send.tap();

    // Nothing reached Q, so it is said plainly and the question is kept.
    await expect(sheet.getByRole("status").last()).toContainText(
      "Nothing was sent",
    );
    await expect(composer).toHaveValue(
      "What should I prepare before a Series A?",
    );
    // No canned reply, and no answer rendered from nowhere.
    await expect(page.locator("[data-q-answer]")).toHaveCount(0);
    await expect(page.getByText(/agent|thinking\.\.\./i)).toHaveCount(0);
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
    });
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
    await page.goto("/discover");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await skip.press("Enter");

    // Control+K opens Q from anywhere (the dock's own hint).
    await page.keyboard.press("Control+K");
    const sheet = page.getByRole("dialog", { name: "Q" });
    const composer = sheet.getByRole("textbox", { name: "Ask Q" });
    await composer.focus();
    await expect(composer).toBeFocused();
    const outline = await composer.evaluate((element) => {
      const form = element.closest("form");
      return form === null ? "" : getComputedStyle(form).borderColor;
    });
    expect(outline).not.toBe("");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

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
