import { describe, expect, it, vi } from "vitest";
import { ActorContextSchema } from "@capital-q/security";
import { createRelationshipViewStore } from "../src/infrastructure/postgres-relationship-views.js";
const actor = ActorContextSchema.parse({
  userId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000003",
  membershipId: "00000000-0000-4000-8000-000000000004",
  actorType: "HUMAN",
});
const investorId = "00000000-0000-4000-8000-000000000006";
const viewId = "00000000-0000-4000-8000-000000000005";
const input = {
  name: "Connected",
  scope: "PERSONAL",
  query: { state: "CONNECTED" },
  layout: "table",
  columns: ["state"],
  expectedVersion: 0,
};
function fixture(
  options: {
    member?: boolean;
    admin?: boolean;
    revokedOnWrite?: boolean;
    count?: number;
    returned?: readonly unknown[];
  } = {},
) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  let memberChecks = 0;
  const sql = Object.assign(
    vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.join("?");
      calls.push({ text, values });
      if (text.includes("organisation_memberships")) {
        memberChecks += 1;
        return options.member === false ||
          (options.revokedOnWrite === true && memberChecks > 1)
          ? []
          : [{ id: actor.membershipId }];
      }
      if (text.includes("count(*)")) return [{ count: options.count ?? 0 }];
      if (text.includes("pg_advisory")) return [];
      return options.returned ?? [];
    }),
    { json: (value: unknown) => value },
  );
  const run = vi.fn(async (work: (tx: { sql: unknown }) => Promise<unknown>) =>
    work({ sql }),
  );
  const dependencies = {
    sql,
    transactions: { run },
    authorization: {
      requireCapability: vi.fn(async () => undefined),
      authorize: vi.fn(async () => ({
        outcome: options.admin === true ? "ALLOW" : "DENY",
      })),
    },
    investorSubject: {
      investorOrganisationFor: vi.fn(async () => ({
        investorOrganisationId: investorId,
      })),
    },
    companies: { findCanonicalCompany: vi.fn(async () => null) },
  } as unknown as Parameters<typeof createRelationshipViewStore>[0];
  return { store: createRelationshipViewStore(dependencies), calls, run };
}
describe("server-owned saved view authority", () => {
  it("denies revoked membership before reading views", async () => {
    const f = fixture({ member: false });
    await expect(f.store.list(actor)).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
  });
  it("binds personal/team reads to the current canonical investor and actor", async () => {
    const f = fixture();
    await expect(f.store.list(actor)).resolves.toEqual({
      items: [],
      teamEditable: false,
    });
    const read = f.calls.at(-1);
    expect(read?.values).toEqual([
      actor.tenantId,
      actor.organisationId,
      null,
      investorId,
      actor.userId,
    ]);
    expect(read?.text).toContain("scope='PERSONAL' and owner_user_id=");
  });
  it("denies founder preferences for an unknown or foreign company", async () => {
    const f = fixture();
    await expect(
      f.store.list(actor, "00000000-0000-4000-8000-000000000099"),
    ).rejects.toThrow();
    expect(
      f.calls.some((call) => call.text.includes("relationship_views")),
    ).toBe(false);
  });
  it("refuses ordinary member team writes before a transaction", async () => {
    const f = fixture();
    await expect(
      f.store.save(actor, viewId, { ...input, scope: "ORGANISATION" }),
    ).rejects.toThrow();
    expect(f.run).not.toHaveBeenCalled();
  });
  it("rechecks membership under lock before any write", async () => {
    const f = fixture({ revokedOnWrite: true });
    await expect(f.store.save(actor, viewId, input)).rejects.toThrow();
    expect(f.calls.some((call) => call.text.includes("insert into"))).toBe(
      false,
    );
    expect(f.calls.at(-1)?.text).toContain("for share of m");
  });
  it("locks the canonical scope and refuses creation at the personal limit", async () => {
    const f = fixture({ count: 20 });
    await expect(f.store.save(actor, viewId, input)).rejects.toThrow(
      "saved view limit",
    );
    expect(
      f.calls.some((call) => call.text.includes("pg_advisory_xact_lock")),
    ).toBe(true);
    expect(f.calls.some((call) => call.text.includes("insert into"))).toBe(
      false,
    );
  });
  it("preserves compare-and-swap and ownership instead of reporting stale edits as success", async () => {
    const f = fixture();
    await expect(
      f.store.save(actor, viewId, { ...input, expectedVersion: 3 }),
    ).rejects.toThrow();
    const update = f.calls.at(-1);
    expect(update?.text).toContain("and version=");
    expect(update?.text).toContain("owner_user_id=");
    expect(update?.values).toContain(actor.userId);
    expect(update?.values).toContain(investorId);
  });
  it("returns the server-confirmed version on successful save", async () => {
    const f = fixture({
      returned: [
        {
          id: viewId,
          name: input.name,
          scope: "PERSONAL",
          definition: {
            query: input.query,
            layout: input.layout,
            columns: input.columns,
          },
          version: 1,
          updated_at: "2026-10-14T18:00:00.000Z",
          owner_user_id: actor.userId,
        },
      ],
    });
    await expect(f.store.save(actor, viewId, input)).resolves.toMatchObject({
      id: viewId,
      version: 1,
      editable: true,
      query: input.query,
    });
  });
  it("rejects private notes/selection without executing any database query", async () => {
    const f = fixture();
    await expect(
      f.store.save(actor, viewId, { ...input, notes: "private" }),
    ).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
  it("does not acknowledge a stale or inaccessible delete", async () => {
    const f = fixture();
    await expect(f.store.remove(actor, viewId, 3)).rejects.toThrow();
    expect(f.calls.at(-1)?.text).toContain("and version=");
    expect(f.calls.at(-1)?.values).toContain(actor.userId);
  });
});
