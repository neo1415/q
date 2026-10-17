/** Production acceptance over existing, explicitly authorized accounts only.
 * Required CQ_UNICORN_FIXTURES_FILE (private JSON):
 * {publicConfigFile, scoredCompanyId, unscoredCompanyId, qExpectedTerms:[...], actors:[
 *   {role:"premiumInvestor"|"freeInvestor"|"noMandateInvestor"|"premiumFounder",
 *    sessionFile, organisationId?, expectedScoreHttp:200|404,
 *    profilePath?, gateqPath?, applicationId?}]}
 * publicConfigFile contains NEXT_PUBLIC_SUPABASE_URL/PUBLISHABLE_KEY.
 * Founder requires existing applicationId + exact gateqPath; no applications,
 * uploads, grants, subscriptions or accounts are created or changed.
 * CQ_UNICORN_VERIFY_Q=1 makes one internal Q turn. Otherwise Q is explicitly
 * NOT_RUN and this script refuses to call the full acceptance complete.
 * All authenticated bodies, screenshots and refreshed sessions stay private.
 * No paid audiovisual/provider rehearsal. This is not deployment-SHA proof.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderedInvestorAnswer } from "./investor-browser-binding.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = [
  "premiumInvestor",
  "freeInvestor",
  "noMandateInvestor",
  "premiumFounder",
];
const CAVEAT = "It is not the probability of reaching a $1 billion valuation.";
export function validateFixtures(value) {
  assert.ok(value && typeof value === "object", "Fixture object required");
  assert.ok(UUID.test(value.scoredCompanyId), "Scored company UUID required");
  assert.ok(
    UUID.test(value.unscoredCompanyId),
    "Unscored company UUID required",
  );
  assert.notEqual(
    value.scoredCompanyId,
    value.unscoredCompanyId,
    "Distinct evidence cases required",
  );
  assert.equal(
    typeof value.publicConfigFile,
    "string",
    "Public config file required",
  );
  for (const role of ROLES) {
    const actors = value.actors?.filter((a) => a.role === role) ?? [];
    assert.equal(actors.length, 1, "Exactly one actor per required role");
    assert.equal(
      typeof actors[0].sessionFile,
      "string",
      "Existing session file required",
    );
    assert.ok(
      [200, 404].includes(actors[0].expectedScoreHttp),
      "Explicit score access expectation required",
    );
    if (actors[0].organisationId)
      assert.ok(
        UUID.test(actors[0].organisationId),
        "Organization UUID required",
      );
    if (actors[0].gateqPath)
      assert.ok(
        actors[0].gateqPath.startsWith("/") &&
          !actors[0].gateqPath.startsWith("//"),
        "Relative GateQ path required",
      );
  }
  assert.equal(
    value.actors.find((a) => a.role === "freeInvestor").expectedScoreHttp,
    404,
    "Free account must be denied",
  );
  assert.ok(
    Array.isArray(value.qExpectedTerms) &&
      value.qExpectedTerms.length >= 2 &&
      value.qExpectedTerms.length <= 8 &&
      value.qExpectedTerms.every(
        (term) =>
          typeof term === "string" && term.length >= 4 && term.length <= 120,
      ),
    "Two to eight authorized Q evidence terms required",
  );
  for (const role of ["premiumInvestor", "noMandateInvestor"])
    assert.equal(
      value.actors.find((actor) => actor.role === role).expectedScoreHttp,
      200,
      "Premium investor cases require permitted score access",
    );
  const founder = value.actors.find((a) => a.role === "premiumFounder");
  assert.ok(
    UUID.test(founder.applicationId) && founder.gateqPath,
    "Existing founder application and result page required",
  );
  return value;
}

/** Independently recompute public DTO arithmetic; never supply/repair a score. */
export function verifyAssessment(value, expectedStatus) {
  assert.equal(value.status, expectedStatus, "Unexpected evidence status");
  if (expectedStatus === "NOT_ASSESSED") {
    assert.equal(value.overallScore, null, "Unassessed cannot carry a score");
    return;
  }
  assert.equal(value.pillars.length, 12, "Twelve pillars required");
  assert.equal(
    new Set(value.pillars.map((p) => p.id)).size,
    12,
    "Distinct pillars required",
  );
  for (let n = 1; n <= 12; n++)
    assert.ok(
      value.pillars.some((p) => p.id === `P${n}`),
      "Canonical pillar missing",
    );
  for (const p of value.pillars) {
    assert.equal(p.criteria.length, 2, "Two criteria required");
    assert.deepEqual(
      [...new Set(p.criteria.map((c) => c.id))].sort(),
      ["A", "B"],
      "Distinct criteria required",
    );
    const observed = p.criteria.filter((c) => c.state === "OBSERVED");
    for (const c of observed) {
      assert.ok(
        Number.isInteger(c.grade) && c.grade >= 0 && c.grade <= 4,
        "Bounded factual grade required",
      );
      assert.ok(c.sources.length > 0, "Observed grade requires lineage");
      for (const source of c.sources)
        assert.ok(
          ["network_visible", "public_external"].includes(
            source.visibilityScope,
          ),
          "Private source reached premium score",
        );
    }
    const grade = observed.length
      ? observed.reduce((sum, c) => sum + c.grade, 0) / observed.length
      : null;
    assert.equal(
      p.grade,
      grade,
      "Pillar grade differs from observed criterion average",
    );
  }
  if (expectedStatus !== "SCORED") {
    assert.equal(
      value.overallScore,
      null,
      "Insufficient evidence cannot carry a fabricated score",
    );
    assert.equal(value.band, null, "Unscored cannot carry band");
    return;
  }
  assert.ok(
    value.stage && value.coverage >= 0.6,
    "Score gates require known stage and coverage",
  );
  const scored = value.pillars.filter((p) => p.grade !== null);
  assert.ok(
    scored.length >= 6 &&
      ["P1", "P2", "P3"].every((id) => scored.some((p) => p.id === id)) &&
      scored.some((p) => p.id === "P4" || p.id === "P7"),
    "Required pillar gates failed",
  );
  const weight = scored.reduce((sum, p) => sum + p.weight, 0);
  assert.ok(weight > 0, "Scored weights required");
  const raw = scored.reduce((sum, p) => sum + p.weight * p.grade, 0) / weight;
  assert.equal(
    value.overallScore,
    Math.round(25 * raw),
    "Overall score calculation mismatch",
  );
  for (const p of scored)
    assert.ok(
      Math.abs(p.contribution - (25 * p.weight * p.grade) / weight) < 1e-8,
      "Contribution calculation mismatch",
    );
  if (value.momentum)
    assert.equal(
      value.momentum.previousScore + value.momentum.delta,
      value.overallScore,
      "Momentum must reconcile to actual prior score",
    );
}

