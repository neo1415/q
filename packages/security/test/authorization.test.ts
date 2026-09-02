import { describe, expect, it } from "vitest";

import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "../src/identity/ids.js";
import type { ActorContext } from "../src/actor-context/actor-context.js";
import {
  capability,
  CapabilitySchema,
  isKnownCapability,
  REFERENCE_CAPABILITIES,
} from "../src/authorization/capability.js";
import {
  ResourceIdSchema,
  scopeCovers,
  type ResourceScope,
} from "../src/authorization/resource-scope.js";
import { evaluateAuthorization } from "../src/authorization/evaluator.js";
import { createAuthorizationService } from "../src/authorization/service.js";
import {
  AuthorizationDeniedError,
  AuthorizationRequirementError,
} from "../src/authorization/errors.js";
import type {
  AuthorizationPolicyFacts,
  AuthorizationPolicySource,
} from "../src/authorization/policy.js";

// Synthetic identifiers, parsed through their schemas so they carry real brands.
const TENANT_A = TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000a");
const TENANT_B = TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000b");
const ORG_A = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-00000000000a",
);
const ORG_B = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-00000000000b",
);
const COMPANY_A = ResourceIdSchema.parse(
  "f0000000-0000-4000-8000-00000000000a",
);
const COMPANY_B = ResourceIdSchema.parse(
  "f0000000-0000-4000-8000-00000000000b",
);

const VIEW = capability("company.financials.view");
const EDIT = capability("company.financials.edit");

const humanA: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-00000000000a"),
  tenantId: TENANT_A,
  organisationId: ORG_A,
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-00000000000a",
  ),
  actorType: "HUMAN",
};

const tenantA: ResourceScope = { kind: "TENANT", tenantId: TENANT_A };
const tenantB: ResourceScope = { kind: "TENANT", tenantId: TENANT_B };
const orgA: ResourceScope = {
  kind: "ORGANISATION",
  tenantId: TENANT_A,
  organisationId: ORG_A,
};
const orgB: ResourceScope = {
  kind: "ORGANISATION",
  tenantId: TENANT_A,
  organisationId: ORG_B,
};
const companyA: ResourceScope = {
  kind: "RESOURCE",
  tenantId: TENANT_A,
  organisationId: ORG_A,
  resourceType: "company",
  resourceId: COMPANY_A,
};
const companyB: ResourceScope = {
  kind: "RESOURCE",
  tenantId: TENANT_A,
  organisationId: ORG_A,
  resourceType: "company",
  resourceId: COMPANY_B,
};
const companyInTenantB: ResourceScope = {
  kind: "RESOURCE",
  tenantId: TENANT_B,
  organisationId: ORG_B,
  resourceType: "company",
  resourceId: COMPANY_B,
};
const companyUnknownOwner: ResourceScope = {
  kind: "RESOURCE",
  tenantId: TENANT_A,
  resourceType: "company",
  resourceId: COMPANY_A,
};

const NO_FACTS: AuthorizationPolicyFacts = {
  grants: [],
  denials: [],
  unmetRequirements: [],
};

/** Test double. Lives in test source only; never a production default. */
function policy(
  facts: Partial<AuthorizationPolicyFacts>,
): AuthorizationPolicySource {
  return { getPolicyFacts: () => Promise.resolve({ ...NO_FACTS, ...facts }) };
}

describe("capability syntax", () => {
  it.each([...REFERENCE_CAPABILITIES])("accepts %s", (value) => {
    expect(CapabilitySchema.safeParse(value).success).toBe(true);
  });

  it.each([
    "ADMIN",
    "canViewEverything",
    "Company.Edit",
    "company-edit",
    "company",
    "",
  ])("rejects %s", (value) => {
    expect(CapabilitySchema.safeParse(value).success).toBe(false);
  });

  it("treats the reference registry as knowledge, not authority", () => {
    expect(isKnownCapability("company.financials.view")).toBe(true);
    expect(isKnownCapability("company.profile.view")).toBe(false);
    // Knowing a capability exists grants it to nobody: see deny-by-default.
  });
});

