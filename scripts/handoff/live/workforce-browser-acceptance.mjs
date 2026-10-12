// Read-only browser acceptance for an existing fictional workforce job.
// CQ_WORK_EVIDENCE_DIR points to protected receipts from workforce-acceptance.
// Defaults to primary Work; CQ_WORK_VIEW=team verifies the secondary job log.
// CQ_REQUIRE_WORK_APPROVAL=1 checks visibility only; no approval is clicked.
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Live investor rehearsal. Creates internal Q turns for an existing authorized session.
 * No account creation, email, interest, outreach or approval actions.
 * Full private receipts and screenshots stay in a fresh mode-700 temporary directory.
 * Console output is durations, counts and binding checks only. */
const sessionFile = process.env.CQ_DEMO_SESSION_FILE;
const publicKeyFile = process.env.CQ_DEMO_PUBLIC_KEY_FILE;
if (!sessionFile || !publicKeyFile)
  throw new Error("Set CQ_DEMO_SESSION_FILE and CQ_DEMO_PUBLIC_KEY_FILE");
const webUrl =
  process.env.CQ_DEMO_WEB_URL ??
  "https://capital-qweb-production.up.railway.app";
const supabaseUrl =
  process.env.CQ_DEMO_SUPABASE_URL ??
  "https://vcohxiqsmnkzxnvawgri.supabase.co";
const evidenceDir = mkdtempSync(join(tmpdir(), "cq-workforce-viewer-"));

const { createServerClient } = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
)("@supabase/ssr");
const session = JSON.parse(readFileSync(sessionFile, "utf8"));
const cookies = new Map();
const client = createServerClient(
  supabaseUrl,
  readFileSync(publicKeyFile, "utf8").trim(),
  {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: true, path: "/" },
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
if (signed.error) throw new Error("Existing authorized session refused");
if (signed.data.session) Object.assign(session, signed.data.session);
const browser = await chromium.launch({
  ...(process.env.CQ_DEMO_CHROMIUM_PATH
    ? { executablePath: process.env.CQ_DEMO_CHROMIUM_PATH }
    : {}),
  proxy: { server: process.env.HTTPS_PROXY },
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});

const sourceDir = process.env.CQ_WORK_EVIDENCE_DIR;
if (!sourceDir) throw new Error("Missing owned workforce evidence directory");
const job = JSON.parse(readFileSync(join(sourceDir, "job.json"), "utf8"));
const artifact = JSON.parse(
  readFileSync(join(sourceDir, "artifact.json"), "utf8"),
);
const artifactId = artifact.artifact.artifactId;
if (
  !/^[0-9a-f-]{36}$/i.test(artifactId) ||
  !/^[0-9a-f-]{36}$/i.test(job.job.id)
)
  throw new Error("Invalid own artifact/job reference");
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1300, height: 900 },
  });
  await context.addCookies(
    [...cookies.values()].map((c) => ({
      name: c.name,
      value: c.value,
      domain: new URL(webUrl).hostname,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    })),
  );
  await context.addInitScript(() =>
    sessionStorage.setItem("cq.splash.seen", "1"),
  );
  const page = await context.newPage();
  const response = await page.goto(new URL("/work", webUrl).href, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  if (!response.ok() || new URL(page.url()).pathname !== "/work")
    throw new Error("Work page refused");
  const secondary = process.env.CQ_WORK_VIEW === "team";
  if (secondary)
    await page.getByRole("button", { name: "Team map", exact: true }).click();
  const row = page.locator(
    secondary
      ? `[data-job="${job.job.id}"]`
      : `[data-work-job="${job.job.id}"]`,
  );
  await row.waitFor({ timeout: 30000 });
  const open = row.locator(`[data-workforce-document="${artifactId}"]`);
  await open.waitFor({ timeout: 15000 });
  await open.click({ timeout: 15000 });
  const viewer = page.locator(`[data-q-artifact-viewer="${artifactId}"]`);
  await viewer.waitFor({ timeout: 30000 });
  await viewer.locator("[data-q-artifact-body]").waitFor({ timeout: 30000 });
  if (!(await viewer.locator("[data-q-artifact-body]").innerText()).trim())
    throw new Error("Memo viewer empty");
  const edit = viewer.locator("[data-q-artifact-edit]");
  if (!(await edit.isVisible()))
    throw new Error("Conversational editing unavailable");
  await page.screenshot({ path: join(evidenceDir, "viewer.png") });
  console.log(
    JSON.stringify({
      workHttp: response.status(),
      ownedJobVisible: true,
      view: secondary ? "team" : "work",
      readyMemoOpened: true,
      viewerRendered: true,
      editWithQVisible: true,
      version: artifact.artifact.currentVersion,
      evidenceDir,
    }),
  );
  if (process.env.CQ_REQUIRE_WORK_APPROVAL === "1") {
    const card = JSON.parse(
      readFileSync(join(sourceDir, "diligence-card.json"), "utf8"),
    );
    await viewer.locator("[data-q-artifact-close]").click();
    const approval = row.locator(
      `[data-workforce-approval="${card.approvalId}"]`,
    );
    await approval.waitFor({ timeout: 15000 });
    await approval.locator("summary").click();
    const decide = approval.getByRole("button", {
      name: "Approve this action",
      exact: true,
    });
    if (!(await decide.isVisible()))
      throw new Error("Native pending approval hidden");
    console.log(
      JSON.stringify({
        nativeApprovalVisible: true,
        exactPreviewVisible: true,
        approveNotClicked: true,
      }),
    );
  }
} finally {
  await browser.close();
}
