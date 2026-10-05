import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import {
  CompanyIdSchema,
  CompanyNotFoundError,
  type Company,
  type CompanyService,
} from "@capital-q/companies";
import { parseApiConfig } from "@capital-q/config/api";
import {
  MediaAssetIdSchema,
  type DiscoverablePitch,
  type DiscoverablePitchQueryPort,
  type DiscoverablePitchSet,
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
import type { CompanyNetworkViewPort } from "../src/http/companies.js";
import type {
  CompanyProfilePorts,
  AudienceCompanyDeck,
  SharedCompanyDeck,
} from "../src/http/company-profile.js";

/**
 * A company's profile from Discover (founder request 2026-10-02). The
 * route composes rules that already exist; these tests pin who receives
 * what: the investor everything disclosed to them, a founder viewing
 * another company identity and network videos only, and nobody a field
 * the network projection does not carry.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const COMPANY_TENANT = TenantIdSchema.parse(
  "c0000000-0000-4000-8000-000000000001",
);
const COMPANY_ORG = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-000000000001",
);
const OTHER_TENANT = TenantIdSchema.parse(
  "c0000000-0000-4000-8000-000000000002",
);
const VIEWER_ORG = OrganisationIdSchema.parse(
  "d0000000-0000-4000-8000-000000000002",
);
const COMPANY_ID = CompanyIdSchema.parse(
  "f0000000-0000-4000-8000-000000000001",
);
const INVESTORS_VIDEO = MediaAssetIdSchema.parse(
  "a1000000-0000-4000-8000-000000000001",
);
const NETWORK_VIDEO = MediaAssetIdSchema.parse(
  "a1000000-0000-4000-8000-000000000002",
);
const SECRET = "founder-private-5e1f";

/** Another tenant's investor (or founder) looking at the company. */
const VIEWER: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000002"),
  tenantId: OTHER_TENANT,
  organisationId: VIEWER_ORG,
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000002",
  ),
  actorType: "HUMAN",
};

const COMPANY: Company = {
  id: COMPANY_ID,
  tenantId: COMPANY_TENANT,
  organisationId: COMPANY_ORG,
  canonicalName: "Kivu Grid",
  legalName: "Kivu Grid Ltd",
  slug: "kivu-grid",
  websiteUrl: "https://kivu.example",
  foundedDate: "2024-01-10",
  headquartersCountry: "NG",
  headquartersCity: "Lagos",
  currentStageCode: "seed",
  primaryDescription: "Grid-edge storage for clinics.",
  shortDescription: "Batteries for clinics.",
  companyStatus: "active",
  marketplaceVisibility: "network_visible",
  marketplaceReadinessState: "requirements_outstanding",
  logoStorageKey: `private/${SECRET}`,
  version: 1,
  createdAt: "2026-09-03T09:00:00.000Z",
  updatedAt: "2026-09-03T09:00:00.000Z",
};

const DECK: SharedCompanyDeck = {
  relationshipId: "70000000-0000-4000-8000-000000000001",
  messageId: "71000000-0000-4000-8000-000000000001",
  title: "Kivu Grid seed deck",
  sharedAt: "2026-09-30T10:00:00.000Z",
};

const notUnderTest = () => Promise.reject(new Error("not under test"));

function companies(owned: boolean): CompanyService {
  return {
    createCompany: notUnderTest,
    getCompany: () =>
      owned
        ? Promise.resolve(COMPANY)
        : Promise.reject(new CompanyNotFoundError()),
    updateCompany: notUnderTest,
    setCompanyVisibility: notUnderTest,
    getMarketplaceReadiness: notUnderTest,
    assessMarketplaceReadiness: notUnderTest,
    reconcileMarketplaceReadinessAsSystem: notUnderTest,
    getMyCompanyMembership: notUnderTest,
    upsertMyCompanyMembership: notUnderTest,
    getMyFounderProfile: notUnderTest,
    updateMyFounderProfile: notUnderTest,
    getCompanyTeamFacts: notUnderTest,
    updateCompanyTeamFacts: notUnderTest,
  };
}

function pitch(
  mediaAssetId: DiscoverablePitch["mediaAssetId"],
  audience: DiscoverablePitch["audience"],
): DiscoverablePitch {
  return {
    mediaAssetId,
    companyId: COMPANY_ID,
    aspectRatio: "9:16",
    durationSeconds: 60,
    captionState: "NOT_REQUESTED",
    downloadable: false,
    title: null,
    audience,
  };
}

