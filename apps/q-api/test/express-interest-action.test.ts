import { describe, expect, it } from "vitest";

import { CompanyIdSchema } from "@capital-q/companies";
import { UtcTimestampSchema } from "@capital-q/contracts";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import {
  InterestCompanyNotFoundError,
  InterestIdSchema,
  RelationshipEventIdSchema,
  RelationshipIdSchema,
  type ExpressInterestCommand,
  type Interest,
  type InterestService,
} from "@capital-q/network";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  createExpressInterestAction,
  RELATIONSHIP_INTEREST_EXPRESS,
} from "../src/composition/express-interest-action.js";

/**
 * Q's Express Interest (CQ-NET-010) is the feed button's command behind
 * the Approval Engine: CONFIRM_REQUIRED, bound to one company, authorised
 * by the command's own question, executed as the approver with the
 * approved action's idempotency key — so a retried execution is the same
 * interest, and nothing about Q's having prepared it adds authority.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";
const COMPANY = "a0000000-0000-4000-8000-000000000001";

const INVESTOR: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  actorType: "HUMAN",
};

const payload = { companyId: COMPANY, companyName: "Kora" };

const INTEREST: Interest = {
  id: InterestIdSchema.parse("77777777-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("22222222-0000-4000-8000-000000000001"),
  relationshipId: RelationshipIdSchema.parse(
    "88888888-0000-4000-8000-000000000001",
  ),
  companyId: CompanyIdSchema.parse(COMPANY),
  investorOrganisationId: InvestorOrganisationIdSchema.parse(
    "11111111-0000-4000-8000-000000000013",
  ),
  expressedByParty: "INVESTOR",
  status: "EXPRESSED",
  expressedByUserId: USER,
  expressedInOrganisationId: ORG,
  relationshipEventId: RelationshipEventIdSchema.parse(
    "99999999-0000-4000-8000-000000000001",
  ),
  createdAt: UtcTimestampSchema.parse("2026-09-25T10:00:00.000Z"),
  response: null,
  connection: null,
};

function fakes(
  options: { readonly may?: boolean; readonly fail?: boolean } = {},
) {
  const commands: ExpressInterestCommand[] = [];
  const asked: { actor: ActorContext; companyId: string }[] = [];
  const interests: InterestService = {
    expressInterest: (command) => {
      commands.push(command);
      if (options.fail === true) {
        return Promise.reject(new InterestCompanyNotFoundError());
      }
      return Promise.resolve({
        interest: INTEREST,
        deduplicated: commands.length > 1,
      });
    },
    getOwnInterest: () => Promise.reject(new Error("not under test")),
    mayExpressInterest: (query) => {
      asked.push(query);
      return Promise.resolve(options.may ?? true);
    },
    listIncomingInterest: () => Promise.reject(new Error("not under test")),
    respondToInterest: () => Promise.reject(new Error("not under test")),
    mayRespondToInterest: () => Promise.reject(new Error("not under test")),
  };
  return {
    commands,
    asked,
    action: createExpressInterestAction({ interests }),
  };
}

function approved(action: ReturnType<typeof fakes>["action"]) {
  return {
    actionId: "11111111-1111-4111-8111-111111111111",
    runId: "f0000000-0000-4000-8000-000000000030",
    tenantId: TENANT,
    organisationId: ORG,
    actionType: RELATIONSHIP_INTEREST_EXPRESS,
    actionVersion: 1,
    targets: action.targets(payload),
    payload,
    idempotencyKey: "q_action:run:action",
    payloadHash: "h",
    approvalId: "22222222-2222-4222-8222-222222222222",
    approvedByUserId: USER,
  } as never;
}

const context = {
  approver: INVESTOR,
  correlationId: "cor_00000000-0000-4000-8000-000000000001",
  attempt: 1,
} as never;

describe("relationship.interest.express", () => {
  it("is consequential, bound to one company, and says it is not a commitment", () => {
    const { action } = fakes();
    expect(action.actionType).toBe(RELATIONSHIP_INTEREST_EXPRESS);
    expect(action.riskClass).toBe("CONFIRM_REQUIRED");
    expect(action.targets(payload)).toEqual([
      { kind: "COMPANY", companyId: COMPANY },
    ]);
    expect(action.payload.safeParse(payload).success).toBe(true);
    // No organisation, relationship or match can ride along in the payload.
    for (const extra of [
      { investorOrganisationId: ORG },
      { relationshipId: COMPANY },
      { match: true },
    ]) {
      expect(action.payload.safeParse({ ...payload, ...extra }).success).toBe(
        false,
      );
    }
    const described = action.describe(payload, action.targets(payload));
    expect(described.preview).toMatch(/not a commitment to invest/);
  });

  it("authorises with the command's own question, and refuses when it says no", async () => {
    const yes = fakes();
    expect(await yes.action.authorize(payload, INVESTOR)).toEqual({
      outcome: "ALLOW",
    });
    expect(yes.asked).toEqual([{ actor: INVESTOR, companyId: COMPANY }]);

    const no = fakes({ may: false });
    expect(await no.action.authorize(payload, INVESTOR)).toEqual({
      outcome: "DENY",
      code: "NOT_AVAILABLE",
    });
    expect(no.commands).toHaveLength(0);

    const system = fakes();
    expect(
      await system.action.authorize(payload, {
        ...INVESTOR,
        actorType: "SYSTEM",
      }),
    ).toEqual({ outcome: "DENY", code: "NOT_A_PERSON" });
  });

  it("executes the same command as the approver, keyed by the approved action", async () => {
    const { action, commands } = fakes();
    const report = await action.executor.execute(approved(action), context);
    expect(report).toEqual({
      outcome: "EXECUTED",
      result: {
        interestId: "77777777-0000-4000-8000-000000000001",
        relationshipId: "88888888-0000-4000-8000-000000000001",
        alreadyExpressed: false,
      },
    });
    expect(commands[0]).toMatchObject({
      actor: INVESTOR,
      companyId: COMPANY,
      surface: "Q_CONVERSATION",
      idempotencyKey: "q-action:q_action:run:action",
    });

    // A retried execution of the same approval is the same key.
    const again = await action.executor.execute(approved(action), {
      ...(context as object),
      attempt: 2,
    } as never);
    expect(commands[1]?.idempotencyKey).toBe(commands[0]?.idempotencyKey);
    expect(again).toMatchObject({ result: { alreadyExpressed: true } });
  });

  it("reports a refused command as FAILED, never as done", async () => {
    const { action } = fakes({ fail: true });
    expect(await action.executor.execute(approved(action), context)).toEqual({
      outcome: "FAILED",
      failureCode: "INTEREST_REFUSED",
      retryable: false,
    });
  });
});
