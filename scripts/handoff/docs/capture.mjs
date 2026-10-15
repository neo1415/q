#!/usr/bin/env node
/**
 * Screenshot capture for the Capital Q user guide (docs/guide/).
 *
 * Re-runnable after each release: it signs in to production as the fictional
 * demo accounts, walks every main page at 1440x900 in the light theme, and
 * writes one PNG per shot plus manifest.json into the output folder. Then run
 * build.mjs to rebuild the HTML and PDF from docs/guide/guide.src.html.
 *
 *   export CQ_SEED_ACCOUNT_PASSWORD=...   # the shared demo password
 *   export SB_PUBLISHABLE=...             # the web app's public Supabase key
 *   node scripts/handoff/docs/capture.mjs --out /tmp/guide-shots
 *   node scripts/handoff/docs/capture.mjs --out /tmp/guide-shots --only inv-home,fnd-home
 *
 * Flags:
 *   --out DIR        where PNGs and manifest.json go (default ./guide-shots)
 *   --only a,b       only these shot ids (others keep their old PNGs)
 *   --with-q         also send the few fresh Q prompts (costs model calls;
 *                    without it, Q shots reopen existing conversations only)
 *   --with-apply     open the GateQ interview step as the founder (creates a
 *                    draft application on the fictional founder account; never
 *                    submits and never starts a paid video session)
 *
 * Optional env: CQ_WEB_URL, CQ_SUPABASE_REF, PLAYWRIGHT_MODULE (path to
 * playwright's index.mjs), CHROMIUM_PATH.
 *
 * Production is small: pages load at least 2 s apart, one browser at a time,
 * and the run stops if a sign-in takes more than 5 s.
 * It never starts a Tavus or voice session, never sends an invitation, never
 * confirms interest, a booking or a decision: dialogs are opened, shot, and
 * closed with Escape. The only writes are Save on two Discover companies
 * (reversible, and the company is not told) and, with flags, the Q prompts and
 * the draft GateQ application.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(opt("--out", "./guide-shots"));
const ONLY = opt("--only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const WITH_Q = flag("--with-q");
const WITH_APPLY = flag("--with-apply");

const WEB = (process.env.CQ_WEB_URL ?? "https://capital-qweb-production.up.railway.app").replace(/\/$/, "");
const REF = process.env.CQ_SUPABASE_REF ?? "vcohxiqsmnkzxnvawgri";
const PASSWORD = process.env.CQ_SEED_ACCOUNT_PASSWORD;
const PUBLISHABLE = process.env.SB_PUBLISHABLE;
if (!PASSWORD || !PUBLISHABLE) {
  console.error("Set CQ_SEED_ACCOUNT_PASSWORD and SB_PUBLISHABLE.");
  process.exit(2);
}

async function loadChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    "/home/user/q-int/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs",
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return (await import(pathToFileURL(c).href)).chromium;
  const require = createRequire(resolve(here, "../../../apps/web/package.json"));
  return (await import(pathToFileURL(require.resolve("playwright")).href)).chromium;
}

const ACCOUNTS = {
  investor: "investor.savanna-seed@fictional.capitalq.local",
  founder: "babatunde.tunde-cargo@fictional.capitalq.local",
  ledgerfold: "founder.ledgerfold@fictional.capitalq.local",
};

// Declutter only: the "answer ready" chip floats over every page, and the
// screenshot browser cannot decode the pitch videos, so its "can't play here"
// notice would cover the poster frame a real viewer sees as the video starts.
const DECLUTTER = "[data-answer-chip]{display:none!important}.cq-feed-problem{display:none!important}";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Shot list. `acct` picks the sign-in; `run` drives the page (ctx below). */
const SHOTS = [
  // ---------- Sign-in (signed out) ----------
  { id: "signin", acct: null, title: "Sign in", path: "/auth/sign-in" },

  // ---------- Investor ----------
  { id: "inv-home", acct: "investor", title: "Q (home), investor", path: "/home", wait: 4000 },
  { id: "inv-nav", acct: "investor", title: "Sidebar, investor (expanded)", path: "/capital", run: async (c) => { await c.expandNav(); } },
  { id: "inv-discover", acct: "investor", title: "Discover feed", path: "/discover", wait: 4000 },
  { id: "inv-discover-interest", acct: "investor", title: "Express interest panel", path: "/discover", run: async (c) => { await c.clickButton(/^Interest$/); } },
  { id: "inv-discover-save", acct: "investor", title: "Saving a company", path: "/discover", run: async (c) => {
      await c.clickButton(/^Save$/, { optional: true });
      await c.page.waitForTimeout(2500);
    } },
  { id: "inv-saved", acct: "investor", title: "Saved companies", path: "/discover/saved", run: async (c) => {
      const boxes = c.page.getByRole("checkbox", { name: /to compare/ });
      const n = await boxes.count();
      for (let i = 0; i < Math.min(n, 2); i++) await boxes.nth(i).check().catch(() => {});
      await c.page.waitForTimeout(1000);
    } },
  { id: "inv-compare", acct: "investor", title: "Side by side", path: () => `/discover/saved/compare?ids=${ids.ledgerfold},${ids.second}`, wait: 4000 },
  { id: "inv-explore", acct: "investor", title: "Explore", path: "/explore" },
  { id: "inv-explore-search", acct: "investor", title: "Explore search", path: "/explore?q=fintech" },
  { id: "inv-search", acct: "investor", title: "Search people and handles", path: "/search?q=Ledgerfold" },
  { id: "inv-company", acct: "investor", title: "Company profile, overview", path: () => `/company/${ids.ledgerfold}` },
  { id: "inv-company-full", acct: "investor", title: "Company profile, more", path: () => `/company/${ids.ledgerfold}`, run: async (c) => { await c.scrollTo("Risks and unknowns"); } },
  { id: "inv-company-deck", acct: "investor", title: "Company profile, pitch deck", path: () => `/company/${ids.ledgerfold}?tab=deck`, run: async (c) => { await c.scrollTo(/deck, version/); } },
  { id: "inv-company-dataroom", acct: "investor", title: "Company profile, data room", path: () => `/company/${ids.ledgerfold}?tab=dataroom`, run: async (c) => { await c.scrollToText("Request all on-request documents"); } },
  { id: "inv-company-team", acct: "investor", title: "Company profile, team", path: () => `/company/${ids.ledgerfold}?tab=team`, run: async (c) => { await c.scrollTo(/^Team$/); } },
  { id: "inv-q-conversations", acct: "investor", title: "Q, previous conversations", path: "/home", run: async (c) => { await c.openConversations(); } },
  { id: "inv-q-compare", acct: "investor", title: "Q answer, comparison card", path: "/home", run: async (c) => { await c.openConversation(/Top companies against mandate/, "out of 10"); } },
  { id: "inv-q-risk", acct: "investor", title: "Q answer, company risks", path: "/home", run: async (c) => { await c.openConversation(/Ledgerfold risk assessment/, "Hide from Q", true); } },
  { id: "inv-q-board", acct: "investor", title: "Q Board", path: "/home", run: async (c) => {
      await c.openConversation(/Top companies against mandate/);
      await c.clickButton(/^Board/, { optional: true });
      await c.page.waitForTimeout(3000);
    } },
  { id: "inv-q-ask", acct: "investor", title: "Q answer, fresh question", path: "/home", needs: "q", run: async (c) => {
      await c.askQ("Where are my deals? Show them as a table with the next step for each.");
    } },
  { id: "inv-crm-list", acct: "investor", title: "CRM, pipeline list", path: "/relationships" },
  { id: "inv-crm-overview", acct: "investor", title: "CRM, overview", path: "/relationships?view=overview" },
  { id: "inv-crm-table", acct: "investor", title: "CRM, pipeline table", path: "/relationships?view=pipeline&layout=table" },
  { id: "inv-crm-board", acct: "investor", title: "CRM, pipeline board", path: "/relationships?view=pipeline&layout=board" },
  { id: "inv-crm-record", acct: "investor", title: "CRM record", path: () => `/relationships/company/${ids.ledgerfold}` },
  { id: "inv-crm-notes", acct: "investor", title: "CRM record, private notes and next steps", path: () => `/relationships/company/${ids.ledgerfold}`, run: async (c) => { await c.scrollTo("Private notes"); } },
  { id: "inv-crm-book", acct: "investor", title: "CRM record, book a call", path: () => `/relationships/company/${ids.ledgerfold}`, run: async (c) => { await c.clickButton(/^Book a call$/); } },
  { id: "inv-crm-decision", acct: "investor", title: "CRM record, decision buttons", path: () => `/relationships/company/${ids.ledgerfold}`, run: async (c) => {
      const more = c.page.locator("main").getByText("More", { exact: true }).first();
      if (await more.count()) { await more.click().catch(() => {}); await c.page.waitForTimeout(1500); }
      await c.scrollToText("Not proceeding for now", "button");
    } },
  { id: "inv-crm-messages", acct: "investor", title: "CRM record, messages", path: () => `/relationships/company/${ids.ledgerfold}/messages` },
  { id: "inv-capital", acct: "investor", title: "Capital, investor", path: "/capital" },
  { id: "inv-mandate", acct: "investor", title: "Mandate review", path: "/onboarding/investor?review=1", wait: 4000 },
  { id: "inv-gateq-inbox", acct: "investor", title: "GateQ inbox and dossier", path: "/gateq?tab=inbox", run: async (c) => { await c.selectApplication("Maji Loop"); } },
  { id: "inv-gateq-dossier", acct: "investor", title: "GateQ dossier, details", path: "/gateq?tab=inbox", run: async (c) => {
      await c.selectApplication("Maji Loop");
      await c.scrollToText("What they shared");
    } },
  { id: "inv-gateq-gate", acct: "investor", title: "GateQ, your gate", path: "/gateq?tab=gate" },
  { id: "inv-gateq-find", acct: "investor", title: "GateQ, find a startup", path: "/gateq?tab=find" },
  { id: "inv-requests", acct: "investor", title: "Company requests", path: "/investors" },
  { id: "inv-rehearsals", acct: "investor", title: "Rehearsals", path: "/rehearsals" },
  { id: "inv-rehearsal-lobby", acct: "investor", title: "Rehearsal lobby", path: () => `/rehearsals/company/${ids.ledgerfold}`, wait: 8000 },
  { id: "inv-rehearsal-review", acct: "investor", title: "Rehearsal review", path: () => ids.rehearsal ? `/rehearsals/r/${ids.rehearsal}` : "/rehearsals" },
  { id: "inv-work", acct: "investor", title: "Q Work", path: "/work" },
  { id: "inv-work-thread", acct: "investor", title: "Q Work, a finished job", path: "/work", run: async (c) => { await c.clickButton(/^Thread$/, { optional: true }); await c.page.waitForTimeout(2500); } },
  { id: "inv-work-task", acct: "investor", title: "Q Work, giving Q a task", path: "/work", needs: "q", run: async (c) => {
      await c.askWork("Look at the three best fits in my feed, compare them against my mandate, and draft a short intro message to the strongest one for my approval.");
    } },
  { id: "inv-work-needs", acct: "investor", title: "Q Work, a plan waiting for your yes", path: "/work", needs: "q", run: async (c) => {
      await c.scrollToText("Needs you");
    } },
  { id: "inv-work-approved", acct: "investor", title: "Q Work, after approving the plan", path: "/work", needs: "q", run: async (c) => {
      // Approves the plan only: Q then researches and drafts; any message it
      // wants to send comes back to Needs you for its own approval.
      if (await c.clickButton(/^Approve$/, { optional: true })) await waitForQ(c.page);
    } },
  { id: "inv-work-progress", acct: "investor", title: "Q Work, jobs in progress", path: "/work", run: async (c) => { await c.scrollTo(/^In progress/); } },
  { id: "inv-documents", acct: "investor", title: "Documents, investor", path: "/documents" },
  { id: "inv-daily", acct: "investor", title: "The Q Daily", path: "/daily" },
  { id: "inv-qpitch", acct: "investor", title: "Q Pitch", path: "/q-pitch" },
  { id: "inv-notifications", acct: "investor", title: "Notifications", path: "/capital", run: async (c) => { await c.page.locator("[data-notification-center]").first().click(); await c.page.waitForTimeout(3500); } },
  { id: "inv-settings", acct: "investor", title: "Settings", path: "/settings" },
  { id: "inv-plan", acct: "investor", title: "Plan", path: "/settings/plan" },
  { id: "inv-verification", acct: "investor", title: "Verification", path: "/verification" },

  // ---------- Founder (Harbourline Cargo) ----------
  { id: "fnd-home", acct: "founder", title: "Q (home), founder", path: "/home", wait: 4000 },
  { id: "fnd-nav", acct: "founder", title: "Sidebar, founder (expanded)", path: "/capital", run: async (c) => { await c.expandNav(); } },
  { id: "fnd-discover", acct: "founder", title: "Discover, investors", path: "/discover" },
  { id: "fnd-investor", acct: "founder", title: "Investor profile", path: () => `/investors/${ids.savanna}` },
  { id: "fnd-capital", acct: "founder", title: "Capital, founder", path: "/capital" },
  { id: "fnd-readiness", acct: "founder", title: "Capital, readiness", path: "/capital?tab=readiness" },
  { id: "fnd-action-plan", acct: "founder", title: "Capital, action plan", path: "/capital?tab=action-plan" },
  { id: "fnd-documents", acct: "founder", title: "Documents, founder", path: "/documents" },
  { id: "fnd-dataroom", acct: "founder", title: "Data room (founder)", path: "/company/data-room", wait: 4000 },
  { id: "fnd-deck", acct: "founder", title: "Pitch deck check (founder)", path: () => `/company/${ids.harbourline}?tab=deck`, run: async (c) => { await c.scrollTo("Your pitch deck"); } },
  { id: "fnd-company", acct: "founder", title: "Company profile (founder)", path: () => `/company/${ids.harbourline}` },
  { id: "fnd-pitch", acct: "founder", title: "Pitch & media", path: "/pitch" },
  { id: "fnd-pitch-new", acct: "founder", title: "New pitch video", path: "/pitch/new" },
  { id: "fnd-crm", acct: "founder", title: "Fundraising Hub", path: "/relationships" },
  { id: "fnd-crm-record", acct: "founder", title: "Fundraising Hub record", path: () => `/relationships/investor/${ids.savanna}` },
  { id: "fnd-interest", acct: "founder", title: "Investor interest", path: "/company/interest" },
  { id: "fnd-gateq", acct: "founder", title: "GateQ, founder", path: "/gateq?tab=applications" },
  { id: "fnd-gate-form", acct: "founder", title: "An investor's gate", path: () => `/g/${ids.gate}` },
  { id: "fnd-gate-interview", acct: "founder", title: "GateQ interview", path: () => `/g/${ids.gate}`, needs: "apply", run: async (c) => {
      const name = c.page.getByLabel(/^Full name/).first();
      if (await name.count() && !(await name.inputValue())) await name.fill("Babatunde Oyelaran");
      const role = c.page.getByLabel(/^Your role/).first();
      if (await role.count() && !(await role.inputValue())) await role.fill("Founder & CEO");
      await c.clickButton(/^Confirm and continue$/, { optional: true });
      await c.page.waitForTimeout(6000);
      for (const name of [/^Continue$/, /^Start$/, /^Begin$/, /Start the interview/]) await c.clickButton(name, { optional: true, quiet: true });
      await c.page.waitForTimeout(20000);
    } },
  { id: "fnd-rehearsals", acct: "founder", title: "Rehearsals, founder", path: "/rehearsals" },
  { id: "fnd-rehearsal-lobby", acct: "founder", title: "Rehearsal lobby, founder", path: () => `/rehearsals/investor/${ids.savanna}`, wait: 20000 },
  { id: "fnd-work", acct: "founder", title: "Q Work, founder", path: "/work" },
  { id: "fnd-q-ask", acct: "founder", title: "Q answer, founder", path: "/home", needs: "q", run: async (c) => {
      await c.askQ("What is missing before investors will take a first call with us? Keep it short.");
      await c.showChat();
    } },
  { id: "fnd-q-chat", acct: "founder", title: "Q answer, founder (reopened)", path: "/home", run: async (c) => {
      await c.openConversations();
      await c.page.getByRole("dialog").locator("li").first().click().catch(() => {});
      await c.page.waitForTimeout(6000);
      const x = c.page.getByRole("dialog").getByRole("button", { name: /^Close/ }).first();
      if (await x.count()) await x.click().catch(() => {});
      await c.page.waitForTimeout(2000);
      await c.showChat();
    } },
  { id: "fnd-profile", acct: "founder", title: "Profile", path: "/profile" },
  { id: "fnd-qcard", acct: "founder", title: "Q Card", path: "/profile", run: async (c) => { await c.scrollTo("Q Card"); } },
  { id: "fnd-team", acct: "founder", title: "Team", path: "/settings/team" },
  { id: "fnd-invite", acct: "founder", title: "Invite people", path: "/settings/team", run: async (c) => { await c.clickButton(/^Invite people$/); } },
  { id: "fnd-onboarding", acct: "founder", title: "Founder setup", path: "/onboarding/founder" },
  { id: "fnd-qpitch", acct: "founder", title: "Q Pitch, founder", path: "/q-pitch" },

  // ---------- Founder (Ledgerfold) ----------
  { id: "led-home", acct: "ledgerfold", title: "Q (home), Ledgerfold", path: "/home", wait: 4000 },
  { id: "led-interest", acct: "ledgerfold", title: "Investor interest, to answer", path: "/company/interest" },
  { id: "led-crm", acct: "ledgerfold", title: "Fundraising Hub, Ledgerfold", path: "/relationships" },
  { id: "led-crm-board", acct: "ledgerfold", title: "Fundraising Hub board", path: "/relationships?view=pipeline&layout=board" },
  { id: "led-deck", acct: "ledgerfold", title: "Deck Q prepared", path: () => `/company/${ids.ledgerfold}?tab=deck`, run: async (c) => { await c.scrollTo(/deck/i); } },
];

