import { describe, expect, it } from "vitest";

import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { CorrelationId } from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import {
  AuthorizationDeniedError,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  createMediaService,
  createUnconfiguredVideoProvider,
  MediaAssetConflictError,
  MediaAssetIdSchema,
  MediaAssetNotFoundError,
  MediaOwnerNotFoundError,
  MAX_PITCH_UPLOAD_BYTES,
  MediaProviderNotConfiguredError,
  MediaRuleError,
  transitionPath,
  uploadReservationKey,
  type MediaAsset,
  type MediaAssetRepository,
  type MediaOwnerResolverRegistry,
  type MediaStatus,
  type VideoAssetStatus,
  type VideoProvider,
  type VideoUploadSession,
} from "../src/index.js";

/**
 * The direct upload flow (CQ-MEDIA-011) against an in-memory repository
 * and a scripted provider.
 *
 * What is proven: the server's terms reach the provider and the browser's
 * never do; the provider's identifier is stored and never returned; sync
 * walks the lifecycle one legal step at a time and refuses every step the
 * lifecycle forbids; and playback is decided by facts — owner, or
 * discoverable-and-publishable — never by anything the caller claims.
 */

const TENANT_A = TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000a");
const TENANT_B = TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000b");
const ORG_A = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-00000000000a",
);
const ORG_B = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-00000000000b",
);
const FOUNDER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const INVESTOR = UserIdSchema.parse("b0000000-0000-4000-8000-000000000002");
const COMPANY = "aa000000-0000-4000-8000-000000000001";
const ASSET_ID = MediaAssetIdSchema.parse(
  "f0000000-0000-4000-8000-000000000001",
);
const UID = "cfuid00000000000000000000000000ff";
const CORRELATION = "corr-0000000000000001" as CorrelationId;
const TUS_SESSION: VideoUploadSession = {
  providerAssetId: UID,
  uploadMode: "RESUMABLE",
  uploadUrl: `https://upload.provider.example/tus/${UID}`,
  expiresAt: "2026-09-23T11:00:00.000Z",
  chunkSizeBytes: 5 * 1024 * 1024,
};

const founder: ActorContext = {
  userId: FOUNDER,
  tenantId: TENANT_A,
  organisationId: ORG_A,
  membershipId:
    "e0000000-0000-4000-8000-000000000001" as ActorContext["membershipId"],
  actorType: "HUMAN",
};
const investor: ActorContext = {
  userId: INVESTOR,
  tenantId: TENANT_B,
  organisationId: ORG_B,
  membershipId:
    "e0000000-0000-4000-8000-000000000002" as ActorContext["membershipId"],
  actorType: "HUMAN",
};

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: ASSET_ID,
    tenantId: TENANT_A,
    ownerType: "COMPANY",
    ownerId: COMPANY,
    ownerOrganisationId: ORG_A,
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
    title: null,
    audience: "INVESTORS",
    replacesMediaAssetId: null,
    supersededAt: null,
    createdByUserId: FOUNDER,
    createdAt: "2026-09-23T09:00:00.000Z",
    readyAt: null,
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

/** One row, versioned like the real thing: a stale expectedVersion updates nothing. */
function memoryRepository(initial: MediaAsset) {
  let row: MediaAsset | null = initial;
  const bump = (patch: Partial<MediaAsset>, expectedVersion: number) => {
    if (row === null || row.version !== expectedVersion) return null;
    row = { ...row, ...patch, version: row.version + 1 };
    return row;
  };
  const find = (tenantId: string, id: string) =>
    Promise.resolve(
      row !== null && row.tenantId === tenantId && row.id === id ? row : null,
    );
  const mediaAssets: MediaAssetRepository = {
    insert: () => Promise.reject(new Error("not under test")),
    findById: (_executor, tenantId, id) => find(tenantId, id),
    findByProviderAssetId: (_executor, provider, providerAssetId) =>
      Promise.resolve(
        row !== null &&
          row.provider === provider &&
          row.providerAssetId === providerAssetId
          ? row
          : null,
      ),
    lockById: (_tx, tenantId, id) => find(tenantId, id),
    findCurrentForOwner: () => Promise.resolve(row),
    countLiveForOwner: () => Promise.resolve(1),
    setDetails: () => Promise.resolve(row),
    listForOwner: () => Promise.resolve(row === null ? [] : [row]),
    transitionStatus: (_tx, input) =>
      Promise.resolve(
        bump(
          {
            status: input.status,
            ...(input.readyAt === undefined ? {} : { readyAt: input.readyAt }),
            ...(input.deletedAt === undefined
              ? {}
              : { deletedAt: input.deletedAt }),
          },
          input.expectedVersion,
        ),
      ),
    setProviderReference: (_tx, input) =>
      Promise.resolve(
        bump(
          { provider: input.provider, providerAssetId: input.providerAssetId },
          input.expectedVersion,
        ),
      ),
    updateProviderMetadata: (_tx, input) =>
      Promise.resolve(
        bump(
          {
            ...(input.metadata.durationSeconds === undefined
              ? {}
              : { durationSeconds: input.metadata.durationSeconds }),
            ...(input.metadata.width === undefined
              ? {}
              : { width: input.metadata.width }),
            ...(input.metadata.height === undefined
              ? {}
              : { height: input.metadata.height }),
            ...(input.metadata.aspectRatio === undefined
              ? {}
              : { aspectRatio: input.metadata.aspectRatio }),
            ...(input.metadata.thumbnailReference === undefined
              ? {}
              : { thumbnailReference: input.metadata.thumbnailReference }),
          },
          input.expectedVersion,
        ),
      ),
    markSuperseded: () => Promise.reject(new Error("not under test")),
    setStates: () => Promise.reject(new Error("not under test")),
  };
  return { mediaAssets, current: () => row };
}

