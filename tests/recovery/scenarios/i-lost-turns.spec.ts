import { expect, test } from "@playwright/test";

import { awaits } from "../support/expected-red.js";
import { runQ } from "../support/flows.js";
import { call } from "../support/http.js";
import { answer } from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * Lost turns (lead priority 1): a request the person made must not vanish
 * because of how the model phrased its reply. Server state is the proof:
 * the run's status and the approval that should exist.
 */
for (const phrasing of [
  "I've prepared that reminder for you to approve.",
  "Done. I've set the reminder; approve it on the card.",
  "Tomorrow works. The details are on the card below.",
]) {
  test(`a proposal survives the reply "${phrasing}"`, async () => {
    if (!phrasing.startsWith("Tomorrow")) {
      awaits(
        ["B7"],
        "defect G-D3: action talk is stripped to nothing and the turn fails, losing the proposal",
      );
    }
    const title = `Lost-turn check ${String(Date.now()).slice(-6)}`;
    const result = await runQ(
      CAST.founder,
      `Please remind me tomorrow: ${title}`,
      [
        {
          name: "propose",
          when: {
            task: "COMPANY_ANALYST",
            user: "remind me tomorrow",
            tool: "propose_reminder",
            afterTool: null,
          },
          reply: {
            toolCalls: [
              {
                name: "propose_reminder",
                arguments: {
                  title,
                  remindAt: new Date(Date.now() + 86_400_000).toISOString(),
                },
              },
            ],
          },
        },
        {
          name: "phrasing",
          when: { task: "COMPANY_ANALYST", afterTool: "propose_reminder" },
          reply: answer(phrasing),
        },
      ],
    );
    expect(result.status, JSON.stringify(result.run["failure"] ?? null)).toBe(
      "AWAITING_APPROVAL",
    );
    const approvals = await call(
      CAST.founder,
      "q-api",
      "GET",
      "/v1/q/approvals",
    );
    expect(approvals.text, "the approval exists").toContain(title);
  });
}
