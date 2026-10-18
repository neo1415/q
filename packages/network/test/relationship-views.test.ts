import { describe, expect, it, vi } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import { createRelationshipViewService } from "../src/application/relationship-views.js";
import {
  InterestNotFoundError,
  InterestNotPermittedError,
  RelationshipViewLimitError,
} from "../src/domain/errors.js";

const actor = ActorContextSchema.parse({
  userId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000003",
  membershipId: "00000000-0000-4000-8000-000000000004",
  actorType: "HUMAN",
});
const viewId = "00000000-0000-4000-8000-000000000005";
const investorId = "00000000-0000-4000-8000-000000000006";
const companyId = "00000000-0000-4000-8000-000000000007";
const input = {
  name: "Connected",
  scope: "PERSONAL",
  query: { state: "CONNECTED" },
  layout: "table",
  columns: ["state"],
  expectedVersion: 0,
};
const row = (extra: Record<string, unknown> = {}) => ({
  id: viewId,
  name: "Connected",
  scope: "PERSONAL",
  definition: {
    query: { state: "CONNECTED" },
    layout: "table",
    columns: ["state"],
  },
  version: 1,
  updated_at: new Date("2026-10-15T10:00:00.000Z"),
  owner_user_id: actor.userId,
  ...extra,
});

function fixture(
  options: {
    admin?: boolean;
    count?: number;
    own?: unknown;
    inserted?: unknown;
    updated?: unknown;
    removed?: boolean;
    company?: { tenantId: string; organisationId: string } | null;
  } = {},
) {
  const sql = Object.assign(
    vi.fn((..._query: readonly unknown[]) => Promise.resolve([])),
    { json: (value: unknown) => value },
  );
  const resolve = <T>(value: T) => vi.fn(() => Promise.resolve(value));
  const views = {
    list: resolve([
      row(),
      row({ id: companyId, scope: "ORGANISATION", owner_user_id: investorId }),
    ]),
    count: resolve(options.count ?? 0),
    insert: resolve(options.inserted ?? row()),
    findOwn: resolve(options.own ?? null),
    update: resolve(options.updated ?? null),
    remove: resolve(options.removed ?? true),
  };
  const requireCapability = resolve(undefined);
  const service = createRelationshipViewService({
    sql: sql as never,
    transactions: {
      run: vi.fn((work: (tx: { sql: unknown }) => Promise<unknown>) =>
        work({ sql }),
      ),
    } as never,
    authorization: {
      requireCapability,
      authorize: resolve({
        outcome: options.admin === true ? "ALLOW" : "DENY",
      }),
    } as never,
    companies: {
      findCanonicalCompany: resolve(
        options.company === null
          ? null
          : {
              id: companyId,
              tenantId: options.company?.tenantId ?? actor.tenantId,
              organisationId:
                options.company?.organisationId ?? actor.organisationId,
            },
      ),
    } as never,
    investorSubject: {
      investorOrganisationFor: resolve({ investorOrganisationId: investorId }),
    },
    views: views as never,
  });
  return { service, views, sql, requireCapability };
}

describe("CRM saved views", () => {
  it("lists the actor's own and the workspace's views for their own party", async () => {
    const { service, views } = fixture();
    const list = await service.list(actor);
    expect(views.list).toHaveBeenCalledWith(
      expect.anything(),
      {
        tenantId: actor.tenantId,
        organisationId: actor.organisationId,
        companyId: null,
        investorOrganisationId: investorId,
      },
      actor.userId,
      40,
    );
    expect(list.teamEditable).toBe(false);
    expect(list.items.map((item) => [item.scope, item.editable])).toEqual([
      ["PERSONAL", true],
      ["ORGANISATION", false],
    ]);
  });

  it("refuses a company outside the actor's organisation before any read", async () => {
    const { service, views } = fixture({
      company: { tenantId: actor.tenantId, organisationId: investorId },
    });
    await expect(service.list(actor, companyId)).rejects.toThrow();
    expect(views.list).not.toHaveBeenCalled();
  });

  it("creates under a lock, and a retry returns the first write", async () => {
    const created = fixture();
    await created.service.save(actor, viewId, input);
    expect(created.views.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: viewId,
        membershipId: actor.membershipId,
        definition: {
          query: { state: "CONNECTED" },
          layout: "table",
          columns: ["state"],
        },
      }),
    );
    expect(String(created.sql.mock.calls[0]?.[0])).toContain(
      "pg_advisory_xact_lock",
    );
    const retried = fixture({ own: row() });
    expect((await retried.service.save(actor, viewId, input)).id).toBe(viewId);
    expect(retried.views.insert).not.toHaveBeenCalled();
  });

  it("stops at the per-party limit", async () => {
    const { service, views } = fixture({ count: 20 });
    await expect(service.save(actor, viewId, input)).rejects.toBeInstanceOf(
      RelationshipViewLimitError,
    );
    expect(views.insert).not.toHaveBeenCalled();
  });

  it("lets only an organisation admin write a workspace view", async () => {
    const member = fixture();
    await expect(
      member.service.save(actor, viewId, { ...input, scope: "ORGANISATION" }),
    ).rejects.toBeInstanceOf(InterestNotPermittedError);
    const admin = fixture({
      admin: true,
      inserted: row({ scope: "ORGANISATION" }),
    });
    expect(
      (
        await admin.service.save(actor, viewId, {
          ...input,
          scope: "ORGANISATION",
        })
      ).editable,
    ).toBe(true);
  });

  it("answers a stale or foreign update as not found", async () => {
    const { service, views } = fixture({ updated: null });
    await expect(
      service.save(actor, viewId, { ...input, expectedVersion: 3 }),
    ).rejects.toBeInstanceOf(InterestNotFoundError);
    expect(views.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectedVersion: 3, teamEditable: false }),
    );
  });

  it("refuses a cursor, a selection or an unknown field in a save", async () => {
    const { service } = fixture();
    for (const bad of [
      { ...input, query: { cursor: "x" } },
      { ...input, selected: [viewId] },
      { ...input, scope: "PUBLIC" },
    ]) {
      await expect(service.save(actor, viewId, bad)).rejects.toThrow();
    }
  });

  it("deletes only with the expected version, and says not found otherwise", async () => {
    const ok = fixture();
    await ok.service.remove(actor, viewId, 2);
    expect(ok.views.remove).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: viewId, expectedVersion: 2 }),
    );
    const missing = fixture({ removed: false });
    await expect(
      missing.service.remove(actor, viewId, 2),
    ).rejects.toBeInstanceOf(InterestNotFoundError);
  });

  it("needs an active membership in the actor context", async () => {
    const { service } = fixture();
    await expect(
      service.list({ ...actor, membershipId: undefined }),
    ).rejects.toThrow();
  });
});