function scriptedProvider(script: {
  readonly status?: VideoAssetStatus | (() => VideoAssetStatus) | undefined;
  readonly resumable?: boolean | undefined;
  /** What resumeUploadSession answers; null means "not that request". */
  readonly reopen?: VideoUploadSession | null | undefined;
  readonly deleteFails?: boolean | undefined;
}) {
  const calls: { readonly method: string; readonly input: unknown }[] = [];
  const provider: VideoProvider = {
    id: "SCRIPTED",
    capabilities: {
      directUpload: true,
      resumableUpload: script.resumable ?? false,
      signedPlayback: true,
      captions: false,
    },
    createUploadSession: (input) => {
      calls.push({ method: "createUploadSession", input });
      return Promise.resolve(
        input.uploadLengthBytes === undefined
          ? {
              providerAssetId: UID,
              uploadMode: "DIRECT",
              uploadUrl: "https://upload.provider.example/one-time",
              expiresAt: "2026-09-23T09:30:00.000Z",
            }
          : TUS_SESSION,
      );
    },
    resumeUploadSession: (input) => {
      calls.push({ method: "resumeUploadSession", input });
      return Promise.resolve(script.reopen ?? null);
    },
    getAsset: (providerAssetId) => {
      calls.push({ method: "getAsset", input: providerAssetId });
      const status = script.status;
      if (status === undefined)
        return Promise.reject(new Error("no status scripted"));
      return Promise.resolve(typeof status === "function" ? status() : status);
    },
    createPlaybackAuthorization: (input) => {
      calls.push({ method: "createPlaybackAuthorization", input });
      return Promise.resolve({
        mediaAssetId: input.mediaAssetId,
        token: "signed-token",
        playbackUrl:
          "https://edge.provider.example/signed-token/manifest/video.m3u8",
        posterUrl:
          "https://edge.provider.example/signed-token/thumbnails/thumbnail.jpg",
        expiresAt: "2026-09-23T09:15:00.000Z",
      });
    },
    deleteAsset: (providerAssetId) => {
      calls.push({ method: "deleteAsset", input: providerAssetId });
      return script.deleteFails === true
        ? Promise.reject(new Error("provider down"))
        : Promise.resolve();
    },
  };
  return { provider, calls };
}

function harness(options: {
  readonly asset: MediaAsset;
  readonly provider?: VideoProvider | undefined;
  readonly deny?: readonly string[] | undefined;
  readonly viewable?: boolean | undefined;
  readonly networkVisible?: boolean | undefined;
}) {
  const repository = memoryRepository(options.asset);
  const events: unknown[] = [];
  const audits: unknown[] = [];
  const outbox: OutboxWriter = {
    enqueue: (_tx, event) => {
      events.push(event);
      return Promise.resolve({ outboxId: "o", deduplicated: false } as never);
    },
  };
  const audit: MaterialActionAuditWriter = {
    record: (_tx, input) => {
      audits.push(input);
      return Promise.resolve("audit-id" as never);
    },
  };
  const authorization: AuthorizationService = {
    authorize: () => Promise.reject(new Error("not under test")),
    requireCapability: (request) =>
      (options.deny ?? []).includes(request.capability)
        ? Promise.reject(new AuthorizationDeniedError("denied" as never))
        : Promise.resolve(),
  };
  // The company lives in tenant A and belongs to organisation A; only an
  // actor in that tenant resolves it, exactly as the real resolver behaves.
  const owners: MediaOwnerResolverRegistry = {
    get: () => undefined,
    resolve: (actor, ref) =>
      Promise.resolve(
        actor.tenantId === TENANT_A && ref.ownerId === COMPANY
          ? {
              ownerType: "COMPANY",
              ownerId: COMPANY,
              tenantId: TENANT_A,
              ownerOrganisationId: ORG_A,
            }
          : null,
      ),
  };
  const transactions = {
    run: <T>(work: (tx: TransactionContext) => Promise<T>) =>
      work({} as TransactionContext),
  };
  const service = createMediaService({
    sql: {} as never,
    transactions: transactions,
    authorization,
    owners,
    outbox,
    audit,
    repositories: { mediaAssets: repository.mediaAssets },
    ...(options.provider === undefined
      ? {}
      : { videoProvider: options.provider }),
    viewers: {
      resolveViewableCompany: (_actor, companyId) =>
        Promise.resolve(
          options.viewable === true && companyId === COMPANY
            ? { tenantId: TENANT_A, ownerOrganisationId: ORG_A }
            : null,
        ),
      resolveNetworkCompany: (_actor, companyId) =>
        Promise.resolve(
          options.networkVisible === true && companyId === COMPANY
            ? { tenantId: TENANT_A, ownerOrganisationId: ORG_A }
            : null,
        ),
    },
  });
  return { service, repository, events, audits };
}

const statusEvents = (events: unknown[]) =>
  events
    .filter(
      (
        e,
      ): e is {
        type: string;
        data: { previousStatus: string; status: string };
      } =>
        typeof e === "object" &&
        e !== null &&
        (e as { type?: string }).type === "media.asset.status_changed",
    )
    .map((e) => `${e.data.previousStatus}->${e.data.status}`);

describe("transitionPath", () => {
  it.each<[MediaStatus, MediaStatus, readonly MediaStatus[] | null]>([
    ["CREATED", "UPLOAD_PENDING", ["UPLOAD_PENDING"]],
    ["UPLOAD_PENDING", "READY", ["UPLOADING", "PROCESSING", "READY"]],
    ["UPLOADING", "PROCESSING_FAILED", ["PROCESSING", "PROCESSING_FAILED"]],
    ["UPLOAD_PENDING", "UPLOAD_FAILED", ["UPLOAD_FAILED"]],
    ["UPLOAD_PENDING", "EXPIRED", ["EXPIRED"]],
    ["READY", "PROCESSING", null],
    ["UPLOADING", "EXPIRED", null],
    ["PROCESSING", "UPLOAD_FAILED", null],
    ["DELETED", "READY", null],
    ["READY", "DELETED", ["DELETED"]],
    ["READY", "READY", []],
  ])("%s → %s walks %j", (from, to, expected) => {
    expect(transitionPath(from, to)).toEqual(expected);
  });
});

