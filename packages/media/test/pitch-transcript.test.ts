import { describe, expect, it } from "vitest";

import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { TransactionContext } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  createMediaService,
  cuesAround,
  MediaAssetIdSchema,
  MediaAssetNotFoundError,
  parseWebVtt,
  type GeneratedCaptions,
  type MediaAsset,
  type MediaAssetRepository,
  type MediaOwnerResolverRegistry,
  type PitchTranscriptRepository,
  type StoredPitchTranscript,
  type VideoProvider,
} from "../src/index.js";

/**
 * The pitch's transcript (R18). Proven here:
 *   - WebVTT becomes ordered, timed cues; malformed cues are skipped, not
 *     guessed; the window around a moment holds exactly the overlapping
 *     cues;
 *   - the transcript is read under the playback rule: a viewer the feed
 *     would not show the pitch to, or anyone once the pitch stops being
 *     publishable, gets not-found -- no transcript for a pitch you cannot
 *     play;
 *   - no transcript is NONE or PENDING, never an empty transcript, and a
 *     provider answer with no usable cue is recorded as failed, not stored;
 *   - sync asks the provider once, stores the captions once, and holds no
 *     transaction across a provider call.
 */

const TENANT_A = TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000a");
const TENANT_B = TenantIdSchema.parse("c0000000-0000-4000-8000-00000000000b");
const ORG_A = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-00000000000a",
);
const ORG_B = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-00000000000b",
);
const COMPANY = "aa000000-0000-4000-8000-000000000001";
const ASSET_ID = MediaAssetIdSchema.parse(
  "f0000000-0000-4000-8000-000000000001",
);
const UID = "cfuid00000000000000000000000000ff";

const VTT = [
  "WEBVTT",
  "",
  "1",
  "00:00:00.000 --> 00:00:04.500",
  "We help clinics in Lagos",
  "",
  "NOTE this is ignored",
  "",
  "00:01:40.000 --> 00:01:44.000 align:start",
  "<v Ada>Our revenue grew</v> three times",
  "",
  "00:01:44.000 --> 00:01:47.250",
  "last year &amp; margins held",
  "",
  "broken --> cue",
  "text",
  "",
  "02:10.000 --> 02:12.000",
  "We are raising a seed round",
  "",
].join("\n");

const investor: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000002"),
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
    provider: "CLOUDFLARE_STREAM",
    providerAssetId: UID,
    status: "READY",
    durationSeconds: 150,
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    playbackPolicy: "AUTHORISED",
    thumbnailReference: null,
    captionState: "NOT_REQUESTED",
    transcriptState: "NOT_REQUESTED",
    moderationStatus: "ALLOWED",
    title: null,
    audience: "INVESTORS",
    downloadable: false,
    replacesMediaAssetId: null,
    supersededAt: null,
    createdByUserId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
    createdAt: "2026-09-23T09:00:00.000Z",
    readyAt: "2026-09-23T09:05:00.000Z",
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

