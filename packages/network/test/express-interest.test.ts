import { describe, expect, it } from "vitest";

import { createEventRegistry } from "@capital-q/contracts";
import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { CompanyQueryPort } from "@capital-q/companies";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { InvestorOrganisationQueryPort } from "@capital-q/investors";
import {
  AuthorizationDeniedError,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthorizationRequest,
  type AuthorizationService,
} from "@capital-q/security";

import {
  NETWORK_EVENTS,
  relationshipInterestExpressedEvent,
} from "../src/events/index.js";
import {
  createInterestService,
  hashExpressInterestRequest,
  hashInterestIdempotencyKey,
  InterestCompanyNotFoundError,
  InterestNotPermittedError,
  type InterestRepository,
  type InterestRequestStore,
  type RelationshipEventRepository,
  type RelationshipRepository,
} from "../src/index.js";

/**
 * Express Interest's authorisation order, without a database (CQ-NET-010).
 *
 * Every refusal must happen before a transaction opens: a refused request
 * writes nothing, not even an idempotency record. The fakes below throw if
 * anything past the checks is touched, so "nothing written" is asserted by
 * construction rather than by counting rows. The written path is proven
 * against real PostgreSQL in express-interest.integration.test.ts.
 */

const ACTOR: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const COMPANY = "44444444-0000-4000-8000-000000000001";
const INVESTOR = "11111111-0000-4000-8000-000000000013";

const untouched = (what: string) => () => {
  throw new Error(`${what} must not be reached when the request is refused`);
};

/** A port whose every member throws: reaching it at all fails the test. */
function refusing<T extends object>(what: string): T {
  return new Proxy({}, { get: () => untouched(what) }) as T;
}

function build(options: {
  readonly investor?: string | null;
  readonly allow?: boolean;
  readonly visible?: boolean;
}) {
  const requests: AuthorizationRequest[] = [];
  const authorization: AuthorizationService = {
    authorize: untouched("authorize"),
    requireCapability: (request) => {
      requests.push(request);
      return options.allow === false
        ? Promise.reject(new AuthorizationDeniedError("NO_MATCHING_GRANT"))
        : Promise.resolve();
    },
  };
  const visibilityAsked: string[] = [];
  const service = createInterestService({
    sql: refusing<DatabaseExecutor>("sql"),
    transactions: refusing<TransactionManager>("transaction"),
    companies: refusing<CompanyQueryPort>("company lookup"),
    investors: refusing<InvestorOrganisationQueryPort>("investor lookup"),
    outbox: refusing<OutboxWriter>("outbox"),
    audit: refusing<MaterialActionAuditWriter>("audit"),
    repositories: {
      relationships: refusing<RelationshipRepository>("relationships"),
      events: refusing<RelationshipEventRepository>("history"),
    },
    interests: refusing<InterestRepository>("interests"),
    interestRequests: refusing<InterestRequestStore>("idempotency record"),
    authorization,
    investorSubject: {
      investorOrganisationFor: () =>
        Promise.resolve(
          options.investor === null
            ? null
            : { investorOrganisationId: options.investor ?? INVESTOR },
        ),
    },
    companyVisibility: {
      isVisibleToInvestor: (_actor, companyId) => {
        visibilityAsked.push(companyId);
        return Promise.resolve(options.visible ?? true);
      },
    },
  });
  return { service, requests, visibilityAsked };
}

const command = (companyId = COMPANY) => ({
  actor: ACTOR,
  companyId,
  surface: "RECOMMENDATION_FEED" as const,
  idempotencyKey: "interest:key-000001",
  correlationId: "cor_00000000-0000-4000-8000-000000000001" as const,
});

describe("Express Interest refuses before it writes", () => {
  it("refuses an actor who is not acting for an investor organisation", async () => {
    const { service, requests, visibilityAsked } = build({ investor: null });
    await expect(service.expressInterest(command())).rejects.toBeInstanceOf(
      InterestNotPermittedError,
    );
    expect(requests).toHaveLength(0);
    expect(visibilityAsked).toHaveLength(0);
  });

  it("asks for investor.interest.express on the actor's own investor organisation, and stops on a denial", async () => {
    const { service, requests, visibilityAsked } = build({ allow: false });
    await expect(service.expressInterest(command())).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
    expect(requests).toEqual([
      {
        actor: ACTOR,
        capability: "investor.interest.express",
        resource: {
          kind: "RESOURCE",
          tenantId: ACTOR.tenantId,
          organisationId: ACTOR.organisationId,
          resourceType: "investor_organisation",
          resourceId: INVESTOR,
        },
      },
    ]);
    expect(visibilityAsked).toHaveLength(0);
  });

  it("answers not-found for a company the investor may not see, and for a malformed id", async () => {
    const hidden = build({ visible: false });
    await expect(
      hidden.service.expressInterest(command()),
    ).rejects.toBeInstanceOf(InterestCompanyNotFoundError);
    expect(hidden.visibilityAsked).toEqual([COMPANY]);

    const malformed = build({});
    await expect(
      malformed.service.expressInterest(command("../../companies")),
    ).rejects.toBeInstanceOf(InterestCompanyNotFoundError);
    expect(malformed.visibilityAsked).toHaveLength(0);
  });

  it("applies the same checks to the status read", async () => {
    const { service } = build({ visible: false });
    await expect(
      service.getOwnInterest({ actor: ACTOR, companyId: COMPANY }),
    ).rejects.toBeInstanceOf(InterestCompanyNotFoundError);
  });
});

describe("idempotency fingerprints", () => {
  it("namespace the key and fingerprint the company only", () => {
    expect(hashInterestIdempotencyKey("k-1")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInterestIdempotencyKey("k-1")).not.toBe(
      hashInterestIdempotencyKey("k-2"),
    );
    expect(hashExpressInterestRequest(COMPANY)).toBe(
      hashExpressInterestRequest(COMPANY),
    );
    expect(hashExpressInterestRequest(COMPANY)).not.toBe(
      hashExpressInterestRequest("44444444-0000-4000-8000-000000000002"),
    );
  });
});

describe("network.relationship.interest_expressed@1", () => {
  it("is INTERNAL and carries identifiers only", () => {
    const registry = createEventRegistry([...NETWORK_EVENTS]);
    const definition = registry.get(
      "network.relationship.interest_expressed",
      1,
    );
    expect(definition?.sensitivity).toBe("INTERNAL");
    const event = relationshipInterestExpressedEvent({
      tenantId: "22222222-0000-4000-8000-000000000001",
      organisationId: ACTOR.organisationId ?? "",
      actorUserId: ACTOR.userId,
      correlationId: "cor_00000000-0000-4000-8000-000000000001",
      relationshipId: "88888888-0000-4000-8000-000000000001",
      interestId: "77777777-0000-4000-8000-000000000001",
      companyId: COMPANY,
      investorOrganisationId: INVESTOR,
    });
    expect(registry.parse(event).ok).toBe(true);
    expect(
      registry.parse({ ...event, data: { ...event.data, matched: true } }).ok,
    ).toBe(false);
  });
});
