#!/usr/bin/env node
/**
 * Builds the KUUZA AI flagship company in the deployed app through its own
 * UI, signed in as the fictional steward account (password sign-in; no
 * magic links, no Supabase admin API, no SQL writes, no invitations).
 *
 *   CQ_SEED_ACCOUNT_PASSWORD=... SUPABASE_ACCESS_TOKEN=... NODE_USE_ENV_PROXY=1 \
 *     node scripts/seed/flagship/run.mjs [--dry-run] [--steps onboarding,profile,images]
 *
 * SUPABASE_ACCESS_TOKEN is used only for read-only verification queries.
 * Progress (ids only) lives in docs/flagship/kuuza/seed-state.json.
 *
 * Why the onboarding walk is forked from tavus20/steps.mjs: that version
 * creates accounts through the admin API, signs in with magic links and
 * answers every question from a full synthetic dataset. Here most facts are
 * UNKNOWN, so the walk takes the honest option ("Not sure yet", Skip) and
 * stops at the first required question it cannot answer truthfully.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import * as tlib from "../tavus20/lib.mjs";
import * as ui from "../tavus20/ui.mjs";
import * as plan from "./plan.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const DRY = args.includes("--dry-run");
const ONLY = opt("--steps")?.split(",");
const STATE_FILE = join(plan.DIR, "seed-state.json");
const ACC = process.env.CQ_FLAGSHIP_DIR ?? "/tmp/claude-0/acc/flagship";
const SHOTS = join(ACC, "shots");
const ASSETS = join(ACC, "assets");
const SIGNIN_LIB = process.env.CQ_SIGNIN_LIB ?? "/tmp/claude-0/acc/lib.mjs";

const c = plan.company();
const log = (...a) => console.log("[kuuza]", ...a);

const loadState = () =>
  existsSync(STATE_FILE)
    ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
    : { company: c.company, done: {} };
const state = loadState();
const save = (patch) => {
  Object.assign(state, patch);
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
};
const markDone = (key) => save({ done: { ...state.done, [key]: true } });

/** Read-only verification SQL (management API, read_only: true). */
const q = (sql) => tlib.sql(sql);

