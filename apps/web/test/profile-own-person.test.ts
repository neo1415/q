import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * W4-D (audit finding 6): Settings reads only the person's own profile,
 * the same read loadProfilePage makes for it, instead of the whole
 * profile page (company or investor, then verification) it discarded.
 */

const calls: string[] = [];
const PERSON = {
  userId: "b0000000-0000-4000-8000-000000000001",
  displayName: "Ada Obi",
};

vi.mock("@capital-q/api-client", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getMyProfile: () => {
      calls.push("getMyProfile");
      return Promise.resolve(PERSON);
    },
    getCompany: () => {
      calls.push("getCompany");
      return Promise.resolve({ id: "c0000000-0000-4000-8000-000000000001" });
    },
    getCurrentInvestorOrganisation: () => {
      calls.push("getCurrentInvestorOrganisation");
      return Promise.resolve({ id: "d0000000-0000-4000-8000-000000000001" });
    },
    getCompanyVerification: () => {
      calls.push("getCompanyVerification");
      return Promise.resolve({ standings: [] });
    },
  };
});

const { loadOwnPerson, loadProfilePage } =
  await import("../src/features/profile/profile-data");

const SESSION = { baseUrl: "https://api.example", accessToken: "t" } as never;

describe("Settings' own-person read", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("is the person loadProfilePage reads, in one call instead of three", async () => {
    const page = await loadProfilePage(SESSION, {
      kind: "FOUNDER",
      companyId: "c0000000-0000-4000-8000-000000000001",
    } as never);
    const pageCalls = [...calls];
    calls.length = 0;
    const person = await loadOwnPerson(SESSION);
    expect(person).toEqual(page.person);
    expect(calls).toEqual(["getMyProfile"]);
    expect(pageCalls).toEqual(
      expect.arrayContaining([
        "getMyProfile",
        "getCompany",
        "getCompanyVerification",
      ]),
    );
  });

  it("is null without a session, as the page's person is", async () => {
    expect(await loadOwnPerson(null)).toBeNull();
    expect(calls).toEqual([]);
  });
});
