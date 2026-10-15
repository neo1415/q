#!/usr/bin/env node
/**
 * Acceptance of a seeded fictional-bulk sample through the deployed app:
 * real password sign-in on the web (Playwright, one Chromium), the pages a
 * person would open, and the API checks a browser's own session can make
 * (permissions, GateQ qualification, fit). Read-mostly: the only writes are
 * one founder headline edit through the profile UI and one GateQ
 * qualification an investor runs on a company it can see. No model call is
 * made by this script.
 *
 *   /root/sb node scripts/seed/fictional-bulk/accept.mjs [--companies fb0001,fb0013] [--investors baobab-ridge,cape-meridian]
 */
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import * as lib from "../tavus20/lib.mjs";
import { buildWorld } from "./world.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const SHOTS = opt(
  "--shots",
  "/tmp/claude-0/-home-user-q/36a4bcfb-949b-538e-957a-f912051e5af6/scratchpad/accept",
);
mkdirSync(SHOTS, { recursive: true });
const state = JSON.parse(
  readFileSync(
    join(lib.ROOT, "docs/seed/fictional-bulk/seed-state.json"),
    "utf8",
  ),
);
const world = buildWorld({ count: 400 });
const coKeys = opt("--companies", "fb0001,fb0013,fb0007").split(",");
const invKeys = opt(
  "--investors",
  "baobab-ridge,cape-meridian,gulf-horizon",
).split(",");
const password = process.env.CQ_SEED_ACCOUNT_PASSWORD;
if (!password) throw new Error("CQ_SEED_ACCOUNT_PASSWORD is required");

const { chromium } = await import(
  join(
    lib.ROOT,
    "node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs",
  )
);
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  proxy: { server: process.env.HTTPS_PROXY },
  args: ["--ignore-certificate-errors"],
});
const results = [];
const check = (area, who, ok, note = "") => {
  results.push({ area, who, ok, note });
  console.log(
    `${ok ? "PASS" : "FAIL"} ${area} · ${who}${note ? ` · ${note}` : ""}`,
  );
};

async function signIn(email) {
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1360, height: 900 },
  });
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem("cq.splash.seen", "1");
    } catch {
      // Storage can be blocked in a fresh context.
    }
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`${lib.WEB}/auth/sign-in`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: /email/i }).first().fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 45000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  return { ctx, page };
}
const text = async (page) =>
  (
    await page
      .locator("main")
      .first()
      .innerText()
      .catch(() => "")
  ).replace(/\s+/g, " ");
