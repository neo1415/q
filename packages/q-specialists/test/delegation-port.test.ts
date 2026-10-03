import { describe, expect, it } from "vitest";

import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

import { createToolDelegationPort, delegationLine } from "../src/delegation.js";

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

  it("their working hours ('weekends too, 8am to 10pm') reach the tool as read", async () => {
    const calls: Record<string, unknown>[] = [];
    const tools = {
      execute: (proposal: { arguments: Record<string, unknown> }) => {
        calls.push(proposal.arguments);
        return Promise.resolve({
          result: {
            ok: true,
            data: { status: "PREPARED", awaitingApprovalOf: "Q works on this" },
          },
        });
      },
    } as unknown as QToolPort;
    const hours = { days: [1, 2, 3, 4, 5, 6, 7], start: "08:00", end: "22:00" };
    await createToolDelegationPort({ tools }).propose(request, {
      goal: "monitor new founders, including weekends",
      includeNewCompanies: true,
      more: { workingHours: hours },
    });
    expect(calls[0]?.["workingHours"]).toEqual(hours);
  });
});

describe("the delegation reply's wording (lead 2026-10-03)", () => {
  const prepared = { status: "PREPARED", awaitingApprovalOf: "x" };
  it("no 'Meanwhile' when nothing came before it", () => {
    const line = delegationLine(
      { side: "COMPANY", relationships: 3, outstanding: [] },
      prepared,
    );
    expect(line.startsWith("As a standing instruction")).toBe(true);
    expect(line).not.toContain("Meanwhile");
  });
  it("'Meanwhile' after what was said first", () => {
    const line = delegationLine(
      { side: "COMPANY", relationships: 0, outstanding: [] },
      prepared,
    );
    expect(line).toContain(" Meanwhile, as a standing instruction");
  });
});

describe("the card line is drawn from the grant (lead 2026-10-03)", () => {
  it("with every step asked first, never 'what I'd do on my own'", () => {
    for (const side of ["INVESTOR", "COMPANY"] as const) {
      const line = delegationLine(
        { side, relationships: 3, outstanding: [] },
        { status: "PREPARED", awaitingApprovalOf: "x", onItsOwn: 0 },
      );
      expect(line).not.toContain("on my own");
      expect(line).toContain("what I'd prepare for your yes");
    }
    expect(
      delegationLine(
        { side: "INVESTOR", relationships: 3, outstanding: [] },
        { status: "PREPARED", awaitingApprovalOf: "x", onItsOwn: 3 },
      ),
    ).toContain("exactly what I'd do on my own");
  });
});