const PITCHES: DiscoverablePitchQueryPort = {
  findDiscoverablePitches: (companyIds) => {
    const answer = new Map<string, DiscoverablePitchSet>();
    if (companyIds.includes(COMPANY_ID)) {
      answer.set(COMPANY_ID, {
        ...pitch(INVESTORS_VIDEO, "INVESTORS"),
        more: [pitch(NETWORK_VIDEO, "NETWORK")],
      });
    }
    return Promise.resolve(answer);
  },
};

type Calls = {
  raise: number;
  deck: number;
  download: number;
  audienceDownload: number;
  team: number;
  played: string[];
};

const AUDIENCE_DECK: AudienceCompanyDeck = {
  documentId: "72000000-0000-4000-8000-000000000001",
  documentVersionId: "73000000-0000-4000-8000-000000000001",
  title: "Kivu Grid deck (for investors)",
  sharedAt: "2026-10-01T09:00:00.000Z",
};

const TEAM = [
  {
    name: "Ada Obi",
    relationshipType: "team_member" as const,
    businessTitle: "CEO",
    isFounder: true,
    shortBio: "Built grid storage at two utilities.",
  },
];

function ports(options: {
  readonly investor: boolean;
  readonly deck?: SharedCompanyDeck | null;
  readonly playable?: readonly string[];
  /** The pitch rule admits this investor (resolveViewableCompany). */
  readonly findable?: boolean;
  readonly audience?: AudienceCompanyDeck | null;
}): { readonly profile: CompanyProfilePorts; readonly calls: Calls } {
  const calls: Calls = {
    raise: 0,
    deck: 0,
    download: 0,
    audienceDownload: 0,
    team: 0,
    played: [],
  };
  const playable = options.playable ?? [INVESTORS_VIDEO, NETWORK_VIDEO];
  return {
    calls,
    profile: {
      viewerIsInvestor: () => Promise.resolve(options.investor),
      mayPlay: (_actor, _companyId, mediaAssetId) => {
        calls.played.push(mediaAssetId);
        return Promise.resolve(playable.includes(mediaAssetId));
      },
      photo: () => Promise.resolve("https://storage.example/photo.webp?sig=1"),
      disclosedRaise: () => {
        calls.raise += 1;
        return Promise.resolve({ amount: "1500000.00", currency: "USD" });
      },
      organisationVerified: () => Promise.resolve(true),
      sectorNodeIds: () =>
        Promise.resolve(["90000000-0000-4000-8000-000000000001"]),
      sharedDeck: () => {
        calls.deck += 1;
        return Promise.resolve(
          options.deck === undefined ? DECK : options.deck,
        );
      },
      downloadDeck: () => {
        calls.download += 1;
        return Promise.resolve({
          url: "https://storage.example/deck.pdf?sig=2",
          expiresAt: "2026-10-02T10:01:00.000Z",
        });
      },
      investorMayFind: () => Promise.resolve(options.findable === true),
      audienceDeck: () => Promise.resolve(options.audience ?? null),
      downloadAudienceDeck: () => {
        calls.audienceDownload += 1;
        return Promise.resolve({
          url: "https://storage.example/audience-deck.pdf?sig=3",
          expiresAt: "2026-10-02T10:01:00.000Z",
        });
      },
      team: () => {
        calls.team += 1;
        return Promise.resolve(TEAM);
      },
    },
  };
}

function buildApp(options: {
  readonly profile: CompanyProfilePorts;
  readonly owned?: boolean;
  readonly visible?: boolean;
  readonly context?: ActorContext;
}): FastifyInstance {
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({
          status: "RESOLVED",
          context: options.context ?? VIEWER,
        }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  const networkView: CompanyNetworkViewPort = {
    findNetworkVisible: () =>
      Promise.resolve(options.visible === false ? null : COMPANY),
  };
  return createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    companies: companies(options.owned === true),
    companyPitches: PITCHES,
    companyNetworkView: networkView,
    companyProfile: options.profile,
  }).app;
}

const PROFILE_URL = `/v1/companies/${COMPANY_ID}/profile`;
const DECK_URL = `/v1/companies/${COMPANY_ID}/profile/deck/download`;

type ProfileBody = {
  viewer: string;
  canonicalName: string;
  photoUrl: string | null;
  overview: {
    raise: { amount: string; currency: string } | null;
    organisationVerified: boolean;
    deck: { title: string } | null;
    facts: { key: string }[];
  } | null;
  videos: { mediaAssetId: string }[];
};

