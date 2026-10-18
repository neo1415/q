import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Read-only capture of one company profile as an existing, authorized
 * FICTIONAL investor session (2026-10-12: verify the Tensorgate profile
 * as the investor sees it). Opens the page, waits for the fit panel and
 * Q's view, and writes a full-page screenshot plus the panel's text to a
 * fresh mode-700 temporary directory. It clicks nothing that acts: no
 * approvals, interest, requests or messages.
 *
 *   CQ_DEMO_SESSION_FILE=... CQ_DEMO_PUBLIC_KEY_FILE=... NODE_USE_ENV_PROXY=1 \
 *   node scripts/handoff/live/profile-capture.mjs <companyId>
 */
const companyId = process.argv[2];
const sessionFile = process.env.CQ_DEMO_SESSION_FILE;
const publicKeyFile = process.env.CQ_DEMO_PUBLIC_KEY_FILE;
if (!companyId || !sessionFile || !publicKeyFile)
  throw new Error(
    "usage: CQ_DEMO_SESSION_FILE, CQ_DEMO_PUBLIC_KEY_FILE, <companyId>",
  );
const webUrl =
  process.env.CQ_DEMO_WEB_URL ??
  "https://capital-qweb-production.up.railway.app";
const supabaseUrl =
  process.env.CQ_DEMO_SUPABASE_URL ??
  "https://vcohxiqsmnkzxnvawgri.supabase.co";
const out = mkdtempSync(join(tmpdir(), "cq-profile-"));

const { createServerClient } = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
)("@supabase/ssr");
const session = JSON.parse(readFileSync(sessionFile, "utf8"));
const cookies = new Map();
const client = createServerClient(
  supabaseUrl,
  readFileSync(publicKeyFile, "utf8").trim(),
  {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: true, path: "/" },
    cookies: {
      getAll: () => [...cookies.values()],
      setAll: (items) => {
        for (const item of items) cookies.set(item.name, item);
      },
    },
  },
);
const signed = await client.auth.setSession({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
});
if (signed.error) throw new Error("Existing authorized session refused");

const browser = await chromium.launch({
  ...(process.env.CQ_DEMO_CHROMIUM_PATH
    ? { executablePath: process.env.CQ_DEMO_CHROMIUM_PATH }
    : {}),
  proxy: { server: process.env.HTTPS_PROXY },
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: {
      width: Number(process.env.CQ_CAPTURE_WIDTH ?? 1300),
      height: 900,
    },
  });
  await context.addCookies(
    [...cookies.values()].map((c) => ({
      name: c.name,
      value: c.value,
      domain: new URL(webUrl).hostname,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    })),
  );
  await context.addInitScript(() =>
    sessionStorage.setItem("cq.splash.seen", "1"),
  );
  const page = await context.newPage();
  const started = Date.now();
  const response = await page.goto(
    new URL(`/company/${companyId}`, webUrl).href,
    { waitUntil: "domcontentloaded", timeout: 45_000 },
  );
  await page.locator("main").waitFor({ timeout: 30_000 });
  const fit = page.locator("[data-fit-panel]").first();
  await fit.waitFor({ timeout: 30_000 }).catch(() => undefined);
  await page
    .locator("[data-q-view]")
    .first()
    .waitFor({ timeout: 45_000 })
    .catch(() => undefined);
  const fitText = (await fit.isVisible())
    ? await fit.innerText()
    : "(no fit panel)";
  const mainText = await page.locator("main").innerText();
  await page.screenshot({ path: join(out, "profile.png"), fullPage: true });
  writeFileSync(join(out, "fit-panel.txt"), fitText);
  writeFileSync(join(out, "main.txt"), mainText);
  console.log(
    JSON.stringify({
      http: response?.status() ?? null,
      readyMs: Date.now() - started,
      mainWords: mainText.split(/\s+/u).filter(Boolean).length,
      out,
    }),
  );
  console.log(fitText);
} finally {
  await browser.close();
}
