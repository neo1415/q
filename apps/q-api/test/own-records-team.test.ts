import { describe, expect, it } from "vitest";

import { CompanyTeamFactsNotFoundError } from "@capital-q/companies";

import { createOwnRecordsPort } from "../src/composition/own-records.js";

/**
 * Live acceptance 2026-10-16: Q said "1 founder, 1 person" for a company
 * whose canonical team facts were 2 and 14. The team record now carries
 * the company's counts only from the canonical facts, under names that say
 * what they count, and the asker's own membership is never a team list.
 */

const COMPANY = "70370415-7219-4a0c-9de2-95e7b9d852c9";
const actor = {
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
} as never;

function port(teamFacts: () => Promise<unknown>) {
  return createOwnRecordsPort({
    companyService: {
      getMyCompanyMembership: () =>
        Promise.resolve({
          businessTitle: "CEO",
          isFounder: true,
          relationshipType: "team_member",
        }),
      getMyFounderProfile: () => Promise.reject(new Error("404")),
      getCompanyTeamFacts: teamFacts,
    } as never,
    investorService: {} as never,
    capital: {} as never,
    verification: {} as never,
    visibility: {} as never,
    profileFindings: {} as never,
  });
}

const read = (p: ReturnType<typeof port>) =>
  p.read(actor, {
    record: "COMPANY_TEAM",
    subjectType: "COMPANY",
    subjectId: COMPANY,
  } as never);

describe("COMPANY_TEAM record", () => {
  it("gives the canonical counts, labelled, and the asker's own role apart from them", async () => {
    const record = (await read(
      port(() =>
        Promise.resolve({
          founderCount: 2,
          fullTimeFounderCount: 2,
          teamSize: 14,
          updatedAt: "2026-10-16T12:39:37.962Z",
        }),
      ),
    )) as Record<string, Record<string, unknown>>;
    expect(record["teamCounts"]).toMatchObject({
      status: "RECORDED",
      numberOfFounders: 2,
      numberOfFullTimeFounders: 2,
      peopleWorkingOnTheCompany: 14,
    });
    expect(record["yourOwnRole"]).toMatchObject({
      title: "CEO",
      isFounder: true,
    });
    // Nothing countable is offered in the asker's own entry.
    expect(JSON.stringify(record["yourOwnRole"])).not.toMatch(
      /Count|teamSize|founders/,
    );
  });

  it("says not recorded, never a guessed count, when the company has no facts", async () => {
    const record = (await read(
      port(() => Promise.reject(new CompanyTeamFactsNotFoundError())),
    )) as Record<string, Record<string, unknown>>;
    expect(record["teamCounts"]).toMatchObject({ status: "NOT_RECORDED" });
    expect(record["teamCounts"]?.["numberOfFounders"]).toBeUndefined();
  });

  it("says unreadable when the read fails, never null that reads as nothing", async () => {
    const record = (await read(
      port(() => Promise.reject(new Error("db down"))),
    )) as Record<string, Record<string, unknown>>;
    expect(record["teamCounts"]).toMatchObject({ status: "UNAVAILABLE" });
  });
});
