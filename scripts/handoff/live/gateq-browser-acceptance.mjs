/** Native founder GateQ acceptance on an explicitly authorized test gateway.
 * Required: existing founder/investor/other sessions, public config, gateway
 * public id and an owner-approved private fixture of declared application facts.
 * Creates one application and one bounded text interview; --submit permits
 * explicit native Submit to the test gateway. No email, outreach, investor
 * decision, relationship mutation, document sharing or paid video room.
 * Receipts/screenshots contain private data and remain outside Git.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import {
  getApplicationCoverage,
  getApplicationTranscript,
  getCurrentInvestorOrganisation,
  getGateqInbox,
  getGateqInboxItem,
  getPublicGateway,
  listGateways,
  listMyOrganisations,
  resumeApplication,
  submitApplication,
} from "../../../packages/api-client/dist/index.js";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
};
const config = JSON.parse(readFileSync(required("CQ_PUBLIC_JSON"), "utf8"));
const fixture = JSON.parse(
  readFileSync(required("CQ_GATEQ_FACTS_FILE"), "utf8"),
);
for (const name of [
  "companyName",
  "oneLiner",
  "stageLabel",
  "countryLabel",
  "sectorLabel",
  "amount",
  "currency",
])
  assert.equal(
    typeof fixture[name],
    "string",
    `Private declared fixture requires ${name}`,
  );
const publicId = required("CQ_GATEQ_PUBLIC_ID");
const web =
  process.env.CQ_DEMO_WEB_URL ??
  "https://capital-qweb-production.up.railway.app";
const api =
  process.env.CQ_GATEQ_API_URL ??
  "https://capital-qapi-production.up.railway.app";
const receipts = mkdtempSync(join(tmpdir(), "cq-gateq-native-"));
chmodSync(receipts, 0o700);
const write = (name, value) =>
  writeFileSync(join(receipts, name), JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
const metrics = [];
const timed = async (label, work) => {
  const start = performance.now();
  const value = await work();
  const ms = Math.round(performance.now() - start);
  metrics.push({ label, ms });
  console.log(JSON.stringify({ label, ms }));
  return value;
};
const { createServerClient } = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
)("@supabase/ssr");
const browser = await chromium.launch({
  executablePath: process.env.CQ_DEMO_CHROMIUM_PATH ?? "/usr/bin/chromium",
  proxy: { server: process.env.HTTPS_PROXY },
  args: ["--no-sandbox"],
});
const ownerContext = async (file) => {
  const session = JSON.parse(readFileSync(file, "utf8"));
  const cookies = new Map();
  const client = createServerClient(
    config.NEXT_PUBLIC_SUPABASE_URL,
    config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
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
  assert.equal(
    signed.data.session.user.id,
    session.user.id,
    "Refreshed identity must match existing owner",
  );
  writeFileSync(file, JSON.stringify(signed.data.session), { mode: 0o600 });
  const context = await browser.newContext({
    ignoreHTTPSErrors: false,
    viewport: { width: 1300, height: 900 },
  });
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
  return {
    context,
    session: { baseUrl: api, accessToken: signed.data.session.access_token },
    email: signed.data.session.user.email,
  };
};
let page;
try {
  const founder = await ownerContext(required("CQ_GATEQ_FOUNDER_SESSION_FILE"));
  const memberships = await listMyOrganisations(founder.session);
  assert.ok(
    memberships.items.some(
      (item) =>
        item.organisation.organisationType === "COMPANY" &&
        item.membership.status === "ACTIVE",
    ),
    "Native founder proof requires a real active COMPANY membership",
  );
  const investor = await ownerContext(
    required("CQ_GATEQ_INVESTOR_SESSION_FILE"),
  );
  const other = await ownerContext(required("CQ_GATEQ_OTHER_SESSION_FILE"));
  const org = await getCurrentInvestorOrganisation(investor.session);
  const gates = await listGateways(investor.session, org.id);
  const gateway = gates.gateways.find(
    (item) => item.publicId === publicId && item.status === "ACTIVE",
  );
  assert.ok(gateway, "Investor must own the active test gateway");
  assert.equal(
    (await getPublicGateway(api, publicId)).acceptingApplications,
    true,
  );
  page = await founder.context.newPage();
  page.setDefaultTimeout(60_000);
  await timed("native-contact-page", () =>
    page.goto(`${web}/g/${publicId}`, { waitUntil: "domcontentloaded" }),
  );
  await page
    .getByLabel("Full name", { exact: true })
    .fill(fixture.contactName ?? "Authorized test founder");
  await page.getByLabel("Email", { exact: true }).fill(founder.email);
  await page
    .getByLabel("Your role", { exact: true })
    .fill(fixture.role ?? "Founder & CEO");
  await page.getByLabel("Company", { exact: true }).fill(fixture.companyName);
  await timed("native-contact-confirmation", async () => {
    await page
      .getByRole("button", { name: "Confirm and continue", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Your company", exact: true })
      .waitFor();
  });
  await page.locator("#gq-name").fill(fixture.companyName);
  await page.locator("#gq-line").fill(fixture.oneLiner);
  await page
    .getByRole("radiogroup", { name: "Stage", exact: true })
    .getByRole("radio", { name: fixture.stageLabel, exact: true })
    .click();
  const sector = page
    .getByRole("group", { name: /^Sector/ })
    .getByRole("button", { name: fixture.sectorLabel, exact: true });
  if ((await sector.getAttribute("aria-pressed")) !== "true")
    await sector.click();
  await page
    .getByRole("radio", { name: fixture.countryLabel, exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your round", exact: true })
    .waitFor();
  await page
    .getByLabel("Currency", { exact: true })
    .selectOption(fixture.currency);
  await page.getByLabel("Exact amount", { exact: true }).fill(fixture.amount);
  await page
    .getByRole("radiogroup", { name: "How are you raising?", exact: true })
    .getByRole("radio", { name: "I'd rather not say", exact: true })
    .click();
  await page
    .getByRole("radiogroup", {
      name: "Do you have a lead investor?",
      exact: true,
    })
    .getByRole("radio", { name: "I'd rather not say", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("heading", { name: "What to share", exact: true })
    .waitFor();
  // The owned document checkboxes stay unchecked: this slice certifies text.
  assert.equal(await page.locator('input[type="checkbox"]:checked').count(), 0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("heading", { name: "A short note", exact: true })
    .waitFor();
  await page
    .locator("#gq-msg")
    .fill(
      "Authorized product acceptance; figures are applicant declarations, not independently verified evidence.",
    );
  await page.getByRole("button", { name: "Check my fit", exact: true }).click();
  await page
    .getByRole("button", { name: "Continue to interview", exact: true })
    .waitFor();
  const recover = () =>
    page.evaluate(
      (gatewayId) =>
        JSON.parse(sessionStorage.getItem(`cq:gateq:${gatewayId}`)),
      publicId,
    );
  let state = await recover();
  assert.ok(state.token);
  const before = await resumeApplication(api, state.token);
  assert.equal(
    before.access,
    "MAY_APPLY",
    "Native form must satisfy the frozen mandate",
  );
  await timed("native-first-q-question", async () => {
    await page
      .getByRole("button", { name: "Continue to interview", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Your answer", exact: true })
      .waitFor();
    await page.waitForFunction(
      () => {
        const input = document.querySelector(
          'textarea[aria-label="Your answer"]',
        );
        return input && !input.disabled;
      },
      undefined,
      { timeout: 180_000 },
    );
  });
  const reply = `As recorded on the form, our stage is ${fixture.stageLabel.toLowerCase()} and our country is ${fixture.countryLabel}. Please use our recorded answers. Any revenue or traction not provided remains unknown, and supporting evidence has not been independently verified.`;
  await page
    .getByRole("textbox", { name: "Your answer", exact: true })
    .fill(reply);
  await timed("native-answer-to-completed-q-reply", async () => {
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page
      .getByRole("button", { name: "Finish and review", exact: true })
      .waitFor();
    await page.waitForFunction(
      () => {
        const button = [...document.querySelectorAll("button")].find(
          (item) => item.textContent?.trim() === "Finish and review",
        );
        return button && !button.disabled;
      },
      undefined,
      { timeout: 180_000 },
    );
  });
  const after = await resumeApplication(api, state.token);
  assert.equal(
    after.access,
    "MAY_APPLY",
    "Adaptive answer must not corrupt canonical qualification facts",
  );
  const transcript = await getApplicationTranscript(api, state.token);
  assert.equal(
    transcript.turns.filter((item) => item.role === "PERSON").length,
    1,
  );
  assert.equal(transcript.turns.filter((item) => item.role === "Q").length, 2);
  write("before-after.json", { before, after, transcript });
  await timed("native-review", async () => {
    await page
      .getByRole("button", { name: "Finish and review", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Review before you submit", exact: true })
      .waitFor();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "Review before you submit", exact: true })
    .waitFor();
  const resumed = await recover();
  assert.equal(resumed.token, state.token);
  assert.equal(
    (await getApplicationTranscript(api, state.token)).turns.length,
    transcript.turns.length,
  );
  const coverage = await getApplicationCoverage(api, state.token);
  assert.equal(coverage.contact.confirmed, true);
  assert.equal(coverage.coverage.access, "MAY_APPLY");
  await page.screenshot({
    path: join(receipts, "native-review.png"),
    fullPage: true,
  });
  if (!process.argv.includes("--submit")) {
    write("result.json", { passed: true, submitted: false, metrics });
    console.log(
      JSON.stringify({
        passed: true,
        submitted: false,
        receiptDirectory: receipts,
      }),
    );
  } else {
    await timed("native-explicit-submit", async () => {
      await page.getByRole("button", { name: /^Submit to / }).click();
      await page.waitForFunction(
        (gatewayId) => {
          const value = JSON.parse(
            sessionStorage.getItem(`cq:gateq:${gatewayId}`) ?? "null",
          );
          return value?.step === "sent";
        },
        publicId,
        { timeout: 120_000 },
      );
    });
    state = await recover();
    const submitted = await resumeApplication(api, state.token);
    assert.ok(submitted.submittedAt);
    assert.equal(submitted.status, "SUBMITTED");
    const retry = await submitApplication(api, state.token, state.submitKey);
    assert.equal(retry.deduplicated, true);
    const inbox = await getGateqInbox(investor.session, gateway.id, "INBOX");
    const matching = inbox.items.filter(
      (item) => item.reference === submitted.reference,
    );
    assert.equal(matching.length, 1);
    const detail = await timed("investor-frozen-dossier", () =>
      getGateqInboxItem(
        investor.session,
        gateway.id,
        matching[0].applicationId,
      ),
    );
    assert.ok(detail.dossier);
    assert.equal(detail.transcript.length, transcript.turns.length);
    assert.deepEqual(
      detail.transcript.map((turn) => turn.text),
      transcript.turns.map((turn) => turn.text),
    );
    assert.equal(detail.dossier.qualification.access, "MAY_APPLY");
    assert.equal(detail.shared.length, 0);
    await assert.rejects(
      () =>
        getGateqInboxItem(other.session, gateway.id, matching[0].applicationId),
      (error) => error.status === 404,
    );
    write("frozen-dossier.json", detail);
    const investorPage = await investor.context.newPage();
    await timed("investor-native-inbox", () =>
      investorPage.goto(`${web}/gateq?tab=inbox`, {
        waitUntil: "domcontentloaded",
      }),
    );
    await investorPage
      .getByText(fixture.companyName, { exact: true })
      .first()
      .click();
    await investorPage
      .getByRole("heading", { name: "Interview transcript", exact: true })
      .waitFor();
    await investorPage.screenshot({
      path: join(receipts, "investor-dossier.png"),
      fullPage: true,
    });
    write("result.json", {
      passed: true,
      submitted: true,
      transcriptTurns: transcript.turns.length,
      uniqueSubmission: true,
      crossActorDenied: true,
      metrics,
    });
    console.log(
      JSON.stringify({
        passed: true,
        submitted: true,
        transcriptTurns: transcript.turns.length,
        uniqueSubmission: true,
        crossActorDenied: true,
        receiptDirectory: receipts,
      }),
    );
  }
} catch (error) {
  if (page)
    await page
      .screenshot({ path: join(receipts, "failure.png"), fullPage: true })
      .catch(() => {});
  write("failure.json", {
    message: String(error?.message ?? "Acceptance failed"),
    metrics,
  });
  console.log(
    JSON.stringify({
      passed: false,
      receiptDirectory: receipts,
      failure: "See private failure.json",
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
