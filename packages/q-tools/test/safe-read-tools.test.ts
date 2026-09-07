import { describe, expect, it } from "vitest";

import { CompanySearchCursorError } from "@capital-q/companies";

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
  COMPANY_B_PRIVATE,
  contextFor,
  fakeAuthorization,
  fakeCompanies,
  fakePorts,
  INVESTOR_B,
  MANDATE_B,
  MARKERS,
  planFor,
  type QToolPortsOverrides,
} from "./support.js";

/**
 * The four Safe Read tools against fake ports (packet §97-§100): the
 * authorization paths each tool takes, and the paths none of them may
 * take. Real ports are proven in tools.integration.test.ts.
 */

function port(overrides: QToolPortsOverrides = {}) {
  const ports = fakePorts(overrides);
  return {
    ports,
    port: createQToolExecutor({
      registry: createQToolRegistry(createDefaultQTools(ports)),
    }),
  };
}

const ownCompanyPlan = planFor(actorA, "OWN_COMPANY_QUESTION", [
  { kind: "COMPANY_PROFILE", sensitivity: "INTERNAL", companyId: COMPANY_A },
  {
    kind: "COMPANY_CAPITAL_OBJECTIVE",
    sensitivity: "CONFIDENTIAL",
    companyId: COMPANY_A,
  },
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
]);

const investorPlan = planFor(actorB, "INVESTOR_QUESTION", [
  {
    kind: "INVESTOR_MANDATE",
    sensitivity: "CONFIDENTIAL",
    investorOrganisationId: INVESTOR_B,
  },
  { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
]);

describe("GET_COMPANY", () => {
  it("serves the owner through the capability layer at the plan's sensitivity", async () => {
    const { port: p, ports } = port();
    const outcome = await p.execute(
      {
        callId: "c1",
        name: "get_company",
        arguments: { companyId: COMPANY_A },
      },
      contextFor(actorA, ownCompanyPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.sensitivity).toBe("INTERNAL");
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        companyId: COMPANY_A,
        canonicalName: "Alpha Robotics",
        relationToYou: "OWN",
        truthClass: "USER_CLAIM",
      },
    });
    expect(
      (ports.authorization as ReturnType<typeof fakeAuthorization>).calls,
    ).toEqual(["company.view"]);
  });

  it("denies the owner when the capability is missing, with the one enumeration-safe answer", async () => {
    const { port: p } = port({
      authorization: fakeAuthorization({ denyAll: true }),
    });
    const outcome = await p.execute(
      {
        callId: "c1",
        name: "get_company",
        arguments: { companyId: COMPANY_A },
      },
      contextFor(actorA, ownCompanyPlan),
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.failureCode).toBe("NOT_AVAILABLE");
    expect(JSON.stringify(outcome)).not.toContain(MARKERS.founder);
  });

  it("serves a network-visible company only under the actor-wide scope, and never a private one", async () => {
    const { port: p } = port();
    const visible = await p.execute(
      {
        callId: "c1",
        name: "get_company",
        arguments: { companyId: COMPANY_B_NETWORK },
      },
      contextFor(actorA, ownCompanyPlan),
    );
    expect(visible.status).toBe("SUCCEEDED");
    expect(visible.sensitivity).toBe("NETWORK_VISIBLE");
    expect(visible.result).toMatchObject({
      ok: true,
      data: { canonicalName: "Beacon Analytics", relationToYou: "SHARED" },
    });

    const hidden = await p.execute(
      {
        callId: "c2",
        name: "get_company",
        arguments: { companyId: COMPANY_B_PRIVATE },
      },
      contextFor(actorA, ownCompanyPlan),
    );
    expect(hidden.status).toBe("DENIED");
    expect(hidden.failureCode).toBe("NOT_AVAILABLE");
    expect(JSON.stringify(hidden)).not.toContain(MARKERS.crossTenant);

    const absent = await p.execute(
      {
        callId: "c3",
        name: "get_company",
        arguments: { companyId: "00000000-0000-4000-8000-000000000000" },
      },
      contextFor(actorA, ownCompanyPlan),
    );
    expect(absent.failureCode).toBe("NOT_AVAILABLE");
    expect(absent.result).toEqual(hidden.result);
  });

  it("does not reach a subject company whose profile the plan did not admit", async () => {
    const { port: p } = port();
    const plan = planFor(actorA, "OWN_COMPANY_QUESTION", [
      {
        kind: "COMPANY_CAPITAL_OBJECTIVE",
        sensitivity: "CONFIDENTIAL",
        companyId: COMPANY_A,
      },
      { kind: "NETWORK_VISIBLE_DATA", sensitivity: "NETWORK_VISIBLE" },
    ]);
    const outcome = await p.execute(
      {
        callId: "c1",
        name: "get_company",
        arguments: { companyId: COMPANY_A },
      },
      contextFor(actorA, plan),
    );
    expect(outcome.failureCode).toBe("NOT_AVAILABLE");
  });

  it("refuses a malformed identifier without a lookup", async () => {
    const companies = fakeCompanies();
    let lookups = 0;
    const { port: p } = port({
      companies: {
        ...companies,
        findCanonicalCompanyProfile: (id) => {
          lookups += 1;
          return companies.findCanonicalCompanyProfile(id);
        },
      },
    });
    const outcome = await p.execute(
      {
        callId: "c1",
        name: "get_company",
        arguments: { companyId: "not-a-uuid" },
      },
      contextFor(actorA, ownCompanyPlan),
    );
    expect(outcome.failureCode).toBe("INVALID_ARGUMENTS");
    expect(lookups).toBe(0);
  });
});

