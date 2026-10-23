import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import { createVisibleRaises } from "../src/infrastructure/visible-raises.js";

/**
 * Owner 23 Oct 2026: a company's round reaches an investor's cheque fit
 * only where the company shares it with that investor: on its Q Card, or
 * by disclosing the capital objective to the investor organisation.
 */

const investor = {
  userId: "u1",
  tenantId: "t-investor",
  organisationId: "o-investor",
} as ActorContext;

const raise = (n: number, publishedOnCard?: boolean) => ({
  objectiveId: `objective-${String(n)}`,
  companyId: `company-${String(n)}`,
  amount: "1500000",
  currency: "USD",
  ...(publishedOnCard === undefined ? {} : { publishedOnCard }),
});

describe("the round an investor may see", () => {
  it("published on the card, or disclosed to the organisation; never a private raise", async () => {
    const asked: string[] = [];
    const visible = createVisibleRaises({
      currentRaises: () =>
        Promise.resolve([raise(1, true), raise(2), raise(3, false)]),
      disclosure: {
        evaluateMany: (requests) => {
          for (const r of requests) asked.push(r.resource.id);
          // Objective 2 is disclosed to them; 3 is founder_private.
          return Promise.resolve(
            requests.map((r) => ({
              outcome: r.resource.id === "objective-2" ? "ALLOW" : "DENY",
            })) as never,
          );
        },
      },
    });
    const out = await visible(investor, [
      "company-1",
      "company-2",
      "company-3",
    ]);
    expect([...out.keys()].sort()).toEqual(["company-1", "company-2"]);
    expect(out.get("company-1")).toEqual({
      amount: "1500000",
      currency: "USD",
    });
    // A raise published on the card needs no disclosure question.
    expect(asked).toEqual(["objective-2", "objective-3"]);
  });

  it("an actor with no organisation, or a failed read, sees nothing", async () => {
    const visible = createVisibleRaises({
      currentRaises: () => Promise.reject(new Error("down")),
      disclosure: { evaluateMany: () => Promise.reject(new Error("down")) },
    });
    expect((await visible(investor, ["company-1"])).size).toBe(0);
    const noOrganisation = createVisibleRaises({
      currentRaises: () => Promise.resolve([raise(1, true)]),
      disclosure: { evaluateMany: () => Promise.resolve([]) },
    });
    expect(
      (
        await noOrganisation({ ...investor, organisationId: undefined }, [
          "company-1",
        ])
      ).size,
    ).toBe(0);
    const deniedOnError = createVisibleRaises({
      currentRaises: () => Promise.resolve([raise(2)]),
      disclosure: { evaluateMany: () => Promise.reject(new Error("down")) },
    });
    expect((await deniedOnError(investor, ["company-2"])).size).toBe(0);
  });
});