describe("GET /v1/companies/:id/profile", () => {
  it("an investor receives the overview, the disclosed raise, the shared deck's name and every playable video", async () => {
    const { profile, calls } = ports({ investor: true });
    const app = buildApp({ profile });
    const response = await app.inject({ method: "GET", url: PROFILE_URL });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<ProfileBody>();
    expect(body.viewer).toBe("INVESTOR");
    expect(body.photoUrl).toContain("photo.webp");
    expect(body.overview?.raise).toEqual({
      amount: "1500000.00",
      currency: "USD",
    });
    expect(body.overview?.organisationVerified).toBe(true);
    expect(body.overview?.deck?.title).toBe("Kivu Grid seed deck");
    expect(body.videos.map((video) => video.mediaAssetId)).toEqual([
      INVESTORS_VIDEO,
      NETWORK_VIDEO,
    ]);
    // The deck is named, never linked: no URL, relationship or message.
    expect(response.body).not.toContain(DECK.messageId);
    expect(response.body).not.toContain(DECK.relationshipId);
    expect(response.body).not.toContain("deck.pdf");
    expect(calls.download).toBe(0);
    await app.close();
  });

  it("carries the card's cover beside the photo when the images port answers (founder ask 2026-10-04)", async () => {
    const { profile } = ports({ investor: true });
    const app = buildApp({
      profile: {
        ...profile,
        images: () =>
          Promise.resolve({
            photo: "https://storage.example/photo.webp?sig=1",
            cover: "https://storage.example/cover.webp?sig=1",
          }),
      },
    });
    const response = await app.inject({ method: "GET", url: PROFILE_URL });
    const body = response.json<ProfileBody & { coverUrl?: string | null }>();
    expect(body.photoUrl).toContain("photo.webp");
    expect(body.coverUrl).toContain("cover.webp");
    await app.close();
  });

  it("a reader the card's scopes do not reach gets no image URL at all", async () => {
    const { profile } = ports({ investor: false });
    const app = buildApp({
      profile: {
        ...profile,
        images: () => Promise.resolve({ photo: null, cover: null }),
      },
    });
    const response = await app.inject({ method: "GET", url: PROFILE_URL });
    const body = response.json<ProfileBody & { coverUrl?: string | null }>();
    expect(body.photoUrl).toBeNull();
    expect(body.coverUrl).toBeNull();
    expect(response.body).not.toContain("storage.example");
    await app.close();
  });

  it("carries nothing founder-private, whatever the company read returned", async () => {
    const { profile } = ports({ investor: true });
    const app = buildApp({ profile });
    const response = await app.inject({ method: "GET", url: PROFILE_URL });
    expect(response.body).not.toContain(SECRET);
    expect(response.body).not.toContain("logoStorageKey");
    expect(response.body).not.toContain("readiness");
    expect(response.body).not.toContain("marketplaceVisibility");
    await app.close();
  });

  it("lists only the videos the player would sign for this reader", async () => {
    const { profile } = ports({ investor: true, playable: [NETWORK_VIDEO] });
    const app = buildApp({ profile });
    const body = (
      await app.inject({ method: "GET", url: PROFILE_URL })
    ).json<ProfileBody>();
    expect(body.videos.map((video) => video.mediaAssetId)).toEqual([
      NETWORK_VIDEO,
    ]);
    await app.close();
  });

  it("a founder viewing another company receives identity and network videos only: no overview, raise or deck is computed", async () => {
    const { profile, calls } = ports({ investor: false });
    const app = buildApp({ profile });
    const response = await app.inject({ method: "GET", url: PROFILE_URL });
    expect(response.statusCode).toBe(200);
    const body = response.json<ProfileBody>();
    expect(body.viewer).toBe("FOUNDER");
    expect(body.canonicalName).toBe("Kivu Grid");
    expect(body.overview).toBeNull();
    // An INVESTORS-audience video is never even asked about for them.
    expect(body.videos.map((video) => video.mediaAssetId)).toEqual([
      NETWORK_VIDEO,
    ]);
    expect(calls.played).toEqual([NETWORK_VIDEO]);
    expect(calls.raise).toBe(0);
    expect(calls.deck).toBe(0);
    expect(response.body).not.toContain("1500000");
    expect(response.body).not.toContain("legalName");
    await app.close();
  });

  it("is not-found across tenants when disclosure does not make the company visible", async () => {
    const { profile, calls } = ports({ investor: true });
    const app = buildApp({ profile, visible: false });
    const response = await app.inject({ method: "GET", url: PROFILE_URL });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("Kivu");
    expect(calls.raise).toBe(0);
    expect(calls.played).toEqual([]);
    await app.close();
  });

  it("refuses a malformed company id before reading anything", async () => {
    const { profile, calls } = ports({ investor: true });
    const app = buildApp({ profile });
    const response = await app.inject({
      method: "GET",
      url: "/v1/companies/not-a-uuid/profile",
    });
    expect(response.statusCode).toBe(422);
    expect(calls.played).toEqual([]);
    await app.close();
  });
});

