import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Live investor rehearsal. Creates internal Q turns for an existing authorized session.
 * No account creation, email, interest, outreach or approval actions.
 * Full private receipts and screenshots stay in a fresh mode-700 temporary directory.
 * Console output is durations, counts and binding checks only. */
const sessionFile = process.env.CQ_DEMO_SESSION_FILE;
const publicKeyFile = process.env.CQ_DEMO_PUBLIC_KEY_FILE;
const founderRecordFile = process.env.CQ_DEMO_FOUNDER_RECORD_FILE;
if (!sessionFile || !publicKeyFile)
  throw new Error("Set CQ_DEMO_SESSION_FILE and CQ_DEMO_PUBLIC_KEY_FILE");
const webUrl =
  process.env.CQ_DEMO_WEB_URL ??
  "https://capital-qweb-production.up.railway.app";
const qApiUrl =
  process.env.CQ_DEMO_Q_API_URL ??
  "https://capital-qq-api-production.up.railway.app";
const supabaseUrl =
  process.env.CQ_DEMO_SUPABASE_URL ??
  "https://vcohxiqsmnkzxnvawgri.supabase.co";
const evidenceDir = mkdtempSync(join(tmpdir(), "cq-investor-demo-"));

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
async function rehearse() {
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
    const r = await page.goto(new URL("/discover", webUrl).href, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.locator("main").waitFor({ timeout: 30000 });
    if (new URL(page.url()).pathname !== "/discover")
      throw new Error("Discover redirected away from the authorized workspace");
    console.log(
      JSON.stringify({
        phase: "discover",
        http: r.status(),
        mainVisible: await page.locator("main").isVisible(),
      }),
    );
    const observed = [];
    page.on("request", (r) => {
      const m = /\/q\/runs\/([0-9a-f-]{36})\/events/i.exec(
        new URL(r.url()).pathname,
      );
      if (m) observed.push(m[1]);
    });
    async function ask(label, text) {
      let input = page.getByPlaceholder("Ask Q", { exact: true });
      if (!(await input.isVisible())) {
        await page
          .getByRole("button", { name: "Ask Q", exact: true })
          .first()
          .click();
        await input.waitFor({ timeout: 30000 });
      }
      const priorRuns = new Set(observed);
      await input.fill(text);
      await page.evaluate((question) => {
        const oldText = document.querySelector(
          "[data-q-answer] > .cq-body",
        )?.textContent;
        const state = {
          started: performance.now(),
          firstAnswerText20Ms: null,
          firstRenderedCardMs: null,
        };
        const previousCards = new Set(
          document.querySelectorAll("[data-q-answer] [data-ac-card]"),
        );
        const observer = new window.MutationObserver(() => {
          if (
            !document
              .querySelector("[data-q-panel-person]")
              ?.textContent.includes(question)
          )
            return;
          const answer = document.querySelector(
            "[data-q-answer] > .cq-body",
          )?.textContent;
          if (
            answer !== oldText &&
            answer?.trim().length >= 20 &&
            state.firstAnswerText20Ms === null
          )
            state.firstAnswerText20Ms = Math.round(
              performance.now() - state.started,
            );
          if (
            state.firstRenderedCardMs === null &&
            [
              ...document.querySelectorAll("[data-q-answer] [data-ac-card]"),
            ].some((card) => !previousCards.has(card))
          )
            state.firstRenderedCardMs = Math.round(
              performance.now() - state.started,
            );
        });
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
        });
        window.__cqDemoTiming = { state, observer };
      }, text);
      const started = performance.now();
      const created = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).hostname === new URL(webUrl).hostname,
        { timeout: 45000 },
      );
      await input.press("Enter");
      const response = await created;
      if (!response.ok())
        throw new Error("Browser action refused " + response.status());
      for (let n = 0; n < 150 && observed.every((id) => priorRuns.has(id)); n++)
        await page.waitForTimeout(200);
      if (observed.every((id) => priorRuns.has(id)))
        throw new Error("No fresh browser Q stream");
      const id = observed.findLast((id) => !priorRuns.has(id));
      let run;
      for (let n = 0; n < 200; n++) {
        const response = await fetch(
          new URL("/v1/q/runs/" + id, qApiUrl).href,
          { headers: { authorization: `Bearer ${session.access_token}` } },
        );
        if (!response.ok) throw new Error("Owned run refused");
        run = await response.json();
        if (
          [
            "COMPLETED",
            "FAILED",
            "AWAITING_INPUT",
            "AWAITING_APPROVAL",
          ].includes(run.status)
        )
          break;
        await page.waitForTimeout(200);
      }
      writeFileSync(
        join(evidenceDir, "run-" + label + ".json"),
        JSON.stringify(run),
        { mode: 0o600 },
      );
      if (
        run.status !== "COMPLETED" ||
        !run.messages.some(
          (m) => m.role === "USER" && m.runId === run.runId && m.text === text,
        )
      )
        throw new Error("CURRENT_QUESTION_NOT_COMPLETED");
      const blocks = run.messages
        .filter((m) => m.role === "Q" && m.runId === run.runId)
        .flatMap((m) => m.blocks ?? []);
      const cards = blocks
        .filter((b) => b.kind === "ANSWER_CARDS")
        .flatMap((b) => b.cards);
      // API completion can precede the browser's final stream update.
      // Measure the current settled answer, never disconnect before it renders.
      await page.waitForFunction(
        (question) =>
          document
            .querySelector("[data-q-panel-person]")
            ?.textContent.includes(question) &&
          document.querySelector('[data-q-answer="settled"]'),
        text,
        { timeout: 30000 },
      );
      const visibleTiming = await page.evaluate(() => {
        const timing = window.__cqDemoTiming;
        timing.observer.disconnect();
        return {
          firstAnswerText20Ms: timing.state.firstAnswerText20Ms,
          firstRenderedCardMs: timing.state.firstRenderedCardMs,
        };
      });
      console.log(
        JSON.stringify({
          phase: label,
          http: response.status(),
          status: run.status,
          completedClientMs: Math.round(performance.now() - started),
          ...visibleTiming,
          cards: cards.length,
          findings: blocks.filter((b) => b.kind === "FINDING").length,
          blockKinds: [...new Set(blocks.map((b) => b.kind))],
        }),
      );
      return { run, cards };
    }
    const top = await ask(
      "top-three",
      "Show my top 3 companies with scores against my mandate and explain why.",
    );
    if (
      top.cards.length !== 3 ||
      top.cards.some((c) => c.subject?.kind !== "COMPANY") ||
      new Set(top.cards.map((c) => c.subject.companyId)).size !== 3
    )
      throw new Error("Expected three genuine Q cards");
    await page.locator("[data-ac-card]").first().waitFor({ timeout: 30000 });
    await page.waitForFunction(
      () => document.querySelectorAll("[data-ac-card]").length === 3,
      undefined,
      { timeout: 30000 },
    );
    console.log(
      JSON.stringify({
        phase: "cards-rendered",
        cardElements: await page.locator("[data-ac-card]").count(),
        openControls: await page.locator("[data-ac-open]").count(),
      }),
    );
    await page.screenshot({ path: join(evidenceDir, "top-three.png") });
    const [first, second] = top.cards;
    await page.locator("[data-ac-open]").first().click();
    await page.waitForURL(
      (url) => url.pathname.includes(first.subject.companyId),
      { timeout: 30000 },
    );
    await page.locator("main").waitFor({ timeout: 30000 });
    await page.waitForFunction(
      (name) => document.querySelector("main")?.innerText.includes(name),
      first.name,
      { timeout: 30000 },
    );
    console.log(
      JSON.stringify({
        phase: "selected-profile",
        correctCompanyPath: new URL(page.url()).pathname.includes(
          first.subject.companyId,
        ),
        companyNameVisible: (await page.locator("main").innerText()).includes(
          first.name,
        ),
      }),
    );
    await page.screenshot({ path: join(evidenceDir, "profile.png") });
    const answer = await ask(
      "profile-question",
      "What does this company actually do and why does it fit my mandate? Use its Capital Q records.",
    );
    function findingsBound(run, companyId) {
      const findings = run.messages
        .filter((m) => m.role === "Q" && m.runId === run.runId)
        .flatMap((m) => m.blocks ?? [])
        .filter((b) => b.kind === "FINDING");
      return (
        findings.length > 0 &&
        findings.every((b) => {
          const companies = b.finding.subjects.filter(
            (s) => s.kind === "COMPANY",
          );
          return (
            companies.length > 0 &&
            companies.every((s) => s.companyId === companyId)
          );
        })
      );
    }
    const references = answer.run.messages
      .filter((m) => m.role === "Q" && m.runId === answer.run.runId)
      .flatMap((m) => m.blocks ?? [])
      .filter((b) => b.kind === "COMPANY_REFERENCE");
    if (
      !references.length ||
      !findingsBound(answer.run, first.subject.companyId) ||
      references.some((b) => b.companyId !== first.subject.companyId)
    )
      throw new Error("PROFILE_REFERENCE_MISMATCH");
    console.log(
      JSON.stringify({
        phase: "profile-binding",
        referenceCount: references.length,
        allReferencesCorrect:
          references.length > 0 &&
          references.every((b) => b.companyId === first.subject.companyId),
      }),
    );
    const risks = await ask(
      "risks-follow-up",
      "What traction, material risks and missing evidence are on record for this company? Distinguish claims from verified facts.",
    );
    const refs = risks.run.messages
      .filter((m) => m.role === "Q" && m.runId === risks.run.runId)
      .flatMap((m) => m.blocks ?? [])
      .filter((b) => b.kind === "COMPANY_REFERENCE");
    if (
      !refs.length ||
      !findingsBound(risks.run, first.subject.companyId) ||
      refs.some((b) => b.companyId !== first.subject.companyId)
    )
      throw new Error("FOLLOW_UP_REFERENCE_MISMATCH");
    console.log(
      JSON.stringify({
        phase: "follow-up-binding",
        referenceCount: refs.length,
        allReferencesCorrect:
          refs.length > 0 &&
          refs.every((b) => b.companyId === first.subject.companyId),
      }),
    );
    await page.screenshot({ path: join(evidenceDir, "follow-up.png") });
    const comparison = await ask(
      "comparison",
      `Compare ${first.name} and ${second.name} against my mandate. Show each company, known facts, mismatches and evidence gaps using the authorized Capital Q records.`,
    );
    const expected = new Set([
      first.subject.companyId,
      second.subject.companyId,
    ]);
    const compared = comparison.cards.map((c) =>
      c.subject?.kind === "COMPANY" ? c.subject.companyId : null,
    );
    if (
      compared.length !== 2 ||
      new Set(compared).size !== 2 ||
      compared.some((id) => !expected.has(id))
    )
      throw new Error("COMPARISON_SUBSET_MISMATCH");
    console.log(
      JSON.stringify({
        phase: "comparison-binding",
        twoCanonicalCompanies: true,
      }),
    );
    await page.locator("[data-ac-card]").first().waitFor({ timeout: 30000 });
    await page.waitForFunction(
      () => document.querySelectorAll("[data-ac-card]").length === 2,
      undefined,
      { timeout: 30000 },
    );
    await page.screenshot({ path: join(evidenceDir, "comparison.png") });
    let knownFounderProfileVerified = false;
    if (founderRecordFile) {
      const selectedProfilePath = new URL(page.url()).pathname;
      const discoverResponse = await page.goto(
        new URL("/discover", webUrl).href,
        { waitUntil: "domcontentloaded", timeout: 45000 },
      );
      if (!discoverResponse.ok())
        throw new Error("Founder discovery page refused");
      await page.locator("main").waitFor({ timeout: 30000 });
      const founder = JSON.parse(readFileSync(founderRecordFile, "utf8"));
      if (
        !/^[0-9a-f-]{36}$/iu.test(founder.id) ||
        typeof founder.canonicalName !== "string" ||
        founder.canonicalName.length > 250
      )
        throw new Error("Invalid known founder record");
      const founderAnswer = await ask(
        "known-founder-evidence",
        `What does ${founder.canonicalName} actually do based on its authorized Capital Q profile? Distinguish declared information from unknowns; do not infer private onboarding responses.`,
      );
      const blocks = founderAnswer.run.messages
        .filter((m) => m.role === "Q" && m.runId === founderAnswer.run.runId)
        .flatMap((m) => m.blocks ?? []);
      const references = blocks.filter((b) => b.kind === "COMPANY_REFERENCE");
      const findings = blocks.filter((b) => b.kind === "FINDING");
      if (
        !references.length ||
        references.some((b) => b.companyId !== founder.id) ||
        !findings.length ||
        !findingsBound(founderAnswer.run, founder.id) ||
        findings.some(
          (b) =>
            !b.finding.subjects.some(
              (s) => s.kind === "COMPANY" && s.companyId === founder.id,
            ),
        ) ||
        blocks.some((b) => b.kind === "PUBLIC_SOURCE")
      )
        throw new Error("KNOWN_FOUNDER_EVIDENCE_BINDING_FAILED");
      const profilePath = selectedProfilePath.replace(
        first.subject.companyId,
        founder.id,
      );
      if (!profilePath.includes(founder.id))
        throw new Error("Founder profile route missing");
      const profileResponse = await page.goto(
        new URL(profilePath, webUrl).href,
        { waitUntil: "domcontentloaded", timeout: 45000 },
      );
      if (!profileResponse.ok())
        throw new Error("Known founder profile refused");
      await page.waitForFunction(
        (name) => document.querySelector("main")?.innerText.includes(name),
        founder.canonicalName,
        { timeout: 30000 },
      );
      const founderFollowUp = await ask(
        "known-founder-follow-up",
        "What traction, material risks and missing evidence are on record for this company? Distinguish declared claims from verified facts.",
      );
      const followUpRefs = founderFollowUp.run.messages
        .filter((m) => m.role === "Q" && m.runId === founderFollowUp.run.runId)
        .flatMap((m) => m.blocks ?? [])
        .filter((b) => b.kind === "COMPANY_REFERENCE");
      if (
        !followUpRefs.length ||
        followUpRefs.some((b) => b.companyId !== founder.id)
      )
        throw new Error("KNOWN_FOUNDER_FOLLOW_UP_FAILED");
      knownFounderProfileVerified = true;
      console.log(
        JSON.stringify({
          phase: "known-founder-binding",
          profileReferences: references.length,
          findings: findings.length,
          followUpReferences: followUpRefs.length,
          allReferencesCorrect: true,
          noPublicSourceSubstitution: true,
        }),
      );
      await page.screenshot({ path: join(evidenceDir, "known-founder.png") });
    }
    console.log(
      JSON.stringify({
        status: "PASS",
        actualBrowserJourney: true,
        knownFounderProfileVerified,
        evidenceDir,
      }),
    );
  } finally {
    await browser.close();
  }
}
await rehearse().catch((error) => {
  writeFileSync(
    join(evidenceDir, "failure.json"),
    JSON.stringify({
      name: error.name,
      message: error.message,
      stack: error.stack,
    }),
    { mode: 0o600 },
  );
  console.error(
    JSON.stringify({
      status: "FAILED",
      reason:
        "The live browser journey did not satisfy a required check; inspect the private local receipts.",
    }),
  );
  process.exitCode = 1;
});
