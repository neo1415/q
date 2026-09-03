import { describe, expect, it } from "vitest";

import {
  CompanyDtoSchema,
  createEventRegistry,
  CreateCompanyRequestSchema,
  UpdateCompanyRequestSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import { OrganisationIdSchema, TenantIdSchema } from "@capital-q/security";

import {
  CompanyIdSchema,
  toCompanyDto,
  type Company,
} from "../src/contracts/index.js";
import {
  hashCompanyIdempotencyKey,
  hashCreateCompanyRequest,
} from "../src/domain/idempotency.js";
import {
  COMPANY_SLUG_FALLBACK,
  COMPANY_SLUG_MAX_SUFFIX,
  companySlugCandidates,
  companySlugFromName,
} from "../src/domain/slug.js";
import {
  COMPANY_EVENTS,
  companyCreatedEvent,
  companyUpdatedEvent,
  CompanyCreatedEvent,
} from "../src/events/index.js";

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const COMPANY = CompanyIdSchema.parse("f0000000-0000-4000-8000-000000000001");
const USER = "b0000000-0000-4000-8000-000000000001";
const CORRELATION: CorrelationId = "cor_123e4567-e89b-12d3-a456-426614174000";

describe("CreateCompanyRequestSchema", () => {
  it("trims and bounds the name, validates optional fields, and leaves absent values absent", () => {
    const parsed = CreateCompanyRequestSchema.parse({
      canonicalName: "  NexaRail Technologies  ",
      websiteUrl: "https://nexarail.example",
      foundedDate: "2021-03-15",
      headquartersCountry: "GB",
      currentStageCode: "seed",
    });
    expect(parsed.canonicalName).toBe("NexaRail Technologies");
    expect(parsed).not.toHaveProperty("legalName");
    expect(parsed).not.toHaveProperty("shortDescription");
  });

  it.each([
    ["empty name", { canonicalName: "   " }],
    ["over-long name", { canonicalName: "x".repeat(201) }],
    ["ftp website", { canonicalName: "A", websiteUrl: "ftp://a.example" }],
    [
      "datetime as founded date",
      { canonicalName: "A", foundedDate: "2021-03-15T00:00:00Z" },
    ],
    ["lowercase country", { canonicalName: "A", headquartersCountry: "gb" }],
    [
      "three-letter country",
      { canonicalName: "A", headquartersCountry: "GBR" },
    ],
    [
      "stage code with spaces",
      { canonicalName: "A", currentStageCode: "Series A" },
    ],
    [
      "stage code too long",
      { canonicalName: "A", currentStageCode: "a".repeat(65) },
    ],
    [
      "short description too long",
      { canonicalName: "A", shortDescription: "x".repeat(401) },
    ],
    [
      "primary description too long",
      { canonicalName: "A", primaryDescription: "x".repeat(8001) },
    ],
    ["companyId", { canonicalName: "A", companyId: COMPANY }],
    ["tenantId", { canonicalName: "A", tenantId: TENANT }],
    ["organisationId", { canonicalName: "A", organisationId: ORG }],
    ["companyStatus", { canonicalName: "A", companyStatus: "active" }],
    [
      "marketplaceVisibility",
      { canonicalName: "A", marketplaceVisibility: "public_external" },
    ],
    [
      "marketplaceReadinessState",
      { canonicalName: "A", marketplaceReadinessState: "ready" },
    ],
    ["version", { canonicalName: "A", version: 3 }],
    ["verified", { canonicalName: "A", verified: true }],
    ["fit score", { canonicalName: "A", fitScore: 0.9 }],
    ["createdBy", { canonicalName: "A", createdBy: USER }],
    ["slug", { canonicalName: "A", slug: "a" }],
    ["raise amount", { canonicalName: "A", raiseAmount: "1000000" }],
  ])("rejects %s", (_, payload) => {
    expect(CreateCompanyRequestSchema.safeParse(payload).success).toBe(false);
  });

  it("accepts a future taxonomy-backed stage code without a schema change", () => {
    for (const code of ["pre_seed", "seed", "series_a", "growth_2030_v2"]) {
      expect(
        CreateCompanyRequestSchema.safeParse({
          canonicalName: "A",
          currentStageCode: code,
        }).success,
      ).toBe(true);
    }
  });
});

describe("UpdateCompanyRequestSchema", () => {
  it("requires expectedVersion >= 1 and at least one editable field; null clears", () => {
    expect(
      UpdateCompanyRequestSchema.safeParse({ expectedVersion: 1 }).success,
    ).toBe(false);
    expect(
      UpdateCompanyRequestSchema.safeParse({
        expectedVersion: 0,
        shortDescription: "x",
      }).success,
    ).toBe(false);
    expect(
      UpdateCompanyRequestSchema.safeParse({
        expectedVersion: 2,
        legalName: null,
        currentStageCode: "seed",
      }).success,
    ).toBe(true);
  });

  it.each([
    ["id", { id: COMPANY }],
    ["tenantId", { tenantId: TENANT }],
    ["organisationId", { organisationId: ORG }],
    ["slug", { slug: "x" }],
    ["companyStatus", { companyStatus: "closed" }],
    ["marketplaceVisibility", { marketplaceVisibility: "network_visible" }],
    ["marketplaceReadinessState", { marketplaceReadinessState: "ready" }],
    ["logoStorageKey", { logoStorageKey: "logos/x.png" }],
    ["version", { version: 3 }],
  ])("refuses the immutable or authority field %s", (_, extra) => {
    expect(
      UpdateCompanyRequestSchema.safeParse({
        expectedVersion: 1,
        shortDescription: "x",
        ...extra,
      }).success,
    ).toBe(false);
  });
});

describe("company slug", () => {
  it.each([
    ["NexaRail Technologies", "nexarail-technologies"],
    ["  Société Générale  ", "societe-generale"],
    ["Acme, Inc. (UK)", "acme-inc-uk"],
    ["--Hello__World--", "hello-world"],
    ["日本語のみ", COMPANY_SLUG_FALLBACK],
    ["", COMPANY_SLUG_FALLBACK],
  ])("%s -> %s", (input, expected) => {
    expect(companySlugFromName(input)).toBe(expected);
  });

  it("offers a bounded, length-safe candidate sequence for collisions", () => {
    const candidates = companySlugCandidates("acme");
    expect(candidates.slice(0, 3)).toEqual(["acme", "acme-2", "acme-3"]);
    expect(candidates).toHaveLength(COMPANY_SLUG_MAX_SUFFIX);
    const long = companySlugCandidates("a".repeat(80));
    for (const candidate of long) {
      expect(candidate.length).toBeLessThanOrEqual(80);
      expect(candidate).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/);
    }
    expect(long[1]?.endsWith("-2")).toBe(true);
  });
});

