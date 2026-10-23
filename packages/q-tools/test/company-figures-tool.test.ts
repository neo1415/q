import { describe, expect, it } from "vitest";

import {
  createDefaultQTools,
  createQToolExecutor,
  createQToolRegistry,
  shapeCompanyFigures,
} from "../src/index.js";
import type {
  CompanyFigure,
  CompanyFigureScope,
  CompanyFiguresPort,
} from "../src/ports.js";
import {
  actorA,
  COMPANY_A,
  COMPANY_B_NETWORK,
  COMPANY_B_PRIVATE,
  contextFor,
  fakePorts,
  MARKERS,
  planFor,
  TENANT_A,
  TENANT_B,
} from "./support.js";

/**
 * read_company_figures (owner 2026-10-23): a company's published figures
 * for Q, admitted exactly as get_company admits the company, and never
 * more than the company published (network_visible / public_external, no
 * more sensitive than the grant), whatever the port hands back.
 */

const figure = (over: Partial<CompanyFigure>): CompanyFigure => ({
  claimKey: "financial.monthly_revenue",
  statement:
    "Monthly recurring revenue was USD 4,800 in September 2026. (Demonstration data, self-reported by the company.)",
  structuredValue: { kind: "MONEY", amount: "4800", currency: "USD" },
  validFrom: "2026-09-30",
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  lifecycleStatus: "CURRENT",
  visibilityScope: "network_visible",
  sensitivityClass: "PUBLIC",
  ...over,
});

/** A port that also returns rows it was not asked for: the tool must drop them. */
function fakeFigures(rows: readonly CompanyFigure[]) {
  const calls: {
    tenantId: string;
    companyId: string;
    scopes: readonly CompanyFigureScope[];
  }[] = [];
  const port: CompanyFiguresPort = {
    current: (company, scopes) => {
      calls.push({ ...company, scopes });
      return Promise.resolve(rows);
    },
  };
  return { port, calls };
}

const LEAKY: readonly CompanyFigure[] = [
  figure({}),
  figure({
    claimKey: "financial.burn",
    statement: `Burn ${MARKERS.founder}`,
    visibilityScope: "organisation_private",
    sensitivityClass: "CONFIDENTIAL",
  }),
  figure({
    claimKey: "financial.runway",
    statement: `Runway ${MARKERS.founder}`,
    visibilityScope: "founder_private",
    sensitivityClass: "PUBLIC",
  }),
  // Revoked or withdrawn: history, never today's figure.
  figure({
    claimKey: "financial.arr",
    statement: `Old ARR ${MARKERS.investor}`,
    lifecycleStatus: "SUPERSEDED",
  }),
  figure({
    claimKey: "traction.growth",
    statement: `Withdrawn growth ${MARKERS.investor}`,
    lifecycleStatus: "DISPUTED",
  }),
  // Shared with one relationship only: never through this tool.
  figure({
    claimKey: "customers.paying_accounts",
    statement: `Relationship ${MARKERS.crossTenant}`,
    visibilityScope: "relationship_shared",
  }),
  figure({
    claimKey: "financial.cash",
    statement: `Cash ${MARKERS.founder}`,
    visibilityScope: "network_visible",
    sensitivityClass: "CONFIDENTIAL",
  }),
];

function executor(port?: CompanyFiguresPort) {
  const ports = fakePorts(port === undefined ? {} : { companyFigures: port });
  return createQToolExecutor({
    registry: createQToolRegistry(createDefaultQTools(ports)),
  });
}

const ownCompanyPlan = planFor(actorA, "OWN_COMPANY_QUESTION", [
  { kind: "COMPANY_PROFILE", sensitivity: "INTERNAL", companyId: COMPANY_A },
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
]);

const call = (companyId: string) => ({
  callId: "c1",
  name: "read_company_figures",
  arguments: { companyId },
});

