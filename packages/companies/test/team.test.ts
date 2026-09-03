import { describe, expect, it } from "vitest";

import {
  createEventRegistry,
  UpdateCompanyTeamFactsRequestSchema,
  UpdateMyFounderProfileRequestSchema,
  UpsertMyCompanyMembershipRequestSchema,
  type CorrelationId,
} from "@capital-q/contracts";

import { COMPANY_EVENTS } from "../src/events/index.js";
import {
  companyMemberCreatedEvent,
  companyTeamUpdatedEvent,
  founderProfileUpdatedEvent,
} from "../src/events/team.js";

const TENANT = "c0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";
const COMPANY = "f0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const MEMBER = "e0000000-0000-4000-8000-000000000001";
const PROFILE = "e0000000-0000-4000-8000-000000000002";
const CORRELATION: CorrelationId = "cor_123e4567-e89b-12d3-a456-426614174000";

describe("team contracts", () => {
  it("self membership: relationship, title and founder flag only", () => {
    expect(
      UpsertMyCompanyMembershipRequestSchema.safeParse({
        relationshipType: "team_member",
        businessTitle: "CEO",
        isFounder: true,
      }).success,
    ).toBe(true);
    for (const extra of [
      { userId: USER },
      { tenantId: TENANT },
      { organisationId: ORG },
      { companyId: COMPANY },
      { role: "organisation_admin" },
      { capabilities: ["company.edit"] },
      { verified: true },
      { isCurrent: false },
      { relationshipType: "ceo" },
    ]) {
      expect(
        UpsertMyCompanyMembershipRequestSchema.safeParse({
          relationshipType: "team_member",
          isFounder: false,
          ...extra,
        }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it("founder profile: two summaries, an optional version, nothing private or authoritative", () => {
    expect(
      UpdateMyFounderProfileRequestSchema.safeParse({
        professionalSummary: "x",
      }).success,
    ).toBe(true);
    expect(
      UpdateMyFounderProfileRequestSchema.safeParse({ expectedVersion: 1 })
        .success,
    ).toBe(false);
    for (const extra of [
      { userId: USER },
      { primaryCompanyId: COMPANY },
      { visibilityScope: "network_visible" },
      { verified: true },
      { privateQConversation: "..." },
      { privateFounderConcern: "..." },
      { negotiationPosition: "..." },
      { founderScore: 9 },
    ]) {
      expect(
        UpdateMyFounderProfileRequestSchema.safeParse({
          professionalSummary: "x",
          ...extra,
        }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
    expect(
      UpdateMyFounderProfileRequestSchema.safeParse({
        professionalSummary: "x".repeat(4001),
      }).success,
    ).toBe(false);
  });

  it("team facts: bounded non-negative counts, null means unknown", () => {
    expect(
      UpdateCompanyTeamFactsRequestSchema.safeParse({
        founderCount: 3,
        teamSize: null,
      }).success,
    ).toBe(true);
    expect(
      UpdateCompanyTeamFactsRequestSchema.safeParse({ founderCount: -1 })
        .success,
    ).toBe(false);
    expect(
      UpdateCompanyTeamFactsRequestSchema.safeParse({ founderCount: 1.5 })
        .success,
    ).toBe(false);
    expect(
      UpdateCompanyTeamFactsRequestSchema.safeParse({ expectedVersion: 1 })
        .success,
    ).toBe(false);
    expect(
      UpdateCompanyTeamFactsRequestSchema.safeParse({
        founderCount: 1,
        teamScore: 9,
      }).success,
    ).toBe(false);
  });
});

describe("team events", () => {
  const registry = createEventRegistry([...COMPANY_EVENTS]);

  it("registers the five team events with the right sensitivity and no other versions", () => {
    const expected: [string, string][] = [
      ["core.company_member.created", "INTERNAL"],
      ["core.company_member.updated", "INTERNAL"],
      ["core.founder_profile.created", "CONFIDENTIAL"],
      ["core.founder_profile.updated", "CONFIDENTIAL"],
      ["core.company_team.updated", "INTERNAL"],
    ];
    for (const [name, sensitivity] of expected) {
      const definition = registry.get(name, 1);
      expect(definition?.owner).toBe("@capital-q/companies");
      expect(definition?.sensitivity).toBe(sensitivity);
      expect(registry.has(name, 2)).toBe(false);
    }
    expect(registry.has("core.company_member.ended", 1)).toBe(false);
  });

  it("carries identifiers and field names only; a summary cannot be smuggled in", () => {
    const context = {
      tenantId: TENANT,
      organisationId: ORG,
      actorUserId: USER,
      correlationId: CORRELATION,
    };
    const created = companyMemberCreatedEvent({
      ...context,
      companyMemberId: MEMBER,
      companyId: COMPANY,
      userId: USER,
      isFounder: true,
      version: 1,
    });
    const profile = founderProfileUpdatedEvent({
      ...context,
      founderProfileId: PROFILE,
      userId: USER,
      primaryCompanyId: COMPANY,
      version: 2,
      changedFields: ["backgroundSummary"],
    });
    const team = companyTeamUpdatedEvent({
      ...context,
      companyId: COMPANY,
      version: 3,
      changedFields: ["teamSize"],
    });
    for (const event of [created, profile, team]) {
      expect(registry.parse(event).ok).toBe(true);
    }
    expect(profile.data).toEqual({
      founderProfileId: PROFILE,
      userId: USER,
      primaryCompanyId: COMPANY,
      version: 2,
      changedFields: ["backgroundSummary"],
    });
    expect(
      registry.parse({
        ...profile,
        data: {
          ...profile.data,
          backgroundSummary: "PRIVATE-FOUNDER-SUMMARY-DO-NOT-EMIT",
        },
      }).ok,
    ).toBe(false);
  });
});
