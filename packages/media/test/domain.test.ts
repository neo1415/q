import { describe, expect, it } from "vitest";

import {
  allowedTransitionsFrom,
  canTransition,
  isPitchPlayable,
  isReady,
  isTerminal,
  isUnusable,
  DERIVED_TEXT_STATES,
  MEDIA_PURPOSES,
  MEDIA_STATUSES,
  MODERATION_STATUSES,
  PLAYBACK_POLICIES,
  MediaAssetIdSchema,
  MediaTechnicalMetadataSchema,
  PlaybackAuthorizationRequestSchema,
  toCompanyPitch,
  toMediaAssetDto,
  CreateVideoUploadSessionSchema,
  type CompanyPitch,
  type MediaAsset,
  type MediaStatus,
} from "../src/index.js";
import { createMediaOwnerResolverRegistry } from "../src/domain/owners.js";

/**
 * The Media domain's rules, without a database.
 *
 * The lifecycle tests are the ones that matter most: they are what stops a
 * late provider event from unmaking a decision, and they exist before any
 * provider does precisely so the first adapter cannot introduce the bug.
 */

const asset = (overrides: Partial<MediaAsset> = {}): MediaAsset =>
  ({
    id: MediaAssetIdSchema.parse("11111111-1111-4111-8111-111111111111"),
    tenantId: "22222222-2222-4222-8222-222222222222",
    ownerType: "COMPANY",
    ownerId: "33333333-3333-4333-8333-333333333333",
    ownerOrganisationId: "44444444-4444-4444-8444-444444444444",
    purpose: "FOUNDER_PITCH",
    provider: "UNASSIGNED",
    providerAssetId: null,
    status: "CREATED",
    durationSeconds: null,
    width: null,
    height: null,
    aspectRatio: null,
    playbackPolicy: "PRIVATE",
    thumbnailReference: null,
    captionState: "NOT_REQUESTED",
    transcriptState: "NOT_REQUESTED",
    moderationStatus: "NOT_REVIEWED",
    replacesMediaAssetId: null,
    supersededAt: null,
    createdByUserId: "55555555-5555-4555-8555-555555555555",
    createdAt: "2026-09-06T09:00:00.000Z",
    readyAt: null,
    deletedAt: null,
    version: 1,
    ...overrides,
  }) as MediaAsset;

