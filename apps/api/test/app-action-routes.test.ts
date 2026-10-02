import { describe, expect, it } from "vitest";

import { APP_ACTIONS } from "@capital-q/app-actions";
import { parseApiConfig } from "@capital-q/config/api";
import type { MediaAsset, MediaService } from "@capital-q/media";
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
import { appActionRouteKeys } from "../src/http/app-actions.js";

/**
 * Routes generated from the app's action registry (ADR 0040): each
 * declared action is its own route, runs the declared authorize step and
 * the one service call, and answers in the route's existing contract.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const CONTEXT: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const COMPANY = "44444444-0000-4000-8000-000000000001";
const PITCH = "38579af4-cfa2-4fd8-9381-d9f562768c03";
const OTHER = "38579af4-cfa2-4fd8-9381-d9f562768c99";

const asset = (overrides: Partial<MediaAsset> = {}): MediaAsset =>
  ({
    id: PITCH,
    tenantId: CONTEXT.tenantId,
    ownerType: "COMPANY",
    ownerId: COMPANY,
    ownerOrganisationId: CONTEXT.organisationId,
    purpose: "FOUNDER_PITCH",
    provider: "CLOUDFLARE_STREAM",
    providerAssetId: null,
    status: "READY",
    durationSeconds: 60,
    width: null,
    height: null,
    aspectRatio: "9:16",
    playbackPolicy: "PRIVATE",
    thumbnailReference: null,
    captionState: "NOT_REQUESTED",
    transcriptState: "NOT_REQUESTED",
    moderationStatus: "ALLOWED",
    title: "Nixo pitch",
    audience: "NETWORK",
    replacesMediaAssetId: null,
    supersededAt: null,
    createdByUserId: CONTEXT.userId,
    createdAt: "2026-10-02T08:03:36.000Z",
    readyAt: "2026-10-02T08:04:06.000Z",
    deletedAt: null,
    version: 10,
    ...overrides,
  }) as MediaAsset;

function build() {
  const calls: unknown[] = [];
  const media = {
    listCompanyMedia: () => Promise.resolve([asset()]),
    setPitchDetails: (command) => {
      calls.push(command);
      return Promise.resolve(
        asset({
          playbackPolicy: "AUTHORISED",
          audience: "INVESTORS",
          version: 11,
        }),
      );
    },
  } satisfies Pick<MediaService, "listCompanyMedia" | "setPitchDetails">;
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(PRINCIPAL) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  // Only the two operations the declaration calls; the rest is unused here.
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    media: media as never,
  });
  return { app, calls };
}

describe("routes generated from the action registry (ADR 0040)", () => {
  it("declares one route per action with an HTTP shape, each on its own path", () => {
    const keys = appActionRouteKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        "POST /v1/companies/:companyId/pitch/:mediaAssetId/details",
        "POST /v1/discovery/companies/:companyId/save",
        "POST /v1/discovery/companies/:companyId/pass",
        "PATCH /v1/companies/:companyId",
        "PUT /v1/companies/:companyId/team/me",
        "PATCH /v1/investors/:investorOrganisationId",
        "PUT /v1/q-cards/:subjectType/:subjectId/handle",
      ]),
    );
    // Served to Q by a generated tool or, until its area's second step,
    // by the hand tool it names.
    expect(
      APP_ACTIONS.every(
        (action) => (action.tool?.name ?? action.legacyTool ?? "").length > 0,
      ),
    ).toBe(true);
  });

  it("a pitch's audience and playback in one call, on the version the screen saw", async () => {
    const { app, calls } = build();
    const response = await app.inject({
      method: "POST",
      url: `/v1/companies/${COMPANY}/pitch/${PITCH}/details`,
      payload: {
        title: "Nixo pitch",
        audience: "INVESTORS",
        playbackPolicy: "AUTHORISED",
        expectedVersion: 10,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ pitch: { playbackPolicy: string; audience: string } }>()
        .pitch,
    ).toMatchObject({ playbackPolicy: "AUTHORISED", audience: "INVESTORS" });
    expect(calls).toEqual([
      expect.objectContaining({
        companyId: COMPANY,
        mediaAssetId: PITCH,
        details: {
          title: "Nixo pitch",
          audience: "INVESTORS",
          playbackPolicy: "AUTHORISED",
        },
        expectedVersion: 10,
      }),
    ]);
    await app.close();
  });

  it("refuses a pitch that isn't the company's with the one 404, and calls nothing", async () => {
    const { app, calls } = build();
    const response = await app.inject({
      method: "POST",
      url: `/v1/companies/${COMPANY}/pitch/${OTHER}/details`,
      payload: { title: null, audience: "NETWORK", expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(404);
    expect(calls).toEqual([]);
    await app.close();
  });
});
