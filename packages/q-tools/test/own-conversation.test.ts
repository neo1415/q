import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";
import { describe, expect, it } from "vitest";

import {
  createSetPreferenceLearningTool,
  ownsConversation,
} from "../src/index.js";

/**
 * W2-A (enterprise audit finding 8): the one own-conversation check, which
 * replaced 23 copies and 4 inline variants.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "c0000000-0000-4000-8000-000000000002";
const OWNER = "b0000000-0000-4000-8000-000000000001";
const COLLEAGUE = "b0000000-0000-4000-8000-000000000002";
const ORG = "a0000000-0000-4000-8000-000000000001";
const MEMBERSHIP = "d0000000-0000-4000-8000-000000000001";

const owner: ActorContext = {
  userId: OWNER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: MEMBERSHIP,
  actorType: "HUMAN",
} as ActorContext;

/** The plan the firewall builds for an actor (only what the check reads). */
function planFor(actor: {
  readonly userId: string;
  readonly tenantId: string;
  readonly organisationId?: string | undefined;
}): PermittedContextPlan {
  return {
    tenantId: actor.tenantId,
    actor: {
      userId: actor.userId,
      ...(actor.organisationId === undefined
        ? {}
        : { organisationId: actor.organisationId }),
    },
    scopes: [
      {
        kind: "OWN_Q_CONVERSATION",
        filter: { tenantId: actor.tenantId, userId: actor.userId },
      },
    ],
  } as unknown as PermittedContextPlan;
}

describe("ownsConversation", () => {
  it("the owner reaches their own conversation, with or without an organisation", () => {
    expect(ownsConversation({ actor: owner, plan: planFor(owner) })).toBe(true);
    const personal = {
      userId: OWNER,
      tenantId: TENANT,
      actorType: "HUMAN",
    } as ActorContext;
    expect(ownsConversation({ actor: personal, plan: planFor(personal) })).toBe(
      true,
    );
  });

  it("another person in the same tenant does not reach the owner's", () => {
    const colleague = { ...owner, userId: COLLEAGUE } as ActorContext;
    expect(ownsConversation({ actor: colleague, plan: planFor(owner) })).toBe(
      false,
    );
    // Nor with a plan bound to them but a scope bound to the owner.
    const mixed = planFor(colleague);
    const forged = {
      ...mixed,
      scopes: [
        {
          kind: "OWN_Q_CONVERSATION",
          filter: { tenantId: TENANT, userId: OWNER },
        },
      ],
    } as unknown as PermittedContextPlan;
    expect(ownsConversation({ actor: colleague, plan: forged })).toBe(false);
  });

  it("the same person id in another tenant is refused", () => {
    const elsewhere = { ...owner, tenantId: OTHER_TENANT } as ActorContext;
    expect(ownsConversation({ actor: elsewhere, plan: planFor(owner) })).toBe(
      false,
    );
    // A scope bound to another tenant than the plan's is refused too.
    const plan = planFor(owner);
    const crossed = {
      ...plan,
      scopes: [
        {
          kind: "OWN_Q_CONVERSATION",
          filter: { tenantId: OTHER_TENANT, userId: OWNER },
        },
      ],
    } as unknown as PermittedContextPlan;
    expect(ownsConversation({ actor: owner, plan: crossed })).toBe(false);
  });

  it("a revoked member: a plan made under the membership does not carry over", () => {
    // Their membership has gone: the server now resolves them personally.
    const revoked = {
      userId: OWNER,
      tenantId: TENANT,
      actorType: "HUMAN",
    } as ActorContext;
    expect(ownsConversation({ actor: revoked, plan: planFor(owner) })).toBe(
      false,
    );
    // And an organisation the plan was not made for is refused.
    expect(
      ownsConversation({
        actor: owner,
        plan: planFor({ userId: OWNER, tenantId: TENANT }),
      }),
    ).toBe(false);
  });

  it("only a person: Q, the system and a connected system are refused", () => {
    for (const actorType of ["Q", "SYSTEM", "CONNECTED_SYSTEM"] as const) {
      expect(
        ownsConversation({
          actor: { ...owner, actorType },
          plan: planFor(owner),
        }),
      ).toBe(false);
    }
  });

  it("no own-conversation scope, or one bound to a subject, is refused", () => {
    const plan = planFor(owner);
    expect(
      ownsConversation({
        actor: owner,
        plan: { ...plan, scopes: [] },
      }),
    ).toBe(false);
    const bound = {
      ...plan,
      scopes: plan.scopes.map((scope) => ({
        ...scope,
        subject: { kind: "USER", userId: OWNER },
      })),
    } as unknown as PermittedContextPlan;
    expect(ownsConversation({ actor: owner, plan: bound })).toBe(false);
  });

  it("requireOrganisation refuses a person acting personally", () => {
    const personal = {
      userId: OWNER,
      tenantId: TENANT,
      actorType: "HUMAN",
    } as ActorContext;
    expect(
      ownsConversation(
        { actor: personal, plan: planFor(personal) },
        { requireOrganisation: true },
      ),
    ).toBe(false);
    expect(
      ownsConversation(
        { actor: owner, plan: planFor(owner) },
        { requireOrganisation: true },
      ),
    ).toBe(true);
  });

  it("a tool asks the shared check: another person's plan is denied", async () => {
    const tool = createSetPreferenceLearningTool({
      decide: (_actor, choice) => Promise.resolve({ status: choice }),
    });
    const ask = (actor: ActorContext) =>
      tool.authorize({ choice: "ALLOW", quote: "yes, go ahead" }, {
        actor,
        plan: planFor(owner),
        conversation: { latestUserText: "Yes, go ahead." },
      } as never);
    expect((await ask(owner)).outcome).toBe("ALLOW");
    expect(
      (await ask({ ...owner, userId: COLLEAGUE } as ActorContext)).outcome,
    ).toBe("DENY");
  });
});
