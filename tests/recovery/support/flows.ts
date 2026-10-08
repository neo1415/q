import { randomUUID } from "node:crypto";

import { call, tokenFor } from "./http";
import {
  answer,
  useScript,
  vendorMark,
  vendorRequestsSince,
  type ScriptRule,
  type VendorRequest,
} from "./script";
import { Q_API_URL } from "./stack";

/**
 * Q turns over the HTTP API (POST /v1/q/runs), for tests that need Q to
 * have done something before the browser or a second person looks at it.
 * The person's own bearer token; the model is the scripted fake.
 */
export type RunResult = {
  readonly runId: string;
  readonly conversationId: string;
  readonly status: string;
  readonly run: Record<string, unknown>;
  readonly vendor: readonly VendorRequest[];
};

const SETTLED = new Set(["COMPLETED", "FAILED", "CANCELLED", "AWAITING_APPROVAL"]);

export async function runQ(
  email: string,
  text: string,
  rules: readonly ScriptRule[] = [],
  conversationId?: string,
): Promise<RunResult> {
  await useScript(rules);
  const mark = await vendorMark();
  const created = await callWithKey(email, {
    capability: "ANSWER",
    message: { text },
    modality: "TEXT",
    ...(conversationId === undefined ? {} : { conversationId }),
  });
  const runId = String((created as { runId?: unknown }).runId);
  const conversation = String((created as { conversationId?: unknown }).conversationId);
  let run: Record<string, unknown> = {};
  for (let i = 0; i < 120; i += 1) {
    const reply = await call(email, "q-api", "GET", `/v1/q/runs/${runId}`);
    run = (reply.body ?? {}) as Record<string, unknown>;
    if (SETTLED.has(String(run["status"]))) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    runId,
    conversationId: conversation,
    status: String(run["status"]),
    run,
    vendor: await vendorRequestsSince(mark),
  };
}

async function callWithKey(email: string, body: unknown): Promise<unknown> {
  // POST /v1/q/runs requires an Idempotency-Key (apps/q-api/src/http/q-runs.ts:90).
  const response = await fetch(`${Q_API_URL}/v1/q/runs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await tokenFor(email)}`,
      "content-type": "application/json",
      "idempotency-key": `recovery-g-${randomUUID()}`,
    },
    body: JSON.stringify(body),
  });
  if (response.status !== 202 && response.status !== 200) {
    throw new Error(`run refused ${String(response.status)}: ${(await response.text()).slice(0, 200)}`);
  }
  return response.json();
}

/**
 * A pending approval owned by `email`: Q proposes a reminder (a real
 * propose_* tool through the real Approval Engine). The answer text is
 * neutral on purpose; see defect G-D3 for what happens when it is not.
 */
export async function pendingReminderApproval(
  email: string,
  title = `Call the investor ${randomUUID().slice(0, 6)}`,
): Promise<{ approvalId: string; runId: string; title: string }> {
  const remindAt = new Date(Date.now() + 86_400_000).toISOString();
  const result = await runQ(email, `Please remind me tomorrow: ${title}`, [
    {
      name: "propose-reminder",
      when: { task: "COMPANY_ANALYST", user: "remind me tomorrow", tool: "propose_reminder", afterTool: null },
      reply: { toolCalls: [{ name: "propose_reminder", arguments: { title, remindAt } }] },
    },
    {
      name: "after-reminder",
      when: { task: "COMPANY_ANALYST", afterTool: "propose_reminder" },
      reply: answer("Tomorrow works. The details are on the card below."),
    },
  ]);
  const listed = await call(email, "q-api", "GET", "/v1/q/approvals");
  const items = ((listed.body as { items?: unknown[] } | null)?.items ?? []) as Array<{
    approvalId: string;
    runId: string;
    summary: string;
  }>;
  const mine = items.find((item) => item.runId === result.runId);
  if (mine === undefined) {
    throw new Error(`no approval was created (run ${result.status})`);
  }
  return { approvalId: mine.approvalId, runId: result.runId, title };
}
