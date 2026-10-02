import { describe, expect, it } from "vitest";

import {
  createProposeProfileChangeTool,
  createQToolExecutor,
  createQToolRegistry,
  type ProfileChangePort,
  ProposeProfileChangeInputSchema,
} from "../src/index.js";
import {
  COMPANY_A,
  RUN,
  COMPANY_B_NETWORK,
  INVESTOR_B,
  actorA,
  actorB,
  contextFor,
  fakePorts,
  planFor,
} from "./support.js";

/**
 * `propose_profile_change` (BIZ-002): parity with the profile page. The
 * model says which profile and which fields; code decides whose profile
 * that is -- the person themselves, or the company / investor organisation
 * the plan binds that belongs to the actor's own organisation -- and hands
 * the change to the approval board. Nothing is written here.
 */

type Prepared = Parameters<ProfileChangePort["prepareForApproval"]>[0];

function harness() {
  const prepared: Prepared[] = [];
  const port: ProfileChangePort = {
    prepareForApproval: (entry) => {
      prepared.push(entry);
      return Promise.resolve({
        status: "PREPARED",
        awaitingApprovalOf: "Update your profile.",
        reason: null,
      });
    },
  };
  const executor = createQToolExecutor({
    registry: createQToolRegistry([
      createProposeProfileChangeTool(fakePorts(), port),
    ]),
  });
  return { executor, prepared };
}

const call = (args: Record<string, unknown>) => ({
  callId: "p1",
  name: "propose_profile_change",
  arguments: args,
});

const ownConversation = (actor: typeof actorA) => {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) => ({
      ...scope,
      filter: { ...scope.filter, userId: actor.userId },
    })),
  };
};

describe("propose_profile_change", () => {
  it("prepares the person's own headline for approval, keyed on their own id", async () => {
    const { executor, prepared } = harness();
    const outcome = await executor.execute(
      call({
        profile: "PERSON",
        changes: [{ field: "headline", value: "Angel investor in climate" }],
      }),
      contextFor(actorA, ownConversation(actorA)),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(prepared).toEqual([
      {
        runId: RUN,
        tenantId: actorA.tenantId,
        actorUserId: actorA.userId,
        profile: "PERSON",
        subjectId: actorA.userId,
        changes: [{ field: "headline", value: "Angel investor in climate" }],
      },
    ]);
  });

  it("prepares a change to the actor's own company when the plan binds it", async () => {
    const { executor, prepared } = harness();
    const outcome = await executor.execute(
      call({
        profile: "COMPANY",
        changes: [
          { field: "shortDescription", value: "Robots for warehouses." },
        ],
      }),
      contextFor(
        actorA,
        planFor(actorA, "OWN_COMPANY_QUESTION", [
          {
            kind: "COMPANY_PROFILE",
            sensitivity: "CONFIDENTIAL",
            companyId: COMPANY_A,
          },
        ]),
      ),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(prepared[0]).toMatchObject({
      profile: "COMPANY",
      subjectId: COMPANY_A,
    });
  });

  it("never prepares a change to another organisation's company, even when the plan binds it", async () => {
    const { executor, prepared } = harness();
    const outcome = await executor.execute(
      call({
        profile: "COMPANY",
        changes: [{ field: "canonicalName", value: "Hijacked" }],
      }),
      contextFor(
        actorA,
        planFor(actorA, "COUNTERPARTY_COMPANY_QUESTION", [
          {
            kind: "COMPANY_PROFILE",
            sensitivity: "CONFIDENTIAL",
            companyId: COMPANY_B_NETWORK,
          },
        ]),
      ),
    );
    expect(outcome.status).toBe("DENIED");
    expect(prepared).toEqual([]);
  });

  it("prepares only the actor's own investor organisation", async () => {
    const own = harness();
    const bound = (actor: typeof actorA) =>
      planFor(actor, "INVESTOR_QUESTION", [
        {
          kind: "INVESTOR_PROFILE",
          sensitivity: "CONFIDENTIAL",
          investorOrganisationId: INVESTOR_B,
        },
      ]);
    const args = {
      profile: "INVESTOR_ORGANISATION",
      changes: [{ field: "deploymentState", value: "SELECTIVE" }],
    };
    const mine = await own.executor.execute(
      call(args),
      contextFor(actorB, bound(actorB)),
    );
    expect(mine.status).toBe("SUCCEEDED");
    expect(own.prepared[0]).toMatchObject({ subjectId: INVESTOR_B });

    const other = harness();
    const theirs = await other.executor.execute(
      call(args),
      contextFor(actorA, bound(actorA)),
    );
    expect(theirs.status).toBe("DENIED");
    expect(other.prepared).toEqual([]);
  });

  it("refuses a field that belongs to another profile, and a field that does not exist", async () => {
    const { executor, prepared } = harness();
    const misplaced = await executor.execute(
      call({
        profile: "PERSON",
        changes: [{ field: "websiteUrl", value: "https://example.com" }],
      }),
      contextFor(actorA, ownConversation(actorA)),
    );
    expect(misplaced).toMatchObject({
      status: "SUCCEEDED",
      result: { ok: true, data: { status: "REFUSED" } },
    });

    const invented = await executor.execute(
      call({
        profile: "PERSON",
        changes: [{ field: "verificationState", value: "verified" }],
      }),
      contextFor(actorA, ownConversation(actorA)),
    );
    expect(invented.status).not.toBe("SUCCEEDED");
    expect(prepared).toEqual([]);
  });

  it("is not available for the person's own record without their own-conversation scope", async () => {
    const { executor, prepared } = harness();
    const outcome = await executor.execute(
      call({
        profile: "PERSON",
        changes: [{ field: "displayName", value: "Ada" }],
      }),
      contextFor(actorA, ownConversation(actorB)),
    );
    expect(outcome.status).not.toBe("SUCCEEDED");
    expect(prepared).toEqual([]);
  });
});

describe("what an authorised save is (live 2026-10-02)", () => {
  it("tells the model a save is the person's stated detail, never refused for being unverified", () => {
    const changes = ProposeProfileChangeInputSchema.shape.changes;
    expect(changes.description).toContain("Saving is not verifying");
    expect(changes.description).toContain("never refuse or argue");
    expect(changes.description).toContain("put every found field here at once");
  });
});
