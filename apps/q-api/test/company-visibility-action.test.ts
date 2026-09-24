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

import { createProfileUpdateBoard } from "../src/composition/company-profile-action.js";
import {
  COMPANY_VISIBILITY_SET,
  createCompanyVisibilitySetAction,
  visibilityConfirmation,
} from "../src/composition/company-visibility-action.js";

/**
 * "Please make my company visible to investors" is a Q action over the
 * Visibility screen's own capability (CQ-QACT-001, F6): the two choices
 * that screen offers, authorised against ownership and `company.edit`,
 * executed through `CompanyService.setCompanyVisibility` — the service
 * behind the route the screen calls — as the approver, with the version it
 * reads for itself. Live, the same sentence produced a second deck.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";
const COMPANY = "a0000000-0000-4000-8000-000000000001";
const RUN = "f0000000-0000-4000-8000-000000000030";

const OWNER: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  actorType: "HUMAN",
};

function fakes(
  options: { readonly allow?: boolean; readonly ready?: boolean } = {},
) {
  const calls = { visibility: [] as unknown[], authorised: 0 };
  const profiles = {
    findCanonicalCompanyProfile: (id: string) =>
      Promise.resolve(
        id === COMPANY
          ? { id: COMPANY, tenantId: TENANT, organisationId: ORG }
          : null,
      ),
  } as unknown as CompanyQueryPort;
  const service = {
    getCompany: () => Promise.resolve({ id: COMPANY, version: 4 }),
    setCompanyVisibility: (command: { input: { visibility: string } }) => {
      calls.visibility.push(command);
      return Promise.resolve({
        id: COMPANY,
        version: 5,
        marketplaceVisibility: command.input.visibility,
        marketplaceReadinessState:
          options.ready === true ? "marketplace_ready" : "not_assessed",
      });
    },
    updateCompany: () => Promise.reject(new Error("not the visibility path")),
  } as unknown as CompanyService;
  const authorization = {
    authorize: () => {
      calls.authorised += 1;
      return Promise.resolve({
        outcome: options.allow === false ? "DENY" : "ALLOW",
      });
    },
  } as unknown as AuthorizationService;
  return {
    calls,
    action: createCompanyVisibilitySetAction({
      profiles,
      service,
      authorization,
    }),
  };
}

const visible = { companyId: COMPANY, visibility: "network_visible" };

describe("company.visibility.set", () => {
  it("offers exactly the screen's two choices, never public_external", () => {
    const { action } = fakes();
    expect(action.actionType).toBe(COMPANY_VISIBILITY_SET);
    expect(action.riskClass).toBe("CONFIRM_REQUIRED");
    expect(action.payload.safeParse(visible).success).toBe(true);
    expect(
      action.payload.safeParse({
        ...visible,
        visibility: "organisation_private",
      }).success,
    ).toBe(true);
    for (const visibility of ["public_external", "founder_private", "x"]) {
      expect(action.payload.safeParse({ ...visible, visibility }).success).toBe(
        false,
      );
    }
    const described = action.describe(visible, action.targets(visible));
    // Readiness implications, honestly: visible is not recommended.
    expect(described.preview).toMatch(
      /does not put you in investor recommendations/,
    );
  });

  it("authorises only the owning organisation with company.edit", async () => {
    const owner = fakes();
    expect(await owner.action.authorize(visible, OWNER)).toEqual({
      outcome: "ALLOW",
    });
    const stranger = fakes();
    expect(
      await stranger.action.authorize(visible, {
        ...OWNER,
        organisationId: OrganisationIdSchema.parse(
          "d0000000-0000-4000-8000-000000000002",
        ),
      }),
    ).toEqual({ outcome: "DENY", code: "NOT_AVAILABLE" });
    expect(stranger.calls.authorised).toBe(0);
    const otherTenant = fakes();
    expect(
      await otherTenant.action.authorize(visible, {
        ...OWNER,
        tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000009"),
      }),
    ).toEqual({ outcome: "DENY", code: "NOT_AVAILABLE" });
    const refused = fakes({ allow: false });
    expect(await refused.action.authorize(visible, OWNER)).toEqual({
      outcome: "DENY",
      code: "NOT_PERMITTED",
    });
    expect(
      await refused.action.authorize(visible, {
        ...OWNER,
        actorType: "Q",
      } as never),
    ).toEqual({ outcome: "DENY", code: "NOT_A_PERSON" });
  });

  it("executes through setCompanyVisibility as the approver, with the version it reads", async () => {
    const { action, calls } = fakes();
    const report = await action.executor.execute(
      {
        actionId: "11111111-1111-4111-8111-111111111111",
        runId: RUN,
        tenantId: TENANT,
        organisationId: ORG,
        actionType: COMPANY_VISIBILITY_SET,
        actionVersion: 1,
        targets: action.targets(visible),
        payload: visible,
        idempotencyKey: "q_action:run:action",
        payloadHash: "h",
        approvalId: "22222222-2222-4222-8222-222222222222",
        approvedByUserId: USER,
      } as never,
      { approver: OWNER, correlationId: "cor_test", attempt: 1 },
    );
    expect(report).toEqual({
      outcome: "EXECUTED",
      result: {
        companyId: COMPANY,
        version: 5,
        visibility: "network_visible",
        marketplaceReadinessState: "not_assessed",
      },
    });
    const command = calls.visibility[0] as {
      actor: ActorContext;
      input: Record<string, unknown>;
    };
    // The gate-verified approver itself, membership included.
    expect(command.actor).toBe(OWNER);
    expect(command.input).toEqual({
      visibility: "network_visible",
      expectedVersion: 4,
    });
  });

  it("confirms from the service's result, readiness included", () => {
    expect(
      visibilityConfirmation({
        companyId: COMPANY,
        version: 5,
        visibility: "network_visible",
        marketplaceReadinessState: "not_assessed",
      }),
    ).toMatch(/isn't in their recommendations yet/);
    expect(
      visibilityConfirmation({
        companyId: COMPANY,
        version: 5,
        visibility: "network_visible",
        marketplaceReadinessState: "marketplace_ready",
      }),
    ).toMatch(/can appear in their recommendations/);
    expect(
      visibilityConfirmation({
        companyId: COMPANY,
        version: 5,
        visibility: "organisation_private",
        marketplaceReadinessState: "not_assessed",
      }),
    ).toMatch(/private to your organisation/);
  });
});

function prepareContext(companyId: string): QActionPrepareContext {
  return {
    runId: RUN,
    tenantId: TENANT,
    actorUserId: USER,
    capability: "ANSWER",
    subjects: [{ kind: "COMPANY", companyId }],
    actor: OWNER,
    correlationId: "cor_test",
    plan: { tenantId: TENANT } as unknown as PermittedContextPlan,
  } as unknown as QActionPrepareContext;
}

describe("a visibility reading on the proposer's board", () => {
  it("becomes one proposal for the run's own company, once", async () => {
    const board = createProfileUpdateBoard();
    board.noteVisibility({
      runId: RUN,
      tenantId: TENANT,
      companyId: COMPANY,
      visibility: "network_visible",
    });
    expect(await board.propose(prepareContext(COMPANY))).toEqual({
      actionType: COMPANY_VISIBILITY_SET,
      payload: visible,
    });
    expect(await board.propose(prepareContext(COMPANY))).toBeNull();
  });

  it("is refused, with a reason, for a company the run is not about", async () => {
    const board = createProfileUpdateBoard();
    board.noteVisibility({
      runId: RUN,
      tenantId: TENANT,
      companyId: COMPANY,
      visibility: "network_visible",
    });
    const proposal = await board.propose(
      prepareContext("a0000000-0000-4000-8000-000000000009"),
    );
    expect(proposal).toHaveProperty("refused");
  });
});
