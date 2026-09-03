import { describe, expect, it } from "vitest";

import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import { REFERENCE_CAPABILITIES } from "@capital-q/security";

import {
  accessLevelSatisfies,
  DISCLOSURE_ACCESS_LEVELS,
  DISCLOSURE_RECIPIENT_TYPES,
  DISCLOSURE_RESOURCE_TYPES,
  DISCLOSURE_SCOPES,
  DisclosurePolicyIdSchema,
  DisclosureRecipientSchema,
  DisclosureResourceRefSchema,
  DisclosureScopeSchema,
  policyStatusAt,
  type DisclosurePolicy,
} from "../src/contracts/index.js";
import { DisclosurePolicyInvalidError } from "../src/domain/errors.js";
import {
  sameCanonicalPolicy,
  sameGrantIdentity,
  validatePolicyShape,
} from "../src/domain/policy-rules.js";
import {
  disclosureGrantedEvent,
  disclosureRevokedEvent,
  PERMISSIONS_EVENTS,
} from "../src/events/index.js";
import * as permissions from "../src/index.js";
import { createDisclosureResourceResolverRegistry } from "../src/application/resolver-registry.js";

const POLICY: DisclosurePolicy = {
  id: DisclosurePolicyIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
  tenantId:
    "c0000000-0000-4000-8000-000000000001" as DisclosurePolicy["tenantId"],
  ownerUserId: null,
  ownerOrganisationId:
    "d0000000-0000-4000-8000-000000000001" as DisclosurePolicy["ownerOrganisationId"],
  resource: { type: "company", id: "f0000000-0000-4000-8000-000000000001" },
  scopeType: "specifically_shared",
  recipient: {
    type: "ORGANISATION",
    id: "d0000000-0000-4000-8000-000000000002",
  },
  accessLevel: "view",
  expiresAt: null,
  createdByUserId:
    "b0000000-0000-4000-8000-000000000001" as DisclosurePolicy["createdByUserId"],
  createdAt: "2026-09-01T00:00:00.000Z",
  revokedAt: null,
};

