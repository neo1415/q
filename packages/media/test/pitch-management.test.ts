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
  MediaAssetIdSchema,
  MediaIdempotencyConflictError,
  MediaOwnerNotFoundError,
  MediaRuleError,
  type MediaAsset,
  type MediaAssetId,
  type MediaAssetRepository,
  type MediaOwnerResolverRegistry,
  type PitchRequestStore,
} from "../src/index.js";

/**
 * Managing a company's pitch from the founder's "Pitch & media" page
 * (VID): a replacement is idempotent under the client's key, a withdrawal
 * keeps the record and releases the provider's bytes only after the
 * domain change has committed, and every command refuses another tenant's
 * company and an actor without the capability.
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
const COMPANY = "aa000000-0000-4000-8000-000000000001";
const CURRENT_ID = MediaAssetIdSchema.parse(
  "f0000000-0000-4000-8000-000000000001",
);
const CORRELATION = "corr-0000000000000001" as CorrelationId;

const founder: ActorContext = {
  userId: FOUNDER,
  tenantId: TENANT_A,
  organisationId: ORG_A,
  membershipId:
    "e0000000-0000-4000-8000-000000000001" as ActorContext["membershipId"],
  actorType: "HUMAN",
};
const stranger: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000002"),
  tenantId: TENANT_B,
  organisationId: ORG_B,
  membershipId:
    "e0000000-0000-4000-8000-000000000002" as ActorContext["membershipId"],
  actorType: "HUMAN",
};

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: CURRENT_ID,
    tenantId: TENANT_A,
    ownerType: "COMPANY",
    ownerId: COMPANY,
    ownerOrganisationId: ORG_A,
    purpose: "FOUNDER_PITCH",
    provider: "CLOUDFLARE_STREAM",
    providerAssetId: "cfuid00000000000000000000000000aa",
    status: "READY",
    durationSeconds: 87,
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    playbackPolicy: "AUTHORISED",
    thumbnailReference: null,
    captionState: "AVAILABLE",
    transcriptState: "AVAILABLE",
    moderationStatus: "ALLOWED",
    replacesMediaAssetId: null,
    supersededAt: null,
    createdByUserId: FOUNDER,
    createdAt: "2026-09-23T09:00:00.000Z",
    readyAt: "2026-09-23T09:05:00.000Z",
    deletedAt: null,
    version: 3,
    ...overrides,
  };
}

function harness(
  options: {
    readonly deny?: readonly string[] | undefined;
    readonly withRequestStore?: boolean | undefined;
    readonly providerFails?: boolean | undefined;
  } = {},
) {
  const rows = new Map<string, MediaAsset>([[CURRENT_ID, asset()]]);
  const log: string[] = [];
  let inserted = 0;
  let inTransaction = false;
  const notUnderTest = () => Promise.reject(new Error("not under test"));
  const find = (tenantId: string, id: string) => {
    const row = rows.get(id);
    return Promise.resolve(row?.tenantId === tenantId ? row : null);
  };
  const current = () =>
    [...rows.values()].find(
      (row) => row.deletedAt === null && row.supersededAt === null,
    ) ?? null;
  const put = (row: MediaAsset) => {
    rows.set(row.id, row);
    return row;
  };
  const mediaAssets: MediaAssetRepository = {
    insert: (_tx, input) => {
      inserted += 1;
      const id = MediaAssetIdSchema.parse(
        `f0000000-0000-4000-8000-00000000010${String(inserted)}`,
      );
      return Promise.resolve(
        put(
          asset({
            id,
            status: "CREATED",
            provider: "UNASSIGNED",
            providerAssetId: null,
            playbackPolicy: input.playbackPolicy,
            moderationStatus: "NOT_REVIEWED",
            captionState: "NOT_REQUESTED",
            transcriptState: "NOT_REQUESTED",
            durationSeconds: null,
            readyAt: null,
            replacesMediaAssetId: input.replacesMediaAssetId ?? null,
            version: 1,
          }),
        ),
      );
    },
    findById: (_e, tenantId, id) => find(tenantId, id),
    findByProviderAssetId: notUnderTest,
    lockById: (_tx, tenantId, id) => find(tenantId, id),
    findCurrentForOwner: () => Promise.resolve(current()),
    lockCurrentForOwner: () => Promise.resolve(current()),
    listForOwner: () => Promise.resolve([...rows.values()]),
    transitionStatus: (_tx, input) => {
      const row = rows.get(input.mediaAssetId);
      if (row === undefined || row.version !== input.expectedVersion) {
        return Promise.resolve(null);
      }
      log.push(`transition:${input.status}`);
      return Promise.resolve(
        put({
          ...row,
          status: input.status,
          deletedAt: input.deletedAt ?? row.deletedAt,
          version: row.version + 1,
        }),
      );
    },
    setProviderReference: notUnderTest,
    updateProviderMetadata: notUnderTest,
    markSuperseded: (_tx, input) => {
      const row = rows.get(input.mediaAssetId);
      if (row === undefined || row.version !== input.expectedVersion) {
        return Promise.resolve(null);
      }
      return Promise.resolve(
        put({
          ...row,
          supersededAt: "2026-09-24T09:00:00.000Z",
          version: row.version + 1,
        }),
      );
    },
    setStates: notUnderTest,
  };
  const requests = new Map<
    string,
    { requestHash: string; mediaAssetId: MediaAssetId }
  >();
  const pitchRequests: PitchRequestStore = {
    lock: () => Promise.resolve(),
    find: (_tx, userId, organisationId, keyHash) =>
      Promise.resolve(
        requests.get(`${userId}:${organisationId}:${keyHash}`) ?? null,
      ),
    record: (_tx, input) => {
      requests.set(
        `${input.userId}:${input.organisationId}:${input.idempotencyKeyHash}`,
        { requestHash: input.requestHash, mediaAssetId: input.mediaAssetId },
      );
      return Promise.resolve();
    },
  };
  const events: string[] = [];
  const audits: string[] = [];
  const outbox: OutboxWriter = {
    enqueue: (_tx, event) => {
      events.push(event.type);
      return Promise.resolve({ outboxId: "o", deduplicated: false } as never);
    },
  };
  const audit: MaterialActionAuditWriter = {
    record: (_tx, input) => {
      audits.push(input.actionType);
      return Promise.resolve("audit-id" as never);
    },
  };
  const authorization: AuthorizationService = {
    authorize: notUnderTest,
    requireCapability: (request) =>
      (options.deny ?? []).includes(request.capability)
        ? Promise.reject(new AuthorizationDeniedError("denied" as never))
        : Promise.resolve(),
  };
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
  const unconfigured = createUnconfiguredVideoProvider({ missing: ["X"] });
  const videoProvider = {
    ...unconfigured,
    deleteAsset: (providerAssetId: string) => {
      // The release must happen after the domain change committed.
      log.push(
        `provider.delete:${providerAssetId}:${inTransaction ? "IN_TX" : "AFTER_COMMIT"}`,
      );
      return options.providerFails === true
        ? Promise.reject(new Error("provider down"))
        : Promise.resolve();
    },
  };
  const service = createMediaService({
    sql: {} as never,
    transactions: {
      run: async <T>(work: (tx: TransactionContext) => Promise<T>) => {
        inTransaction = true;
        try {
          return await work({ sql: {} } as TransactionContext);
        } finally {
          inTransaction = false;
        }
      },
    },
    authorization,
    owners,
    outbox,
    audit,
    videoProvider,
    repositories:
      options.withRequestStore === false
        ? { mediaAssets }
        : { mediaAssets, pitchRequests },
  });
  return {
    service,
    events,
    audits,
    log,
    rows,
    insertedCount: () => inserted,
  };
}

const replace = (idempotencyKey?: string, actor: ActorContext = founder) => ({
  actor,
  companyId: COMPANY,
  input: { replacesMediaAssetId: CURRENT_ID },
  ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  correlationId: CORRELATION,
});

describe("replacing the published pitch", () => {
  it("creates a new asset and keeps the old one as superseded history", async () => {
    const world = harness();
    const result = await world.service.createCompanyPitch(
      replace("replace-key-0001"),
    );
    expect(result.replayed).toBe(false);
    expect(result.asset.id).not.toBe(CURRENT_ID);
    expect(result.asset.replacesMediaAssetId).toBe(CURRENT_ID);
    expect(result.asset.playbackPolicy).toBe("PRIVATE");
    const old = world.rows.get(CURRENT_ID);
    expect(old?.supersededAt).not.toBeNull();
    expect(old?.deletedAt).toBeNull();
    expect(world.events).toEqual(["media.asset.replaced"]);
  });

  it("answers a retry with the same key with the same asset, once", async () => {
    const world = harness();
    const first = await world.service.createCompanyPitch(
      replace("replace-key-0002"),
    );
    const again = await world.service.createCompanyPitch(
      replace("replace-key-0002"),
    );
    expect(again.replayed).toBe(true);
    expect(again.asset.id).toBe(first.asset.id);
    expect(again.replaced?.id).toBe(CURRENT_ID);
    expect(world.insertedCount()).toBe(1);
    expect(world.events).toHaveLength(1);
    expect(world.audits).toHaveLength(1);
  });

  it("refuses the same key reused for a different request", async () => {
    const world = harness();
    await world.service.createCompanyPitch(replace("replace-key-0003"));
    await expect(
      world.service.createCompanyPitch({
        actor: founder,
        companyId: COMPANY,
        input: {},
        idempotencyKey: "replace-key-0003",
        correlationId: CORRELATION,
      }),
    ).rejects.toBeInstanceOf(MediaIdempotencyConflictError);
  });

  it("refuses a key it cannot honour rather than dropping the guarantee", async () => {
    const world = harness({ withRequestStore: false });
    await expect(
      world.service.createCompanyPitch(replace("replace-key-0004")),
    ).rejects.toBeInstanceOf(MediaRuleError);
    expect(world.insertedCount()).toBe(0);
  });

  it("refuses another tenant's company as not found, changing nothing", async () => {
    const world = harness();
    await expect(
      world.service.createCompanyPitch(replace("replace-key-0005", stranger)),
    ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);
    expect(world.insertedCount()).toBe(0);
    expect(world.rows.get(CURRENT_ID)?.supersededAt).toBeNull();
  });

  it("refuses an actor without media.create", async () => {
    const world = harness({ deny: ["media.create"] });
    await expect(
      world.service.createCompanyPitch(replace("replace-key-0006")),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    expect(world.insertedCount()).toBe(0);
  });
});

describe("withdrawing a pitch", () => {
  const withdraw = (actor: ActorContext = founder) => ({
    actor,
    companyId: COMPANY,
    mediaAssetId: CURRENT_ID,
    correlationId: CORRELATION,
  });

  it("keeps the record, audits it, and releases the bytes only after commit", async () => {
    const world = harness();
    const deleted = await world.service.deleteCompanyPitch(withdraw());
    expect(deleted.status).toBe("DELETED");
    expect(world.rows.has(CURRENT_ID)).toBe(true);
    expect(world.audits).toEqual(["media.asset.deleted"]);
    expect(world.log).toEqual([
      "transition:DELETED",
      "provider.delete:cfuid00000000000000000000000000aa:AFTER_COMMIT",
    ]);
  });

  it("is idempotent: a repeat emits nothing new and retries the release", async () => {
    const world = harness();
    await world.service.deleteCompanyPitch(withdraw());
    await world.service.deleteCompanyPitch(withdraw());
    expect(world.events).toEqual(["media.asset.deleted"]);
    expect(
      world.log.filter((entry) => entry.startsWith("provider.delete")),
    ).toHaveLength(2);
  });

  it("stays withdrawn when the provider is down", async () => {
    const world = harness({ providerFails: true });
    const deleted = await world.service.deleteCompanyPitch(withdraw());
    expect(deleted.status).toBe("DELETED");
  });

  it("needs media.manage, and refuses another tenant's company", async () => {
    const member = harness({ deny: ["media.manage"] });
    await expect(
      member.service.deleteCompanyPitch(withdraw()),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    const outsider = harness();
    await expect(
      outsider.service.deleteCompanyPitch(withdraw(stranger)),
    ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);
    expect(member.log).toEqual([]);
    expect(outsider.log).toEqual([]);
  });
});

describe("unpublishing", () => {
  it("is the owner's PRIVATE playback policy, needing media.manage", async () => {
    const world = harness({ deny: ["media.manage"] });
    await expect(
      world.service.setPitchPlaybackPolicy({
        actor: founder,
        companyId: COMPANY,
        mediaAssetId: CURRENT_ID,
        playbackPolicy: "PRIVATE",
        expectedVersion: 3,
        correlationId: CORRELATION,
      }),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });
});