async function visit(page, path) {
  await page.goto(`${lib.WEB}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  return text(page);
}
const shot = (page, name) =>
  page.screenshot({ path: join(SHOTS, `${name}.png`) }).catch(() => {});

// --logins-only a,b,c: real sign-in of a sample of seeded companies' founders
// and first team members, and nothing else (the per-batch check).
if (args.includes("--logins-only")) {
  const keys = opt("--logins-only", "").split(",").filter(Boolean);
  for (const key of keys) {
    const c = world.companies.find((x) => x.key === key);
    for (const email of [c.founder.email, c.members[0]?.email].filter(
      Boolean,
    )) {
      const { ctx, page } = await signIn(email);
      const landed = new URL(page.url()).pathname;
      check(
        "login",
        email,
        !landed.startsWith("/auth") && !landed.startsWith("/onboarding"),
        `landed ${landed}`,
      );
      await ctx.close();
    }
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

// --------------------------------------------------------------- founders
for (const key of coKeys) {
  const c = world.companies.find((x) => x.key === key);
  const s = state.companies[key];
  const { ctx, page } = await signIn(c.founder.email);
  const landed = new URL(page.url()).pathname;
  check(
    "login",
    c.founder.email,
    !landed.startsWith("/auth") && !landed.startsWith("/onboarding"),
    `landed ${landed}`,
  );
  const profile = await visit(page, `/company/${s.companyId}`);
  await shot(page, `${key}-company`);
  check(
    "profile",
    c.name,
    profile.includes(c.name) && profile.includes(c.city),
    `${c.city}`,
  );
  const team = await visit(page, "/settings/team");
  await shot(page, `${key}-team`);
  check(
    "team",
    c.name,
    c.members.every((m) => team.includes(m.displayName)) &&
      team.includes(c.founder.displayName),
    `${c.members.length + 1} people`,
  );
  const capital = await visit(page, "/capital");
  await shot(page, `${key}-capital`);
  const amount = Number(c.raise.target.amount).toLocaleString("en-US");
  check(
    "raise",
    c.name,
    capital.includes(c.raise.target.currency) || capital.includes(amount),
    `${c.raise.target.currency} ${amount}`,
  );
  const docs = await visit(page, "/documents");
  check(
    "documents",
    c.name,
    c.documents.every((d) =>
      docs.includes(d.title.replace(/ \(fictional\)$/, "")),
    ),
    `${c.documents.length} docs`,
  );
  const pitch = await visit(page, "/pitch");
  await shot(page, `${key}-pitch`);
  check(
    "pitch slot",
    c.name,
    /No videos yet/i.test(pitch) && /New video/i.test(pitch),
    "empty, editable",
  );
  // Founders hold no mandate.
  const t = await lib.accessToken(c.founder.email);
  const inv = await lib.call(lib.API, t, "GET", "/v1/investors/current");
  check(
    "no founder mandate",
    c.name,
    inv.status !== 200,
    `investors/current ${inv.status}`,
  );
  await ctx.close();
}

// Editing, through the UI: one founder changes their own headline.
{
  const c = world.companies.find((x) => x.key === coKeys[0]);
  const { ctx, page } = await signIn(c.founder.email);
  await visit(page, "/profile");
  const ui = await import("../tavus20/ui.mjs");
  const wanted = `${c.founder.businessTitle}, ${c.name} (fictional demo founder)`;
  const out = await ui
    .setField(page, "You and your team", "Headline", wanted)
    .catch((e) => String(e.message).slice(0, 120));
  await ui.closeRegion(page, "You and your team").catch(() => {});
  const me = await lib.call(
    lib.API,
    await lib.accessToken(c.founder.email),
    "GET",
    "/v1/me/profile",
  );
  check("edit (UI)", c.founder.email, me.body?.headline === wanted, `${out}`);
  await ctx.close();
}

// ---------------------------------------------------------- team members
for (const key of coKeys.slice(0, 2)) {
  const c = world.companies.find((x) => x.key === key);
  const m = c.members[0];
  const { ctx, page } = await signIn(m.email);
  const landed = new URL(page.url()).pathname;
  check(
    "login (member)",
    m.email,
    !landed.startsWith("/auth") && !landed.startsWith("/onboarding"),
    `landed ${landed}`,
  );
  const t = await lib.accessToken(m.email);
  const team = await lib.call(lib.API, t, "GET", "/v1/team");
  check(
    "member role",
    m.email,
    team.body?.you?.role === m.appRole,
    `${team.body?.you?.role}`,
  );
  // Another company's profile is not theirs to edit.
  const other = state.companies[coKeys.find((k) => k !== key)];
  const cur = await lib.call(
    lib.API,
    t,
    "GET",
    `/v1/companies/${other.companyId}`,
  );
  const edit = await lib.call(
    lib.API,
    t,
    "PATCH",
    `/v1/companies/${other.companyId}`,
    { expectedVersion: cur.body?.version ?? 1, shortDescription: "x" },
  );
  check(
    "cross-company edit refused",
    m.email,
    edit.status === 403 || edit.status === 404,
    `PATCH ${edit.status}`,
  );
  await ctx.close();
}

// -------------------------------------------------------------- investors
for (const key of invKeys) {
  const inv = world.investors.find((x) => x.key === key);
  const s = state.investors[key];
  const lead = inv.logins[0];
  const { ctx, page } = await signIn(lead.email);
  const landed = new URL(page.url()).pathname;
  check(
    "login (investor)",
    lead.email,
    !landed.startsWith("/auth") && !landed.startsWith("/onboarding"),
    `landed ${landed}`,
  );
  const t = await lib.accessToken(lead.email);
  const mandate = await lib.call(
    lib.API,
    t,
    "GET",
    `/v1/investors/${s.investorOrganisationId}/mandates/${s.mandateId}`,
  );
  check(
    "mandate",
    inv.name,
    mandate.body?.status === "ACTIVE" &&
      mandate.body?.rawMandateText === inv.thesis,
    `${mandate.body?.status}`,
  );
  const team = await lib.call(lib.API, t, "GET", "/v1/team");
  check(
    "firm team",
    inv.name,
    inv.logins.every((l) =>
      team.body?.members?.some(
        (x) => x.email?.toLowerCase() === l.email.toLowerCase(),
      ),
    ),
    `${team.body?.members?.length} members`,
  );
  const discover = await visit(page, "/discover");
  await shot(page, `${key}-discover`);
  check(
    "discover (video rule)",
    inv.name,
    /pitch video|None has a pitch/i.test(discover) || /play/i.test(discover),
    discover.slice(0, 140),
  );
  // Search and filters: a seeded company in the investor's sectors is findable.
  const target = world.companies
    .slice(0, 20)
    .find((c) => state.companies[c.key]?.companyId);
  // Search by name lives in Explore (Search is @handles and videos).
  const search = await visit(
    page,
    `/explore?q=${encodeURIComponent(target.name)}`,
  );
  await shot(page, `${key}-search`);
  check(
    "search (Explore, by name)",
    inv.name,
    !/Nothing matches/i.test(search) && search.includes(target.name),
    target.name,
  );
  const explore = await visit(page, "/explore");
  await shot(page, `${key}-explore`);
  check("explore", inv.name, explore.length > 200, explore.slice(0, 120));
  // Fit, on a company profile.
  const co = await visit(
    page,
    `/company/${state.companies[target.key].companyId}`,
  );
  await shot(page, `${key}-fit`);
  check(
    "profile + fit (investor view)",
    inv.name,
    co.includes(target.name) && /fit|mandate|match/i.test(co),
    "",
  );
  // GateQ: its published gate qualifies a company deterministically.
  const q = await lib.call(
    lib.API,
    t,
    "POST",
    `/v1/gateq/gateways/${s.gatewayId}/qualify`,
    { companyId: state.companies[target.key].companyId },
  );
  check(
    "gateq qualify",
    inv.name,
    q.status === 200,
    `${q.status} ${JSON.stringify(q.body).slice(0, 160)}`,
  );
  // Permissions: a founder's organisation-private document is not readable.
  const doc = Object.values(state.companies[target.key].documentIds)[0];
  const d = await lib.call(lib.API, t, "GET", `/v1/documents/${doc}`);
  check(
    "private document refused",
    inv.name,
    d.status === 403 || d.status === 404,
    `GET ${d.status}`,
  );
  await ctx.close();
}

// ---------------------------------------------------------------------- Q
// Off unless --with-q: on 2026-10-15 a Q run for a synthetic account still
// used the paid OpenAI route for NORMAL_DIALOGUE.
// One question per role (synthetic routing: the deployment's free route).
async function askQ(email, text) {
  const t = await lib.accessToken(email);
  const created = await lib.call(lib.QAPI, t, "POST", "/v1/q/runs", {
    capability: "ANSWER",
    message: { text },
    modality: "TEXT",
  });
  const runId = created.body?.runId;
  if (!runId) return { status: `HTTP ${created.status}`, reply: "" };
  const started = Date.now();
  for (;;) {
    const run =
      (await lib.call(lib.QAPI, t, "GET", `/v1/q/runs/${runId}`)).body ?? {};
    const qs = (run.messages ?? []).filter((m) => m.role === "Q");
    if (
      qs.length > 0 &&
      ["COMPLETED", "AWAITING_INPUT", "AWAITING_APPROVAL"].includes(run.status)
    )
      return {
        status: run.status,
        reply: qs.at(-1).text ?? "",
        correlationId: run.correlationId,
      };
    if (
      ["FAILED", "CANCELLED", "EXPIRED"].includes(run.status) ||
      Date.now() - started > 60000
    )
      return {
        status: run.status ?? "TIMED_OUT",
        reply: "",
        correlationId: run.correlationId,
      };
    await lib.sleep(1500);
  }
}
const providersOf = async (cid) =>
  cid
    ? (
        await lib
          .sql(
            `select string_agg(distinct provider_id || ':' || model_id || ' $' || coalesce(cost_usd::text, '?'), ', ') as p from ai_ops.model_usage where correlation_id = '${String(cid).replace(/[^a-zA-Z0-9_-]/g, "")}'`,
          )
          .catch(() => [{ p: "?" }])
      )[0]?.p
    : null;
if (args.includes("--with-q")) {
  const c = world.companies.find((x) => x.key === coKeys[0]);
  const f = await askQ(c.founder.email, "What is our current raise target?");
  const amount = Number(c.raise.target.amount).toLocaleString("en-US");
  check(
    "Q (founder, own raise)",
    c.name,
    f.reply.includes(amount) || f.reply.includes(c.raise.target.amount),
    `${f.status} · ${await providersOf(f.correlationId)} · ${f.reply.slice(0, 160)}`,
  );
  const inv = world.investors.find((x) => x.key === invKeys[0]);
  const i = await askQ(
    inv.logins[0].email,
    `What do you know about ${c.name}?`,
  );
  // Founder-private figures never reach an investor (Context Firewall).
  const privateFigures = [c.fin.monthlyBurn, c.fin.cash, c.fin.monthlyRevenue]
    .filter(Boolean)
    .map((v) => Number(v).toLocaleString("en-US"));
  const leaked = privateFigures.filter((v) => i.reply.includes(v));
  check(
    "Q (investor, about a company)",
    inv.name,
    i.reply.length > 0 && leaked.length === 0,
    `${i.status} · ${await providersOf(i.correlationId)} · leaked ${leaked.length} · ${i.reply.slice(0, 160)}`,
  );
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`,
);
