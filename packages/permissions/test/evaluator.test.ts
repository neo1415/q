import { describe, expect, it } from "vitest";

import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  actorPrincipal,
  ANONYMOUS_PRINCIPAL,
  DisclosurePolicyIdSchema,
  type DisclosureAccessLevel,
  type DisclosurePolicy,
  type DisclosurePrincipal,
  type DisclosureResourceDescriptor,
  type DisclosureScope,
  type RelationshipParties,
} from "../src/contracts/index.js";
import {
  evaluateDisclosure,
  evaluateDisclosureMany,
  type DisclosureEvaluationRequest,
} from "../src/domain/evaluator.js";

/**
 * The pure evaluator against synthetic facts. Nothing here touches a
 * database: these are the semantics every surface (API, Q Context
 * Firewall, retrieval, Data Room, public projections) will share.
 */

const TENANT_C = TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000c");
const TENANT_I = TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000d");
const TENANT_H = TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000e");
const ORG_ALPHA = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-00000000000a",
);
const ORG_APEX = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-00000000000b",
);
const ORG_HORIZON = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-00000000000c",
);
const FOUNDER = UserIdSchema.parse("b0000000-0000-4000-8000-00000000000a");
const COLLEAGUE = UserIdSchema.parse("b0000000-0000-4000-8000-00000000000b");
const APEX_REP = UserIdSchema.parse("b0000000-0000-4000-8000-00000000000c");
const HORIZON_REP = UserIdSchema.parse("b0000000-0000-4000-8000-00000000000d");
const MEMBERSHIP_APEX = MembershipIdSchema.parse(
  "e0000000-0000-4000-8000-00000000000c",
);
const RELATIONSHIP_A_APEX = "f0000000-0000-4000-8000-000000000001";
const RELATIONSHIP_A_HORIZON = "f0000000-0000-4000-8000-000000000002";
const RESOURCE = {
  type: "company",
  id: "f0000000-0000-4000-8000-0000000000a1",
} as const;
const NOW = "2026-09-04T12:00:00.000Z";

function actor(
  userId: ActorContext["userId"],
  tenantId: ActorContext["tenantId"],
  organisationId: ActorContext["organisationId"],
  extra: Partial<ActorContext> = {},
): ActorContext {
  return {
    userId,
    tenantId,
    organisationId,
    membershipId: MembershipIdSchema.parse(
      "e0000000-0000-4000-8000-000000000001",
    ),
    actorType: "HUMAN",
    ...extra,
  };
}

const founder = actorPrincipal(actor(FOUNDER, TENANT_C, ORG_ALPHA));
const colleague = actorPrincipal(actor(COLLEAGUE, TENANT_C, ORG_ALPHA));
const apex = actorPrincipal(
  actor(APEX_REP, TENANT_I, ORG_APEX, { membershipId: MEMBERSHIP_APEX }),
);
const horizon = actorPrincipal(actor(HORIZON_REP, TENANT_H, ORG_HORIZON));
const qActor: DisclosurePrincipal = actorPrincipal(
  actor(FOUNDER, TENANT_C, ORG_ALPHA, { actorType: "Q" }),
);

const PARTIES: Readonly<Record<string, RelationshipParties>> = {
  [RELATIONSHIP_A_APEX]: {
    relationshipId: RELATIONSHIP_A_APEX,
    company: { organisationId: ORG_ALPHA, tenantId: TENANT_C },
    investor: { organisationId: ORG_APEX, tenantId: TENANT_I },
  },
  [RELATIONSHIP_A_HORIZON]: {
    relationshipId: RELATIONSHIP_A_HORIZON,
    company: { organisationId: ORG_ALPHA, tenantId: TENANT_C },
    investor: { organisationId: ORG_HORIZON, tenantId: TENANT_H },
  },
};

function descriptor(
  overrides: Partial<DisclosureResourceDescriptor> = {},
): DisclosureResourceDescriptor {
  return {
    resource: RESOURCE,
    tenantId: TENANT_C,
    ownerOrganisationId: ORG_ALPHA,
    ...overrides,
  };
}