describe("canonical vocabularies (§8-10, §39, §42, §223)", () => {
  it("exactly the eight ADR-001 scopes exist; no aliases", () => {
    expect([...DISCLOSURE_SCOPES]).toEqual([
      "personal_private",
      "organisation_private",
      "founder_private",
      "investor_private",
      "relationship_shared",
      "specifically_shared",
      "network_visible",
      "public_external",
    ]);
    for (const alias of ["public", "owner_private", "private", "shared"]) {
      expect(DisclosureScopeSchema.safeParse(alias).success).toBe(false);
    }
  });

  it("access levels are view and view_download, ordered explicitly (§45)", () => {
    expect([...DISCLOSURE_ACCESS_LEVELS]).toEqual(["view", "view_download"]);
    expect(accessLevelSatisfies("view_download", "view")).toBe(true);
    expect(accessLevelSatisfies("view", "view_download")).toBe(false);
    expect(accessLevelSatisfies("view", "view")).toBe(true);
  });

  it("recipients are USER / MEMBERSHIP / ORGANISATION / RELATIONSHIP with UUID identity only", () => {
    expect([...DISCLOSURE_RECIPIENT_TYPES]).toEqual([
      "USER",
      "MEMBERSHIP",
      "ORGANISATION",
      "RELATIONSHIP",
    ]);
    expect(
      DisclosureRecipientSchema.safeParse({
        type: "EMAIL",
        id: "someone@example.invalid",
      }).success,
    ).toBe(false);
    expect(
      DisclosureRecipientSchema.safeParse({
        type: "USER",
        id: "someone@example.invalid",
      }).success,
    ).toBe(false);
  });

  it("resource kinds are bounded to those with resolvers; no table names or field paths", () => {
    expect([...DISCLOSURE_RESOURCE_TYPES]).toEqual([
      "company",
      "founder_profile",
      "investor_organisation",
      "investor_mandate",
      "capital_objective",
      "relationship",
      "relationship_event",
    ]);
    expect(
      DisclosureResourceRefSchema.safeParse({
        type: "core.companies",
        id: "f0000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
    expect(
      DisclosureResourceRefSchema.safeParse({
        type: "company",
        id: "company123.amount",
      }).success,
    ).toBe(false);
    const registry = createDisclosureResourceResolverRegistry([]);
    expect(registry.types()).toEqual([]);
    expect(registry.has("company")).toBe(false);
  });

  it("disclosure.manage and disclosure.inspect are registered capabilities", () => {
    expect(REFERENCE_CAPABILITIES).toContain("disclosure.manage");
    expect(REFERENCE_CAPABILITIES).toContain("disclosure.inspect");
  });
});

describe("policy rules (§40-41, §52-53)", () => {
  it("recipient presence follows the scope", () => {
    expect(() =>
      validatePolicyShape({
        scopeType: "specifically_shared",
        recipient: null,
        accessLevel: "view",
      }),
    ).toThrow(DisclosurePolicyInvalidError);
    expect(() =>
      validatePolicyShape({
        scopeType: "relationship_shared",
        recipient: { type: "ORGANISATION", id: POLICY.resource.id },
        accessLevel: "view",
      }),
    ).toThrow(/not valid/);
    for (const scopeType of [
      "personal_private",
      "organisation_private",
      "founder_private",
      "investor_private",
      "network_visible",
      "public_external",
    ] as const) {
      expect(() =>
        validatePolicyShape({
          scopeType,
          recipient: { type: "USER", id: POLICY.resource.id },
          accessLevel: "view",
        }),
      ).toThrow(DisclosurePolicyInvalidError);
      expect(() =>
        validatePolicyShape({
          scopeType,
          recipient: null,
          accessLevel: "view",
        }),
      ).not.toThrow();
    }
  });

  it("grant identity ignores expiry; canonical identity includes owner and expiry", () => {
    const later: DisclosurePolicy = {
      ...POLICY,
      expiresAt: "2027-01-01T00:00:00.000Z",
    };
    expect(sameGrantIdentity(POLICY, later)).toBe(true);
    expect(
      sameGrantIdentity(POLICY, { ...POLICY, accessLevel: "view_download" }),
    ).toBe(false);
    expect(sameCanonicalPolicy(POLICY, { ...POLICY })).toBe(true);
    expect(
      sameCanonicalPolicy(POLICY, {
        ...POLICY,
        expiresAt: "2027-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      sameCanonicalPolicy(POLICY, {
        ...POLICY,
        recipient: { type: "USER", id: POLICY.resource.id },
      }),
    ).toBe(false);
  });

  it("status distinguishes ACTIVE, EXPIRED and REVOKED; revoked wins", () => {
    const now = "2026-09-04T00:00:00.000Z";
    expect(policyStatusAt(POLICY, now)).toBe("ACTIVE");
    expect(
      policyStatusAt({ ...POLICY, expiresAt: "2026-09-03T00:00:00.000Z" }, now),
    ).toBe("EXPIRED");
    expect(
      policyStatusAt(
        {
          ...POLICY,
          expiresAt: "2026-09-03T00:00:00.000Z",
          revokedAt: "2026-09-02T00:00:00.000Z",
        },
        now,
      ),
    ).toBe("REVOKED");
  });
});

describe("domain events (§103-106)", () => {
  const registry = createEventRegistry([...PERMISSIONS_EVENTS]);
  const correlationId: CorrelationId =
    "cor_123e4567-e89b-12d3-a456-426614174000";

  it("registers granted@1 and revoked@1 as CONFIDENTIAL with identifiers only", () => {
    for (const name of [
      "permissions.disclosure.granted",
      "permissions.disclosure.revoked",
    ]) {
      const definition = registry.get(name, 1);
      expect(definition?.owner).toBe("@capital-q/permissions");
      expect(definition?.sensitivity).toBe("CONFIDENTIAL");
      expect(registry.has(name, 2)).toBe(false);
    }
    const granted = disclosureGrantedEvent({
      tenantId: POLICY.tenantId,
      organisationId: POLICY.ownerOrganisationId ?? undefined,
      actorUserId: POLICY.createdByUserId,
      correlationId,
      policy: POLICY,
    });
    expect(registry.parse(granted).ok).toBe(true);
    expect(granted.data).toEqual({
      disclosurePolicyId: POLICY.id,
      resourceType: "company",
      resourceId: POLICY.resource.id,
      scopeType: "specifically_shared",
      accessLevel: "view",
    });
    expect(JSON.stringify(granted)).not.toContain(POLICY.recipient?.id);
    const revoked = disclosureRevokedEvent({
      tenantId: POLICY.tenantId,
      organisationId: undefined,
      actorUserId: POLICY.createdByUserId,
      correlationId,
      policy: POLICY,
    });
    expect(registry.parse(revoked).ok).toBe(true);
    expect(revoked.data).not.toHaveProperty("accessLevel");
    expect(
      registry.parse({
        ...granted,
        data: { ...granted.data, recipientEmail: "x@example.invalid" },
      }).ok,
    ).toBe(false);
  });
});

describe("module surface (§54, §92, §98)", () => {
  it("exposes no policy update, delete, HTTP route or ambient Q authority", () => {
    const names = Object.keys(permissions);
    for (const forbidden of names.filter((name) =>
      /update.*polic|delete|remove|route|handler|allowQ|serviceRole/i.test(
        name,
      ),
    )) {
      expect(forbidden, forbidden).toBe("");
    }
    expect(names).toContain("createPermissionsService");
    expect(names).toContain("evaluateDisclosure");
    expect(names).toContain("createProtectedDisclosureGuard");
  });
});
