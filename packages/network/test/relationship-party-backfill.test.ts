import { describe, expect, it, vi } from "vitest";

import { createRelationshipStateProjector } from "../src/application/relationship-projection.js";

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";

function fixture(behind: readonly string[], fail = false) {
  const writes: { id: string; party: string }[] = [];
  const partyStates = {
    behindAll: vi.fn((_sql: unknown, page: { after: string | null }) =>
      fail
        ? Promise.reject(new Error("relation does not exist"))
        : Promise.resolve(
            behind.filter((id) => page.after === null || id > page.after),
          ),
    ),
    upsert: vi.fn(
      (_sql: unknown, input: { relationshipId: string; party: string }) => {
        writes.push({ id: input.relationshipId, party: input.party });
        return Promise.resolve(true);
      },
    ),
  };
  const projector = createRelationshipStateProjector({
    sql: {} as never,
    repositories: {
      relationships: {
        listIdsForProjection: () => Promise.resolve([]),
        recordProjection: () => Promise.resolve(false),
      } as never,
      events: {
        listByRelationship: () => Promise.resolve([]),
      } as never,
    },
    partyStates: partyStates as never,
  });
  return { projector, writes, partyStates };
}

describe("pipeline read model backfill at worker start", () => {
  it("folds both parties of every relationship the read model is behind on", async () => {
    const { projector, writes } = fixture([A, B]);
    const result = await projector.rebuild({ batchSize: 200 });
    expect(result.readModel).toEqual({ folded: 2 });
    expect(writes).toEqual([
      { id: A, party: "INVESTOR" },
      { id: A, party: "COMPANY" },
      { id: B, party: "INVESTOR" },
      { id: B, party: "COMPANY" },
    ]);
  });

  it("stops at the run's budget", async () => {
    const { projector } = fixture([A, B]);
    expect((await projector.rebuild({ max: 1 })).readModel).toEqual({
      folded: 1,
    });
  });

  it("never fails the relationship rebuild when the read model is unavailable", async () => {
    const { projector } = fixture([A], true);
    const result = await projector.rebuild({});
    expect(result).toMatchObject({ scanned: 0, readModel: null });
  });
});
