import { describe, expect, it, vi } from "vitest";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { createRelationshipGateqApplications } from "../src/inbox/relationship-applications.js";
import type { InboxAuthority } from "../src/inbox/ports.js";

const RELATIONSHIP = "00000000-0000-4000-8000-0000000000b1";
const SEEN = "00000000-0000-4000-8000-0000000000c1";
const HIDDEN = "00000000-0000-4000-8000-0000000000c2";
const ME = "00000000-0000-4000-8000-0000000000d1";
const COLLEAGUE = "00000000-0000-4000-8000-0000000000d2";
const actor = { userId: ME } as unknown as ActorContext;

const row = (n: number, overrides: Record<string, unknown>) => ({
  application_id: `00000000-0000-4000-8000-0000000000e${String(n)}`,
  public_reference: `ga_${"0".repeat(25)}${String(n)}`,
  gateway_id: SEEN,
  gateway_name: "Seed gate",
  status: "SUBMITTED",
  founder_user_id: COLLEAGUE,
  created_at: "2026-10-14T10:00:00.000Z",
  submitted_at: "2026-10-14T11:00:00.000Z",
  ...overrides,
});

function world(rows: readonly unknown[]) {
  const calls: { query: string; values: readonly unknown[] }[] = [];
  const sql = vi.fn(
    (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
      calls.push({ query: strings.join("?").replace(/\s+/g, " "), values });
      return Promise.resolve(rows);
    },
  ) as unknown as DatabaseExecutor;
  const authorise = vi.fn((_actor: ActorContext, gatewayId: string) =>
    Promise.resolve(
      gatewayId === SEEN ? ({ gateway: {}, canDecide: false } as never) : null,
    ),
  );
  const authority: InboxAuthority = { authorise };
  const read = createRelationshipGateqApplications({ sql, authority });
  return { read, calls, authorise };
}

const rows = [
  row(1, {}),
  row(2, { gateway_id: HIDDEN }),
  row(3, { status: "IN_PROGRESS", submitted_at: null, founder_user_id: ME }),
  row(4, {
    status: "READY_TO_SUBMIT",
    submitted_at: null,
    founder_user_id: COLLEAGUE,
  }),
];

describe("GateQ applications on one canonical relationship", () => {
  it("links by the stored relationship id only, never a name", async () => {
    const { read, calls } = world([]);
    await read({ actor, relationshipId: RELATIONSHIP, side: "INVESTOR" });
    expect(calls[0]?.query).toContain("where f.relationship_id=?");
    expect(calls[0]?.query).not.toMatch(/name\s*(=|ilike|like)/i);
    expect(calls[0]?.values[0]).toBe(RELATIONSHIP);
  });

  it("an investor sees only submitted applications to gateways GateQ lets them view", async () => {
    const { read, authorise } = world(rows);
    const items = await read({
      actor,
      relationshipId: RELATIONSHIP,
      side: "INVESTOR",
    });
    expect(items.map((i) => i.applicationId)).toEqual([
      "00000000-0000-4000-8000-0000000000e1",
    ]);
    expect(items[0]?.gatewayName).toBe("Seed gate");
    // Each gateway authorised once, as this actor.
    expect(authorise).toHaveBeenCalledTimes(2);
    expect(authorise.mock.calls.every(([a]) => a === actor)).toBe(true);
  });

  it("the company sees submitted applications and only the caller's own drafts", async () => {
    const { read, authorise } = world(rows);
    const items = await read({
      actor,
      relationshipId: RELATIONSHIP,
      side: "COMPANY",
    });
    expect(items.map((i) => [i.applicationId.slice(-2), i.status])).toEqual([
      ["e1", "SUBMITTED"],
      ["e2", "SUBMITTED"],
      ["e3", "IN_PROGRESS"],
    ]);
    // The fund's internal gateway name is not the founder's to read.
    expect(items.every((i) => i.gatewayName === null)).toBe(true);
    expect(authorise).not.toHaveBeenCalled();
  });

  it("a malformed relationship id reads nothing", async () => {
    const { read, calls } = world(rows);
    expect(
      await read({ actor, relationshipId: "kora", side: "COMPANY" }),
    ).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