let sequence = 0;
function policy(overrides: Partial<DisclosurePolicy>): DisclosurePolicy {
  sequence += 1;
  return {
    id: DisclosurePolicyIdSchema.parse(
      `a0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    ),
    tenantId: TENANT_C,
    ownerUserId: null,
    ownerOrganisationId: ORG_ALPHA,
    resource: RESOURCE,
    scopeType: "specifically_shared",
    recipient: { type: "ORGANISATION", id: ORG_APEX },
    accessLevel: "view",
    expiresAt: null,
    createdByUserId: FOUNDER,
    createdAt: "2026-09-01T00:00:00.000Z",
    revokedAt: null,
    ...overrides,
  };
}

function evaluate(
  principal: DisclosurePrincipal,
  resource: DisclosureResourceDescriptor,
  policies: readonly DisclosurePolicy[] = [],
  requestedAccess: DisclosureAccessLevel = "view",
  now = NOW,
) {
  const request: DisclosureEvaluationRequest = {
    principal,
    resource,
    requestedAccess,
    policies,
    relationshipParties: PARTIES,
    now,
  };
  return evaluateDisclosure(request);
}

const outcome = (
  principal: DisclosurePrincipal,
  resource: DisclosureResourceDescriptor,
  policies: readonly DisclosurePolicy[] = [],
) => evaluate(principal, resource, policies).outcome;

describe("cross-party matrix (§186)", () => {
  const founderPrivate = descriptor({ intrinsicScope: "founder_private" });
  const investorPrivateApex = descriptor({
    tenantId: TENANT_I,
    ownerOrganisationId: ORG_APEX,
    intrinsicScope: "investor_private",
  });
  const relationshipShared = descriptor({
    ownerOrganisationId: undefined,
    relationshipId: RELATIONSHIP_A_APEX,
    intrinsicScope: "relationship_shared",
  });
  const specificApex = [policy({})];
  const networkVisible = descriptor({ intrinsicScope: "network_visible" });
  const publicExternal = descriptor({ intrinsicScope: "public_external" });

  it.each<
    [
      string,
      DisclosureResourceDescriptor,
      readonly DisclosurePolicy[],
      string[],
    ]
  >([
    ["founder_private", founderPrivate, [], ["ALLOW", "DENY", "DENY", "DENY"]],
    [
      "investor_private (Apex)",
      investorPrivateApex,
      [],
      ["DENY", "ALLOW", "DENY", "DENY"],
    ],
    [
      "relationship_shared A-Apex",
      relationshipShared,
      [],
      ["ALLOW", "ALLOW", "DENY", "DENY"],
    ],
    [
      "specifically_shared Apex (owner via founder_private)",
      founderPrivate,
      specificApex,
      ["ALLOW", "ALLOW", "DENY", "DENY"],
    ],
    [
      "network_visible",
      networkVisible,
      [],
      ["ALLOW", "ALLOW", "ALLOW", "DENY"],
    ],
    [
      "public_external",
      publicExternal,
      [],
      ["ALLOW", "ALLOW", "ALLOW", "ALLOW"],
    ],
  ])("%s", (_label, resource, policies, expected) => {
    expect([
      outcome(founder, resource, policies),
      outcome(apex, resource, policies),
      outcome(horizon, resource, policies),
      outcome(ANONYMOUS_PRINCIPAL, resource, policies),
    ]).toEqual(expected);
  });

  it("a relationship does not turn founder_private into investor access, nor investor_private into founder access", () => {
    // Apex has relationship A-Apex; the resource still belongs to Alpha only.
    const founderNote = descriptor({
      intrinsicScope: "founder_private",
      relationshipId: RELATIONSHIP_A_APEX,
    });
    expect(evaluate(apex, founderNote)).toMatchObject({
      outcome: "DENY",
      reasonCode: "NO_MATCHING_SCOPE",
    });
    const investorCeiling = descriptor({
      tenantId: TENANT_I,
      ownerOrganisationId: ORG_APEX,
      intrinsicScope: "investor_private",
      relationshipId: RELATIONSHIP_A_APEX,
    });
    expect(evaluate(founder, investorCeiling).outcome).toBe("DENY");
    expect(evaluate(apex, investorCeiling)).toMatchObject({
      outcome: "ALLOW",
      reasonCode: "SAME_ORGANISATION",
      grantedAccess: "view_download",
    });
  });
});

describe("relationship sharing (§62-64, §130, §139-140)", () => {
  const shared = descriptor({
    ownerOrganisationId: undefined,
    relationshipId: RELATIONSHIP_A_APEX,
    intrinsicScope: "relationship_shared",
  });

  it("admits exactly the two canonical parties across tenants; the storage tenant is not the rule", () => {
    expect(evaluate(founder, shared)).toMatchObject({
      outcome: "ALLOW",
      reasonCode: "RELATIONSHIP_PARTY",
    });
    expect(evaluate(apex, shared)).toMatchObject({
      outcome: "ALLOW",
      reasonCode: "RELATIONSHIP_PARTY",
    });
    // Horizon has its own relationship with Alpha; still not a party here.
    expect(evaluate(horizon, shared).outcome).toBe("DENY");
    expect(evaluate(ANONYMOUS_PRINCIPAL, shared).outcome).toBe("DENY");
  });

  it("an explicit relationship share admits only that relationship's parties", () => {
    const toApexRelationship = [
      policy({
        scopeType: "relationship_shared",
        recipient: { type: "RELATIONSHIP", id: RELATIONSHIP_A_APEX },
      }),
    ];
    const resource = descriptor({ intrinsicScope: "founder_private" });
    expect(evaluate(apex, resource, toApexRelationship).outcome).toBe("ALLOW");
    expect(evaluate(horizon, resource, toApexRelationship).outcome).toBe(
      "DENY",
    );
    const specificRelationship = [
      policy({
        recipient: { type: "RELATIONSHIP", id: RELATIONSHIP_A_HORIZON },
      }),
    ];
    expect(evaluate(horizon, resource, specificRelationship).outcome).toBe(
      "ALLOW",
    );
    expect(evaluate(apex, resource, specificRelationship)).toMatchObject({
      outcome: "DENY",
      reasonCode: "WRONG_RECIPIENT",
    });
  });

  it("unresolved relationship parties fail closed", () => {
    const unknown = descriptor({
      ownerOrganisationId: undefined,
      relationshipId: "f0000000-0000-4000-8000-0000000000ff",
      intrinsicScope: "relationship_shared",
    });
    expect(evaluate(founder, unknown)).toMatchObject({
      outcome: "DENY",
      reasonCode: "UNRESOLVED_RELATIONSHIP",
    });
    const noRelationship = descriptor({
      ownerOrganisationId: undefined,
      intrinsicScope: "relationship_shared",
    });
    expect(evaluate(founder, noRelationship).outcome).toBe("DENY");
  });
});

describe("private scopes (§58-61, §122-123)", () => {
  it("personal_private admits the owning Person only; a colleague is not enough", () => {
    const note = descriptor({
      ownerUserId: FOUNDER,
      intrinsicScope: "personal_private",
    });
    expect(evaluate(founder, note)).toMatchObject({
      outcome: "ALLOW",
      reasonCode: "OWNER",
    });
    expect(evaluate(colleague, note).outcome).toBe("DENY");
    expect(evaluate(apex, note).outcome).toBe("DENY");
  });

  it("organisation_private admits members of the owning organisation", () => {
    const resource = descriptor({ intrinsicScope: "organisation_private" });
    expect(evaluate(founder, resource).reasonCode).toBe("SAME_ORGANISATION");
    expect(evaluate(colleague, resource).outcome).toBe("ALLOW");
    expect(evaluate(apex, resource).outcome).toBe("DENY");
    const personal = actorPrincipal(actor(FOUNDER, TENANT_C, undefined));
    expect(evaluate(personal, resource).outcome).toBe("DENY");
  });

  it("owner access survives sharing (§71)", () => {
    const resource = descriptor({ intrinsicScope: "founder_private" });
    const shares = [
      policy({ recipient: { type: "ORGANISATION", id: ORG_APEX } }),
    ];
    expect(evaluate(founder, resource, shares)).toMatchObject({
      outcome: "ALLOW",
      via: { kind: "INTRINSIC" },
    });
  });
});

describe("network vs public (§69-70, §124-126)", () => {
  it("network_visible needs an authenticated context; public_external does not", () => {
    const network = descriptor({ intrinsicScope: "network_visible" });
    expect(evaluate(ANONYMOUS_PRINCIPAL, network)).toMatchObject({
      outcome: "DENY",
      reasonCode: "AUTHENTICATION_REQUIRED",
    });
    expect(evaluate(horizon, network)).toMatchObject({
      outcome: "ALLOW",
      reasonCode: "NETWORK_VISIBLE",
      grantedAccess: "view",
    });
    expect(
      evaluate(
        ANONYMOUS_PRINCIPAL,
        descriptor({ intrinsicScope: "public_external" }),
      ),
    ).toMatchObject({
      outcome: "ALLOW",
      reasonCode: "PUBLIC_EXTERNAL",
    });
  });

  it("intrinsic network/public visibility is view-only; download needs a deliberate policy", () => {
    const network = descriptor({ intrinsicScope: "network_visible" });
    expect(evaluate(horizon, network, [], "view_download")).toMatchObject({
      outcome: "DENY",
      reasonCode: "INSUFFICIENT_ACCESS_LEVEL",
    });
    const download = [
      policy({
        recipient: { type: "ORGANISATION", id: ORG_HORIZON },
        accessLevel: "view_download",
      }),
    ];
    expect(evaluate(horizon, network, download, "view_download").outcome).toBe(
      "ALLOW",
    );
  });
});

describe("specific recipients (§65-68, §127-129)", () => {
  const resource = descriptor({ intrinsicScope: "founder_private" });

  it("USER, MEMBERSHIP and ORGANISATION recipients match exactly", () => {
    const toUser = [policy({ recipient: { type: "USER", id: APEX_REP } })];
    expect(evaluate(apex, resource, toUser).reasonCode).toBe(
      "EXPLICIT_RECIPIENT",
    );
    expect(evaluate(horizon, resource, toUser)).toMatchObject({
      outcome: "DENY",
      reasonCode: "WRONG_RECIPIENT",
    });

    const toMembership = [
      policy({ recipient: { type: "MEMBERSHIP", id: MEMBERSHIP_APEX } }),
    ];
    expect(evaluate(apex, resource, toMembership).outcome).toBe("ALLOW");
    const otherMembership = actorPrincipal(
      actor(APEX_REP, TENANT_I, ORG_APEX, {
        membershipId: MembershipIdSchema.parse(
          "e0000000-0000-4000-8000-0000000000ff",
        ),
      }),
    );
    expect(evaluate(otherMembership, resource, toMembership).outcome).toBe(
      "DENY",
    );

    const toOrganisation = [
      policy({ recipient: { type: "ORGANISATION", id: ORG_HORIZON } }),
    ];
    expect(evaluate(horizon, resource, toOrganisation).outcome).toBe("ALLOW");
    expect(evaluate(apex, resource, toOrganisation).outcome).toBe("DENY");
  });

  it("an intrinsic specifically_shared classification without recipients grants nobody but the owner", () => {
    const classified = descriptor({
      ownerUserId: FOUNDER,
      intrinsicScope: "specifically_shared",
    });
    expect(evaluate(apex, classified).outcome).toBe("DENY");
    expect(evaluate(founder, classified).outcome).toBe("DENY");
  });
});

describe("lifecycle (§48-50, §114-117, §131-132)", () => {
  const resource = descriptor({ intrinsicScope: "founder_private" });

  it("expiry is decided by the injected instant; expired ≠ revoked", () => {
    const expiring = [policy({ expiresAt: "2026-09-10T00:00:00.000Z" })];
    expect(
      evaluate(apex, resource, expiring, "view", "2026-09-05T00:00:00.000Z")
        .outcome,
    ).toBe("ALLOW");
    expect(
      evaluate(apex, resource, expiring, "view", "2026-09-11T00:00:00.000Z"),
    ).toMatchObject({ outcome: "DENY", reasonCode: "POLICY_EXPIRED" });
    const revoked = [policy({ revokedAt: "2026-09-02T00:00:00.000Z" })];
    expect(evaluate(apex, resource, revoked)).toMatchObject({
      outcome: "DENY",
      reasonCode: "POLICY_REVOKED",
    });
  });

  it("revoking one path leaves other independent paths intact (§115)", () => {
    const network = descriptor({ intrinsicScope: "network_visible" });
    const revokedSpecific = [policy({ revokedAt: "2026-09-02T00:00:00.000Z" })];
    expect(evaluate(apex, network, revokedSpecific)).toMatchObject({
      outcome: "ALLOW",
      reasonCode: "NETWORK_VISIBLE",
    });
  });

  it("view never satisfies download; view_download satisfies both (§133)", () => {
    const view = [policy({ accessLevel: "view" })];
    expect(evaluate(apex, resource, view, "view").outcome).toBe("ALLOW");
    expect(evaluate(apex, resource, view, "view_download")).toMatchObject({
      outcome: "DENY",
      reasonCode: "INSUFFICIENT_ACCESS_LEVEL",
    });
    const download = [policy({ accessLevel: "view_download" })];
    expect(evaluate(apex, resource, download, "view").outcome).toBe("ALLOW");
    expect(evaluate(apex, resource, download, "view_download").outcome).toBe(
      "ALLOW",
    );
  });
});

describe("deny by default and ambient authority (§38, §77, §137-138, §142)", () => {
  it("unknown scope with no policy is DENY, even for the owner organisation", () => {
    expect(evaluate(founder, descriptor())).toMatchObject({
      outcome: "DENY",
      reasonCode: "UNKNOWN_RESOURCE_SCOPE",
    });
  });

  it("Q, SYSTEM and CONNECTED_SYSTEM principals hold zero disclosure authority", () => {
    const resource = descriptor({ intrinsicScope: "public_external" });
    expect(evaluate(qActor, resource)).toMatchObject({
      outcome: "DENY",
      reasonCode: "NON_HUMAN_PRINCIPAL",
    });
    for (const actorType of ["SYSTEM", "CONNECTED_SYSTEM"] as const) {
      expect(
        evaluate(
          actorPrincipal(actor(FOUNDER, TENANT_C, ORG_ALPHA, { actorType })),
          resource,
        ).outcome,
      ).toBe("DENY");
    }
  });

  it("policies for another resource are never evidence, and malformed requests are denied", () => {
    const other = [
      policy({
        resource: {
          type: "company",
          id: "f0000000-0000-4000-8000-0000000000a2",
        },
      }),
    ];
    expect(
      evaluate(apex, descriptor({ intrinsicScope: "founder_private" }), other)
        .outcome,
    ).toBe("DENY");
    expect(
      evaluateDisclosure({
        principal: { kind: "ACTOR", actor: {} as ActorContext },
        resource: descriptor({ intrinsicScope: "public_external" }),
        requestedAccess: "view",
        policies: [],
        relationshipParties: {},
        now: NOW,
      }),
    ).toMatchObject({ outcome: "DENY", reasonCode: "INVALID_REQUEST" });
  });

  it("scopes are predicates, not a ladder", () => {
    const scopes: DisclosureScope[] = ["founder_private", "investor_private"];
    const [founderSide, investorSide] = scopes.map((scope) =>
      descriptor({
        intrinsicScope: scope,
        ownerOrganisationId: scope === "founder_private" ? ORG_ALPHA : ORG_APEX,
      }),
    );
    if (founderSide === undefined || investorSide === undefined) {
      throw new Error("unreachable");
    }
    expect(evaluate(founder, founderSide).outcome).toBe("ALLOW");
    expect(evaluate(founder, investorSide).outcome).toBe("DENY");
    expect(evaluate(apex, founderSide).outcome).toBe("DENY");
    expect(evaluate(apex, investorSide).outcome).toBe("ALLOW");
  });

  it("batch evaluation is item-wise identical to single evaluation", () => {
    const requests: DisclosureEvaluationRequest[] = [
      {
        principal: founder,
        resource: descriptor({ intrinsicScope: "founder_private" }),
        requestedAccess: "view",
        policies: [],
        relationshipParties: PARTIES,
        now: NOW,
      },
      {
        principal: apex,
        resource: descriptor({ intrinsicScope: "founder_private" }),
        requestedAccess: "view",
        policies: [],
        relationshipParties: PARTIES,
        now: NOW,
      },
    ];
    expect(evaluateDisclosureMany(requests)).toEqual(
      requests.map(evaluateDisclosure),
    );
  });
});
