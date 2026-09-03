import { describe, expect, it } from "vitest";

import {
  createEventRegistry,
  CreateInvestorOrganisationRequestSchema,
  INVESTOR_DEPLOYMENT_STATES,
  INVESTOR_TYPES,
  InvestorOrganisationDtoSchema,
  InvestorRepresentativeDtoSchema,
  UpdateInvestorOrganisationRequestSchema,
  UpsertMyInvestorRepresentativeRequestSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import {
  InvestorOrganisationIdSchema,
  InvestorRepresentativeIdSchema,
  toInvestorOrganisationDto,
  toInvestorOrganisationIdentity,
  toInvestorRepresentativeDto,
  type InvestorOrganisation,
  type InvestorRepresentative,
} from "../src/contracts/index.js";
import {
  hashCreateInvestorOrganisationRequest,
  hashInvestorIdempotencyKey,
} from "../src/domain/idempotency.js";
import {
  INVESTOR_EVENTS,
  InvestorOrganisationCreatedEvent,
  investorOrganisationCreatedEvent,
  investorOrganisationUpdatedEvent,
  investorRepresentativeCreatedEvent,
  investorRepresentativeUpdatedEvent,
} from "../src/events/index.js";

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const MEMBERSHIP = MembershipIdSchema.parse(
  "e0000000-0000-4000-8000-000000000001",
);
const INVESTOR = InvestorOrganisationIdSchema.parse(
  "f0000000-0000-4000-8000-000000000001",
);
const REPRESENTATIVE = InvestorRepresentativeIdSchema.parse(
  "f0000000-0000-4000-8000-000000000002",
);
const CORRELATION: CorrelationId = "cor_123e4567-e89b-12d3-a456-426614174000";
const NOW = "2026-09-03T09:00:00.000Z";

describe("investor identifiers", () => {
  it("are branded UUIDs distinct from organisation, tenant, user and membership ids", () => {
    expect(InvestorOrganisationIdSchema.safeParse("not-a-uuid").success).toBe(
      false,
    );
    expect(InvestorRepresentativeIdSchema.safeParse("").success).toBe(false);
    // The values differ by construction in every fixture; the type brand is
    // what stops a compile-time mix-up.
    expect(INVESTOR).not.toBe(ORG);
    expect(REPRESENTATIVE).not.toBe(USER);
    expect(REPRESENTATIVE).not.toBe(MEMBERSHIP);
  });
});

describe("CreateInvestorOrganisationRequestSchema", () => {
  it("accepts every V1 investor type and deployment state; absent fields stay absent", () => {
    for (const investorType of INVESTOR_TYPES) {
      expect(
        CreateInvestorOrganisationRequestSchema.safeParse({ investorType })
          .success,
      ).toBe(true);
    }
    for (const deploymentState of INVESTOR_DEPLOYMENT_STATES) {
      expect(
        CreateInvestorOrganisationRequestSchema.safeParse({
          investorType: "VC",
          deploymentState,
        }).success,
      ).toBe(true);
    }
    const parsed = CreateInvestorOrganisationRequestSchema.parse({
      investorType: "ANGEL",
      displayName: "  Apex Ventures  ",
      websiteUrl: "https://apex.example",
      hqCountry: "GB",
    });
    expect(parsed.displayName).toBe("Apex Ventures");
    expect(parsed).not.toHaveProperty("deploymentState");
    expect(parsed).not.toHaveProperty("publicDescription");
  });

  it.each([
    ["unknown investor type", { investorType: "HEDGE_FUND" }],
    ["lowercase investor type", { investorType: "vc" }],
    ["organisation type as investor type", { investorType: "investment_firm" }],
    [
      "unknown deployment state",
      { investorType: "VC", deploymentState: "OPEN" },
    ],
    ["ftp website", { investorType: "VC", websiteUrl: "ftp://a.example" }],
    ["lowercase country", { investorType: "VC", hqCountry: "gb" }],
    ["empty display name", { investorType: "VC", displayName: "   " }],
    [
      "over-long display name",
      { investorType: "VC", displayName: "x".repeat(201) },
    ],
    [
      "over-long description",
      { investorType: "VC", publicDescription: "x".repeat(4001) },
    ],
    ["id", { investorType: "VC", id: INVESTOR }],
    ["tenantId", { investorType: "VC", tenantId: TENANT }],
    ["organisationId", { investorType: "VC", organisationId: ORG }],
    ["userId", { investorType: "VC", userId: USER }],
    ["membershipId", { investorType: "VC", membershipId: MEMBERSHIP }],
    [
      "verificationState",
      { investorType: "VC", verificationState: "verified" },
    ],
    ["role", { investorType: "VC", role: "organisation_admin" }],
    ["capabilities", { investorType: "VC", capabilities: ["investor.edit"] }],
    ["isVerified", { investorType: "VC", isVerified: true }],
    ["isAdmin", { investorType: "VC", isAdmin: true }],
    [
      "representativeId",
      { investorType: "VC", representativeId: REPRESENTATIVE },
    ],
    ["minCheque", { investorType: "VC", minCheque: "100000" }],
    ["sector", { investorType: "VC", sector: "fintech" }],
    ["stage", { investorType: "VC", stage: "seed" }],
    ["geography", { investorType: "VC", geography: ["GB"] }],
    ["hardExclusions", { investorType: "VC", hardExclusions: ["gambling"] }],
    ["discoveryMode", { investorType: "VC", discoveryMode: "broad" }],
    ["inboundMode", { investorType: "VC", inboundMode: "OPEN" }],
    ["fund", { investorType: "VC", fund: { name: "Fund I" } }],
  ])("rejects %s", (_, payload) => {
    expect(
      CreateInvestorOrganisationRequestSchema.safeParse(payload).success,
    ).toBe(false);
  });
});

describe("UpdateInvestorOrganisationRequestSchema", () => {
  it("requires expectedVersion >= 1 and at least one editable field; null returns to unknown", () => {
    expect(
      UpdateInvestorOrganisationRequestSchema.safeParse({ expectedVersion: 1 })
        .success,
    ).toBe(false);
    expect(
      UpdateInvestorOrganisationRequestSchema.safeParse({
        expectedVersion: 0,
        deploymentState: "PAUSED",
      }).success,
    ).toBe(false);
    expect(
      UpdateInvestorOrganisationRequestSchema.safeParse({
        expectedVersion: 2,
        deploymentState: null,
        websiteUrl: null,
        investorType: "CVC",
      }).success,
    ).toBe(true);
  });

  it.each([
    ["verificationState", { verificationState: "PLATFORM_VERIFIED" }],
    ["tenantId", { tenantId: TENANT }],
    ["organisationId", { organisationId: ORG }],
    ["userId", { userId: USER }],
    ["membershipId", { membershipId: MEMBERSHIP }],
    ["minCheque", { minCheque: "100000" }],
    ["maxCheque", { maxCheque: "1000000" }],
    ["sector", { sector: "fintech" }],
    ["stage", { stage: "seed" }],
    ["discoveryMode", { discoveryMode: "broad" }],
    ["hardExclusions", { hardExclusions: ["gambling"] }],
    ["inboundMode", { inboundMode: "OPEN" }],
    ["gateq", { gateq: "OPEN" }],
    ["mandate", { mandate: {} }],
    ["reputationScore", { reputationScore: 5 }],
    ["version", { version: 3 }],
  ])("refuses the immutable, authority or mandate field %s", (_, extra) => {
    expect(
      UpdateInvestorOrganisationRequestSchema.safeParse({
        expectedVersion: 1,
        deploymentState: "SELECTIVE",
        ...extra,
      }).success,
    ).toBe(false);
  });
});

describe("UpsertMyInvestorRepresentativeRequestSchema", () => {
  it("accepts a title or nothing; never a person, membership, authority or current flag", () => {
    expect(
      UpsertMyInvestorRepresentativeRequestSchema.safeParse({}).success,
    ).toBe(true);
    expect(
      UpsertMyInvestorRepresentativeRequestSchema.safeParse({
        businessTitle: "Partner",
      }).success,
    ).toBe(true);
    for (const extra of [
      { userId: USER },
      { membershipId: MEMBERSHIP },
      { tenantId: TENANT },
      { organisationId: ORG },
      { isCurrent: false },
      { role: "organisation_admin" },
      { capabilities: ["investor.edit"] },
      { businessTitle: "x".repeat(121) },
    ]) {
      expect(
        UpsertMyInvestorRepresentativeRequestSchema.safeParse(extra).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
});

describe("idempotency hashing", () => {
  it("is namespaced, key-order independent and never contains the key", () => {
    const hash = hashInvestorIdempotencyKey("client-key-1234");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("client-key");
    const a = hashCreateInvestorOrganisationRequest({
      investorType: "VC",
      hqCountry: "GB",
    });
    const b = hashCreateInvestorOrganisationRequest({
      hqCountry: "GB",
      investorType: "VC",
    });
    const c = hashCreateInvestorOrganisationRequest({
      investorType: "VC",
      hqCountry: "FR",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("DTOs", () => {
  const investor: InvestorOrganisation = {
    id: INVESTOR,
    tenantId: TENANT,
    organisationId: ORG,
    investorType: "VC",
    displayName: "Apex Ventures",
    websiteUrl: null,
    hqCountry: "GB",
    publicDescription: "Early-stage B2B.",
    verificationState: "unverified",
    deploymentState: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const representative: InvestorRepresentative = {
    id: REPRESENTATIVE,
    tenantId: TENANT,
    investorOrganisationId: INVESTOR,
    organisationId: ORG,
    userId: USER,
    membershipId: MEMBERSHIP,
    businessTitle: "Partner",
    isCurrent: true,
    startedAt: NOW,
    endedAt: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("investor DTO keeps unknown deployment state as null and hides tenant and organisation", () => {
    const dto = toInvestorOrganisationDto(investor);
    expect(InvestorOrganisationDtoSchema.safeParse(dto).success).toBe(true);
    expect(dto.deploymentState).toBeNull();
    expect(dto.verificationState).toBe("unverified");
    expect(dto).not.toHaveProperty("tenantId");
    expect(dto).not.toHaveProperty("organisationId");
    expect(Object.keys(dto)).not.toContain("reputationScore");
    expect(toInvestorOrganisationIdentity(investor)).toEqual({
      id: INVESTOR,
      tenantId: TENANT,
      organisationId: ORG,
      investorType: "VC",
      displayName: "Apex Ventures",
      deploymentState: null,
    });
  });

  it("representative DTO carries no tenant, person, membership, roles or PII", () => {
    const dto = toInvestorRepresentativeDto(representative);
    expect(InvestorRepresentativeDtoSchema.safeParse(dto).success).toBe(true);
    expect(dto).not.toHaveProperty("tenantId");
    expect(dto).not.toHaveProperty("userId");
    expect(dto).not.toHaveProperty("membershipId");
    expect(dto).not.toHaveProperty("organisationId");
    expect(dto).not.toHaveProperty("email");
    expect(dto.businessTitle).toBe("Partner");
  });
});

describe("investor events", () => {
  const registry = createEventRegistry([...INVESTOR_EVENTS]);
  const context = {
    tenantId: TENANT,
    organisationId: ORG,
    actorUserId: USER,
    correlationId: CORRELATION,
  };

  it("registers the four events at version 1, INTERNAL and REPLAY_SAFE, and nothing else", () => {
    for (const name of [
      "core.investor_organisation.created",
      "core.investor_organisation.updated",
      "core.investor_representative.created",
      "core.investor_representative.updated",
    ]) {
      const definition = registry.get(name, 1);
      expect(definition?.owner).toBe("@capital-q/investors");
      expect(definition?.sensitivity).toBe("INTERNAL");
      expect(definition?.replaySafety).toBe("REPLAY_SAFE");
      expect(registry.has(name, 2)).toBe(false);
    }
    expect(registry.has("core.investor_mandate.created", 1)).toBe(false);
    expect(registry.has("core.investment_fund.created", 1)).toBe(false);
  });

  it("produces minimal envelopes: identifiers, type, versions and field names only", () => {
    const created = investorOrganisationCreatedEvent({
      ...context,
      investorOrganisationId: INVESTOR,
      investorType: "VC",
      version: 1,
    });
    const updated = investorOrganisationUpdatedEvent({
      ...context,
      investorOrganisationId: INVESTOR,
      version: 2,
      changedFields: ["deploymentState"],
    });
    const representativeCreated = investorRepresentativeCreatedEvent({
      ...context,
      investorRepresentativeId: REPRESENTATIVE,
      investorOrganisationId: INVESTOR,
      userId: USER,
      membershipId: MEMBERSHIP,
      version: 1,
    });
    const representativeUpdated = investorRepresentativeUpdatedEvent({
      ...context,
      investorRepresentativeId: REPRESENTATIVE,
      investorOrganisationId: INVESTOR,
      version: 2,
      changedFields: ["businessTitle"],
    });
    for (const event of [
      created,
      updated,
      representativeCreated,
      representativeUpdated,
    ]) {
      expect(registry.parse(event).ok).toBe(true);
      expect(event.tenantId).toBe(TENANT);
      expect(event.organisationId).toBe(ORG);
    }
    expect(created.aggregate).toEqual({
      type: "investor_organisation",
      id: INVESTOR,
      version: 1,
    });
    expect(created.data).toEqual({
      investorOrganisationId: INVESTOR,
      organisationId: ORG,
      investorType: "VC",
      version: 1,
    });
    expect(updated.data).toEqual({
      investorOrganisationId: INVESTOR,
      version: 2,
      changedFields: ["deploymentState"],
    });
    expect(representativeCreated.data).toEqual({
      investorRepresentativeId: REPRESENTATIVE,
      investorOrganisationId: INVESTOR,
      userId: USER,
      membershipId: MEMBERSHIP,
    });
    expect(representativeCreated.data).not.toHaveProperty("businessTitle");
  });

  it("rejects an unknown version and any profile text in a payload", () => {
    const created = investorOrganisationCreatedEvent({
      ...context,
      investorOrganisationId: INVESTOR,
      investorType: "VC",
      version: 1,
    });
    expect(registry.parse({ ...created, eventVersion: 2 }).ok).toBe(false);
    expect(
      registry.parse({
        ...created,
        data: {
          ...created.data,
          publicDescription: "PRIVATE-INVESTOR-DESCRIPTION-DO-NOT-EMIT",
        },
      }).ok,
    ).toBe(false);
    expect(
      InvestorOrganisationCreatedEvent.dataSchema.safeParse({
        investorOrganisationId: INVESTOR,
      }).success,
    ).toBe(false);
  });
});