describe("scope coverage", () => {
  it("tenant grant covers targets in that tenant only", () => {
    expect(scopeCovers(tenantA, tenantA)).toBe(true);
    expect(scopeCovers(tenantA, orgA)).toBe(true);
    expect(scopeCovers(tenantA, companyA)).toBe(true);
    expect(scopeCovers(tenantA, tenantB)).toBe(false);
    expect(scopeCovers(tenantA, companyInTenantB)).toBe(false);
  });

  it("organisation grant covers its own organisation only", () => {
    expect(scopeCovers(orgA, orgA)).toBe(true);
    expect(scopeCovers(orgA, companyA)).toBe(true);
    expect(scopeCovers(orgA, orgB)).toBe(false);
    // Narrower than the tenant it lives in.
    expect(scopeCovers(orgA, tenantA)).toBe(false);
  });

  it("organisation grant does not cover a resource of unproven ownership", () => {
    // The resource states no organisation, so ownership is not assumed.
    expect(scopeCovers(orgA, companyUnknownOwner)).toBe(false);
  });

  it("resource grant covers the exact object only", () => {
    expect(scopeCovers(companyA, companyA)).toBe(true);
    expect(scopeCovers(companyA, companyB)).toBe(false);
    expect(scopeCovers(companyA, orgA)).toBe(false);
    expect(scopeCovers(companyA, tenantA)).toBe(false);
  });

  it("resource grant does not match a same-id object of another type", () => {
    const documentA: ResourceScope = { ...companyA, resourceType: "document" };
    expect(scopeCovers(companyA, documentA)).toBe(false);
  });

  it("never crosses a tenant boundary at any level", () => {
    const orgAInTenantB: ResourceScope = { ...orgA, tenantId: TENANT_B };
    expect(scopeCovers(orgA, orgAInTenantB)).toBe(false);
  });
});

describe("evaluator", () => {
  const request = (resource: ResourceScope, cap = VIEW, actor = humanA) => ({
    actor,
    capability: cap,
    resource,
  });

  it("denies by default with no grants", () => {
    const decision = evaluateAuthorization(request(companyA), NO_FACTS);
    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCode).toBe("NO_MATCHING_GRANT");
  });

  it("allows a matching grant with no denial and no requirements", () => {
    const decision = evaluateAuthorization(request(companyA), {
      ...NO_FACTS,
      grants: [{ capability: VIEW, scope: orgA, source: "ROLE_TEMPLATE" }],
    });

    expect(decision.outcome).toBe("ALLOW");
    expect(decision.reasonCode).toBe("CAPABILITY_GRANTED");
    if (decision.outcome === "ALLOW") {
      expect(decision.authority).toBe("ROLE_TEMPLATE");
    }
  });

  it("lets a resource-specific denial beat a tenant-wide grant", () => {
    const decision = evaluateAuthorization(request(companyA), {
      ...NO_FACTS,
      grants: [{ capability: VIEW, scope: tenantA }],
      denials: [{ capability: VIEW, scope: companyA }],
    });

    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCode).toBe("EXPLICIT_DENIAL");
  });

  it("lets a denial at the same scope beat a grant at the same scope", () => {
    const decision = evaluateAuthorization(request(companyA), {
      ...NO_FACTS,
      grants: [{ capability: VIEW, scope: companyA }],
      denials: [{ capability: VIEW, scope: companyA }],
    });

    expect(decision.outcome).toBe("DENY");
  });

  it("does not let a grant for one capability satisfy another", () => {
    const decision = evaluateAuthorization(request(companyA, EDIT), {
      ...NO_FACTS,
      grants: [{ capability: VIEW, scope: tenantA }],
    });

    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCode).toBe("NO_MATCHING_GRANT");
  });

  it("denies a tenant mismatch before consulting policy at all", () => {
    // Even a broad grant on the target tenant cannot help: the actor is not in
    // that tenant, and this check runs before policy facts are considered.
    const decision = evaluateAuthorization(request(companyInTenantB), {
      ...NO_FACTS,
      grants: [{ capability: VIEW, scope: tenantB }],
    });

    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCode).toBe("TENANT_MISMATCH");
  });

  it("denies an organisation mismatch within the same tenant", () => {
    const companyInOrgB: ResourceScope = { ...companyA, organisationId: ORG_B };
    const decision = evaluateAuthorization(request(companyInOrgB), {
      ...NO_FACTS,
      grants: [{ capability: VIEW, scope: tenantA }],
    });

    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCode).toBe("ORGANISATION_MISMATCH");
  });

  it("denies when organisation ownership of the resource is unproven", () => {
    const decision = evaluateAuthorization(request(companyUnknownOwner), {
      ...NO_FACTS,
      grants: [{ capability: VIEW, scope: orgA }],
    });

    expect(decision.outcome).toBe("DENY");
  });

  it.each([
    ["VERIFICATION", "REQUIRES_VERIFICATION"],
    ["STEP_UP", "REQUIRES_STEP_UP"],
    ["APPROVAL", "REQUIRES_APPROVAL"],
  ] as const)("maps unmet %s to %s", (requirement, outcome) => {
    const decision = evaluateAuthorization(request(companyA), {
      ...NO_FACTS,
      grants: [{ capability: VIEW, scope: orgA }],
      unmetRequirements: [requirement],
    });

    expect(decision.outcome).toBe(outcome);
    if (decision.outcome !== "ALLOW" && decision.outcome !== "DENY") {
      expect(decision.requirements).toEqual([requirement]);
    }
  });

  it("orders multiple unmet requirements deterministically", () => {
    const decision = evaluateAuthorization(request(companyA), {
      ...NO_FACTS,
      grants: [{ capability: VIEW, scope: orgA }],
      // Supplied out of order on purpose.
      unmetRequirements: ["APPROVAL", "STEP_UP", "VERIFICATION", "APPROVAL"],
    });

    expect(decision.outcome).toBe("REQUIRES_VERIFICATION");
    if (decision.outcome === "REQUIRES_VERIFICATION") {
      expect(decision.requirements).toEqual([
        "VERIFICATION",
        "STEP_UP",
        "APPROVAL",
      ]);
    }
  });

  it("does not let a requirement substitute for a missing grant", () => {
    // Verification is a condition on a held capability, not a capability.
    const decision = evaluateAuthorization(request(companyA), {
      ...NO_FACTS,
      unmetRequirements: [],
    });

    expect(decision.outcome).toBe("DENY");
  });

  it.each(["Q", "SYSTEM", "CONNECTED_SYSTEM"] as const)(
    "gives a %s actor no implicit authority",
    (actorType) => {
      const decision = evaluateAuthorization(
        request(companyA, VIEW, { ...humanA, actorType }),
        NO_FACTS,
      );

      expect(decision.outcome).toBe("DENY");
    },
  );

  it("enforces the object-level baseline: access to A is not access to B", () => {
    const facts: AuthorizationPolicyFacts = {
      ...NO_FACTS,
      grants: [{ capability: VIEW, scope: companyA }],
    };

    expect(evaluateAuthorization(request(companyA), facts).outcome).toBe(
      "ALLOW",
    );
    // Company B has a perfectly valid identifier. That is not enough.
    expect(evaluateAuthorization(request(companyB), facts).outcome).toBe(
      "DENY",
    );
  });

  it("denies a structurally invalid request rather than guessing", () => {
    const decision = evaluateAuthorization(
      {
        actor: { ...humanA, tenantId: "not-a-uuid" as never },
        capability: VIEW,
        resource: companyA,
      },
      { ...NO_FACTS, grants: [{ capability: VIEW, scope: tenantA }] },
    );

    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCode).toBe("INVALID_REQUEST");
  });
});

