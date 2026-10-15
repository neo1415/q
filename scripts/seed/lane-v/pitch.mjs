#!/usr/bin/env node
/**
 * Upload and publish an extra pitch video for an existing founder, through
 * the product's own founder flow: /pitch/new → "Choose a video" (bytes go
 * browser → Cloudflare Stream) → READY → "Who sees it" (title, audience).
 * Nothing is written to the database by this script; it only reads status.
 *
 *   SUPABASE_ACCESS_TOKEN=… NODE_USE_ENV_PROXY=1 node scripts/seed/lane-v/pitch.mjs jobs.json [slug,…]
 *   jobs.json: [{ slug, email, companyId, file, title }]
 *
 * Idempotent: the media id per slug is kept in docs/seed/lane-v/pitch-state.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as lib from "../tavus20/lib.mjs";
import { login } from "../tavus20/steps.mjs";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    "/home/user/q/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs"
);
const STATE = join(lib.ROOT, "docs/seed/lane-v/pitch-state.json");
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const only = process.argv[3]?.split(",");
const uuid = /^[0-9a-f-]{36}$/;

const assets = async (companyId) => {
  if (!uuid.test(companyId)) throw new Error("bad company id");
  return lib.sql(
    `select id, status, title, audience, downloadable, created_at from media.media_assets
     where purpose='FOUNDER_PITCH' and deleted_at is null
       and owner_organisation_id=(select organisation_id from core.companies where id='${companyId}')
     order by created_at desc`,
  );
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  proxy: { server: process.env.HTTPS_PROXY },
  args: ["--ignore-certificate-errors"],
});
const summary = [];
for (const job of jobs) {
  if (only && !only.includes(job.slug)) continue;
  const s = (state[job.slug] ??= { companyId: job.companyId });
  if (job.replaces && s.replaces !== job.replaces) {
    // A replacement upload for this slug: keep the old record, start over.
    state[`${job.slug}@${s.mediaId ?? "none"}`] = { ...s };
    for (const k of Object.keys(s)) delete s[k];
    Object.assign(s, { companyId: job.companyId, replaces: job.replaces });
  }
  if (s.published) continue;
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1360, height: 900 },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  try {
    if (!s.mediaId) {
      const before = new Set((await assets(job.companyId)).map((a) => a.id));
      // `replaces`: the founder's own "Replace video" on the published pitch,
      // so the new asset supersedes it instead of standing beside it.
      const path = job.replaces ? `/pitch/${job.replaces}` : "/pitch/new";
      await login(page, job.email, path);
      await page.goto(`${lib.WEB}${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(7000);
      const [fc] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 15000 }),
        page
          .getByRole("button", {
            name: job.replaces ? "Replace video" : "Choose a video",
          })
          .click(),
      ]);
      await fc.setFiles(job.file);
      for (let i = 0; i < 60 && !s.mediaId; i += 1) {
        await page.waitForTimeout(5000);
        const fresh = (await assets(job.companyId)).find(
          (a) => !before.has(a.id),
        );
        if (fresh) s.mediaId = fresh.id;
      }
      if (!s.mediaId) throw new Error("no new media asset appeared");
      save();
    }
    let a;
    for (let i = 0; i < 60; i += 1) {
      a = (await assets(job.companyId)).find((x) => x.id === s.mediaId);
      if (a?.status === "READY") break;
      if (/FAILED|EXPIRED|DELETED/.test(a?.status ?? ""))
        throw new Error(`media ${a.status}`);
      await page.waitForTimeout(10000);
    }
    if (a?.status !== "READY") throw new Error(`not ready (${a?.status})`);
    // Caption/transcript states move the version just after READY.
    await page.waitForTimeout(20000);
    await login(page, job.email, `/pitch/${s.mediaId}`);
    await page.goto(`${lib.WEB}/pitch/${s.mediaId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(7000);
    const R = page.getByRole("region", { name: "Who sees it" });
    await R.getByRole("textbox", { name: "Title" }).fill(job.title);
    await R.getByRole("combobox", { name: "Who can watch it" }).selectOption({
      label: "Everyone on Capital Q",
    });
    await R.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(6000);
    a = (await assets(job.companyId)).find((x) => x.id === s.mediaId);
    if (a.audience !== "NETWORK" || a.title !== job.title)
      throw new Error(`details not saved (${a.audience}, ${a.title})`);
    s.published = true;
    save();
    summary.push(`${job.slug}: ${s.mediaId} READY NETWORK`);
  } catch (error) {
    await page
      .screenshot({
        path: `${process.env.CQ_SEED_SHOTS ?? "/tmp"}/pitch-${job.slug}.png`,
      })
      .catch(() => {});
    summary.push(
      `${job.slug}: FAILED ${String(error?.message ?? error).split("\n")[0]}`,
    );
  }
  console.log(summary.at(-1));
  await ctx.close();
}
console.log("\nSUMMARY\n" + summary.join("\n"));
await browser.close();
