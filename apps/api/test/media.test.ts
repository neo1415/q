import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  MediaAssetConflictError,
  MediaAssetNotFoundError,
  MediaIdempotencyConflictError,
  MediaOwnerNotFoundError,
  MediaProviderError,
  MediaProviderNotConfiguredError,
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
      return Promise.resolve({ asset: ASSET, replaced: null, replayed: false });
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
      headers: { "idempotency-key": "replace-key-0001" },
      payload: { replacesMediaAssetId: ASSET_ID },
    });
    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it("refuses a replacement that carries no Idempotency-Key", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: pitchUrl,
      payload: { replacesMediaAssetId: ASSET_ID },
    });
    expect(response.statusCode).toBe(422);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(calls["create"]).toHaveLength(0);
    await app.close();
  });

  it("passes the key through and answers a replayed replacement with 200", async () => {
    const { service, calls } = fakeService({
      createCompanyPitch: (command) => {
        calls["create"]?.push(command);
        return Promise.resolve({ asset: ASSET, replaced: null, replayed: true });
      },
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: pitchUrl,
      headers: { "idempotency-key": "replace-key-0002" },
      payload: { replacesMediaAssetId: ASSET_ID },
    });
    expect(response.statusCode).toBe(200);
    expect(calls["create"]).toEqual([
      expect.objectContaining({ idempotencyKey: "replace-key-0002" }),
    ]);
    await app.close();
  });

  it("reports a key reused for a different request as an idempotency conflict", async () => {
    const { service } = fakeService({
      createCompanyPitch: () =>
        Promise.reject(new MediaIdempotencyConflictError()),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: pitchUrl,
      headers: { "idempotency-key": "replace-key-0003" },
      payload: { replacesMediaAssetId: ASSET_ID },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe("IDEMPOTENCY_CONFLICT");
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

  // CQ-MEDIA-010: a missing provider is said plainly, with the variable
  // names and nothing else; a provider that answered badly is a closed door
  // with no vendor detail on it. Neither becomes a 500 and neither leaks.
  it("names the missing provider configuration, and hides provider failures", async () => {
    const { service: unconfigured } = fakeService({
      getCompanyPitch: () =>
        Promise.reject(
          new MediaProviderNotConfiguredError("playback", [
            "CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN",
          ]),
        ),
    });
    const app = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: unconfigured,
    });
    const response = await app.inject({ method: "GET", url: pitchUrl });
    expect(response.statusCode).toBe(503);
    const problem = response.json<{ code: string; detail?: string }>();
    expect(problem.code).toBe("PROVIDER_UNAVAILABLE");
    expect(problem.detail).toBe(
      "MEDIA_PROVIDER_NOT_CONFIGURED: No video provider is configured for playback: set CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN.",
    );
    await app.close();

    const { service: failing } = fakeService({
      getCompanyPitch: () =>
        Promise.reject(
          new MediaProviderError({
            provider: "CLOUDFLARE_STREAM",
            failure: "AUTHENTICATION",
            operation: "asset status",
            status: 401,
            providerCode: "10000",
          }),
        ),
    });
    const failingApp = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: failing,
    });
    const failed = await failingApp.inject({ method: "GET", url: pitchUrl });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(failed.payload).not.toContain("CLOUDFLARE");
    expect(failed.payload).not.toContain("401");
    expect(failed.payload).not.toContain("10000");
    await failingApp.close();

    // Every other error still reaches the application's own handler.
    const { service: absent } = fakeService({
      getCompanyPitch: () => Promise.reject(new MediaAssetNotFoundError()),
    });
    const absentApp = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: absent,
    });
    const notFound = await absentApp.inject({ method: "GET", url: pitchUrl });
    expect(notFound.statusCode).toBe(404);
    await absentApp.close();
  });
});

