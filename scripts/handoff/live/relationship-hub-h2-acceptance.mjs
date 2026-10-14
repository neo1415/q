/** Real H2 acceptance over existing authorized accounts and canonical records.
 * CQ_H2_FIXTURES_FILE: private [{role:"investor"|"founder",file,subjectId}].
 * CQ_HUB_PUBLIC_KEY_FILE: public Supabase key. CQ_HUB_VERIFY_Q=1 additionally
 * creates bounded internal Q navigation turns. No relationships, messages,
 * decisions or approvals are created. Saved views are device-only and cleaned up.
 * All private response/CSV/screenshots stay outside Git in a mode700 directory.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
const require = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);
const { createServerClient } = require("@supabase/ssr");
const fixtures = JSON.parse(
  readFileSync(process.env.CQ_H2_FIXTURES_FILE, "utf8"),
);
const key = readFileSync(process.env.CQ_HUB_PUBLIC_KEY_FILE, "utf8").trim();
const web =
  process.env.CQ_HUB_WEB_URL ??
  "https://capital-qweb-production.up.railway.app";
const api =
  process.env.CQ_HUB_API_URL ??
  "https://capital-qapi-production.up.railway.app";
const evidence = mkdtempSync(join(tmpdir(), "cq-hub-h2-live-"));
chmodSync(evidence, 0o700);
const write = (name, value) =>
  writeFileSync(join(evidence, name), JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
const outcomes = [];
const browser = await chromium.launch({
  executablePath: process.env.CQ_HUB_CHROMIUM_PATH ?? "/usr/bin/chromium",
  proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" },
  args: ["--no-sandbox"],
});
let activePage;
function csvRows(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  assert.equal(quoted, false, "CSV quote boundary invalid");
  return rows;
}
try {
  for (const fixture of fixtures.filter((f) =>
    ["investor", "founder"].includes(f.role),
  )) {
    const { role, file, subjectId } = fixture;
    const cookies = new Map();
    const auth = createServerClient(
      "https://vcohxiqsmnkzxnvawgri.supabase.co",
      key,
      {
        cookieOptions: {
          secure: true,
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        },
        cookies: {
          getAll: () => [...cookies.values()],
          setAll: (items) => {
            for (const c of items) cookies.set(c.name, c);
          },
        },
      },
    );
    const signed = await auth.auth.setSession(
      JSON.parse(readFileSync(file, "utf8")),
    );
    assert.ifError(signed.error);
    assert.ok(signed.data.session);
    writeFileSync(file, JSON.stringify(signed.data.session), { mode: 0o600 });
    const token = signed.data.session.access_token;
    const apiPath =
      role === "founder"
        ? `/v1/network/companies/${subjectId}/relationships/pipeline`
        : "/v1/network/relationships/pipeline";
    const apiRead = async (query, headers = {}) => {
      const r = await fetch(`${api}${apiPath}?${new URLSearchParams(query)}`, {
        headers: { authorization: `Bearer ${token}`, ...headers },
      });
      assert.ok(r.ok, `Authorized pipeline HTTP${r.status}`);
      return r.json();
    };
    const baseline = await apiRead({ pageSize: "50", sort: "name" });
    write(`${role}-source.json`, baseline);
    assert.ok(
      baseline.total >= 2,
      `${role}: need existing records for actual pagination proof`,
    );
    const deny = await fetch(`${api}${apiPath}?pageSize=1`, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-organisation-id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    });
    assert.ok(
      [403, 404].includes(deny.status),
      "Unauthorized organization context was accepted",
    );
    for (const [size, viewport] of [
      ["desktop", { width: 1440, height: 960 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      if (process.env.CQ_HUB_DEVICE && size !== process.env.CQ_HUB_DEVICE)
        continue;
      const context = await browser.newContext({
        viewport,
        ignoreHTTPSErrors: false,
        acceptDownloads: true,
      });
      await context.addCookies(
        [...cookies.values()].map((c) => ({
          name: c.name,
          value: c.value,
          domain: new URL(web).hostname,
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
      activePage = page;
      const receipts = [];
      const qRuns = [];
      page.on("request", (r) => {
        const match = /\/q\/runs\/([0-9a-f-]{36})\/events/i.exec(
          new URL(r.url()).pathname,
        );
        if (match) {
          qRuns.push(match[1]);
          write(`${role}-${size}-observed-q-runs.json`, qRuns);
        }
        if (
          new URL(r.url()).pathname === "/api/q-ui-acts" &&
          r.method() === "POST"
        ) {
          try {
            receipts.push(r.postDataJSON());
          } catch {
            // Ignore requests that do not carry a JSON receipt body.
          }
        }
      });
      const closeBriefing = async () => {
        const close = page.getByRole("button", {
          name: "Close Q's briefing",
          exact: true,
        });
        if (await close.isVisible()) await close.click();
      };
      const heading =
        role === "investor" ? "Investment Hub" : "Fundraising Hub";
      await page.goto(`${web}/relationships?view=overview`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page
        .getByRole("heading", { name: heading, exact: true })
        .waitFor({ timeout: 45000 });
      await closeBriefing();
      const nav = page.getByRole("navigation", {
        name: "Relationship Hub",
        exact: true,
      });
      await nav.getByRole("link", { name: "Pipeline", exact: true }).click();
      await page
        .locator("[data-pipeline-root]:visible")
        .waitFor({ timeout: 45000 });
      await page.goto(
        `${web}/relationships?view=pipeline&pageSize=1&sort=name`,
        { waitUntil: "domcontentloaded", timeout: 60000 },
      );
      await page
        .locator("[data-pipeline-root]:visible")
        .waitFor({ timeout: 45000 });
      await closeBriefing();
      const first = baseline.items[0];
      const second = baseline.items[1];
      await page
        .getByRole("checkbox", {
          name: `Select ${first.counterpart.name}`,
          exact: true,
        })
        .check();
      await page.getByRole("link", { name: "Next page", exact: true }).click();
      await page
        .getByRole("checkbox", {
          name: `Select ${second.counterpart.name}`,
          exact: true,
        })
        .waitFor({ timeout: 45000 });
      await page
        .getByRole("link", { name: "Export 1 selected", exact: true })
        .waitFor();
      await page
        .getByRole("checkbox", {
          name: `Select ${second.counterpart.name}`,
          exact: true,
        })
        .check();
      const selectedLink = page.getByRole("link", {
        name: "Export 2 selected",
        exact: true,
      });
      await selectedLink.waitFor();
      const selectedUrl = await selectedLink.getAttribute("href");
      const selectedResponse = await context.request.get(
        `${web}${selectedUrl}`,
      );
      assert.equal(selectedResponse.status(), 200);
      const selectedCsv = await selectedResponse.text();
      writeFileSync(
        join(evidence, `${role}-${size}-selected.csv`),
        selectedCsv,
        { mode: 0o600 },
      );
      const selectedRows = csvRows(selectedCsv);
      assert.deepEqual(
        new Set(selectedRows.slice(1).map((r) => r[4])),
        new Set([first.relationshipId, second.relationshipId]),
      );
      const nativeDownload = page.waitForEvent("download");
      await selectedLink.click();
      const download = await nativeDownload;
      await download.saveAs(
        join(evidence, `${role}-${size}-native-selected.csv`),
      );
      assert.equal(await download.failure(), null);
      await page.getByRole("link", { name: "Board", exact: true }).click();
      await page.waitForURL(/layout=board/, { timeout: 45000 });
      await page
        .locator('[data-pipeline-layout="board"][aria-current="page"]')
        .waitFor();
      await page
        .getByRole("link", { name: "Export 2 selected", exact: true })
        .waitFor();
      await page.screenshot({
        path: join(evidence, `${role}-${size}-board.png`),
        fullPage: true,
      });
      await page.getByRole("link", { name: "Table", exact: true }).click();
      await page.locator("table[data-pipeline-records]:visible").waitFor();
      const search = page.getByRole("textbox", {
        name: role === "investor" ? "Search companies" : "Search investors",
        exact: true,
      });
      await search.fill(first.counterpart.name);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.waitForURL(
        (u) => u.searchParams.get("q") === first.counterpart.name,
        { timeout: 45000 },
      );
      await page
        .getByRole("link", { name: "Export filtered CSV", exact: true })
        .waitFor();
      const filtered = await apiRead({
        q: first.counterpart.name,
        pageSize: "50",
        sort: "name",
      });
      const exportLink = page.getByRole("link", {
        name: "Export filtered CSV",
        exact: true,
      });
      const href = await exportLink.getAttribute("href");
      const filteredResponse = await context.request.get(`${web}${href}`);
      assert.equal(filteredResponse.status(), 200);
      const filteredRows = csvRows(await filteredResponse.text());
      assert.deepEqual(
        new Set(filteredRows.slice(1).map((r) => r[4])),
        new Set(filtered.items.map((r) => r.relationshipId)),
      );
      const stale = new URL(`${web}${href}`);
      stale.searchParams.set("q", "unmatched-authorized-acceptance-filter");
      assert.equal(
        (await context.request.get(stale.href)).status(),
        400,
        "Stale filter scope accepted",
      );
      const foreign = new URL(`${web}${href}`);
      foreign.searchParams.set(
        "selected",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      );
      assert.equal(
        (await context.request.get(foreign.href)).status(),
        404,
        "Unauthorized selection accepted",
      );
      const sort = page.getByRole("combobox", {
        name: "Sort relationships",
        exact: true,
      });
      await sort.selectOption("name-desc");
      await page.waitForURL((u) => u.searchParams.get("sort") === "name-desc", {
        timeout: 45000,
      });
      const state = page.getByRole("combobox", {
        name: "Relationship state",
        exact: true,
      });
      await state.selectOption(first.state);
      await page.waitForURL(
        (u) => u.searchParams.get("state") === first.state,
        { timeout: 45000 },
      );
      await page
        .getByRole("textbox", { name: "View name", exact: true })
        .fill(`Acceptance ${size}`);
      await page
        .getByRole("button", { name: "Save view", exact: true })
        .click();
      const view = page.getByRole("combobox", {
        name: "Saved view",
        exact: true,
      });
      await view
        .getByRole("option", { name: `Acceptance ${size}`, exact: true })
        .waitFor({ state: "attached" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("[data-pipeline-root]:visible").waitFor();
      await closeBriefing();
      await view.selectOption({ label: `Acceptance ${size}` });
      await page
        .getByRole("button", { name: "Delete view", exact: true })
        .waitFor();
      assert.equal(await sort.inputValue(), "name-desc");
      assert.equal(await state.inputValue(), first.state);
      await page
        .getByRole("button", { name: "Delete view", exact: true })
        .click();
      assert.equal(
        await view
          .getByRole("option", { name: `Acceptance ${size}`, exact: true })
          .count(),
        0,
      );
      await page
        .getByRole("button", { name: "Preview", exact: true })
        .first()
        .click();
      await page
        .getByRole("link", { name: "Open relationship", exact: true })
        .waitFor();
      await page
        .getByRole("link", { name: "Open relationship", exact: true })
        .click();
      await page.waitForURL(/\/relationships\/(company|investor)\//, {
        timeout: 45000,
      });
      await page.locator("main").waitFor();
      await page.goBack({ waitUntil: "domcontentloaded" });
      await page.locator("[data-pipeline-root]:visible").waitFor();
      await closeBriefing();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        ),
        false,
        "Viewport horizontal overflow",
      );
      await page.screenshot({
        path: join(evidence, `${role}-${size}-pipeline.png`),
        fullPage: true,
      });
      let qVerified = false;
      if (process.env.CQ_HUB_VERIFY_Q === "1" && size === "desktop") {
        async function ask(text, done) {
          const before = receipts.length;
          const priorRuns = new Set(qRuns);
          const input = page.getByPlaceholder("Ask Q", { exact: true });
          if (!(await input.isVisible()))
            await page.locator("[data-q-dock-button]:visible").first().click();
          await input.waitFor({ timeout: 30000 });
          await input.fill(text);
          await input.press("Enter");
          await done();
          await page.keyboard.press("Escape");
          let completed = false;
          for (let attempt = 0; attempt < 180; attempt++) {
            const runId = qRuns.findLast((id) => !priorRuns.has(id));
            if (runId) {
              const response = await fetch(
                `${process.env.CQ_HUB_Q_API_URL ?? "https://capital-qq-api-production.up.railway.app"}/v1/q/runs/${runId}`,
                { headers: { authorization: `Bearer ${token}` } },
              );
              assert.ok(response.ok, "Owned navigation run refused");
              const run = await response.json();
              if (
                [
                  "COMPLETED",
                  "FAILED",
                  "AWAITING_INPUT",
                  "AWAITING_APPROVAL",
                ].includes(run.status)
              ) {
                write(`${role}-q-run-${before}.json`, run);
                assert.equal(
                  run.status,
                  "COMPLETED",
                  "Q control run did not complete",
                );
                completed = true;
                break;
              }
            }
            await page.waitForTimeout(500);
          }
          assert.ok(
            completed,
            "Q control run did not settle before the next turn",
          );

          await page.waitForTimeout(400);
          write(`${role}-q-receipts.json`, receipts);
          const fresh = receipts.slice(before);
          assert.ok(
            fresh.some(
              (x) =>
                (x.reports ?? []).some((r) => r.receipt?.status === "DONE") ||
                (x.navigations ?? []).some((r) => r.status === "DONE"),
            ),
            "Q operation lacks real DONE receipt",
          );
        }
        await ask(
          role === "investor" ? "Open investment hub" : "Open fundraising hub",
          () => page.waitForURL(/view=overview/, { timeout: 90000 }),
        );
        await ask("Select the Pipeline tab in this Hub.", () =>
          page
            .locator("[data-pipeline-root]:visible")
            .waitFor({ timeout: 90000 }),
        );
        await ask("Switch this pipeline to Board view.", () =>
          page
            .locator('[data-pipeline-layout="board"][aria-current="page"]')
            .waitFor({ timeout: 90000 }),
        );
        await ask("Sort this pipeline by name A–Z.", () =>
          page.waitForURL((u) => u.searchParams.get("sort") === "name", {
            timeout: 90000,
          }),
        );
        await ask(`Search this pipeline for "${first.counterpart.name}"`, () =>
          page.waitForURL(
            (u) => u.searchParams.get("q") === first.counterpart.name,
            { timeout: 90000 },
          ),
        );
        await ask("Clear the pipeline search", () =>
          page.waitForURL((u) => !u.searchParams.has("q"), { timeout: 90000 }),
        );
        await ask(
          `Filter this pipeline to ${first.state.toLowerCase().replaceAll("_", " ")}`,
          () =>
            page.waitForURL(
              (u) => u.searchParams.get("state") === first.state,
              { timeout: 90000 },
            ),
        );
        await ask("Open the first relationship in this pipeline.", () =>
          page.waitForURL(/\/relationships\/(company|investor)\//, {
            timeout: 90000,
          }),
        );
        await ask(
          role === "investor" ? "Open investment hub" : "Open fundraising hub",
          () => page.waitForURL(/view=overview/, { timeout: 90000 }),
        );
        await ask("Select the Pipeline tab in this Hub.", () =>
          page
            .locator("[data-pipeline-root]:visible")
            .waitFor({ timeout: 90000 }),
        );
        qVerified = true;
      }
      outcomes.push({
        role,
        size,
        matching: baseline.total,
        pagination: true,
        sameScopeSelection: true,
        table: true,
        board: true,
        search: true,
        sort: true,
        stateFilter: true,
        savedViewReload: true,
        selectedCsvRows: selectedRows.length - 1,
        filteredCsvRows: filteredRows.length - 1,
        unauthorizedOrganisation: deny.status,
        staleScope: 400,
        foreignSelection: 404,
        recordReturn: true,
        qVerified,
      });
      write("outcomes.json", outcomes);
      console.log(JSON.stringify(outcomes.at(-1)));
      await context.close();
      activePage = null;
    }
  }
} catch (error) {
  if (activePage) {
    await activePage
      .screenshot({ path: join(evidence, "failure.png"), fullPage: true })
      .catch(() => {});
    write("failure-page.json", {
      html: await activePage.content().catch(() => ""),
    });
  }
  write("failure.json", { message: error.message });
  console.error(
    JSON.stringify({ status: "FAIL", reason: error.message, evidence }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
  console.log(JSON.stringify({ evidence, outcomes: outcomes.length }));
}
