import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  RelationshipBriefSchema,
  UtcTimestampSchema,
  type RelationshipBrief,
} from "@capital-q/contracts";
import {
  InterestCompanyNotFoundError,
  InterestIdempotencyConflictError,
  InterestAlreadyAnsweredError,
  InterestIdSchema,
  InterestNotFoundError,
  InterestNotPermittedError,
  InterestResponseIdSchema,
  MatchIdSchema,
  RelationshipEventIdSchema,
  RelationshipIdSchema,
  type ExpressInterestCommand,
  type Interest,
  type InterestService,
  type RelationshipStatus,
  type RespondToInterestCommand,
} from "@capital-q/network";
import { CompanyIdSchema } from "@capital-q/companies";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import {
  namedImageKey,
  type NamedImageSubject,
} from "@capital-q/public-identity";
import {
  AuthUserIdSchema,
  AuthorizationDeniedError,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * `/v1/network/companies/:companyId/…` over HTTP (CQ-NET-010).
 *
 * The handler is thin; what is worth testing is the trust boundary. The
 * key is required, the body cannot name an organisation, tenant or
 * relationship, the actor reaching the service is the server-resolved one,
 * and each refusal has its own stable problem code.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const CONTEXT: ActorContext = {
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
const PATH = `/v1/network/companies/${COMPANY}/express-interest`;
const KEY = "interest:0f6c1e7a-1111-4111-8111-000000000001";

const INTEREST: Interest = {
  id: InterestIdSchema.parse("77777777-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("22222222-0000-4000-8000-000000000001"),
  relationshipId: RelationshipIdSchema.parse(
    "88888888-0000-4000-8000-000000000001",
  ),
  companyId: CompanyIdSchema.parse(COMPANY),
  investorOrganisationId: InvestorOrganisationIdSchema.parse(
    "11111111-0000-4000-8000-000000000013",
  ),
  expressedByParty: "INVESTOR",
  status: "EXPRESSED",
  expressedByUserId: CONTEXT.userId,
  expressedInOrganisationId: "d0000000-0000-4000-8000-000000000001",
  relationshipEventId: RelationshipEventIdSchema.parse(
    "99999999-0000-4000-8000-000000000001",
  ),
  createdAt: UtcTimestampSchema.parse("2026-09-24T10:00:00.000Z"),
  response: null,
  connection: null,
};

const ACCEPTED: Interest = {
  ...INTEREST,
  response: {
    id: InterestResponseIdSchema.parse("66666666-0000-4000-8000-000000000001"),
    decision: "ACCEPTED",
    respondedAt: UtcTimestampSchema.parse("2026-09-25T10:00:00.000Z"),
  },
  connection: {
    id: MatchIdSchema.parse("55555555-0000-4000-8000-000000000001"),
    status: "ACTIVE",
    connectedAt: UtcTimestampSchema.parse("2026-09-25T10:00:00.000Z"),
  },
};

const RELATIONSHIP = {
  id: RelationshipIdSchema.parse("88888888-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("22222222-0000-4000-8000-000000000001"),
  companyId: CompanyIdSchema.parse(COMPANY),
  investorOrganisationId: InvestorOrganisationIdSchema.parse(
    "11111111-0000-4000-8000-000000000013",
  ),
  currentState: "CONNECTED",
  stateUpdatedAt: UtcTimestampSchema.parse("2026-09-25T11:00:00.000Z"),
  firstDiscoveredAt: UtcTimestampSchema.parse("2026-09-25T09:00:00.000Z"),
  lastEventSequence: 3,
  createdAt: UtcTimestampSchema.parse("2026-09-25T09:00:00.000Z"),
};

const STATUS: RelationshipStatus = {
  relationship: RELATIONSHIP,
  projection: {
    version: "relationship-state.v1",
    state: "CONNECTED",
    stateSince: "2026-09-25T11:00:00.000Z",
    throughSequence: 3,
    milestones: [
      {
        state: "INTEREST_EXPRESSED",
        at: "2026-09-25T10:00:00.000Z",
        sequence: 2,
      },
      { state: "CONNECTED", at: "2026-09-25T11:00:00.000Z", sequence: 3 },
    ],
    anomalies: [],
    unrecognised: 0,
  },
  nextStep: "SCHEDULE_MEETING",
};

const INVESTOR = {
  id: InvestorOrganisationIdSchema.parse(
    "11111111-0000-4000-8000-000000000013",
  ),
  tenantId: TenantIdSchema.parse("33333333-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000002",
  ),
  investorType: "VC",
  displayName: "Apex Ventures",
  deploymentState: null,
} as const;

function buildApp(
  options: {
    readonly failWith?: Error | undefined;
    readonly deduplicated?: boolean | undefined;
    readonly noRelationship?: boolean | undefined;
    /** Signed pictures by "TYPE:id"; set, the photo reader is composed. */
    readonly photos?: Readonly<Record<string, string>> | undefined;
    /** The brief the service answers; null: not a party (R1). */
    readonly brief?: RelationshipBrief | null | undefined;
  } = {},
): {
  readonly app: FastifyInstance;
  readonly calls: ExpressInterestCommand[];
  readonly answers: RespondToInterestCommand[];
  readonly reads: Record<string, unknown>[];
  readonly asked: NamedImageSubject[][];
} {
  const asked: NamedImageSubject[][] = [];
  const photos = options.photos;
  const namedPhotos =
    photos === undefined
      ? undefined
      : {
          photos: (subjects: readonly NamedImageSubject[]) => {
            asked.push([...subjects]);
            return Promise.resolve(
              new Map(
                subjects.flatMap((subject) => {
                  const url = photos[namedImageKey(subject)];
                  return url === undefined
                    ? []
                    : [[namedImageKey(subject), url] as const];
                }),
              ),
            );
          },
          images: () => Promise.reject(new Error("not under test")),
        };
  const calls: ExpressInterestCommand[] = [];
  const answers: RespondToInterestCommand[] = [];
  const reads: Record<string, unknown>[] = [];
  const interests: InterestService = {
    expressInterest: (command) => {
      calls.push(command);
      return options.failWith === undefined
        ? Promise.resolve({
            interest: INTEREST,
            deduplicated: options.deduplicated ?? false,
          })
        : Promise.reject(options.failWith);
    },
    getOwnInterest: () =>
      options.failWith === undefined
        ? Promise.resolve(INTEREST)
        : Promise.reject(options.failWith),
    mayExpressInterest: () => Promise.resolve(options.failWith === undefined),
    listIncomingInterest: () =>
      options.failWith === undefined
        ? Promise.resolve([{ interest: INTEREST, investor: INVESTOR }])
        : Promise.reject(options.failWith),
    respondToInterest: (command) => {
      answers.push(command);
      return options.failWith === undefined
        ? Promise.resolve({
            interest: command.decision === "ACCEPTED" ? ACCEPTED : INTEREST,
            investor: INVESTOR,
            deduplicated: options.deduplicated ?? false,
          })
        : Promise.reject(options.failWith);
    },
    mayRespondToInterest: () => Promise.resolve(options.failWith === undefined),
    relationshipForInvestor: (query) => {
      reads.push({ side: "INVESTOR", ...query });
      return options.failWith === undefined
        ? Promise.resolve(STATUS)
        : Promise.reject(options.failWith);
    },
    relationshipForCompany: (query) => {
      reads.push({ side: "COMPANY", ...query });
      return options.failWith === undefined
        ? Promise.resolve(options.noRelationship === true ? null : STATUS)
        : Promise.reject(options.failWith);
    },
    relationshipById: () => Promise.reject(new Error("not under test")),
    relationshipBrief: (query) => {
      reads.push({ side: "BRIEF", ...query });
      return options.brief === undefined
        ? Promise.reject(new Error("not under test"))
        : Promise.resolve(options.brief);
    },
    listRelationshipsForInvestor: (query) => {
      reads.push({ side: "INVESTOR_LIST", ...query });
      return options.failWith === undefined
        ? Promise.resolve([{ ...STATUS, counterpartName: "Kora" }])
        : Promise.reject(options.failWith);
    },
    listRelationshipsForCompany: (query) => {
      reads.push({ side: "COMPANY_LIST", ...query });
      return options.failWith === undefined
        ? Promise.resolve([{ ...STATUS, counterpartName: "Beacon Ventures" }])
        : Promise.reject(options.failWith);
    },
  };
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    interests,
    namedPhotos,
  });
  return { app, calls, answers, reads, asked };
}

const post = (
  app: FastifyInstance,
  payload: unknown,
  headers: Record<string, string> = { "idempotency-key": KEY },
) =>
  app.inject({
    method: "POST",
    url: PATH,
    payload: payload as object,
    headers,
  });

describe("POST /v1/network/companies/:companyId/express-interest", () => {
  it("expresses interest as the server-resolved actor and answers 201 with the interest", async () => {
    const { app, calls } = buildApp();
    const response = await post(app, { surface: "RECOMMENDATION_FEED" });

    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      interest: {
        interestId: INTEREST.id,
        relationshipId: INTEREST.relationshipId,
        companyId: COMPANY,
        status: "EXPRESSED",
        expressedAt: INTEREST.createdAt,
        response: "PENDING",
        respondedAt: null,
        connection: null,
      },
      deduplicated: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      actor: CONTEXT,
      companyId: COMPANY,
      surface: "RECOMMENDATION_FEED",
      idempotencyKey: KEY,
    });
  });

  it("answers 200 and deduplicated when nothing new was written", async () => {
    const { app } = buildApp({ deduplicated: true });
    const response = await post(app, { surface: "COMPANY_PROFILE" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ deduplicated: true });
  });

  it("requires an Idempotency-Key", async () => {
    const { app, calls } = buildApp();
    const response = await post(app, { surface: "RECOMMENDATION_FEED" }, {});
    expect(response.statusCode).toBe(422);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(calls).toHaveLength(0);
  });

  it("accepts no organisation, tenant or relationship in the body", async () => {
    const { app, calls } = buildApp();
    for (const extra of [
      { investorOrganisationId: "11111111-0000-4000-8000-000000000099" },
      { tenantId: "c0000000-0000-4000-8000-000000000099" },
      { relationshipId: "88888888-0000-4000-8000-000000000099" },
      { surface: "Q_CONVERSATION" },
    ]) {
      const response = await post(app, {
        surface: "RECOMMENDATION_FEED",
        ...extra,
      });
      expect(response.statusCode).toBe(422);
    }
    expect(calls).toHaveLength(0);
  });

  it.each([
    [new InterestCompanyNotFoundError(), 404, "RESOURCE_NOT_FOUND"],
    [new InterestNotPermittedError(), 403, "PERMISSION_DENIED"],
    [
      new AuthorizationDeniedError("NO_MATCHING_GRANT"),
      403,
      "PERMISSION_DENIED",
    ],
    [new InterestIdempotencyConflictError(), 409, "IDEMPOTENCY_CONFLICT"],
  ] as const)("maps %s to a stable problem", async (error, status, code) => {
    const { app } = buildApp({ failWith: error });
    const response = await post(app, { surface: "RECOMMENDATION_FEED" });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code });
  });
});

