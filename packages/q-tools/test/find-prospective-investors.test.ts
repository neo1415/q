import { describe, expect, it, vi } from "vitest";

import type { DiscoveryService } from "@capital-q/discovery";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
} from "../src/index.js";
import {
  closenessOf,
  judgeSector,
} from "../src/tools/find-prospective-investors.js";
import {
  actorA,
  actorB,
  COMPANY_A,
  COMPANY_B_NETWORK,
  contextFor,
  fakeMandates,
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

  it("Context Firewall: never reads an investor's private mandate for a founder (owner 2026-10-23)", async () => {
    const PRIVATE = "PRIVATE-MANDATE-THESIS-7f3c";
    const mandateRead = vi.fn(() =>
      Promise.reject(new Error(`mandate read: ${PRIVATE}`)),
    );
    const mandates = {
      findCanonicalInvestorMandate: mandateRead,
      getMandate: mandateRead,
      listActiveMandates: mandateRead,
    };
    const discovery = {
      sideFor: () => Promise.resolve("FOUNDER"),
      discoverCompanies: () => Promise.reject(new Error("not used")),
      discoverInvestors: () =>
        Promise.resolve({
          rankingVersion: "discovery.v1",
          items: [
            {
              investorOrganisationId: LONDON_ANGEL,
              displayName: "Thames Angels",
              investorType: "ANGEL",
              hqCountry: "GB",
              publicDescription: "Early cheques for UK founders.",
              websiteUrl: null,
              deploymentState: "ACTIVELY_INVESTING",
            },
          ],
          notes: ["RANKED_ON_DECLARED_PROFILE_ONLY"],
          nextCursor: null,
        }),
    } as unknown as DiscoveryService;
    const port = createQToolExecutor({
      registry: createQToolRegistry(
        createDefaultQTools(
          fakePorts({
            discovery,
            mandates: mandates as unknown as ReturnType<typeof fakeMandates>,
          }),
        ),
      ),
    });
    const outcome = await port.execute(
      call({ companyId: COMPANY_A }),
      contextFor(actorA, founderPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(mandateRead).not.toHaveBeenCalled();
    expect(JSON.stringify(outcome)).not.toContain(PRIVATE);
    expect(JSON.stringify(outcome)).toContain(
      "no investor's private mandate is read",
    );
  });

  it("ranks a published sector match over a fintech fund for a water company (owner 2026-10-23, Maji Loop)", async () => {
    // Profile ranking alone puts the fintech fund first (same country,
    // stage, deploying); their published gates say whose sector it is.
    const FINTECH = LONDON_ANGEL;
    const CLIMATE = NAIROBI_VC;
    const gate = (
      investorOrganisationId: string,
      label: string,
      standing: "MET" | "NOT_MET",
    ) => ({
      investorOrganisationId,
      publicId: `g-${investorOrganisationId.slice(0, 4)}`,
      title: "Gate",
      acceptingApplications: true,
      criteria: [
        {
          label,
          requiredness: "REQUIRED" as const,
          dimension: "TAXONOMY" as const,
          standing,
        },
        {
          label: "Seed",
          requiredness: "REQUIRED" as const,
          dimension: "STAGE" as const,
          standing: "MET" as const,
        },
      ],
    });
    const forOwnCompany = vi.fn(() =>
      Promise.resolve([
        gate(FINTECH, "Fintech", "NOT_MET"),
        gate(CLIMATE, "Clean energy; energy access", "MET"),
      ]),
    );
    const discovery = {
      sideFor: () => Promise.resolve("FOUNDER"),
      discoverCompanies: () => Promise.reject(new Error("not used")),
      discoverInvestors: () =>
        Promise.resolve({
          rankingVersion: "discovery.v1",
          items: [
            {
              investorOrganisationId: FINTECH,
              displayName: "Savanna Seed Partners",
              investorType: "VC",
              hqCountry: "GB",
              publicDescription: null,
              websiteUrl: null,
              deploymentState: "ACTIVELY_INVESTING",
            },
            {
              investorOrganisationId: CLIMATE,
              displayName: "Pan-African Climate Development Fund",
              investorType: "DFI",
              hqCountry: "KE",
              publicDescription: null,
              websiteUrl: null,
              deploymentState: "ACTIVELY_INVESTING",
            },
          ],
          notes: [],
          nextCursor: null,
        }),
    } as unknown as DiscoveryService;
    const port = createQToolExecutor({
      registry: createQToolRegistry(
        createDefaultQTools(
          fakePorts({ discovery, investorGates: { forOwnCompany } }),
        ),
      ),
    });
    const outcome = await port.execute(
      call({ companyId: COMPANY_A }),
      contextFor(actorA, founderPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const data = (
      outcome.result as {
        data: {
          prospects: {
            name: string;
            sector?: { fit: string; focus: string | null };
          }[];
        };
      }
    ).data;
    expect(data.prospects.map((p) => [p.name, p.sector?.fit])).toEqual([
      ["Pan-African Climate Development Fund", "MATCH"],
      ["Savanna Seed Partners", "MISMATCH"],
    ]);
    expect(data.prospects[1]?.sector?.focus).toBe("Fintech");
    // Gates are read for every candidate before the list is cut.
    expect(forOwnCompany).toHaveBeenCalledWith(actorA, COMPANY_A, [
      FINTECH,
      CLIMATE,
    ]);
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

/**
 * Owner 2026-10-23: the sectors investors publish on their Q Card (as a
 * participant sees them) and on their gate, against the company's own
 * declared sectors; a related sector is never called the same one.
 */
describe("published sector, exact or close", () => {
  // Maji Loop: classified clean energy and energy access (both under energy).
  const CLEAN = {
    code: "clean_energy",
    name: "Clean Energy",
    parent: "energy",
  };
  const ACCESS = {
    code: "energy_access",
    name: "Energy Access",
    parent: "energy",
  };
  const MAJI = [CLEAN, ACCESS];
  const FINTECH = {
    code: "fintech",
    name: "Fintech",
    parent: "financial_services",
  };
  const ENERGY = { code: "energy", name: "Energy", parent: null };
  const WATER = { code: null, name: "Water", parent: null };
  const resolve = (names: readonly string[]) =>
    names.map((name) =>
      /clean energy/iu.test(name)
        ? CLEAN
        : /energy access/iu.test(name)
          ? ACCESS
          : { code: null, name, parent: null },
    );

  it("tells an exact sector from a related one, and from none", () => {
    expect(closenessOf([CLEAN], MAJI)).toBe("EXACT");
    expect(closenessOf([ENERGY], MAJI)).toBe("ADJACENT");
    expect(closenessOf([FINTECH], MAJI)).toBeNull();
    expect(closenessOf([WATER], MAJI)).toBeNull();
  });

  it("reads a published card: fintech is a mismatch, energy is close, an unknown name is not known", () => {
    const judge = (
      card:
        | typeof MAJI
        | readonly (typeof FINTECH | typeof ENERGY | typeof WATER)[],
    ) => judgeSector({ gate: undefined, card, company: MAJI, resolve });
    expect(judge([FINTECH])).toMatchObject({
      fit: "MISMATCH",
      focus: "Fintech",
      source: "CARD",
    });
    expect(judge([ENERGY])).toMatchObject({
      fit: "MATCH",
      closeness: "ADJACENT",
      source: "CARD",
    });
    expect(judge([CLEAN])).toMatchObject({
      fit: "MATCH",
      closeness: "EXACT",
    });
    expect(judge([WATER])).toMatchObject({ fit: "UNKNOWN", focus: "Water" });
    // Without the company's own sectors nothing is judged against it.
    expect(
      judgeSector({ gate: undefined, card: [FINTECH], company: [], resolve })
        .fit,
    ).toBe("UNKNOWN");
  });

  it("lets a published gate decide over the card, and says how close its rule is", () => {
    const gate = {
      investorOrganisationId: LONDON_ANGEL,
      publicId: "g",
      title: "Gate",
      acceptingApplications: true,
      criteria: [
        {
          label: "Clean energy; energy access",
          requiredness: "REQUIRED" as const,
          dimension: "TAXONOMY" as const,
          standing: "MET" as const,
        },
      ],
    };
    expect(
      judgeSector({ gate, card: [FINTECH], company: MAJI, resolve }),
    ).toMatchObject({
      fit: "MATCH",
      closeness: "EXACT",
      source: "GATE",
      yours: ["Clean Energy", "Energy Access"],
    });
  });

  it("ranks by the card when there is no gate: close above unknown, fintech last", async () => {
    const discovery = {
      sideFor: () => Promise.resolve("FOUNDER"),
      discoverCompanies: () => Promise.reject(new Error("not used")),
      discoverInvestors: () =>
        Promise.resolve({
          rankingVersion: "discovery.v1",
          items: [LONDON_ANGEL, NAIROBI_VC, QUIET].map((id, at) => ({
            investorOrganisationId: id,
            displayName: ["Fintech Fund", "Energy Fund", "Quiet Fund"][at],
            investorType: "VC",
            hqCountry: "GB",
            publicDescription: null,
            websiteUrl: null,
            deploymentState: "ACTIVELY_INVESTING",
          })),
          notes: [],
          nextCursor: null,
        }),
    } as unknown as DiscoveryService;
    const forOwnCompany = vi.fn(() =>
      Promise.resolve({
        company: MAJI,
        investors: [
          { investorOrganisationId: LONDON_ANGEL, sectors: [FINTECH] },
          { investorOrganisationId: NAIROBI_VC, sectors: [ENERGY] },
        ],
      }),
    );
    const port = createQToolExecutor({
      registry: createQToolRegistry(
        createDefaultQTools(
          fakePorts({
            discovery,
            investorSectorFocus: { forOwnCompany, resolve },
          }),
        ),
      ),
    });
    const outcome = await port.execute(
      call({ companyId: COMPANY_A }),
      contextFor(actorA, founderPlan),
    );
    const data = (
      outcome.result as {
        data: {
          prospects: {
            name: string;
            sector?: { fit: string; closeness?: string | null };
          }[];
        };
      }
    ).data;
    expect(
      data.prospects.map((p) => [
        p.name,
        p.sector?.fit ?? "UNKNOWN",
        p.sector?.closeness ?? null,
      ]),
    ).toEqual([
      ["Energy Fund", "MATCH", "ADJACENT"],
      ["Quiet Fund", "UNKNOWN", null],
      ["Fintech Fund", "MISMATCH", null],
    ]);
    // Only for their own company, with every candidate's id.
    expect(forOwnCompany).toHaveBeenCalledTimes(1);
    const [actor, companyId, ids] = forOwnCompany.mock.calls[0] as unknown as [
      unknown,
      string,
      string[],
    ];
    expect([actor, companyId]).toEqual([actorA, COMPANY_A]);
    expect([...ids].sort()).toEqual([LONDON_ANGEL, NAIROBI_VC, QUIET].sort());
  });
});
