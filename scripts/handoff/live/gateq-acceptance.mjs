import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Read-only live GateQ preflight. This is admission/browser/resume/privacy
 * evidence, not complete application acceptance. No application creation,
 * model call, email, upload, disclosure, submission, approval or provider change.
 * Existing authorized account/session files stay outside Git. Future mutation
 * phases require separate explicit ownership and are deliberately unsupported. */
if (process.argv.slice(2).length) {
  throw new Error(
    "This runner supports read-only preflight only; mutation flags are refused",
  );
}
const gateway = process.env.CQ_GATEQ_PUBLIC_ID;
if (!gateway || !/^gq_[0-9a-hjkmnp-tv-z]{26}$/.test(gateway)) {
  throw new Error("Set CQ_GATEQ_PUBLIC_ID to the isolated, owned test gateway");
}
const web =
  process.env.CQ_GATEQ_WEB_URL ??
  "https://capital-qweb-production.up.railway.app";
const api =
  process.env.CQ_GATEQ_API_URL ??
  "https://capital-qapi-production.up.railway.app";
const supabase =
  process.env.CQ_GATEQ_SUPABASE_URL ??
  "https://vcohxiqsmnkzxnvawgri.supabase.co";
const out = mkdtempSync(join(tmpdir(), "cq-gateq-preflight-"));
chmodSync(out, 0o700);
const receipts = [];
function save(name, value) {
  writeFileSync(join(out, name), JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
}
async function read(path, bearer) {
  const started = performance.now();
  const response = await fetch(new URL(path, api), {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  return {
    status: response.status,
    body,
    ms: Math.round(performance.now() - started),
  };
}
const publicGate = await read(`/v1/gateq/public/${gateway}`);
save("public-gateway.json", publicGate);
if (publicGate.status !== 200)
  throw new Error("Owned public gateway is unavailable");
receipts.push({ phase: "public-gateway", http: 200, ms: publicGate.ms });
const invalid = await read(
  "/v1/gateq/apply/session",
  "invalid-owned-qa-credential",
);
if (invalid.status !== 404 && invalid.status !== 401) {
  throw new Error("Malformed guest credential was not refused");
}
receipts.push({
  phase: "invalid-guest-denied",
  http: invalid.status,
  ms: invalid.ms,
});
const guestTokenFile = process.env.CQ_GATEQ_GUEST_TOKEN_FILE;
if (guestTokenFile) {
  const token = readFileSync(guestTokenFile, "utf8").trim();
  for (const [phase, path] of [
    ["resume", "/v1/gateq/apply/session"],
    ["transcript", "/v1/gateq/apply/transcript"],
    ["coverage", "/v1/gateq/apply/coverage"],
  ]) {
    const result = await read(path, token);
    save(`${phase}.json`, result);
    if (result.status !== 200)
      throw new Error(`Existing owned guest ${phase} refused`);
    receipts.push({ phase, http: 200, ms: result.ms });
  }
}
const browser = await chromium.launch({
  ...(process.env.CQ_GATEQ_CHROMIUM_PATH
    ? { executablePath: process.env.CQ_GATEQ_CHROMIUM_PATH }
    : {}),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY } }
    : {}),
  args: ["--no-sandbox"],
});
try {
  for (const [label, sessionFile] of [
    ["guest", null],
    ["authenticated", process.env.CQ_GATEQ_SESSION_FILE],
  ]) {
    if (label === "authenticated" && !sessionFile) continue;
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    if (sessionFile) {
      const keyFile = process.env.CQ_GATEQ_PUBLIC_KEY_FILE;
      if (!keyFile)
        throw new Error("Authorized browser requires CQ_GATEQ_PUBLIC_KEY_FILE");
      const session = JSON.parse(readFileSync(sessionFile, "utf8"));
      const cookies = new Map();
      const { createServerClient } = createRequire(
        new URL("../../../apps/web/package.json", import.meta.url),
      )("@supabase/ssr");
      const client = createServerClient(
        supabase,
        readFileSync(keyFile, "utf8").trim(),
        {
          cookieOptions: {
            httpOnly: true,
            sameSite: "lax",
            secure: true,
            path: "/",
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
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (signed.error || !signed.data.session)
        throw new Error("Existing authorized session refused");
      // setSession may refresh an existing account's tokens; it never creates or emails an account.
      await context.addCookies(
        [...cookies.values()].map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: new URL(web).hostname,
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        })),
      );
    }
    const forbidden = [];
    await context.route("**/*", (route) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
        forbidden.push(route.request().method());
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const started = performance.now();
    const response = await page.goto(new URL(`/g/${gateway}`, web).href, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.locator("main").waitFor({ state: "visible", timeout: 30_000 });
    if (!response?.ok() || new URL(page.url()).pathname !== `/g/${gateway}`) {
      throw new Error("Gateway browser admission failed");
    }
    const body = await page.locator("main").innerText();
    if (!body.trim()) throw new Error("Gateway rendered no useful content");
    save(`${label}-browser.json`, { body, errors, forbidden });
    await page.screenshot({
      path: join(out, `${label}-desktop.png`),
      fullPage: true,
    });
    chmodSync(join(out, `${label}-desktop.png`), 0o600);
    await page.setViewportSize({ width: 390, height: 844 });
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    if (horizontalOverflow)
      throw new Error("Mobile gateway overflows horizontally");
    await page.screenshot({
      path: join(out, `${label}-mobile.png`),
      fullPage: true,
    });
    chmodSync(join(out, `${label}-mobile.png`), 0o600);
    if (errors.length || forbidden.length)
      throw new Error(
        "Read-only gateway browser emitted errors or attempted mutation",
      );
    receipts.push({
      phase: `${label}-browser-admission`,
      http: response.status(),
      ms: Math.round(performance.now() - started),
      mobileOverflow: false,
    });
    await context.close();
  }
  save("summary.json", {
    stage: "READ_ONLY_PREFLIGHT",
    fullApplicationAccepted: false,
    receipts,
  });
  console.log(
    JSON.stringify({
      stage: "READ_ONLY_PREFLIGHT",
      fullApplicationAccepted: false,
      receipts,
      privateReceiptDirectory: out,
    }),
  );
} finally {
  await browser.close();
}
