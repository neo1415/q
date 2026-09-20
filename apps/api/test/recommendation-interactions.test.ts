import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  DISCOVERY_INTERACTIONS_PATH,
  DISCOVERY_SAVED_PATH,
} from "@capital-q/contracts";
import type {
  DiscoveryService,
  InteractionCommand,
  InteractionOutcome,
  InteractionSignalService,
  InteractionState,
  SlateReadService,
} from "@capital-q/discovery";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * `/v1/discovery` interactions over HTTP (CQ-REC-008 D).
 *
 * The handlers are thin, so what is worth testing here is the trust
 * boundary: that nothing a caller sends becomes authority, that the one
 * generic ingest admits only the four types a client may report, and that
 * every refusal looks the same.
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
const SLATE = "55555555-0000-4000-8000-000000000001";

const notUnderTest = () => Promise.reject(new Error("not under test"));
const discovery: DiscoveryService = {
  discoverCompanies: notUnderTest,
  discoverInvestors: notUnderTest,
  sideFor: () => Promise.resolve("INVESTOR"),
};
const slates: SlateReadService = { pageCompanies: notUnderTest };

const STATE: InteractionState = {
  companyId: COMPANY,
  saved: true,
  savedAt: "2026-09-30T10:00:00.000Z",
  passed: false,
  passedAt: null,
  lastPassReason: null,
  impressionCount: 1,
  lastImpressionAt: "2026-09-30T10:00:00.000Z",
  lastInteractionAt: "2026-09-30T10:00:00.000Z",
};

type Recorded = { readonly type: string; readonly command: InteractionCommand };

/**
 * What the service hands back. The DTO deliberately drops almost all of
 * it, and the assertions below check exactly what survives the boundary.
 */
const RECORDED_EVENT = {
  id: "77777777-0000-4000-8000-000000000001",
  tenantId: CONTEXT.tenantId,
  actorUserId: CONTEXT.userId,
  investorOrganisationId: "11111111-0000-4000-8000-000000000013",
  companyId: COMPANY,
  companyTenantId: "22222222-0000-4000-8000-000000000001",
  interactionType: "IMPRESSION",
  strengthClass: "ATTENTION",
  interactionVersion: "recommendation-interaction.v1",
  surface: "RECOMMENDATION_FEED",
  exposure: {
    slateId: SLATE,
    slateItemId: "66666666-0000-4000-8000-000000000001",
    position: 4,
    rankerVersion: "deterministic-ranker.v1",
    rankingConfigVersion: "ranking-config.v1",
  },
  mediaAssetId: null,
  watchMilestone: null,
  passReason: null,
  clientEventId: "evt-000000000001",
  sessionId: "sess-000000000001",
  occurredAt: "2026-09-30T10:00:00.000Z",
  recordedAt: "2026-09-30T10:00:00.000Z",
} as const;

function buildApp(
  options: {
    readonly principal?: AuthenticatedPrincipal | null;
    readonly outcome?: InteractionOutcome | undefined;
    readonly saved?: readonly string[] | undefined;
  } = {},
): { readonly app: FastifyInstance; readonly recorded: Recorded[] } {
  const recorded: Recorded[] = [];
  const outcome: InteractionOutcome = options.outcome ?? {
    kind: "RECORDED",
    deduplicated: false,
    event: RECORDED_EVENT,
    state: STATE,
  };
  const interactions: InteractionSignalService = {
    decide: (type, command) => {
      recorded.push({ type, command });
      return Promise.resolve(outcome);
    },
    observe: (type, command) => {
      recorded.push({ type, command });
      return Promise.resolve(outcome);
    },
    stateForCompanies: () => Promise.resolve(new Map()),
    savedCompanyIds: () => Promise.resolve(options.saved ?? [COMPANY]),
  };
  const security: ApiSecurityDependencies = {
    authenticator: {
      authenticate: () =>
        Promise.resolve(
          options.principal === undefined ? PRINCIPAL : options.principal,
        ),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    discovery: { discovery, slates, interactions },
  });
  return { app, recorded };
}

