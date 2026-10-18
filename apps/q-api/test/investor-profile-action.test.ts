import { describe, expect, it } from "vitest";

import {
  InvestorOrganisationNotFoundError,
  type InvestorService,
} from "@capital-q/investors";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  INVESTOR_PROFILE_UPDATE,
  createInvestorProfileUpdateAction,
} from "../src/composition/investor-profile-action.js";

/**
 * investor.profile.update (BIZ-002): the investor twin of
 * company.profile.update. Authorised against the investors context's own
 * read (which refuses another tenant's or organisation's profile as "not
 * found") and `investor.edit`; executed through the same
 * updateInvestorOrganisation command the profile page's PATCH calls, with
 * the version it reads for itself.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";
const INVESTOR = "a1000000-0000-4000-8000-000000000001";
const FOREIGN = "a1000000-0000-4000-8000-000000000002";

const PARTNER: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  actorType: "HUMAN",
};

function fakes(options: { readonly allow?: boolean } = {}) {
  const calls = { updates: [] as unknown[], authorised: [] as unknown[] };
  const investors = {
    // The investors context's rule: only the actor's own organisation's
    // investor profile is visible; anything else is "not found".
    getInvestorOrganisation: (query: {
      readonly investorOrganisationId: string;
    }) =>
      query.investorOrganisationId === INVESTOR
        ? Promise.resolve({ id: INVESTOR, version: 4 })
        : Promise.reject(new InvestorOrganisationNotFoundError()),
    updateInvestorOrganisation: (command: unknown) => {
      calls.updates.push(command);
      return Promise.resolve({ id: INVESTOR, version: 5 });
    },
  } as unknown as InvestorService;
  const authorization = {
    authorize: (request: unknown) => {
      calls.authorised.push(request);
      return Promise.resolve({
        outcome: options.allow === false ? "DENY" : "ALLOW",
      });
    },
  } as unknown as AuthorizationService;
  return {
    calls,
    action: createInvestorProfileUpdateAction({ investors, authorization }),
  };
}

const PAYLOAD = {
  investorOrganisationId: INVESTOR,
  changes: {
    publicDescription: "Seed-stage climate infrastructure.",
    deploymentState: "SELECTIVE",
  },
};

describe("investor.profile.update", () => {
  it("is confirm-required, targets the investor organisation, and holds only editable fields", () => {
    const { action } = fakes();
    expect(action.actionType).toBe(INVESTOR_PROFILE_UPDATE);
    expect(action.riskClass).toBe("CONFIRM_REQUIRED");
    expect(action.payload.safeParse(PAYLOAD).success).toBe(true);
    expect(action.targets(PAYLOAD)).toEqual([
      { kind: "INVESTOR_ORGANISATION", investorOrganisationId: INVESTOR },
    ]);
    // Verification state and visibility are not reachable from here.
    expect(
      action.payload.safeParse({
        investorOrganisationId: INVESTOR,
        changes: { verificationState: "verified" },
      }).success,
    ).toBe(false);
    expect(
      action.payload.safeParse({
        investorOrganisationId: INVESTOR,
        changes: {},
      }).success,
    ).toBe(false);
    expect(action.describe(PAYLOAD, action.targets(PAYLOAD)).preview).toBe(
      "Description: Seed-stage climate infrastructure.\nDeploying capital: SELECTIVE",
    );
  });

  it("allows the organisation's editor, and checks investor.edit on the exact resource", async () => {
    const { action, calls } = fakes();
    expect(await action.authorize(PAYLOAD, PARTNER)).toEqual({
      outcome: "ALLOW",
    });
    expect(calls.authorised[0]).toMatchObject({
      capability: "investor.edit",
      resource: {
        kind: "RESOURCE",
        tenantId: TENANT,
        organisationId: ORG,
        resourceType: "investor_organisation",
        resourceId: INVESTOR,
      },
    });
  });

  it("refuses another tenant's or organisation's profile as not available, before any capability check", async () => {
    const { action, calls } = fakes();
    expect(
      await action.authorize(
        { ...PAYLOAD, investorOrganisationId: FOREIGN },
        PARTNER,
      ),
    ).toEqual({ outcome: "DENY", code: "NOT_AVAILABLE" });
    expect(calls.authorised).toHaveLength(0);
  });

  it("refuses a member without investor.edit, a non-person and a person with no organisation", async () => {
    expect(
      await fakes({ allow: false }).action.authorize(PAYLOAD, PARTNER),
    ).toEqual({ outcome: "DENY", code: "NOT_PERMITTED" });
    expect(
      await fakes().action.authorize(PAYLOAD, {
        ...PARTNER,
        actorType: "SYSTEM",
      }),
    ).toEqual({ outcome: "DENY", code: "NOT_A_PERSON" });
    const { organisationId: _organisationId, ...noOrganisation } = PARTNER;
    expect(await fakes().action.authorize(PAYLOAD, noOrganisation)).toEqual({
      outcome: "DENY",
      code: "NOT_AVAILABLE",
    });
  });

  it("executes through updateInvestorOrganisation under the approver, at the version it reads", async () => {
    const { action, calls } = fakes();
    const result = await action.executor.execute(
      {
        actionId: "11111111-1111-4111-8111-111111111111",
        runId: "f0000000-0000-4000-8000-000000000031",
        tenantId: TENANT,
        organisationId: ORG,
        actionType: INVESTOR_PROFILE_UPDATE,
        actionVersion: 1,
        idempotencyKey: "k",
        payloadHash: "h",
        approvalId: "22222222-2222-4222-8222-222222222222",
        approvedByUserId: USER,
        payload: PAYLOAD,
        targets: action.targets(PAYLOAD),
      } as never,
      { approver: PARTNER, correlationId: "cor_test", attempt: 1 },
    );
    expect(result).toEqual({
      outcome: "EXECUTED",
      result: {
        investorOrganisationId: INVESTOR,
        version: 5,
        fields: ["publicDescription", "deploymentState"],
      },
    });
    expect(calls.updates[0]).toMatchObject({
      actor: PARTNER,
      investorOrganisationId: INVESTOR,
      input: {
        expectedVersion: 4,
        publicDescription: "Seed-stage climate infrastructure.",
        deploymentState: "SELECTIVE",
      },
    });
  });
});