describe("createUploadSession", () => {
  const command = {
    actor: founder,
    companyId: COMPANY,
    mediaAssetId: ASSET_ID,
    expectedVersion: 1,
    correlationId: CORRELATION,
  };

  it("reserves on the server's terms, stores the uid, and never returns it", async () => {
    const { provider, calls } = scriptedProvider({});
    const h = harness({ asset: asset(), provider });
    const result = await h.service.createUploadSession(command);

    expect(calls[0]?.input).toEqual({
      mediaAssetId: ASSET_ID,
      purpose: "FOUNDER_PITCH",
      maxDurationSeconds: 180,
      requireSignedPlayback: true,
    });
    expect(result.session.uploadUrl).toBe(
      "https://upload.provider.example/one-time",
    );
    expect(result.maxDurationSeconds).toBe(180);
    expect(result.asset.status).toBe("UPLOAD_PENDING");
    expect(result.asset.provider).toBe("CLOUDFLARE_STREAM");
    expect(h.repository.current()?.providerAssetId).toBe(UID);
    expect(statusEvents(h.events)).toEqual(["CREATED->UPLOAD_PENDING"]);
    expect(h.audits).toHaveLength(1);
    expect(JSON.stringify(h.audits)).not.toContain("one-time");
    expect(JSON.stringify(h.events)).not.toContain(UID);
  });

  it("asks for open playback only when the asset's own policy is PUBLIC", async () => {
    const { provider, calls } = scriptedProvider({});
    const h = harness({ asset: asset({ playbackPolicy: "PUBLIC" }), provider });
    await h.service.createUploadSession(command);
    expect(
      (calls[0]?.input as { requireSignedPlayback: boolean })
        .requireSignedPlayback,
    ).toBe(false);
  });

  it("refuses a stale version before asking the provider anything", async () => {
    const { provider, calls } = scriptedProvider({});
    const h = harness({ asset: asset({ version: 3 }), provider });
    await expect(h.service.createUploadSession(command)).rejects.toBeInstanceOf(
      MediaAssetConflictError,
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses to issue a second target for an asset that already holds one", async () => {
    const { provider, calls } = scriptedProvider({});
    const h = harness({
      asset: asset({
        status: "UPLOAD_PENDING",
        provider: "CLOUDFLARE_STREAM",
        providerAssetId: UID,
      }),
      provider,
    });
    await expect(h.service.createUploadSession(command)).rejects.toBeInstanceOf(
      MediaRuleError,
    );
    expect(calls).toHaveLength(0);
  });

  it("is not found for a company in another tenant, and denied without media.create", async () => {
    const { provider } = scriptedProvider({});
    const foreign = harness({ asset: asset(), provider });
    // The owner does not resolve in the investor's tenant: the same
    // enumeration-safe refusal every owner-scoped use case gives.
    await expect(
      foreign.service.createUploadSession({ ...command, actor: investor }),
    ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);
    const denied = harness({
      asset: asset(),
      provider,
      deny: ["media.create"],
    });
    await expect(
      denied.service.createUploadSession(command),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("says plainly that no provider is configured, and moves nothing", async () => {
    const h = harness({
      asset: asset(),
      provider: createUnconfiguredVideoProvider({
        missing: ["CLOUDFLARE_ACCOUNT_ID"],
      }),
    });
    await expect(h.service.createUploadSession(command)).rejects.toBeInstanceOf(
      MediaProviderNotConfiguredError,
    );
    expect(h.repository.current()?.status).toBe("CREATED");
    expect(h.events).toHaveLength(0);
  });
});

describe("createUploadSession, resumable (CQ-MEDIA-011)", () => {
  const LENGTH = 6_291_456;
  const KEY = "pitch-upload-0000-key";
  const command = {
    actor: founder,
    companyId: COMPANY,
    mediaAssetId: ASSET_ID,
    expectedVersion: 1,
    uploadLengthBytes: LENGTH,
    idempotencyKey: KEY,
    correlationId: CORRELATION,
  };
  const digest = uploadReservationKey({
    mediaAssetId: ASSET_ID,
    uploadLengthBytes: LENGTH,
    idempotencyKey: KEY,
  });

  it("reserves a resumable target with the length and a digest, never the raw key", async () => {
    const { provider, calls } = scriptedProvider({ resumable: true });
    const h = harness({ asset: asset(), provider });
    const result = await h.service.createUploadSession(command);

    expect(calls[0]?.input).toEqual({
      mediaAssetId: ASSET_ID,
      purpose: "FOUNDER_PITCH",
      maxDurationSeconds: 180,
      requireSignedPlayback: true,
      uploadLengthBytes: LENGTH,
      reservationKey: digest,
    });
    expect(result.replayed).toBe(false);
    expect(result.session).toEqual(TUS_SESSION);
    expect(result.asset.status).toBe("UPLOAD_PENDING");
    expect(statusEvents(h.events)).toEqual(["CREATED->UPLOAD_PENDING"]);
    expect(h.audits).toMatchObject([
      { metadata: { uploadMode: "RESUMABLE", uploadLengthBytes: LENGTH } },
    ]);
    // The key the client chose travels nowhere: not to the provider, not
    // into the audit, not into an event.
    const everything = JSON.stringify([calls, h.audits, h.events]);
    expect(everything).not.toContain(KEY);
    expect(JSON.stringify([h.audits, h.events])).not.toContain("tus/");
  });

  it("answers a retry of the same request with the same open target, changing nothing", async () => {
    const { provider, calls } = scriptedProvider({ resumable: true });
    const h = harness({ asset: asset(), provider });
    await h.service.createUploadSession(command);
    const afterFirst = {
      row: h.repository.current(),
      events: h.events.length,
      audits: h.audits.length,
    };

    // The provider's record says this request opened the target.
    const replaying = scriptedProvider({
      resumable: true,
      reopen: TUS_SESSION,
    });
    const again = harness({
      asset: afterFirst.row ?? asset(),
      provider: replaying.provider,
    });
    // The retry carries the version from before its own first attempt.
    const replay = await again.service.createUploadSession(command);
    expect(replay.replayed).toBe(true);
    expect(replay.session.uploadUrl).toBe(TUS_SESSION.uploadUrl);
    expect(replay.asset).toEqual(afterFirst.row);
    expect(replaying.calls).toEqual([
      {
        method: "resumeUploadSession",
        input: {
          mediaAssetId: ASSET_ID,
          providerAssetId: UID,
          reservationKey: digest,
        },
      },
    ]);
    expect(again.events).toHaveLength(0);
    expect(again.audits).toHaveLength(0);
    expect(
      calls.filter((c) => c.method === "createUploadSession"),
    ).toHaveLength(1);
  });

  it("refuses a different request for an asset that already holds a target", async () => {
    // Another key, another length, or a lapsed target: the provider's
    // record does not match, and no second target is ever reserved.
    const { provider, calls } = scriptedProvider({
      resumable: true,
      reopen: null,
    });
    const h = harness({
      asset: asset({
        status: "UPLOAD_PENDING",
        provider: "CLOUDFLARE_STREAM",
        providerAssetId: UID,
        version: 3,
      }),
      provider,
    });
    await expect(
      h.service.createUploadSession({
        ...command,
        idempotencyKey: "another-key-0",
      }),
    ).rejects.toBeInstanceOf(MediaRuleError);
    expect(calls.map((c) => c.method)).toEqual(["resumeUploadSession"]);
    expect(
      (calls[0]?.input as { reservationKey: string }).reservationKey,
    ).not.toBe(digest);
  });

  it("requires a key with a length, and refuses a length no pitch could be", async () => {
    const { provider, calls } = scriptedProvider({ resumable: true });
    const h = harness({ asset: asset(), provider });
    await expect(
      h.service.createUploadSession({ ...command, idempotencyKey: undefined }),
    ).rejects.toBeInstanceOf(MediaRuleError);
    await expect(
      h.service.createUploadSession({
        ...command,
        uploadLengthBytes: MAX_PITCH_UPLOAD_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(MediaRuleError);
    expect(calls).toHaveLength(0);
    expect(h.repository.current()?.status).toBe("CREATED");
  });

  it("falls back to the one-shot target when the provider cannot resume", async () => {
    const { provider, calls } = scriptedProvider({ resumable: false });
    const h = harness({ asset: asset(), provider });
    const result = await h.service.createUploadSession(command);
    expect(result.session.uploadMode).toBe("DIRECT");
    expect(calls[0]?.input).not.toHaveProperty("uploadLengthBytes");
    expect(calls[0]?.input).not.toHaveProperty("reservationKey");
  });

  it("keeps authorization unchanged: another tenant is not found, no media.create is denied", async () => {
    const { provider, calls } = scriptedProvider({
      resumable: true,
      reopen: TUS_SESSION,
    });
    const pendingAsset = asset({
      status: "UPLOAD_PENDING",
      provider: "CLOUDFLARE_STREAM",
      providerAssetId: UID,
      version: 3,
    });
    const foreign = harness({ asset: pendingAsset, provider });
    await expect(
      foreign.service.createUploadSession({ ...command, actor: investor }),
    ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);
    const denied = harness({
      asset: pendingAsset,
      provider,
      deny: ["media.create"],
    });
    await expect(
      denied.service.createUploadSession(command),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    // A replay is still a request: nobody reaches the provider unchecked.
    expect(calls).toHaveLength(0);
  });
});

describe("cancelUpload", () => {
  const command = {
    actor: founder,
    companyId: COMPANY,
    mediaAssetId: ASSET_ID,
    correlationId: CORRELATION,
  };
  const inFlight = (status: MediaStatus) =>
    asset({
      status,
      provider: "CLOUDFLARE_STREAM",
      providerAssetId: UID,
      version: 3,
    });

  it.each<MediaStatus>(["UPLOAD_PENDING", "UPLOADING"])(
    "ends a %s upload honestly as UPLOAD_FAILED and releases the provider's target",
    async (status) => {
      const { provider, calls } = scriptedProvider({});
      const h = harness({ asset: inFlight(status), provider });
      const result = await h.service.cancelUpload(command);

      expect(result.asset.status).toBe("UPLOAD_FAILED");
      expect(result.providerReleased).toBe(true);
      expect(h.repository.current()?.status).toBe("UPLOAD_FAILED");
      expect(statusEvents(h.events)).toEqual([`${status}->UPLOAD_FAILED`]);
      expect(h.audits).toMatchObject([
        {
          actionType: "media.asset.upload_cancelled",
          metadata: { previousStatus: status, reason: "CANCELLED_BY_CREATOR" },
        },
      ]);
      expect(calls).toEqual([{ method: "deleteAsset", input: UID }]);
      expect(JSON.stringify([h.audits, h.events])).not.toContain(UID);
    },
  );

  it("is idempotent: a second cancel moves and emits nothing, and only retries the release", async () => {
    const { provider, calls } = scriptedProvider({});
    const h = harness({ asset: inFlight("UPLOAD_PENDING"), provider });
    const first = await h.service.cancelUpload(command);
    const second = await h.service.cancelUpload(command);
    expect(second.asset).toEqual(first.asset);
    expect(h.events).toHaveLength(1);
    expect(h.audits).toHaveLength(1);
    expect(calls.filter((c) => c.method === "deleteAsset")).toHaveLength(2);
  });

  it("keeps the record honest when the provider cannot let go yet", async () => {
    const { provider } = scriptedProvider({ deleteFails: true });
    const h = harness({ asset: inFlight("UPLOAD_PENDING"), provider });
    const result = await h.service.cancelUpload(command);
    expect(result.asset.status).toBe("UPLOAD_FAILED");
    expect(result.providerReleased).toBe(false);
  });

  it.each<MediaStatus>(["CREATED", "PROCESSING", "READY", "DELETED"])(
    "refuses to cancel a %s pitch: there is no upload in flight",
    async (status) => {
      const { provider, calls } = scriptedProvider({});
      const h = harness({ asset: inFlight(status), provider });
      await expect(h.service.cancelUpload(command)).rejects.toBeInstanceOf(
        MediaRuleError,
      );
      expect(calls).toHaveLength(0);
      expect(h.events).toHaveLength(0);
    },
  );

  it("is not found in another tenant, and denied without media.create", async () => {
    const { provider, calls } = scriptedProvider({});
    const foreign = harness({ asset: inFlight("UPLOAD_PENDING"), provider });
    await expect(
      foreign.service.cancelUpload({ ...command, actor: investor }),
    ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);
    const denied = harness({
      asset: inFlight("UPLOAD_PENDING"),
      provider,
      deny: ["media.create"],
    });
    await expect(denied.service.cancelUpload(command)).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
    expect(calls).toHaveLength(0);
    expect(denied.repository.current()?.status).toBe("UPLOAD_PENDING");
  });

  it("a late 'ready' for a cancelled upload cannot walk it back", async () => {
    const { provider } = scriptedProvider({
      status: { providerAssetId: UID, status: "READY" },
    });
    const h = harness({ asset: inFlight("UPLOAD_PENDING"), provider });
    await h.service.cancelUpload(command);
    const synced = await h.service.syncMediaAsset(command);
    expect(synced.status).toBe("UPLOAD_FAILED");
  });
});

// CQ-MLV-002 (doc 20 §20.4): deleting a pitch used to end at the row. The
// record said DELETED and playback was refused, but the video stayed in the
// provider account for good -- nothing ever called deleteAsset.
describe("deleteCompanyPitch releases the provider's copy", () => {
  const command = {
    actor: founder,
    companyId: COMPANY,
    mediaAssetId: ASSET_ID,
    correlationId: CORRELATION,
  };
  const published = () =>
    asset({
      status: "READY",
      provider: "CLOUDFLARE_STREAM",
      providerAssetId: UID,
      readyAt: "2026-09-23T09:05:00.000Z",
      moderationStatus: "ALLOWED",
      playbackPolicy: "AUTHORISED",
      version: 10,
    });

  it("deletes the record, then the provider asset", async () => {
    const { provider, calls } = scriptedProvider({});
    const h = harness({ asset: published(), provider });
    const deleted = await h.service.deleteCompanyPitch(command);
    expect(deleted.status).toBe("DELETED");
    expect(h.repository.current()?.status).toBe("DELETED");
    expect(calls).toEqual([{ method: "deleteAsset", input: UID }]);
    expect(JSON.stringify([h.audits, h.events])).not.toContain(UID);
  });

  it("keeps the founder's decision when the provider is down, and retries on a repeat", async () => {
    const failing = scriptedProvider({ deleteFails: true });
    const h = harness({ asset: published(), provider: failing.provider });
    const deleted = await h.service.deleteCompanyPitch(command);
    expect(deleted.status).toBe("DELETED");
    expect(failing.calls).toHaveLength(1);

    const again = await h.service.deleteCompanyPitch(command);
    expect(again).toEqual(deleted);
    expect(failing.calls).toHaveLength(2);
    // The repeat is a retry of the release, not a second deletion.
    expect(h.events).toHaveLength(1);
    expect(h.audits).toHaveLength(1);
  });

  it("asks the provider nothing for a pitch that never had bytes", async () => {
    const { provider, calls } = scriptedProvider({});
    const h = harness({ asset: asset({ status: "CREATED" }), provider });
    await h.service.deleteCompanyPitch(command);
    expect(calls).toHaveLength(0);
  });

  it("touches no provider asset when the caller may not delete", async () => {
    const { provider, calls } = scriptedProvider({});
    const denied = harness({
      asset: published(),
      provider,
      deny: ["media.manage"],
    });
    await expect(
      denied.service.deleteCompanyPitch(command),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    const foreign = harness({ asset: published(), provider });
    await expect(
      foreign.service.deleteCompanyPitch({ ...command, actor: investor }),
    ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);
    expect(calls).toHaveLength(0);
    expect(denied.repository.current()?.status).toBe("READY");
  });
});

describe("syncMediaAsset", () => {
  const command = {
    actor: founder,
    companyId: COMPANY,
    mediaAssetId: ASSET_ID,
    correlationId: CORRELATION,
  };
  const pending = () =>
    asset({
      status: "UPLOAD_PENDING",
      provider: "CLOUDFLARE_STREAM",
      providerAssetId: UID,
    });

  it("walks every intermediate step to what the provider reports, and records each", async () => {
    const { provider } = scriptedProvider({
      status: {
        providerAssetId: UID,
        status: "READY",
        durationSeconds: 87,
        width: 1080,
        height: 1920,
        thumbnailReference: `${UID}/thumbnails/thumbnail.jpg`,
      },
    });
    const h = harness({ asset: pending(), provider });
    const synced = await h.service.syncMediaAsset(command);
    expect(synced.status).toBe("READY");
    expect(synced.readyAt).not.toBeNull();
    expect(synced).toMatchObject({
      durationSeconds: 87,
      width: 1080,
      height: 1920,
      aspectRatio: "9:16",
      thumbnailReference: `${UID}/thumbnails/thumbnail.jpg`,
    });
    expect(statusEvents(h.events)).toEqual([
      "UPLOAD_PENDING->UPLOADING",
      "UPLOADING->PROCESSING",
      "PROCESSING->READY",
    ]);
    expect(h.audits).toHaveLength(1);
  });

  it("is idempotent: a second sync of the same answer changes and emits nothing", async () => {
    const { provider, calls } = scriptedProvider({
      status: { providerAssetId: UID, status: "PROCESSING" },
    });
    const h = harness({ asset: pending(), provider });
    const first = await h.service.syncMediaAsset(command);
    expect(first.status).toBe("PROCESSING");
    const eventsAfterFirst = h.events.length;
    const second = await h.service.syncMediaAsset(command);
    expect(second).toEqual(first);
    expect(h.events).toHaveLength(eventsAfterFirst);
    expect(h.audits).toHaveLength(1);
    expect(calls.filter((c) => c.method === "getAsset")).toHaveLength(2);
  });

  it("never regresses: a provider still saying PROCESSING cannot unmake READY", async () => {
    const { provider } = scriptedProvider({
      status: { providerAssetId: UID, status: "PROCESSING" },
    });
    const ready = asset({
      status: "READY",
      provider: "CLOUDFLARE_STREAM",
      providerAssetId: UID,
      readyAt: "2026-09-23T09:05:00.000Z",
      durationSeconds: 87,
      width: 1080,
      height: 1920,
      aspectRatio: "9:16",
    });
    const h = harness({ asset: ready, provider });
    expect(await h.service.syncMediaAsset(command)).toEqual(ready);
    expect(h.events).toHaveLength(0);
  });

  it("does not let a lapsed-target answer expire an upload that is under way", async () => {
    const { provider } = scriptedProvider({
      status: {
        providerAssetId: UID,
        status: "EXPIRED",
        providerErrorCode: "ASSET_NOT_FOUND",
      },
    });
    const h = harness({
      asset: asset({
        status: "PROCESSING",
        provider: "CLOUDFLARE_STREAM",
        providerAssetId: UID,
      }),
      provider,
    });
    expect((await h.service.syncMediaAsset(command)).status).toBe("PROCESSING");
    expect(h.events).toHaveLength(0);
  });

  it("records a failed encode as PROCESSING_FAILED with the vendor's code kept to the audit", async () => {
    const { provider } = scriptedProvider({
      status: {
        providerAssetId: UID,
        status: "PROCESSING_FAILED",
        providerErrorCode: "ERR_NON_VIDEO",
      },
    });
    const h = harness({ asset: pending(), provider });
    expect((await h.service.syncMediaAsset(command)).status).toBe(
      "PROCESSING_FAILED",
    );
    expect(statusEvents(h.events)).toEqual([
      "UPLOAD_PENDING->UPLOADING",
      "UPLOADING->PROCESSING",
      "PROCESSING->PROCESSING_FAILED",
    ]);
    expect(JSON.stringify(h.events)).not.toContain("ERR_NON_VIDEO");
    expect(JSON.stringify(h.audits)).toContain("ERR_NON_VIDEO");
  });

  it("has nothing to ask for a CREATED asset and asks nothing", async () => {
    const { provider, calls } = scriptedProvider({});
    const h = harness({ asset: asset(), provider });
    expect((await h.service.syncMediaAsset(command)).status).toBe("CREATED");
    expect(calls).toHaveLength(0);
  });
});

describe("authorisePlayback", () => {
  const ready = (overrides: Partial<MediaAsset> = {}) =>
    asset({
      status: "READY",
      provider: "CLOUDFLARE_STREAM",
      providerAssetId: UID,
      readyAt: "2026-09-23T09:05:00.000Z",
      moderationStatus: "ALLOWED",
      playbackPolicy: "AUTHORISED",
      ...overrides,
    });
  const query = { companyId: COMPANY, mediaAssetId: ASSET_ID };

  it("lets the owner preview a READY pitch whatever its moderation or policy says", async () => {
    const { provider, calls } = scriptedProvider({});
    const h = harness({
      asset: ready({
        moderationStatus: "NOT_REVIEWED",
        playbackPolicy: "PRIVATE",
      }),
      provider,
    });
    const grant = await h.service.authorisePlayback({
      ...query,
      actor: founder,
    });
    expect(grant.authorization.playbackUrl).toContain("signed-token");
    expect(calls[0]?.input).toEqual({
      mediaAssetId: ASSET_ID,
      providerAssetId: UID,
      accessMode: "PRIVATE",
      ttlSeconds: 900,
    });
  });

  it("tells the owner a pitch that is not READY has nothing to play", async () => {
    const { provider, calls } = scriptedProvider({});
    const h = harness({
      asset: asset({
        status: "PROCESSING",
        provider: "CLOUDFLARE_STREAM",
        providerAssetId: UID,
      }),
      provider,
    });
    await expect(
      h.service.authorisePlayback({ ...query, actor: founder }),
    ).rejects.toBeInstanceOf(MediaRuleError);
    expect(calls).toHaveLength(0);
  });

  it("admits a viewer only for a publishable pitch of a company discoverable to them", async () => {
    const { provider } = scriptedProvider({});
    const h = harness({ asset: ready(), provider, viewable: true });
    const grant = await h.service.authorisePlayback({
      ...query,
      actor: investor,
    });
    expect(grant.authorization.playbackUrl).toContain("signed-token");
  });

  it.each<[string, Partial<MediaAsset>, boolean]>([
    ["the company is not discoverable to them", {}, false],
    ["the pitch is PRIVATE", { playbackPolicy: "PRIVATE" }, true],
    [
      "the pitch is not moderation-ALLOWED",
      { moderationStatus: "NOT_REVIEWED" },
      true,
    ],
    ["the pitch is BLOCKED", { moderationStatus: "BLOCKED" }, true],
    ["the pitch is not READY", { status: "PROCESSING", readyAt: null }, true],
    // CQ-MLV-001: a replaced pitch stays READY, ALLOWED and AUTHORISED on
    // its own row. The feed stops showing it the moment it is superseded;
    // an investor still holding its id must not keep minting tokens for it.
    [
      "the pitch was superseded by a replacement",
      { supersededAt: "2026-09-24T20:02:33.000Z" },
      true,
    ],
    [
      "the asset is not a founder pitch",
      { purpose: "COMPANY_PRODUCT_DEMO" },
      true,
    ],
  ])(
    "refuses a viewer as not-found when %s",
    async (_label, overrides, viewable) => {
      const { provider, calls } = scriptedProvider({});
      const h = harness({ asset: ready(overrides), provider, viewable });
      await expect(
        h.service.authorisePlayback({ ...query, actor: investor }),
      ).rejects.toBeInstanceOf(MediaAssetNotFoundError);
      expect(calls).toHaveLength(0);
    },
  );

  describe("a video its owner opened to everyone on Capital Q (ADR 0021)", () => {
    it("plays for a signed-in founder when the company is visible to the network", async () => {
      const { provider } = scriptedProvider({});
      const h = harness({
        asset: ready({ audience: "NETWORK" }),
        provider,
        networkVisible: true,
      });
      const grant = await h.service.authorisePlayback({
        ...query,
        actor: investor,
      });
      expect(grant.authorization.playbackUrl).toContain("signed-token");
    });

    it.each<[string, Partial<MediaAsset>, boolean]>([
      ["the video is for investors only", { audience: "INVESTORS" }, true],
      [
        "the company is not visible to the network",
        { audience: "NETWORK" },
        false,
      ],
      [
        "the video is not publishable",
        { audience: "NETWORK", moderationStatus: "NOT_REVIEWED" },
        true,
      ],
      [
        "the video was replaced",
        { audience: "NETWORK", supersededAt: "2026-09-24T20:02:33.000Z" },
        true,
      ],
    ])(
      "is not found for a non-investor when %s",
      async (_label, overrides, networkVisible) => {
        const { provider, calls } = scriptedProvider({});
        const h = harness({
          asset: ready(overrides),
          provider,
          networkVisible,
        });
        await expect(
          h.service.authorisePlayback({ ...query, actor: investor }),
        ).rejects.toBeInstanceOf(MediaAssetNotFoundError);
        expect(calls).toHaveLength(0);
      },
    );
  });

  it("refuses a viewer who names a different company for the same asset", async () => {
    const { provider } = scriptedProvider({});
    const h = harness({ asset: ready(), provider, viewable: true });
    await expect(
      h.service.authorisePlayback({
        actor: investor,
        companyId: "aa000000-0000-4000-8000-000000000002",
        mediaAssetId: ASSET_ID,
      }),
    ).rejects.toBeInstanceOf(MediaAssetNotFoundError);
  });

  it("refuses the owner as not-found for an asset that is not this company's", async () => {
    const { provider } = scriptedProvider({});
    const h = harness({
      asset: ready({ ownerId: "aa000000-0000-4000-8000-000000000002" }),
      provider,
    });
    await expect(
      h.service.authorisePlayback({ ...query, actor: founder }),
    ).rejects.toBeInstanceOf(MediaAssetNotFoundError);
  });

  it("degrades honestly when playback is not configured", async () => {
    const h = harness({
      asset: ready(),
      provider: createUnconfiguredVideoProvider({
        missing: ["CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN"],
      }),
    });
    const failure = await h.service
      .authorisePlayback({ ...query, actor: founder })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MediaProviderNotConfiguredError);
    expect((failure as MediaProviderNotConfiguredError).missing).toEqual([
      "CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN",
    ]);
  });
});

describe("applyProviderStatusReport (verified webhook, CQ-MEDIA-012)", () => {
  const pending = () =>
    asset({
      status: "UPLOAD_PENDING",
      provider: "CLOUDFLARE_STREAM",
      providerAssetId: UID,
    });
  const readyReport: VideoAssetStatus = {
    providerAssetId: UID,
    status: "READY",
    durationSeconds: 87,
    width: 1080,
    height: 1920,
    thumbnailReference: `${UID}/thumbnails/thumbnail.jpg`,
  };
  const deliver = (
    h: ReturnType<typeof harness>,
    report: VideoAssetStatus,
    mediaAssetId?: MediaAsset["id"],
  ) =>
    h.service.applyProviderStatusReport({
      provider: "CLOUDFLARE_STREAM",
      report,
      ...(mediaAssetId === undefined ? {} : { mediaAssetId }),
      correlationId: CORRELATION,
    });

  it("walks the lifecycle to READY with metadata, as the platform, one event per step", async () => {
    const h = harness({ asset: pending() });
    const outcome = await deliver(h, readyReport, ASSET_ID);
    expect(outcome).toEqual({
      kind: "APPLIED",
      mediaAssetId: ASSET_ID,
      status: "READY",
      appliedTransitions: ["UPLOADING", "PROCESSING", "READY"],
      metadataUpdated: true,
    });
    expect(h.repository.current()).toMatchObject({
      status: "READY",
      durationSeconds: 87,
      aspectRatio: "9:16",
      thumbnailReference: `${UID}/thumbnails/thumbnail.jpg`,
    });
    expect(h.repository.current()?.readyAt).not.toBeNull();
    expect(statusEvents(h.events)).toEqual([
      "UPLOAD_PENDING->UPLOADING",
      "UPLOADING->PROCESSING",
      "PROCESSING->READY",
    ]);
    // Attributed to the platform, never to a person; no provider identifier.
    for (const event of h.events as { actor: unknown; tenantId: string }[]) {
      expect(event.actor).toEqual({ type: "SYSTEM" });
      expect(event.tenantId).toBe(TENANT_A);
    }
    expect(JSON.stringify(h.events)).not.toContain(UID);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      actorType: "SYSTEM",
      tenantId: TENANT_A,
      actionType: "media.asset.provider_status_applied",
    });
  });

  it("is idempotent: a duplicate READY changes nothing and emits nothing", async () => {
    const h = harness({ asset: pending() });
    await deliver(h, readyReport);
    const settled = h.repository.current();
    const events = h.events.length;
    const audits = h.audits.length;
    const again = await deliver(h, readyReport);
    expect(again).toEqual({
      kind: "UNCHANGED",
      mediaAssetId: ASSET_ID,
      status: "READY",
      stale: false,
    });
    expect(h.repository.current()).toEqual(settled);
    expect(h.events).toHaveLength(events);
    expect(h.audits).toHaveLength(audits);
  });

  it("never regresses: a PROCESSING delivered after READY is refused whole, metadata too", async () => {
    const h = harness({ asset: pending() });
    await deliver(h, readyReport);
    const settled = h.repository.current();
    const events = h.events.length;
    const late = await deliver(h, {
      providerAssetId: UID,
      status: "PROCESSING",
      durationSeconds: 12,
    });
    expect(late).toMatchObject({ kind: "UNCHANGED", stale: true });
    expect(h.repository.current()).toEqual(settled);
    expect(h.events).toHaveLength(events);
  });

  it("does not record a failure for an asset that is already READY", async () => {
    const h = harness({ asset: pending() });
    await deliver(h, readyReport);
    const events = h.events.length;
    const outcome = await deliver(h, {
      providerAssetId: UID,
      status: "PROCESSING_FAILED",
      providerErrorCode: "ERR_MALFORMED_VIDEO",
    });
    expect(outcome).toMatchObject({ kind: "UNCHANGED", status: "READY" });
    expect(h.repository.current()?.status).toBe("READY");
    expect(h.events).toHaveLength(events);
  });

  it("records a terminal failure once, however often it is delivered", async () => {
    const h = harness({
      asset: asset({
        status: "PROCESSING",
        provider: "CLOUDFLARE_STREAM",
        providerAssetId: UID,
      }),
    });
    const failure: VideoAssetStatus = {
      providerAssetId: UID,
      status: "PROCESSING_FAILED",
      providerErrorCode: "ERR_NON_VIDEO",
    };
    expect(await deliver(h, failure)).toMatchObject({
      kind: "APPLIED",
      status: "PROCESSING_FAILED",
    });
    expect(await deliver(h, failure)).toMatchObject({ kind: "UNCHANGED" });
    expect(statusEvents(h.events)).toEqual(["PROCESSING->PROCESSING_FAILED"]);
    expect(h.audits).toHaveLength(1);
    // The vendor's code is diagnostics: in the audit row, never in an event.
    expect(JSON.stringify(h.audits)).toContain("ERR_NON_VIDEO");
    expect(JSON.stringify(h.events)).not.toContain("ERR_NON_VIDEO");
  });

  it("treats an unknown provider identifier as nothing of ours", async () => {
    const h = harness({ asset: pending() });
    expect(
      await deliver(h, { ...readyReport, providerAssetId: "someoneelsesuid" }),
    ).toEqual({ kind: "UNKNOWN_ASSET" });
    expect(h.repository.current()?.status).toBe("UPLOAD_PENDING");
    expect(h.events).toHaveLength(0);
  });

  it("refuses a report whose own reference names a different asset", async () => {
    const h = harness({ asset: pending() });
    const other = MediaAssetIdSchema.parse(
      "f0000000-0000-4000-8000-000000000999",
    );
    expect(await deliver(h, readyReport, other)).toEqual({
      kind: "REFERENCE_MISMATCH",
      mediaAssetId: ASSET_ID,
    });
    expect(h.repository.current()?.status).toBe("UPLOAD_PENDING");
    expect(h.events).toHaveLength(0);
  });

  it("never touches a DELETED asset and never reports one into deletion", async () => {
    const deleted = harness({
      asset: asset({
        status: "DELETED",
        provider: "CLOUDFLARE_STREAM",
        providerAssetId: UID,
        deletedAt: "2026-09-23T10:00:00.000Z",
      }),
    });
    expect(await deliver(deleted, readyReport)).toMatchObject({
      kind: "UNCHANGED",
      stale: true,
    });
    const live = harness({ asset: pending() });
    expect(
      await deliver(live, { providerAssetId: UID, status: "DELETED" }),
    ).toMatchObject({ kind: "UNCHANGED", stale: true });
    expect(live.repository.current()?.status).toBe("UPLOAD_PENDING");
    expect(deleted.events).toHaveLength(0);
    expect(live.events).toHaveLength(0);
  });

  it("leaves the founder's poll nothing to do once a webhook has applied READY", async () => {
    const { provider } = scriptedProvider({ status: readyReport });
    const h = harness({ asset: pending(), provider });
    await deliver(h, readyReport);
    const events = h.events.length;
    const synced = await h.service.syncMediaAsset({
      actor: founder,
      companyId: COMPANY,
      mediaAssetId: ASSET_ID,
      correlationId: CORRELATION,
    });
    expect(synced.status).toBe("READY");
    expect(h.events).toHaveLength(events);
  });
});
