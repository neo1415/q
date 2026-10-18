import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { QActionPrepareContext } from "@capital-q/q-runtime";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  PersonProfileNotFoundError,
  UserIdSchema,
  type ActorContext,
  type PersonProfile,
  type PersonProfileChanges,
  type PersonProfileStore,
} from "@capital-q/security";

import { createProfileUpdateBoard } from "../src/composition/company-profile-action.js";
import {
  PERSON_PROFILE_UPDATE,
  createPersonProfileUpdateAction,
  describePersonProfileChanges,
  PersonProfileUpdatePayloadSchema,
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
  const renamed: {
    userId: string;
    expectedVersion: number;
    changes: PersonProfileChanges;
  }[] = [];
  let stored: PersonProfile = {
    userId: UserIdSchema.parse(USER),
    displayName: "Daniel",
    headline: null,
    version: 3,
    updatedAt: "2026-09-25T09:00:00.000Z",
  };
  // The person-profile store the application API's PATCH /v1/me/profile
  // writes through: one write path for the page and for Q.
  const people: PersonProfileStore = {
    read: (userId) => Promise.resolve(userId === USER ? stored : null),
    update: (input) => {
      renamed.push(input);
      if (input.userId !== USER) {
        return Promise.reject(new PersonProfileNotFoundError());
      }
      stored = {
        ...stored,
        ...(input.changes.displayName === undefined
          ? {}
          : { displayName: input.changes.displayName }),
        ...(input.changes.headline === undefined
          ? {}
          : { headline: input.changes.headline }),
        ...(input.changes.timeZone === undefined
          ? {}
          : { timeZone: input.changes.timeZone }),
        version: stored.version + 1,
      };
      return Promise.resolve(stored);
    },
  };
  const action = createPersonProfileUpdateAction({ people });
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
      { approver: PERSON, correlationId: "cor_test", attempt: 1 },
    );
    expect(ok).toEqual({
      outcome: "EXECUTED",
      result: { userId: USER, displayName: "John", headline: null, version: 4 },
    });
    // Applied at the version the store holds now, never one the payload carried.
    expect(renamed).toEqual([
      { userId: USER, expectedVersion: 3, changes: { displayName: "John" } },
    ]);

    const refused = await action.executor.execute(
      {
        ...base,
        payload: { userId: OTHER, displayName: "John" },
        targets: [{ kind: "USER", userId: OTHER }],
      } as never,
      { approver: PERSON, correlationId: "cor_test", attempt: 1 },
    );
    expect(refused).toMatchObject({
      outcome: "FAILED",
      failureCode: "NOT_THE_APPROVER",
    });
    // Nobody else was touched.
    expect(renamed).toHaveLength(1);
  });
});

describe("person.profile.update, headline (BIZ-002)", () => {
  it("accepts a headline or a cleared headline, keeps v1 payloads valid, and refuses an empty change", () => {
    const { action } = fakes();
    expect(
      action.payload.safeParse({ userId: USER, headline: "Angel investor" })
        .success,
    ).toBe(true);
    expect(
      action.payload.safeParse({ userId: USER, headline: null }).success,
    ).toBe(true);
    // v1's shape, from approvals requested before the headline existed.
    expect(
      action.payload.safeParse({ userId: USER, displayName: "John" }).success,
    ).toBe(true);
    expect(action.payload.safeParse({ userId: USER }).success).toBe(false);
    expect(
      action.payload.safeParse({ userId: USER, headline: "x".repeat(161) })
        .success,
    ).toBe(false);
    expect(
      action.describe({ userId: USER, headline: "Angel investor" }, [
        { kind: "USER", userId: USER },
      ]).preview,
    ).toBe("Headline: Angel investor");
  });

  it("executes a headline change through the same store as the profile page", async () => {
    const { action, renamed } = fakes();
    const result = await action.executor.execute(
      {
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
        payload: { userId: USER, headline: "Angel investor" },
        targets: [{ kind: "USER", userId: USER }],
      } as never,
      { approver: PERSON, correlationId: "cor_test", attempt: 1 },
    );
    expect(result).toMatchObject({
      outcome: "EXECUTED",
      result: { headline: "Angel investor", displayName: "Daniel" },
    });
    expect(renamed[0]?.changes).toEqual({ headline: "Angel investor" });
  });
});

// Live 2026-10-01: a reminder for 09:00 UTC; Q asks once and offers to
// save their time zone to their own profile, for their approval.
describe("their time zone on their profile", () => {
  it("accepts a known IANA zone only, and says what will be saved", () => {
    expect(
      PersonProfileUpdatePayloadSchema.safeParse({
        userId: USER,
        timeZone: "Africa/Lagos",
      }).success,
    ).toBe(true);
    for (const bad of ["Lagos time", "Mars/Olympus", "+01:00"]) {
      expect(
        PersonProfileUpdatePayloadSchema.safeParse({
          userId: USER,
          timeZone: bad,
        }).success,
        bad,
      ).toBe(false);
    }
    expect(
      describePersonProfileChanges({ userId: USER, timeZone: "Africa/Lagos" })
        .summary,
    ).toBe("Save your time zone as Africa/Lagos.");
  });

  it("executes through the same store as the profile page", async () => {
    const { action, renamed } = fakes();
    const result = await action.executor.execute(
      {
        actionId: "11111111-1111-4111-8111-111111111112",
        runId: RUN,
        tenantId: TENANT,
        organisationId: ORG,
        actionType: PERSON_PROFILE_UPDATE,
        actionVersion: 1,
        idempotencyKey: "k2",
        payloadHash: "h2",
        approvalId: "22222222-2222-4222-8222-222222222223",
        approvedByUserId: USER,
        payload: { userId: USER, timeZone: "Africa/Lagos" },
        targets: [{ kind: "USER", userId: USER }],
      } as never,
      { approver: PERSON, correlationId: "cor_test", attempt: 1 },
    );
    expect(result).toMatchObject({
      outcome: "EXECUTED",
      result: { timeZone: "Africa/Lagos" },
    });
    expect(renamed[0]?.changes).toEqual({ timeZone: "Africa/Lagos" });
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
    // The registry's declaration (ADR 0040), the one update_my_profile
    // prepares too.
    expect(await board.propose(prepareContext())).toEqual({
      actionType: "app.person.profile.update",
      payload: { userId: USER, input: { displayName: "John" } },
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
