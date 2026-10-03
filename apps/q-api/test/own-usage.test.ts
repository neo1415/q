import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { QUsageDtoSchema } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import { createOwnUsage } from "../src/composition/usage.js";

/** Lead 2026-10-03: the person's own usage this month. No database, no provider. */

const actor = ActorContextSchema.parse({
  userId: randomUUID(),
  tenantId: randomUUID(),
  actorType: "HUMAN",
});
const mine = randomUUID();
const notMine = randomUUID();

describe("the person's own usage", () => {
  it("reads only their user and tenant, names only their instructions, and keeps Q's plan limits", async () => {
    const asked: unknown[] = [];
    const usage = createOwnUsage({
      ownMonth: (who, at) => {
        asked.push({ who, at: at.toISOString() });
        return Promise.resolve({
          totalUsd: "0.173000",
          calls: 5,
          unpricedCalls: 1,
          failedCalls: 2,
          byPurpose: [
            { purpose: "REHEARSAL", usd: "0.120000", calls: 2 },
            { purpose: "INSTRUCTION", usd: "0.053000", calls: 3 },
          ],
          byInstruction: [
            { instructionId: mine, usd: "0.050000", calls: 2 },
            { instructionId: notMine, usd: "0.003000", calls: 1 },
          ],
        });
      },
      instructions: () =>
        Promise.resolve([
          {
            id: mine,
            goal: "Handle all the work for me",
            budgetUsdMonth: "5.00",
          },
        ]),
      plan: () =>
        Promise.resolve({
          name: "Launch",
          features: [
            {
              key: "q.delegations",
              name: "Q's delegated work",
              description: "",
              kind: "MONTHLY",
              unitSingular: "job",
              unitPlural: "jobs",
              included: true,
              limit: 10,
              used: 2,
              resetsAt: null,
              overridden: false,
            },
            {
              key: "gateq.gateways",
              name: "Gateways",
              description: "",
              kind: "COUNT",
              unitSingular: "gateway",
              unitPlural: "gateways",
              included: true,
              limit: 1,
              used: 0,
              resetsAt: null,
              overridden: false,
            },
          ],
        }),
      now: () => new Date("2026-10-20T09:00:00Z"),
    });
    const dto = QUsageDtoSchema.parse(await usage(actor));
    expect(asked).toEqual([
      {
        who: { userId: actor.userId, tenantId: actor.tenantId },
        at: "2026-10-20T09:00:00.000Z",
      },
    ]);
    expect(dto.month).toBe("2026-10");
    expect([dto.unpricedCalls, dto.failedCalls]).toEqual([1, 2]);
    expect(dto.instructions).toEqual([
      {
        instructionId: mine,
        goal: "Handle all the work for me",
        usd: "0.050000",
        budgetUsdMonth: "5.00",
      },
    ]);
    expect(dto.plan?.features.map((f) => f.key)).toEqual(["q.delegations"]);
  });

  it("a plan that cannot be read leaves the usage", async () => {
    const usage = createOwnUsage({
      ownMonth: () =>
        Promise.resolve({
          totalUsd: "0",
          calls: 0,
          unpricedCalls: 0,
          failedCalls: 0,
          byPurpose: [],
          byInstruction: [],
        }),
      instructions: () => Promise.reject(new Error("down")),
      plan: () => Promise.reject(new Error("down")),
    });
    const dto = await usage(actor);
    expect(dto.plan).toBeNull();
    expect(dto.instructions).toEqual([]);
  });
});