describe("GET_CAPITAL_OBJECTIVE", () => {
  it("serves the owner's current objective as exact money, CONFIDENTIAL", async () => {
    const { port: p } = port();
    const outcome = await p.execute(
      {
        callId: "c1",
        name: "get_capital_objective",
        arguments: { companyId: COMPANY_A },
      },
      contextFor(actorA, ownCompanyPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.sensitivity).toBe("CONFIDENTIAL");
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        companyId: COMPANY_A,
        objective: {
          target: { amount: "2000000", currency: "GBP" },
          objectiveType: "RAISE",
          truthClass: "USER_CLAIM",
        },
      },
    });
  });

  it("is not offered, and not served, without the capital scope in the plan", async () => {
    const { port: p } = port();
    const plan = planFor(actorA, "OWN_COMPANY_QUESTION", [
      {
        kind: "COMPANY_PROFILE",
        sensitivity: "INTERNAL",
        companyId: COMPANY_A,
      },
    ]);
    const offered = await p.offer(contextFor(actorA, plan));
    expect(offered.map((t) => t.definition.name)).not.toContain(
      "get_capital_objective",
    );
    const outcome = await p.execute(
      {
        callId: "c1",
        name: "get_capital_objective",
        arguments: { companyId: COMPANY_A },
      },
      contextFor(actorA, plan),
    );
    expect(outcome.failureCode).toBe("TOOL_NOT_ELIGIBLE");
  });

  it("denies a non-owner without a disclosure grant, and tells nothing about existence", async () => {
    const { port: p } = port();
    const plan = planFor(actorB, "COUNTERPARTY_COMPANY_QUESTION", [
      {
        kind: "COMPANY_CAPITAL_OBJECTIVE",
        sensitivity: "CONFIDENTIAL",
        companyId: COMPANY_A,
      },
    ]);
    const outcome = await p.execute(
      {
        callId: "c1",
        name: "get_capital_objective",
        arguments: { companyId: COMPANY_A },
      },
      contextFor(actorB, plan),
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.failureCode).toBe("NOT_AVAILABLE");
    expect(JSON.stringify(outcome)).not.toContain("2000000");
  });
});

