import { describe, expect, it } from "vitest";

import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

import { createToolDelegationPort } from "../src/delegation.js";

/** The delegation port passes only the grant's knobs; the goal is theirs. */
describe("the delegation port", () => {
  const request = {
    actor: { userId: "u", tenantId: "t", actorType: "HUMAN" },
    runId: "r",
    correlationId: "cor_r",
    capability: "ANSWER",
    plan: {},
  } as unknown as QAnswerRequest;

  it("takes known knobs, keeps their goal, and falls back to the plain card when extras fail", async () => {
    const calls: Record<string, unknown>[] = [];
    const tools = {
      execute: (proposal: { arguments: Record<string, unknown> }) => {
        calls.push(proposal.arguments);
        const ok = proposal.arguments["digest"] !== "HOURLY";
        return Promise.resolve({
          result: ok
            ? {
                ok: true,
                data: {
                  status: "PREPARED",
                  awaitingApprovalOf: "Q works on this",
                },
              }
            : { ok: false, error: { code: "INVALID_ARGUMENTS", message: "" } },
        });
      },
    } as unknown as QToolPort;
    const port = createToolDelegationPort({ tools });
    expect(
      await port.propose(request, {
        goal: "their words",
        includeNewCompanies: false,
        more: { askFirst: true, goal: "not theirs", ownerUserId: "x" },
      }),
    ).toEqual({ status: "PREPARED", awaitingApprovalOf: "Q works on this" });
    expect(calls[0]).toEqual({
      askFirst: true,
      goal: "their words",
      includeNewCompanies: false,
    });
    calls.length = 0;
    await port.propose(request, {
      goal: "g",
      includeNewCompanies: true,
      more: { digest: "HOURLY" },
    });
    expect(calls).toEqual([
      { digest: "HOURLY", goal: "g", includeNewCompanies: true },
      { goal: "g", includeNewCompanies: true },
    ]);
  });
});
