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

describe("DISCOVER_COMPANIES order FIT (owner 2026-10-23: never the first by name, then ranked)", () => {
  // 463 matches, as live (F-82); the investor's best is the last by name.
  const ids = Array.from(
    { length: 463 },
    (_, i) => `d0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  );
  const everyoneVisible = {
    canDisclose: () => Promise.reject(new Error("not used")),
    // The real Permissions context throws past 200 per call (F-82 live).
    evaluateMany: (requests: readonly { resource: unknown }[]) =>
      requests.length > 200
        ? Promise.reject(new RangeError("disclosure batch exceeds 200"))
        : Promise.resolve(
            requests.map((request) => ({
              outcome: "ALLOW" as const,
              resource: request.resource,
              requestedAccess: "view" as const,
              grantedAccess: "view" as const,
              reasonCode: "NETWORK_VISIBLE" as const,
              via: { kind: "INTRINSIC" as const },
            })),
          ),
  };
  function many(seen: Seen): CompanyCatalogPort {
    return {
      find: (_actor, query) => {
        seen.query = query;
        return Promise.resolve({
          candidates: ids.map((companyId, i) => ({
            companyId,
            name: `Company ${String(i + 1).padStart(3, "0")}`,
            stageCode: "seed",
            headquartersCountry: "NG",
            shortDescription: null,
            sectors: ["Fintech"],
          })),
          sectors: [{ code: "fintech", name: "Fintech" }],
          unknownSectors: [],
        });
      },
    };
  }
  const scored: string[][] = [];
  const fit = {
    profiles: () => Promise.reject(new Error("not used")),
    top: () => Promise.reject(new Error("not used")),
    compare: () => Promise.reject(new Error("not used")),
    rank: (_actor: unknown, companyIds: readonly string[], limit: number) => {
      scored.push([...companyIds]);
      // Best first: the reverse of name order.
      return Promise.resolve({
        kind: "OK" as const,
        comparison: {
          entries: [...companyIds]
            .reverse()
            .slice(0, limit)
            .map((companyId) => ({ companyId })),
        },
      });
    },
  } as never;

  it("scores every match and returns the best first, with how many matched", async () => {
    const seen: Seen = {};
    const outcome = await port({
      companyCatalog: many(seen),
      disclosure: everyoneVisible as never,
      fit,
    }).execute(
      {
        callId: "c1",
        name: "discover_companies",
        arguments: { sectors: ["fintech"], limit: 5, order: "FIT" },
      },
      contextFor(actorA, networkPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const data = (outcome.result as { data: Record<string, unknown> }).data;
    expect(data["order"]).toBe("FIT");
    expect(data["total"]).toBe(463);
    expect(data["totalAtLeast"]).toBe(false);
    const companies = data["companies"] as { companyId: string }[];
    // The 463rd by name, never cut by a first page or a batch, leads.
    expect(companies.map((c) => c.companyId)).toEqual(
      [...ids].reverse().slice(0, 5),
    );
    // Every match was scored, and the catalog was asked for all of them.
    expect(scored.at(-1)).toHaveLength(463);
    // F-82: the whole network (463 live), never the first 200 by name.
    expect(seen.query?.limit).toBeGreaterThanOrEqual(463);
  });

  it("name order stays name order, and a fit service that cannot rank falls back to it", async () => {
    const byName = await port({
      companyCatalog: many({}),
      disclosure: everyoneVisible as never,
      fit,
    }).execute(
      {
        callId: "c2",
        name: "discover_companies",
        arguments: { sectors: ["fintech"], limit: 3 },
      },
      contextFor(actorA, networkPlan),
    );
    const named = (byName.result as { data: Record<string, unknown> }).data;
    expect(named["order"]).toBe("NAME");
    expect(named["total"]).toBeUndefined();
    const noRank = await port({
      companyCatalog: many({}),
      disclosure: everyoneVisible as never,
      fit: { ...(fit as object), rank: undefined } as never,
    }).execute(
      {
        callId: "c3",
        name: "discover_companies",
        arguments: { sectors: ["fintech"], limit: 3, order: "FIT" },
      },
      contextFor(actorA, networkPlan),
    );
    expect(
      (noRank.result as { data: Record<string, unknown> }).data["order"],
    ).toBe("NAME");
  });
});

describe("DISCOVER_COMPANIES raising (F-10): only companies stating a current raise", () => {
  const ids = Array.from(
    { length: 60 },
    (_, i) => `e0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  );
  // Every seventh states a raise; the rest have none they may see.
  const stating = new Set(ids.filter((_, i) => i % 7 === 0));
  const everyoneVisible = {
    canDisclose: () => Promise.reject(new Error("not used")),
    evaluateMany: (requests: readonly { resource: unknown }[]) =>
      Promise.resolve(
        requests.map((request) => ({
          outcome: "ALLOW" as const,
          resource: request.resource,
          requestedAccess: "view" as const,
          grantedAccess: "view" as const,
          reasonCode: "NETWORK_VISIBLE" as const,
          via: { kind: "INTRINSIC" as const },
        })),
      ),
  };
  const catalog: CompanyCatalogPort = {
    find: () =>
      Promise.resolve({
        candidates: ids.map((companyId, i) => ({
          companyId,
          name: `Company ${String(i + 1).padStart(2, "0")}`,
          stageCode: "seed",
          headquartersCountry: "NG",
          shortDescription: null,
          sectors: ["Fintech"],
        })),
        sectors: [{ code: "fintech", name: "Fintech" }],
        unknownSectors: [],
      }),
  };
  const batches: number[] = [];
  const companyRaise = {
    raisesFor: (_actor: unknown, companyIds: readonly string[]) => {
      batches.push(companyIds.length);
      return Promise.resolve(
        new Map(
          companyIds.map((id) => [
            id,
            stating.has(id)
              ? {
                  source: "SHARED_OBJECTIVE",
                  money: { amount: "2000000", currency: "USD" },
                }
              : { source: "NONE", money: null },
          ]),
        ),
      );
    },
  } as never;

  it("keeps only the companies stating a raise, reads every match in batches, and counts both", async () => {
    batches.length = 0;
    const outcome = await port({
      companyCatalog: catalog,
      disclosure: everyoneVisible as never,
      companyRaise,
    }).execute(
      {
        callId: "r1",
        name: "discover_companies",
        arguments: { sectors: ["fintech"], limit: 24, raising: true },
      },
      contextFor(actorA, networkPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const data = (outcome.result as { data: Record<string, unknown> }).data;
    const companies = data["companies"] as { companyId: string }[];
    expect(companies.map((c) => c.companyId)).toEqual([...stating]);
    expect(data["total"]).toBe(stating.size);
    expect(data["raising"]).toEqual({ filter: "APPLIED", matched: 60 });
    expect(batches).toEqual([50, 10]);
  });

  it("raises that cannot be read keep and drop nothing, and say so", async () => {
    const outcome = await port({
      companyCatalog: catalog,
      disclosure: everyoneVisible as never,
      companyRaise: {
        raisesFor: () => Promise.reject(new Error("down")),
      } as never,
    }).execute(
      {
        callId: "r2",
        name: "discover_companies",
        arguments: { sectors: ["fintech"], limit: 5, raising: true },
      },
      contextFor(actorA, networkPlan),
    );
    const data = (outcome.result as { data: Record<string, unknown> }).data;
    expect((data["companies"] as unknown[]).length).toBe(5);
    expect(data["raising"]).toEqual({ filter: "UNAVAILABLE", matched: 60 });
  });
});
