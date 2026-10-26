import { describe, expect, it } from "vitest";

import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  createCompanyMediaOwnerResolver,
  createMediaOwnerResolverRegistry,
  createMediaService,
  MediaAssetIdSchema,
  type MediaAsset,
  type MediaAssetId,
  type PitchTranscriptView,
} from "../src/index.js";

/**
 * Coordinator 2026-10-26 (live trace, an investor's top five: every pitch
 * transcript read was an owner company read, an eligibility evaluation and
 * an asset read, one pitch at a time). getPitchTranscripts decides each
 * pitch exactly as getPitchTranscript does alone -- the owner's own pitch,
 * an investor's, the network audience's, and every refusal: not viewable,
 * private, blocked, superseded, deleted, not ready, an audience they are
 * not in, an owner without media view, a failed read -- in a fixed few
 * reads for the set.
 */

const TENANT_OWN = TenantIdSchema.parse("c0000000-0000-4000-8000-0000000000a1");
const TENANT_OTHER = TenantIdSchema.parse(
  "c0000000-0000-4000-8000-0000000000b1",
);
const ORG_OWN = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-0000000000a1",
);
const ORG_INVESTOR = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-0000000000c1",
);
const orgOf = (n: number) =>
  OrganisationIdSchema.parse(
    `d0000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
  );
const companyOf = (n: number) =>
  `aa000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const assetOf = (n: number) =>
  MediaAssetIdSchema.parse(
    `f0000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  );

/** The reader: an investor organisation in its own tenant, or the founder of OWN. */
const actorIn = (tenantId: string, organisationId: string): ActorContext => ({
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000002"),
  tenantId: TenantIdSchema.parse(tenantId),
  organisationId: OrganisationIdSchema.parse(organisationId),
  membershipId:
    "e0000000-0000-4000-8000-000000000002" as ActorContext["membershipId"],
  actorType: "HUMAN",
});
const investor = actorIn(TENANT_OTHER, ORG_INVESTOR);
const founder = actorIn(TENANT_OWN, ORG_OWN);

type Case = {
  readonly overrides?: Partial<MediaAsset>;
  /** The company is the founder's own (in their tenant and organisation). */
  readonly own?: boolean;
  /** How the viewer sees the company: as an investor, as the network, or not. */
  readonly sight: "INVESTOR" | "NETWORK" | "NONE";
  readonly transcript: boolean;
};
const CASES: readonly Case[] = [
  { sight: "INVESTOR", transcript: true },
  { sight: "NONE", transcript: true },
  {
    sight: "INVESTOR",
    transcript: true,
    overrides: { playbackPolicy: "PRIVATE" },
  },
  {
    sight: "INVESTOR",
    transcript: true,
    overrides: { moderationStatus: "BLOCKED" },
  },
  {
    sight: "INVESTOR",
    transcript: true,
    overrides: { supersededAt: "2026-09-25T10:00:00.000Z" },
  },
  {
    sight: "INVESTOR",
    transcript: true,
    overrides: { deletedAt: "2026-09-25T10:00:00.000Z" },
  },
  { sight: "INVESTOR", transcript: false, overrides: { status: "PROCESSING" } },
  { sight: "NETWORK", transcript: true, overrides: { audience: "INVESTORS" } },
  { sight: "NETWORK", transcript: true, overrides: { audience: "NETWORK" } },
  {
    sight: "INVESTOR",
    transcript: false,
    overrides: { transcriptState: "PENDING" },
  },
  { sight: "NONE", transcript: true, own: true },
  {
    sight: "NONE",
    transcript: true,
    own: true,
    overrides: { status: "PROCESSING" },
  },
];

function world(
  options: {
    readonly viewersFail?: boolean;
    readonly ownersFail?: boolean;
    readonly noMediaViewOn?: number;
  } = {},
) {
  const calls = { one: 0, many: 0 };
  const one = <T>(value: T): Promise<T> => {
    calls.one += 1;
    return Promise.resolve(value);
  };
  const many = <T>(value: T): Promise<T> => {
    calls.many += 1;
    return Promise.resolve(value);
  };
  const assets: MediaAsset[] = CASES.map((c, i) => {
    const companyId = companyOf(i);
    const own = c.own === true;
    return {
      id: assetOf(i),
      tenantId: own ? TENANT_OWN : TENANT_OWN,
      ownerType: "COMPANY",
      ownerId: companyId,
      ownerOrganisationId: own ? ORG_OWN : orgOf(i),
      purpose: "FOUNDER_PITCH",
      provider: "CLOUDFLARE_STREAM",
      providerAssetId: `cfuid${String(i).padStart(27, "0")}`,
      status: "READY",
      durationSeconds: 150,
      width: 1080,
      height: 1920,
      aspectRatio: "9:16",
      playbackPolicy: "AUTHORISED",
      thumbnailReference: null,
      captionState: "READY",
      transcriptState: c.transcript ? "READY" : "NOT_REQUESTED",
      moderationStatus: "ALLOWED",
      title: null,
      audience: "INVESTORS",
      downloadable: false,
      replacesMediaAssetId: null,
      supersededAt: null,
      createdByUserId: UserIdSchema.parse(
        "b0000000-0000-4000-8000-000000000001",
      ),
      createdAt: "2026-09-23T09:00:00.000Z",
      readyAt: "2026-09-23T09:05:00.000Z",
      deletedAt: null,
      version: 1,
      ...c.overrides,
    } as MediaAsset;
  });
  const find = (tenantId: string, id: string) =>
    assets.find((a) => a.tenantId === tenantId && a.id === id) ?? null;
  const companyIndex = (companyId: string) =>
    CASES.findIndex((_, i) => companyOf(i) === companyId);
  const sightOf = (companyId: string, kind: "INVESTOR" | "NETWORK") => {
    const i = companyIndex(companyId);
    return i >= 0 && CASES[i]?.sight === kind
      ? { tenantId: TENANT_OWN, ownerOrganisationId: orgOf(i) }
      : null;
  };
  const identity = (companyId: string) => {
    const i = companyIndex(companyId);
    if (i < 0) return null;
    return {
      id: companyId,
      tenantId: TENANT_OWN,
      organisationId: CASES[i]?.own === true ? ORG_OWN : orgOf(i),
      canonicalName: "Example",
      companyStatus: "active",
    };
  };
  const companies: Parameters<typeof createCompanyMediaOwnerResolver>[0] = {
    getCanonicalCompany: (tenantId: string, companyId: string) => {
      if (options.ownersFail === true) return Promise.reject(new Error("down"));
      const company = identity(companyId);
      return one(
        company !== null && company.tenantId === tenantId ? company : null,
      );
    },
    findCanonicalCompanies: (ids: readonly string[]) =>
      options.ownersFail === true
        ? Promise.reject(new Error("down"))
        : many(
            ids.flatMap((id) => (identity(id) === null ? [] : [identity(id)])),
          ),
  } as never;
  const service = createMediaService({
    sql: {} as never,
    transactions: { run: () => Promise.reject(new Error("not under test")) },
    authorization: {
      authorize: () => Promise.reject(new Error("not under test")),
      requireCapability: ({ resource }) =>
        options.noMediaViewOn !== undefined &&
        (resource as { resourceId?: string }).resourceId ===
          companyOf(options.noMediaViewOn)
          ? Promise.reject(new Error("forbidden"))
          : Promise.resolve(),
    },
    owners: createMediaOwnerResolverRegistry([
      createCompanyMediaOwnerResolver(companies),
    ]),
    outbox: { enqueue: () => Promise.reject(new Error("not under test")) },
    audit: { record: () => Promise.reject(new Error("not under test")) },
    repositories: {
      mediaAssets: {
        findById: (_e: unknown, tenantId: string, id: string) =>
          one(find(tenantId, id)),
        findByIds: (
          _e: unknown,
          pairs: readonly { tenantId: string; mediaAssetId: string }[],
        ) =>
          many(
            pairs.flatMap((p) => {
              const a = find(p.tenantId, p.mediaAssetId);
              return a === null ? [] : [a];
            }),
          ),
      } as never,
      pitchTranscripts: {
        find: (_e: unknown, tenantId: string, id: string) => {
          const i = assets.findIndex(
            (a) => a.tenantId === tenantId && a.id === id,
          );
          return one(
            i >= 0 && CASES[i]?.transcript === true
              ? {
                  mediaAssetId: assets[i]?.id,
                  language: "en",
                  source: "PROVIDER_GENERATED" as const,
                  cues: [
                    { startMs: 1000, endMs: 2000, text: `pitch ${String(i)}` },
                  ],
                  vtt: "WEBVTT",
                  createdAt: "2026-09-26T10:00:00.000Z",
                }
              : null,
          );
        },
        findMany: (
          _e: unknown,
          pairs: readonly { tenantId: string; mediaAssetId: string }[],
        ) =>
          many(
            pairs.flatMap((p) => {
              const i = assets.findIndex(
                (a) => a.tenantId === p.tenantId && a.id === p.mediaAssetId,
              );
              return i >= 0 && CASES[i]?.transcript === true
                ? [
                    {
                      mediaAssetId: assets[i]?.id,
                      language: "en",
                      source: "PROVIDER_GENERATED" as const,
                      cues: [
                        {
                          startMs: 1000,
                          endMs: 2000,
                          text: `pitch ${String(i)}`,
                        },
                      ],
                      vtt: "WEBVTT",
                      createdAt: "2026-09-26T10:00:00.000Z",
                    },
                  ]
                : [];
            }),
          ),
      } as never,
    },
    videoProvider: {} as never,
    viewers: {
      resolveViewableCompany: (_actor, companyId) =>
        options.viewersFail === true
          ? Promise.reject(new Error("down"))
          : one(sightOf(companyId, "INVESTOR")),
      resolveViewableCompanies: (_actor, companyIds) =>
        options.viewersFail === true
          ? Promise.reject(new Error("down"))
          : many(
              new Map(
                companyIds.flatMap((companyId) => {
                  const s = sightOf(companyId, "INVESTOR");
                  return s === null ? [] : [[companyId, s] as const];
                }),
              ),
            ),
      resolveNetworkCompany: (_actor, companyId) =>
        Promise.resolve(sightOf(companyId, "NETWORK")),
    },
  });
  return { service, calls };
}

const PITCHES = CASES.map((_, i) => ({
  companyId: companyOf(i),
  mediaAssetId: assetOf(i),
}));

/** getPitchTranscript, pitch by pitch: the view, or absent where refused. */
async function oneByOne(
  service: ReturnType<typeof world>["service"],
  actor: ActorContext,
): Promise<ReadonlyMap<MediaAssetId, PitchTranscriptView>> {
  const out = new Map<MediaAssetId, PitchTranscriptView>();
  for (const pitch of PITCHES) {
    try {
      out.set(
        pitch.mediaAssetId,
        await service.getPitchTranscript({ actor, ...pitch }),
      );
    } catch {
      // Refused alone: absent from the batch too.
    }
  }
  return out;
}

describe("pitch transcripts read together decide as one by one (playback rule)", () => {
  for (const [label, actor, options] of [
    ["an investor", investor, {}],
    ["the founder of their own company", founder, {}],
    [
      "an owner without media view on one of theirs",
      founder,
      { noMediaViewOn: 10 },
    ],
    ["a failed sight read", investor, { viewersFail: true }],
    ["a failed owner read", founder, { ownersFail: true }],
  ] as const) {
    it(`${label}: the same pitches, the same transcripts`, async () => {
      const batched = world(options);
      const alone = world(options);
      expect(
        await batched.service.getPitchTranscripts({ actor, pitches: PITCHES }),
      ).toEqual(await oneByOne(alone.service, actor));
    });
  }

  it("an investor's set: what they may play, in one read of each kind", async () => {
    const { service, calls } = world();
    const views = await service.getPitchTranscripts({
      actor: investor,
      pitches: PITCHES,
    });
    // Owners, sight, assets, transcripts: one batch read each.
    expect(calls).toEqual({ one: 0, many: 4 });
    expect([...views.keys()]).toEqual([assetOf(0), assetOf(8), assetOf(9)]);
    expect(views.get(assetOf(0))?.status).toBe("AVAILABLE");
    expect(views.get(assetOf(9))?.status).toBe("PENDING");
    // Never another company's own pitch, an investors-only pitch to a
    // network reader, or a pitch not discoverable to them.
    for (const refused of [1, 2, 3, 4, 5, 6, 7, 10, 11]) {
      expect(views.has(assetOf(refused)), String(refused)).toBe(false);
    }
  });
});