function harness(options: {
  readonly asset: MediaAsset;
  readonly viewable?: boolean;
  readonly captions?: GeneratedCaptions[];
  /** Backlog entries naming assets the fake does not hold. */
  readonly extraBacklog?: readonly {
    readonly tenantId: typeof TENANT_A;
    readonly mediaAssetId: typeof ASSET_ID;
  }[];
}) {
  let row: MediaAsset = options.asset;
  const stored: StoredPitchTranscript[] = [];
  const calls: string[] = [];
  let inTransaction = false;

  const find = (tenantId: string, id: string) =>
    Promise.resolve(row.tenantId === tenantId && row.id === id ? row : null);
  const reject = () => Promise.reject(new Error("not under test"));
  const mediaAssets: MediaAssetRepository = {
    setDownloadable: () => Promise.reject(new Error("not used here")),
    insert: reject,
    findById: (_e, tenantId, id) => find(tenantId, id),
    findByProviderAssetId: reject,
    lockById: (_tx, tenantId, id) => find(tenantId, id),
    findCurrentForOwner: () => Promise.resolve(row),
    countLiveForOwner: () => Promise.resolve(1),
    setDetails: () => Promise.resolve(row),
    listForOwner: () => Promise.resolve([row]),
    transitionStatus: reject,
    setProviderReference: reject,
    updateProviderMetadata: reject,
    markSuperseded: reject,
    setStates: (_tx, input) => {
      row = {
        ...row,
        ...(input.captionState === undefined
          ? {}
          : { captionState: input.captionState }),
        ...(input.transcriptState === undefined
          ? {}
          : { transcriptState: input.transcriptState }),
        version: row.version + 1,
      };
      return Promise.resolve(row);
    },
  };
  const pitchTranscripts: PitchTranscriptRepository = {
    find: (_e, tenantId, id) =>
      Promise.resolve(
        tenantId === row.tenantId
          ? (stored.find((t) => t.mediaAssetId === id) ?? null)
          : null,
      ),
    insert: (_tx, input) => {
      if (!stored.some((t) => t.mediaAssetId === input.mediaAssetId)) {
        stored.push({
          mediaAssetId: input.mediaAssetId,
          language: input.language,
          source: input.source,
          cues: input.cues,
          vtt: input.vtt,
          createdAt: "2026-09-26T10:00:00.000Z",
        });
      }
      return Promise.resolve();
    },
    findOwnerCompany: (_e, id) =>
      Promise.resolve(id === row.id ? row.ownerId : null),
    listCaptionBacklog: () =>
      Promise.resolve(
        row.status === "READY" &&
          (row.captionState === "NOT_REQUESTED" ||
            row.captionState === "PENDING") &&
          !stored.some((t) => t.mediaAssetId === row.id)
          ? [
              ...(options.extraBacklog ?? []),
              { tenantId: row.tenantId, mediaAssetId: row.id },
            ]
          : [...(options.extraBacklog ?? [])],
      ),
  };
  const captions = [...(options.captions ?? [])];
  const provider: VideoProvider = {
    id: "SCRIPTED",
    capabilities: {
      directUpload: true,
      resumableUpload: false,
      signedPlayback: true,
      captions: true,
    },
    createUploadSession: reject,
    resumeUploadSession: reject,
    getAsset: reject,
    createPlaybackAuthorization: reject,
    deleteAsset: reject,
    getGeneratedCaptions: () => {
      calls.push(inTransaction ? "get-in-transaction" : "get");
      return Promise.resolve(captions.shift() ?? { status: "NONE" });
    },
    requestGeneratedCaptions: () => {
      calls.push(inTransaction ? "request-in-transaction" : "request");
      return Promise.resolve("PENDING");
    },
  };
  const authorization: AuthorizationService = {
    authorize: reject,
    requireCapability: () => Promise.resolve(),
  };
  const owners: MediaOwnerResolverRegistry = {
    get: () => undefined,
    // The investor is in another tenant: never the owner.
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
  const outbox: OutboxWriter = { enqueue: reject };
  const audit: MaterialActionAuditWriter = { record: reject };
  const service = createMediaService({
    sql: {} as never,
    transactions: {
      run: async <T>(work: (tx: TransactionContext) => Promise<T>) => {
        inTransaction = true;
        try {
          return await work({} as TransactionContext);
        } finally {
          inTransaction = false;
        }
      },
    },
    authorization,
    owners,
    outbox,
    audit,
    repositories: { mediaAssets, pitchTranscripts },
    videoProvider: provider,
    viewers: {
      resolveViewableCompany: (_actor, companyId) =>
        Promise.resolve(
          options.viewable === true && companyId === COMPANY
            ? { tenantId: TENANT_A, ownerOrganisationId: ORG_A }
            : null,
        ),
    },
  });
  return { service, stored, calls, current: () => row };
}

describe("WebVTT", () => {
  it("becomes ordered timed cues, skipping what is not a cue", () => {
    expect(parseWebVtt(VTT)).toEqual([
      { startMs: 0, endMs: 4500, text: "We help clinics in Lagos" },
      {
        startMs: 100_000,
        endMs: 104_000,
        text: "Our revenue grew three times",
      },
      { startMs: 104_000, endMs: 107_250, text: "last year & margins held" },
      { startMs: 130_000, endMs: 132_000, text: "We are raising a seed round" },
    ]);
    expect(parseWebVtt("WEBVTT\n\nnothing here")).toEqual([]);
  });

  it("windows a moment to exactly the cues that overlap it", () => {
    const cues = parseWebVtt(VTT);
    // 1:42 with a 3 s window: 1:39-1:45.
    expect(cuesAround(cues, 102_000, 3_000).map((c) => c.startMs)).toEqual([
      100_000, 104_000,
    ]);
    // A pause is empty, which is not "no transcript".
    expect(cuesAround(cues, 60_000, 5_000)).toEqual([]);
    // Near zero the window does not go negative.
    expect(cuesAround(cues, 1_000, 10_000).map((c) => c.startMs)).toEqual([0]);
  });
});

describe("syncPitchTranscript", () => {
  it("asks the provider once, then stores the captions once, outside any transaction", async () => {
    const h = harness({
      asset: asset(),
      captions: [{ status: "NONE" }, { status: "READY", vtt: VTT }],
    });
    const key = { tenantId: TENANT_A, mediaAssetId: ASSET_ID };
    expect(await h.service.syncPitchTranscript(key)).toBe("PENDING");
    expect(h.current().transcriptState).toBe("PENDING");
    expect(await h.service.syncPitchTranscript(key)).toBe("AVAILABLE");
    expect(await h.service.syncPitchTranscript(key)).toBe("AVAILABLE");
    expect(h.stored).toHaveLength(1);
    expect(h.stored[0]?.cues).toHaveLength(4);
    expect(h.current().captionState).toBe("AVAILABLE");
    expect(h.calls).toEqual(["get", "request", "get"]);
  });

  it("records an answer with no usable cue as failed, and stores nothing", async () => {
    const h = harness({
      asset: asset(),
      captions: [{ status: "READY", vtt: "WEBVTT\n\n" }],
    });
    expect(
      await h.service.syncPitchTranscript({
        tenantId: TENANT_A,
        mediaAssetId: ASSET_ID,
      }),
    ).toBe("FAILED");
    expect(h.stored).toEqual([]);
    expect(h.current().transcriptState).toBe("FAILED");
  });

  it("does nothing for a pitch that is not READY", async () => {
    const h = harness({ asset: asset({ status: "PROCESSING" }) });
    expect(
      await h.service.syncPitchTranscript({
        tenantId: TENANT_A,
        mediaAssetId: ASSET_ID,
      }),
    ).toBe("NOT_READY");
    expect(h.calls).toEqual([]);
  });
});

describe("sweepPitchCaptions: every pitch gets captions", () => {
  it("asks for captions on a pitch that never asked, then stores them on a later pass", async () => {
    const h = harness({
      asset: asset(),
      captions: [{ status: "NONE" }, { status: "READY", vtt: VTT }],
    });
    const first = await h.service.sweepPitchCaptions({ limit: 50 });
    expect(first.examined).toBe(1);
    expect(first.outcomes.PENDING).toBe(1);
    expect(h.current().captionState).toBe("PENDING");
    const second = await h.service.sweepPitchCaptions({ limit: 50 });
    expect(second.outcomes.AVAILABLE).toBe(1);
    expect(h.current().captionState).toBe("AVAILABLE");
    expect(h.stored).toHaveLength(1);
    // Done: the backlog is empty and nothing more is asked of the provider.
    const third = await h.service.sweepPitchCaptions({ limit: 50 });
    expect(third.examined).toBe(0);
    expect(h.calls).toEqual(["get", "request", "get"]);
  });

  it("keeps going past a pitch whose step fails", async () => {
    const other = MediaAssetIdSchema.parse(
      "f0000000-0000-4000-8000-000000000009",
    );
    const h = harness({
      asset: asset(),
      captions: [{ status: "READY", vtt: VTT }],
      extraBacklog: [{ tenantId: TENANT_A, mediaAssetId: other }],
    });
    const result = await h.service.sweepPitchCaptions({ limit: 50 });
    expect(result.examined).toBe(2);
    // The unknown asset is simply not ready; the real one is stored.
    expect(result.outcomes.NOT_READY).toBe(1);
    expect(result.outcomes.AVAILABLE).toBe(1);
    expect(result.errors).toBe(0);
  });
});

describe("getPitchTranscript: only for a pitch you may play", () => {
  const query = { actor: investor, companyId: COMPANY, mediaAssetId: ASSET_ID };

  async function withTranscript(
    overrides: Partial<MediaAsset>,
    viewable: boolean,
  ) {
    const h = harness({
      asset: asset(overrides),
      viewable,
      captions: [{ status: "READY", vtt: VTT }],
    });
    await h.service.syncPitchTranscript({
      tenantId: TENANT_A,
      mediaAssetId: ASSET_ID,
    });
    return h;
  }

  it("a viewer the feed shows the pitch to reads the timed transcript", async () => {
    const h = await withTranscript({}, true);
    const view = await h.service.getPitchTranscript(query);
    expect(view.status).toBe("AVAILABLE");
    const byPitch = await h.service.getPitchTranscriptByPitch({
      actor: investor,
      mediaAssetId: ASSET_ID,
    });
    expect(byPitch).toMatchObject({ status: "AVAILABLE", companyId: COMPANY });
  });

  it("is not-found for a viewer the company is not discoverable to", async () => {
    const h = await withTranscript({}, false);
    await expect(h.service.getPitchTranscript(query)).rejects.toBeInstanceOf(
      MediaAssetNotFoundError,
    );
    await expect(
      h.service.getPitchTranscriptByPitch({
        actor: investor,
        mediaAssetId: ASSET_ID,
      }),
    ).rejects.toBeInstanceOf(MediaAssetNotFoundError);
  });

  it("is not-found once the pitch is private, blocked by moderation, or superseded", async () => {
    for (const overrides of [
      { playbackPolicy: "PRIVATE" as const },
      { moderationStatus: "BLOCKED" as const },
      { supersededAt: "2026-09-25T10:00:00.000Z" },
    ]) {
      const h = await withTranscript(overrides, true);
      await expect(
        h.service.getPitchTranscript(query),
        JSON.stringify(overrides),
      ).rejects.toBeInstanceOf(MediaAssetNotFoundError);
    }
  });

  it("is NONE or PENDING, never an empty transcript, when there is none yet", async () => {
    expect(
      (
        await harness({
          asset: asset(),
          viewable: true,
        }).service.getPitchTranscript(query)
      ).status,
    ).toBe("NONE");
    expect(
      (
        await harness({
          asset: asset({ transcriptState: "PENDING" }),
          viewable: true,
        }).service.getPitchTranscript(query)
      ).status,
    ).toBe("PENDING");
  });
});
