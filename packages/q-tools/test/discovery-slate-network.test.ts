import { describe, expect, it } from "vitest";

import type { CompanySearchCandidate } from "@capital-q/companies";
import type { DiscoveryService } from "@capital-q/discovery";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  type InvestorFeedPort,
} from "../src/index.js";
import {
  actorA,
  COMPANY_B_NETWORK,
  COMPANY_B_PRIVATE,
  contextFor,
  fakeCompanies,
  fakePorts,
  MARKERS,
  planFor,
  PROFILES,
} from "./support.js";

/**
 * An investor asking for founders who might be interested, with nothing in
 * their feed, gets the network's visible companies and the instruction to
 * add cited public research — never a dead end (founder live 2026-09-27,
 * #8). Disclosure still decides each company: nothing organisation-private
 * or founder-private reaches the investor (Context Firewall).
 */

const plan = planFor(actorA, "INVESTOR_QUESTION", [
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
]);

function slate(options: {
  readonly feedItems?: number;
  readonly passed?: readonly string[];
  /** Classification returns a private company too; disclosure must drop it. */
  readonly leakyClassification?: boolean;
  readonly withFeed?: boolean;
}) {
  const discovery = {
    sideFor: () => Promise.resolve("INVESTOR"),
    discoverCompanies: () =>
      Promise.resolve({
        rankingVersion: "x",
        items: [],
        notes: ["NO_ELIGIBLE_COMPANIES"],
        nextCursor: null,
      }),
    discoverInvestors: () => Promise.reject(new Error("not an investor call")),
  } as unknown as DiscoveryService;
  const investorFeed: InvestorFeedPort = {
    page: () =>
      Promise.resolve({
        items: Array.from({ length: options.feedItems ?? 0 }, () => ({
          companyId: COMPANY_B_NETWORK,
          name: "Beacon Analytics",
          stageCode: null,
          headquartersCountry: null,
          shortDescription: null,
          websiteUrl: null,
          reasonCodes: [],
        })),
        notes: [],
      }),
    decisions: () =>
      Promise.resolve(
        (options.passed ?? []).map((companyId) => ({
          companyId,
          name: "Beacon Analytics",
          stageCode: null,
          headquartersCountry: null,
          decision: "PASSED" as const,
        })),
      ),
  };
  const base = fakeCompanies();
  const companies =
    options.leakyClassification === true
      ? {
          ...base,
          searchCompanies: () =>
            Promise.resolve({
              items: PROFILES.map((p): CompanySearchCandidate => ({
                id: p.id,
                tenantId: p.tenantId,
                organisationId: p.organisationId,
                canonicalName: p.canonicalName,
                currentStageCode: p.currentStageCode,
                headquartersCountry: p.headquartersCountry,
                shortDescription: p.primaryDescription,
                marketplaceVisibility: p.marketplaceVisibility,
                ownedByViewer: false,
              })),
              nextCursor: null,
            }),
        }
      : base;
  const ports = fakePorts({
    discovery,
    companies,
    ...(options.withFeed === false ? {} : { investorFeed }),
  });
  const port = createQToolExecutor({
    registry: createQToolRegistry(createDefaultQTools(ports)),
  });
  return async () => {
    const outcome = await port.execute(
      { callId: "c1", name: "discovery_slate", arguments: {} },
      contextFor(actorA, plan),
    );
    if (!outcome.result.ok) throw new Error("expected a result");
    return outcome.result.data as {
      companies: unknown[];
      network: {
        companies: { companyId: string; name: string }[];
        guidance: string;
      } | null;
    };
  };
}

describe("discovery.slate · an empty investor feed falls back to the network", () => {
  it("returns network-visible companies with guidance to add cited public research, on both feed paths", async () => {
    for (const withFeed of [true, false]) {
      const data = await slate({ withFeed })();
      expect(data.companies, String(withFeed)).toEqual([]);
      expect(
        data.network?.companies.map((c) => c.companyId),
        String(withFeed),
      ).toEqual([COMPANY_B_NETWORK]);
      expect(data.network?.guidance).toMatch(/research_public_web/);
      expect(data.network?.guidance).toMatch(/not recommendations/);
    }
  });

  it("adds nothing when the feed has companies, and leaves out companies they passed on", async () => {
    expect((await slate({ feedItems: 1 })()).network).toBeNull();
    const passed = await slate({ passed: [COMPANY_B_NETWORK] })();
    expect(passed.network?.companies).toEqual([]);
  });

  it("never lets an organisation-private or founder-private company through, even when classification offers one", async () => {
    const data = await slate({ leakyClassification: true })();
    const ids = data.network?.companies.map((c) => c.companyId) ?? [];
    expect(ids).toEqual([COMPANY_B_NETWORK]);
    expect(ids).not.toContain(COMPANY_B_PRIVATE);
    const text = JSON.stringify(data);
    expect(text).not.toContain(MARKERS.founder);
    expect(text).not.toContain(MARKERS.crossTenant);
    expect(text).not.toContain("Hidden Ltd");
  });
});
