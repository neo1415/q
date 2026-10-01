import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  allow,
  createDefaultQTools,
  createGetMyPlanTool,
  defineQTool,
  gateQTool,
  Q_TOOL_GATES,
  type AnyQToolDefinition,
  type QEntitlementPort,
  type QToolPorts,
} from "../src/index.js";
import { actorA, contextFor, planFor } from "./support.js";

/**
 * BILLING (ADR 0034): the plan gate on Q's tools. A tool the plan does not
 * cover now is DENIED with ENTITLEMENT_REQUIRED and the plan's own plain
 * sentence, before any work; a metered tool takes its unit at authorize
 * and gives it back when the work fails.
 */

const MESSAGE =
  "Your Free plan includes 20 research requests a month and you've used 20. It resets on 1 November. You can see what each plan includes in Settings → Plan.";

function port(allowed: boolean) {
  const calls: string[] = [];
  const entitlements: QEntitlementPort = {
    check: (_actor, feature) => {
      calls.push(`check:${feature}`);
      return Promise.resolve(
        allowed ? { allowed: true } : { allowed: false, message: MESSAGE },
      );
    },
    consume: (_actor, feature, key) => {
      calls.push(`consume:${feature}:${key.split(":")[0] ?? ""}`);
      return Promise.resolve(
        allowed ? { allowed: true } : { allowed: false, message: MESSAGE },
      );
    },
    release: (_actor, feature) => {
      calls.push(`release:${feature}`);
      return Promise.resolve();
    },
    summary: () =>
      Promise.resolve({
        planName: "Free",
        source: "ADMIN",
        endsAt: null,
        features: [
          {
            key: "q.rehearsals",
            name: "Rehearsals",
            included: true,
            limit: 1,
            used: 1,
            unitSingular: "rehearsal",
            unitPlural: "rehearsals",
            resetsAt: "2026-11-01T00:00:00.000Z",
          },
          {
            key: "gateq.gateways",
            name: "GateQ gateways",
            included: true,
            limit: 1,
            used: 0,
            unitSingular: "gateway",
            unitPlural: "gateways",
            resetsAt: null,
          },
          {
            key: "q.daily_editions",
            name: "The Q Daily",
            included: false,
            limit: null,
            used: 0,
            unitSingular: "edition",
            unitPlural: "editions",
            resetsAt: null,
          },
        ],
      }),
  };
  return { entitlements, calls };
}

function fakeTool(options: { readonly fails?: boolean } = {}) {
  let ran = 0;
  const tool = defineQTool<{ q: string }, { ok: true }, null>({
    id: "public_web.search",
    version: 1,
    status: "ACTIVE",
    providerName: "fake_research",
    description: "fake",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: ["GENERAL_QUESTION"],
    requiredScopeKinds: [],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "test",
    visibleStage: null,
    input: z.object({ q: z.string() }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
    authorize: () => Promise.resolve(allow<null>("PUBLIC", null)),
    execute: () => {
      ran += 1;
      return options.fails === true
        ? Promise.reject(new Error("provider down"))
        : Promise.resolve({ ok: true as const });
    },
  });
  return { tool, ran: () => ran };
}

const context = contextFor(actorA, planFor(actorA, "GENERAL_QUESTION", []));

describe("the plan gate on Q's tools", () => {
  it("denies a proposal tool with ENTITLEMENT_REQUIRED and the plan's own sentence", async () => {
    const { entitlements, calls } = port(false);
    const gated = gateQTool(
      fakeTool().tool,
      { feature: "q.delegations", mode: "CHECK" },
      entitlements,
    );
    const verdict = await gated.authorize({ q: "x" }, context);
    expect(verdict).toEqual({
      outcome: "DENY",
      code: "ENTITLEMENT_REQUIRED",
      safeMessage: MESSAGE,
    });
    expect(calls).toEqual(["check:q.delegations"]);
  });

  it("a metered tool takes its unit before the work and gives it back when the work fails", async () => {
    const { entitlements, calls } = port(true);
    const failing = fakeTool({ fails: true });
    const gated: AnyQToolDefinition = gateQTool(
      failing.tool,
      { feature: "q.research", mode: "CONSUME" },
      entitlements,
    );
    const verdict = await gated.authorize({ q: "x" }, context);
    expect(verdict.outcome).toBe("ALLOW");
    await expect(gated.execute({ q: "x" }, context, null)).rejects.toThrow(
      "provider down",
    );
    expect(calls).toEqual([
      "consume:q.research:public_web.search",
      "release:q.research",
    ]);
  });

  it("a metered tool past its limit never runs", async () => {
    const { entitlements } = port(false);
    const tool = fakeTool();
    const gated = gateQTool(
      tool.tool,
      { feature: "q.research", mode: "CONSUME" },
      entitlements,
    );
    expect((await gated.authorize({ q: "x" }, context)).outcome).toBe("DENY");
    expect(tool.ran()).toBe(0);
  });

  it("gates exactly the proposal and research tools that exist in the catalogue, and adds the plan tool", () => {
    const STUB = {} as never;
    const { entitlements } = port(true);
    const ports: QToolPorts = {
      companies: STUB,
      capital: STUB,
      mandates: STUB,
      investors: STUB,
      authorization: STUB,
      disclosure: STUB,
      research: STUB,
      relationships: STUB,
      chat: STUB,
      work: STUB,
      entitlements,
    };
    const ids = new Set(createDefaultQTools(ports).map((tool) => tool.id));
    for (const id of Object.keys(Q_TOOL_GATES))
      expect(ids.has(id), id).toBe(true);
    expect(ids.has("plan.get_mine")).toBe(true);
    const withoutPlans = createDefaultQTools({
      ...ports,
      entitlements: undefined,
    }).map((tool) => tool.id);
    expect(withoutPlans).not.toContain("plan.get_mine");
  });
});

describe("get_my_plan", () => {
  it("says the plan in plain allowances, and the plan page", async () => {
    const { entitlements } = port(true);
    const tool = createGetMyPlanTool(entitlements);
    const output = await tool.execute({}, context, null);
    expect(output).toEqual({
      planName: "Free",
      source: "ADMIN",
      endsAt: null,
      features: [
        {
          name: "Rehearsals",
          included: true,
          allowance: "1 rehearsal a month, 1 used",
          resetsAt: "2026-11-01T00:00:00.000Z",
        },
        {
          name: "GateQ gateways",
          included: true,
          allowance: "1 gateway, 0 used",
          resetsAt: null,
        },
        {
          name: "The Q Daily",
          included: false,
          allowance: "Not included",
          resetsAt: null,
        },
      ],
      planPage: "/settings/plan",
    });
  });

  it("is only the person's own, in their own conversation", async () => {
    const { entitlements } = port(true);
    const tool = createGetMyPlanTool(entitlements);
    expect((await tool.authorize({}, context)).outcome).toBe("DENY");
  });
});