// The direct upload flow (CQ-MEDIA-011). The service is a double, so what
// is proven here is the HTTP boundary: the DTOs carry exactly the contract
// fields, the version the client saw reaches the service and nothing else
// does, the provider's identifier never appears in any answer, and an
// unconfigured provider is said plainly.
describe("POST /v1/companies/:companyId/pitch/:mediaAssetId/{upload-session,sync,playback}", () => {
  const assetUrl = `${pitchUrl}/${ASSET_ID}`;
  const UPLOAD_URL = "https://upload.provider.example/one-time-target";

  it("reserves an upload with the version the client saw and returns the contract DTO", async () => {
    const commands: unknown[] = [];
    const { service } = fakeService({
      createUploadSession: (command: unknown) => {
        commands.push(command);
        return Promise.resolve({
          asset: {
            ...ASSET,
            status: "UPLOAD_PENDING",
            provider: "CLOUDFLARE_STREAM",
            version: 3,
          },
          session: {
            providerAssetId: PROVIDER_SECRET,
            uploadMode: "DIRECT",
            uploadUrl: UPLOAD_URL,
            expiresAt: "2026-09-06T09:30:00.000Z",
          },
          maxDurationSeconds: 180,
          replayed: false,
        });
      },
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: `${assetUrl}/upload-session`,
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<{
      mediaAssetId: string;
      uploadMode: string;
      uploadUrl: string;
      expiresAt: string;
      maxDurationSeconds: number;
      pitch: { status: string; version: number };
    }>();
    expect(body).toMatchObject({
      mediaAssetId: ASSET_ID,
      uploadMode: "DIRECT",
      uploadUrl: UPLOAD_URL,
      expiresAt: "2026-09-06T09:30:00.000Z",
      maxDurationSeconds: 180,
      pitch: { status: "UPLOAD_PENDING", version: 3 },
    });
    expect(response.payload).not.toContain(PROVIDER_SECRET);
    expect(commands[0]).toMatchObject({
      companyId: COMPANY,
      mediaAssetId: ASSET_ID,
      expectedVersion: 1,
    });
    // Nothing else the body could carry reaches the service.
    expect(Object.keys(commands[0] as object).sort()).toEqual([
      "actor",
      "companyId",
      "correlationId",
      "expectedVersion",
      "mediaAssetId",
    ]);
    await app.close();
  });

  it("refuses an upload request that names anything but the version", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    for (const payload of [
      {},
      { expectedVersion: 1, maxDurationSeconds: 3600 },
      { expectedVersion: 1, requireSignedPlayback: false },
      { expectedVersion: "1" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: `${assetUrl}/upload-session`,
        payload,
      });
      expect(response.statusCode).toBe(422);
    }
    await app.close();
  });

  it("syncs idempotently and answers with the asset as it now is", async () => {
    let syncs = 0;
    const { service } = fakeService({
      syncMediaAsset: () => {
        syncs += 1;
        return Promise.resolve({ ...ASSET, status: "PROCESSING", version: 4 });
      },
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    for (const attempt of [1, 2]) {
      const response = await app.inject({
        method: "POST",
        url: `${assetUrl}/sync`,
        payload: {},
      });
      expect(response.statusCode, `attempt ${String(attempt)}`).toBe(200);
      expect(response.json<{ pitch: { status: string } }>().pitch.status).toBe(
        "PROCESSING",
      );
      expect(response.payload).not.toContain(PROVIDER_SECRET);
    }
    expect(syncs).toBe(2);
    await app.close();
  });

  it("mints a playback authorization with no provider identifier and no token field", async () => {
    const { service } = fakeService({
      authorisePlayback: () =>
        Promise.resolve({
          asset: { ...ASSET, status: "READY" },
          authorization: {
            mediaAssetId: ASSET.id,
            token: "SIGNED-TOKEN-VALUE",
            playbackUrl:
              "https://edge.provider.example/SIGNED-TOKEN-VALUE/manifest/video.m3u8",
            posterUrl:
              "https://edge.provider.example/SIGNED-TOKEN-VALUE/thumbnails/thumbnail.jpg",
            expiresAt: "2026-09-06T09:15:00.000Z",
          },
        }),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: `${assetUrl}/playback`,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      mediaAssetId: ASSET_ID,
      playbackUrl:
        "https://edge.provider.example/SIGNED-TOKEN-VALUE/manifest/video.m3u8",
      posterUrl:
        "https://edge.provider.example/SIGNED-TOKEN-VALUE/thumbnails/thumbnail.jpg",
      expiresAt: "2026-09-06T09:15:00.000Z",
    });
    expect(response.payload).not.toContain(PROVIDER_SECRET);
    expect(response.payload).not.toContain('"token"');
    await app.close();
  });

  it("answers a refused viewer and an unconfigured provider each in its own honest way", async () => {
    const { service: refused } = fakeService({
      authorisePlayback: () => Promise.reject(new MediaAssetNotFoundError()),
    });
    const refusedApp = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: refused,
    });
    const notFound = await refusedApp.inject({
      method: "POST",
      url: `${assetUrl}/playback`,
      payload: {},
    });
    expect(notFound.statusCode).toBe(404);
    await refusedApp.close();

    const { service: unconfigured } = fakeService({
      createUploadSession: () =>
        Promise.reject(
          new MediaProviderNotConfiguredError("upload", [
            "CLOUDFLARE_ACCOUNT_ID",
            "CLOUDFLARE_STREAM_API_TOKEN",
          ]),
        ),
    });
    const unconfiguredApp = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: unconfigured,
    });
    const closed = await unconfiguredApp.inject({
      method: "POST",
      url: `${assetUrl}/upload-session`,
      payload: { expectedVersion: 1 },
    });
    expect(closed.statusCode).toBe(503);
    expect(closed.json<{ code: string; detail?: string }>()).toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      detail:
        "MEDIA_PROVIDER_NOT_CONFIGURED: No video provider is configured for upload: set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_STREAM_API_TOKEN.",
    });
    await unconfiguredApp.close();
  });

  it("refuses all three without a session", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: null, service });
    for (const suffix of ["upload-session", "sync", "playback"]) {
      const response = await app.inject({
        method: "POST",
        url: `${assetUrl}/${suffix}`,
        payload: suffix === "upload-session" ? { expectedVersion: 1 } : {},
      });
      expect(response.statusCode, suffix).toBe(401);
    }
    await app.close();
  });
});