const body = (extra: Record<string, unknown> = {}) => ({
  clientEventId: "evt-000000000001",
  sessionId: "sess-000000000001",
  surface: "RECOMMENDATION_FEED",
  slateId: SLATE,
  ...extra,
});

describe("POST /v1/discovery/interactions", () => {
  it("records an observation and passes the actor through as the server resolved it", async () => {
    const { app, recorded } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: DISCOVERY_INTERACTIONS_PATH,
      payload: body({ type: "IMPRESSION", companyId: COMPANY }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.type).toBe("IMPRESSION");
    expect(recorded[0]?.command.actor).toEqual(CONTEXT);
    expect(recorded[0]?.command.slateId).toBe(SLATE);
  });

  it("O: the ingest cannot be asked to create INTEREST", async () => {
    // Not a service refusal reaching the client: the type is not in the
    // schema at all, so the request never becomes an interaction.
    const { app, recorded } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: DISCOVERY_INTERACTIONS_PATH,
      payload: body({ type: "INTEREST_OBSERVED", companyId: COMPANY }),
    });
    expect(response.statusCode).toBe(422);
    expect(recorded).toHaveLength(0);
  });

  it("nor SAVE or PASS: a decision has its own path, so a body cannot become one", async () => {
    const { app, recorded } = buildApp();
    for (const type of ["SAVE", "PASS", "UNSAVE"]) {
      const response = await app.inject({
        method: "POST",
        url: DISCOVERY_INTERACTIONS_PATH,
        payload: body({ type, companyId: COMPANY }),
      });
      expect(response.statusCode).toBe(422);
    }
    expect(recorded).toHaveLength(0);
  });

  it("has nowhere to put a tenant, an organisation, a rank or a ranking version", async () => {
    // The schema is strict, so a forged field is a 422 rather than a value
    // quietly ignored — and the difference matters, because a field that
    // is ignored today is a field somebody wires up tomorrow.
    const { app, recorded } = buildApp();
    for (const forged of [
      { tenantId: "c0000000-0000-4000-8000-000000000009" },
      { investorOrganisationId: "11111111-0000-4000-8000-000000000099" },
      { position: 1 },
      { rankingConfigVersion: "ranking-config.v99" },
      { actorUserId: "b0000000-0000-4000-8000-000000000009" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: DISCOVERY_INTERACTIONS_PATH,
        payload: body({ type: "IMPRESSION", companyId: COMPANY, ...forged }),
      });
      expect(response.statusCode, JSON.stringify(forged)).toBe(422);
    }
    expect(recorded).toHaveLength(0);
  });

  it("bounds the identifiers a client supplies", async () => {
    const { app } = buildApp();
    for (const bad of [
      { clientEventId: "short" },
      { clientEventId: "x".repeat(65) },
      { sessionId: "!!!!!!!!" },
      { surface: "MY_OWN_SURFACE" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: DISCOVERY_INTERACTIONS_PATH,
        payload: body({ type: "IMPRESSION", companyId: COMPANY, ...bad }),
      });
      expect(response.statusCode, JSON.stringify(bad)).toBe(422);
    }
  });

  it("returns whether a retry was recognised, and no exposure context at all", async () => {
    const base = buildApp();
    const { app } = buildApp({
      outcome: {
        kind: "RECORDED",
        deduplicated: true,
        // A retry: the event already existed, and no state was projected
        // again, so the DTO's state is null.
        event: RECORDED_EVENT,
      },
    });
    expect(base.recorded).toHaveLength(0);
    const response = await app.inject({
      method: "POST",
      url: DISCOVERY_INTERACTIONS_PATH,
      payload: body({ type: "PROFILE_OPEN", companyId: COMPANY }),
    });
    expect(response.statusCode).toBe(200);
    const payload: Record<string, unknown> = response.json();
    expect(payload["deduplicated"]).toBe(true);
    // Telling a caller the rank the server resolved hands them the
    // vocabulary to forge it next time.
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain("position");
    expect(serialised).not.toContain("ranking-config");
    expect(serialised).not.toContain("slateId");
  });

  it("every refusal is byte-for-byte the same 404", async () => {
    // Not "does not contain the word": the standard problem code is
    // literally RESOURCE_NOT_FOUND, so the honest assertion is that the
    // two refusals are indistinguishable from each other. Which one it
    // was is the question the endpoint must not answer.
    const bodies: string[] = [];
    for (const refusal of ["NOT_FOUND", "NOT_CLIENT_WRITABLE"] as const) {
      const { app } = buildApp({ outcome: { kind: "REFUSED", refusal } });
      const response = await app.inject({
        method: "POST",
        url: DISCOVERY_INTERACTIONS_PATH,
        payload: body({ type: "IMPRESSION", companyId: COMPANY }),
      });
      expect(response.statusCode).toBe(404);
      // The request id is the one field that legitimately differs.
      bodies.push(response.body.replace(/"requestId":"[^"]+"/, ""));
    }
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[0]).not.toContain("CLIENT_WRITABLE");
  });

  it("requires an authenticated actor", async () => {
    const { app, recorded } = buildApp({ principal: null });
    const response = await app.inject({
      method: "POST",
      url: DISCOVERY_INTERACTIONS_PATH,
      payload: body({ type: "IMPRESSION", companyId: COMPANY }),
    });
    expect(response.statusCode).toBe(401);
    expect(recorded).toHaveLength(0);
  });
});

