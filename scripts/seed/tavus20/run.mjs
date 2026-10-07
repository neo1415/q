#!/usr/bin/env node
/* global process, console */
/**
 * Seeds the tavus-20 fictional companies into the deployed app through its
 * own UI (Playwright, one Chromium), as each founder and team member would.
 *
 *   SUPABASE_ACCESS_TOKEN=... NODE_USE_ENV_PROXY=1 \
 *     node scripts/seed/tavus20/run.mjs --only 2,3 [--steps stepPitch]
 *
 * Secrets: the Supabase keys are read from the management API into memory
 * only; passwords are random and never kept (sign-in uses one-time admin
 * magic-link tokens through the web's /auth/callback, which sends no email).
 * Idempotent: progress (ids only) lives in docs/seed/tavus-20/seed-state.json.
 * Model providers: none called by this script; the app calls what it calls.
 */
import * as lib from "./lib.mjs";
import { STEPS } from "./steps.mjs";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    "/home/user/q/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs"
);
const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const only = opt("--only")?.split(",").map(Number);
const steps = opt("--steps")?.split(",");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  proxy: { server: process.env.HTTPS_PROXY },
  args: ["--ignore-certificate-errors"],
});
const summary = [];
for (const c of lib.companies()) {
  if (only && !only.includes(c.n)) continue;
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1360, height: 900 },
  });
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem("cq.splash.seen", "1");
    } catch {}
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const failed = [];
  for (const step of STEPS) {
    if (steps && !steps.includes(step.name)) continue;
    try {
      await step(page, c);
    } catch (error) {
      const msg = String(error?.message ?? error)
        .split("\n")[0]
        .slice(0, 300);
      console.log(`[${c.n} ${c.company}] ${step.name} FAILED: ${msg}`);
      await page
        .screenshot({
          path: `/tmp/claude-0/-home-user-q/5e7a5c77-f947-52b0-88c5-5afccae36a31/scratchpad/shots/fail-${c.n}-${step.name}.png`,
        })
        .catch(() => {});
      failed.push(step.name);
      if (step.name === "stepOnboarding") break;
    }
  }
  summary.push(
    `${c.n} ${c.company}: ${failed.length ? `FAILED ${failed.join(",")}` : "ok"}`,
  );
  await ctx.close();
}
console.log("\nSUMMARY\n" + summary.join("\n"));
await browser.close();
