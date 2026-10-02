import { describe, expect, it } from "vitest";

import type { PublicWebResearchService } from "@capital-q/q-research";

import {
  createFillProfileGapsTool,
  createQToolExecutor,
  createQToolRegistry,
  type ProfileChangePort,
} from "../src/index.js";
import {
  COMPANY_A,
  COMPANY_B_NETWORK,
  actorA,
  actorB,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * fill_profile_gaps (HARDEN P0, live 2026-10-02, Nixo): "go online, search
 * everything … I'm giving you full permission and approval to update my
 * profile", then "only the gaps". Code decides: only OPEN fields of their
 * own company, only values a source of this run supports, no field the
 * sources disagree on, ONE combined change, and the line Q says.
 */

type Prepared = Parameters<ProfileChangePort["prepareForApproval"]>[0];

const PUBLIC = { kind: "PUBLIC_EXTERNAL_DATA", sensitivity: "PUBLIC" } as const;
const founderPlan = planFor(actorA, "GENERAL_QUESTION", [
  { kind: "COMPANY_PROFILE", sensitivity: "INTERNAL", companyId: COMPANY_A },
  PUBLIC,
]);

function harness(sources: readonly { index: number; domain: string }[]) {
  const prepared: Prepared[] = [];
  const searched: string[] = [];
  const research = {
    research: (command: { requestedQuery: string }) => {
      searched.push(command.requestedQuery);
      return Promise.resolve({
        status: "OK",
        message: null,
        query: command.requestedQuery,
        sources: sources.map((source) => ({
          index: source.index,
          url: `https://${source.domain}/about`,
          domain: source.domain,
          title: "About",
          publishedAt: null,
          retrievedAt: "2026-10-02T10:20:00.000Z",
          temporal: "UNDATED",
          excerpt: "Alpha Robotics, founded 2019, is based in Leeds.",
          extracted: true,
          isSubjectWebsite: false,
          mentionedCountries: [],
          instructionRisk: [],
          evidenceSourceId: null,
        })),
        comparison: [],
        budget: {
          searchCalls: 1,
          resultsConsidered: 2,
          extractCalls: 1,
          sourcesExtracted: 2,
          sourcesRetained: 2,
        },
      });
    },
    extract: () => Promise.reject(new Error("unused")),
    seenInRun: () => [],
  } as unknown as PublicWebResearchService;
  const profileChanges: ProfileChangePort = {
    prepareForApproval: (entry) => {
      prepared.push(entry);
      return Promise.resolve({
        status: "PREPARED",
        awaitingApprovalOf: "Update your company profile.",
        reason: null,
      });
    },
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry([
      createFillProfileGapsTool({
        ...fakePorts(),
        research,
        profileChanges,
      }),
    ]),
  });
  const call = (callId: string, args: Record<string, unknown>) =>
    executor.execute(
      { callId, name: "fill_profile_gaps", arguments: args },
      contextFor(actorA, founderPlan),
    );
  return { call, prepared, searched, executor };
}

const data = (outcome: { result: { ok: boolean; data?: unknown } }) =>
  outcome.result.data as {
    status: string;
    openFields: string[];
    filledFields: string[];
    sources: unknown[];
    line: string;
  };

describe("fill_profile_gaps", () => {
  it("searches for the open fields only, then prepares ONE change of open fields a source supports", async () => {
    const { call, prepared, searched } = harness([
      { index: 1, domain: "alpha.example" },
      { index: 2, domain: "news.example" },
    ]);
    const first = await call("g1", {});
    expect(first.status).toBe("SUCCEEDED");
    expect(data(first).status).toBe("RESEARCHED");
    // Alpha's description, country and stage are filled: never in play.
    expect(data(first).openFields).toEqual([
      "legalName",
      "websiteUrl",
      "foundedDate",
      "headquartersCity",
      "shortDescription",
    ]);
    expect(data(first).filledFields).toEqual(
      expect.arrayContaining([
        "primaryDescription",
        "headquartersCountry",
        "currentStageCode",
      ]),
    );
    expect(searched[0]).toContain("Alpha Robotics");
    expect(prepared).toHaveLength(0);

    const second = await call("g2", {
      values: [
        { field: "headquartersCity", value: "Leeds", sources: [1, 2] },
        { field: "foundedDate", value: "2019-01-01", sources: [2] },
        // Filled already: dropped, whatever the sources say.
        {
          field: "primaryDescription",
          value: "Something else entirely.",
          sources: [1],
        },
        // A source this run never returned: not supported, dropped.
        { field: "websiteUrl", value: "https://made.up", sources: [9] },
        // The sources disagree: left open and named.
        { field: "legalName", value: "Alpha Robotics Ltd", sources: [1] },
        { field: "legalName", value: "Alpha Robotic Systems", sources: [2] },
      ],
    });
    expect(data(second).status).toBe("PREPARED");
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      profile: "COMPANY",
      subjectId: COMPANY_A,
      changes: [
        { field: "headquartersCity", value: "Leeds" },
        { field: "foundedDate", value: "2019-01-01" },
      ],
    });
    expect(data(second).line).toBe(
      "I filled headquarters city and founding date from public sources (alpha.example, news.example); approve the card to save them as your stated details. Sources disagree on legal name, so I left it open. Nothing public for website and one-line description; they stay open.",
    );
  });

  it("says which fields stay open when the sources support none", async () => {
    const { call, prepared } = harness([{ index: 1, domain: "alpha.example" }]);
    await call("g1", {});
    const second = await call("g2", { values: [] });
    expect(data(second).status).toBe("NOTHING_FOUND");
    expect(data(second).line).toContain("they stay open");
    expect(data(second).line).toContain("website");
    expect(prepared).toHaveLength(0);
  });

  it("refuses values that were not searched for in this run", async () => {
    const { call, prepared } = harness([{ index: 1, domain: "alpha.example" }]);
    const outcome = await call("g2", {
      values: [{ field: "headquartersCity", value: "Leeds", sources: [1] }],
    });
    expect(data(outcome).status).toBe("REFUSED");
    expect(prepared).toHaveLength(0);
  });

  it("works on their own company only, and only where public research is granted", async () => {
    const { executor } = harness([{ index: 1, domain: "alpha.example" }]);
    const someoneElses = await executor.execute(
      { callId: "x", name: "fill_profile_gaps", arguments: {} },
      contextFor(
        actorB,
        planFor(actorB, "GENERAL_QUESTION", [
          {
            kind: "COMPANY_PROFILE",
            sensitivity: "INTERNAL",
            companyId: COMPANY_A,
          },
          PUBLIC,
        ]),
      ),
    );
    expect(someoneElses.status).not.toBe("SUCCEEDED");
    const networkCompany = await executor.execute(
      { callId: "y", name: "fill_profile_gaps", arguments: {} },
      contextFor(
        actorA,
        planFor(actorA, "GENERAL_QUESTION", [
          {
            kind: "COMPANY_PROFILE",
            sensitivity: "INTERNAL",
            companyId: COMPANY_B_NETWORK,
          },
          PUBLIC,
        ]),
      ),
    );
    expect(networkCompany.status).not.toBe("SUCCEEDED");
    const noPublic = await executor.execute(
      { callId: "z", name: "fill_profile_gaps", arguments: {} },
      contextFor(
        actorA,
        planFor(actorA, "GENERAL_QUESTION", [
          {
            kind: "COMPANY_PROFILE",
            sensitivity: "INTERNAL",
            companyId: COMPANY_A,
          },
        ]),
      ),
    );
    expect(noPublic.status).not.toBe("SUCCEEDED");
  });
});