describe("POST /v1/companies/:id/profile/deck/download", () => {
  it("an investor with a shared deck receives a short-lived signed URL", async () => {
    const { profile, calls } = ports({ investor: true });
    const app = buildApp({ profile });
    const response = await app.inject({ method: "GET", url: DECK_URL });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json<{ url: string; expiresAt: string }>()).toEqual({
      url: "https://storage.example/deck.pdf?sig=2",
      expiresAt: "2026-10-02T10:01:00.000Z",
      // ADR 0042: every deck download says whether it was scanned.
      scanned: true,
    });
    expect(calls.download).toBe(1);
    await app.close();
  });

  it("a founder is refused with not-found, and nothing is looked up or signed", async () => {
    const { profile, calls } = ports({ investor: false });
    const app = buildApp({ profile });
    const response = await app.inject({ method: "GET", url: DECK_URL });
    expect(response.statusCode).toBe(404);
    expect(calls.deck).toBe(0);
    expect(calls.download).toBe(0);
    await app.close();
  });

  it("the owner is refused here too: their documents are on their own page", async () => {
    const { profile, calls } = ports({ investor: true });
    const owner: ActorContext = {
      ...VIEWER,
      tenantId: COMPANY_TENANT,
      organisationId: COMPANY_ORG,
    };
    const app = buildApp({ profile, owned: true, context: owner });
    const response = await app.inject({ method: "GET", url: DECK_URL });
    expect(response.statusCode).toBe(404);
    expect(calls.download).toBe(0);
    await app.close();
  });

  it("an investor the company shared no deck with gets the same not-found", async () => {
    const { profile, calls } = ports({ investor: true, deck: null });
    const app = buildApp({ profile });
    const response = await app.inject({ method: "GET", url: DECK_URL });
    expect(response.statusCode).toBe(404);
    expect(calls.download).toBe(0);
    await app.close();
  });

  it("is not-found across tenants for a company that is not visible", async () => {
    const { profile, calls } = ports({ investor: true });
    const app = buildApp({ profile, visible: false });
    const response = await app.inject({ method: "GET", url: DECK_URL });
    expect(response.statusCode).toBe(404);
    expect(calls.deck).toBe(0);
    expect(calls.download).toBe(0);
    await app.close();
  });
});

