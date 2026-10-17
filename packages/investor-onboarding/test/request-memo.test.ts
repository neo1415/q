import { describe, expect, it } from "vitest";

import {
  ActorContextSchema,
  AuthUserIdSchema,
  OrganisationIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import type { InvestorDomainServices } from "../src/integration/services.js";
import {
  mandateInScope,
  resolveInvestorContext,
} from "../src/integration/write-targets.js";

/**
 * Live AJ 2026-10-16: an investor's first answers took 1.4-4.7 s in one
 * batch, each answer resolving the same context and listing the same
 * mandates again. Within one request (the runtime's memo) they are read
 * once; without it, as before. Nothing is kept across requests.
 */

const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("e0000000-0000-4000-8000-000000000001");
const CONTEXT = ActorContextSchema.parse({
  userId: USER,
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: ORG,
  membershipId: "d0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const actor = {
  userId: USER,
  context: null,
  principal: {
    authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
  },
};

function services() {
  const counts = { resolved: 0, listed: 0 };
  const fake = {
    resolver: {
      resolveHumanContext: () => {
        counts.resolved += 1;
        return Promise.resolve({ status: "RESOLVED", context: CONTEXT });
      },
    },
    investors: {
      listInvestorMandates: () => {
        counts.listed += 1;
        return Promise.resolve({
          items: [
            { id: "f0000000-0000-4000-8000-000000000001", status: "DRAFT" },
          ],
        });
      },
    },
  } as unknown as InvestorDomainServices;
  return { fake, counts };
}

describe("one request reads its investor context and mandate once", () => {
  it("resolves the context once per request memo", async () => {
    const { fake, counts } = services();
    const memo = new Map<string, unknown>();
    const a = await resolveInvestorContext(fake, actor, ORG, memo);
    const b = await resolveInvestorContext(fake, actor, ORG, memo);
    expect(a).toEqual(b);
    expect(counts.resolved).toBe(1);
    // Another request (another memo) resolves again.
    await resolveInvestorContext(fake, actor, ORG, new Map());
    expect(counts.resolved).toBe(2);
    // No memo: every call resolves, as before.
    await resolveInvestorContext(fake, actor, ORG);
    expect(counts.resolved).toBe(3);
  });

  it("lists the open mandate once per request memo", async () => {
    const { fake, counts } = services();
    const bound = {
      context: CONTEXT,
      investorOrganisationId: "e1000000-0000-4000-8000-000000000001",
    };
    const create = {
      session: { id: "s" },
      correlationId: "cor_x",
      requestMemo: new Map<string, unknown>(),
    };
    const first = await mandateInScope(
      fake,
      bound as never,
      new Map() as never,
      create as never,
    );
    const second = await mandateInScope(
      fake,
      bound as never,
      new Map() as never,
      create as never,
    );
    expect(second).toBe(first);
    expect(counts.listed).toBe(1);
  });
});
