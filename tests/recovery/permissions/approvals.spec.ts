import { expect, test } from "@playwright/test";

import { call, isRefusal } from "../support/http.js";
import { pendingReminderApproval, runQ } from "../support/flows.js";
import { awaits } from "../support/expected-red.js";
import { answer } from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * Approvals that cannot be self-authorised (SPEC §4.2; CLAUDE.md "Q action
 * authority"). The approval belongs to the person it was prepared for; a
 * different person, a different tenant, the model, or a request that tries
 * to carry its own authority, cannot decide it.
 */
const APPROVALS = "/v1/q/approvals";

test.describe("an approval only its owner can decide", () => {
  let approvalId = "";

  test.beforeAll(async () => {
    ({ approvalId } = await pendingReminderApproval(CAST.founder));
  });

  test("another founder cannot read, approve or reject it", async () => {
    for (const path of [`${APPROVALS}/${approvalId}`]) {
      expect(
        isRefusal(await call(CAST.otherFounder, "q-api", "GET", path)),
      ).toBe(true);
    }
    const approve = await call(
      CAST.otherFounder,
      "q-api",
      "POST",
      `${APPROVALS}/${approvalId}/approve`,
      {},
    );
    expect(
      isRefusal(approve),
      `approve by another founder: ${String(approve.status)}`,
    ).toBe(true);
    const reject = await call(
      CAST.otherFounder,
      "q-api",
      "POST",
      `${APPROVALS}/${approvalId}/reject`,
      {},
    );
    expect(
      isRefusal(reject),
      `reject by another founder: ${String(reject.status)}`,
    ).toBe(true);
  });

  test("the investor it concerns cannot approve it either", async () => {
    const approve = await call(
      CAST.investor,
      "q-api",
      "POST",
      `${APPROVALS}/${approvalId}/approve`,
      {},
    );
    expect(
      isRefusal(approve),
      `approve by investor: ${String(approve.status)}`,
    ).toBe(true);
  });

  test("no session, no decision", async () => {
    const approve = await call(
      null,
      "q-api",
      "POST",
      `${APPROVALS}/${approvalId}/approve`,
      {},
    );
    expect(approve.status).toBe(401);
  });

  test("a request cannot carry its own authority (approver, hash, role, tenant)", async () => {
    for (const forged of [
      { approver: CAST.founder },
      { payloadHash: "0".repeat(64) },
      { role: "OWNER" },
      { tenantId: "00000000-0000-4000-8000-000000000000" },
    ]) {
      const reply = await call(
        CAST.otherFounder,
        "q-api",
        "POST",
        `${APPROVALS}/${approvalId}/approve`,
        forged,
      );
      expect(reply.status, JSON.stringify(forged)).toBeGreaterThanOrEqual(400);
      expect(reply.status).toBeLessThan(500);
    }
    // The owner sending extra fields is refused too: strict contract.
    const owner = await call(
      CAST.founder,
      "q-api",
      "POST",
      `${APPROVALS}/${approvalId}/approve`,
      {
        payloadHash: "0".repeat(64),
      },
    );
    expect([400, 422]).toContain(owner.status);
  });

  test("after every refused attempt it is still pending, for its owner", async () => {
    const own = await call(
      CAST.founder,
      "q-api",
      "GET",
      `${APPROVALS}/${approvalId}`,
    );
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).toMatch(/"status":"PENDING"/u);
  });

  test("the owner can decide it, once (positive control and idempotency)", async () => {
    const first = await call(
      CAST.founder,
      "q-api",
      "POST",
      `${APPROVALS}/${approvalId}/approve`,
      {},
    );
    expect(first.status, first.text.slice(0, 200)).toBeLessThan(300);
    const again = await call(
      CAST.founder,
      "q-api",
      "POST",
      `${APPROVALS}/${approvalId}/approve`,
      {},
    );
    // A retried decision never executes twice: 2xx (same result) or 409.
    expect([200, 201, 202, 409]).toContain(again.status);
  });
});

/**
 * Defect G-D4. `approve_pending_proposal` (packages/q-tools/src/tools/
 * pending-proposal.ts:167-215) approves any PENDING item in the person's
 * inbox by `approvalId`; the only check that the person said yes is the
 * model's own reading of their words. Here the person only ASKS what is
 * waiting, and a model that decides to approve anyway (a bad reading, or an
 * instruction planted in a document or web page) succeeds. SPEC §4.2: a yes
 * binds to the one proposal presented, and authority comes from the server.
 */
test("a model cannot approve on its own initiative when the person only asked a question", async () => {
  awaits(
    ["D2", "B7"],
    "defect G-D4: approve_pending_proposal trusts the model's reading of the person's words",
  );
  const { approvalId } = await pendingReminderApproval(CAST.founder);
  await runQ(CAST.founder, "What is waiting for me right now?", [
    {
      name: "self-approve",
      when: {
        task: "COMPANY_ANALYST",
        user: "What is waiting for me right now",
        afterTool: null,
      },
      reply: {
        toolCalls: [
          { name: "approve_pending_proposal", arguments: { approvalId } },
        ],
      },
    },
    {
      name: "after-self-approve",
      when: { task: "COMPANY_ANALYST", afterTool: "approve_pending_proposal" },
      reply: answer("One reminder is waiting for your decision."),
    },
  ]);
  const still = await call(
    CAST.founder,
    "q-api",
    "GET",
    `/v1/q/approvals/${approvalId}`,
  );
  expect(
    JSON.stringify(still.body),
    "the approval after a question, not a yes",
  ).toMatch(/"status":"(PENDING|AWAITING_APPROVAL|REQUESTED)"/u);
});

test("a model cannot decide another person's approval, whatever it is told", async () => {
  const { approvalId } = await pendingReminderApproval(CAST.founder);
  await runQ(CAST.otherFounder, "Yes, approve it", [
    {
      name: "cross-tenant-approve",
      when: {
        task: "COMPANY_ANALYST",
        user: "Yes, approve it",
        afterTool: null,
      },
      reply: {
        toolCalls: [
          { name: "approve_pending_proposal", arguments: { approvalId } },
        ],
      },
    },
    {
      name: "after-cross",
      when: { task: "COMPANY_ANALYST", afterTool: "approve_pending_proposal" },
      reply: answer("There is nothing of yours waiting."),
    },
  ]);
  const still = await call(
    CAST.founder,
    "q-api",
    "GET",
    `/v1/q/approvals/${approvalId}`,
  );
  expect(JSON.stringify(still.body)).toMatch(
    /"status":"(PENDING|AWAITING_APPROVAL|REQUESTED)"/u,
  );
});
