import { describe, expect, it, vi } from "vitest";
import type { UnicornPotentialDto } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";
import { createGateqUnicornReader } from "../src/gateq/unicorn.js";

const actor = ActorContextSchema.parse({
  userId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000003",
  membershipId: "00000000-0000-4000-8000-000000000004",
  actorType: "HUMAN",
});
const companyId = "00000000-0000-4000-8000-000000000005";
const applicationId = "00000000-0000-4000-8000-000000000006";
const assessment: UnicornPotentialDto = {
  status: "INSUFFICIENT_EVIDENCE",
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
  assessedAt: "2026-10-17T00:00:00Z",
  momentum: null,
};
function fixture() {
  const premium = vi.fn().mockResolvedValue(true);
  const companies = vi
    .fn()
    .mockResolvedValue(new Map([[applicationId, companyId]]));
  const investorMayRead = vi.fn().mockResolvedValue(true);
  const current = vi.fn().mockResolvedValue(new Map([[companyId, assessment]]));
  return {
    premium,
    companies,
    investorMayRead,
    current,
    read: createGateqUnicornReader({
      premium,
      companies,
      investorMayRead,
      current,
    }),
  };
}
describe("GateQ current Unicorn enrichment", () => {
  it("reauthorizes premium on every read and removes a score immediately after revocation", async () => {
    const f = fixture();
    expect(
      (await f.read(actor, [applicationId], "INVESTOR")).get(applicationId),
    ).toEqual({ companyId, assessment });
    f.premium.mockResolvedValue(false);
    expect((await f.read(actor, [applicationId], "INVESTOR")).size).toBe(0);
    expect(f.premium).toHaveBeenCalledTimes(2);
    expect(f.current).toHaveBeenCalledTimes(1);
  });
  it("does not look up any protected application or assessment for a free founder", async () => {
    const f = fixture();
    f.premium.mockResolvedValue(false);
    expect((await f.read(actor, [applicationId], "FOUNDER")).size).toBe(0);
    expect(f.companies).not.toHaveBeenCalled();
    expect(f.current).not.toHaveBeenCalled();
  });
  it("requires the submitted canonical company link instead of inferring one from the applicant name", async () => {
    const f = fixture();
    f.companies.mockResolvedValue(new Map());
    expect((await f.read(actor, [applicationId], "INVESTOR")).size).toBe(0);
    expect(f.current).not.toHaveBeenCalled();
  });
  it("honors current founder membership refusal and never replaces it with investor access", async () => {
    const f = fixture();
    f.companies.mockResolvedValue(new Map());
    expect((await f.read(actor, [applicationId], "FOUNDER")).size).toBe(0);
    expect(f.companies).toHaveBeenCalledWith(actor, [applicationId], "FOUNDER");
    expect(f.investorMayRead).not.toHaveBeenCalled();
  });
  it("requires current company visibility even for an investor admitted to the dossier", async () => {
    const f = fixture();
    f.investorMayRead.mockResolvedValue(false);
    expect((await f.read(actor, [applicationId], "INVESTOR")).size).toBe(0);
    expect(f.current).not.toHaveBeenCalled();
  });
  it("omits a revoked persisted source assessment rather than constructing a substitute", async () => {
    const f = fixture();
    f.current.mockResolvedValue(new Map());
    expect((await f.read(actor, [applicationId], "FOUNDER")).size).toBe(0);
  });
  it("batches shared company assessment reads and excludes unrequested application links", async () => {
    const f = fixture();
    f.companies.mockResolvedValue(
      new Map([
        [applicationId, companyId],
        ["another", companyId],
        ["foreign", "secret"],
      ]),
    );
    const result = await f.read(
      actor,
      [applicationId, applicationId, "another"],
      "FOUNDER",
    );
    expect([...result.keys()]).toEqual([applicationId, "another"]);
    expect(f.current).toHaveBeenCalledWith([companyId]);
  });
  it("preserves the core GateQ journey and hides the optional score if its source guard is unavailable", async () => {
    const f = fixture();
    f.current.mockRejectedValue(new Error("source guard unavailable"));
    expect((await f.read(actor, [applicationId], "FOUNDER")).size).toBe(0);
  });
});
