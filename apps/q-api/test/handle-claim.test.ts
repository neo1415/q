import { describe, expect, it } from "vitest";

import {
  HandleUnavailableError,
  type PublicIdentityService,
  type SubjectDirectory,
} from "@capital-q/public-identity";
import type { QActionPrepareContext } from "@capital-q/q-runtime";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  HANDLE_CLAIM,
  createHandleClaimAction,
} from "../src/composition/handle-claim-action.js";
import { createHandleClaimBoard } from "../src/composition/handle-claim-board.js";

/**
 * "Make me a Q card" / "change our handle" (BIZ-004): the board checks the
 * handle before the person is asked; the approved `handle.claim` is
 * authorised on ownership and handle.manage and runs through the same
 * service command the profile page calls.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";
const COMPANY = "a0000000-0000-4000-8000-000000000001";
const FOREIGN = "a0000000-0000-4000-8000-000000000002";
const RUN = "f0000000-0000-4000-8000-000000000051";

const ADMIN: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  actorType: "HUMAN",
};

function prepareContext(userId = USER): QActionPrepareContext {
  return {
    runId: RUN,
    actor: { userId, tenantId: TENANT, actorType: "HUMAN" },
  } as unknown as QActionPrepareContext;
}

const base = {
  runId: RUN,
  tenantId: TENANT,
  actorUserId: USER,
  subjectType: "COMPANY" as const,
  subjectId: COMPANY,
};

describe("the handle claim board", () => {
  const available = (taken: readonly string[]) => ({
    handleAvailable: (handle: string) =>
      Promise.resolve(!taken.includes(handle)),
  });

  it("normalises and prepares an available handle, once", async () => {
    const board = createHandleClaimBoard({ publicIdentity: available([]) });
    const prepared = await board.prepareHandleClaim({
      ...base,
      handle: "@Kivu-Freight",
    });
    expect(prepared).toMatchObject({ status: "PREPARED", reason: null });
    expect(prepared.awaitingApprovalOf).toContain("@kivu-freight");
    expect(await board.proposer.propose(prepareContext())).toEqual({
      actionType: HANDLE_CLAIM,
      payload: {
        subjectType: "COMPANY",
        subjectId: COMPANY,
        handle: "kivu-freight",
      },
    });
    expect(await board.proposer.propose(prepareContext())).toBeNull();
  });

  it("refuses a malformed or unavailable handle before anyone is asked", async () => {
    const board = createHandleClaimBoard({
      publicIdentity: available(["support", "kivu"]),
    });
    expect(
      (await board.prepareHandleClaim({ ...base, handle: "no--way" })).status,
    ).toBe("REFUSED");
    const taken = await board.prepareHandleClaim({ ...base, handle: "kivu" });
    expect(taken).toMatchObject({ status: "REFUSED" });
    expect(taken.reason).toContain("@kivu");
    expect(await board.proposer.propose(prepareContext())).toBeNull();
  });

  it("never proposes for another person", async () => {
    const board = createHandleClaimBoard({ publicIdentity: available([]) });
    await board.prepareHandleClaim({ ...base, handle: "kivu" });
    expect(
      await board.proposer.propose(
        prepareContext("b0000000-0000-4000-8000-000000000009"),
      ),
    ).toBeNull();
  });
});

function actionFakes(options: { readonly allow?: boolean } = {}) {
  const claims: unknown[] = [];
  const subjects: SubjectDirectory = {
    find: (subject) =>
      Promise.resolve(
        subject.subjectId === COMPANY
          ? {
              tenantId: TENANT,
              organisationId: ORG,
              name: "Kivu",
              facts: {},
              verified: { organisation: false, founderIdentity: false },
            }
          : subject.subjectId === FOREIGN
            ? {
                tenantId: TENANT,
                organisationId: "d0000000-0000-4000-8000-000000000002",
                name: "Other",
                facts: {},
                verified: { organisation: false, founderIdentity: false },
              }
            : null,
      ),
  };
  const publicIdentity = {
    claimHandle: (input: { readonly handle: string }) => {
      claims.push(input);
      return input.handle === "gone"
        ? Promise.reject(new HandleUnavailableError("TAKEN"))
        : Promise.resolve({ handle: input.handle, publicCode: "abcdefgh23" });
    },
  } as unknown as PublicIdentityService;
  const authorization = {
    authorize: () =>
      Promise.resolve({ outcome: options.allow === false ? "DENY" : "ALLOW" }),
  } as unknown as AuthorizationService;
  return {
    claims,
    action: createHandleClaimAction({
      publicIdentity,
      subjects,
      authorization,
    }),
  };
}

const PAYLOAD = {
  subjectType: "COMPANY" as const,
  subjectId: COMPANY,
  handle: "kivu",
};

describe("handle.claim", () => {
  it("is confirm-required and holds only a valid handle", () => {
    const { action } = actionFakes();
    expect(action.riskClass).toBe("CONFIRM_REQUIRED");
    expect(action.payload.safeParse(PAYLOAD).success).toBe(true);
    expect(
      action.payload.safeParse({ ...PAYLOAD, handle: "Kivu" }).success,
    ).toBe(false);
    expect(
      action.payload.safeParse({ ...PAYLOAD, subjectType: "PERSON" }).success,
    ).toBe(false);
  });

  it("authorises the owning organisation's admin; another organisation's company is not available", async () => {
    expect(await actionFakes().action.authorize(PAYLOAD, ADMIN)).toEqual({
      outcome: "ALLOW",
    });
    expect(
      await actionFakes().action.authorize(
        { ...PAYLOAD, subjectId: FOREIGN },
        ADMIN,
      ),
    ).toEqual({ outcome: "DENY", code: "NOT_AVAILABLE" });
    expect(
      await actionFakes({ allow: false }).action.authorize(PAYLOAD, ADMIN),
    ).toEqual({ outcome: "DENY", code: "NOT_PERMITTED" });
  });

  it("executes through the service under the approver, and says so when the handle went meanwhile", async () => {
    const { action, claims } = actionFakes();
    const execute = (handle: string) =>
      action.executor.execute(
        {
          actionId: "11111111-1111-4111-8111-111111111111",
          runId: RUN,
          tenantId: TENANT,
          organisationId: ORG,
          actionType: HANDLE_CLAIM,
          actionVersion: 1,
          idempotencyKey: "k",
          payloadHash: "h",
          approvalId: "22222222-2222-4222-8222-222222222222",
          approvedByUserId: USER,
          payload: { ...PAYLOAD, handle },
          targets: [{ kind: "COMPANY", companyId: COMPANY }],
        } as never,
        {
          approver: ADMIN,
          correlationId: "cor_00000000-0000-4000-8000-000000000001",
          attempt: 1,
        },
      );
    expect(await execute("kivu")).toEqual({
      outcome: "EXECUTED",
      result: { handle: "kivu", publicCode: "abcdefgh23" },
    });
    expect(claims[0]).toMatchObject({ actor: ADMIN, handle: "kivu" });
    expect(await execute("gone")).toMatchObject({
      outcome: "FAILED",
      failureCode: "HANDLE_TAKEN",
    });
  });
});
