import { describe, expect, it } from "vitest";

import type { QActionPrepareContext } from "@capital-q/q-runtime";

import { COMPANY_PROFILE_UPDATE } from "../src/composition/company-profile-action.js";
import { INVESTOR_PROFILE_UPDATE } from "../src/composition/investor-profile-action.js";
import { PERSON_PROFILE_UPDATE } from "../src/composition/person-profile-action.js";
import { createProfileChangeBoard } from "../src/composition/profile-change-board.js";

/**
 * The board between `propose_profile_change` and the Approval Engine
 * (BIZ-002): the change is shaped into the owning action's exact payload,
 * normalised the way the page's write path is, refused in code's words
 * when it does not fit, and proposed once for the run's own person.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const COMPANY = "a0000000-0000-4000-8000-000000000001";
const INVESTOR = "a1000000-0000-4000-8000-000000000001";
const RUN = "f0000000-0000-4000-8000-000000000041";

function prepareContext(userId = USER): QActionPrepareContext {
  return {
    runId: RUN,
    actor: { userId, tenantId: TENANT, actorType: "HUMAN" },
  } as unknown as QActionPrepareContext;
}

const base = { runId: RUN, tenantId: TENANT, actorUserId: USER };

describe("the profile change board", () => {
  it("shapes a person change into person.profile.update and proposes it once", async () => {
    const board = createProfileChangeBoard();
    const prepared = await board.prepareForApproval({
      ...base,
      profile: "PERSON",
      subjectId: USER,
      changes: [{ field: "headline", value: "Angel investor" }],
    });
    expect(prepared).toEqual({
      status: "PREPARED",
      awaitingApprovalOf: "Update your profile. Headline: Angel investor",
      reason: null,
    });
    expect(await board.proposer.propose(prepareContext())).toEqual({
      actionType: PERSON_PROFILE_UPDATE,
      payload: { userId: USER, headline: "Angel investor" },
    });
    expect(await board.proposer.propose(prepareContext())).toBeNull();
  });

  it("normalises a website the way the page's write path does, for a company", async () => {
    const board = createProfileChangeBoard();
    await board.prepareForApproval({
      ...base,
      profile: "COMPANY",
      subjectId: COMPANY,
      changes: [{ field: "websiteUrl", value: "kivu-freight.example" }],
    });
    expect(await board.proposer.propose(prepareContext())).toEqual({
      actionType: COMPANY_PROFILE_UPDATE,
      payload: {
        companyId: COMPANY,
        changes: { websiteUrl: "https://kivu-freight.example" },
      },
    });
  });

  it("refuses in code's words when a value does not fit, and holds nothing", async () => {
    const board = createProfileChangeBoard();
    const refused = await board.prepareForApproval({
      ...base,
      profile: "INVESTOR_ORGANISATION",
      subjectId: INVESTOR,
      changes: [{ field: "deploymentState", value: "very active" }],
    });
    expect(refused.status).toBe("REFUSED");
    expect(refused.reason).toContain("actively investing");
    const website = await board.prepareForApproval({
      ...base,
      profile: "COMPANY",
      subjectId: COMPANY,
      changes: [{ field: "websiteUrl", value: "instagram" }],
    });
    expect(website.status).toBe("REFUSED");
    const clearedName = await board.prepareForApproval({
      ...base,
      profile: "PERSON",
      subjectId: USER,
      changes: [{ field: "displayName", value: null }],
    });
    expect(clearedName.status).toBe("REFUSED");
    expect(await board.proposer.propose(prepareContext())).toBeNull();
  });

  it("holds one action per run and never proposes it for another person", async () => {
    const board = createProfileChangeBoard();
    await board.prepareForApproval({
      ...base,
      profile: "INVESTOR_ORGANISATION",
      subjectId: INVESTOR,
      changes: [{ field: "hqCountry", value: "GB" }],
    });
    const second = await board.prepareForApproval({
      ...base,
      profile: "PERSON",
      subjectId: USER,
      changes: [{ field: "displayName", value: "Ada" }],
    });
    expect(second.status).toBe("ONE_PER_TURN");
    expect(
      await board.proposer.propose(
        prepareContext("b0000000-0000-4000-8000-000000000009"),
      ),
    ).toBeNull();

    const again = createProfileChangeBoard();
    await again.prepareForApproval({
      ...base,
      profile: "INVESTOR_ORGANISATION",
      subjectId: INVESTOR,
      changes: [{ field: "hqCountry", value: "GB" }],
    });
    expect(await again.proposer.propose(prepareContext())).toEqual({
      actionType: INVESTOR_PROFILE_UPDATE,
      payload: {
        investorOrganisationId: INVESTOR,
        changes: { hqCountry: "GB" },
      },
    });
  });
});
