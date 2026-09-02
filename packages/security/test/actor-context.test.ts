import { describe, expect, it } from "vitest";

import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "../src/identity/ids.js";
import { AuthenticatedPrincipalSchema } from "../src/identity/principal.js";
import {
  ActorContextSchema,
  type ActorContext,
} from "../src/actor-context/actor-context.js";
import { parseOrganisationSelector } from "../src/actor-context/selector.js";
import {
  requireHumanActorContext,
  resolveHumanActorContext,
  type ActorContextResolution,
  type ActorContextResolver,
} from "../src/actor-context/resolver.js";
import {
  ActorContextDeniedError,
  ActorContextRequiredError,
  ActorContextResolutionError,
} from "../src/actor-context/errors.js";
import { requireActorContext } from "../src/actor-context/guards.js";

// Synthetic identifiers only, parsed through their schemas so they carry the
// real brands rather than being cast into place.
const AUTH_USER_A = AuthUserIdSchema.parse(
  "a0000000-0000-4000-8000-000000000001",
);
const USER_A = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const TENANT_A = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG_A = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-000000000001",
);
const ORG_B = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-000000000002",
);
const MEMBERSHIP_A = MembershipIdSchema.parse(
  "e0000000-0000-4000-8000-000000000001",
);

const PRINCIPAL = { authUserId: AUTH_USER_A };

const CONTEXT_A: ActorContext = {
  userId: USER_A,
  tenantId: TENANT_A,
  organisationId: ORG_A,
  membershipId: MEMBERSHIP_A,
  actorType: "HUMAN",
};

/**
 * Test double for the resolver port. It lives in test source deliberately: a
 * permissive fake resolver shipped in production source is exactly the kind of
 * security shortcut that survives into a release.
 */
function fixedResolver(
  resolution: ActorContextResolution,
): ActorContextResolver {
  return { resolveHumanContext: () => Promise.resolve(resolution) };
}

describe("identity identifiers", () => {
  it("validates each identifier as a UUID", () => {
    for (const schema of [
      AuthUserIdSchema,
      UserIdSchema,
      TenantIdSchema,
      OrganisationIdSchema,
      MembershipIdSchema,
    ]) {
      expect(schema.safeParse(AUTH_USER_A).success).toBe(true);
      expect(schema.safeParse("not-a-uuid").success).toBe(false);
      expect(schema.safeParse(1).success).toBe(false);
    }
  });

  it("keeps AuthUserId and UserId as different types", () => {
    const authUserId = AuthUserIdSchema.parse(AUTH_USER_A);

    // The identity-provider subject is not the Capital Q person. Collapsing
    // them would make the auth subject permanently authoritative and bypass the
    // profile mapping where revocation lives.
    // @ts-expect-error an AuthUserId is not a UserId
    const wrong: ReturnType<typeof UserIdSchema.parse> = authUserId;

    expect(typeof wrong).toBe("string");
  });

  it("keeps TenantId and OrganisationId as different types", () => {
    const tenantId = TenantIdSchema.parse(TENANT_A);

    // V1 has one organisation per tenant, but that is a mapping, not an
    // identity. A future enterprise tenant holds several organisations.
    // @ts-expect-error a TenantId is not an OrganisationId
    const wrong: ReturnType<typeof OrganisationIdSchema.parse> = tenantId;

    expect(typeof wrong).toBe("string");
  });
});

describe("authenticated principal", () => {
  it("carries authentication identity and nothing else", () => {
    const parsed = AuthenticatedPrincipalSchema.parse({
      authUserId: AUTH_USER_A,
      // A client cannot make these trusted by sending them.
      tenantId: TENANT_A,
      organisationId: ORG_B,
      membershipId: MEMBERSHIP_A,
      role: "ADMIN",
      actorType: "SYSTEM",
    });

    expect(Object.keys(parsed)).toEqual(["authUserId"]);
  });
});

describe("actor context shape", () => {
  it("accepts a resolved human context", () => {
    expect(ActorContextSchema.safeParse(CONTEXT_A).success).toBe(true);
  });

  it("carries no roles, capabilities, title or admin flag", () => {
    const parsed = ActorContextSchema.parse({
      ...CONTEXT_A,
      roles: ["ADMIN"],
      capabilities: ["data_room.share"],
      businessTitle: "CEO",
      isPlatformAdmin: true,
      identityVerified: true,
    });

    // Authorization is a separate decision; a title is professional context,
    // not authority; and there is no platform-admin shortcut.
    for (const key of [
      "roles",
      "capabilities",
      "businessTitle",
      "isPlatformAdmin",
      "identityVerified",
    ]) {
      expect(parsed).not.toHaveProperty(key);
    }
  });

  it("requires a known actor type", () => {
    expect(
      ActorContextSchema.safeParse({ ...CONTEXT_A, actorType: "ADMIN" })
        .success,
    ).toBe(false);
  });
});

describe("organisation selector", () => {
  it("treats an absent header as no selection", () => {
    const result = parseOrganisationSelector(undefined);
    expect(result.ok && result.selection).toEqual({});
  });

  it("accepts a valid organisation identifier as a request, not a grant", () => {
    const result = parseOrganisationSelector(ORG_A);
    expect(result.ok && result.selection.organisationId).toBe(ORG_A);
  });

  it("rejects a malformed identifier before resolution", () => {
    expect(parseOrganisationSelector("not-a-uuid").ok).toBe(false);
    expect(parseOrganisationSelector("../../admin").ok).toBe(false);
  });
});