async function shot(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  const path = join(SHOTS, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  log("screenshot", path);
  return path;
}

const h1 = async (page) =>
  (
    await page
      .locator("main h1, main h2")
      .first()
      .innerText({ timeout: 20000 })
      .catch(() => "")
  ).trim();

/** Every labelled control on the screen, for stopping on an unknown step. */
async function dumpControls(page) {
  const roles = ["radio", "checkbox", "textbox", "combobox", "button"];
  const out = [];
  for (const role of roles) {
    for (const el of await page.locator("main").getByRole(role).all()) {
      const name = (
        (await el.getAttribute("aria-label")) ??
        (await el.innerText().catch(() => "")) ??
        ""
      )
        .trim()
        .slice(0, 60);
      out.push(`${role}:${name}`);
    }
  }
  return out.join(" | ");
}

async function clickContinue(page) {
  const b = page.getByRole("button", { name: "Continue", exact: true });
  if (await b.isVisible().catch(() => false)) await b.click();
  await page.waitForTimeout(6000);
}

async function skip(page) {
  const b = page.getByRole("button", { name: /^Skip/ }).first();
  await b.click();
  await page.waitForTimeout(6000);
}

// ------------------------------------------------------------ onboarding

const ONBOARDING_PLAN = [
  ["Company name", c.company],
  ["Website", c.websiteUrl],
  ["Based in", "Nigeria (operating base; ASSUMPTION, medium confidence)"],
  ["Stage", "Not sure yet (stage not published)"],
  ["Description", c.shortDescription],
  ["Categories", c.categories.join(", ")],
  ["Materials", "Skip (no deck upload yet)"],
  ["Your role", "Something else (steward is not a founder)"],
  ["How many founders?", `${c.founders.length} (${c.founders.join(", ")})`],
  ["Full-time / team size / traction / raise", "UNKNOWN: stop, do not invent"],
];

async function stepOnboarding(page) {
  if (state.done.onboardingPartial) return log("onboarding: already done");
  await page.goto(`${tlib.WEB}/onboarding/founder`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(6000);
  let n = 0;
  for (let i = 0; i < 25; i += 1) {
    const form = page
      .getByRole("button", { name: "Use the form" })
      .or(page.getByRole("link", { name: "Use the form" }))
      .first();
    if (await form.isVisible().catch(() => false)) {
      await form.click();
      await page.waitForTimeout(3000);
    }
    const head = await h1(page);
    log("onboarding screen:", head || page.url());
    await shot(page, `onb-${String((n += 1)).padStart(2, "0")}`);
    if (/What brings you/.test(head) || head === "") {
      const raising = page
        .getByRole("button", { name: "I'm raising for a company" })
        .or(page.getByRole("radio", { name: "I'm raising for a company" }))
        .first();
      if (await raising.isEnabled().catch(() => false)) {
        await raising.click();
        await page.waitForTimeout(6000);
        await clickContinue(page);
      } else await page.waitForTimeout(5000);
    } else if (/^Your company$/.test(head)) {
      await page.getByRole("textbox", { name: "Company name" }).fill(c.company);
      const web = page.getByRole("textbox", { name: "Website" });
      if (await web.isVisible().catch(() => false))
        await web.fill(c.websiteUrl);
      const based = page.getByRole("combobox", { name: /based/ });
      if (await based.isVisible().catch(() => false))
        await based.selectOption({ label: "Nigeria" });
      await clickContinue(page);
    } else if (/What stage/.test(head)) {
      await page
        .getByRole("radio", { name: "Not sure yet", exact: true })
        .check();
      save({ stageChoice: "Not sure yet" });
      await clickContinue(page);
    } else if (/what does the company do/i.test(head)) {
      await page.getByRole("textbox").first().fill(c.shortDescription);
      await clickContinue(page);
    } else if (/categorise/.test(head)) {
      await page.waitForTimeout(2500);
      const wanted = new Set(c.categories);
      const chips = await page
        .getByRole("list", { name: "Suggested categories" })
        .getByRole("button")
        .all();
      const picked = [];
      for (const chip of chips) {
        const name = (
          (await chip.getAttribute("aria-label")) ?? (await chip.innerText())
        )
          .split(/[,\n]/)[0]
          .trim();
        if (wanted.has(name)) {
          await chip.click();
          picked.push(name);
        }
      }
      log(
        `categories: picked ${picked.join(", ") || "none"} of ${chips.length}`,
      );
      save({ onboardingCategories: picked });
      if (picked.length) await clickContinue(page);
      else await skip(page);
    } else if (/What do you already have/.test(head)) {
      await skip(page);
    } else if (/what I understood|what we have so far/i.test(head)) {
      const right = page.getByRole("button", { name: "Looks right" });
      if (await right.isVisible().catch(() => false)) {
        await right.click();
        await page.waitForTimeout(8000);
      } else await clickContinue(page);
    } else if (/founding team|Your role/i.test(head)) {
      const role = page.getByRole("radio", {
        name: "Something else",
        exact: true,
      });
      if (await role.isVisible().catch(() => false)) {
        await role.check();
        save({ roleChoice: "Something else" });
      }
      const count = page.getByRole("textbox", { name: "How many founders?" });
      if (await count.isVisible().catch(() => false))
        await count.fill(String(c.founders.length));
      // Full-time status and team size are UNKNOWN and required: stop here
      // rather than invent them. The founders answer these after handover.
      log("onboarding: stopping at the team step:", await dumpControls(page));
      break;
    } else {
      log("onboarding: unhandled screen; stopping:", await dumpControls(page));
      break;
    }
  }
  await shot(page, "onb-final");
  const rows = await q(
    `select c.id, c.organisation_id, c.canonical_name, c.website_url, c.headquarters_country, c.current_stage_code, c.marketplace_visibility from core.companies c where c.canonical_name ilike '%kuuza%'`,
  );
  log("verify companies:", JSON.stringify(rows));
  if (rows.length === 1) {
    save({ companyId: rows[0].id, organisationId: rows[0].organisation_id });
    markDone("onboardingPartial");
  }
}

// --------------------------------------------------------------- profile

async function stepProfile(page) {
  if (state.done.profile) return log("profile: already done");
  await page.goto(`${tlib.WEB}/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await shot(page, "profile-before");
  const out = [];
  out.push(await ui.setField(page, "About", "In one line", c.shortDescription));
  out.push(
    await ui.setField(page, "About", "Description", c.primaryDescription),
  );
  await ui.closeRegion(page, "About");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  out.push(await ui.setField(page, "Company", "City", c.headquarters.city));
  out.push(await ui.setField(page, "Company", "Website", c.websiteUrl));
  await ui.closeRegion(page, "Company");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const sector = ui
    .region(page, "Sector")
    .getByRole("button", { name: "Edit sector" });
  if (await sector.isVisible().catch(() => false)) {
    await sector.click();
    await page.waitForTimeout(1500);
    out.push((await ui.addSectorCategories(page, c.categories)).join(", "));
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save" })
      .click();
    await page.waitForTimeout(4000);
  } else out.push("no sector editor");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  await shot(page, "profile-after");
  log("profile:", out.join(" | "));
  save({ profileResult: out });
  markDone("profile");
}

// ---------------------------------------------------------------- images

async function stepImages(page) {
  if (state.done.images) return log("images: already done");
  const logo = join(ASSETS, "kuuza-logo.png");
  const cover = join(ASSETS, "kuuza-cover.png");
  for (const f of [logo, cover])
    if (!existsSync(f)) throw new Error(`missing asset ${f}`);
  await page.goto(`${tlib.WEB}/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const out = [];
  out.push(`logo: ${await ui.uploadImage(page, "Change logo", logo)}`);
  out.push(
    `cover: ${await ui.uploadImage(page, "Change company cover", cover)}`,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await shot(page, "images-after");
  log("images:", out.join(" | "));
  save({ imagesResult: out });
  markDone("images");
}

const STEPS = {
  onboarding: stepOnboarding,
  profile: stepProfile,
  images: stepImages,
};

if (DRY) {
  console.log("DRY RUN: KUUZA AI as", plan.STEWARD);
  for (const [k, v] of ONBOARDING_PLAN) console.log(`  onboarding ${k}: ${v}`);
  console.log(`  profile In one line: ${c.shortDescription}`);
  console.log(`  profile Description: ${c.primaryDescription}`);
  console.log(
    `  profile City: ${c.headquarters.city} (${c.headquartersConfidence})`,
  );
  console.log(`  profile Website: ${c.websiteUrl}`);
  console.log(`  profile Sector: ${c.categories.join(", ")}`);
  console.log(
    `  profile Founders (names only, no accounts): ${c.founders.join(", ")}`,
  );
  console.log(`  images: ${ASSETS}/kuuza-logo.png, ${ASSETS}/kuuza-cover.png`);
  console.log(
    "  skipped: legal name, founded date, team size, traction, raise (UNKNOWN); visibility stays private",
  );
  console.log("  state:", JSON.stringify(state));
  process.exit(0);
}

const { browser, signIn } = await import(SIGNIN_LIB);
const b = await browser();
const ctx = await b.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1360, height: 900 },
});
await ctx.addInitScript(() => {
  try {
    sessionStorage.setItem("cq.splash.seen", "1");
  } catch {
    // Storage can be blocked in a fresh context; the splash then just shows.
  }
});
// signIn refuses any address outside @fictional.capitalq.local.
const page = await signIn(ctx, plan.STEWARD);
page.setDefaultTimeout(30000);
await page.waitForTimeout(4000);
for (const [name, fn] of Object.entries(STEPS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  try {
    await fn(page);
  } catch (error) {
    log(`${name} FAILED:`, String(error?.message ?? error).split("\n")[0]);
    await shot(page, `fail-${name}`).catch(() => {});
    break;
  }
}
await b.close();
