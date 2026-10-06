import { describe, expect, it } from "vitest";

import type { CorrelationId } from "@capital-q/contracts";
import { CreateVisibilityShareRequestSchema } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  createVisibilityCentre,
  type VisibilityCentrePorts,
} from "../src/index.js";

/**
 * P14 (ADR 0060): a founder may show their raise to every investor on the
 * network. It is an explicit network_visible disclosure policy on the
 * capital objective (no recipient), granted through the policy manager and
 * revoked like any share; the objective's own scope stays founder_private.
 */

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const ORG = "00000000-0000-4000-8000-0000000000a2";
const COMPANY = "00000000-0000-4000-8000-0000000000c1";
const OBJECTIVE = "00000000-0000-4000-8000-0000000000d1";
const POLICY = "00000000-0000-4000-8000-0000000000e1";
const actor = {
  userId: "00000000-0000-4000-8000-0000000000b1",
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "00000000-0000-4000-8000-0000000000b2",
  actorType: "HUMAN",
} as ActorContext;
const correlationId =
  "cor_00000000-0000-4000-8000-00000000c0de" as CorrelationId;

function world(policies: unknown[] = []) {
  const grants: unknown[] = [];
  const ports = {
    companies: {
      findCanonicalCompanyProfile: () =>
        Promise.resolve({
          id: COMPANY,
          tenantId: TENANT,
          organisationId: ORG,
          marketplaceVisibility: "network_visible",
        }),
    },
    capital: {
      getCurrentForCompany: () =>
        Promise.resolve({
          id: OBJECTIVE,
          target: { amount: "1800000", currency: "USD" },
          targetStage: "seed",
          instrumentCode: "safe",
          targetCloseDate: null,
        }),
    },
    authorization: {
      authorize: () => Promise.resolve({ outcome: "ALLOW" }),
    },
    inspect: () => Promise.resolve({ policies }),
    relationshipsOf: () => Promise.resolve([]),
    policies: {
      grant: (command: unknown) => {
        grants.push(command);
        return Promise.resolve({
          outcome: "CREATED",
          policy: {
            id: POLICY,
            accessLevel: "view",
            createdAt: "2026-10-06T10:00:00.000Z",
            expiresAt: null,
          },
        });
      },
    },
  } as unknown as VisibilityCentrePorts;
  return { centre: createVisibilityCentre(ports), grants };
}

describe("the raise shown to the network (ADR 0060)", () => {
  it("is one network_visible policy with no recipient, through the policy manager", async () => {
    const { centre, grants } = world();
    const out = await centre.share({
      actor,
      companyId: COMPANY,
      object: "CAPITAL_OBJECTIVE",
      audience: "NETWORK",
      correlationId,
    });
    expect(out.outcome).toBe("CREATED");
    expect(out.share?.relationshipId).toBeNull();
    expect(grants).toEqual([
      expect.objectContaining({
        resource: { type: "capital_objective", id: OBJECTIVE },
        scopeType: "network_visible",
        accessLevel: "view",
      }),
    ]);
    expect(grants[0]).not.toHaveProperty("recipient");
  });

  it("state reports it while active; the objective's own scope stays founder_private", async () => {
    const active = world([
      {
        id: POLICY,
        status: "ACTIVE",
        recipient: null,
        scopeType: "network_visible",
        accessLevel: "view",
        createdAt: "2026-10-06T10:00:00.000Z",
        expiresAt: null,
      },
    ]);
    const state = await active.centre.state({ actor, companyId: COMPANY });
    expect(state.networkRaiseShare).toEqual({
      policyId: POLICY,
      createdAt: "2026-10-06T10:00:00.000Z",
    });
    expect(
      state.objects.find((o) => o.object === "CAPITAL_OBJECTIVE")?.scope,
    ).toBe("founder_private");
    const revoked = world([
      {
        id: POLICY,
        status: "REVOKED",
        recipient: null,
        scopeType: "network_visible",
        accessLevel: "view",
        createdAt: "2026-10-06T10:00:00.000Z",
        expiresAt: null,
      },
    ]);
    expect(
      (await revoked.centre.state({ actor, companyId: COMPANY }))
        .networkRaiseShare,
    ).toBeNull();
  });

  it("the request names a relationship or the network, never both or neither", () => {
    const ok = (body: unknown) =>
      CreateVisibilityShareRequestSchema.safeParse(body).success;
    expect(ok({ object: "CAPITAL_OBJECTIVE", audience: "NETWORK" })).toBe(true);
    expect(
      ok({
        object: "CAPITAL_OBJECTIVE",
        relationshipId: "00000000-0000-4000-8000-0000000000f1",
      }),
    ).toBe(true);
    expect(ok({ object: "CAPITAL_OBJECTIVE" })).toBe(false);
    expect(
      ok({
        object: "CAPITAL_OBJECTIVE",
        audience: "NETWORK",
        relationshipId: "00000000-0000-4000-8000-0000000000f1",
      }),
    ).toBe(false);
  });
});
