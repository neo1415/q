import { describe, expect, it } from "vitest";

import type { DiscoveryService } from "@capital-q/discovery";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type InvestorFeedPort,
} from "../src/index.js";
import { actorB, contextFor, fakePorts, planFor } from "./support.js";

/**
 * An investor's "which company should I look at first, and skip the one I
 * passed on" is answered from their own feed (CQ-QACT-001, ACC round 1b).
 *
 * Live, Q recommended a company that was visible but not marketplace-ready
 * — never in the investor's feed — from a network listing, and said they
 * had passed on "Synthetic demo" when two companies share that name and
 * they had saved one and passed the other. The slate tool now reads the
 * feed itself, and returns decisions by company id.
 */

const READY = "c1000000-0000-4000-8000-000000000001";
const DEMO_SAVED = "c2000000-0000-4000-8000-000000000002";
const DEMO_PASSED = "c3000000-0000-4000-8000-000000000003";

const plan = planFor(actorB, "INVESTOR_QUESTION", [
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
]);

function withFeed() {
  const calls = { network: 0, feed: 0 };
  const discovery = {
    sideFor: () => Promise.resolve("INVESTOR"),
    // The listing that bypasses readiness: it must not be what Q reads.
    discoverCompanies: () => {
      calls.network += 1;
      return Promise.resolve({
        rankingVersion: "x",
        items: [],
        notes: [],
        nextCursor: null,
      });
    },
    discoverInvestors: () => Promise.reject(new Error("not an investor call")),
  } as unknown as DiscoveryService;
  const investorFeed: InvestorFeedPort = {
    page: () => {
      calls.feed += 1;
      return Promise.resolve({
        items: [
          {
            companyId: READY,
            name: "Kobo Ready",
            stageCode: "seed",
            headquartersCountry: "NG",
            shortDescription: "Logistics",
            websiteUrl: null,
            reasonCodes: ["STAGE_ALIGNED"],
          },
        ],
        notes: [],
      });
    },
    decisions: () =>
      Promise.resolve([
        {
          companyId: DEMO_PASSED,
          name: "Synthetic demo",
          stageCode: "pre_seed",
          headquartersCountry: "GB",
          decision: "PASSED" as const,
        },
        {
          companyId: DEMO_SAVED,
          name: "Synthetic demo",
          stageCode: "seed",
          headquartersCountry: "NG",
          decision: "SAVED" as const,
        },
      ]),
  };
  const ports = fakePorts({ discovery, investorFeed });
  return {
    calls,
    port: createQToolExecutor({
      registry: createQToolRegistry(createDefaultQTools(ports)),
    }),
  };
}

describe("discovery.slate for an investor", () => {
  it("reads the investor's own feed, never the network listing, and returns their decisions by company id", async () => {
    const { port, calls } = withFeed();
    const outcome = await port.execute(
      { callId: "c1", name: "discovery_slate", arguments: {} },
      contextFor(actorB, plan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    if (!outcome.result.ok) throw new Error("expected a result");
    const data = outcome.result.data as {
      companies: { companyId: string; reasons: { kind: string }[] }[];
      decisions: { companyId: string; name: string; decision: string }[];
    };
    expect(calls).toEqual({ network: 0, feed: 1 });
    expect(data.companies.map((c) => c.companyId)).toEqual([READY]);
    expect(data.companies[0]?.reasons[0]?.kind).toBe("STAGE_ALIGNED");
    // Two companies share a name; each decision is about exactly one.
    expect(data.decisions).toEqual([
      expect.objectContaining({
        companyId: DEMO_PASSED,
        name: "Synthetic demo",
        decision: "PASSED",
      }),
      expect.objectContaining({
        companyId: DEMO_SAVED,
        name: "Synthetic demo",
        decision: "SAVED",
      }),
    ]);
    // A passed company is never offered as something to look at.
    expect(data.companies.map((c) => c.companyId)).not.toContain(DEMO_PASSED);
  });
});
