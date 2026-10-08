// Screenshots of the built Q presence room on the dev harnesses
// (/dev/briefing?variant=room and /dev/presence, fictional data). Start
// the built web app with CQ_DEV_PREVIEW=1 on PORT (default 3111), then:
//   node built-shots.mjs
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = require(
  require.resolve("playwright", {
    paths: [
      ...(process.env.NODE_PATH ?? "").split(":").filter(Boolean),
      join(
        here,
        "../../../../node_modules/.pnpm/playwright@1.62.1/node_modules",
      ),
    ],
  }),
);

const out = join(here, "built");
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${process.env.PORT ?? "3111"}`;
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const devices = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
};
const arcwell = "00000000-0000-4000-8000-000000000002";
for (const [device, viewport] of Object.entries(devices)) {
  for (const theme of ["light", "dark"]) {
    const shoot = async (name, url, act) => {
      const context = await browser.newContext({
        viewport,
        colorScheme: theme,
      });
      const page = await context.newPage();
      await page.goto(`${base}${url}`);
      await page.waitForTimeout(800);
      // The app's splash: skipped, as a person would.
      const skip = page.getByText("Tap to skip");
      if (await skip.isVisible().catch(() => false)) {
        await skip.click();
        await page.waitForTimeout(1200);
      }
      if (act !== undefined) await act(page);
      await page.waitForTimeout(500);
      await page.screenshot({
        path: join(out, `${name}-${device}-${theme}.png`),
        fullPage: name !== "dock",
      });
      await context.close();
    };
    await shoot("room", "/dev/briefing?variant=room");
    await shoot("held", "/dev/briefing?variant=room", async (page) => {
      await page.locator(`[data-arrival-line="${arcwell}"]`).click();
    });
    await shoot("held-confirm", "/dev/briefing?variant=room", async (page) => {
      await page.locator(`[data-arrival-line="${arcwell}"]`).click();
      await page.getByRole("button", { name: "Send as is" }).click();
    });
    await shoot("command", "/dev/briefing?variant=room", async (page) => {
      await page
        .locator("#arrival-command")
        .fill("send the Tensorgate one but make it warmer");
      await page.getByRole("button", { name: "Do it" }).click();
    });
    await shoot("dock", "/dev/briefing?variant=dock");
    await shoot("speaking", "/dev/presence?state=SPEAKING&stage=1");
  }
}
await browser.close();
