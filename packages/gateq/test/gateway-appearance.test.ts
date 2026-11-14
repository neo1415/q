import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createGatewayAdminService,
  gatewayAdminActionsPort,
  type GatewayAppearance,
} from "../src/application/appearance.js";
import { GatewayNotFoundError } from "../src/application/use-cases.js";
import {
  GatewaySchema,
  GatewayPublicIdSchema,
  type Gateway,
} from "../src/contracts/index.js";

/**
 * B6 / B7: an investor organisation's admins brand, place and pause their
 * own gateway. Authority is read off the gateway row: another tenant's
 * gateway is "not found", an ordinary member may read and not change, and
 * every change is a new revision with an audit line before and after.
 */

const TENANT_A = "c0000000-0000-4000-8000-00000000000a";
const TENANT_B = "c0000000-0000-4000-8000-00000000000b";
const ORG_A = "d0000000-0000-4000-8000-00000000000a";
const ORG_B = "d0000000-0000-4000-8000-00000000000b";
const INVESTOR_A = "11111111-0000-4000-8000-00000000000a";

const actorOf = (
  tenantId: string,
  organisationId: string,
  userId: string,
): ActorContext =>
  ActorContextSchema.parse({
    userId,
    tenantId,
    organisationId,
    membershipId: randomUUID(),
    actorType: "HUMAN",
  });

const ADMIN_A = actorOf(TENANT_A, ORG_A, "b0000000-0000-4000-8000-00000000000a");
const MEMBER_A = actorOf(
  TENANT_A,
  ORG_A,
  "b0000000-0000-4000-8000-00000000000c",
);
const ADMIN_B = actorOf(TENANT_B, ORG_B, "b0000000-0000-4000-8000-00000000000b");

class Denied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationDeniedError";
  }
}

function world() {
  const gateway: Gateway = GatewaySchema.parse({
    id: randomUUID(),
    tenantId: TENANT_A,
    investorOrganisationId: INVESTOR_A,
    organisationId: ORG_A,
    publicId: GatewayPublicIdSchema.parse("gq_0123456789abcdefghjkmnpqrs"),
    name: "Kilima Angels",
    status: "ACTIVE",
    createdByUserId: ADMIN_A.userId,
    createdAt: "2026-11-14T00:00:00.000Z",
    updatedAt: "2026-11-14T00:00:00.000Z",
  });
  const rows = new Map<string, Gateway>([[gateway.id, gateway]]);
  const revisions: GatewayAppearance[] = [];
  const audited: { actionType: string; metadata: unknown }[] = [];
  const admins = new Map([
    [ADMIN_A.userId, ORG_A],
    [ADMIN_B.userId, ORG_B],
  ]);
  const members = new Map([[MEMBER_A.userId, ORG_A]]);

  const admin = createGatewayAdminService({
    gateways: {
      create: () => Promise.reject(new Error("unused")),
      findById: (id) => Promise.resolve(rows.get(id) ?? null),
      findByPublicId: (publicId) =>
        Promise.resolve(
          [...rows.values()].find((row) => row.publicId === publicId) ?? null,
        ),
      listForInvestorOrganisation: () => Promise.resolve([...rows.values()]),
      setStatus: (_tx, id, status) => {
        const row = rows.get(id);
        if (row === undefined) throw new Error("no such gateway");
        const next = { ...row, status };
        rows.set(id, next);
        return Promise.resolve(next);
      },
    },
    appearances: {
      current: (gatewayId) =>
        Promise.resolve(
          revisions.filter((r) => r.gatewayId === gatewayId).at(-1) ?? null,
        ),
      append: (_tx, input) => {
        const next: GatewayAppearance = {
          gatewayId: input.gatewayId,
          revision:
            revisions.filter((r) => r.gatewayId === input.gatewayId).length + 1,
          accentHex: input.accentHex,
          embedOrigins: [...input.embedOrigins],
          updatedAt: "2026-11-14T12:00:00.000Z",
        };
        revisions.push(next);
        return Promise.resolve(next);
      },
    },
    authorization: {
      requireCapability: (input) => {
        const { actor, resource } = input;
        if (actor.tenantId !== resource.tenantId) {
          throw new Denied("another tenant");
        }
        const owner =
          resource.kind === "TENANT" ? undefined : resource.organisationId;
        if (admins.get(actor.userId) === owner) return Promise.resolve();
        if (
          members.get(actor.userId) === owner &&
          input.capability === "investor.gateway.view"
        ) {
          return Promise.resolve();
        }
        throw new Denied(String(input.capability));
      },
    },
    transactions: {
      run: <T>(work: (tx: never) => Promise<T>) => work({ sql: null } as never),
    } as never,
    audit: {
      record: (_tx, input) => {
        audited.push({
          actionType: input.actionType,
          metadata: input.metadata,
        });
        return Promise.resolve(randomUUID() as never);
      },
    },
  });
  return { admin, gateway, rows, revisions, audited };
}

