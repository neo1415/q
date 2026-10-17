import { describe, expect, it, vi } from "vitest";
import type { UnicornPotentialStore } from "../src/unicorn-potential/postgres.js";
import {
  createUnicornPotentialService,
  type UnicornPotentialEngine,
} from "../src/unicorn-potential/service.js";

function fixture(listed = true) {
  const record = vi
    .fn<UnicornPotentialStore["record"]>()
    .mockResolvedValue({ revision: 1, created: true });
  const ids = vi
    .fn<UnicornPotentialStore["listedCompanyIds"]>()
    .mockResolvedValue(["company"]);
  const store: UnicornPotentialStore = {
    inputs: vi
      .fn()
      .mockResolvedValue({
        subject: {
          companyId: "company",
          tenantId: "tenant",
          organisationId: "organisation",
        },
        inputs: {
          companyId: "company",
          stageCode: "seed",
          sectorCodes: ["b", "a", "a"],
          businessModelCodes: [],
          profile: {
            listed,
            description: false,
            website: false,
            updatedAt: null,
          },
          verification: { organisation: false, domain: false, decidedAt: null },
          founders: [],
          claims: [],
        },
      }),
    record,
    listedCompanyIds: ids,
    current: async () => new Map(),
    history: async () => [],
  };
  const assess = vi
    .fn<UnicornPotentialEngine>()
    .mockReturnValue({
      view: {
        status: "NOT_ASSESSED",
        overallScore: null,
        band: null,
        confidence: "LOW",
        coverage: 0,
        stage: "SEED",
        methodVersion: "unicorn-potential.v1.0.0",
        inputRulesVersion: "inputs.v1",
        pillars: [],
        up: [],
        down: [],
        missing: [],
        benchmark: "Comparable benchmark unavailable",
      },
      basisHash: "a".repeat(64),
      observations: {},
    });
  const deck = vi.fn().mockResolvedValue(null);
  const sleep = vi.fn().mockResolvedValue(undefined);
  const service = createUnicornPotentialService({
    store,
    assess,
    deck,
    sleep,
    methodVersion: "unicorn-potential.v1.0.0",
    clock: () => new Date("2026-10-17T12:00:00Z"),
  });
  return { store, assess, record, ids, deck, sleep, service };
}
describe("Unicorn Potential recompute service", () => {
  it("passes eligible inputs to engine and snapshots observations under canonical subject", async () => {
    const f = fixture();
    expect(await f.service.recompute("company")).toEqual({
      kind: "RECORDED",
      revision: 1,
    });
    expect(f.assess).toHaveBeenCalledWith(
      expect.objectContaining({ deck: null }),
      "2026-10-17T12:00:00.000Z",
    );
    expect(f.record).toHaveBeenCalledWith(
      expect.objectContaining({
        cohortKey: '{"stage":"SEED","sectors":["a","b"]}',
        subject: {
          companyId: "company",
          tenantId: "tenant",
          organisationId: "organisation",
        },
      }),
    );
  });
  it("does not assess a company withdrawn from investor visibility", async () => {
    const f = fixture(false);
    expect(await f.service.recompute("company")).toEqual({
      kind: "NOT_LISTED",
    });
    expect(f.assess).not.toHaveBeenCalled();
    expect(f.deck).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
  });
  it("does not turn failed evidence retrieval into evidence-loss score history", async () => {
    const f = fixture();
    f.deck.mockRejectedValue(new Error("storage unavailable"));
    await expect(f.service.recompute("company")).rejects.toThrow(
      "storage unavailable",
    );
    expect(f.record).not.toHaveBeenCalled();
  });
  it("reports repository idempotent retry without writing another revision", async () => {
    const f = fixture();
    f.record.mockResolvedValue({ revision: 7, created: false });
    expect(await f.service.recompute("company")).toEqual({
      kind: "UNCHANGED",
      revision: 7,
    });
  });
  it("defaults to a bounded hundred-company sweep paced by 100ms", async () => {
    const f = fixture();
    expect(await f.service.sweep()).toEqual({
      recorded: 1,
      unchanged: 0,
      failed: 0,
    });
    expect(f.ids).toHaveBeenCalledWith(100);
    expect(f.sleep).toHaveBeenCalledWith(100);
  });
  it("caps explicit sweeps and continues after one company fails", async () => {
    const f = fixture();
    f.ids.mockResolvedValue(["bad", "good"]);
    f.record.mockRejectedValueOnce(new Error("db unavailable"));
    expect(await f.service.sweep({ limit: 100000, pauseMs: 0 })).toEqual({
      recorded: 1,
      unchanged: 0,
      failed: 1,
    });
    expect(f.ids).toHaveBeenCalledWith(500);
    expect(f.sleep).toHaveBeenCalledTimes(2);
    expect(f.sleep).toHaveBeenLastCalledWith(100);
  });
});