export function assertOrderPreserved(baseline, filtered) {
  const ids = baseline.map((i) => i.companyId),
    ranks = filtered.map((i) => ids.indexOf(i.companyId));
  assert.ok(
    ranks.length >= 2 && ranks.every((n) => n >= 0),
    "Need at least two filtered records in bounded baseline to prove order",
  );
  assert.ok(
    ranks.every((n, i) => i === 0 || n > ranks[i - 1]),
    "Explicit filtering changed original mandate order",
  );
}

async function main() {
  const fixture = validateFixtures(
    JSON.parse(readFileSync(process.env.CQ_UNICORN_FIXTURES_FILE, "utf8")),
  );
  const config = JSON.parse(readFileSync(fixture.publicConfigFile, "utf8"));
  const web =
    process.env.CQ_UNICORN_WEB_URL ??
    "https://capital-qweb-production.up.railway.app";
  const api =
    process.env.CQ_UNICORN_API_URL ??
    "https://capital-qapi-production.up.railway.app";
  const qapi =
    process.env.CQ_UNICORN_Q_API_URL ??
    "https://capital-qq-api-production.up.railway.app";
  const evidence = mkdtempSync(join(tmpdir(), "cq-unicorn-live-"));
  chmodSync(evidence, 0o700);
  const write = (name, value) =>
    writeFileSync(join(evidence, name), JSON.stringify(value, null, 2), {
      mode: 0o600,
    });
  const outcomes = [];
  let browser;
  try {
    const require = createRequire(
      new URL("../../../apps/web/package.json", import.meta.url),
    );
    const { createServerClient } = require("@supabase/ssr");
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({
      executablePath:
        process.env.CQ_UNICORN_CHROMIUM_PATH ?? "/usr/bin/chromium",
      ...(process.env.HTTPS_PROXY
        ? {
            proxy: {
              server: process.env.HTTPS_PROXY,
              bypass: "localhost,127.0.0.1",
            },
          }
        : {}),
      args: ["--no-sandbox"],
    });
    for (const actor of fixture.actors) {
      const cookies = new Map();
      const client = createServerClient(
        config.NEXT_PUBLIC_SUPABASE_URL,
        config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        {
          cookieOptions: {
            secure: true,
            httpOnly: true,
            sameSite: "lax",
            path: "/",
          },
          cookies: {
            getAll: () => [...cookies.values()],
            setAll: (items) => items.forEach((c) => cookies.set(c.name, c)),
          },
        },
      );
      const saved = JSON.parse(readFileSync(actor.sessionFile, "utf8"));
      const signed = await client.auth.setSession(saved);
      assert.ok(
        !signed.error && signed.data.session,
        "Existing authorized session unavailable",
      );
      assert.equal(
        signed.data.session.user.id,
        saved.user.id,
        "Session changed actor",
      );
      writeFileSync(actor.sessionFile, JSON.stringify(signed.data.session), {
        mode: 0o600,
      });
      const headers = {
        authorization: `Bearer ${signed.data.session.access_token}`,
        ...(actor.organisationId
          ? { "x-organisation-id": actor.organisationId }
          : {}),
      };
      const read = async (base, path) => {
        const response = await fetch(new URL(path, base), { headers });
        const body = await response.json();
        return { status: response.status, body };
      };
      const assessment = await read(
        qapi,
        `/v1/companies/${fixture.scoredCompanyId}/unicorn-potential`,
      );
      write(`${actor.role}-assessment.json`, assessment);
      assert.equal(
        assessment.status,
        actor.expectedScoreHttp,
        "Score entitlement/visibility mismatch",
      );
      if (actor.expectedScoreHttp !== 200 && actor.role !== "premiumFounder") {
        assert.ok(
          !JSON.stringify(assessment.body).includes("overallScore"),
          "Protected score leaked in refusal",
        );
        const filter = await read(
          api,
          "/v1/discovery/companies?unicornPotentialMin=0&unicornPotentialSort=true",
        );
        assert.equal(
          filter.status,
          403,
          "Free direct premium filter must be refused",
        );
        const profiles = await read(
          qapi,
          `/v1/fit/companies?ids=${fixture.scoredCompanyId}`,
        );
        assert.equal(
          profiles.status,
          200,
          "Ordinary permitted profile lookup failed",
        );
        const visible = profiles.body.items?.find(
          (item) => item.companyId === fixture.scoredCompanyId,
        );
        assert.ok(
          visible,
          "Need an ordinary visible company to prove premium denial independently",
        );
        assert.equal(
          visible.scores?.unicornPotential,
          undefined,
          "Premium value leaked through ordinary profile batch",
        );
        const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
          ignoreHTTPSErrors: false,
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
        const page = await context.newPage();
        await page.goto(
          new URL(
            actor.profilePath ?? `/companies/${fixture.scoredCompanyId}`,
            web,
          ).href,
          { waitUntil: "domcontentloaded", timeout: 60000 },
        );
        await page
          .locator('[data-company-scores="full"]')
          .waitFor({ timeout: 45000 });
        assert.equal(
          await page.locator('[data-score="unicorn-potential"]').count(),
          0,
          "Free browser exposed premium assessment",
        );
        await page.screenshot({
          path: join(evidence, `${actor.role}-mobile-denial.png`),
          fullPage: true,
        });
        await context.close();
        outcomes.push({
          role: actor.role,
          api: "PASS",
          browser: "PASS_HIDDEN",
          q: "NOT_RUN",
        });
        continue;
      }
      if (actor.expectedScoreHttp === 200)
        verifyAssessment(assessment.body, "SCORED");
      if (actor.role === "noMandateInvestor") {
        const ordinary = await read(api, "/v1/discovery/companies?limit=1");
        assert.equal(ordinary.status, 200, "No-mandate feed refused");
        assert.ok(
          ordinary.body.notes.includes("NO_ACTIVE_MANDATE"),
          "Fixture is not actually a no-mandate account",
        );
      }
      const orgDenied = await fetch(
        new URL(
          `/v1/companies/${fixture.scoredCompanyId}/unicorn-potential`,
          qapi,
        ),
        {
          headers: {
            ...headers,
            "x-organisation-id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          },
        },
      );
      assert.ok(
        [403, 404].includes(orgDenied.status),
        "Foreign organization context accepted",
      );
      if (actor.role === "premiumInvestor") {
        const thin = await read(
          qapi,
          `/v1/companies/${fixture.unscoredCompanyId}/unicorn-potential`,
        );
        assert.equal(thin.status, 200, "Entitled unscored record unavailable");
        verifyAssessment(thin.body, "INSUFFICIENT_EVIDENCE");
        write("unscored-assessment.json", thin);
      }
      let founderAssessment;
      if (actor.role === "premiumFounder") {
        const applications = await read(api, "/v1/gateq/my-applications");
        assert.equal(
          applications.status,
          200,
          "Founder applications unavailable",
        );
        const application = applications.body.applications.find(
          (a) => a.applicationId === actor.applicationId,
        );
        assert.ok(
          application?.unicornPotential?.assessment,
          "Existing founder application lacks entitled current-company assessment",
        );
        founderAssessment = application.unicornPotential;
        verifyAssessment(
          founderAssessment.assessment,
          founderAssessment.assessment.status,
        );
        write("founder-gateq.json", applications);
      }
      for (const [device, viewport] of [
        ["desktop", { width: 1440, height: 960 }],
        ["mobile", { width: 390, height: 844 }],
      ]) {
        const context = await browser.newContext({
          viewport,
          ignoreHTTPSErrors: false,
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
        const runs = [];
        page.on("request", (r) => {
          const m = /\/q\/runs\/([0-9a-f-]{36})\/events/i.exec(
            new URL(r.url()).pathname,
          );
          if (m) runs.push(m[1]);
        });
        await page.goto(
          new URL(
            actor.role === "premiumFounder"
              ? actor.gateqPath
              : (actor.profilePath ?? `/companies/${fixture.scoredCompanyId}`),
            web,
          ).href,
          { waitUntil: "domcontentloaded", timeout: 60000 },
        );
        const panel = page
          .locator(
            actor.role === "premiumFounder"
              ? `[data-testid="gateq-unicorn-assessment"] #unicorn-potential-${founderAssessment.companyId}`
              : '[data-score="unicorn-potential"]',
          )
          .first();
        await panel.waitFor({ timeout: 45000 });
        await panel.locator(":scope > summary").click();
        assert.equal(
          (await panel.getAttribute("open")) !== null,
          true,
          "Assessment did not open",
        );
        await panel.getByText(CAVEAT, { exact: false }).waitFor();
        assert.equal(
          await panel.locator("[data-unicorn-pillar]").count(),
          12,
          "Browser pillar count",
        );
        await panel
          .locator("[data-unicorn-pillar] > summary")
          .evaluateAll((elements) =>
            elements.forEach((e) => {
              if (!e.parentElement.open) e.click();
            }),
          );
        const heights = await panel
          .locator("summary")
          .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().height),
          );
        assert.ok(
          heights.every((height) => height >= 44),
          "Assessment control touch target below 44px",
        );
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        );
        assert.equal(overflow, false, "Mobile/desktop document overflow");
        const expected =
          actor.role === "premiumFounder"
            ? founderAssessment.assessment
            : assessment.body;
        if (expected) {
          const text = await panel.innerText();
          if (expected.overallScore !== null)
            assert.ok(
              text.includes(String(expected.overallScore)),
              "Actual score not rendered",
            );
          for (const p of expected.pillars)
            for (const c of p.criteria) {
              assert.ok(
                text.includes(c.label) && text.includes(c.anchor),
                "Criterion explanation missing",
              );
              for (const source of c.sources)
                assert.ok(
                  text.includes(source.id) && text.includes(source.revision),
                  "Visible lineage missing",
                );
            }
        }
        let q = "NOT_RUN";
        if (
          actor.role === "premiumInvestor" &&
          device === "desktop" &&
          process.env.CQ_UNICORN_VERIFY_Q === "1"
        ) {
          await panel.locator(":scope > summary").click();
          const receipts = [];
          page.on("request", (r) => {
            if (
              new URL(r.url()).pathname === "/api/q-ui-acts" &&
              r.method() === "POST"
            ) {
              try {
                receipts.push(r.postDataJSON());
              } catch {
                // Ignore non-JSON browser requests, never treat them as receipts.
              }
            }
          });
          const prior = new Set(runs),
            question =
              "Explain this company's Unicorn Potential score, its actual calculation, strongest evidence and missing inputs. Open its Unicorn Potential assessment.";
          const input = page.getByPlaceholder("Ask Q", { exact: true });
          if (!(await input.isVisible()))
            await page.locator("[data-q-dock-button]:visible").first().click();
          await input.waitFor({ timeout: 30000 });
          await input.fill(question);
          await input.press("Enter");
          let run;
          for (let n = 0; n < 180; n++) {
            const id = runs.findLast((id) => !prior.has(id));
            if (id) {
              const owned = await read(qapi, `/v1/q/runs/${id}`);
              assert.equal(owned.status, 200, "Owned Q run denied");
              if (
                [
                  "COMPLETED",
                  "FAILED",
                  "AWAITING_INPUT",
                  "AWAITING_APPROVAL",
                ].includes(owned.body.status)
              ) {
                run = owned.body;
                break;
              }
            }
            await page.waitForTimeout(500);
          }
          assert.equal(
            run?.status,
            "COMPLETED",
            "Fresh Q answer did not complete",
          );
          const latest = run.messages.findLast(
            (m) => m.role === "Q" && m.runId === run.runId,
          );
          assert.ok(latest?.text && latest.messageId, "Fresh answer absent");
          assert.ok(
            latest.text.includes(String(assessment.body.overallScore)) &&
              /unicorn|potential/i.test(latest.text),
            "Q score explanation mismatch",
          );
          for (const term of fixture.qExpectedTerms)
            assert.ok(
              latest.text.toLowerCase().includes(term.toLowerCase()),
              "Q omitted configured real evidence term",
            );
          assert.ok(
            (await panel.getAttribute("open")) !== null,
            "Q failed to open actual assessment",
          );
          const hasReceipt = () =>
            receipts.some((payload) =>
              (payload.reports ?? []).some(
                (report) =>
                  report.intent?.target === "disclosure.unicorn-potential" &&
                  report.receipt?.status === "DONE",
              ),
            );
          for (let n = 0; n < 30 && !hasReceipt(); n++)
            await page.waitForTimeout(100);
          assert.ok(hasReceipt(), "Q opening has no exact target DONE receipt");
          await page.evaluate((source) => {
            window.__cqUnicornReadAnswer = Function(`return (${source})`)();
          }, renderedInvestorAnswer.toString());
          const expectedAnswer = {
            runId: run.runId,
            messageId: latest.messageId,
            text: latest.text,
            question,
            cards: (latest.blocks ?? [])
              .filter((b) => b.kind === "ANSWER_CARDS")
              .flatMap((b) => b.cards),
          };
          await page.waitForFunction(
            (expected) => Boolean(window.__cqUnicornReadAnswer({ expected })),
            expectedAnswer,
            { timeout: 30000 },
          );
          write("investor-q-run.json", run);
          q = "PASS_CURRENT_RUN_RENDERED";
        }
        await page.screenshot({
          path: join(evidence, `${actor.role}-${device}.png`),
          fullPage: true,
        });
        if (actor.role === "premiumInvestor" && device === "desktop") {
          const collect = async (query, maxPages = 3) => {
            const items = [];
            let cursor = null;
            for (let n = 0; n < maxPages; n++) {
              const params = new URLSearchParams({
                ...query,
                limit: "20",
                ...(cursor ? { cursor } : {}),
              });
              const result = await read(
                api,
                `/v1/discovery/companies?${params}`,
              );
              assert.equal(result.status, 200, "Premium Discover API refused");
              items.push(...result.body.items);
              cursor = result.body.nextCursor;
              if (!cursor) break;
            }
            return items;
          };
          const baseline = await collect({});
          const filtered = await collect({ unicornPotentialMin: "0" });
          assertOrderPreserved(baseline, filtered);
          const sorted = await collect(
            {
              unicornPotentialMin: "0",
              unicornPotentialSort: "true",
            },
            1,
          );
          assert.ok(
            sorted.length >= 2,
            "Need two genuine scored Discover companies",
          );
          let previous = 101;
          for (const item of sorted) {
            const current = await read(
              qapi,
              `/v1/companies/${item.companyId}/unicorn-potential`,
            );
            assert.equal(
              current.status,
              200,
              "Sorted company score unavailable",
            );
            verifyAssessment(current.body, "SCORED");
            assert.ok(
              current.body.overallScore <= previous,
              "Explicit premium sort not descending",
            );
            previous = current.body.overallScore;
          }
          write("discover-authorized-pages.json", {
            baseline,
            filtered,
            sorted,
          });
          await page.goto(new URL("/discover", web).href, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
          const close = page.getByRole("button", {
            name: "Close Q's briefing",
            exact: true,
          });
          if (await close.isVisible()) await close.click();
          await page
            .getByRole("button", { name: /^Filters(?:,|$)/ })
            .first()
            .click();
          await page
            .getByLabel("Minimum indicator score", { exact: true })
            .selectOption("0");
          await page
            .getByRole("button", { name: "Show companies", exact: true })
            .click();
          await page
            .getByRole("heading", {
              name: filtered[0].canonicalName,
              exact: true,
            })
            .first()
            .waitFor({ timeout: 45000 });
          await page
            .getByRole("button", { name: /^Filters(?:,|$)/ })
            .first()
            .click();
          await page
            .getByRole("button", {
              name: "Sort by Unicorn Potential",
              exact: true,
            })
            .click();
          await page
            .getByRole("button", { name: "Show companies", exact: true })
            .click();
          await page
            .getByRole("heading", {
              name: sorted[0].canonicalName,
              exact: true,
            })
            .first()
            .waitFor({ timeout: 45000 });
          const stored = await page.evaluate(() =>
            JSON.parse(
              window.localStorage.getItem("cq.discover.filters.v1") ?? "null",
            ),
          );
          assert.equal(
            stored?.unicornPotentialMin,
            0,
            "Native filter did not persist",
          );
          assert.equal(
            stored?.unicornPotentialSort,
            true,
            "Native sort did not persist",
          );
          await page.screenshot({
            path: join(evidence, "premiumInvestor-desktop-discover.png"),
            fullPage: true,
          });
          outcomes.push({
            role: actor.role,
            discover: "PASS_API_AND_NATIVE_CONTROLS",
            boundedBaseline: baseline.length,
            filtered: filtered.length,
            sorted: sorted.length,
          });
        }

        outcomes.push({
          role: actor.role,
          device,
          api: "PASS",
          browser: "PASS",
          q,
        });
        await context.close();
      }
    }
    // Profile and Q checks do not certify Discover or a production deployment.
    write("outcomes.json", outcomes);
    console.log(
      JSON.stringify({
        status: "PARTIAL_ACCEPTANCE",
        evidence,
        checks: outcomes.length,
        remaining: [
          "visual screenshot inspection",
          ...(process.env.CQ_UNICORN_VERIFY_Q === "1" ? [] : ["Q explanation"]),
        ],
      }),
    );
  } catch (error) {
    write("failure.json", {
      message: String(error?.message ?? error),
      stack: error?.stack,
    });
    write("outcomes.json", outcomes);
    console.log(JSON.stringify({ status: "FAILED", evidence }));
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await main();