const ids = {};

// Annotation labels come from the guide source itself (marks="1:Save,2:Pass"),
// so the numbered dots and the pictures never drift apart.
const GUIDE_SRC = resolve(here, "../../../docs/guide/guide.src.html");
if (existsSync(GUIDE_SRC)) {
  const marksById = {};
  for (const m of readFileSync(GUIDE_SRC, "utf8").matchAll(/<shot\s+id="([^"]+)"[^>]*?marks="([^"]*)"/g)) {
    const labels = m[2].split(",").map((x) => x.split(":").slice(1).join(":").trim()).filter(Boolean);
    marksById[m[1]] = [...new Set([...(marksById[m[1]] ?? []), ...labels])];
  }
  for (const s of SHOTS) if (marksById[s.id]) s.marks = marksById[s.id];
}

async function signIn(email) {
  const t0 = Date.now();
  const res = await fetch(`https://${REF}.supabase.co/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const ms = Date.now() - t0;
  const sess = await res.json();
  if (!sess.access_token) throw new Error(`sign-in failed for ${email} (${res.status})`);
  if (ms > 5000) throw new Error(`sign-in took ${ms} ms; production is struggling, stopping`);
  return sess;
}

function cookiesFor(sess) {
  const host = new URL(WEB).host;
  const val = "base64-" + Buffer.from(JSON.stringify(sess)).toString("base64url");
  const name = `sb-${REF}-auth-token`;
  const chunks = [];
  for (let i = 0; i < val.length; i += 3180) chunks.push(val.slice(i, i + 3180));
  return chunks.map((c, i) => ({ name: chunks.length === 1 ? name : `${name}.${i}`, value: c, domain: host, path: "/", secure: true, sameSite: "Lax" }));
}

let last = 0;
function helpers(page) {
  const c = {
    page,
    async go(p) {
      const gap = Date.now() - last;
      if (gap < 2000) await sleep(2000 - gap);
      last = Date.now();
      const r = await page.goto(WEB + p, { waitUntil: "load", timeout: 60000 }).catch(() => null);
      // Some pages poll (Q room, inbox), so network idle may never come; cap the wait.
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      if (r && r.status() >= 500) throw new Error(`HTTP ${r.status()} on ${p}`);
      await page.waitForTimeout(2500);
      await page.addStyleTag({ content: DECLUTTER }).catch(() => {});
    },
    /** Close Q's spoken-greeting caption (bottom right); it is local and comes back next visit. */
    async closeArrival() {
      const closed = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => {
          const r = x.getBoundingClientRect();
          return x.textContent.trim() === "Close" && r.top > 650 && r.left > 950 && r.width > 0;
        });
        if (b) b.click();
        return Boolean(b);
      });
      if (closed) await page.waitForTimeout(800);
    },
    async clickButton(name, { optional = false, quiet = false } = {}) {
      const b = page.getByRole("button", { name }).first();
      if (!(await b.count())) {
        if (optional) return false;
        throw new Error(`no button ${name}`);
      }
      await b.scrollIntoViewIfNeeded().catch(() => {});
      await b.click({ timeout: 10000 }).catch((e) => { if (!quiet) console.log("  click failed", String(name), e.message.slice(0, 80)); });
      await page.waitForTimeout(2500);
      return true;
    },
    async scrollTo(name) {
      const h = page.getByRole("heading", { name }).first();
      if (await h.count()) {
        await h.evaluate((el) => el.scrollIntoView({ block: "start" }));
        await page.evaluate(() => window.scrollBy(0, -24));
        await page.waitForTimeout(1200);
      }
    },
    async scrollToText(text, role) {
      const el = role ? page.getByRole(role, { name: text }).first() : page.getByText(text).first();
      if (await el.count()) {
        await el.evaluate((n) => n.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(1200);
      }
    },
    async selectApplication(name) {
      await c.page.locator("main").getByText(name, { exact: true }).first().click().catch(() => {});
      await c.page.waitForTimeout(3500);
    },
    async expandNav() {
      for (const label of ["Workspace", "You"]) {
        const b = page.locator("nav").getByRole("button", { name: new RegExp(`^${label}`) }).first();
        if (await b.count()) {
          const expanded = await b.getAttribute("aria-expanded");
          if (expanded !== "true") await b.click().catch(() => {});
          await page.waitForTimeout(600);
        }
      }
    },
    async openConversations() {
      await page.getByRole("button", { name: /Conversations/ }).first().click();
      await page.waitForTimeout(4000);
    },
    /** Reopen a past chat; `anchor` scrolls that text (first match, or last if `last`) to the top. */
    async openConversation(title, anchor, last = false) {
      await c.openConversations();
      await page.getByRole("dialog").getByText(title).first().click();
      await page.waitForTimeout(6000);
      const x = page.getByRole("dialog").getByRole("button", { name: /^Close/ }).first();
      if (await x.count()) await x.click().catch(() => {});
      await page.waitForTimeout(3000);
      // The Q room opens on its stage; the Chat view shows the conversation and its cards.
      const chat = page.getByRole("button", { name: /^Chat$/ }).or(page.getByRole("tab", { name: /^Chat$/ })).first();
      if (await chat.count()) { await chat.click().catch(() => {}); await page.waitForTimeout(3000); }
      if (anchor) {
        await page.evaluate(({ anchor, last }) => {
          const walker = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
          const hits = [];
          for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.includes(anchor)) hits.push(n.parentElement);
          const el = last ? hits.at(-1) : hits[0];
          if (el) { el.scrollIntoView({ block: "start" }); for (let p = el.parentElement; p; p = p.parentElement) if (p.scrollHeight > p.clientHeight + 10) { p.scrollTop -= 90; break; } }
        }, { anchor, last });
        await page.waitForTimeout(1500);
      }
    },
    async showChat() {
      const chat = page.getByRole("button", { name: /^Chat$/ }).first();
      if (await chat.count()) { await chat.click().catch(() => {}); await page.waitForTimeout(3000); }
    },
    async askQ(text) {
      const box = page.getByRole("textbox", { name: /Message Q/i }).or(page.getByPlaceholder("Message Q")).first();
      await box.click();
      await box.fill(text);
      await page.keyboard.press("Enter");
      await waitForQ(page);
    },
    async askWork(text) {
      await page.getByText("Give Q a task").first().click().catch(() => {});
      await page.waitForTimeout(1500);
      const box = page.getByRole("textbox").last();
      await box.fill(text);
      await page.keyboard.press("Enter");
      await waitForQ(page);
    },
  };
  return c;
}

/** Wait for Q to finish: the page text stops changing for 8 s (max 120 s). */
async function waitForQ(page) {
  let prev = "", still = 0;
  const t0 = Date.now();
  await page.waitForTimeout(6000);
  while (Date.now() - t0 < 120000) {
    const now = await page.evaluate(() => document.body.innerText.length + ":" + document.body.innerText.slice(-400));
    if (now === prev) { still += 2000; if (still >= 8000) break; } else { still = 0; prev = now; }
    await page.waitForTimeout(2000);
  }
}

/**
 * Where each annotated control sits, for build.mjs's numbered dots: the first
 * visible button, link, tab or heading whose accessible text starts with the
 * label (an exact match wins), inside the 1440x900 viewport.
 */
async function boxesFor(page, labels) {
  return page.evaluate((labels) => {
    const out = {};
    const els = [...document.querySelectorAll("button,a,[role=tab],[role=button],h1,h2,h3,label,summary,input,textarea")];
    const name = (el) => (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.innerText || "").replace(/\s+/g, " ").trim();
    for (const label of labels) {
      const visible = els.filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > 900 || r.right < 0 || r.left > 1440) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
      });
      // Buttons first: a rail button and a same-named tab or link can both match.
      const ranked = [...visible].sort((x, y) => Number(y.tagName === "BUTTON") - Number(x.tagName === "BUTTON"));
      const hit = ranked.find((el) => name(el) === label) ?? ranked.find((el) => name(el).startsWith(label));
      if (hit) { const r = hit.getBoundingClientRect(); out[label] = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }
    }
    return out;
  }, labels);
}

async function resolveIds(acct, c) {
  const hrefFor = async (pattern, text) => c.page.evaluate(({ pattern, text }) => {
    const a = [...document.querySelectorAll("a[href]")].find((x) => new RegExp(pattern).test(x.getAttribute("href")) && (!text || x.textContent.includes(text)));
    return a ? a.getAttribute("href") : null;
  }, { pattern, text });
  if (acct === "investor") {
    await c.go("/relationships");
    ids.ledgerfold ??= (await hrefFor("^/relationships/company/[0-9a-f-]+$", "Ledgerfold"))?.split("/").pop();
    ids.second ??= (await hrefFor("^/relationships/company/[0-9a-f-]+$", "Harbourline"))?.split("/").pop();
    await c.go("/rehearsals");
    ids.rehearsal ??= (await hrefFor("^/rehearsals/r/", null))?.split("/").pop();
    await c.go("/gateq?tab=gate");
    ids.gate ??= (await hrefFor("^/g/gq_", null))?.split("/").pop();
  }
  if (acct === "founder") {
    await c.go("/relationships");
    ids.savanna ??= (await hrefFor("^/relationships/investor/[0-9a-f-]+$", "Savanna"))?.split("/").pop();
    await c.go("/company/data-room");
    ids.harbourline ??= new URL(c.page.url()).pathname.split("/")[2];
  }
  if (acct === "ledgerfold" && !ids.ledgerfold) {
    await c.go("/home");
    ids.ledgerfold = (await hrefFor("^/company/[0-9a-f-]+$", null))?.split("/").pop();
  }
  console.log("ids", acct, JSON.stringify(ids));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const manifestPath = resolve(OUT, "manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  const chromium = await loadChromium();
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {}),
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
    args: ["--ignore-certificate-errors", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const wanted = (s) => (ONLY.length === 0 || ONLY.includes(s.id)) && (s.needs !== "q" || WITH_Q) && (s.needs !== "apply" || WITH_APPLY);
  // Founder first: the investor's ids (Ledgerfold, gate) are resolved when the investor runs,
  // so order the accounts so every id is known before it is used.
  const order = [null, "investor", "founder", "ledgerfold"];
  try {
    for (const acct of order) {
      const shots = SHOTS.filter((s) => s.acct === acct && wanted(s));
      if (!shots.length && !(acct === "investor" && SHOTS.some((s) => wanted(s) && s.acct !== "investor" && typeof s.path === "function"))) continue;
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", ignoreHTTPSErrors: true });
      await ctx.addInitScript(() => { try { localStorage.setItem("cq.theme", "light"); } catch {} });
      if (acct) await ctx.addCookies(cookiesFor(await signIn(ACCOUNTS[acct])));
      if (acct) {
        const idPage = await ctx.newPage();
        await resolveIds(acct, helpers(idPage));
        await idPage.close();
      }
      for (const s of shots) {
        const p = typeof s.path === "function" ? s.path() : s.path;
        // A fresh tab per shot: a renderer crash on one page (the shared VM
        // runs short of memory) then costs one shot, not the rest of the run.
        const page = await ctx.newPage();
        const c = helpers(page);
        try {
          await c.go(p);
          if (s.wait) await page.waitForTimeout(s.wait);
          if (s.run) await s.run(c);
          await c.closeArrival();
          if (s.marks) writeFileSync(resolve(OUT, `${s.id}.marks.json`), JSON.stringify(await boxesFor(page, s.marks), null, 1));
          await page.screenshot({ path: resolve(OUT, `${s.id}.png`) });
          manifest[s.id] = { title: s.title, url: p, at: new Date().toISOString(), ok: true };
          console.log("ok  ", s.id, p);
        } catch (e) {
          manifest[s.id] = { title: s.title, url: p, at: new Date().toISOString(), ok: false, error: String(e.message ?? e).slice(0, 200) };
          console.log("FAIL", s.id, p, String(e.message ?? e).slice(0, 160));
          if (/HTTP 5\d\d/.test(String(e.message))) { console.log("Production returned a 5xx; stopping. Wait 5 minutes before re-running."); throw e; }
        }
        await page.close().catch(() => {});
      }
      await ctx.close();
    }
  } finally {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    await browser.close();
  }
}

await main();
