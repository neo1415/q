import { describe, expect, it } from "vitest";

import { CompanyIdSchema } from "@capital-q/companies";
import type { CompanyRaiseContextPorts } from "@capital-q/discovery";
import {
  createMediaService,
  MediaAssetIdSchema,
  type MediaAsset,
  type MediaOwnerResolverRegistry,
} from "@capital-q/media";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApiCompanyRaiseReader } from "../src/company-raise.js";

/**
 * Coordinator 2026-10-26 (#547): the raise reads a pitch's raise only
 * through its transcript, which is read under Media's playback rule; the
 * separate playback check before it is gone. Through the real
 * composition (the API's raise reader over the real media service), a
 * pitch this viewer may not play -- not discoverable to them, private,
 * blocked, superseded, deleted, or for an audience they are not in --
 * contributes no raise and no transcript, even when the discoverable set
 * still lists it and its transcript says a raise.
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

/** How the media service resolves this viewer's sight of the company. */
type Sight = "INVESTOR" | "NETWORK" | "NONE";

function reader(row: MediaAsset, sight: Sight) {
  const reject = () => Promise.reject(new Error("not under test"));
  const find = (tenantId: string, id: string) =>
    Promise.resolve(row.tenantId === tenantId && row.id === id ? row : null);
  const mediaAssets = {
    findById: (_e: unknown, tenantId: string, id: string) => find(tenantId, id),
  } as never;
  const pitchTranscripts = {
    find: (_e: unknown, tenantId: string, id: string) =>
      Promise.resolve(
        tenantId === row.tenantId && id === row.id
          ? {
              mediaAssetId: row.id,
              language: "en",
              source: "PROVIDER_GENERATED" as const,
              cues: [
                {
                  startMs: 12_000,
                  endMs: 16_000,
                  text: "We're raising a $2 million seed round.",
                },
              ],
              vtt: "WEBVTT",
              createdAt: "2026-09-26T10:00:00.000Z",
            }
          : null,
      ),
  } as never;
  // The viewer is in another tenant: never the owner.
  const owners: MediaOwnerResolverRegistry = {
    get: () => undefined,
    resolve: () => Promise.resolve(null),
  };
  const company = { tenantId: TENANT_A, ownerOrganisationId: ORG_A };
  const media = createMediaService({
    sql: {} as never,
    transactions: { run: reject },
    authorization: { authorize: reject, requireCapability: reject },
    owners,
    outbox: { enqueue: reject },
    audit: { record: reject },
    repositories: { mediaAssets, pitchTranscripts },
    videoProvider: {} as never,
    viewers: {
      resolveViewableCompany: (_actor, companyId) =>
        Promise.resolve(
          sight === "INVESTOR" && companyId === COMPANY ? company : null,
        ),
      resolveNetworkCompany: (_actor, companyId) =>
        Promise.resolve(
          sight === "NETWORK" && companyId === COMPANY ? company : null,
        ),
    },
  });
  // The discoverable set still lists the pitch, whatever has changed since.
  const pitches: ReturnType<CompanyRaiseContextPorts["pitches"]> = {
    findDiscoverablePitches: (ids) =>
      Promise.resolve(
        new Map(
          ids
            .filter((id) => id === COMPANY)
            .map((id) => [id, { mediaAssetId: ASSET_ID, more: [] }] as const),
        ),
      ),
  };
  return createApiCompanyRaiseReader({
    sql: {} as never,
    companies: {
      findCanonicalCompany: (id) =>
        Promise.resolve({
          id: CompanyIdSchema.parse(id),
          tenantId: TENANT_A,
          organisationId: ORG_A,
          canonicalName: "Example",
          companyStatus: "active",
        }),
    },
    // No raise of record: only the pitch could say one.
    capital: { getCurrentForCompany: () => Promise.resolve(null) },
    disclosure: { evaluateMany: () => Promise.resolve([]) },
    policies: { findAllForResource: () => Promise.resolve([]) },
    isInvestor: () => Promise.resolve(true),
    pitches: () => pitches,
    pitchCues: async (actor, companyId, mediaAssetId) => {
      const view = await media.getPitchTranscript({
        actor,
        companyId,
        mediaAssetId: MediaAssetIdSchema.parse(mediaAssetId),
      });
      return view.status === "AVAILABLE" ? view.cues : null;
    },
  });
}

describe("a pitch this viewer may not play gives no raise (real composition)", () => {
  it("a pitch they may play gives the raise it says, from the transcript", async () => {
    const view = await reader(asset(), "INVESTOR").raiseFor(investor, COMPANY);
    expect(view.source).toBe("PITCH_CLAIM");
    expect(view.money).toEqual({ amount: "2000000", currency: "USD" });
    expect(view.pitch?.pitchId).toBe(ASSET_ID);
  });

  it("not when the company is not discoverable to them", async () => {
    const view = await reader(asset(), "NONE").raiseFor(investor, COMPANY);
    expect(view.source).toBe("NONE");
    expect(view.money).toBeNull();
    expect(view.pitch ?? null).toBeNull();
  });

  it("not once the pitch is private, blocked, superseded or deleted", async () => {
    for (const overrides of [
      { playbackPolicy: "PRIVATE" as const },
      { moderationStatus: "BLOCKED" as const },
      { supersededAt: "2026-09-25T10:00:00.000Z" },
      { deletedAt: "2026-09-25T10:00:00.000Z" },
      { status: "PROCESSING" as const },
    ]) {
      const view = await reader(asset(overrides), "INVESTOR").raiseFor(
        investor,
        COMPANY,
      );
      expect(view.source, JSON.stringify(overrides)).toBe("NONE");
      expect(view.pitch ?? null, JSON.stringify(overrides)).toBeNull();
    }
  });

  it("not for an audience they are not in: an investors-only pitch to a network reader", async () => {
    const investorsOnly = await reader(
      asset({ audience: "INVESTORS" }),
      "NETWORK",
    ).raiseFor(investor, COMPANY);
    expect(investorsOnly.source).toBe("NONE");
    // The network audience is theirs.
    const network = await reader(
      asset({ audience: "NETWORK" }),
      "NETWORK",
    ).raiseFor(investor, COMPANY);
    expect(network.source).toBe("PITCH_CLAIM");
  });
});
