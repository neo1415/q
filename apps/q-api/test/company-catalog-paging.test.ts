import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import type {
  CompanyKnowledge,
  CompanyKnowledgePort,
} from "@capital-q/discovery";
import { ActorContextSchema } from "@capital-q/security";

import {
  CATALOG_SCAN_MAX,
  createPostgresCompanyCatalog,
} from "../src/composition/company-catalog.js";

/**
 * Owner 2026-10-23: a fit ranking reads every match, never the first page
 * by name. The knowledge query returns at most one page (50), so the
 * catalog pages it by keyset until a short page or its bound.
 */

const actor = ActorContextSchema.parse({
  userId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  actorType: "HUMAN",
});

function knowledgeOf(count: number) {
  const all: CompanyKnowledge[] = Array.from({ length: count }, (_, i) => ({
    companyId: `c0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    name: `Company ${String(i + 1).padStart(3, "0")}`,
    shortDescription: null,
    description: null,
    websiteUrl: null,
    countryCode: "NG",
    city: null,
    sectorCodes: [],
    subsectorCodes: [],
    geographyCodes: [],
    businessModelCodes: [],
    stageCode: "seed",
    discoveryEligible: true,
    pitchMediaPresent: false,
    verificationStatus: "UNVERIFIED",
    evidenceStatus: "SELF_REPORTED",
    version: "1",
    updatedAt: "2026-10-23T00:00:00.000Z",
  }));
  const pages: number[] = [];
  const reads: Pick<CompanyKnowledgePort, "discoverCompanies"> = {
    discoverCompanies: (_actor, query) => {
      const start =
        query.after === null || query.after === undefined
          ? 0
          : all.findIndex((c) => c.companyId === query.after?.companyId) + 1;
      const limit = Math.min(query.limit, 50);
      pages.push(limit);
      return Promise.resolve(all.slice(start, start + limit));
    },
  };
  // Only the read the catalog uses; any other would fail the test.
  const port = reads as CompanyKnowledgePort;
  return { port, pages };
}

// No sector, country or organisation asked: the catalog makes no SQL call.
const sql: DatabaseExecutor = null as never;

const find = (count: number, limit: number) => {
  const knowledge = knowledgeOf(count);
  const catalog = createPostgresCompanyCatalog({
    sql,
    knowledge: knowledge.port,
  });
  return catalog
    .find(actor, { sectors: [], countries: [], stages: [], limit })
    .then((found) => ({ found, pages: knowledge.pages }));
};

describe("company catalog paging (owner 2026-10-23)", () => {
  it("reads every one of 137 matches over three pages, in order, none twice", async () => {
    const { found, pages } = await find(137, CATALOG_SCAN_MAX);
    expect(found.candidates).toHaveLength(137);
    expect(new Set(found.candidates.map((c) => c.companyId)).size).toBe(137);
    expect(found.candidates.at(-1)?.name).toBe("Company 137");
    expect(pages).toEqual([50, 50, 50]);
  });

  it("F-82: reads all 463 companies of the live network, not the first 200 by name", async () => {
    const { found } = await find(463, CATALOG_SCAN_MAX);
    expect(found.candidates).toHaveLength(463);
    expect(found.candidates.at(-1)?.name).toBe("Company 463");
  });

  it("stops at its bound, and a small limit reads one small page", async () => {
    const capped = await find(CATALOG_SCAN_MAX + 37, CATALOG_SCAN_MAX * 2);
    expect(capped.found.candidates).toHaveLength(CATALOG_SCAN_MAX);
    expect(capped.pages).toHaveLength(CATALOG_SCAN_MAX / 50);
    const small = await find(500, 6);
    expect(small.found.candidates).toHaveLength(6);
    expect(small.pages).toEqual([6]);
  });
});
