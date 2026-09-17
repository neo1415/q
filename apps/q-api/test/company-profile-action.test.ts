import { describe, expect, it } from "vitest";

import type { CompanyQueryPort, CompanyService } from "@capital-q/companies";
import type { PermittedContextPlan } from "@capital-q/contracts";
import type { QActionPrepareContext } from "@capital-q/q-runtime";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  COMPANY_PROFILE_UPDATE,
  createCompanyProfileUpdateAction,
  createProfileUpdateBoard,
} from "../src/composition/company-profile-action.js";

/**
 * The first real Q action (ADR 0011): a change to the person's own
 * profile is proposed only for the company the run is about, authorised
 * against ownership and `company.edit`, and executed through the
 * companies context with the version it reads for itself.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";
const COMPANY = "a0000000-0000-4000-8000-000000000001";
const RUN = "f0000000-0000-4000-8000-000000000020";

const OWNER: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  actorType: "HUMAN",
};
const STRANGER: ActorContext = {
  ...OWNER,
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000002",
  ),
};

function fakes(options: { readonly allow?: boolean } = {}) {
  const calls = { updates: [] as unknown[], authorised: [] as unknown[] };
  const profiles = {
    findCanonicalCompanyProfile: (id: string) =>
      Promise.resolve(
        id === COMPANY
          ? {
              id: COMPANY,
              tenantId: TENANT,
              organisationId: ORG,
              canonicalName: "The Vaultlyne",
            }
          : null,
      ),
  } as unknown as CompanyQueryPort;
  const service = {
    getCompany: () => Promise.resolve({ id: COMPANY, version: 7 }),
    updateCompany: (command: unknown) => {
      calls.updates.push(command);
      return Promise.resolve({ id: COMPANY, version: 8 });
    },
  } as unknown as CompanyService;
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
    action: createCompanyProfileUpdateAction({
      profiles,
      service,
      authorization,
    }),
  };
}

const payload = {
  companyId: COMPANY,
  changes: { websiteUrl: "https://thevaultlyne.com", shortDescription: "x" },
};

describe("company.profile.update", () => {
  it("is a confirm-required action over the editable fields, described in the person's terms", () => {
    const { action } = fakes();
    expect(action.actionType).toBe(COMPANY_PROFILE_UPDATE);
    expect(action.riskClass).toBe("CONFIRM_REQUIRED");
    const parsed = action.payload.safeParse(payload);
    expect(parsed.success).toBe(true);
    const described = action.describe(payload, action.targets(payload));
    expect(described.summary).toContain("Website: https://thevaultlyne.com");
    expect(action.targets(payload)).toEqual([
      { kind: "COMPANY", companyId: COMPANY },
    ]);
  });

  it("refuses a payload that changes nothing or names a field the profile does not have", () => {
    const { action } = fakes();
    expect(
      action.payload.safeParse({ companyId: COMPANY, changes: {} }).success,
    ).toBe(false);
    expect(
      action.payload.safeParse({
        companyId: COMPANY,
        changes: { marketplaceVisibility: "network_visible" },
      }).success,
    ).toBe(false);
  });

  it("authorises the owning organisation with company.edit and nobody else", async () => {
    const owner = fakes();
    expect(await owner.action.authorize(payload, OWNER)).toEqual({
      outcome: "ALLOW",
    });
    expect(owner.calls.authorised).toHaveLength(1);
    const stranger = fakes();
    expect(await stranger.action.authorize(payload, STRANGER)).toEqual({
      outcome: "DENY",
      code: "NOT_AVAILABLE",
    });
    // A stranger never reaches the authorization service: absence and
    // somebody else's company are one answer.
    expect(stranger.calls.authorised).toHaveLength(0);
    const refused = fakes({ allow: false });
    expect(await refused.action.authorize(payload, OWNER)).toEqual({
      outcome: "DENY",
      code: "NOT_PERMITTED",
    });
  });

  it("executes through the companies context with the version it reads, as the approver", async () => {
    const { action, calls } = fakes();
    const report = await action.executor.execute(
      {
        actionId: "11111111-1111-4111-8111-111111111111",
        runId: RUN,
        tenantId: TENANT,
        organisationId: ORG,
        actionType: COMPANY_PROFILE_UPDATE,
        actionVersion: 1,
        targets: action.targets(payload),
        payload,
        idempotencyKey: "k",
        payloadHash: "h",
        approvalId: "22222222-2222-4222-8222-222222222222",
        approvedByUserId: USER,
      } as never,
      { correlationId: "cor_test", attempt: 1 },
    );
    expect(report).toEqual({
      outcome: "EXECUTED",
      result: {
        companyId: COMPANY,
        version: 8,
        fields: ["websiteUrl", "shortDescription"],
      },
    });
    const command = calls.updates[0] as {
      actor: ActorContext;
      input: Record<string, unknown>;
    };
    expect(command.actor.userId).toBe(USER);
    expect(command.input).toEqual({
      expectedVersion: 7,
      websiteUrl: "https://thevaultlyne.com",
      shortDescription: "x",
    });
  });
});

function prepareContext(
  companyId: string,
  tenantId: string = TENANT,
): QActionPrepareContext {
  return {
    runId: RUN,
    tenantId,
    actorUserId: USER,
    capability: "ANSWER",
    subjects: [{ kind: "COMPANY", companyId }],
    actor: OWNER,
    correlationId: "cor_test",
    plan: { tenantId } as unknown as PermittedContextPlan,
  } as unknown as QActionPrepareContext;
}

describe("the profile update board", () => {
  it("proposes what the answer seam noted, once, for the run's own company", async () => {
    const board = createProfileUpdateBoard();
    board.note({
      runId: RUN,
      tenantId: TENANT,
      companyId: COMPANY,
      updates: [
        {
          field: "websiteUrl",
          value: "https://thevaultlyne.com",
          quote: "put our website as thevaultlyne.com",
        },
      ],
    });
    expect(await board.propose(prepareContext(COMPANY))).toEqual({
      actionType: COMPANY_PROFILE_UPDATE,
      payload: {
        companyId: COMPANY,
        changes: { websiteUrl: "https://thevaultlyne.com" },
      },
    });
    // Consumed: the next prepare step of the same run has nothing.
    expect(await board.propose(prepareContext(COMPANY))).toBeNull();
  });

  it("proposes nothing for another company, another tenant, or a value the profile refuses", async () => {
    const board = createProfileUpdateBoard();
    const note = (value: string) =>
      board.note({
        runId: RUN,
        tenantId: TENANT,
        companyId: COMPANY,
        updates: [{ field: "websiteUrl", value, quote: "q" }],
      });
    note("https://thevaultlyne.com");
    expect(
      await board.propose(
        prepareContext("a0000000-0000-4000-8000-000000000009"),
      ),
    ).toBeNull();
    note("https://thevaultlyne.com");
    expect(
      await board.propose(
        prepareContext(COMPANY, "c0000000-0000-4000-8000-000000000009"),
      ),
    ).toBeNull();
    note("not a url at all");
    expect(await board.propose(prepareContext(COMPANY))).toBeNull();
  });
});