describe("read_company_figures", () => {
  it("reads a network-visible company's published figures in that company's tenant", async () => {
    const { port, calls } = fakeFigures(LEAKY);
    const outcome = await executor(port).execute(
      call(COMPANY_B_NETWORK),
      contextFor(actorA, ownCompanyPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.sensitivity).toBe("NETWORK_VISIBLE");
    expect(calls).toEqual([
      {
        tenantId: TENANT_B,
        companyId: COMPANY_B_NETWORK,
        scopes: ["network_visible", "public_external"],
      },
    ]);
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        companyId: COMPANY_B_NETWORK,
        status: "AVAILABLE",
        figures: [
          {
            key: "financial.monthly_revenue",
            asOf: "2026-09-30",
            truthClass: "USER_CLAIM",
            evidenceStatus: "SELF_REPORTED",
            lifecycleStatus: "CURRENT",
          },
        ],
      },
    });
    // Private, founder-private, over-sensitive, superseded, disputed and
    // relationship-only rows never leave the tool.
    const text = JSON.stringify(outcome);
    expect(text).not.toContain(MARKERS.founder);
    expect(text).not.toContain(MARKERS.investor);
    expect(text).not.toContain(MARKERS.crossTenant);
  });

  it("denies a private company with the one enumeration-safe answer, without reading figures", async () => {
    const { port, calls } = fakeFigures(LEAKY);
    const hidden = await executor(port).execute(
      call(COMPANY_B_PRIVATE),
      contextFor(actorA, ownCompanyPlan),
    );
    expect(hidden.status).toBe("DENIED");
    expect(hidden.failureCode).toBe("NOT_AVAILABLE");
    const absent = await executor(port).execute(
      call("00000000-0000-4000-8000-000000000000"),
      contextFor(actorA, ownCompanyPlan),
    );
    expect(absent.result).toEqual(hidden.result);
    expect(calls).toEqual([]);
  });

  it("gives the owner the figures investors see, never its private ones", async () => {
    const { port, calls } = fakeFigures(LEAKY);
    const outcome = await executor(port).execute(
      call(COMPANY_A),
      contextFor(actorA, ownCompanyPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(calls[0]).toMatchObject({
      tenantId: TENANT_A,
      scopes: ["network_visible", "public_external"],
    });
    expect(JSON.stringify(outcome)).not.toContain(MARKERS.founder);
  });

  it("does not reach a subject company whose profile the plan did not admit", async () => {
    const { port, calls } = fakeFigures(LEAKY);
    const plan = planFor(actorA, "OWN_COMPANY_QUESTION", [
      { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
    ]);
    const outcome = await executor(port).execute(call(COMPANY_A), {
      ...contextFor(actorA, plan),
      plan: {
        ...plan,
        subjects: [{ kind: "COMPANY", companyId: COMPANY_A }],
      },
    });
    expect(outcome.failureCode).toBe("NOT_AVAILABLE");
    expect(calls).toEqual([]);
  });

  it("says NONE, not zero, when the company published nothing", async () => {
    const { port } = fakeFigures([]);
    const outcome = await executor(port).execute(
      call(COMPANY_B_NETWORK),
      contextFor(actorA, ownCompanyPlan),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "NONE", figures: [] },
    });
  });

  it("is not offered without a figures port", () => {
    const names = createDefaultQTools(fakePorts()).map((t) => t.providerName);
    expect(names).not.toContain("read_company_figures");
    const withPort = createDefaultQTools(
      fakePorts({ companyFigures: fakeFigures([]).port }),
    ).map((t) => t.providerName);
    expect(withPort).toContain("read_company_figures");
  });

  it("never returns a founder_private claim to an investor", async () => {
    const { port } = fakeFigures([
      figure({
        claimKey: "financial.runway",
        statement: `Runway ${MARKERS.founder}`,
        visibilityScope: "founder_private",
      }),
    ]);
    const outcome = await executor(port).execute(
      call(COMPANY_B_NETWORK),
      contextFor(actorA, ownCompanyPlan),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      data: { status: "NONE", figures: [] },
    });
    expect(JSON.stringify(outcome)).not.toContain(MARKERS.founder);
  });

  it("never returns another tenant's private claim, whether the company is private or not", async () => {
    const { port, calls } = fakeFigures([
      figure({
        statement: `Private ${MARKERS.crossTenant}`,
        visibilityScope: "organisation_private",
        sensitivityClass: "CONFIDENTIAL",
      }),
    ]);
    const visible = await executor(port).execute(
      call(COMPANY_B_NETWORK),
      contextFor(actorA, ownCompanyPlan),
    );
    expect(JSON.stringify(visible)).not.toContain(MARKERS.crossTenant);
    const privateCompany = await executor(port).execute(
      call(COMPANY_B_PRIVATE),
      contextFor(actorA, ownCompanyPlan),
    );
    expect(privateCompany.failureCode).toBe("NOT_AVAILABLE");
    // The port is only ever asked for the published scopes.
    for (const c of calls) {
      expect(c.scopes).toEqual(["network_visible", "public_external"]);
    }
  });

  it("never returns a revoked, withdrawn or superseded claim", () => {
    const shaped = shapeCompanyFigures(
      COMPANY_B_NETWORK,
      ["SUPERSEDED", "DISPUTED", "CONTRADICTORY", "STALE", "HISTORICAL"].map(
        (lifecycleStatus) =>
          figure({ claimKey: lifecycleStatus, lifecycleStatus }),
      ),
      ["network_visible", "public_external"],
      "NETWORK_VISIBLE",
    );
    expect(shaped).toMatchObject({ status: "NONE", figures: [] });
  });

  it("keeps a PUBLIC grant to PUBLIC-sensitivity claims", () => {
    const shaped = shapeCompanyFigures(
      COMPANY_B_NETWORK,
      [
        figure({ claimKey: "a", sensitivityClass: "PUBLIC" }),
        figure({ claimKey: "b", sensitivityClass: "NETWORK_VISIBLE" }),
        figure({ claimKey: "c", visibilityScope: "relationship_shared" }),
      ],
      ["network_visible", "public_external"],
      "PUBLIC",
    );
    expect(shaped.figures.map((f) => f.key)).toEqual(["a"]);
  });
});
