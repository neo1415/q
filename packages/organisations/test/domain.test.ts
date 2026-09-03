import { describe, expect, it } from "vitest";

import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
} from "@capital-q/security";

import {
  decodeMembershipCursor,
  encodeMembershipCursor,
} from "../src/domain/cursor.js";
import {
  hashCreateOrganisationRequest,
  hashIdempotencyKey,
} from "../src/domain/idempotency.js";
import {
  toOrganisationDto,
  type Organisation,
} from "../src/domain/organisation.js";
import {
  organisationSlugFromDisplayName,
  SLUG_FALLBACK,
} from "../src/domain/slug.js";
import {
  membershipCreatedEvent,
  ORGANISATION_EVENTS,
  organisationCreatedEvent,
  organisationUpdatedEvent,
  OrganisationCreatedEvent,
} from "../src/events/index.js";

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const MEMBERSHIP = MembershipIdSchema.parse(
  "e0000000-0000-4000-8000-000000000001",
);
const USER = "b0000000-0000-4000-8000-000000000001";
const CORRELATION: CorrelationId = "cor_123e4567-e89b-12d3-a456-426614174000";

describe("organisationSlugFromDisplayName", () => {
  it.each([
    ["Acme Ventures", "acme-ventures"],
    ["  Société Générale  ", "societe-generale"],
    ["NexaRail Technologies, Inc.", "nexarail-technologies-inc"],
    ["--Hello__World--", "hello-world"],
    ["ÅÄÖ Capital", "aao-capital"],
    ["日本語のみ", SLUG_FALLBACK],
    ["", SLUG_FALLBACK],
    ["<script>alert(1)</script>", "script-alert-1-script"],
  ])("%s -> %s", (input, expected) => {
    expect(organisationSlugFromDisplayName(input)).toBe(expected);
  });

  it("is bounded to the database rule and never ends in a hyphen", () => {
    const slug = organisationSlugFromDisplayName(
      `${"a".repeat(79)} b ${"c".repeat(20)}`,
    );
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/);
  });
});

describe("membership cursor", () => {
  it("round-trips and is opaque", () => {
    const cursor = encodeMembershipCursor({
      joinedAt: "2026-09-03T09:00:00.000Z",
      id: MEMBERSHIP,
    });
    expect(cursor).not.toContain("{");
    expect(decodeMembershipCursor(cursor)).toEqual({
      joinedAt: "2026-09-03T09:00:00.000Z",
      id: MEMBERSHIP,
    });
  });

  it.each([
    "",
    "not-base64!",
    Buffer.from('{"id":"x"}').toString("base64url"),
    Buffer.from(
      '{"joinedAt":"2026-09-03T09:00:00.000Z","id":"' +
        MEMBERSHIP +
        '","extra":1}',
    ).toString("base64url"),
  ])("rejects a cursor this server did not issue: %s", (raw) => {
    expect(() => decodeMembershipCursor(raw)).toThrow();
  });
});

describe("idempotency hashing", () => {
  it("never stores the raw key and is stable", () => {
    const hash = hashIdempotencyKey("client-key-1234");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("client-key");
    expect(hashIdempotencyKey("client-key-1234")).toBe(hash);
    expect(hashIdempotencyKey("client-key-1235")).not.toBe(hash);
  });

  it("hashes the meaning of a request, not its key order", () => {
    const a = hashCreateOrganisationRequest({
      displayName: "Acme",
      organisationType: "company",
      countryCode: "GB",
    });
    const b = hashCreateOrganisationRequest({
      countryCode: "GB",
      organisationType: "company",
      displayName: "Acme",
    });
    const c = hashCreateOrganisationRequest({
      displayName: "Acme",
      organisationType: "investment_firm",
      countryCode: "GB",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("organisation DTO", () => {
  it("exposes the profile and never the tenant or slug", () => {
    const organisation: Organisation = {
      id: ORG,
      tenantId: TENANT,
      organisationType: "company",
      displayName: "Acme",
      legalName: null,
      slug: "acme",
      websiteUrl: null,
      countryCode: "GB",
      jurisdictionCode: null,
      status: "active",
      version: 1,
      createdAt: "2026-09-03T09:00:00.000Z",
      updatedAt: "2026-09-03T09:00:00.000Z",
    };
    const dto = toOrganisationDto(organisation);
    expect(dto).not.toHaveProperty("tenantId");
    expect(dto).not.toHaveProperty("slug");
    expect(dto.id).toBe(ORG);
    expect(dto.version).toBe(1);
  });
});

describe("organisation events", () => {
  const registry = createEventRegistry([...ORGANISATION_EVENTS]);

  it("registers the three canonical events at version 1 with the right metadata", () => {
    for (const name of [
      "identity.organisation.created",
      "identity.organisation.updated",
      "identity.membership.created",
    ]) {
      const definition = registry.get(name, 1);
      expect(definition).toBeDefined();
      expect(definition?.owner).toBe("@capital-q/organisations");
      expect(definition?.producer).toBe("capitalq://api/identity/organisation");
      expect(definition?.sensitivity).toBe("INTERNAL");
      expect(definition?.replaySafety).toBe("REPLAY_SAFE");
      expect(definition?.tenancy).toBeUndefined();
      expect(registry.has(name, 2)).toBe(false);
    }
  });

  it("produces envelopes the registry accepts, with minimal payloads", () => {
    const base = {
      tenantId: TENANT,
      organisationId: ORG,
      actorUserId: USER,
      correlationId: CORRELATION,
    };
    const created = organisationCreatedEvent({
      ...base,
      organisationType: "company",
    });
    const updated = organisationUpdatedEvent({
      ...base,
      version: 2,
      changedFields: ["displayName"],
    });
    const membership = membershipCreatedEvent({
      ...base,
      membershipId: MEMBERSHIP,
      userId: USER,
    });

    for (const event of [created, updated, membership]) {
      const parsed = registry.parse(event);
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
      expect(event.tenantId).toBe(TENANT);
      expect(event.actor).toEqual({ type: "HUMAN", id: USER });
      expect(event.correlationId).toBe(CORRELATION);
    }
    expect(created.data).toEqual({
      organisationId: ORG,
      organisationType: "company",
    });
    expect(Object.keys(updated.data).sort()).toEqual([
      "changedFields",
      "organisationId",
      "version",
    ]);
    expect(membership.data.membershipStatus).toBe("active");
  });

  it("rejects an unknown version and an over-full payload", () => {
    const event = organisationCreatedEvent({
      tenantId: TENANT,
      organisationId: ORG,
      actorUserId: USER,
      correlationId: CORRELATION,
      organisationType: "company",
    });
    expect(registry.parse({ ...event, eventVersion: 2 }).ok).toBe(false);
    expect(
      registry.parse({
        ...event,
        data: { ...event.data, displayName: "Acme", legalName: "Acme Ltd" },
      }).ok,
    ).toBe(false);
    expect(
      OrganisationCreatedEvent.dataSchema.safeParse({ organisationId: ORG })
        .success,
    ).toBe(false);
  });
});
