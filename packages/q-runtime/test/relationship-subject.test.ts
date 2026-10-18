import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CompanyIdSchema } from "@capital-q/companies";
import { UtcTimestampSchema } from "@capital-q/contracts";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import { RelationshipIdSchema, type Relationship } from "@capital-q/network";
import { ActorContextSchema, TenantIdSchema } from "@capital-q/security";

import {
  createRelationshipQSubjectResolver,
  type QRelationshipPartiesPort,
} from "../src/index.js";

/**
 * The RELATIONSHIP subject resolves for its two parties and nobody else.
 *
 * The relationship is stored in the company's tenant; the investor side,
 * in its own tenant, resolves it by exact membership through the parties
 * port. Anyone else -- another organisation in either tenant, a person
 * acting personally, the right organisation in the wrong tenant -- gets
 * null, exactly as for an id that does not exist.
 */

const COMPANY_TENANT = randomUUID();
const INVESTOR_TENANT = randomUUID();
const COMPANY_ORG = randomUUID();
const INVESTOR_ORG = randomUUID();
const RELATIONSHIP_ID = randomUUID();

const at = UtcTimestampSchema.parse("2026-09-25T10:00:00.000Z");
const RELATIONSHIP: Relationship = {
  id: RelationshipIdSchema.parse(RELATIONSHIP_ID),
  tenantId: TenantIdSchema.parse(COMPANY_TENANT),
  companyId: CompanyIdSchema.parse(randomUUID()),
  investorOrganisationId: InvestorOrganisationIdSchema.parse(randomUUID()),
  currentState: "CONNECTED",
  stateUpdatedAt: at,
  firstDiscoveredAt: at,
  lastEventSequence: 3,
  createdAt: at,
};

const relationships = {
  getById: (id: string) =>
    Promise.resolve(id === RELATIONSHIP_ID ? RELATIONSHIP : null),
};

const parties: QRelationshipPartiesPort = {
  resolve: (id) =>
    Promise.resolve(
      id === RELATIONSHIP_ID
        ? {
            company: { organisationId: COMPANY_ORG, tenantId: COMPANY_TENANT },
            investor: {
              organisationId: INVESTOR_ORG,
              tenantId: INVESTOR_TENANT,
            },
          }
        : null,
    ),
};

function actor(tenantId: string, organisationId?: string) {
  return ActorContextSchema.parse({
    userId: randomUUID(),
    tenantId,
    ...(organisationId === undefined
      ? {}
      : { organisationId, membershipId: randomUUID() }),
    actorType: "HUMAN",
  });
}

const ref = { kind: "RELATIONSHIP" as const, relationshipId: RELATIONSHIP_ID };

describe("RELATIONSHIP subject resolution", () => {
  const resolver = createRelationshipQSubjectResolver(relationships, parties);

  it("resolves for the company side, anchored in the company's tenant", async () => {
    await expect(
      resolver.resolve(actor(COMPANY_TENANT, COMPANY_ORG), ref),
    ).resolves.toEqual({ ref, tenantId: COMPANY_TENANT, organisationId: null });
  });

  it("resolves for the investor side from its own tenant", async () => {
    await expect(
      resolver.resolve(actor(INVESTOR_TENANT, INVESTOR_ORG), ref),
    ).resolves.toEqual({ ref, tenantId: COMPANY_TENANT, organisationId: null });
  });

  it("is null for everyone who is not a party", async () => {
    const outsiders = [
      actor(COMPANY_TENANT, randomUUID()),
      actor(INVESTOR_TENANT, randomUUID()),
      actor(randomUUID(), randomUUID()),
      actor(COMPANY_TENANT),
      // The right organisation named in the wrong tenant.
      actor(INVESTOR_TENANT, COMPANY_ORG),
      actor(COMPANY_TENANT, INVESTOR_ORG),
    ];
    for (const outsider of outsiders) {
      await expect(resolver.resolve(outsider, ref)).resolves.toBeNull();
    }
  });

  it("is null for an unknown or malformed id, as for a non-party", async () => {
    const party = actor(COMPANY_TENANT, COMPANY_ORG);
    await expect(
      resolver.resolve(party, {
        kind: "RELATIONSHIP",
        relationshipId: randomUUID(),
      }),
    ).resolves.toBeNull();
    await expect(
      resolver.resolve(party, { kind: "RELATIONSHIP", relationshipId: "nope" }),
    ).resolves.toBeNull();
  });

  it("without a parties port, only the company's tenant resolves it (the old rule)", async () => {
    const tenantOnly = createRelationshipQSubjectResolver(relationships);
    await expect(
      tenantOnly.resolve(actor(COMPANY_TENANT, COMPANY_ORG), ref),
    ).resolves.not.toBeNull();
    await expect(
      tenantOnly.resolve(actor(INVESTOR_TENANT, INVESTOR_ORG), ref),
    ).resolves.toBeNull();
  });
});
