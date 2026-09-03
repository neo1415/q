import { describe, expect, it } from "vitest";

import {
  ContractValidationError,
  createEventRegistry,
  DisclosureScopeSchema,
  RELATIONSHIP_SOURCE_TYPES,
  RelationshipDtoSchema,
  RelationshipEventSummaryDtoSchema,
  RelationshipEventTypeSchema,
  RelationshipSourceIdSchema,
  RelationshipSourceTypeSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import { CompanyIdSchema } from "@capital-q/companies";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import { TenantIdSchema } from "@capital-q/security";
import { z } from "zod";

import {
  RelationshipEventIdSchema,
  RelationshipIdSchema,
  toRelationshipDto,
  toRelationshipEventSummaryDto,
  type Relationship,
  type RelationshipEvent,
} from "../src/contracts/index.js";
import {
  RelationshipEventTypeUnknownError,
  RelationshipEventVisibilityNotAllowedError,
} from "../src/domain/errors.js";
import {
  createRelationshipEventRegistry,
  defineRelationshipEvent,
  DiscoveredRelationshipEvent,
  RELATIONSHIP_EVENT_DEFINITIONS,
} from "../src/domain/event-registry.js";
import * as network from "../src/index.js";
import {
  NETWORK_EVENTS,
  relationshipCreatedEvent,
} from "../src/events/index.js";

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const COMPANY = CompanyIdSchema.parse("f0000000-0000-4000-8000-000000000001");
const INVESTOR = InvestorOrganisationIdSchema.parse(
  "f0000000-0000-4000-8000-000000000002",
);
const RELATIONSHIP = RelationshipIdSchema.parse(
  "f0000000-0000-4000-8000-000000000030",
);
const EVENT = RelationshipEventIdSchema.parse(
  "f0000000-0000-4000-8000-000000000031",
);
const USER = "b0000000-0000-4000-8000-000000000001";
const CORRELATION: CorrelationId = "cor_123e4567-e89b-12d3-a456-426614174000";
const NOW = "2026-09-03T09:00:00.000Z";

describe("identifiers and vocabularies", () => {
  it("RelationshipId and RelationshipEventId are branded and distinct from party ids", () => {
    expect(RelationshipIdSchema.safeParse("nope").success).toBe(false);
    expect(RelationshipEventIdSchema.safeParse("").success).toBe(false);
    expect(RELATIONSHIP).not.toBe(COMPANY);
    expect(RELATIONSHIP).not.toBe(INVESTOR);
    expect(EVENT).not.toBe(RELATIONSHIP);
  });

  it("source types are the V1 provenance set and source ids are bounded printable references", () => {
    expect([...RELATIONSHIP_SOURCE_TYPES]).toEqual([
      "DISCOVER",
      "GATEQ",
      "SEARCH",
      "RECOMMENDATION",
      "Q",
      "MANUAL",
      "SYSTEM",
    ]);
    expect(
      RelationshipSourceTypeSchema.safeParse("FEED_IMPRESSION").success,
    ).toBe(false);
    expect(RelationshipSourceIdSchema.safeParse("slate:abc-123").success).toBe(
      true,
    );
    expect(RelationshipSourceIdSchema.safeParse("x".repeat(257)).success).toBe(
      false,
    );
    expect(RelationshipSourceIdSchema.safeParse("has space").success).toBe(
      false,
    );
    expect(RelationshipSourceIdSchema.safeParse("").success).toBe(false);
  });

  it("visibility accepts only ADR-001 scopes; event types are bounded lower_snake", () => {
    for (const scope of [
      "personal_private",
      "organisation_private",
      "founder_private",
      "investor_private",
      "relationship_shared",
      "specifically_shared",
      "network_visible",
      "public_external",
    ]) {
      expect(DisclosureScopeSchema.safeParse(scope).success).toBe(true);
    }
    for (const legacy of ["public", "shared", "private", "PUBLIC"]) {
      expect(DisclosureScopeSchema.safeParse(legacy).success).toBe(false);
    }
    expect(RelationshipEventTypeSchema.safeParse("discovered").success).toBe(
      true,
    );
    expect(
      RelationshipEventTypeSchema.safeParse("Investment Won").success,
    ).toBe(false);
  });
});

describe("relationship event registry", () => {
  const registry = createRelationshipEventRegistry(
    RELATIONSHIP_EVENT_DEFINITIONS,
  );

  it("registers discovered only, with private scopes only", () => {
    expect(registry.types()).toEqual(["discovered"]);
    expect(DiscoveredRelationshipEvent.allowedVisibilityScopes).not.toContain(
      "relationship_shared",
    );
    expect(DiscoveredRelationshipEvent.allowedVisibilityScopes).not.toContain(
      "network_visible",
    );
    expect(
      registry.validate({
        eventType: "discovered",
        visibilityScope: "investor_private",
        payload: {},
      }),
    ).toEqual({});
    expect(
      registry.validate({
        eventType: "discovered",
        visibilityScope: "founder_private",
        payload: { sourceReference: "gateq:application-1" },
      }),
    ).toEqual({ sourceReference: "gateq:application-1" });
  });

  it("rejects unknown types, disallowed scopes, unknown keys and private-body fields", () => {
    for (const eventType of [
      "investment_won",
      "interest_expressed",
      "match_created",
    ]) {
      expect(() =>
        registry.validate({
          eventType,
          visibilityScope: "investor_private",
          payload: {},
        }),
      ).toThrow(RelationshipEventTypeUnknownError);
    }
    expect(() =>
      registry.validate({
        eventType: "discovered",
        visibilityScope: "relationship_shared",
        payload: {},
      }),
    ).toThrow(RelationshipEventVisibilityNotAllowedError);
    for (const payload of [
      { transcript: "..." },
      { accessToken: "x" },
      { prompt: "..." },
      { sourceReference: "x".repeat(300) },
    ]) {
      expect(() =>
        registry.validate({
          eventType: "discovered",
          visibilityScope: "investor_private",
          payload,
        }),
      ).toThrow(ContractValidationError);
    }
  });

  it("bounds payload size and refuses duplicate or scopeless definitions", () => {
    const big = defineRelationshipEvent({
      type: "test_fixture_note",
      payloadSchema: z.object({ note: z.string() }).strict(),
      allowedVisibilityScopes: ["relationship_shared"],
      description: "test",
    });
    const testRegistry = createRelationshipEventRegistry([big]);
    expect(() =>
      testRegistry.validate({
        eventType: "test_fixture_note",
        visibilityScope: "relationship_shared",
        payload: { note: "x".repeat(9000) },
      }),
    ).toThrow(ContractValidationError);
    expect(() => createRelationshipEventRegistry([big, big])).toThrow(
      TypeError,
    );
    expect(() =>
      defineRelationshipEvent({
        type: "no_scope",
        payloadSchema: z.object({}),
        allowedVisibilityScopes: [],
        description: "x",
      }),
    ).toThrow(TypeError);
  });
});

describe("DTOs", () => {
  const relationship: Relationship = {
    id: RELATIONSHIP,
    tenantId: TENANT,
    companyId: COMPANY,
    investorOrganisationId: INVESTOR,
    currentState: "DISCOVERED",
    stateUpdatedAt: NOW,
    firstDiscoveredAt: NOW,
    lastEventSequence: 1,
    createdAt: NOW,
  };
  const event: RelationshipEvent = {
    id: EVENT,
    tenantId: TENANT,
    relationshipId: RELATIONSHIP,
    sequence: 1,
    eventType: "discovered",
    occurredAt: NOW,
    actor: { type: "HUMAN", id: USER },
    source: { type: "DISCOVER", id: "slate:1" },
    visibilityScope: "investor_private",
    payload: { note: "PRIVATE-RELATIONSHIP-EVENT-DATA-DO-NOT-EMIT" },
    correlationId: CORRELATION,
    createdAt: NOW,
  };

  it("hide the tenant anchor and never carry a payload", () => {
    const dto = toRelationshipDto(relationship);
    expect(RelationshipDtoSchema.safeParse(dto).success).toBe(true);
    expect(dto).not.toHaveProperty("tenantId");
    const summary = toRelationshipEventSummaryDto(event);
    expect(RelationshipEventSummaryDtoSchema.safeParse(summary).success).toBe(
      true,
    );
    expect(summary).not.toHaveProperty("payload");
    expect(JSON.stringify(summary)).not.toContain("DO-NOT-EMIT");
  });
});

describe("module surface", () => {
  it("exposes no state setter, no history update or delete, and no relationship delete", () => {
    const names = Object.keys(network);
    for (const forbidden of names.filter((name) =>
      /set.*state|update.*event|delete|remove|projector|interest|match/i.test(
        name,
      ),
    )) {
      expect(forbidden, forbidden).toBe("");
    }
    expect(names).toContain("createEnsureRelationship");
    expect(names).toContain("createRelationshipEventAppender");
  });
});

describe("network domain events", () => {
  const registry = createEventRegistry([...NETWORK_EVENTS]);

  it("registers network.relationship.created@1 as INTERNAL with identifiers only", () => {
    const definition = registry.get("network.relationship.created", 1);
    expect(definition?.owner).toBe("@capital-q/network");
    expect(definition?.sensitivity).toBe("INTERNAL");
    expect(registry.has("network.relationship.created", 2)).toBe(false);
    expect(registry.has("network.relationship.event_appended", 1)).toBe(false);
    const event = relationshipCreatedEvent({
      tenantId: TENANT,
      organisationId: "d0000000-0000-4000-8000-000000000001",
      actorUserId: USER,
      correlationId: CORRELATION,
      relationshipId: RELATIONSHIP,
      companyId: COMPANY,
      investorOrganisationId: INVESTOR,
    });
    expect(registry.parse(event).ok).toBe(true);
    expect(event.data).toEqual({
      relationshipId: RELATIONSHIP,
      companyId: COMPANY,
      investorOrganisationId: INVESTOR,
    });
    expect(
      registry.parse({
        ...event,
        data: {
          ...event.data,
          sourceType: "DISCOVER",
          visibilityScope: "investor_private",
        },
      }).ok,
    ).toBe(false);
  });
});
