import { describe, it, expect, vi } from "vitest";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  ActorContextSchema,
  type AuthorizationService,
} from "@capital-q/security";
import { createRelationshipViewStore } from "../src/infrastructure/postgres-relationship-views.js";
const actor = ActorContextSchema.parse({
  userId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000003",
  membershipId: "00000000-0000-4000-8000-000000000004",
  actorType: "HUMAN",
});
function fixture(member = true, admin = false) {
  const calls: { text: string; values: unknown[] }[] = [];
  const query = vi.fn(
    async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.join("?");
      calls.push({ text, values });
      if (text.includes("identity.organisation_memberships"))
        return member ? [{ id: actor.membershipId }] : [];
      return [];
    },
  );
  const sql = Object.assign(query, {
    json: (x: unknown) => x,
  }) as unknown as DatabaseExecutor;
  const authorization = {
    authorize: vi.fn(async () => ({ outcome: admin ? "ALLOW" : "DENY" })),
    requireCapability: vi.fn(),
  } as unknown as AuthorizationService;
  return { store: createRelationshipViewStore(sql, authorization), calls };
}
describe("saved relationship views authority", () => {
  it("refuses revoked membership before reading private preferences", async () => {
    const f = fixture(false);
    await expect(f.store.list(actor)).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
  });
  it("refuses team preference write for ordinary member before any write", async () => {
    const f = fixture();
    await expect(
      f.store.save(actor, "00000000-0000-4000-8000-000000000005", {
        name: "Team",
        scope: "ORGANISATION",
        definition: {},
        expectedVersion: 0,
      }),
    ).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
  });
  it("scopes personal reads to person plus tenant and organisation", async () => {
    const f = fixture();
    await f.store.list(actor);
    const read = f.calls[1];
    expect(read?.values).toEqual([
      actor.tenantId,
      actor.organisationId,
      actor.userId,
    ]);
    expect(read?.text).toContain("scope='ORGANISATION' or owner_user_id=");
  });
  it("rejects stale or unowned update rather than claiming success", async () => {
    const f = fixture();
    await expect(
      f.store.save(actor, "00000000-0000-4000-8000-000000000005", {
        name: "Rename",
        scope: "PERSONAL",
        definition: {},
        expectedVersion: 3,
      }),
    ).rejects.toThrow();
    expect(f.calls[1]?.text).toContain("scope='PERSONAL' and owner_user_id=");
    expect(f.calls[1]?.text).toContain("and version=");
  });
  it("rejects deleting another owner or a stale version", async () => {
    const f = fixture();
    await expect(
      f.store.remove(actor, "00000000-0000-4000-8000-000000000005", 2),
    ).rejects.toThrow();
    expect(f.calls[1]?.values).toContain(actor.userId);
  });
  it("refuses preferences containing private notes", async () => {
    const f = fixture();
    await expect(
      f.store.save(actor, "00000000-0000-4000-8000-000000000005", {
        name: "Leak",
        scope: "PERSONAL",
        definition: { privateNotes: "not preference" },
        expectedVersion: 0,
      }),
    ).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
  });
});
