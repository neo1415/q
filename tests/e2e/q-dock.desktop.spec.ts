import { expect, test, type Page } from "@playwright/test";

/**
 * The Q Dock (ADR 0017 F1; spec §6, §15 UX-03): a floating Q on every
 * page but the Q page, movable by drag and by menu, remembered, never
 * over a focused control, and one conversation with the Q page.
 */

const dock = (page: Page) => page.locator("[data-q-dock] .cq-q-dock");
const dockButton = (page: Page) =>
  page.locator("[data-q-dock] [data-q-dock-button]");

async function placement(page: Page): Promise<string | null> {
  return dock(page).getAttribute("data-q-dock-placement");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Every test starts from the default anchor.
    if (sessionStorage.getItem("cq.e2e.dock-reset") === null) {
      localStorage.removeItem("cq.q-dock.v1");
      sessionStorage.removeItem("cq.q-dock.hidden");
      sessionStorage.setItem("cq.e2e.dock-reset", "1");
    }
  });
});

test("floats at the lower right as a 44 px target named for Q, and not on the Q page", async ({
  page,
}) => {
  await page.goto("/profile");
  const button = dockButton(page);
  await expect(button).toBeVisible();
  await expect(button).toHaveAccessibleName(/^Q, /);
  const box = await button.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  const viewport = page.viewportSize();
  expect(box?.x ?? 0).toBeGreaterThan((viewport?.width ?? 0) * 0.8);
  expect(box?.y ?? 0).toBeGreaterThan((viewport?.height ?? 0) * 0.8);

  await page.goto("/home");
  await expect(page.locator("[data-q-dock]")).toHaveCount(0);
});

test("moves by the keyboard menu, without dragging, and remembers it", async ({
  page,
}) => {
  await page.goto("/profile");
  await expect(dockButton(page)).toBeVisible();
  await dockButton(page).focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Move to top" }).click();
  await expect.poll(() => placement(page)).toBe("right-top");
  await dockButton(page).focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Move to the other side" }).click();
  await expect.poll(() => placement(page)).toBe("left-top");
  const box = await dockButton(page).boundingBox();
  // Clear of the sidebar.
  expect(box?.x ?? 0).toBeGreaterThan(240);

  await page.reload();
  await expect.poll(() => placement(page)).toBe("left-top");
});

test("snaps a drag to the nearest anchor", async ({ page }) => {
  await page.goto("/profile");
  const button = dockButton(page);
  await expect(button).toBeVisible();
  // Drag arrives with Motion's features, loaded after the dock paints.
  await expect(dock(page)).toHaveAttribute("data-q-dock-draggable", "");
  const box = await button.boundingBox();
  if (box === null) throw new Error("no dock");
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  await page.mouse.move(box.x + 22, box.y + 22);
  await page.mouse.down();
  // Slowly, so it is a placement and not a throw.
  const steps = 20;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      box.x + 22 + ((viewport.width * 0.35 - box.x) * i) / steps,
      box.y + 22 + ((viewport.height * 0.5 - box.y) * i) / steps,
    );
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect.poll(() => placement(page)).toBe("left-middle");
  // The drag did not also open the panel.
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("never hides a focused control on the routes it floats over", async ({
  page,
}) => {
  test.setTimeout(180_000);
  for (const route of [
    "/profile",
    "/discover",
    "/capital",
    "/company/visibility",
    "/verification",
    "/pitch",
    "/company/interest",
    "/welcome",
  ]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    if ((await page.locator("[data-q-dock]").count()) === 0) continue;
    await expect(dockButton(page)).toBeVisible();
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      const hidden = await page.evaluate(() => {
        const focused = document.activeElement;
        const dockBox = document
          .querySelector("[data-q-dock] .cq-q-dock")
          ?.getBoundingClientRect();
        if (
          focused === null ||
          focused === document.body ||
          dockBox === undefined ||
          focused.closest("[data-q-dock]") !== null
        ) {
          return null;
        }
        const r = focused.getBoundingClientRect();
        const covered =
          r.width > 0 &&
          r.left >= dockBox.left &&
          r.right <= dockBox.right &&
          r.top >= dockBox.top &&
          r.bottom <= dockBox.bottom;
        return covered ? focused.outerHTML.slice(0, 120) : null;
      });
      expect(hidden, `${route}: focus hidden behind the dock`).toBeNull();
    }
  }
});

/** The server actions a page makes as it loads, by action id. */
async function actionsOn(page: Page, url: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const listen = (request: import("@playwright/test").Request) => {
    const id = request.headers()["next-action"];
    if (request.method() === "POST" && id !== undefined) ids.add(id);
  };
  page.on("request", listen);
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  page.off("request", listen);
  return ids;
}

test("hands the conversation to the Q page with no second read", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  // Count the view transitions React starts, and which named groups each
  // one animates: the hand-off should morph the aperture ("q-aperture").
  await page.addInitScript(() => {
    const record = { starts: 0, groups: [] as string[] };
    Reflect.set(window, "__vt", record);
    const start = Reflect.get(document, "startViewTransition") as unknown;
    if (typeof start !== "function") return;
    Reflect.set(document, "startViewTransition", (...args: unknown[]) => {
      record.starts += 1;
      const transition = Reflect.apply(start, document, args) as {
        ready: Promise<void>;
      };
      void transition.ready.then(() => {
        for (const animation of document.getAnimations()) {
          const effect = animation.effect as KeyframeEffect | null;
          const pseudo = effect?.pseudoElement ?? "";
          if (pseudo.includes("q-aperture")) record.groups.push(pseudo);
        }
      });
      return transition;
    });
  });
  await page.goto("/profile");
  await dockButton(page).click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  const composer = panel.getByRole("textbox", { name: "Ask Q" });
  await composer.fill("Say hello in one short sentence.");
  await composer.press("Enter");
  // The server names the conversation as the run is accepted.
  const open = panel.locator("[data-q-open-page]");
  await expect(open).toHaveAttribute("href", /\/home\?c=/, {
    timeout: 60_000,
  });
  const href = (await open.getAttribute("href")) ?? "";

  // Which server action reads a conversation: the one a fresh load of the
  // Q page makes that a fresh load of another page does not.
  const probe = await context.newPage();
  const onProfile = await actionsOn(probe, "/profile");
  const onQPage = await actionsOn(probe, href);
  await probe.close();
  const reads = [...onQPage].filter((id) => !onProfile.has(id));
  expect(reads.length).toBeGreaterThan(0);

  const during: string[] = [];
  page.on("request", (request) => {
    const id = request.headers()["next-action"];
    if (request.method() === "POST" && id !== undefined) during.push(id);
  });
  await open.click();
  await expect(page).toHaveURL(href);
  await expect(page.locator("[data-q-stage]")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(2000);
  expect(during.filter((id) => reads.includes(id))).toEqual([]);
  // ...and the aperture moved as one object into the stage.
  const vt = await page.evaluate(() => {
    const record: unknown = Reflect.get(window, "__vt");
    const starts: unknown = Reflect.get(Object(record), "starts");
    const groups: unknown = Reflect.get(Object(record), "groups");
    return {
      starts: typeof starts === "number" ? starts : 0,
      groups: Array.isArray(groups)
        ? groups.filter((group): group is string => typeof group === "string")
        : [],
    };
  });
  expect(vt.starts).toBeGreaterThan(0);
  expect(vt.groups.some((group) => group.includes("q-aperture"))).toBe(true);
  // What the panel held is on the page.
  await expect(page.locator("[data-q-workspace]")).not.toHaveAttribute(
    "data-q-turns",
    "0",
  );
});