describe("GET /v1/companies/:id/profile/photo", () => {
  it("answers the photo alone, for any reader the company is visible to", async () => {
    const { profile, calls } = ports({ investor: false });
    const app = buildApp({ profile });
    const response = await app.inject({
      method: "GET",
      url: `/v1/companies/${COMPANY_ID}/profile/photo`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ photoUrl: string | null }>()).toEqual({
      photoUrl: "https://storage.example/photo.webp?sig=1",
    });
    expect(calls.played).toEqual([]);
    expect(calls.raise).toBe(0);
    await app.close();
  });

  it("is not-found for a company that is not visible to the reader", async () => {
    const { profile } = ports({ investor: true });
    const app = buildApp({ profile, visible: false });
    const response = await app.inject({
      method: "GET",
      url: `/v1/companies/${COMPANY_ID}/profile/photo`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("photo.webp");
    await app.close();
  });
});

describe("ADR 0041: a deck opened to investors who can find the company", () => {
  it("an investor the pitch rule admits downloads it through the deck's own audience", async () => {
    const { profile, calls } = ports({
      investor: true,
      findable: true,
      audience: AUDIENCE_DECK,
      deck: null,
    });
    const app = buildApp({ profile });
    const read = (
      await app.inject({ method: "GET", url: PROFILE_URL })
    ).json<ProfileBody>();
    expect(read.overview?.deck?.title).toBe(AUDIENCE_DECK.title);
    expect(JSON.stringify(read)).not.toContain(AUDIENCE_DECK.documentId);
    const response = await app.inject({ method: "GET", url: DECK_URL });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ url: string }>().url).toContain("audience-deck");
    expect(calls.audienceDownload).toBe(1);
    expect(calls.download).toBe(0);
    await app.close();
  });

  it("ADR 0042: an unscanned audience deck is offered and downloaded with scanned:false, to the same admitted investor", async () => {
    const { profile } = ports({
      investor: true,
      findable: true,
      audience: { ...AUDIENCE_DECK, scanned: false },
      deck: null,
    });
    const unscanned = {
      ...profile,
      downloadAudienceDeck: () =>
        Promise.resolve({
          url: "https://storage.example/audience-deck.pdf?sig=4",
          expiresAt: "2026-10-02T10:01:00.000Z",
          scanned: false,
        }),
    };
    const app = buildApp({ profile: unscanned });
    const read = (
      await app.inject({ method: "GET", url: PROFILE_URL })
    ).json<ProfileBody>();
    expect(read.overview?.deck).toMatchObject({ scanned: false });
    const response = await app.inject({ method: "GET", url: DECK_URL });
    expect(response.json<{ scanned: boolean }>().scanned).toBe(false);
    await app.close();
  });

  it("ADR 0042: the same unscanned deck is still refused to an investor the pitch rule does not admit", async () => {
    const { profile, calls } = ports({
      investor: true,
      findable: false,
      audience: { ...AUDIENCE_DECK, scanned: false },
      deck: null,
    });
    const app = buildApp({ profile });
    const response = await app.inject({ method: "GET", url: DECK_URL });
    expect(response.statusCode).toBe(404);
    expect(calls.audienceDownload).toBe(0);
    await app.close();
  });

  it("an investor the pitch rule does not admit gets no audience deck (only a chat share, if any)", async () => {
    const { profile, calls } = ports({
      investor: true,
      findable: false,
      audience: AUDIENCE_DECK,
      deck: null,
    });
    const app = buildApp({ profile });
    const read = (
      await app.inject({ method: "GET", url: PROFILE_URL })
    ).json<ProfileBody>();
    expect(read.overview?.deck).toBeNull();
    const response = await app.inject({ method: "GET", url: DECK_URL });
    expect(response.statusCode).toBe(404);
    expect(calls.audienceDownload).toBe(0);
    await app.close();
  });

  it("a founder is refused the audience deck too, and no audience is even asked", async () => {
    const { profile, calls } = ports({
      investor: false,
      findable: true,
      audience: AUDIENCE_DECK,
    });
    const app = buildApp({ profile });
    const response = await app.inject({ method: "GET", url: DECK_URL });
    expect(response.statusCode).toBe(404);
    expect(calls.audienceDownload).toBe(0);
    expect(calls.download).toBe(0);
    await app.close();
  });

  it("private by default and after it is turned off: no audience deck is the same not-found", async () => {
    const { profile, calls } = ports({
      investor: true,
      findable: true,
      audience: null,
      deck: null,
    });
    const app = buildApp({ profile });
    const response = await app.inject({ method: "GET", url: DECK_URL });
    expect(response.statusCode).toBe(404);
    expect(calls.audienceDownload).toBe(0);
    await app.close();
  });

  it("is not-found across tenants for a company that is not visible", async () => {
    const { profile, calls } = ports({
      investor: true,
      findable: true,
      audience: AUDIENCE_DECK,
    });
    const app = buildApp({ profile, visible: false });
    const response = await app.inject({ method: "GET", url: DECK_URL });
    expect(response.statusCode).toBe(404);
    expect(calls.audienceDownload).toBe(0);
    await app.close();
  });
});

describe("ADR 0041: the team on the profile", () => {
  type TeamBody = {
    overview: { team: Record<string, unknown>[] } | null;
  };

  it("an investor who can find the company sees the allow-listed team", async () => {
    const { profile } = ports({ investor: true, findable: true });
    const app = buildApp({ profile });
    const body = (
      await app.inject({ method: "GET", url: PROFILE_URL })
    ).json<TeamBody>();
    expect(body.overview?.team).toEqual(TEAM);
    for (const member of body.overview?.team ?? []) {
      expect(Object.keys(member).sort()).toEqual([
        "businessTitle",
        "isFounder",
        "name",
        "relationshipType",
        "shortBio",
      ]);
    }
    await app.close();
  });

  it("an investor the pitch rule does not admit, and a founder, get no team", async () => {
    for (const options of [
      { investor: true, findable: false },
      { investor: false, findable: true },
    ]) {
      const { profile, calls } = ports(options);
      const app = buildApp({ profile });
      const body = (
        await app.inject({ method: "GET", url: PROFILE_URL })
      ).json<TeamBody>();
      expect(body.overview?.team ?? []).toEqual([]);
      expect(calls.team).toBe(0);
      await app.close();
    }
  });
});