describe("save, unsave and pass", () => {
  it("each is its own path, so the verb is never a body field", async () => {
    const { app, recorded } = buildApp();
    for (const [segment, type] of [
      ["save", "SAVE"],
      ["unsave", "UNSAVE"],
      ["pass", "PASS"],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/discovery/companies/${COMPANY}/${segment}`,
        payload: body(),
      });
      expect(response.statusCode, segment).toBe(200);
      expect(recorded.at(-1)?.type).toBe(type);
      expect(recorded.at(-1)?.command.companyId).toBe(COMPANY);
    }
  });

  it("K: a pass reason is optional and bounded", async () => {
    const { app, recorded } = buildApp();
    const without = await app.inject({
      method: "POST",
      url: `/v1/discovery/companies/${COMPANY}/pass`,
      payload: body(),
    });
    expect(without.statusCode).toBe(200);
    expect(recorded.at(-1)?.command.passReason).toBeUndefined();

    const withReason = await app.inject({
      method: "POST",
      url: `/v1/discovery/companies/${COMPANY}/pass`,
      payload: body({ reason: "STAGE" }),
    });
    expect(withReason.statusCode).toBe(200);
    expect(recorded.at(-1)?.command.passReason).toBe("STAGE");

    const invented = await app.inject({
      method: "POST",
      url: `/v1/discovery/companies/${COMPANY}/pass`,
      payload: body({ reason: "THE FOUNDER SEEMED ODD" }),
    });
    // No free text about somebody's company.
    expect(invented.statusCode).toBe(422);
  });

  it("a malformed company id is refused before anything is recorded", async () => {
    const { app, recorded } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/discovery/companies/not-a-uuid/save",
      payload: body(),
    });
    expect(response.statusCode).toBe(422);
    expect(recorded).toHaveLength(0);
  });
});

describe("GET /v1/discovery/saved", () => {
  it("returns identities only, so a company that became private cannot leak", async () => {
    const { app } = buildApp({ saved: [COMPANY] });
    const response = await app.inject({
      method: "GET",
      url: DISCOVERY_SAVED_PATH,
    });
    expect(response.statusCode).toBe(200);
    const payload: { companyIds: string[] } = response.json();
    expect(payload.companyIds).toEqual([COMPANY]);
    // No name, no description, no card: the caller reads those back
    // through the ordinary company path, which re-checks disclosure.
    expect(Object.keys(payload)).toEqual(["companyIds"]);
  });

  it("R: there is no route that reads another person's behaviour", async () => {
    const { app } = buildApp();
    // A founder asking who watched them, an investor asking about a
    // colleague: neither exists, and a 404 is the whole answer.
    for (const url of [
      `/v1/discovery/companies/${COMPANY}/interactions`,
      `/v1/discovery/companies/${COMPANY}/viewers`,
      "/v1/discovery/interactions/history",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(404);
    }
  });
});