describe("GET_INVESTOR_MANDATE", () => {
  it("serves the investor's own declared mandates as typed policy, never the raw narrative", async () => {
    const { port: p } = port();
    const outcome = await p.execute(
      {
        callId: "c1",
        name: "get_investor_mandate",
        arguments: { investorOrganisationId: INVESTOR_B },
      },
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.sensitivity).toBe("CONFIDENTIAL");
    const text = JSON.stringify(outcome);
    expect(text).toContain(MANDATE_B);
    expect(text).toContain('"automatedUse":"ELIGIBLE"');
    expect(text).not.toContain(MARKERS.investor);
    expect(text).not.toContain("rawMandateText");
  });

  it("refuses everyone but the owning organisation: a founder never sees a mandate", async () => {
    const { port: p } = port();
    // Even with a (hypothetical) mandate scope in a founder's plan, ownership fails.
    const plan = planFor(actorA, "INVESTOR_QUESTION", [
      {
        kind: "INVESTOR_MANDATE",
        sensitivity: "CONFIDENTIAL",
        investorOrganisationId: INVESTOR_B,
      },
    ]);
    const outcome = await p.execute(
      {
        callId: "c1",
        name: "get_investor_mandate",
        arguments: { investorOrganisationId: INVESTOR_B },
      },
      contextFor(actorA, plan),
    );
    expect(outcome.status).toBe("DENIED");
    expect(outcome.failureCode).toBe("NOT_AVAILABLE");
    expect(JSON.stringify(outcome)).not.toContain(MARKERS.investor);
    expect(JSON.stringify(outcome)).not.toContain(MANDATE_B);
  });

  it("returns an empty list for a mandate id that is not the organisation's", async () => {
    const { port: p } = port();
    const outcome = await p.execute(
      {
        callId: "c1",
        name: "get_investor_mandate",
        arguments: {
          investorOrganisationId: INVESTOR_B,
          mandateId: "00000000-0000-4000-8000-000000000009",
        },
      },
      contextFor(actorB, investorPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result).toMatchObject({ ok: true, data: { mandates: [] } });
  });
});

describe("SEARCH_COMPANIES", () => {
  it("returns only disclosure-confirmed network-visible companies, never private ones", async () => {
    const { port: p } = port();
    const outcome = await p.execute(
      { callId: "c1", name: "search_companies", arguments: { query: "a" } },
      contextFor(actorA, ownCompanyPlan),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.sensitivity).toBe("NETWORK_VISIBLE");
    expect(outcome.result).toMatchObject({
      ok: true,
      data: {
        items: [
          { companyId: COMPANY_B_NETWORK, canonicalName: "Beacon Analytics" },
        ],
        nextCursor: null,
      },
    });
    const text = JSON.stringify(outcome);
    expect(text).not.toContain(COMPANY_B_PRIVATE);
    expect(text).not.toContain(MARKERS.crossTenant);
    // The actor's own company is a subject, not a search result.
    expect(text).not.toContain(COMPANY_A);
  });

  it("drops a candidate the disclosure layer refuses, even when classification admitted it", async () => {
    const ports = fakePorts();
    const { port: p } = port({
      disclosure: {
        canDisclose: ports.disclosure.canDisclose,
        evaluateMany: (requests) =>
          Promise.resolve(
            requests.map((request) => ({
              outcome: "DENY" as const,
              resource: request.resource,
              requestedAccess: request.requestedAccess,
              reasonCode: "POLICY_REVOKED" as const,
            })),
          ),
      },
    });
    const outcome = await p.execute(
      { callId: "c1", name: "search_companies", arguments: {} },
      contextFor(actorA, ownCompanyPlan),
    );
    expect(outcome.result).toMatchObject({ ok: true, data: { items: [] } });
  });

  it("is refused without the network scope and rejects a foreign cursor as an argument error", async () => {
    const noNetwork = planFor(actorA, "OWN_COMPANY_QUESTION", [
      {
        kind: "COMPANY_PROFILE",
        sensitivity: "INTERNAL",
        companyId: COMPANY_A,
      },
    ]);
    const { port: p } = port();
    expect(
      (
        await p.execute(
          { callId: "c1", name: "search_companies", arguments: {} },
          contextFor(actorA, noNetwork),
        )
      ).failureCode,
    ).toBe("TOOL_NOT_ELIGIBLE");

    const { port: rejecting } = port({
      companies: fakeCompanies({
        searchThrows: new CompanySearchCursorError(),
      }),
    });
    const outcome = await rejecting.execute(
      {
        callId: "c2",
        name: "search_companies",
        arguments: { cursor: "not-issued-by-us" },
      },
      contextFor(actorA, ownCompanyPlan),
    );
    expect(outcome.status).toBe("FAILED");
    expect(outcome.failureCode).toBe("INVALID_ARGUMENTS");
  });
});