describe("GET /v1/network/companies/:companyId/interest", () => {
  it("returns the caller's organisation's own interest", async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/network/companies/${COMPANY}/interest`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      interest: { interestId: INTEREST.id, status: "EXPRESSED" },
    });
  });

  it("answers not-found for a company the caller may not see", async () => {
    const { app } = buildApp({ failWith: new InterestCompanyNotFoundError() });
    const response = await app.inject({
      method: "GET",
      url: `/v1/network/companies/${COMPANY}/interest`,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("the company's side (CQ-NET-011)", () => {
  const INTEREST_ID = "77777777-0000-4000-8000-000000000001";

  it("lists incoming interest with the investor organisation's name and nothing about who acted", async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/network/companies/${COMPANY}/incoming-interest`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: Record<string, unknown>[] }>();
    expect(body.items).toEqual([
      {
        interestId: INTEREST_ID,
        investorOrganisationId: INVESTOR.id,
        investorName: "Apex Ventures",
        investorPhotoUrl: null,
        investorType: "VC",
        expressedAt: INTEREST.createdAt,
        response: "PENDING",
        respondedAt: null,
        connection: null,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain(CONTEXT.userId);
  });

  it("accepts as the server-resolved actor: 201 with the connection", async () => {
    const { app, answers } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: `/v1/network/interests/${INTEREST_ID}/accept`,
      headers: { "idempotency-key": KEY },
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      interest: {
        response: "ACCEPTED",
        connection: { connectionId: ACCEPTED.connection?.id, status: "ACTIVE" },
      },
      deduplicated: false,
    });
    expect(answers[0]).toMatchObject({
      actor: CONTEXT,
      interestId: INTEREST_ID,
      decision: "ACCEPTED",
      surface: "INBOX",
      idempotencyKey: KEY,
    });
  });

  it("the verb is the path: decline records DECLINED, and a body cannot carry a reason or a decision", async () => {
    const { app, answers } = buildApp();
    const declined = await app.inject({
      method: "POST",
      url: `/v1/network/interests/${INTEREST_ID}/decline`,
      headers: { "idempotency-key": KEY },
    });
    expect(declined.statusCode).toBe(201);
    expect(answers[0]?.decision).toBe("DECLINED");
    for (const payload of [{ reason: "weak team" }, { decision: "ACCEPTED" }]) {
      const refused = await app.inject({
        method: "POST",
        url: `/v1/network/interests/${INTEREST_ID}/decline`,
        headers: { "idempotency-key": KEY },
        payload,
      });
      expect(refused.statusCode).toBe(422);
    }
    expect(answers).toHaveLength(1);
  });

  it("requires an Idempotency-Key", async () => {
    const { app, answers } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: `/v1/network/interests/${INTEREST_ID}/accept`,
      payload: {},
    });
    expect(response.statusCode).toBe(422);
    expect(answers).toHaveLength(0);
  });

  it.each([
    [new InterestNotFoundError(), 404, "RESOURCE_NOT_FOUND"],
    [new InterestAlreadyAnsweredError(), 409, "RESOURCE_CONFLICT"],
    [new InterestIdempotencyConflictError(), 409, "IDEMPOTENCY_CONFLICT"],
    [
      new AuthorizationDeniedError("NO_MATCHING_GRANT"),
      403,
      "PERMISSION_DENIED",
    ],
  ] as const)("maps %s to a stable problem", async (error, status, code) => {
    const { app } = buildApp({ failWith: error });
    const response = await app.inject({
      method: "POST",
      url: `/v1/network/interests/${INTEREST_ID}/accept`,
      headers: { "idempotency-key": KEY },
      payload: {},
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code });
  });

  it("the investor's own read carries the answer from the server", async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/network/companies/${COMPANY}/interest`,
    });
    expect(response.json()).toMatchObject({
      interest: { response: "PENDING", connection: null },
    });
  });
});

describe("where are we (CQ-NET-012)", () => {
  it("answers the investor's question about a company with state, milestones and the next step", async () => {
    const { app, reads } = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/network/companies/${COMPANY}/relationship`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      relationship: {
        relationshipId: RELATIONSHIP.id,
        companyId: COMPANY,
        investorOrganisationId: RELATIONSHIP.investorOrganisationId,
        state: "CONNECTED",
        stateSince: "2026-09-25T11:00:00.000Z",
        milestones: [
          { state: "INTEREST_EXPRESSED", at: "2026-09-25T10:00:00.000Z" },
          { state: "CONNECTED", at: "2026-09-25T11:00:00.000Z" },
        ],
        nextStep: "SCHEDULE_MEETING",
        projectorVersion: "relationship-state.v1",
      },
    });
    expect(reads[0]).toMatchObject({
      side: "INVESTOR",
      actor: CONTEXT,
      companyId: COMPANY,
    });
  });

  it("answers the company's question about an investor, and null when nothing visible exists", async () => {
    const investorId = RELATIONSHIP.investorOrganisationId;
    const found = await buildApp().app.inject({
      method: "GET",
      url: `/v1/network/investors/${investorId}/relationship`,
    });
    expect(found.json()).toMatchObject({
      relationship: { state: "CONNECTED" },
    });
    const none = await buildApp({ noRelationship: true }).app.inject({
      method: "GET",
      url: `/v1/network/investors/${investorId}/relationship`,
    });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toEqual({ relationship: null });
  });

  it("carries no anomaly counts, sequences or payloads", async () => {
    const response = await buildApp().app.inject({
      method: "GET",
      url: `/v1/network/companies/${COMPANY}/relationship`,
    });
    const text = response.body;
    expect(text).not.toContain("anomal");
    expect(text).not.toContain("sequence");
    expect(text).not.toContain("payload");
  });

  it("answers not-found for a company the investor may not see", async () => {
    const { app } = buildApp({ failWith: new InterestCompanyNotFoundError() });
    const response = await app.inject({
      method: "GET",
      url: `/v1/network/companies/${COMPANY}/relationship`,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("each side's own relationships (CQ-WEB-030)", () => {
  it("lists an investor's relationships as summaries: counterpart, state, since, next step", async () => {
    const { app, reads } = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/network/relationships",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          relationshipId: RELATIONSHIP.id,
          counterpart: {
            kind: "COMPANY",
            id: COMPANY,
            name: "Kora",
            photoUrl: null,
          },
          state: "CONNECTED",
          stateSince: "2026-09-25T11:00:00.000Z",
          nextStep: "SCHEDULE_MEETING",
        },
      ],
    });
    expect(reads[0]).toMatchObject({ side: "INVESTOR_LIST", actor: CONTEXT });
  });

  it("lists a company's relationships with investor organisations as the counterparts", async () => {
    const { app, reads } = buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/v1/network/companies/${COMPANY}/relationships`,
    });
    expect(response.json()).toMatchObject({
      items: [
        {
          counterpart: {
            kind: "INVESTOR_ORGANISATION",
            id: RELATIONSHIP.investorOrganisationId,
            name: "Beacon Ventures",
          },
        },
      ],
    });
    expect(reads[0]).toMatchObject({
      side: "COMPANY_LIST",
      companyId: COMPANY,
    });
    expect(response.body).not.toContain("milestones");
  });

  it("answers not-found for a company that is not the caller's own", async () => {
    const { app } = buildApp({ failWith: new InterestCompanyNotFoundError() });
    const response = await app.inject({
      method: "GET",
      url: `/v1/network/companies/${COMPANY}/relationships`,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("pictures have the name's scope (founder decision 2026-10-04)", () => {
  const LOGO =
    "https://storage.test/object/sign/cq-profile-images/logo?token=t";

  it("a row that names the counterpart carries their logo, from one batch", async () => {
    const { app, asked } = buildApp({
      photos: { [`COMPANY:${COMPANY}`]: LOGO },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/network/relationships",
    });
    expect(response.json()).toMatchObject({
      items: [{ counterpart: { id: COMPANY, name: "Kora", photoUrl: LOGO } }],
    });
    expect(asked).toEqual([[{ subjectType: "COMPANY", subjectId: COMPANY }]]);
  });

  it("the company's inbox carries each named investor's logo", async () => {
    const { app, asked } = buildApp({
      photos: { [`INVESTOR_ORGANISATION:${INVESTOR.id}`]: LOGO },
    });
    const response = await app.inject({
      method: "GET",
      url: `/v1/network/companies/${COMPANY}/incoming-interest`,
    });
    expect(response.json()).toMatchObject({
      items: [{ investorName: "Apex Ventures", investorPhotoUrl: LOGO }],
    });
    expect(asked).toHaveLength(1);
  });

  it("a reader who may not see the names gets no picture: nothing is even signed", async () => {
    const { app, asked } = buildApp({
      failWith: new InterestCompanyNotFoundError(),
      photos: { [`INVESTOR_ORGANISATION:${INVESTOR.id}`]: LOGO },
    });
    for (const url of [
      `/v1/network/companies/${COMPANY}/relationships`,
      `/v1/network/companies/${COMPANY}/incoming-interest`,
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("storage.test");
    }
    expect(asked).toEqual([]);
  });
});

describe("the Relationship Brief (R1)", () => {
  const RELATIONSHIP_ID = "88888888-0000-4000-8000-0000000000b1";
  const BRIEF = RelationshipBriefSchema.parse({
    relationshipId: RELATIONSHIP_ID,
    yourSide: "INVESTOR",
    counterparty: {
      kind: "COMPANY",
      id: "88888888-0000-4000-8000-0000000000c1",
      name: "Tensorgate",
    },
    generatedAt: "2026-10-09T23:30:00.000Z",
    state: null,
    messages: {
      count: 12,
      latest: { status: "UNAVAILABLE", reason: "NOT_COMPOSED" },
    },
    meetings: { status: "UNAVAILABLE", reason: "NOT_COMPOSED" },
    pendingDecisions: { items: [], complete: false },
    obligations: { status: "UNAVAILABLE", reason: "NOT_COMPOSED" },
    documents: { status: "UNAVAILABLE", reason: "NOT_COMPOSED" },
    sourceVersions: {
      projector: "relationship-state.v2",
      historySequence: 21,
      brief: "relationship-brief.v1",
    },
  });
  const get = (app: FastifyInstance) =>
    app.inject({
      method: "GET",
      url: `/v1/network/relationships/${RELATIONSHIP_ID}/brief`,
    });

  it("answers the brief as the server-resolved actor, uncached", async () => {
    const { app, reads } = buildApp({ brief: BRIEF });
    const response = await get(app);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual(BRIEF);
    expect(reads).toEqual([
      expect.objectContaining({
        side: "BRIEF",
        actor: CONTEXT,
        relationshipId: RELATIONSHIP_ID,
      }),
    ]);
  });

  it("a relationship the caller is not a party to is a 404, like one that does not exist", async () => {
    const { app } = buildApp({ brief: null });
    const response = await get(app);
    expect(response.statusCode).toBe(404);
    expect(JSON.stringify(response.json())).not.toContain("Tensorgate");
  });
});
