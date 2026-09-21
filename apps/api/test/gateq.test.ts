import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  GATEQ_GATEWAYS_PATH,
  GATEQ_PUBLIC_GATEWAY_PATH,
} from "@capital-q/contracts";
import type { Gateway, GateQService, PublicGateway } from "@capital-q/gateq";
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
 * `/v1/gateq` over HTTP (CQ-GATE-001 §24–§25).
 *
 * The two audiences, and what separates them. The configuration routes
 * carry an actor and refuse without one. The public route carries none at
 * all — the only anonymous surface in the product — and what it returns is
 * built from named parts, so the private object cannot leak through a
 * field somebody forgot to remove.
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

const GATEWAY_ID = "66666666-0000-4000-8000-000000000001";
const PUBLIC_ID = "gq_0123456789abcdefghjkmnpqrs";
const INVESTOR = "11111111-0000-4000-8000-000000000013";

const GATEWAY: Gateway = {
  id: GATEWAY_ID as Gateway["id"],
  tenantId: CONTEXT.tenantId,
  investorOrganisationId: INVESTOR,
  organisationId: CONTEXT.organisationId ?? "",
  publicId: PUBLIC_ID,
  name: "Seed programme",
  status: "ACTIVE",
  createdByUserId: CONTEXT.userId,
  createdAt: "2026-09-21T12:00:00.000Z",
  updatedAt: "2026-09-21T12:00:00.000Z",
};

const PUBLIC_PROJECTION: PublicGateway = {
  publicId: PUBLIC_ID,
  organisationDisplayName: "Acme Ventures",
  title: "Seed-stage African fintech",
  description: "We read every application.",
  inboundMode: "QUALIFIED",
  acceptingApplications: true,
  criteria: [
    { label: "Sector", requiredness: "REQUIRED", dimension: "TAXONOMY" },
  ],
  publishedAt: "2026-09-21T12:00:00.000Z",
};

const notUnderTest = () => Promise.reject(new Error("not under test"));

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly publicGateway?: PublicGateway | null;
  readonly created?: Gateway | Error;
}): {
  readonly app: FastifyInstance;
  readonly publicLookups: string[];
} {
  const publicLookups: string[] = [];
  const gateq: GateQService = {
    createGateway: () =>
      options.created instanceof Error
        ? Promise.reject(options.created)
        : Promise.resolve(options.created ?? GATEWAY),
    listGateways: () => Promise.resolve([GATEWAY]),
    getPolicy: notUnderTest,
    listVersions: () => Promise.resolve([]),
    createDraft: notUnderTest,
    replaceDraft: notUnderTest,
    publishVersion: notUnderTest,
    qualifyCompany: notUnderTest,
    publicGateway: (publicId) => {
      publicLookups.push(publicId);
      return Promise.resolve(options.publicGateway ?? null);
    },
  };
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(options.principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    gateq,
  });
  return { app, publicLookups };
}

describe("the configuration routes", () => {
  it("require an authenticated actor", async () => {
    const { app } = buildApp({ principal: null });
    const response = await app.inject({
      method: "GET",
      url: `${GATEQ_GATEWAYS_PATH}?investorOrganisationId=${INVESTOR}`,
    });
    expect(response.statusCode).toBe(401);
  });

  it("create a gateway and answer with its public handle, never its internals", async () => {
    const { app } = buildApp({ principal: PRINCIPAL });
    const response = await app.inject({
      method: "POST",
      url: GATEQ_GATEWAYS_PATH,
      payload: { investorOrganisationId: INVESTOR, name: "Seed programme" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual([
      "createdAt",
      "id",
      "name",
      "publicId",
      "status",
    ]);
    // The owning organisation and the creator are not part of the answer:
    // a caller already knows their own organisation, and telling them what
    // the server resolved hands them the vocabulary to forge it.
    const text = JSON.stringify(body);
    expect(text).not.toContain(INVESTOR);
    expect(text).not.toContain(CONTEXT.userId);
  });

  it("refuse a request whose body is not a gateway", async () => {
    const { app } = buildApp({ principal: PRINCIPAL });
    const response = await app.inject({
      method: "POST",
      url: GATEQ_GATEWAYS_PATH,
      payload: { investorOrganisationId: "not-a-uuid", name: "" },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe("the public route", () => {
  const url = (publicId: string) =>
    GATEQ_PUBLIC_GATEWAY_PATH.replace(":publicId", publicId);

  it("5: serves the published projection with no authentication at all", async () => {
    const { app, publicLookups } = buildApp({
      principal: null,
      publicGateway: PUBLIC_PROJECTION,
    });
    const response = await app.inject({ method: "GET", url: url(PUBLIC_ID) });
    expect(response.statusCode).toBe(200);
    expect(publicLookups).toEqual([PUBLIC_ID]);
    // Published information, so a CDN may absorb an embed's traffic --
    // which is the point of having an opaque id at all.
    expect(response.headers["cache-control"]).toBe("public, max-age=60");
    expect(
      Object.keys(response.json<Record<string, unknown>>()).sort(),
    ).toEqual(
      [
        "acceptingApplications",
        "criteria",
        "description",
        "inboundMode",
        "organisationDisplayName",
        "publicId",
        "publishedAt",
        "title",
      ].sort(),
    );
  });

  it("6 and 7: a draft, a disabled gateway and an unknown id are one answer", async () => {
    // The service returns null for all three, and the route cannot tell
    // them apart either: a public identifier must not become an oracle for
    // which organisations have configured a gateway.
    const { app } = buildApp({ principal: null, publicGateway: null });
    const response = await app.inject({ method: "GET", url: url(PUBLIC_ID) });
    expect(response.statusCode).toBe(404);
  });

  it("7: a malformed identifier is the same 404, and never reaches the service", async () => {
    const { app, publicLookups } = buildApp({
      principal: null,
      publicGateway: PUBLIC_PROJECTION,
    });
    const response = await app.inject({ method: "GET", url: url("gateway-1") });
    expect(response.statusCode).toBe(404);
    expect(publicLookups).toEqual([]);
  });

  it("10: an authenticated caller sees exactly the same public answer", async () => {
    // Privilege does not widen a public projection. Whoever asks, the
    // route returns the whitelist and nothing else.
    const anonymous = buildApp({
      principal: null,
      publicGateway: PUBLIC_PROJECTION,
    });
    const authenticated = buildApp({
      principal: PRINCIPAL,
      publicGateway: PUBLIC_PROJECTION,
    });
    const [a, b] = await Promise.all([
      anonymous.app.inject({ method: "GET", url: url(PUBLIC_ID) }),
      authenticated.app.inject({ method: "GET", url: url(PUBLIC_ID) }),
    ]);
    expect(a.json()).toEqual(b.json());
  });
});
