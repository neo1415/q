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
  AUTOMATED_MODERATION_RULE_V1,
  createMediaService,
  evaluateAutomatedModeration,
  MediaAssetConflictError,
  MediaAssetIdSchema,
  MediaAssetNotFoundError,
  MediaOwnerNotFoundError,
  type MediaAsset,
  type MediaAssetRepository,
  type MediaOwnerResolverRegistry,
} from "../src/index.js";

/**
 * The publish path (CQ-MEDIA-013): the founder's decision and the
 * platform's, each on its own axis, each audited and evented, neither
 * opening any gate but its own.
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
const ASSET_ID = MediaAssetIdSchema.parse(
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

function ready(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: ASSET_ID,
    tenantId: TENANT_A,
    ownerType: "COMPANY",
    ownerId: COMPANY,
    ownerOrganisationId: ORG_A,
    purpose: "FOUNDER_PITCH",
    provider: "CLOUDFLARE_STREAM",
    providerAssetId: "cfuid00000000000000000000000000ff",
    status: "READY",
    durationSeconds: 87,
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    playbackPolicy: "PRIVATE",
    thumbnailReference: null,
    captionState: "NOT_REQUESTED",
    transcriptState: "NOT_REQUESTED",
    moderationStatus: "NOT_REVIEWED",
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

function harness(options: {
  readonly asset: MediaAsset;
  readonly deny?: readonly string[] | undefined;
}) {
  let row: MediaAsset = options.asset;
  const bump = (patch: Partial<MediaAsset>, expectedVersion: number) => {
    if (row.version !== expectedVersion) return null;
    row = { ...row, ...patch, version: row.version + 1 };
    return row;
  };
  const find = (tenantId: string, id: string) =>
    Promise.resolve(row.tenantId === tenantId && row.id === id ? row : null);
  const notUnderTest = () => Promise.reject(new Error("not under test"));
  const mediaAssets: MediaAssetRepository = {
    insert: notUnderTest,
    findById: (_e, tenantId, id) => find(tenantId, id),
    findByProviderAssetId: () => Promise.reject(new Error("not under test")),
    lockById: (_tx, tenantId, id) => find(tenantId, id),
    findCurrentForOwner: () => Promise.resolve(row),
    lockCurrentForOwner: () => Promise.resolve(row),
    listForOwner: () => Promise.resolve([row]),
    transitionStatus: notUnderTest,
    setProviderReference: notUnderTest,
    updateProviderMetadata: notUnderTest,
    markSuperseded: notUnderTest,
    setStates: (_tx, input) =>
      Promise.resolve(
        bump(
          {
            ...(input.playbackPolicy === undefined
              ? {}
              : { playbackPolicy: input.playbackPolicy }),
            ...(input.moderationStatus === undefined
              ? {}
              : { moderationStatus: input.moderationStatus }),
          },
          input.expectedVersion,
        ),
      ),
  };
  const events: { type: string; actor: unknown; data: unknown }[] = [];
  const audits: Record<string, unknown>[] = [];
  const outbox: OutboxWriter = {
    enqueue: (_tx, event) => {
      events.push({ type: event.type, actor: event.actor, data: event.data });
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
  const service = createMediaService({
    sql: {} as never,
    transactions: {
      run: <T>(work: (tx: TransactionContext) => Promise<T>) =>
        work({} as TransactionContext),
    },
    authorization,
    owners,
    outbox,
    audit,
    repositories: { mediaAssets },
  });
  return { service, events, audits, current: () => row };
}

describe("evaluateAutomatedModeration (the rule)", () => {
  it("is one versioned object that reads the product's hard maximum", () => {
    expect(AUTOMATED_MODERATION_RULE_V1).toEqual({
      version: "automated-moderation.v1",
      provenance: "AUTOMATED_RULE_V1",
      minDurationSeconds: 1,
      maxDurationSeconds: 180,
      minDimensionPx: 64,
      maxDimensionPx: 8192,
    });
  });

  it("allows a READY pitch within the bounds, and holds everything else for a person", () => {
    expect(evaluateAutomatedModeration(ready())).toEqual({
      outcome: "ALLOWED",
    });
    expect(
      evaluateAutomatedModeration(ready({ durationSeconds: 181 })),
    ).toEqual({ outcome: "PENDING", reasons: ["DURATION_OUT_OF_RANGE"] });
    expect(
      evaluateAutomatedModeration(ready({ durationSeconds: null })),
    ).toEqual({ outcome: "PENDING", reasons: ["DURATION_UNKNOWN"] });
    expect(
      evaluateAutomatedModeration(ready({ width: 16, height: 16 })),
    ).toEqual({ outcome: "PENDING", reasons: ["DIMENSIONS_OUT_OF_RANGE"] });
    expect(
      evaluateAutomatedModeration(
        ready({
          status: "PROCESSING",
          durationSeconds: null,
          width: null,
          height: null,
        }),
      ),
    ).toEqual({
      outcome: "PENDING",
      reasons: ["NOT_READY", "DURATION_UNKNOWN", "DIMENSIONS_UNKNOWN"],
    });
  });

  it("never blocks", () => {
    const outcomes = [
      ready({ durationSeconds: 100_000 }),
      ready({ width: 1, height: 100_000 }),
      ready({ status: "UPLOAD_FAILED" }),
    ].map((asset) => evaluateAutomatedModeration(asset).outcome);
    expect(outcomes.every((o) => o === "ALLOWED" || o === "PENDING")).toBe(
      true,
    );
  });
});

describe("setPitchPlaybackPolicy (the founder's decision)", () => {
  const command = {
    actor: founder,
    companyId: COMPANY,
    mediaAssetId: ASSET_ID,
    playbackPolicy: "AUTHORISED" as const,
    expectedVersion: 3,
    correlationId: CORRELATION,
  };

  it("records the decision under media.manage, audits it and emits its own event", async () => {
    const h = harness({ asset: ready() });
    const updated = await h.service.setPitchPlaybackPolicy(command);
    expect(updated.playbackPolicy).toBe("AUTHORISED");
    expect(updated.version).toBe(4);
    // Nothing else moved: moderation is the platform's axis, not the founder's.
    expect(updated.moderationStatus).toBe("NOT_REVIEWED");
    expect(h.audits[0]).toMatchObject({
      actorType: "HUMAN",
      actorId: FOUNDER,
      actionType: "media.asset.playback_policy_set",
      metadata: {
        previousPlaybackPolicy: "PRIVATE",
        playbackPolicy: "AUTHORISED",
      },
    });
    expect(h.events).toEqual([
      {
        type: "media.asset.playback_policy_changed",
        actor: { type: "HUMAN", id: FOUNDER },
        data: {
          mediaAssetId: ASSET_ID,
          ownerType: "COMPANY",
          ownerId: COMPANY,
          purpose: "FOUNDER_PITCH",
          previousPlaybackPolicy: "PRIVATE",
          playbackPolicy: "AUTHORISED",
        },
      },
    ]);
  });

  it("is reversible and idempotent", async () => {
    const h = harness({ asset: ready({ playbackPolicy: "AUTHORISED" }) });
    const same = await h.service.setPitchPlaybackPolicy(command);
    expect(same.version).toBe(3);
    expect(h.events).toHaveLength(0);
    const back = await h.service.setPitchPlaybackPolicy({
      ...command,
      playbackPolicy: "PRIVATE",
    });
    expect(back.playbackPolicy).toBe("PRIVATE");
    expect(h.events).toHaveLength(1);
  });

  it("refuses a stale version, a stranger, a missing capability and a foreign asset", async () => {
    await expect(
      harness({ asset: ready() }).service.setPitchPlaybackPolicy({
        ...command,
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(MediaAssetConflictError);
    await expect(
      harness({ asset: ready() }).service.setPitchPlaybackPolicy({
        ...command,
        actor: stranger,
      }),
    ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);
    await expect(
      harness({
        asset: ready(),
        deny: ["media.manage"],
      }).service.setPitchPlaybackPolicy(command),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      harness({
        asset: ready({ ownerId: "aa000000-0000-4000-8000-000000000002" }),
      }).service.setPitchPlaybackPolicy(command),
    ).rejects.toBeInstanceOf(MediaAssetNotFoundError);
  });
});

describe("applyAutomatedModeration (the platform's decision)", () => {
  const command = {
    tenantId: TENANT_A,
    mediaAssetId: ASSET_ID,
    correlationId: CORRELATION,
  };

  it("allows a sound READY pitch under the platform's own authority, with provenance", async () => {
    const h = harness({ asset: ready() });
    const result = await h.service.applyAutomatedModeration(command);
    expect(result).toMatchObject({
      kind: "DECIDED",
      verdict: { outcome: "ALLOWED" },
      asset: { moderationStatus: "ALLOWED", version: 4 },
    });
    expect(h.audits[0]).toMatchObject({
      actorType: "SYSTEM",
      organisationId: ORG_A,
      actionType: "media.asset.moderated",
      metadata: {
        provenance: "AUTOMATED_RULE_V1",
        ruleVersion: "automated-moderation.v1",
        moderationStatus: "ALLOWED",
        holdReasons: [],
      },
    });
    expect(h.audits[0]?.["actorId"]).toBeUndefined();
    expect(h.events).toEqual([
      {
        type: "media.asset.moderated",
        actor: { type: "SYSTEM" },
        data: {
          mediaAssetId: ASSET_ID,
          ownerType: "COMPANY",
          ownerId: COMPANY,
          purpose: "FOUNDER_PITCH",
          previousModerationStatus: "NOT_REVIEWED",
          moderationStatus: "ALLOWED",
          provenance: "AUTOMATED_RULE_V1",
          ruleVersion: "automated-moderation.v1",
          holdReasons: [],
        },
      },
    ]);
    // The founder's axis is untouched.
    expect(h.current().playbackPolicy).toBe("PRIVATE");
  });

  it("holds a too-long pitch for a person, never blocks it", async () => {
    const h = harness({ asset: ready({ durationSeconds: 240 }) });
    const result = await h.service.applyAutomatedModeration(command);
    expect(result).toMatchObject({
      kind: "DECIDED",
      verdict: { outcome: "PENDING", reasons: ["DURATION_OUT_OF_RANGE"] },
      asset: { moderationStatus: "PENDING" },
    });
    expect(h.events[0]?.data).toMatchObject({
      moderationStatus: "PENDING",
      holdReasons: ["DURATION_OUT_OF_RANGE"],
    });
  });

  it("is idempotent on replay, and never overwrites a decision already made", async () => {
    const h = harness({ asset: ready() });
    await h.service.applyAutomatedModeration(command);
    expect(await h.service.applyAutomatedModeration(command)).toEqual({
      kind: "SKIPPED",
      reason: "ALREADY_DECIDED",
    });
    expect(h.events).toHaveLength(1);
    expect(h.audits).toHaveLength(1);

    const reviewed = harness({ asset: ready({ moderationStatus: "BLOCKED" }) });
    expect(await reviewed.service.applyAutomatedModeration(command)).toEqual({
      kind: "SKIPPED",
      reason: "ALREADY_DECIDED",
    });
    expect(reviewed.current().moderationStatus).toBe("BLOCKED");
  });

  it("does nothing for an asset that is not READY, not there, or deleted", async () => {
    expect(
      await harness({
        asset: ready({ status: "PROCESSING" }),
      }).service.applyAutomatedModeration(command),
    ).toEqual({ kind: "SKIPPED", reason: "NOT_READY" });
    expect(
      await harness({ asset: ready() }).service.applyAutomatedModeration({
        ...command,
        tenantId: TENANT_B,
      }),
    ).toEqual({ kind: "SKIPPED", reason: "NOT_FOUND" });
    expect(
      await harness({
        asset: ready({
          status: "DELETED",
          deletedAt: "2026-09-23T10:00:00.000Z",
        }),
      }).service.applyAutomatedModeration(command),
    ).toEqual({ kind: "SKIPPED", reason: "DELETED" });
  });
});