// Resumable upload and cancel (CQ-MEDIA-011). The service is a double;
// what is proven is the boundary: a length needs an Idempotency-Key, the
// key and length are the only additions that reach the service, a replay
// is 200 rather than 201, and cancel answers with the pitch DTO only.
describe("resumable upload-session and upload-session/cancel", () => {
  const assetUrl = `${pitchUrl}/${ASSET_ID}`;
  const TUS_URL = "https://upload.provider.example/tus/resource";
  const KEY = "pitch-upload-key-0001";

  const resumableService = (replayed: boolean) => {
    const commands: unknown[] = [];
    const { service } = fakeService({
      createUploadSession: (command: unknown) => {
        commands.push(command);
        return Promise.resolve({
          asset: { ...ASSET, status: "UPLOAD_PENDING", version: 3 },
          session: {
            providerAssetId: PROVIDER_SECRET,
            uploadMode: "RESUMABLE",
            uploadUrl: TUS_URL,
            expiresAt: "2026-09-06T11:00:00.000Z",
            chunkSizeBytes: 5_242_880,
          },
          maxDurationSeconds: 180,
          replayed,
        });
      },
    });
    return { service, commands };
  };

  it("passes the length and the key to the service and answers with the chunk size", async () => {
    const { service, commands } = resumableService(false);
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: `${assetUrl}/upload-session`,
      headers: { "idempotency-key": KEY },
      payload: { expectedVersion: 1, uploadLengthBytes: 6_291_456 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      uploadMode: "RESUMABLE",
      uploadUrl: TUS_URL,
      chunkSizeBytes: 5_242_880,
      pitch: { status: "UPLOAD_PENDING" },
    });
    expect(response.payload).not.toContain(PROVIDER_SECRET);
    expect(commands[0]).toMatchObject({
      expectedVersion: 1,
      uploadLengthBytes: 6_291_456,
      idempotencyKey: KEY,
    });
    await app.close();
  });

  it("answers a replayed reservation with 200, not a second creation", async () => {
    const { service } = resumableService(true);
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: `${assetUrl}/upload-session`,
      headers: { "idempotency-key": KEY },
      payload: { expectedVersion: 1, uploadLengthBytes: 6_291_456 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ uploadUrl: string }>().uploadUrl).toBe(TUS_URL);
    await app.close();
  });

  it("requires an Idempotency-Key with a length, and refuses a length that is not one", async () => {
    const { service, commands } = resumableService(false);
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const cases = [
      { headers: {}, payload: { expectedVersion: 1, uploadLengthBytes: 10 } },
      {
        headers: { "idempotency-key": "short" },
        payload: { expectedVersion: 1, uploadLengthBytes: 10 },
      },
      {
        headers: { "idempotency-key": KEY },
        payload: { expectedVersion: 1, uploadLengthBytes: 0 },
      },
      {
        headers: { "idempotency-key": KEY },
        payload: { expectedVersion: 1, uploadLengthBytes: 1.5 },
      },
    ];
    for (const { headers, payload } of cases) {
      const response = await app.inject({
        method: "POST",
        url: `${assetUrl}/upload-session`,
        headers,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
    }
    expect(commands).toHaveLength(0);
    await app.close();
  });

  it("cancels through the service and answers with the pitch as it now is", async () => {
    const commands: unknown[] = [];
    const { service } = fakeService({
      cancelUpload: (command: unknown) => {
        commands.push(command);
        return Promise.resolve({
          asset: { ...ASSET, status: "UPLOAD_FAILED", version: 4 },
          providerReleased: true,
        });
      },
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: `${assetUrl}/upload-session/cancel`,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(
      response.json<{ pitch: { status: string; version: number } }>().pitch,
    ).toMatchObject({ status: "UPLOAD_FAILED", version: 4 });
    expect(response.payload).not.toContain(PROVIDER_SECRET);
    expect(Object.keys(commands[0] as object).sort()).toEqual([
      "actor",
      "companyId",
      "correlationId",
      "mediaAssetId",
    ]);
    await app.close();
  });

  it("refuses a cancel body that tries to say anything, and a caller with no session", async () => {
    const { service } = fakeService({
      cancelUpload: () => Promise.reject(new Error("must not be reached")),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const loud = await app.inject({
      method: "POST",
      url: `${assetUrl}/upload-session/cancel`,
      payload: { status: "DELETED" },
    });
    expect(loud.statusCode).toBe(422);
    await app.close();

    const anonymous = buildApp({ principal: null, service });
    const refused = await anonymous.inject({
      method: "POST",
      url: `${assetUrl}/upload-session/cancel`,
      payload: {},
    });
    expect(refused.statusCode).toBe(401);
    await anonymous.close();
  });

  it("is not found for a stranger's asset", async () => {
    const { service } = fakeService({
      cancelUpload: () => Promise.reject(new MediaOwnerNotFoundError()),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: `${assetUrl}/upload-session/cancel`,
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

// The founder's decision (CQ-MEDIA-013). The service is a double; what is
// proven is the boundary: exactly the two contract fields reach the
// service, a stale version is 409, a stranger's company is 404, and the
// answer is the pitch DTO with no provider material.
describe("POST /v1/companies/:companyId/pitch/:mediaAssetId/playback-policy", () => {
  const url = `${pitchUrl}/${ASSET_ID}/playback-policy`;

  it("records the owner's decision against the version they saw", async () => {
    const commands: unknown[] = [];
    const { service } = fakeService({
      setPitchPlaybackPolicy: (command: unknown) => {
        commands.push(command);
        return Promise.resolve({
          ...ASSET,
          status: "READY",
          playbackPolicy: "AUTHORISED",
          version: 4,
        });
      },
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url,
      payload: { playbackPolicy: "AUTHORISED", expectedVersion: 3 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(
      response.json<{ pitch: { playbackPolicy: string; version: number } }>()
        .pitch,
    ).toMatchObject({ playbackPolicy: "AUTHORISED", version: 4 });
    expect(response.payload).not.toContain(PROVIDER_SECRET);
    expect(commands[0]).toMatchObject({
      companyId: COMPANY,
      mediaAssetId: ASSET_ID,
      playbackPolicy: "AUTHORISED",
      expectedVersion: 3,
    });
    expect(Object.keys(commands[0] as object).sort()).toEqual([
      "actor",
      "companyId",
      "correlationId",
      "expectedVersion",
      "mediaAssetId",
      "playbackPolicy",
    ]);
    await app.close();
  });

  it("refuses PUBLIC, a moderation field, and a missing version", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    for (const payload of [
      { playbackPolicy: "PUBLIC", expectedVersion: 3 },
      {
        playbackPolicy: "AUTHORISED",
        expectedVersion: 3,
        moderationStatus: "ALLOWED",
      },
      { playbackPolicy: "AUTHORISED" },
      {},
    ]) {
      const response = await app.inject({ method: "POST", url, payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
    }
    await app.close();
  });

  it("answers 409 for a stale version and 404 for a company that is not the caller's", async () => {
    const { service: stale } = fakeService({
      setPitchPlaybackPolicy: () =>
        Promise.reject(new MediaAssetConflictError()),
    });
    const staleApp = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: stale,
    });
    const conflict = await staleApp.inject({
      method: "POST",
      url,
      payload: { playbackPolicy: "AUTHORISED", expectedVersion: 1 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ code: string }>().code).toBe("VERSION_CONFLICT");
    await staleApp.close();

    const { service: foreign } = fakeService({
      setPitchPlaybackPolicy: () =>
        Promise.reject(new MediaOwnerNotFoundError()),
    });
    const foreignApp = buildApp({
      principal: PRINCIPAL,
      context: CONTEXT,
      service: foreign,
    });
    const notFound = await foreignApp.inject({
      method: "POST",
      url,
      payload: { playbackPolicy: "AUTHORISED", expectedVersion: 1 },
    });
    expect(notFound.statusCode).toBe(404);
    await foreignApp.close();
  });

  it("refuses without a session", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: null, service });
    const response = await app.inject({
      method: "POST",
      url,
      payload: { playbackPolicy: "AUTHORISED", expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(401);
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
