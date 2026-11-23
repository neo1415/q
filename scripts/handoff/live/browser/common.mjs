// Shared browser setup for the live checks in this folder. Fictional accounts only
// (*@fictional.capitalq.local); the password comes from CQ_SEED_ACCOUNT_PASSWORD and is never printed.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

export const WEB =
  process.env.CQ_WEB ?? "https://capital-qweb-production.up.railway.app";
export const OUT = process.env.OUT ?? join(tmpdir(), "cq-live");

export async function openBrowser(profileName, { scale = 1 } = {}) {
  const require = createRequire(
    new URL("../../../../package.json", import.meta.url),
  );
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    ({ chromium } = await import("playwright"));
  }
  const ctx = await chromium.launchPersistentContext(
    join(OUT, `profile-${profileName}`),
    {
      executablePath: process.env.CQ_CHROMIUM ?? "/opt/pw-browsers/chromium",
      ...(process.env.HTTPS_PROXY
        ? { proxy: { server: process.env.HTTPS_PROXY } }
        : {}),
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: scale,
    },
  );
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem("cq.splash.seen", "1");
    } catch {
      // storage blocked: the splash shows once, harmless
    }
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { ctx, page };
}

export async function signIn(page, email) {
  if (!email.endsWith("@fictional.capitalq.local"))
    throw new Error("fictional accounts only");
  if (!process.env.CQ_SEED_ACCOUNT_PASSWORD)
    throw new Error("set CQ_SEED_ACCOUNT_PASSWORD");
  await page.goto(`${WEB}/auth/sign-in`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(2000);
  if (!new URL(page.url()).pathname.includes("sign-in")) return;
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", process.env.CQ_SEED_ACCOUNT_PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("sign-in"), {
      timeout: 60000,
      waitUntil: "commit",
    }),
    page.keyboard.press("Enter"),
  ]);
  await page.waitForTimeout(4000);
}
