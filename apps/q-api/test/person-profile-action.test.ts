import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { QActionPrepareContext } from "@capital-q/q-runtime";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createProfileUpdateBoard } from "../src/composition/company-profile-action.js";
import {
  PERSON_PROFILE_UPDATE,
  createPersonProfileUpdateAction,
} from "../src/composition/person-profile-action.js";

/**
 * What Q calls the person (ADR 0011): proposed only for the acting person,
 * authorised only when the payload names them, executed only under the
 * approver's own id. "Change my name from Daniel" was refused live and
 * "call me John" stalled; both are one action now.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";
const ORG = "d0000000-0000-4000-8000-000000000001";
const RUN = "f0000000-0000-4000-8000-000000000021";

const PERSON: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  actorType: "HUMAN",
};

function fakes() {
  const renamed: { userId: string; displayName: string }[] = [];
  const action = createPersonProfileUpdateAction({
    people: {
      updateDisplayName: (input) => {
        renamed.push(input);
        return Promise.resolve(input.userId === USER);
      },
    },
  });
  return { action, renamed };
}

function prepareContext(actorUserId = USER): QActionPrepareContext {
  return {
    runId: RUN,
    tenantId: TENANT,
    actorUserId,
    capability: "ANSWER",
    subjects: [],
    actor: PERSON,
    correlationId: "cor_test",
    plan: { tenantId: TENANT } as unknown as PermittedContextPlan,
  } as unknown as QActionPrepareContext;
}

describe("person.profile.update", () => {
  it("is confirm-required, targets the person, and refuses an empty or oversized name", () => {
    const { action } = fakes();
    expect(action.actionType).toBe(PERSON_PROFILE_UPDATE);
    expect(action.riskClass).toBe("CONFIRM_REQUIRED");
    const payload = { userId: USER, displayName: "John" };
    expect(action.payload.safeParse(payload).success).toBe(true);
    expect(action.targets(payload)).toEqual([{ kind: "USER", userId: USER }]);
    expect(action.describe(payload, action.targets(payload)).summary).toBe(
      "Change what I call you to John.",
    );
    expect(
      action.payload.safeParse({ userId: USER, displayName: "  " }).success,
    ).toBe(false);
    expect(
      action.payload.safeParse({ userId: USER, displayName: "x".repeat(81) })
        .success,
    ).toBe(false);
  });

  it("authorises only the person the payload names, and only a person", async () => {
    const { action } = fakes();
    expect(
      await action.authorize({ userId: USER, displayName: "John" }, PERSON),
    ).toEqual({ outcome: "ALLOW" });
    expect(
      await action.authorize({ userId: OTHER, displayName: "John" }, PERSON),
    ).toEqual({ outcome: "DENY", code: "NOT_AVAILABLE" });
    expect(
      await action.authorize(
        { userId: USER, displayName: "John" },
        { ...PERSON, actorType: "SYSTEM" },
      ),
    ).toEqual({ outcome: "DENY", code: "NOT_A_PERSON" });
  });

  it("executes under the approver's own id and refuses a payload naming anyone else", async () => {
    const { action, renamed } = fakes();
    const base = {
      actionId: "11111111-1111-4111-8111-111111111111",
      runId: RUN,
      tenantId: TENANT,
      organisationId: ORG,
      actionType: PERSON_PROFILE_UPDATE,
      actionVersion: 1,
      idempotencyKey: "k",
      payloadHash: "h",
      approvalId: "22222222-2222-4222-8222-222222222222",
      approvedByUserId: USER,
    };
    const ok = await action.executor.execute(
      {
        ...base,
        payload: { userId: USER, displayName: "John" },
        targets: [{ kind: "USER", userId: USER }],
      } as never,
      { correlationId: "cor_test", attempt: 1 },
    );
    expect(ok).toEqual({
      outcome: "EXECUTED",
      result: { userId: USER, displayName: "John" },
    });
    expect(renamed).toEqual([{ userId: USER, displayName: "John" }]);

    const refused = await action.executor.execute(
      {
        ...base,
        payload: { userId: OTHER, displayName: "John" },
        targets: [{ kind: "USER", userId: OTHER }],
      } as never,
      { correlationId: "cor_test", attempt: 1 },
    );
    expect(refused).toMatchObject({
      outcome: "FAILED",
      failureCode: "NOT_THE_APPROVER",
    });
    // Nobody else was touched.
    expect(renamed).toHaveLength(1);
  });
});

describe("the board, for a name", () => {
  it("proposes the acting person's own name change, once, and never for another user", async () => {
    const board = createProfileUpdateBoard();
    board.noteDisplayName({
      runId: RUN,
      tenantId: TENANT,
      userId: USER,
      displayName: "John",
      quote: "call me john",
    });
    expect(await board.propose(prepareContext())).toEqual({
      actionType: PERSON_PROFILE_UPDATE,
      payload: { userId: USER, displayName: "John" },
    });
    expect(await board.propose(prepareContext())).toBeNull();

    // A reading for a different user than the one acting is dropped.
    board.noteDisplayName({
      runId: RUN,
      tenantId: TENANT,
      userId: OTHER,
      displayName: "John",
      quote: "call me john",
    });
    expect(await board.propose(prepareContext())).toBeNull();
  });
});
