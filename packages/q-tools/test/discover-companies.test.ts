import { describe, expect, it } from "vitest";

import type { CompanyCatalogPort } from "../src/index.js";
import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
} from "../src/index.js";
import {
  actorA,
  COMPANY_B_NETWORK,
  COMPANY_B_PRIVATE,
  contextFor,
  fakePorts,
  planFor,
  type QToolPortsOverrides,
} from "./support.js";

/**
 * K1: `discovery.companies` lists companies of a kind by declared
 * taxonomy, and decides every candidate through disclosure: classification
 * selects, disclosure decides. A candidate the catalog returned but
 * disclosure refuses is never listed.
 */

type Seen = { query?: Parameters<CompanyCatalogPort["find"]>[1] };

function catalog(seen: Seen = {}): CompanyCatalogPort {
  return {
    find: (_actor, query) => {
      seen.query = query;
      return Promise.resolve({
        candidates: [
          {
            companyId: COMPANY_B_NETWORK,
            name: "Beacon Analytics",
            stageCode: "seed",
            headquartersCountry: "NG",
            shortDescription: null,
            sectors: ["Fintech"],
          },
          {
            companyId: COMPANY_B_PRIVATE,
            name: "Private Co",
            stageCode: "seed",
            headquartersCountry: "NG",
            shortDescription: null,
            sectors: ["Fintech"],
          },
        ],
        sectors: [{ code: "fintech", name: "Fintech" }],
        unknownSectors: [],
      });
    },
  };
}

function port(overrides: QToolPortsOverrides) {
  return createQToolExecutor({
    registry: createQToolRegistry(createDefaultQTools(fakePorts(overrides))),
  });
}

const networkPlan = planFor(actorA, "OWN_COMPANY_QUESTION", [
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
]);

describe("DISCOVER_COMPANIES tool (K1)", () => {
  it("returns only disclosure-confirmed companies, with the sector and country passed on", async () => {
    const seen: Seen = {};
    const outcome = await port({ companyCatalog: catalog(seen) }).execute(
      {
        callId: "c1",
        name: "discover_companies",
        arguments: { sectors: ["fintech"], countries: ["ng"], limit: 3 },
      },
      contextFor(actorA, networkPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        companies: [{ companyId: COMPANY_B_NETWORK, name: "Beacon Analytics" }],
        order: "NAME",
        sectors: [{ code: "fintech", name: "Fintech" }],
      },
    });
    expect(JSON.stringify(outcome)).not.toContain(COMPANY_B_PRIVATE);
    expect(seen.query?.countries).toEqual(["NG"]);
    expect(seen.query?.sectors).toEqual(["fintech"]);
  });

  it("is not offered without a catalog, and refused without the network scope", async () => {
    const without = await port({ companyCatalog: undefined }).execute(
      { callId: "c1", name: "discover_companies", arguments: {} },
      contextFor(actorA, networkPlan),
    );
    expect(without.status).not.toBe("SUCCEEDED");
    const noNetwork = planFor(actorA, "OWN_COMPANY_QUESTION", []);
    const refused = await port({ companyCatalog: catalog() }).execute(
      { callId: "c2", name: "discover_companies", arguments: {} },
      contextFor(actorA, noNetwork),
    );
    expect(refused.failureCode).toBe("TOOL_NOT_ELIGIBLE");
  });
});