describe("authorization service", () => {
  const request = { actor: humanA, capability: VIEW, resource: companyA };

  it("returns without throwing on ALLOW", async () => {
    const service = createAuthorizationService(
      policy({ grants: [{ capability: VIEW, scope: orgA }] }),
    );

    await expect(service.requireCapability(request)).resolves.toBeUndefined();
  });

  it("throws AuthorizationDeniedError on DENY with a generic message", async () => {
    const service = createAuthorizationService(policy({}));

    let caught: unknown;
    try {
      await service.requireCapability(request);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuthorizationDeniedError);
    const denied = caught as AuthorizationDeniedError;
    expect(denied.reasonCode).toBe("NO_MATCHING_GRANT");
    // The reason is for logs and audit, never the public message.
    expect(denied.message).not.toContain("NO_MATCHING_GRANT");
    expect(denied.message).not.toContain(COMPANY_A);
  });

  it("throws AuthorizationRequirementError on a conditional outcome", async () => {
    const service = createAuthorizationService(
      policy({
        grants: [{ capability: VIEW, scope: orgA }],
        unmetRequirements: ["APPROVAL"],
      }),
    );

    let caught: unknown;
    try {
      await service.requireCapability(request);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuthorizationRequirementError);
    const required = caught as AuthorizationRequirementError;
    expect(required.outcome).toBe("REQUIRES_APPROVAL");
    expect(required.requirements).toEqual(["APPROVAL"]);
  });

  it("treats an unavailable policy source as a denial", async () => {
    const service = createAuthorizationService({
      getPolicyFacts: () => Promise.reject(new Error("policy store down")),
    });

    const decision = await service.authorize(request);
    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCode).toBe("POLICY_UNAVAILABLE");
  });

  it("preserves conditional outcomes rather than collapsing to boolean", async () => {
    const service = createAuthorizationService(
      policy({
        grants: [{ capability: VIEW, scope: orgA }],
        unmetRequirements: ["STEP_UP"],
      }),
    );

    const decision = await service.authorize(request);
    expect(decision.outcome).toBe("REQUIRES_STEP_UP");
  });
});