describe("an investor's own gateway appearance (B6/B7)", () => {
  it("an admin of the owning organisation sets the accent and embed sites, as a new revision, audited", async () => {
    const w = world();
    const first = await w.admin.setAppearance({
      actor: ADMIN_A,
      gatewayId: w.gateway.id,
      accentHex: "#0f766e",
      embedOrigins: ["https://kilima.example"],
    });
    const second = await w.admin.setAppearance({
      actor: ADMIN_A,
      gatewayId: w.gateway.id,
      accentHex: "#b45309",
      embedOrigins: [],
    });
    expect([first.revision, second.revision]).toEqual([1, 2]);
    // History is kept: the first revision is still there.
    expect(w.revisions.map((r) => r.accentHex)).toEqual(["#0f766e", "#b45309"]);
    expect(w.audited.at(-1)).toEqual({
      actionType: "gateq.gateway.appearance_set",
      metadata: {
        revision: 2,
        accentBefore: "#0f766e",
        accentAfter: "#b45309",
        embedOriginsBefore: "https://kilima.example",
        embedOriginsAfter: "any",
      },
    });
    const read = await w.admin.appearance({
      actor: MEMBER_A,
      gatewayId: w.gateway.id,
    });
    expect(read).toMatchObject({ accentHex: "#b45309", canChange: false });
  });

  it("an ordinary member may read but not change it", async () => {
    const w = world();
    await expect(
      w.admin.setAppearance({
        actor: MEMBER_A,
        gatewayId: w.gateway.id,
        accentHex: "#0f766e",
        embedOrigins: [],
      }),
    ).rejects.toThrow(Denied);
    await expect(
      w.admin.setStatus({
        actor: MEMBER_A,
        gatewayId: w.gateway.id,
        status: "DISABLED",
      }),
    ).rejects.toThrow(Denied);
    expect(w.revisions).toHaveLength(0);
    expect(w.rows.get(w.gateway.id)?.status).toBe("ACTIVE");
  });

  it("another tenant's admin is told the gateway does not exist", async () => {
    const w = world();
    await expect(
      w.admin.setAppearance({
        actor: ADMIN_B,
        gatewayId: w.gateway.id,
        accentHex: "#0f766e",
        embedOrigins: [],
      }),
    ).rejects.toThrow(GatewayNotFoundError);
    await expect(
      w.admin.appearance({ actor: ADMIN_B, gatewayId: w.gateway.id }),
    ).rejects.toThrow(GatewayNotFoundError);
    expect(w.audited).toHaveLength(0);
  });

  it("refuses anything but a lowercase colour and plain https origins", async () => {
    const w = world();
    for (const bad of [
      { accentHex: "red", embedOrigins: [] },
      { accentHex: "#FFF000", embedOrigins: [] },
      { accentHex: null, embedOrigins: ["http://kilima.example"] },
      { accentHex: null, embedOrigins: ["https://kilima.example/apply"] },
      { accentHex: null, embedOrigins: ["https://a.example 'unsafe-inline'"] },
      {
        accentHex: null,
        embedOrigins: ["https://a.example", "https://a.example"],
      },
    ]) {
      await expect(
        w.admin.setAppearance({
          actor: ADMIN_A,
          gatewayId: w.gateway.id,
          ...bad,
        }),
      ).rejects.toThrow();
    }
    expect(w.revisions).toHaveLength(0);
  });

  it("pausing closes the public appearance; reopening restores it", async () => {
    const w = world();
    await w.admin.setAppearance({
      actor: ADMIN_A,
      gatewayId: w.gateway.id,
      accentHex: "#0f766e",
      embedOrigins: [],
    });
    expect(
      (await w.admin.publicAppearance(w.gateway.publicId))?.accentHex,
    ).toBe("#0f766e");
    const paused = await w.admin.setStatus({
      actor: ADMIN_A,
      gatewayId: w.gateway.id,
      status: "DISABLED",
    });
    expect(paused.status).toBe("DISABLED");
    expect(await w.admin.publicAppearance(w.gateway.publicId)).toBeNull();
    await w.admin.setStatus({
      actor: ADMIN_A,
      gatewayId: w.gateway.id,
      status: "ACTIVE",
    });
    expect(
      (await w.admin.publicAppearance(w.gateway.publicId))?.accentHex,
    ).toBe("#0f766e");
    expect(w.audited.map((a) => a.actionType)).toEqual([
      "gateq.gateway.appearance_set",
      "gateq.gateway.paused",
      "gateq.gateway.reopened",
    ]);
  });

  it("the actions port answers one refusal for another tenant or a non-admin, and finds a paused gateway for Q", async () => {
    const w = world();
    const port = gatewayAdminActionsPort({
      admin: w.admin,
      listGateways: () => Promise.resolve([...w.rows.values()]),
      ownInvestorOrganisationId: () => Promise.resolve(INVESTOR_A),
    });
    const input = { accentHex: "#0f766e", embedOrigins: [] };
    expect(await port.setAppearance(ADMIN_B, w.gateway.id, input)).toEqual({
      ok: false,
    });
    expect(await port.setAppearance(MEMBER_A, w.gateway.id, input)).toEqual({
      ok: false,
    });
    expect(await port.setAppearance(ADMIN_A, "not-a-uuid", input)).toEqual({
      ok: false,
    });
    expect((await port.setStatus(ADMIN_A, w.gateway.id, "DISABLED")).ok).toBe(
      true,
    );
    expect(await port.ownGateway(ADMIN_A)).toEqual({
      id: w.gateway.id,
      status: "DISABLED",
    });
  });
});
