/** Real H1 browser acceptance; existing authorized sessions only.
 * Reads scoped data and uses native navigation. No CRM mutations or provider calls.
 * Private screenshots/HTML remain in a mode-700 temporary directory.
 */
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const web = process.env.CQ_HUB_WEB_URL ?? "http://127.0.0.1:3000";
const publicKey = readFileSync(
  process.env.CQ_HUB_PUBLIC_KEY_FILE,
  "utf8",
).trim();
const { createServerClient } = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
)("@supabase/ssr");
const evidence = mkdtempSync(join(tmpdir(), "cq-hub-acceptance-"));
const browser = await chromium.launch({
  executablePath: process.env.CQ_HUB_CHROMIUM_PATH ?? "/usr/bin/chromium",
  proxy: { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" },
  args: ["--no-sandbox"],
});
try {
  for (const [role, file, heading, gateq] of [
    [
      "investor",
      process.env.CQ_HUB_INVESTOR_SESSION_FILE,
      "Investment Hub",
      "Investment inbox",
    ],
    [
      "founder",
      process.env.CQ_HUB_FOUNDER_SESSION_FILE,
      "Fundraising Hub",
      "My applications",
    ],
  ]) {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    const cookies = new Map();
    const client = createServerClient(
      "https://vcohxiqsmnkzxnvawgri.supabase.co",
      publicKey,
      {
        cookieOptions: {
          secure: web.startsWith("https:"),
          httpOnly: true,
          path: "/",
          sameSite: "lax",
        },
        cookies: {
          getAll: () => [...cookies.values()],
          setAll: (items) => {
            for (const item of items) cookies.set(item.name, item);
          },
        },
      },
    );
    const signed = await client.auth.setSession({
      access_token: saved.access_token,
      refresh_token: saved.refresh_token,
    });
    if (signed.error) throw new Error(`${role}: authorized session refused`);
    // Preserve refreshed credentials privately, never in evidence or console.
    if (signed.data.session)
      writeFileSync(file, JSON.stringify(signed.data.session), { mode: 0o600 });
    for (const [size, viewport] of [
      ["desktop", { width: 1440, height: 960 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      const context = await browser.newContext({
        viewport,
        ignoreHTTPSErrors: false,
      });
      await context.addCookies(
        [...cookies.values()].map((c) => ({
          name: c.name,
          value: c.value,
          domain: new URL(web).hostname,
          path: "/",
          httpOnly: true,
          secure: web.startsWith("https:"),
          sameSite: "Lax",
        })),
      );
      await context.addInitScript(() =>
        sessionStorage.setItem("cq.splash.seen", "1"),
      );
      const page = await context.newPage();
      const started = performance.now();
      const response = await page.goto(`${web}/relationships?view=overview`, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });
      await page
        .getByRole("heading", { name: heading, exact: true })
        .waitFor({ timeout: 60000 })
        .catch(async () => {
          await page.screenshot({
            path: join(evidence, `${role}-${size}-failure.png`),
            fullPage: true,
          });
          writeFileSync(
            join(evidence, `${role}-${size}-failure.html`),
            await page.content(),
            { mode: 0o600 },
          );
          throw new Error(
            `${role}/${size}: expected role heading missing at ${new URL(page.url()).pathname}; private evidence ${evidence}`,
          );
        });
      const nav = page.getByRole("navigation", {
        // The Hub's strip is named CRM since 2026-10-15; older revisions say Relationship Hub.
        name: /^(?:CRM|Relationship Hub)$/u,
      });
      await nav.getByRole("link", { name: gateq, exact: true }).waitFor();
      async function closeBriefing() {
        const close = page.getByRole("button", {
          name: "Close Q's briefing",
          exact: true,
        });
        if (await close.isVisible()) await close.click();
      }
      await closeBriefing();
      if (
        await page.getByText("Overview couldn't load", { exact: true }).count()
      )
        throw new Error(`${role}/${size}: scoped overview unavailable`);
      if (
        await nav
          .getByRole("link", {
            name: role === "investor" ? "My applications" : "Investment inbox",
            exact: true,
          })
          .count()
      )
        throw new Error(`${role}/${size}: wrong role control`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      if (overflow) throw new Error(`${role}/${size}: horizontal overflow`);
      await page.screenshot({
        path: join(evidence, `${role}-${size}-overview.png`),
        fullPage: true,
      });
      await closeBriefing();
      await nav.getByRole("link", { name: "Pipeline", exact: true }).click();
      await page.waitForURL(/view=pipeline/, { timeout: 45000 });
      if (
        (await nav
          .getByRole("link", { name: "Pipeline", exact: true })
          .getAttribute("aria-current")) !== "page"
      )
        throw new Error(`${role}/${size}: tab not settled`);
      await closeBriefing();
      await nav.getByRole("link", { name: "Overview", exact: true }).click();
      await page.waitForURL(/view=overview/, { timeout: 45000 });
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      await closeBriefing();
      await nav.getByRole("link", { name: "Q Work", exact: true }).click();
      await page.waitForURL(/\/work(?:\?|$)/, { timeout: 45000 });
      await page.locator("main").waitFor();
      await page.goBack();
      await page
        .getByRole("heading", { name: heading, exact: true })
        .waitFor({ timeout: 45000 });
      let qNavigation = null;
      if (process.env.CQ_HUB_VERIFY_Q === "1" && size === "desktop") {
        await nav.getByRole("link", { name: "Pipeline", exact: true }).click();
        await page.waitForURL(/view=pipeline/, { timeout: 45000 });
        await page.evaluate(() => {
          window.__cqHubNavigation = [];
          window.__cqHubNavigationReceipts = [];
          window.addEventListener("cq:navigation-receipt", (event) =>
            window.__cqHubNavigationReceipts.push(event.detail),
          );
          window.addEventListener("cq:fast-navigation", (event) =>
            window.__cqHubNavigation.push(event.detail),
          );
        });
        const input = page.getByPlaceholder("Ask Q", { exact: true });
        if (!(await input.isVisible()))
          await page.locator("[data-q-dock-button]:visible").first().click();
        await input.waitFor({ timeout: 30000 });
        const qStarted = performance.now();
        await input.fill(
          role === "investor" ? "Open investment hub" : "Open fundraising hub",
        );
        await input.press("Enter");
        await page.waitForURL(/view=overview/, { timeout: 45000 });
        // Q's modal intentionally hides background landmarks from accessibility.
        // Close via Escape before asserting the newly opened page's heading.
        await page.keyboard.press("Escape");
        await page
          .getByRole("heading", { name: heading, exact: true })
          .waitFor({ timeout: 45000 });
        const timings = await page.evaluate(() => window.__cqHubNavigation);
        if (!timings.some((t) => t.path === "/relationships?view=overview"))
          throw new Error(`${role}: Q navigation timing evidence missing`);
        const receipts = await page.evaluate(
          () => window.__cqHubNavigationReceipts,
        );
        if (
          !receipts.some(
            (r) =>
              r.status === "DONE" &&
              r.expected === "/relationships?view=overview",
          )
        )
          throw new Error(`${role}: completed navigation receipt missing`);
        qNavigation = {
          receiptDone: true,
          finalWordsToPushMs: timings.at(-1).ms,
          settledHeadingMs: Math.round(performance.now() - qStarted),
        };
      }
      console.log(
        JSON.stringify({
          role,
          size,
          qNavigation,
          http: response.status(),
          overviewAndRoleControls: true,
          nativeTabsAndWorkReturn: true,
          overflow,
          elapsedMs: Math.round(performance.now() - started),
        }),
      );
      await context.close();
    }
  }
  console.log(
    JSON.stringify({
      result: "PASS",
      scope:
        process.env.CQ_HUB_VERIFY_Q === "1"
          ? "H1 native role-aware overview/navigation and desktop typed Q fast navigation; voice not asserted"
          : "H1 native role-aware overview/navigation; Q spoken or typed execution not yet asserted",
      privateEvidence: evidence,
    }),
  );
} finally {
  await browser.close();
}