describe("idempotency hashing", () => {
  it("is namespaced, key-order independent and never contains the key", () => {
    const hash = hashCompanyIdempotencyKey("client-key-1234");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("client-key");
    const a = hashCreateCompanyRequest({
      canonicalName: "A",
      headquartersCountry: "GB",
    });
    const b = hashCreateCompanyRequest({
      headquartersCountry: "GB",
      canonicalName: "A",
    });
    const c = hashCreateCompanyRequest({
      canonicalName: "A",
      headquartersCountry: "FR",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("company DTO", () => {
  const company: Company = {
    id: COMPANY,
    tenantId: TENANT,
    organisationId: ORG,
    canonicalName: "Acme",
    legalName: null,
    slug: "acme",
    websiteUrl: null,
    foundedDate: "2021-03-15",
    headquartersCountry: "GB",
    headquartersCity: null,
    currentStageCode: "seed",
    primaryDescription: null,
    shortDescription: "Rail intelligence",
    companyStatus: "active",
    marketplaceVisibility: "organisation_private",
    marketplaceReadinessState: "not_assessed",
    logoStorageKey: null,
    version: 1,
    createdAt: "2026-09-03T09:00:00.000Z",
    updatedAt: "2026-09-03T09:00:00.000Z",
  };

  it("exposes the profile, read-only marketplace state, and never tenant, organisation or logo key", () => {
    const dto = toCompanyDto(company);
    expect(CompanyDtoSchema.safeParse(dto).success).toBe(true);
    expect(dto).not.toHaveProperty("tenantId");
    expect(dto).not.toHaveProperty("organisationId");
    expect(dto).not.toHaveProperty("logoStorageKey");
    expect(dto.marketplaceVisibility).toBe("organisation_private");
    expect(dto.marketplaceReadinessState).toBe("not_assessed");
    expect(Object.keys(dto)).not.toContain("fitScore");
  });
});

describe("company events", () => {
  const registry = createEventRegistry([...COMPANY_EVENTS]);
  const base = {
    tenantId: TENANT,
    organisationId: ORG,
    companyId: COMPANY,
    version: 1,
    actorUserId: USER,
    correlationId: CORRELATION,
  };

  it("registers core.company.created@1 and core.company.updated@1 with INTERNAL sensitivity", () => {
    for (const name of ["core.company.created", "core.company.updated"]) {
      const definition = registry.get(name, 1);
      expect(definition?.owner).toBe("@capital-q/companies");
      expect(definition?.sensitivity).toBe("INTERNAL");
      expect(definition?.replaySafety).toBe("REPLAY_SAFE");
      expect(registry.has(name, 2)).toBe(false);
    }
  });

  it("produces minimal envelopes with the company aggregate", () => {
    const created = companyCreatedEvent(base);
    const updated = companyUpdatedEvent({
      ...base,
      version: 2,
      changedFields: ["shortDescription"],
    });
    for (const event of [created, updated]) {
      expect(registry.parse(event).ok).toBe(true);
      expect(event.aggregate?.type).toBe("company");
      expect(event.aggregate?.id).toBe(COMPANY);
      expect(event.tenantId).toBe(TENANT);
    }
    expect(created.data).toEqual({
      companyId: COMPANY,
      organisationId: ORG,
      version: 1,
    });
    expect(updated.data).toEqual({
      companyId: COMPANY,
      version: 2,
      changedFields: ["shortDescription"],
    });
    expect(updated.aggregate?.version).toBe(2);
  });

  it("rejects an unknown version and a profile dump in the payload", () => {
    const event = companyCreatedEvent(base);
    expect(registry.parse({ ...event, eventVersion: 2 }).ok).toBe(false);
    expect(
      registry.parse({
        ...event,
        data: { ...event.data, canonicalName: "Acme" },
      }).ok,
    ).toBe(false);
    expect(
      CompanyCreatedEvent.dataSchema.safeParse({ companyId: COMPANY }).success,
    ).toBe(false);
  });
});
