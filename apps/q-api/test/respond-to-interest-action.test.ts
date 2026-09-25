import { describe, expect, it } from "vitest";

import { CompanyIdSchema } from "@capital-q/companies";
import { UtcTimestampSchema } from "@capital-q/contracts";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import {
  InterestAlreadyAnsweredError,
  InterestIdSchema,
  InterestResponseIdSchema,
  MatchIdSchema,
  RelationshipEventIdSchema,
  RelationshipIdSchema,
  type Interest,
  type InterestService,
  type RespondToInterestCommand,
} from "@capital-q/network";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  createRespondToInterestAction,
  RELATIONSHIP_INTEREST_RESPOND,
} from "../src/composition/respond-to-interest-action.js";

/**
 * Q's answer to an interest (CQ-NET-011) is the founder inbox's command
 * behind the Approval Engine: CONFIRM_REQUIRED, bound to one interest in
 * one company's inbox and to one answer, executed as the approver with the
 * approved action's idempotency key.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";
const COMPANY = "a0000000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "a0000000-0000-4000-8000-000000000002";
const INTEREST_ID = "77777777-0000-4000-8000-000000000001";

const FOUNDER: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  actorType: "HUMAN",
};

const INTEREST: Interest = {
  id: InterestIdSchema.parse(INTEREST_ID),
  tenantId: TenantIdSchema.parse(TENANT),
  relationshipId: RelationshipIdSchema.parse(
    "88888888-0000-4000-8000-000000000001",
  ),
  companyId: CompanyIdSchema.parse(COMPANY),
  investorOrganisationId: InvestorOrganisationIdSchema.parse(
    "11111111-0000-4000-8000-000000000013",
  ),
  expressedByParty: "INVESTOR",
  status: "EXPRESSED",
  expressedByUserId: "b0000000-0000-4000-8000-000000000009",
  expressedInOrganisationId: "d0000000-0000-4000-8000-000000000009",
  relationshipEventId: RelationshipEventIdSchema.parse(
    "99999999-0000-4000-8000-000000000001",
  ),
  createdAt: UtcTimestampSchema.parse("2026-09-25T10:00:00.000Z"),
  response: null,
  connection: null,
};

const ACCEPTED: Interest = {
  ...INTEREST,
  response: {
    id: InterestResponseIdSchema.parse("66666666-0000-4000-8000-000000000001"),
    decision: "ACCEPTED",
    respondedAt: UtcTimestampSchema.parse("2026-09-25T11:00:00.000Z"),
  },
  connection: {
    id: MatchIdSchema.parse("55555555-0000-4000-8000-000000000001"),
    status: "ACTIVE",
    connectedAt: UtcTimestampSchema.parse("2026-09-25T11:00:00.000Z"),
  },
};

const INVESTOR = {
  id: InvestorOrganisationIdSchema.parse(
    "11111111-0000-4000-8000-000000000013",
  ),
  tenantId: TenantIdSchema.parse("33333333-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000009",
  ),
  investorType: "VC" as const,
  displayName: "Apex Ventures",
  deploymentState: null,
};

const accept = {
  interestId: INTEREST_ID,
  companyId: COMPANY,
  decision: "ACCEPTED" as const,
  investorName: "Apex Ventures",
};

function fakes(
  options: {
    readonly may?: boolean;
    readonly inboxCompany?: string;
    readonly fail?: boolean;
  } = {},
) {
  const commands: RespondToInterestCommand[] = [];
  const interests: InterestService = {
    expressInterest: () => Promise.reject(new Error("not under test")),
    getOwnInterest: () => Promise.reject(new Error("not under test")),
    mayExpressInterest: () => Promise.reject(new Error("not under test")),
    listIncomingInterest: (query) =>
      Promise.resolve(
        query.companyId === (options.inboxCompany ?? COMPANY)
          ? [{ interest: INTEREST, investor: INVESTOR }]
          : [],
      ),
    respondToInterest: (command) => {
      commands.push(command);
      if (options.fail === true) {
        return Promise.reject(new InterestAlreadyAnsweredError());
      }
      return Promise.resolve({
        interest: command.decision === "ACCEPTED" ? ACCEPTED : INTEREST,
        investor: INVESTOR,
        deduplicated: commands.length > 1,
      });
    },
    mayRespondToInterest: () => Promise.resolve(options.may ?? true),
    relationshipForInvestor: () => Promise.reject(new Error("not under test")),
    relationshipForCompany: () => Promise.reject(new Error("not under test")),
    listRelationshipsForInvestor: () =>
      Promise.reject(new Error("not under test")),
    listRelationshipsForCompany: () =>
      Promise.reject(new Error("not under test")),
  };
  return {
    commands,
    action: createRespondToInterestAction({ interests }),
  };
}

function approved(
  action: ReturnType<typeof fakes>["action"],
  payload: typeof accept,
) {
  return {
    actionId: "11111111-1111-4111-8111-111111111111",
    runId: "f0000000-0000-4000-8000-000000000030",
    tenantId: TENANT,
    organisationId: ORG,
    actionType: RELATIONSHIP_INTEREST_RESPOND,
    actionVersion: 1,
    targets: action.targets(payload),
    payload,
    idempotencyKey: "q_action:run:answer",
    payloadHash: "h",
    approvalId: "22222222-2222-4222-8222-222222222222",
    approvedByUserId: USER,
  } as never;
}

const context = {
  approver: FOUNDER,
  correlationId: "cor_00000000-0000-4000-8000-000000000001",
  attempt: 1,
} as never;

describe("relationship.interest.respond", () => {
  it("is consequential, bound to one interest, one company and one answer, and never celebrates", () => {
    const { action } = fakes();
    expect(action.actionType).toBe(RELATIONSHIP_INTEREST_RESPOND);
    expect(action.riskClass).toBe("CONFIRM_REQUIRED");
    expect(action.targets(accept)).toEqual([
      { kind: "COMPANY", companyId: COMPANY },
    ]);
    for (const extra of [
      { decision: "MAYBE" },
      { reason: "weak team" },
      { message: "hello" },
    ]) {
      expect(action.payload.safeParse({ ...accept, ...extra }).success).toBe(
        false,
      );
    }
    const accepting = action.describe(accept, action.targets(accept));
    expect(accepting.preview).toMatch(/not an investment/);
    expect(accepting.summary).not.toMatch(/match!/i);
    const declining = action.describe(
      { ...accept, decision: "DECLINED" },
      action.targets(accept),
    );
    expect(declining.preview).toMatch(/No reason is recorded/);
  });

  it("authorises only when the command would, and only for an interest in THIS company's inbox", async () => {
    expect(await fakes().action.authorize(accept, FOUNDER)).toEqual({
      outcome: "ALLOW",
    });
    expect(
      await fakes({ may: false }).action.authorize(accept, FOUNDER),
    ).toEqual({ outcome: "DENY", code: "NOT_AVAILABLE" });
    // Approved for one company, the interest lives in another's inbox.
    expect(
      await fakes({ inboxCompany: OTHER_COMPANY }).action.authorize(
        accept,
        FOUNDER,
      ),
    ).toEqual({ outcome: "DENY", code: "NOT_AVAILABLE" });
    expect(
      await fakes().action.authorize(accept, {
        ...FOUNDER,
        actorType: "SYSTEM",
      }),
    ).toEqual({ outcome: "DENY", code: "NOT_A_PERSON" });
  });

  it("executes the inbox's own command as the approver, keyed by the approved action", async () => {
    const { action, commands } = fakes();
    const report = await action.executor.execute(
      approved(action, accept),
      context,
    );
    expect(report).toEqual({
      outcome: "EXECUTED",
      result: {
        interestId: INTEREST_ID,
        decision: "ACCEPTED",
        connectionId: ACCEPTED.connection?.id,
        alreadyAnswered: false,
      },
    });
    expect(commands[0]).toMatchObject({
      actor: FOUNDER,
      interestId: INTEREST_ID,
      decision: "ACCEPTED",
      surface: "Q_CONVERSATION",
      idempotencyKey: "q-action:q_action:run:answer",
    });
  });

  it("reports a refused answer as FAILED, never as done", async () => {
    const { action } = fakes({ fail: true });
    expect(
      await action.executor.execute(approved(action, accept), context),
    ).toEqual({
      outcome: "FAILED",
      failureCode: "INTEREST_ANSWER_REFUSED",
      retryable: false,
    });
  });
});
