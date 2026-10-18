import { describe, expect, it } from "vitest";

import {
  createInvestabilityService,
  type InvestabilityStore,
} from "../src/index.js";

/**
 * The recompute is idempotent (a redelivered event or a sweep over an
 * unchanged company records nothing), an unlisted company is never
 * assessed for investors, and the periodic sweep reads only changed
 * companies unless asked for all.
 */

const COMPANY = "00000000-0000-4000-8000-000000000001";

function memoryStore(listed = true) {
  const rows: { basisHash: string; revision: number }[] = [];
  const asked: string[] = [];
  const store: InvestabilityStore = {
    inputs: (companyId) =>
      Promise.resolve({
        subject: { companyId, tenantId: "t", organisationId: "o" },
        inputs: {
          companyId,
          stageCode: "seed",
          sectorCodes: [],
          businessModelCodes: ["b2b_saas"],
          profile: {
            listed,
            description: true,
            website: true,
            updatedAt: null,
          },
          verification: { organisation: true, domain: false, decidedAt: null },
          founders: [],
          claims: [],
        },
      }),
    listedCompanyIds: () => {
      asked.push("all");
      return Promise.resolve([COMPANY]);
    },
    changedCompanyIds: () => {
      asked.push("changed");
      return Promise.resolve([]);
    },
    latest: () => Promise.resolve(rows.at(-1) ?? null),
    record: (input) => {
      const revision = rows.length + 1;
      rows.push({ basisHash: input.basisHash, revision });
      return Promise.resolve({ revision, created: true });
    },
    current: () => Promise.resolve(new Map()),
  };
  return { store, rows, asked };
}

describe("investability service", () => {
  it("records once, then nothing while the evidence is unchanged", async () => {
    const m = memoryStore();
    const service = createInvestabilityService({
      store: m.store,
      deck: () => Promise.resolve(null),
      clock: () => new Date("2026-10-16T12:00:00.000Z"),
    });
    expect(await service.recompute(COMPANY)).toEqual({
      kind: "RECORDED",
      revision: 1,
    });
    expect(await service.recompute(COMPANY)).toEqual({
      kind: "UNCHANGED",
      revision: 1,
    });
    expect(m.rows).toHaveLength(1);
  });

  it("never assesses an unlisted company for investors", async () => {
    const m = memoryStore(false);
    const service = createInvestabilityService({
      store: m.store,
      deck: () => Promise.resolve(null),
    });
    expect(await service.recompute(COMPANY)).toEqual({ kind: "NOT_LISTED" });
    expect(m.rows).toHaveLength(0);
  });

  it("the periodic sweep reads only changed companies", async () => {
    const m = memoryStore();
    const service = createInvestabilityService({
      store: m.store,
      deck: () => Promise.resolve(null),
    });
    expect(await service.sweep({ changedOnly: true })).toEqual({
      recorded: 0,
      unchanged: 0,
      failed: 0,
    });
    expect(await service.sweep()).toEqual({
      recorded: 1,
      unchanged: 0,
      failed: 0,
    });
    expect(m.asked).toEqual(["changed", "all"]);
  });
});