describe("context resolution", () => {
  it("resolves when the trusted resolver confirms the requested organisation", async () => {
    const resolution = await resolveHumanActorContext(
      fixedResolver({ status: "RESOLVED", context: CONTEXT_A }),
      { principal: PRINCIPAL, selection: { organisationId: ORG_A } },
    );

    expect(resolution.status).toBe("RESOLVED");
    if (resolution.status === "RESOLVED") {
      expect(resolution.context.tenantId).toBe(TENANT_A);
      expect(resolution.context.membershipId).toBe(MEMBERSHIP_A);
    }
  });

  it("fails closed when the requested organisation is inaccessible", async () => {
    const resolution = await resolveHumanActorContext(
      fixedResolver({ status: "CONTEXT_NOT_ACCESSIBLE" }),
      { principal: PRINCIPAL, selection: { organisationId: ORG_B } },
    );

    // No fallback to another organisation the account can reach.
    expect(resolution.status).toBe("CONTEXT_NOT_ACCESSIBLE");
    expect(resolution).not.toHaveProperty("context");
  });

  it("rejects a resolver that returns a different organisation than requested", async () => {
    const resolution = await resolveHumanActorContext(
      fixedResolver({ status: "RESOLVED", context: CONTEXT_A }),
      { principal: PRINCIPAL, selection: { organisationId: ORG_B } },
    );

    // Silently switching the caller to another organisation would execute their
    // action against the wrong tenant.
    expect(resolution.status).toBe("INVALID_CONTEXT");
  });

  it("does not choose a context when none was selected", async () => {
    const resolution = await resolveHumanActorContext(
      fixedResolver({ status: "CONTEXT_REQUIRED" }),
      { principal: PRINCIPAL },
    );

    // Never memberships[0]. Active organisation context is explicit.
    expect(resolution.status).toBe("CONTEXT_REQUIRED");
  });

  it("treats a historical membership as no current access", async () => {
    // A revoked or past membership resolves as inaccessible, not as context.
    const resolution = await resolveHumanActorContext(
      fixedResolver({ status: "CONTEXT_NOT_ACCESSIBLE" }),
      { principal: PRINCIPAL, selection: { organisationId: ORG_A } },
    );

    expect(resolution.status).toBe("CONTEXT_NOT_ACCESSIBLE");
  });

  it("rejects an organisation without the membership that granted it", async () => {
    const resolution = await resolveHumanActorContext(
      fixedResolver({
        status: "RESOLVED",
        // Organisation present, membership absent.
        context: (({ membershipId: _omitted, ...rest }) => rest)(CONTEXT_A),
      }),
      { principal: PRINCIPAL },
    );

    expect(resolution.status).toBe("INVALID_CONTEXT");
  });

  it("refuses a non-human actor type on the human request path", async () => {
    for (const actorType of ["Q", "SYSTEM", "CONNECTED_SYSTEM"] as const) {
      const resolution = await resolveHumanActorContext(
        fixedResolver({
          status: "RESOLVED",
          context: { ...CONTEXT_A, actorType },
        }),
        { principal: PRINCIPAL },
      );

      // A browser must never obtain a Q or SYSTEM context.
      expect(resolution.status).toBe("INVALID_CONTEXT");
    }
  });

  it("rejects a structurally invalid context from the resolver", async () => {
    const resolution = await resolveHumanActorContext(
      fixedResolver({
        status: "RESOLVED",
        context: { ...CONTEXT_A, tenantId: "not-a-uuid" } as never,
      }),
      { principal: PRINCIPAL },
    );

    expect(resolution.status).toBe("INVALID_CONTEXT");
  });
});

describe("requireHumanActorContext", () => {
  it("returns the context when resolved", async () => {
    const context = await requireHumanActorContext(
      fixedResolver({ status: "RESOLVED", context: CONTEXT_A }),
      { principal: PRINCIPAL },
    );

    expect(context.userId).toBe(USER_A);
  });

  it("throws a distinct error when a context must be chosen", async () => {
    await expect(
      requireHumanActorContext(fixedResolver({ status: "CONTEXT_REQUIRED" }), {
        principal: PRINCIPAL,
      }),
    ).rejects.toBeInstanceOf(ActorContextRequiredError);
  });

  it("gives the same denial whether there is no profile or no access", async () => {
    // Distinguishing them would be a membership oracle.
    for (const status of [
      "NO_APPLICATION_IDENTITY",
      "CONTEXT_NOT_ACCESSIBLE",
    ] as const) {
      await expect(
        requireHumanActorContext(fixedResolver({ status }), {
          principal: PRINCIPAL,
        }),
      ).rejects.toBeInstanceOf(ActorContextDeniedError);
    }
  });

  it("does not disclose organisation existence in the denial message", async () => {
    let caught: unknown;
    try {
      await requireHumanActorContext(
        fixedResolver({ status: "CONTEXT_NOT_ACCESSIBLE" }),
        { principal: PRINCIPAL, selection: { organisationId: ORG_B } },
      );
    } catch (error) {
      caught = error;
    }

    const message = (caught as Error).message;
    expect(message).not.toContain(ORG_B);
    expect(message.toLowerCase()).not.toContain("member");
    expect(message.toLowerCase()).not.toContain("exists");
  });

  it("throws an integrity error on an inconsistent resolver result", async () => {
    await expect(
      requireHumanActorContext(fixedResolver({ status: "INVALID_CONTEXT" }), {
        principal: PRINCIPAL,
      }),
    ).rejects.toBeInstanceOf(ActorContextResolutionError);
  });
});

describe("requireActorContext guard", () => {
  it("returns a present context", () => {
    expect(requireActorContext(CONTEXT_A).tenantId).toBe(TENANT_A);
  });

  it("fails closed on an absent context", () => {
    expect(() => requireActorContext(undefined)).toThrow(
      ActorContextRequiredError,
    );
  });
});
