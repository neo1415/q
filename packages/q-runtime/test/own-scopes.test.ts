import type {
  PermittedContextPlan,
  QKnowledgeScopeKind,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";
import { describe, expect, it } from "vitest";

import {
  ownsActorScope,
  ownsConversation,
  ownsOnboarding,
  type OwnActorScopeKind,
} from "../src/index.js";

/**
 * W2-A and W2-B (enterprise audit finding 8): the one own-conversation and
 * own-onboarding check, the same refusal matrix for both kinds.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "c0000000-0000-4000-8000-000000000002";
const FOUNDER = "b0000000-0000-4000-8000-000000000001";
const COLLEAGUE = "b0000000-0000-4000-8000-000000000002";
const ORG = "a0000000-0000-4000-8000-000000000001";

const member = {
  userId: FOUNDER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: "d0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
} as ActorContext;

/** A founder with no organisation yet, acting personally. */
const personal = {
  userId: FOUNDER,
  tenantId: TENANT,
  actorType: "HUMAN",
} as ActorContext;

/** The plan the firewall builds for an actor (only what the check reads). */
function planFor(
  actor: ActorContext,
  kinds: readonly QKnowledgeScopeKind[],
): PermittedContextPlan {
  return {
    tenantId: actor.tenantId,
    actor: {
      userId: actor.userId,
      ...(actor.organisationId === undefined
        ? {}
        : { organisationId: actor.organisationId }),
    },
    scopes: kinds.map((kind) => ({
      kind,
      filter: { tenantId: actor.tenantId, userId: actor.userId },
    })),
  } as unknown as PermittedContextPlan;
}

const KINDS: readonly OwnActorScopeKind[] = [
  "OWN_Q_CONVERSATION",
  "OWN_ONBOARDING",
];

describe.each(KINDS)("ownsActorScope(%s)", (kind) => {
  it("the owner passes, a founder with no organisation included", () => {
    expect(
      ownsActorScope({ actor: member, plan: planFor(member, [kind]) }, kind),
    ).toBe(true);
    expect(
      ownsActorScope(
        { actor: personal, plan: planFor(personal, [kind]) },
        kind,
      ),
    ).toBe(true);
  });

  it("another person in the same tenant is refused", () => {
    const colleague = { ...member, userId: COLLEAGUE } as ActorContext;
    expect(
      ownsActorScope({ actor: colleague, plan: planFor(member, [kind]) }, kind),
    ).toBe(false);
    const forged = {
      ...planFor(colleague, []),
      scopes: [{ kind, filter: { tenantId: TENANT, userId: FOUNDER } }],
    } as unknown as PermittedContextPlan;
    expect(ownsActorScope({ actor: colleague, plan: forged }, kind)).toBe(
      false,
    );
  });

  it("another tenant is refused", () => {
    const elsewhere = { ...member, tenantId: OTHER_TENANT } as ActorContext;
    expect(
      ownsActorScope({ actor: elsewhere, plan: planFor(member, [kind]) }, kind),
    ).toBe(false);
    const crossed = {
      ...planFor(member, []),
      scopes: [{ kind, filter: { tenantId: OTHER_TENANT, userId: FOUNDER } }],
    } as unknown as PermittedContextPlan;
    expect(ownsActorScope({ actor: member, plan: crossed }, kind)).toBe(false);
  });

  it("a revoked member's plan does not carry over, nor the reverse", () => {
    expect(
      ownsActorScope({ actor: personal, plan: planFor(member, [kind]) }, kind),
    ).toBe(false);
    expect(
      ownsActorScope({ actor: member, plan: planFor(personal, [kind]) }, kind),
    ).toBe(false);
  });

  it("only a person passes", () => {
    for (const actorType of ["Q", "SYSTEM", "CONNECTED_SYSTEM"] as const) {
      expect(
        ownsActorScope(
          { actor: { ...member, actorType }, plan: planFor(member, [kind]) },
          kind,
        ),
      ).toBe(false);
    }
  });

  it("the scope of the other kind, none, or a subject-bound one is refused", () => {
    const other = KINDS.find((k) => k !== kind) ?? kind;
    expect(
      ownsActorScope({ actor: member, plan: planFor(member, [other]) }, kind),
    ).toBe(false);
    expect(
      ownsActorScope({ actor: member, plan: planFor(member, []) }, kind),
    ).toBe(false);
    const plan = planFor(member, [kind]);
    const bound = {
      ...plan,
      scopes: plan.scopes.map((scope) => ({
        ...scope,
        subject: { kind: "USER", userId: FOUNDER },
      })),
    } as unknown as PermittedContextPlan;
    expect(ownsActorScope({ actor: member, plan: bound }, kind)).toBe(false);
  });
});

describe("the named checks", () => {
  it("ownsConversation and ownsOnboarding read their own kind only", () => {
    const conversation = planFor(personal, ["OWN_Q_CONVERSATION"]);
    const onboarding = planFor(personal, ["OWN_ONBOARDING"]);
    expect(ownsConversation({ actor: personal, plan: conversation })).toBe(
      true,
    );
    expect(ownsConversation({ actor: personal, plan: onboarding })).toBe(false);
    expect(ownsOnboarding({ actor: personal, plan: onboarding })).toBe(true);
    expect(ownsOnboarding({ actor: personal, plan: conversation })).toBe(false);
  });

  it("requireOrganisation refuses a person acting personally", () => {
    const plan = planFor(personal, ["OWN_Q_CONVERSATION"]);
    expect(
      ownsConversation(
        { actor: personal, plan },
        { requireOrganisation: true },
      ),
    ).toBe(false);
    expect(
      ownsConversation(
        { actor: member, plan: planFor(member, ["OWN_Q_CONVERSATION"]) },
        { requireOrganisation: true },
      ),
    ).toBe(true);
  });
});
