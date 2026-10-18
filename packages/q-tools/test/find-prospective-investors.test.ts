import { describe, expect, it } from "vitest";

import type { DiscoveryService } from "@capital-q/discovery";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
} from "../src/index.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  COMPANY_B_NETWORK,
  contextFor,
  fakePorts,
  MARKERS,
  planFor,
} from "./support.js";

/**
 * "Which investors would likely invest in X?" (acceptance directive E):
 * prospects from network-visible declared investor profiles, with
 * deterministic reasons, labelled likely fit — never a mandate, never
 * interest, and unknowns never counted against anybody.
 */

const LONDON_ANGEL = "11000000-0000-4000-8000-000000000001";
const NAIROBI_VC = "12000000-0000-4000-8000-000000000002";
const QUIET = "13000000-0000-4000-8000-000000000003";

function withNetwork(
  items: readonly Record<string, unknown>[] = [
    {
      investorOrganisationId: LONDON_ANGEL,
      displayName: "Thames Angels",
      investorType: "ANGEL",
      hqCountry: "GB",
      publicDescription: "Early cheques for UK founders.",
      websiteUrl: null,
      deploymentState: "ACTIVELY_INVESTING",
    },
    {
      investorOrganisationId: NAIROBI_VC,
      displayName: "Rift Valley Ventures",
      investorType: "VC",
      hqCountry: "KE",
      publicDescription: "East African seed and Series A.",
      websiteUrl: null,
      deploymentState: "SELECTIVE",
    },
    {
      // Nothing declared: not a prospect, and not ranked low either.
      investorOrganisationId: QUIET,
      displayName: "Quiet Capital",
      investorType: "OTHER",
      hqCountry: null,
      publicDescription: null,
      websiteUrl: null,
      deploymentState: null,
    },
  ],
) {
  const calls: unknown[] = [];
  const discovery = {
    sideFor: () => Promise.resolve("FOUNDER"),
    discoverCompanies: () => Promise.reject(new Error("not used")),
    discoverInvestors: (query: unknown) => {
      calls.push(query);
      return Promise.resolve({
        rankingVersion: "discovery.v1",
        items,
        notes: ["RANKED_ON_DECLARED_PROFILE_ONLY"],
        nextCursor: null,
      });
    },
  } as unknown as DiscoveryService;
  const ports = fakePorts({ discovery });
  const port = createQToolExecutor({
    registry: createQToolRegistry(createDefaultQTools(ports)),
  });
  return { port, calls };
}

const founderPlan = planFor(actorA, "OWN_COMPANY_QUESTION", [
  { kind: "COMPANY_PROFILE", sensitivity: "INTERNAL", companyId: COMPANY_A },
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
]);

const call = (args: Record<string, unknown>) => ({
  callId: "p1",
  name: "find_prospective_investors",
  arguments: args,
});

type Prospect = {
  name: string;
  reasons: { kind: string; detail: string }[];
  label: string;
};

describe("find_prospective_investors", () => {
  it("ranks a founder's own company against network-visible profiles, with reasons, labelled likely fit", async () => {
    const { port } = withNetwork();
    const outcome = await port.execute(
      call({ companyId: COMPANY_A }),
      contextFor(actorA, founderPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const data = (
      outcome.result as {
        data: {
          companySource: string;
          compared: unknown;
          prospects: Prospect[];
          notes: string[];
        };
      }
    ).data;
    // Company A is a GB seed company on its own record.
    expect(data.companySource).toBe("CAPITAL_Q_RECORD");
    expect(data.compared).toEqual({ countryCode: "GB", stageCode: "seed" });
    expect(data.prospects.map((p) => p.name)).toEqual([
      "Thames Angels",
      "Rift Valley Ventures",
    ]);
    expect(data.prospects[0]?.reasons.map((r) => r.kind)).toEqual([
      "SAME_COUNTRY",
      "TYPICAL_STAGE",
      "DEPLOYING",
    ]);
    for (const prospect of data.prospects) {
      expect(prospect.label).toBe("likely fit, not evidence of interest");
    }
    expect(data.notes.join(" ")).toContain("not evidence of interest");
    // Nothing of the company's private description travelled.
    expect(JSON.stringify(outcome)).not.toContain(MARKERS.founder);
  });

  it("compares a public company on what the conversation cited, and never counts the unknown against anyone", async () => {
    const { port } = withNetwork();
    const outcome = await port.execute(
      call({ company: { name: "Zino Aviation", countryCode: "ke" } }),
      contextFor(
        actorB,
        planFor(actorB, "GENERAL_QUESTION", [
          { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
        ]),
      ),
    );
    const data = (
      outcome.result as {
        data: { companySource: string; prospects: Prospect[] };
      }
    ).data;
    expect(data.companySource).toBe("CONVERSATION");
    // Stage unknown: no stage reason for anyone, and nobody dropped for it.
    expect(data.prospects.map((p) => p.name)).toEqual([
      "Rift Valley Ventures",
      "Thames Angels",
    ]);
    expect(
      data.prospects.flatMap((p) => p.reasons.map((r) => r.kind)),
    ).not.toContain("TYPICAL_STAGE");
  });

  it("never reads a company the actor does not own as a record", async () => {
    const { port } = withNetwork();
    const outcome = await port.execute(
      call({ companyId: COMPANY_B_NETWORK }),
      contextFor(actorA, founderPlan),
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.failureCode).toBe("NOT_AVAILABLE");
  });

  it("is not offered without the network scope", async () => {
    const { port, calls } = withNetwork();
    const plan = planFor(actorA, "OWN_COMPANY_QUESTION", [
      {
        kind: "COMPANY_PROFILE",
        sensitivity: "INTERNAL",
        companyId: COMPANY_A,
      },
    ]);
    const offered = await port.offer(contextFor(actorA, plan));
    expect(offered.map((tool) => tool.definition.name)).not.toContain(
      "find_prospective_investors",
    );
    const outcome = await port.execute(
      call({ companyId: COMPANY_A }),
      contextFor(actorA, plan),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
    expect(calls).toHaveLength(0);
  });
});
