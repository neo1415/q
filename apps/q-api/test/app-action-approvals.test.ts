import { describe, expect, it } from "vitest";

import type { AppActionPorts } from "@capital-q/app-actions";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  APP_ACTION_TYPES,
  createAppActionDefinitions,
} from "../src/composition/app-actions.js";

/**
 * ADR 0040, profile area: a change Q prepared through a generated tool is
 * approved and run through the SAME declaration, as the approver. Q's
 * approvals bind the values, not the version: two cards approved in a row
 * must not fail the second on the first's version.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";
const ORG = "d0000000-0000-4000-8000-000000000001";
const COMPANY = "a0000000-0000-4000-8000-000000000001";

const APPROVER: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  actorType: "HUMAN",
};

function fakes() {
  const updates: unknown[] = [];
  const people: unknown[] = [];
  const ports: AppActionPorts = {
    companies: {
      // The record moved on since the card was prepared at version 7.
      getCompany: () => Promise.resolve({ version: 9 } as never),
      getMyCompanyMembership: () => Promise.reject(new Error("unused")),
      updateCompany: (command) => {
        updates.push(command.input);
        return Promise.resolve({ version: 10 } as never);
      },
      upsertMyCompanyMembership: () => Promise.reject(new Error("unused")),
      updateMyFounderProfile: () => Promise.reject(new Error("unused")),
      updateCompanyTeamFacts: () => Promise.reject(new Error("unused")),
    },
    people: {
      read: () => Promise.resolve({ version: 4 } as never),
      update: (input) => {
        people.push(input);
        return Promise.resolve({ version: 5 } as never);
      },
    },
  };
  const definitions = createAppActionDefinitions(ports);
  const definition = (type: string) => {
    const found = definitions.find((d) => d.actionType === type);
    if (found === undefined) throw new Error(`no ${type}`);
    return found;
  };
  return { definition, updates, people };
}

const approved = (actionType: string, payload: unknown) =>
  ({
    actionId: "11111111-1111-4111-8111-111111111111",
    runId: "f0000000-0000-4000-8000-000000000051",
    tenantId: TENANT,
    organisationId: ORG,
    actionType,
    actionVersion: 1,
    idempotencyKey: "k",
    payloadHash: "h",
    approvalId: "22222222-2222-4222-8222-222222222222",
    approvedByUserId: USER,
    payload,
    targets: [],
  }) as never;

const context = {
  approver: APPROVER,
  correlationId: "cor_00000000-0000-4000-8000-000000000001",
  attempt: 1,
} as never;

describe("approved profile changes run through the declaration", () => {
  it("every generated profile tool has its approval type composed", () => {
    expect(APP_ACTION_TYPES).toEqual(
      expect.arrayContaining([
        "app.person.profile.update",
        "app.company.profile.update",
        "app.company.team.me.upsert",
        "app.company.founder_profile.me.update",
        "app.company.team_facts.update",
        "app.investor.profile.update",
        "app.investor.representative.me.upsert",
        "app.q_card.handle.claim",
        "app.q_card.update",
      ]),
    );
  });

  it("a company change Q prepared is applied to the profile as it stands when approved", async () => {
    const { definition, updates } = fakes();
    const action = definition("app.company.profile.update");
    const outcome = await action.executor.execute(
      approved("app.company.profile.update", {
        companyId: COMPANY,
        input: { headquartersCity: "Nairobi", expectedVersion: 7 },
        atLatest: true,
      }),
      context,
    );
    expect(outcome).toMatchObject({ outcome: "EXECUTED" });
    expect(updates).toEqual([
      { headquartersCity: "Nairobi", expectedVersion: 9 },
    ]);
  });

  it("their own profile only: another person's id is refused at approval and changes nobody", async () => {
    const { definition, people } = fakes();
    const action = definition("app.person.profile.update");
    expect(
      await action.authorize(
        { userId: OTHER, input: { displayName: "Ada" } },
        APPROVER,
      ),
    ).toEqual({ outcome: "DENY", code: "NOT_AVAILABLE" });
    const outcome = await action.executor.execute(
      approved("app.person.profile.update", {
        userId: USER,
        input: { timeZone: "Africa/Lagos" },
      }),
      context,
    );
    expect(outcome).toMatchObject({ outcome: "EXECUTED" });
    expect(people).toEqual([
      {
        userId: USER,
        expectedVersion: 4,
        changes: { timeZone: "Africa/Lagos" },
      },
    ]);
  });
});
