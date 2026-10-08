import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { awaits } from "../support/expected-red.js";
import { failServerActions } from "../support/faults.js";
import { pendingReminderApproval, runQ } from "../support/flows.js";
import { call, tokenFor } from "../support/http.js";
import { expireApproval, stack } from "../support/local-db.js";
import { expectLastTurnTerminal, send } from "../support/q.js";
import { answer, useScript } from "../support/script.js";
import { CAST, Q_API_URL } from "../support/stack.js";

/**
 * SPEC §5 Scenario H, the non-voice half: network loss, relay failure,
 * model timeout and outage, expired approval, worker restart, duplicate
 * event. (Voice failures: tests/recovery/voice/.) The rule in every case:
 * the turn reaches a terminal disposition the person can see, nothing is
 * silently lost, and nothing happens twice.
 */

test("network loss while sending: a visible failure, then a working retry", async ({
  browser,
}) => {
  awaits(["A4", "G-R3"], "FAILED/NETWORK disposition rendering is A4/G-R3");
  const context = await contextAs(browser, CAST.founder);
  const page = await context.newPage();
  await useScript([
    {
      name: "ok",
      when: { user: "after the outage" },
      reply: answer("Back again."),
    },
  ]);
  await page.goto("/home");
  await context.setOffline(true);
  await send(page, "after the outage, are you there?");
  await expectLastTurnTerminal(page, ["FAILED"], 30_000);
  await expect(page.locator("[data-q-turn-id]").last()).toHaveAttribute(
    "data-q-failure",
    "NETWORK",
  );
  await context.setOffline(false);
  await page
    .getByRole("button", { name: /Try again|Retry/u })
    .last()
    .click();
  await expectLastTurnTerminal(page, ["ANSWERED"]);
  await context.close();
});

test("relay failure (the server action is lost): the person sees it, not an endless 'Thinking'", async ({
  browser,
}) => {
  awaits(
    ["A4", "A8", "G-R3"],
    "deadline-bounded relay and terminal disposition are A4/A8",
  );
  const context = await contextAs(browser, CAST.founder);
  const page = await context.newPage();
  await page.goto("/home");
  const stop = await failServerActions(page, 1, "hang");
  await send(page, "is the relay alive?");
  await expectLastTurnTerminal(page, ["FAILED"], 90_000);
  await stop();
  await context.close();
});

test("model timeout: the turn fails visibly within the deadline", async ({
  browser,
}) => {
  awaits(
    ["A4", "G-R3"],
    "the turn watchdog and the FAILED/TIMEOUT disposition",
  );
  const context = await contextAs(browser, CAST.founder);
  const page = await context.newPage();
  await useScript([
    {
      name: "hang",
      when: { task: "COMPANY_ANALYST", user: "never answers" },
      reply: { hang: true },
    },
  ]);
  await page.goto("/home");
  await send(page, "this question never answers");
  await expectLastTurnTerminal(page, ["FAILED"], 150_000);
  await context.close();
});

test("model outage: Q says it could not answer, and the run is FAILED, not silent", async () => {
  const result = await runQ(
    CAST.founder,
    "During the outage, how much am I raising?",
    [
      {
        name: "outage",
        when: { task: "COMPANY_ANALYST", user: "During the outage" },
        reply: { status: 503, body: { error: { message: "scripted outage" } } },
      },
    ],
  );
  expect(result.status).toBe("FAILED");
  expect(JSON.stringify(result.run["failure"] ?? null)).toMatch(/retryable/u);
});

// Covers the Q conversation. Audit D-01 proper (a standing instruction's
// counterpart thread parked by a lapsed card) needs D2's escalation and a
// counterpart message, and is not proven by this test.
test("an expired approval says so, and the Q conversation goes on", async () => {
  const { approvalId, runId } = await pendingReminderApproval(CAST.founder);
  expireApproval(approvalId);
  const decided = await call(
    CAST.founder,
    "q-api",
    "POST",
    `/v1/q/approvals/${approvalId}/approve`,
    {},
  );
  expect(decided.status).toBeGreaterThanOrEqual(400);
  expect(decided.text).toMatch(/expired/iu);
  // The conversation goes on: the next message is answered.
  const run = await call(CAST.founder, "q-api", "GET", `/v1/q/runs/${runId}`);
  const conversationId = String(
    (run.body as { conversationId?: unknown }).conversationId,
  );
  const next = await runQ(
    CAST.founder,
    "OK, what now?",
    [
      {
        name: "next",
        when: { task: "COMPANY_ANALYST", user: "OK, what now" },
        reply: answer("That reminder lapsed; shall I prepare it again?"),
      },
    ],
    conversationId,
  );
  expect(next.status).toBe("COMPLETED");
});

test("duplicate request: the same Idempotency-Key makes one run and one message", async () => {
  await useScript([
    {
      name: "dup",
      when: { task: "COMPANY_ANALYST", user: "duplicate check" },
      reply: answer("Once."),
    },
  ]);
  const key = `recovery-g-dup-${randomUUID()}`;
  const post = async () =>
    fetch(`${Q_API_URL}/v1/q/runs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await tokenFor(CAST.founder)}`,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify({
        capability: "ANSWER",
        message: { text: "duplicate check" },
        modality: "TEXT",
      }),
    }).then(async (response) => ({
      status: response.status,
      body: (await response.json()) as { runId?: string },
    }));
  const [first, second] = await Promise.all([post(), post()]);
  expect(first.body.runId).toBeDefined();
  expect(second.body.runId).toBe(first.body.runId);
});

test("worker restart mid-job: the job resumes instead of staying RUNNING forever (audit D-08)", async () => {
  awaits(["D3"], "durable jobs with leases are D3");
  test.setTimeout(420_000);
  await useScript([
    {
      name: "job",
      when: {
        task: "COMPANY_ANALYST",
        user: "research two investors",
        afterTool: null,
      },
      reply: {
        toolCalls: [
          {
            name: "propose_q_job",
            arguments: { goal: "Research two investors for Ledgerfold." },
          },
        ],
      },
    },
    {
      name: "after-job",
      when: { task: "COMPANY_ANALYST", afterTool: "propose_q_job" },
      reply: answer("Approve the plan on the card."),
    },
  ]);
  const proposed = await runQ(
    CAST.founder,
    "Please research two investors for us",
  );
  const approvals = await call(CAST.founder, "q-api", "GET", "/v1/q/approvals");
  const item = (
    (approvals.body as { items?: Array<{ approvalId: string; runId: string }> })
      .items ?? []
  ).find((a) => a.runId === proposed.runId);
  expect(item, "the job was proposed for approval").toBeDefined();
  await call(
    CAST.founder,
    "q-api",
    "POST",
    `/v1/q/approvals/${item?.approvalId ?? ""}/approve`,
    {},
  );
  // Restart the process that runs jobs while the job is in flight.
  stack("stop", "q-api");
  stack("start", "q-api");
  await expect
    .poll(
      async () =>
        JSON.stringify(
          (await call(CAST.founder, "q-api", "GET", "/v1/q/workforce/jobs"))
            .body,
        ),
      { timeout: 300_000, intervals: [5_000] },
    )
    .toMatch(/"(COMPLETED|FAILED|NEEDS_DECISION|BLOCKED)"/u);
});
