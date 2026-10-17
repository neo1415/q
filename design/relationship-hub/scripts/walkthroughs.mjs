// Records the four Relationship Hub walkthrough videos from the real rendered
// prototype (Playwright + Chromium), then converts each WebM to MP4 with ffmpeg.
// Usage (repo root, static server on :4321 serving the repo root):
//   node design/relationship-hub/scripts/walkthroughs.mjs [outDir] [only]
// Videos are written outside git. Nothing here calls a provider or the network.
import { createRequire } from "node:module";
import { mkdirSync, renameSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const require = createRequire(import.meta.url);
const pw = require(require.resolve("@playwright/test", { paths: [process.cwd(), "/home/user/q"] }));
const BASE = process.env.HUB_URL ?? "http://127.0.0.1:4321/design/relationship-hub/index.html";
const OUT = process.argv[2] ?? "/home/user/q/design-deliverables/relationship-hub";
const ONLY = process.argv[3] ?? null;
mkdirSync(OUT, { recursive: true });

// A visible cursor and a caption strip, injected into the page for the recording only.
const OVERLAY = () => {
  const add = () => {
    if (document.getElementById("rec-cursor")) return;
    const st = document.createElement("style");
    st.textContent = `#rec-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:transform 60ms linear}
#rec-cursor svg{width:22px;height:22px;filter:drop-shadow(0 1px 1px rgb(0 0 0 / .45))}
#rec-cursor.down svg{transform:scale(.85)}
.rec-ripple{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid var(--cq-accent);z-index:2147483646;pointer-events:none;animation:recr 500ms ease-out forwards}
@keyframes recr{from{opacity:.9;transform:scale(.4)}to{opacity:0;transform:scale(1.4)}}
#rec-cap{position:fixed;left:50%;top:44px;transform:translateX(-50%);z-index:2147483645;background:var(--cq-text-primary);color:var(--cq-text-inverse);font:500 14px/1.3 var(--cq-font-ui);padding:7px 14px;border-radius:999px;pointer-events:none;max-width:92vw;text-align:center;box-shadow:var(--cq-shadow-overlay)}
#rec-cap:empty{display:none}`;
    document.head.appendChild(st);
    const c = document.createElement("div");
    c.id = "rec-cursor";
    c.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="white" stroke="black" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const cap = document.createElement("div"); cap.id = "rec-cap"; document.body.appendChild(cap);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => { c.classList.add("down"); const r = document.createElement("div"); r.className = "rec-ripple"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px"; document.body.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
    addEventListener("mouseup", () => c.classList.remove("down"), true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", add); else add();
};

function helpers(page) {
  let pos = { x: 700, y: 450 };
  const wait = (ms) => page.waitForTimeout(ms);
  const caption = (t) => page.evaluate((t) => { const c = document.getElementById("rec-cap"); if (c) c.textContent = t; }, t);
  const moveTo = async (x, y, steps = 28) => { await page.mouse.move(x, y, { steps }); pos = { x, y }; };
  const point = async (sel, nth = 0) => {
    const loc = page.locator(sel).nth(nth);
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    if (!b) throw new Error("no box for " + sel);
    await moveTo(b.x + Math.min(b.width / 2, 60), b.y + b.height / 2);
    return loc;
  };
  const click = async (sel, nth = 0, pause = 900) => { await point(sel, nth); await wait(350); await page.mouse.down(); await wait(80); await page.mouse.up(); await wait(pause); };
  const hover = async (sel, nth = 0, pause = 900) => { await point(sel, nth); await wait(pause); };
  const scroll = async (dy, steps = 8) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await wait(60); } await wait(500); };
  const type = async (text) => { await page.keyboard.type(text, { delay: 55 }); };
  return { wait, caption, moveTo, click, hover, scroll, type, get pos() { return pos; } };
}

const SCRIPTS = {
  async "1-investor-walkthrough"(page, h) {
    await h.caption("Investor · Investment Hub overview: a permission-filtered Q briefing, then what needs you");
    await h.wait(3500);
    await h.hover('[data-q="section.needs-you"] .row', 0, 1500);
    await h.hover('[data-q="filter.stage-in_diligence"]', 0, 1200);
    await h.caption("Pipeline: one row per canonical relationship, with saved views, filters and display kept apart");
    await h.click('[data-q="tab.hub-pipeline"]', 0, 2000);
    await h.click('[data-q="button.layout-board"]', 0, 2600);
    await h.caption("Board columns are derived states. Moving a card opens the typed action; it never edits a stage directly");
    await h.wait(2500);
    await h.click('[data-q="button.layout-table"]', 0, 1200);
    await h.click('[data-q="filter.stage-in_diligence"]', 0, 1800);
    await h.caption("Company record: identity, stage, owner and next action, with five separate readings and no single score");
    await h.click('[data-q="item.pipeline-1"]', 0, 3500);
    await h.hover(".axes .axis", 0, 1200);
    await h.hover(".axes .axis", 2, 1200);
    await h.scroll(380);
    await h.wait(2000);
    await h.scroll(-380);
    await h.caption("GateQ dossier: the application exactly as submitted, with the Q interview transcript beside it");
    await h.click('[data-q="tab.record-gateq"]', 0, 3500);
    await h.caption("Meeting: each line of Q's summary links to a timestamped transcript passage");
    await h.click('[data-q="tab.record-meetings"]', 0, 2200);
    await h.click('[data-q="button.summary-2"]', 0, 3500);
    await h.click('[data-q="button.summary-4"]', 0, 3000);
    await h.caption("Evidence: truth class, evidence status and lifecycle stay separate, and contradictions are kept until reconciled");
    await h.click('[data-q="tab.record-evidence"]', 0, 2500);
    await h.hover('[data-q="item.claim-2"]', 0, 2200);
    await h.caption("The source opens at its page: Financial model v3, an immutable version, page 7");
    await h.click('[data-q="button.claim-2-source"]', 0, 3200);
    await h.click('[data-q="button.document-next"]', 0, 1800);
    await h.click('[data-q="button.document-previous"]', 0, 2000);
    await h.caption("Next action: Q drafted the follow-up, and it is sent only after you approve this exact text");
    await h.click('[data-q="tab.record-work"]', 0, 2000);
    await h.click('.row.link[data-action="work:w2"]', 0, 3500);
    await h.scroll(420);
    await h.wait(1500);
    await h.click('[data-q="button.approval-approve"]', 0, 600);
    await h.caption("States are honest: acknowledged while sending, completed only with a server receipt (simulated)");
    await h.wait(3500);
    await h.caption("");
    await h.wait(1200);
  },

  async "2-founder-walkthrough"(page, h) {
    await h.caption("Founder · Fundraising Hub: the same canonical relationships, seen from the company's side");
    await h.click('#role-seg button:nth-child(2)', 0, 3500);
    await h.hover('.briefing', 0, 2000);
    await h.scroll(360);
    await h.wait(2200);
    await h.scroll(-360);
    await h.caption("Investors: a pipeline over relationship state, never a separate investor database");
    await h.click('[data-q="tab.hub-investors"]', 0, 2400);
    await h.click('[data-q="button.layout-board"]', 0, 2600);
    await h.click('[data-q="button.layout-table"]', 0, 1400);
    await h.caption("Investor record: only what Northgate shared. Their private notes and deliberations never appear here");
    await h.click('[data-q="item.investor-1"]', 0, 3800);
    await h.caption("Meeting: the founder's notes, with each line linked to its timestamped passage");
    await h.click('[data-q="tab.record-meetings"]', 0, 2000);
    await h.click('[data-q="button.summary-4"]', 0, 3200);
    await h.caption("Request: two customer references, due Monday. A response is a scoped share the founder confirms");
    await h.click('[data-q="tab.record-requests"]', 0, 2500);
    await h.click('[data-q="section.requests"] .btn.primary', 0, 3000);
    await h.caption("Fundraising: confirmed commitments are kept separate from amounts that were only stated");
    await h.click('[data-q="button.record-back"]', 0, 1500);
    await h.click('[data-q="tab.hub-fundraising"]', 0, 3800);
    await h.caption("Update: Q drafts the investor update from the founder's own documents, and the founder approves and sends it");
    await h.click('[data-q="tab.hub-updates"]', 0, 4200);
    await h.caption("Q recommendation: source-backed, and drawn only from what the investors shared");
    await h.click('[data-q="tab.hub-overview"]', 0, 1500);
    await h.scroll(700);
    await h.hover('[data-q="section.founder-q"] .label.outline', 0, 2500);
    await h.click('.q-dock', 0, 1200);
    await h.click('.suggest button', 0, 300);
    await h.wait(6500);
    await h.caption("");
    await h.wait(1500);
  },

  async "3-q-controls-workspace"(page, h) {
    await h.caption("Q controls the workspace: each control has a stable semantic id and a typed act with a receipt");
    await h.wait(2500);
    await h.click('.q-dock', 0, 1200);
    await h.caption("Ask in words. Q plans its acts, and each one goes requested → acknowledged → completed or failed");
    await h.click("#q-input", 0, 300);
    await h.type("Show me the margin evidence for Halden Grid");
    await h.wait(700);
    await page.keyboard.press("Enter");
    await h.moveTo(980, 520, 20);
    await h.caption("Q acts by control id: search, filter, open, tab, scroll, page 7, 22:05, Q Work job, return");
    await page.waitForFunction(() => !window.HUB.S.qWorking, null, { timeout: 120000 });
    await h.wait(2500);
    await h.caption("Back on the original record. Every receipt came from the page's own read-back, never an assumed Done");
    await h.hover(".acts .act", 0, 2500);
    await h.caption("Source-backed comparison: every figure cites its document; an unknown stays unknown");
    await h.click('.suggest button:nth-child(3)', 0, 300);
    await page.waitForFunction(() => !window.HUB.S.qWorking, null, { timeout: 60000 });
    await h.wait(3500);
    await h.caption("A failed act is reported as failed: no term sheet was shared, so Q opens nothing in its place");
    await h.click('.suggest button:nth-child(4)', 0, 300);
    await page.waitForFunction(() => !window.HUB.S.qWorking, null, { timeout: 60000 });
    await h.wait(4500);
    await h.caption("");
    await h.wait(1000);
  },

  async "4-mobile"(page, h) {
    await h.caption("Mobile · Investment Hub");
    await h.wait(3000);
    await h.scroll(500);
    await h.wait(1500);
    await h.scroll(-500);
    await h.click('[data-q="tab.hub-pipeline"]', 0, 2200);
    await h.caption("On mobile, table rows stack");
    await h.scroll(300);
    await h.wait(1200);
    await h.scroll(-300);
    await h.click('[data-q="item.pipeline-1"]', 0, 3200);
    await h.caption("Record: five separate readings, then the tabs");
    await h.scroll(420);
    await h.wait(2200);
    await h.scroll(-420);
    await h.caption("Meeting: a summary line jumps to its transcript passage");
    await h.click('[data-q="tab.record-meetings"]', 0, 1800);
    await h.scroll(520);
    await h.click('[data-q="button.summary-2"]', 0, 2400);
    await h.scroll(500);
    await h.wait(2200);
    await h.caption("Q opens as a bottom sheet");
    await h.click('.q-dock', 0, 1200);
    await h.click('.suggest button:nth-child(3)', 0, 300);
    await page.waitForFunction(() => !window.HUB.S.qWorking, null, { timeout: 60000 });
    await h.wait(2000);
    await h.click('.q-panel header .btn', 0, 1500);
    await h.scroll(400);
    await h.wait(2500);
    await h.caption("Founder · Fundraising Hub on mobile");
    await page.evaluate(() => window.scrollTo(0, 0));
    await h.click('#role-seg button:nth-child(2)', 0, 3000);
    await h.scroll(600);
    await h.wait(2500);
    await h.scroll(-600);
    await h.click('[data-q="tab.hub-investors"]', 0, 2000);
    await h.click('[data-q="item.investor-1"]', 0, 3000);
    await h.caption("");
    await h.wait(1200);
  },
};

const CONFIG = {
  "1-investor-walkthrough": { vp: { width: 1440, height: 900 }, theme: "light", hash: "#investor/overview" },
  "2-founder-walkthrough": { vp: { width: 1440, height: 900 }, theme: "dark", hash: "#investor/overview" },
  "3-q-controls-workspace": { vp: { width: 1440, height: 900 }, theme: "light", hash: "#investor/record/halden/overview", pace: 1.5 },
  "4-mobile": { vp: { width: 430, height: 932 }, theme: "light", hash: "#investor/overview", mobile: true },
};

const ffmpeg = (() => { try { return execFileSync("which", ["ffmpeg"]).toString().trim(); } catch { return null; } })();
const browser = await pw.chromium.launch({ executablePath: process.env.CQ_CHROMIUM ?? "/opt/pw-browsers/chromium" });
for (const [name, run] of Object.entries(SCRIPTS)) {
  if (ONLY && !name.startsWith(ONLY)) continue;
  const cfg = CONFIG[name];
  const tmp = path.join(OUT, ".rec-" + name);
  rmSync(tmp, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: cfg.vp, colorScheme: cfg.theme, isMobile: !!cfg.mobile, deviceScaleFactor: 1, recordVideo: { dir: tmp, size: cfg.vp } });
  await ctx.addInitScript(OVERLAY);
  if (cfg.pace) await ctx.addInitScript((p) => { window.HUB_PACE = p; }, cfg.pace);
  await ctx.addInitScript(() => { try { localStorage.removeItem("cq.theme"); } catch {} });
  const page = await ctx.newPage();
  await page.goto(`${BASE}?theme=${cfg.theme}${cfg.hash}`);
  await page.waitForTimeout(600);
  const h = helpers(page);
  await page.mouse.move(cfg.vp.width / 2, cfg.vp.height / 2);
  const t0 = Date.now();
  await run(page, h);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = readdirSync(tmp).find((f) => f.endsWith(".webm"));
  const webmOut = path.join(OUT, name + ".webm");
  renameSync(path.join(tmp, webm), webmOut);
  rmSync(tmp, { recursive: true, force: true });
  if (ffmpeg) {
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", webmOut, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-preset", "medium", "-movflags", "+faststart", path.join(OUT, name + ".mp4")]);
  }
  console.log(name, secs + "s", ffmpeg ? "mp4+webm" : "webm only");
}
await browser.close();
