// Horizontal-overflow audit at phone width (live check 2026-10-16: founder
// Capital scrolled sideways by 116 px at 390 px). Signs in as each demo
// account, opens its pages at 390 x 844 and reports how far the document
// scrolls sideways, naming the elements past the right edge that no
// scroller clips (and any absolutely placed one that escaped a scroller).
// Read-only: it only opens pages. Exit code 1 when any page overflows.
//
//   NODE_USE_ENV_PROXY=1 CQ_SEED_ACCOUNT_PASSWORD=... SB_PUBLISHABLE=<publishable key> \
//   node scripts/handoff/live/overflow-390.mjs [--width=390]
//
// Secrets come from env only and are never printed. Pages are paced 2.5 s
// apart for the small production database.
import { createRequire } from "node:module";

const need = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return value;
};
const SB_URL = process.env.SB_URL ?? "https://vcohxiqsmnkzxnvawgri.supabase.co";
const REF = new URL(SB_URL).hostname.split(".")[0];
const WEB = process.env.WEB ?? "https://capital-qweb-production.up.railway.app";
const PUBLISHABLE = need("SB_PUBLISHABLE");
const PASSWORD = need("CQ_SEED_ACCOUNT_PASSWORD");
const WIDTH = Number(
  process.argv.find((arg) => arg.startsWith("--width="))?.slice(8) ?? 390,
);

const SHARED = [
  "/home",
  "/discover",
  "/explore",
  "/relationships?view=overview",
  "/relationships?view=pipeline",
  "/relationships?view=pipeline&layout=table",
  "/relationships?view=pipeline&layout=board",
  "/gateq",
  "/work",
  "/settings",
  "/profile",
];
const ACCOUNTS = [
  {
    email: "babatunde.tunde-cargo@fictional.capitalq.local",
    paths: [
      ...SHARED,
      "/discover?tab=videos",
      ...[
        "overview",
        "raise",
        "readiness",
        "action-plan",
        "plan",
        "investors",
      ].map((tab) => `/relationships?view=capital&tab=${tab}`),
    ],
  },
  {
    email: "investor.savanna-seed@fictional.capitalq.local",
    paths: [...SHARED, "/relationships?view=capital", "/investors"],
  },
];

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  const require = createRequire(import.meta.url);
  ({ chromium } = require(
    process.env.PLAYWRIGHT_PATH ??
      "/home/user/q-int/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright",
  ));
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY }
    : undefined,
  args: ["--ignore-certificate-errors"],
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const host = new URL(WEB).hostname;
let failed = false;

for (const { email, paths } of ACCOUNTS) {
  const signIn = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const session = await signIn.json();
  if (!session.access_token) {
    console.log(`${email}: sign-in failed (${String(signIn.status)})`);
    failed = true;
    continue;
  }
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const name = `sb-${REF}-auth-token`;
  const chunks = [];
  for (let i = 0; i < value.length; i += 3180)
    chunks.push(value.slice(i, i + 3180));
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: 844 },
    ignoreHTTPSErrors: true,
  });
  await context.addCookies(
    chunks.map((chunk, i) => ({
      name: chunks.length === 1 ? name : `${name}.${String(i)}`,
      value: chunk,
      domain: host,
      path: "/",
      secure: true,
      sameSite: "Lax",
    })),
  );
  const page = await context.newPage();
  for (const path of paths) {
    const response = await page
      .goto(`${WEB}${path}`, { waitUntil: "networkidle", timeout: 60_000 })
      .catch(() => null);
    await sleep(1500);
    const found = await page.evaluate(() => {
      const root = document.documentElement;
      const edge = root.clientWidth + 1;
      const culprits = [];
      for (const element of document.querySelectorAll("body *")) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.right <= edge) continue;
        let clipped = false;
        for (let up = element.parentElement; up; up = up.parentElement) {
          if (
            window.getComputedStyle(up).overflowX !== "visible" &&
            up.getBoundingClientRect().right <= edge
          ) {
            clipped = true;
            break;
          }
        }
        const absolute = window.getComputedStyle(element).position === "absolute";
        if (!clipped || absolute) {
          culprits.push(
            `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)} right=${String(Math.round(box.right))}`,
          );
        }
      }
      return {
        overflow: root.scrollWidth - root.clientWidth,
        culprits: culprits.slice(0, 5),
      };
    });
    const status = response?.status() ?? "no response";
    console.log(
      `${found.overflow > 0 ? "FAIL" : "ok  "} ${email.split("@")[0]} ${path} (${String(status)}) overflow=${String(found.overflow)}${found.overflow > 0 ? ` ${JSON.stringify(found.culprits)}` : ""}`,
    );
    if (found.overflow > 0) failed = true;
    await sleep(2500);
  }
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