describe("media lifecycle", () => {
  it("walks the upload path", () => {
    const path: readonly MediaStatus[] = [
      "CREATED",
      "UPLOAD_PENDING",
      "UPLOADING",
      "PROCESSING",
      "READY",
    ];
    for (let at = 0; at < path.length - 1; at += 1) {
      const from = path[at];
      const to = path[at + 1];
      if (from === undefined || to === undefined) continue;
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it("never lets READY regress, however late the event", () => {
    // The webhook that arrives after the fact is the whole reason this rule
    // exists: an asset that is ready stays ready.
    expect(canTransition("READY", "PROCESSING")).toBe(false);
    expect(canTransition("READY", "UPLOADING")).toBe(false);
    expect(canTransition("READY", "UPLOAD_PENDING")).toBe(false);
    expect(allowedTransitionsFrom("READY")).toEqual(["DELETED"]);
  });

  it("never resurrects a deleted asset", () => {
    for (const status of MEDIA_STATUSES) {
      expect(canTransition("DELETED", status)).toBe(false);
    }
    expect(isTerminal("DELETED")).toBe(true);
  });

  it("lets a failure be deleted but not retried in place", () => {
    expect(canTransition("PROCESSING_FAILED", "DELETED")).toBe(true);
    expect(canTransition("PROCESSING_FAILED", "PROCESSING")).toBe(false);
    expect(canTransition("UPLOAD_FAILED", "UPLOADING")).toBe(false);
  });

  it("classifies readiness and unusability without judging the company", () => {
    expect(isReady("READY")).toBe(true);
    expect(isReady("PROCESSING")).toBe(false);
    expect(isUnusable("EXPIRED")).toBe(true);
    expect(isUnusable("PROCESSING")).toBe(false);
  });
});

describe("pitch playability", () => {
  const pitch = (overrides: Partial<CompanyPitch> = {}): CompanyPitch => ({
    ...toCompanyPitch(
      asset({ status: "READY", readyAt: "2026-09-06T09:01:00.000Z" }),
    ),
    ...overrides,
  });

  it("needs readiness, review and a policy that permits playback", () => {
    expect(
      isPitchPlayable(
        pitch({ moderationStatus: "ALLOWED", playbackPolicy: "AUTHORISED" }),
      ),
    ).toBe(true);
  });

  it("refuses a ready video that review has not allowed", () => {
    // Encoding succeeded. That is not permission to show it to anyone.
    expect(
      pitch({ moderationStatus: "NOT_REVIEWED", playbackPolicy: "AUTHORISED" }),
    ).toMatchObject({ status: "READY" });
    expect(
      isPitchPlayable(
        pitch({
          moderationStatus: "NOT_REVIEWED",
          playbackPolicy: "AUTHORISED",
        }),
      ),
    ).toBe(false);
    expect(
      isPitchPlayable(
        pitch({ moderationStatus: "BLOCKED", playbackPolicy: "AUTHORISED" }),
      ),
    ).toBe(false);
  });

  it("refuses an allowed video that is still private", () => {
    expect(
      isPitchPlayable(
        pitch({ moderationStatus: "ALLOWED", playbackPolicy: "PRIVATE" }),
      ),
    ).toBe(false);
  });

  it("refuses an approved video that is not ready", () => {
    expect(
      isPitchPlayable(
        pitch({
          status: "PROCESSING",
          moderationStatus: "ALLOWED",
          playbackPolicy: "AUTHORISED",
        }),
      ),
    ).toBe(false);
  });
});

describe("the client-facing DTO", () => {
  it("carries no provider identifier, storage reference or dimensions", () => {
    const dto = toMediaAssetDto(
      asset({
        provider: "CLOUDFLARE_STREAM",
        providerAssetId: "PRIVATE-MEDIA-METADATA-DO-NOT-EMIT",
        thumbnailReference: "PRIVATE-MEDIA-METADATA-DO-NOT-EMIT",
        width: 1080,
        height: 1920,
      }),
    );
    const serialised = JSON.stringify(dto);
    expect(serialised).not.toContain("PRIVATE-MEDIA-METADATA-DO-NOT-EMIT");
    expect(serialised).not.toContain("CLOUDFLARE");
    expect(Object.keys(dto).sort()).toEqual([
      "aspectRatio",
      "captionState",
      "createdAt",
      "durationSeconds",
      "mediaAssetId",
      "moderationStatus",
      "playbackPolicy",
      "purpose",
      "readyAt",
      "replacesMediaAssetId",
      "status",
      "transcriptState",
      "version",
    ]);
  });

  it("gives later consumers the pitch without the company's business", () => {
    const projection = toCompanyPitch(asset());
    expect(Object.keys(projection)).not.toContain("providerAssetId");
    expect(Object.keys(projection)).not.toContain("thumbnailReference");
  });
});

describe("owner resolution", () => {
  it("resolves nothing for a type this build does not know", async () => {
    const registry = createMediaOwnerResolverRegistry([]);
    const resolved = await registry.resolve(
      {
        actorType: "HUMAN",
        userId: "55555555-5555-4555-8555-555555555555",
        tenantId: "22222222-2222-4222-8222-222222222222",
      } as never,
      { ownerType: "COMPANY", ownerId: "33333333-3333-4333-8333-333333333333" },
    );
    expect(resolved).toBeNull();
  });

  it("refuses two resolvers for one owner type", () => {
    const resolver = {
      ownerType: "COMPANY" as const,
      resolve: () => Promise.resolve(null),
    };
    expect(() =>
      createMediaOwnerResolverRegistry([resolver, resolver]),
    ).toThrowError(TypeError);
  });
});

describe("provider contracts", () => {
  it("keep every vendor name out of the boundary", () => {
    const source = JSON.stringify([
      MEDIA_PURPOSES,
      MEDIA_STATUSES,
      Object.keys(CreateVideoUploadSessionSchema.shape),
      Object.keys(PlaybackAuthorizationRequestSchema.shape),
    ]);
    for (const vendor of ["cloudflare", "readyToStream", "uid", "stream"]) {
      expect(source.toLowerCase()).not.toContain(vendor.toLowerCase());
    }
  });

  it("bound what a provider may report back", () => {
    expect(
      MediaTechnicalMetadataSchema.safeParse({ durationSeconds: 90 }).success,
    ).toBe(true);
    expect(
      MediaTechnicalMetadataSchema.safeParse({ durationSeconds: 0 }).success,
    ).toBe(false);
    // A strict schema: a provider cannot smuggle extra fields into the row.
    expect(
      MediaTechnicalMetadataSchema.safeParse({ playbackToken: "secret" })
        .success,
    ).toBe(false);
  });

  it("require the server to choose upload constraints", () => {
    const parsed = CreateVideoUploadSessionSchema.safeParse({
      mediaAssetId: "11111111-1111-4111-8111-111111111111",
      purpose: "FOUNDER_PITCH",
      maxDurationSeconds: 180,
      requireSignedPlayback: true,
    });
    expect(parsed.success).toBe(true);
    expect(
      CreateVideoUploadSessionSchema.safeParse({
        mediaAssetId: "11111111-1111-4111-8111-111111111111",
        purpose: "FOUNDER_PITCH",
        maxDurationSeconds: 180,
      }).success,
    ).toBe(false);
  });
});

describe("the boundary copy of the vocabulary", () => {
  it("matches the domain exactly", async () => {
    // Two copies exist because the contracts package must not depend on a
    // domain package. A test keeps them identical so a client and the
    // server can never disagree about what a status means.
    const wire: Record<string, readonly string[]> =
      await import("@capital-q/contracts").then(
        (module) => module as unknown as Record<string, readonly string[]>,
      );
    expect(wire["MEDIA_PURPOSES"]).toEqual(MEDIA_PURPOSES);
    expect(wire["MEDIA_STATUSES"]).toEqual(MEDIA_STATUSES);
    expect(wire["PLAYBACK_POLICIES"]).toEqual(PLAYBACK_POLICIES);
    expect(wire["MODERATION_STATUSES"]).toEqual(MODERATION_STATUSES);
    expect(wire["DERIVED_TEXT_STATES"]).toEqual(DERIVED_TEXT_STATES);
  });
});
