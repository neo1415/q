import { describe, expect, it } from "vitest";

import type { QAnswerRequest, QToolPort } from "@capital-q/q-runtime";

import { createToolOwnRecordsPort } from "../src/own-records-port.js";

/**
 * The names a said name is resolved against are the person's OWN, read
 * through the tools under the run's plan (founder live 2026-09-27, #6;
 * Context Firewall): a company is theirs only when get_company says OWN, a
 * firm only when the plan binds a mandate to their own organisation, their
 * name only under OWN_ONBOARDING. Anything else contributes no name.
 */

const COMPANY = "c0000000-0000-4000-8000-00000000000c";
const FIRM = "f0000000-0000-4000-8000-00000000000f";

function request(options: {
  readonly scopes: readonly Record<string, unknown>[];
}): QAnswerRequest {
  return {
    runId: "r",
    actor: { userId: "u", tenantId: "t" },
    correlationId: "cor",
    capability: "ANSWER",
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    plan: { scopes: options.scopes },
  } as unknown as QAnswerRequest;
}

function tools(relationToYou: "OWN" | "SHARED") {
  const called: string[] = [];
  const port = {
    offer: () => Promise.resolve([]),
    execute: (proposal: { name: string }) => {
      called.push(proposal.name);
      const data =
        proposal.name === "get_company"
          ? {
              companyId: COMPANY,
              canonicalName: "Zino Aviation",
              legalName: "ZINO AVIATION LTD",
              websiteUrl: null,
              foundedDate: null,
              headquartersCountry: null,
              headquartersCity: null,
              currentStageCode: null,
              shortDescription: null,
              primaryDescription: null,
              companyStatus: "active",
              relationToYou,
              truthClass: "USER_CLAIM",
            }
          : {
              investorOrganisationId: FIRM,
              displayName: "Harbour Angels",
              investorType: null,
              deploymentState: null,
              mandates: [],
              truncated: false,
            };
      return Promise.resolve({ result: { ok: true, data } });
    },
  } as unknown as QToolPort;
  return { port, called };
}

describe("the person's own record names (Context Firewall)", () => {
  it("reads their own company, firm and name when the plan grants each", async () => {
    const { port } = tools("OWN");
    const records = await createToolOwnRecordsPort({
      tools: port,
      personName: () => Promise.resolve("Adaeze Okafor"),
    }).read(
      request({
        scopes: [
          {
            kind: "INVESTOR_MANDATE",
            subject: {
              kind: "INVESTOR_ORGANISATION",
              investorOrganisationId: FIRM,
            },
          },
          { kind: "OWN_ONBOARDING" },
        ],
      }),
    );
    expect(records.company).toEqual({
      companyId: COMPANY,
      names: ["Zino Aviation", "ZINO AVIATION LTD"],
    });
    expect(records.firm?.names).toEqual(["Harbour Angels"]);
    expect(records.person?.names).toEqual(["Adaeze Okafor"]);
  });

  it("contributes no name for a company that is only shared with them, a firm the plan does not bind, or a name without OWN_ONBOARDING", async () => {
    const { port, called } = tools("SHARED");
    let askedName = false;
    const records = await createToolOwnRecordsPort({
      tools: port,
      personName: () => {
        askedName = true;
        return Promise.resolve("Someone Else");
      },
    }).read(request({ scopes: [] }));
    expect(records).toEqual({ company: null, firm: null, person: null });
    expect(called).not.toContain("get_investor_mandate");
    expect(askedName).toBe(false);
  });
});
