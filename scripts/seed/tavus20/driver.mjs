/* global process, console */
// Local exploration driver: one Chromium, controlled over 127.0.0.1 only.
//   POST /login   {email, next}   magic-link sign-in through /auth/callback
//   POST /run     <js body>       runs `async (page, ctx, lib, h) => { ... }`
//   GET  /snap?sel=main&max=6000  aria snapshot text
//   GET  /shot?name=x             full-page PNG into the scratchpad
// Tokens and keys stay in memory; responses never echo them.
import http from "node:http";
import * as lib from "./lib.mjs";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    "/home/user/q/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs"
);
const SHOTS =
  process.env.CQ_SHOTS ??
  "/tmp/claude-0/-home-user-q/5e7a5c77-f947-52b0-88c5-5afccae36a31/scratchpad/shots";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  proxy: { server: process.env.HTTPS_PROXY },
  args: ["--ignore-certificate-errors"],
});
let ctx;
let page;
const consoleErrors = [];
const failed = [];
async function fresh() {
  if (ctx) await ctx.close().catch(() => {});
  ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1360, height: 900 },
  });
  await ctx.addInitScript(() => {
    try {
      sessionStorage.setItem("cq.splash.seen", "1");
    } catch {}
  });
  page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400 && /railway\.app|supabase/.test(u))
      failed.push(`${r.status()} ${r.request().method()} ${u.replace(/\?.*/, "")}`);
  });
}
await fresh();
const h = {
  consoleErrors,
  failed,
  snap: async (sel = "body", max = 6000) =>
    (await page.locator(sel).first().ariaSnapshot({ timeout: 15000 })).slice(0, max),
  shot: async (name) => {
    const p = `${SHOTS}/${name}.png`;
    await page.screenshot({ path: p, fullPage: false });
    return p;
  },
  fresh,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let body = "";
  for await (const c of req) body += c;
  const send = (code, text) => {
    res.writeHead(code, { "content-type": "text/plain" });
    res.end(String(text));
  };
  try {
    if (url.pathname === "/login") {
      const { email, next = "/home" } = JSON.parse(body);
      await fresh();
      consoleErrors.length = 0;
      failed.length = 0;
      const hash = await lib.magicTokenHash(email);
      await page.goto(
        `${lib.WEB}/auth/callback?token_hash=${hash}&type=magiclink&next=${encodeURIComponent(next)}`,
        { waitUntil: "domcontentloaded", timeout: 60000 },
      );
      await page.waitForTimeout(4000);
      return send(200, `at ${page.url()}`);
    }
    if (url.pathname === "/run") {
      consoleErrors.length = 0;
      failed.length = 0;
      const fn = new Function(
        "page",
        "ctx",
        "lib",
        "h",
        `return (async () => {${body}})();`,
      );
      const out = await fn(page, ctx, lib, h);
      const extra =
        (failed.length ? `\n[http>=400] ${[...new Set(failed)].join(" | ")}` : "") +
        (consoleErrors.length ? `\n[console] ${consoleErrors.slice(0, 5).join(" | ")}` : "");
      return send(
        200,
        (typeof out === "string" ? out : JSON.stringify(out, null, 1)) + extra,
      );
    }
    if (url.pathname === "/snap") {
      return send(
        200,
        `${page.url()}\n` +
          (await h.snap(url.searchParams.get("sel") ?? "body", Number(url.searchParams.get("max") ?? 6000))),
      );
    }
    if (url.pathname === "/shot") {
      return send(200, await h.shot(url.searchParams.get("name") ?? "shot"));
    }
    if (url.pathname === "/quit") {
      send(200, "bye");
      await browser.close();
      process.exit(0);
    }
    send(404, "?");
  } catch (e) {
    send(500, String(e?.message ?? e).slice(0, 1500));
  }
});
server.listen(7788, "127.0.0.1", () => console.log("driver on 7788"));
