/** Real selected-dossier browser acceptance using an existing authorized session.
 * Required: CQ_PUBLIC_JSON, CQ_SESSION_FILE, CQ_GATEQ_DOSSIER_FIXTURE_FILE
 * containing gatewayId, applicationId, companyName and optional expectedTerms.
 * --ask creates ONE internal Q turn; no messages, decisions, uploads or submissions.
 * Evidence and Q output stay in a private temporary directory. No fixture data is logged.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { getGateqInboxItem } from "../../../packages/api-client/dist/index.js";
const require = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);
const { createServerClient } = require("@supabase/ssr");
const required = (name) => {
  assert.ok(process.env[name], `Set ${name}`);
  return process.env[name];
};
const config = JSON.parse(readFileSync(required("CQ_PUBLIC_JSON"), "utf8"));
const file = required("CQ_SESSION_FILE");
const saved = JSON.parse(readFileSync(file, "utf8"));
const fixture = JSON.parse(
  readFileSync(required("CQ_GATEQ_DOSSIER_FIXTURE_FILE"), "utf8"),
);
for (const key of ["gatewayId", "applicationId"])
  assert.match(fixture[key], /^[0-9a-f-]{36}$/i, `Invalid ${key}`);
assert.equal(typeof fixture.companyName, "string");
const web =
  process.env.CQ_DEMO_WEB_URL ??
  "https://capital-qweb-production.up.railway.app";
const api =
  process.env.CQ_GATEQ_API_URL ??
  "https://capital-qapi-production.up.railway.app";
const qApi =
  process.env.CQ_Q_API_URL ??
  "https://capital-qq-api-production.up.railway.app";
const evidence = mkdtempSync(join(tmpdir(), "cq-gateq-dossier-q-"));
chmodSync(evidence, 0o700);
const write = (name, data) =>
  writeFileSync(join(evidence, name), JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
const cookies = new Map();
const client = createServerClient(
  config.NEXT_PUBLIC_SUPABASE_URL,
  config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    cookieOptions: {
      secure: web.startsWith("https:"),
      httpOnly: true,
      sameSite: "lax",
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
const signed = await client.auth.setSession(saved);
assert.ifError(signed.error);
assert.ok(signed.data.session, "Authorized session unavailable");
const session = signed.data.session;
writeFileSync(file, JSON.stringify(session), { mode: 0o600 });
const detail = await getGateqInboxItem(
  { baseUrl: api, accessToken: session.access_token },
  fixture.gatewayId,
  fixture.applicationId,
);
assert.equal(detail.item.applicationId, fixture.applicationId);
assert.ok(detail.dossier, "Fixture must be a real frozen submitted dossier");
write("authorized-source.json", detail);
const browser = await chromium.launch({
  executablePath: process.env.CQ_DEMO_CHROMIUM_PATH ?? "/usr/bin/chromium",
  proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" },
  args: ["--no-sandbox"],
});
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    ignoreHTTPSErrors: false,
  });
  await context.addCookies(
    [...cookies.values()].map((c) => ({
      name: c.name,
      value: c.value,
      domain: new URL(web).hostname,
      path: "/",
      secure: web.startsWith("https:"),
      httpOnly: true,
      sameSite: "Lax",
    })),
  );
  await context.addInitScript(() =>
    sessionStorage.setItem("cq.splash.seen", "1"),
  );
  page = await context.newPage();
  const runs = [];
  page.on("request", (r) => {
    const m = /\/q\/runs\/([0-9a-f-]{36})\/events/i.exec(
      new URL(r.url()).pathname,
    );
    if (m) runs.push(m[1]);
  });
  const response = await page.goto(
    `${web}/gateq?item=${encodeURIComponent(fixture.applicationId)}`,
    { waitUntil: "domcontentloaded", timeout: 60000 },
  );
  assert.ok(response.ok(), "GateQ page refused");
  assert.equal(new URL(page.url()).pathname, "/gateq", "Workspace redirected");
  await page
    .getByText(fixture.companyName, { exact: true })
    .first()
    .waitFor({ timeout: 45000 });
  const close = page.getByRole("button", {
    name: "Close Q's briefing",
    exact: true,
  });
  if (await close.isVisible()) await close.click();
  await page.screenshot({
    path: join(evidence, "selected-dossier.png"),
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      phase: "selected-dossier",
      authorized: true,
      frozenSource: true,
    }),
  );
  if (process.argv.includes("--ask")) {
    const input = page.getByPlaceholder("Ask Q", { exact: true });
    if (!(await input.isVisible()))
      await page.locator("[data-q-dock-button]:visible").first().click();
    await input.waitFor({ timeout: 30000 });
    const before = new Set(runs);
    const priorAnswerTexts = new Set(
      await page.locator("[data-q-answer]:visible").allTextContents(),
    );
    await input.fill(
      "Read the selected submitted GateQ dossier. Explain this founder's business, supplied traction and use of funds, qualification, missing evidence and next review actions. Distinguish applicant claims from verified evidence and cite the submitted sources. Do not send anything.",
    );
    const started = performance.now();
    await input.press("Enter");
    await page.waitForFunction(
      () =>
        document.querySelector(
          '[data-q-answer="streaming"], [data-q-answer="settled"]',
        ),
      null,
      { timeout: 60000 },
    );
    let run,
      runId,
      firstTextMs = null;
    for (let i = 0; i < 180; i++) {
      runId = runs.findLast((id) => !before.has(id));
      const rendered = await page
        .locator("[data-q-answer]:visible")
        .last()
        .textContent()
        .catch(() => "");
      if (firstTextMs === null && rendered.trim().length >= 20 && runId)
        firstTextMs = Math.round(performance.now() - started);
      if (runId) {
        write("observed-run.json", { runId });
        const r = await fetch(`${qApi}/v1/q/runs/${runId}`, {
          headers: { authorization: `Bearer ${session.access_token}` },
        });
        assert.ok(r.ok, "Owned Q run refused");
        run = await r.json();
        if (
          [
            "COMPLETED",
            "FAILED",
            "AWAITING_INPUT",
            "AWAITING_APPROVAL",
          ].includes(run.status)
        )
          break;
      }
      await page.waitForTimeout(500);
    }
    write("q-run.json", run ?? {});
    assert.equal(
      run?.status,
      "COMPLETED",
      "Q did not complete the substantive reading",
    );
    const answer = await page
      .locator('[data-q-answer="settled"]:visible')
      .last()
      .textContent();
    write("rendered-answer.json", {
      answer,
      runId,
      firstTextMs,
      totalMs: Math.round(performance.now() - started),
    });
    await page.screenshot({
      path: join(evidence, "q-answer.png"),
      fullPage: true,
    });
    assert.ok(answer.length > 250, "Q response is not substantive");
    assert.doesNotMatch(
      answer,
      /(?:cannot|can't|unable to|do not|don't) (?:currently )?(?:access|read|see|retrieve).{0,80}(?:dossier|application|submission)/i,
      "Q refused access to the authorized selected dossier",
    );
    assert.doesNotMatch(
      answer,
      /dossier.{0,90}(?:unavailable|not available)|(?:unavailable|not available).{0,90}dossier/is,
      "Q reports that the selected dossier is unavailable",
    );
    assert.ok(
      answer.toLowerCase().includes(fixture.companyName.toLowerCase()),
      "Q lost the selected application identity",
    );
    for (const term of fixture.expectedTerms ?? [])
      assert.ok(
        answer.toLowerCase().includes(term.toLowerCase()),
        "Verified fixture statement missing from answer",
      );
    assert.match(
      answer,
      /claim|self.report|not verified|unverified|founder.report|founder.declar/i,
      "Q did not distinguish applicant claims",
    );
    console.log(
      JSON.stringify({
        phase: "substantive-Q",
        status: "PASS",
        firstTextMs,
        totalMs: Math.round(performance.now() - started),
      }),
    );
  }
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: join(evidence, "failure.png"), fullPage: true })
      .catch(() => {});
    write("failure-page.json", { html: await page.content().catch(() => "") });
  }
  console.error(
    JSON.stringify({ status: "FAIL", reason: error.message, evidence }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
  console.log(JSON.stringify({ evidence }));
}
