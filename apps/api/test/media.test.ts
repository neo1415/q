import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  MediaAssetNotFoundError,
  MediaOwnerNotFoundError,
  MediaReplacementConflictError,
  type MediaAsset,
  type MediaService,
} from "@capital-q/media";
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
 * `/v1/companies/:companyId/pitch` at the HTTP boundary. The service is a
 * recording double: what a pitch may become is proven against the database
 * in the Media package, and what is proven here is that authority never
 * arrives from the request and that no response leaks provider identity.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const MEMBERSHIP = MembershipIdSchema.parse(
  "e0000000-0000-4000-8000-000000000001",
);
const CONTEXT: ActorContext = {
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: MEMBERSHIP,
  actorType: "HUMAN",
};

const COMPANY = "aa000000-0000-4000-8000-000000000001";
const ASSET_ID = "f0000000-0000-4000-8000-000000000001";
const NOW = "2026-09-06T09:00:00.000Z";
const PROVIDER_SECRET = "PRIVATE-MEDIA-METADATA-DO-NOT-EMIT";

const ASSET = {
  id: ASSET_ID,
  tenantId: TENANT,
  ownerType: "COMPANY",
  ownerId: COMPANY,
  ownerOrganisationId: ORG,
  purpose: "FOUNDER_PITCH",
  // Set to something recognisable so the response can be checked for it.
  provider: "CLOUDFLARE_STREAM",
  providerAssetId: PROVIDER_SECRET,
  status: "CREATED",
  durationSeconds: null,
  width: 1080,
  height: 1920,
  aspectRatio: null,
  playbackPolicy: "PRIVATE",
  thumbnailReference: PROVIDER_SECRET,
  captionState: "NOT_REQUESTED",
  transcriptState: "NOT_REQUESTED",
  moderationStatus: "NOT_REVIEWED",
  replacesMediaAssetId: null,
  supersededAt: null,
  createdByUserId: USER,
  createdAt: NOW,
  readyAt: null,
  deletedAt: null,
  version: 1,
} as unknown as MediaAsset;

const notUnderTest = () => Promise.reject(new Error("not under test"));

function fakeService(overrides: Partial<MediaService> = {}) {
  const calls: Record<string, unknown[]> = {
    create: [],
    get: [],
    delete: [],
  };
  const service = {
    createCompanyPitch: (command: unknown) => {
      calls["create"]?.push(command);
      return Promise.resolve({ asset: ASSET, replaced: null });
    },
    getCompanyPitch: (query: unknown) => {
      calls["get"]?.push(query);
      return Promise.resolve(ASSET);
    },
    listCompanyMedia: () => Promise.resolve([ASSET]),
    deleteCompanyPitch: (command: unknown) => {
      calls["delete"]?.push(command);
      return Promise.resolve({ ...ASSET, status: "DELETED", deletedAt: NOW });
    },
    getCurrentPitchProjection: notUnderTest,
    transitionMediaStatus: notUnderTest,
    attachProviderAsset: notUnderTest,
    recordProviderMetadata: notUnderTest,
    setMediaStates: notUnderTest,
    ...overrides,
  } as unknown as MediaService;
  return { service, calls };
}

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly context?: ActorContext | undefined;
  readonly service: MediaService;
}): FastifyInstance {
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(options.principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve(
          options.context === undefined
            ? { status: "CONTEXT_REQUIRED" }
            : { status: "RESOLVED", context: options.context },
        ),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  return createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    media: options.service,
  }).app;
}

const pitchUrl = `/v1/companies/${COMPANY}/pitch`;

describe("POST /v1/companies/:companyId/pitch", () => {
  it("refuses an unauthenticated caller", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: null, service });
    const response = await app.inject({
      method: "POST",
      url: pitchUrl,
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(calls["create"]).toHaveLength(0);
    await app.close();
  });

  it("creates a record and says so, without claiming an upload happened", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: pitchUrl,
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{
      pitch: { status: string; playbackPolicy: string };
      guidance: { hardMaxSeconds: number };
    }>();
    expect(body.pitch.status).toBe("CREATED");
    expect(body.pitch.playbackPolicy).toBe("PRIVATE");
    expect(body.guidance.hardMaxSeconds).toBeGreaterThan(0);
    expect(calls["create"]).toHaveLength(1);
    await app.close();
  });

  it.each([
    ["status", { status: "READY" }],
    [
      "provider identity",
      { providerAssetId: "uid-1", provider: "CLOUDFLARE_STREAM" },
    ],
    ["moderation", { moderationStatus: "ALLOWED" }],
    ["playback policy", { playbackPolicy: "PUBLIC" }],
    ["tenancy", { tenantId: "c0000000-0000-4000-8000-000000000009" }],
    ["ownership", { ownerId: "aa000000-0000-4000-8000-000000000009" }],
  ])("refuses a request that tries to choose %s", async (_label, extra) => {
    // Strict schemas: an authority field fails validation rather than being
    // quietly ignored, so a client can never believe it set one.
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: pitchUrl,
      payload: extra,
    });
    expect(response.statusCode).toBe(422);
    expect(calls["create"]).toHaveLength(0);
    await app.close();
  });

  it("reports a stale replacement as a conflict, not a second pitch", async () => {
    const { service } = fakeService({
      createCompanyPitch: () =>
        Promise.reject(new MediaReplacementConflictError()),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: pitchUrl,
      payload: { replacesMediaAssetId: ASSET_ID },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it("answers a company in another tenant the same way as a missing one", async () => {
    const { service } = fakeService({
      createCompanyPitch: () => Promise.reject(new MediaOwnerNotFoundError()),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: pitchUrl,
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /v1/companies/:companyId/pitch", () => {
  it("never returns provider identity or storage references", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({ method: "GET", url: pitchUrl });

    expect(response.statusCode).toBe(200);
    expect(response.payload).not.toContain(PROVIDER_SECRET);
    expect(response.payload).not.toContain("CLOUDFLARE");
    // Dimensions are provider bookkeeping and are not part of the DTO.
    expect(response.payload).not.toContain("width");
    expect(response.headers["cache-control"]).toBe("no-store");
    await app.close();
  });

  it("refuses a company identifier that is not one", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "GET",
      url: "/v1/companies/not-a-uuid/pitch",
    });
    expect(response.statusCode).toBe(422);
    expect(calls["get"]).toHaveLength(0);
    await app.close();
  });
});

describe("DELETE /v1/companies/:companyId/pitch/:mediaAssetId", () => {
  it("removes the pitch from the product and reports the deleted record", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "DELETE",
      url: `${pitchUrl}/${ASSET_ID}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ pitch: { status: string } }>().pitch.status).toBe(
      "DELETED",
    );
    expect(calls["delete"]).toHaveLength(1);
    await app.close();
  });

  it("answers another company's asset as not found", async () => {
    const { service } = fakeService({
      deleteCompanyPitch: () => Promise.reject(new MediaAssetNotFoundError()),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "DELETE",
      url: `${pitchUrl}/${ASSET_ID}`,
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
