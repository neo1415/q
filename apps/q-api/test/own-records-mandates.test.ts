import { describe, expect, it, vi } from "vitest";

import { createOwnRecordsPort } from "../src/composition/own-records.js";
import { createOwnContextReader } from "../src/composition/workforce/own-context.js";

/**
 * Live 2026-10-29 (deep research, run A): a report for an investor with an
 * ACTIVE $250k-1M seed mandate in Nigeria, Ghana and Kenya said their
 * cheque, stage, sector and geography "are not recorded", because the
 * mandates record was the list (name and status only). Each mandate in
 * force now carries its declared criteria, read as the investor.
 */

const ORG = "a0000000-0000-4000-8000-000000000001";
const ACTIVE = "a0000000-0000-4000-8000-000000000002";
const CLOSED = "a0000000-0000-4000-8000-000000000003";
const actor = {
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
} as never;

const summary = (id: string, status: string) => ({
  id,
  investorOrganisationId: ORG,
  name: status === "ACTIVE" ? "Primary mandate" : "Old fund",
  status,
  discoveryMode: null,
  effectiveFrom: null,
  effectiveTo: null,
  version: 1,
  createdAt: "2026-10-28T15:45:56.000Z",
});

function port(getInvestorMandate = vi.fn()) {
  getInvestorMandate.mockImplementation(
    ({ mandateId }: { mandateId: string }) =>
      Promise.resolve({
        ...summary(mandateId, "ACTIVE"),
        minCheque: "250000",
        maxCheque: "1000000",
        currencyCode: "USD",
        minStageCode: "seed",
        maxStageCode: "seed",
        rawMandateText: "PRIVATE NARRATIVE",
        constraints: [
          {
            id: "x",
            dimension: "stage",
            operator: "EQ",
            value: { kind: "codes", values: ["seed"] },
            importance: "MUST",
            isHardExclusion: false,
          },
        ],
        taxonomyPreferences: [
          {
            nodeId: "n1",
            vocabularyCode: "geography",
            canonicalCode: "nigeria",
            preferenceStrength: "MUST",
            isExclusion: false,
          },
          {
            nodeId: "n2",
            vocabularyCode: "sector",
            canonicalCode: "digital_lending",
            preferenceStrength: "HARD_EXCLUSION",
            isExclusion: true,
          },
        ],
      }),
  );
  return {
    getInvestorMandate,
    port: createOwnRecordsPort({
      companyService: {} as never,
      investorService: {
        listInvestorMandates: () =>
          Promise.resolve({
            items: [summary(ACTIVE, "ACTIVE"), summary(CLOSED, "CLOSED")],
            nextCursor: undefined,
          }),
        getInvestorMandate,
      } as never,
      capital: {} as never,
      verification: {} as never,
      visibility: {} as never,
      profileFindings: {} as never,
    }),
  };
}

describe("INVESTOR_MANDATES record", () => {
  it("carries each mandate in force with its declared criteria, never the raw narrative", async () => {
    const { port: records, getInvestorMandate } = port();
    const record = (await records.read(actor, {
      record: "INVESTOR_MANDATES",
      subjectType: "INVESTOR_ORGANISATION",
      subjectId: ORG,
    } as never)) as { items: Record<string, unknown>[] };
    expect(getInvestorMandate).toHaveBeenCalledTimes(1);
    expect(record.items[0]).toMatchObject({
      status: "ACTIVE",
      declared: true,
      cheque: { min: "250000", max: "1000000", currency: "USD" },
      stage: { min: "seed", max: "seed" },
      preferences: [
        { vocabulary: "geography", code: "nigeria", exclusion: false },
        { vocabulary: "sector", code: "digital_lending", exclusion: true },
      ],
    });
    // A closed mandate is history: listed, not expanded.
    expect(record.items[1]).not.toHaveProperty("cheque");
    expect(JSON.stringify(record)).not.toContain("PRIVATE NARRATIVE");
  });

  it("a mandate whose detail cannot be read stays listed, unknown, not empty criteria", async () => {
    const fail = vi.fn().mockRejectedValue(new Error("403"));
    const reader = createOwnRecordsPort({
      companyService: {} as never,
      investorService: {
        listInvestorMandates: () =>
          Promise.resolve({ items: [summary(ACTIVE, "ACTIVE")] }),
        getInvestorMandate: fail,
      } as never,
      capital: {} as never,
      verification: {} as never,
      visibility: {} as never,
      profileFindings: {} as never,
    });
    const record = (await reader.read(actor, {
      record: "INVESTOR_MANDATES",
      subjectType: "INVESTOR_ORGANISATION",
      subjectId: ORG,
    } as never)) as { items: Record<string, unknown>[] };
    expect(record.items[0]).toMatchObject({ status: "ACTIVE" });
    expect(record.items[0]).not.toHaveProperty("cheque");
  });

  it("reaches the writer's own context labelled declared", async () => {
    const { port: records } = port();
    const context = await createOwnContextReader({
      ownInvestorOrganisation: () => Promise.resolve(ORG),
      records,
    })(actor);
    expect(context).toContain("Their mandates (declared):");
    expect(context).toContain('"max":"1000000"');
    expect(context).toContain("nigeria");
    expect(context).toContain("digital_lending");
  });
});
