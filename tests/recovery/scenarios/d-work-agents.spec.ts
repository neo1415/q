import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { awaits } from "../support/expected-red.js";
import { call } from "../support/http.js";
import { ask } from "../support/q.js";
import { answer, useScript } from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * SPEC §5 Scenario D (Work agents): "research 5 investors, draft outreach,
 * have it reviewed, then ask me". The plan may only name roles that have an
 * executor (D1, audit D-02); the job is durable (D3); the Work page shows
 * the persisted state (D6, G-R5); and a job is COMPLETED only when its
 * deliverable exists (SPEC §4.8).
 */
const WORK_STATES =
  /^(PLANNED|AWAITING_AUTHORIZATION|QUEUED|RUNNING|BLOCKED|NEEDS_DECISION|RECOVERING|FAILED|CANCELLED|COMPLETED)$/u;

test("Scenario D: a research-and-drafts job runs to an honest state, and asks before anything goes out", async ({
  browser,
}) => {
  awaits(
    ["D1", "D3", "D4", "D6", "G-R5"],
    "executor registry, durable jobs and the Work state attribute are not in the baseline",
  );
  const context = await contextAs(browser, CAST.founder);
  const page = await context.newPage();
  await page.goto("/work");
  await useScript([
    {
      name: "propose-job",
      when: {
        task: "COMPANY_ANALYST",
        user: "research five investors",
        afterTool: null,
      },
      reply: {
        toolCalls: [
          {
            name: "propose_q_job",
            arguments: {
              goal: "Research five investors that fit Ledgerfold, draft an intro to each, have the drafts reviewed, then ask me before sending.",
            },
          },
        ],
      },
    },
    {
      name: "after-job",
      when: { task: "COMPANY_ANALYST", afterTool: "propose_q_job" },
      reply: answer("The plan is on the card for you to approve."),
    },
  ]);
  await ask(
    page,
    "Please research five investors that fit us, draft intros, have them reviewed, and ask me before sending",
  );

  // The plan is shown for approval, with only roles that can run.
  const card = page.locator("[data-q-approval-card]").last();
  await expect(card).toBeVisible();
  const roles = await card
    .locator("[data-work-role]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-work-role")),
    );
  expect(roles.length).toBeGreaterThan(0);
  for (const role of roles) {
    expect([
      "LEAD",
      "CONVERSATION",
      "OUTREACH",
      "RESEARCH",
      "DOCUMENTS",
      "SCHEDULING",
      "DISCOVERY",
      "DILIGENCE",
    ]).toContain(role);
  }
  await card.getByRole("button", { name: /^Approve/u }).click();

  // Work shows the job in a durable state, and never COMPLETED without drafts.
  await page.goto("/work");
  const row = page.locator("[data-work-state]").first();
  await expect(row).toHaveAttribute("data-work-state", WORK_STATES, {
    timeout: 120_000,
  });
  const jobs = await call(CAST.founder, "q-api", "GET", "/v1/q/workforce/jobs");
  expect(jobs.status).toBe(200);
  const state = await row.getAttribute("data-work-state");
  if (state === "COMPLETED") {
    // A completed job has its deliverable: drafts exist and are held for approval.
    await expect(page.locator("[data-work-draft]")).not.toHaveCount(0);
  }
  // Nothing was sent without the person: outreach waits on an approval.
  expect(JSON.stringify(jobs.body)).not.toMatch(/"sent":\s*[1-9]/u);
  await context.close();
});

test("a failed agent shows as FAILED or RECOVERING with a reason, never as done", async ({
  browser,
}) => {
  awaits(["D4", "D6", "G-R5"], "honest Work states are D4/D6");
  const context = await contextAs(browser, CAST.otherFounder);
  const page = await context.newPage();
  await page.goto("/work");
  await useScript([
    {
      name: "propose-job",
      when: {
        task: "COMPANY_ANALYST",
        user: "research three investors",
        afterTool: null,
      },
      reply: {
        toolCalls: [
          {
            name: "propose_q_job",
            arguments: { goal: "Research three investors for Tarmacly." },
          },
        ],
      },
    },
    {
      name: "after-job",
      when: { task: "COMPANY_ANALYST", afterTool: "propose_q_job" },
      reply: answer("Approve the plan on the card."),
    },
    // Every agent model call fails as a provider outage would.
    {
      name: "agents-fail",
      when: { user: "Tarmacly" },
      reply: { status: 503, body: { error: { message: "scripted outage" } } },
    },
  ]);
  await ask(page, "research three investors for us");
  await page
    .locator("[data-q-approval-card]")
    .last()
    .getByRole("button", { name: /^Approve/u })
    .click();
  await page.goto("/work");
  const row = page.locator("[data-work-state]").first();
  await expect(row).toHaveAttribute(
    "data-work-state",
    /^(FAILED|RECOVERING|BLOCKED)$/u,
    { timeout: 180_000 },
  );
  await expect(row).toContainText(/couldn't|could not|failed|retry/iu);
  await context.close();
});
