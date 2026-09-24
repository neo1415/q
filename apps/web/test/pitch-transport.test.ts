import { describe, expect, it } from "vitest";

import { ApiProblemError, type ApiSession } from "@capital-q/api-client";
import {
  COMPANIES_PATH,
  COMPANY_PITCH_SUFFIX,
  MEDIA_PLAYBACK_SUFFIX,
  MEDIA_SYNC_SUFFIX,
  MEDIA_UPLOAD_CANCEL_SUFFIX,
  MEDIA_UPLOAD_SESSION_SUFFIX,
} from "@capital-q/contracts";

import { apiPitchTransport } from "../src/features/pitch/pitch-transport";

/**
 * The pitch flow on the wire (CQ-WEB-023): each step reaches its own
 * contract path with exactly the body the strict request schema accepts,
 * under the session's bearer token; nothing the server owns is sent, and
 * a refusal arrives as a problem the actions can translate.
 */

const COMPANY = "44444444-0000-4000-8000-000000000001";
const ASSET = "f0000000-0000-4000-8000-000000000001";
const NOW = "2026-09-23T09:00:00.000Z";

const PITCH = {
  mediaAssetId: ASSET,
  purpose: "FOUNDER_PITCH",
  status: "CREATED",
  durationSeconds: null,
  aspectRatio: null,
  playbackPolicy: "PRIVATE",
  captionState: "NOT_REQUESTED",
  transcriptState: "NOT_REQUESTED",
  moderationStatus: "NOT_REVIEWED",
  replacesMediaAssetId: null,
  createdAt: NOW,
  readyAt: null,
  version: 1,
};

type Recorded = {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly authorization: string | null;
  readonly idempotencyKey: string | null;
};

function sessionDouble(
  answer: (path: string) => { status: number; body: unknown },
): { readonly session: ApiSession; readonly calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchDouble: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : null,
      authorization: headers.get("authorization"),
      idempotencyKey: headers.get("idempotency-key"),
    });
    const scripted = answer(url.pathname);
    return Promise.resolve(
      new Response(JSON.stringify(scripted.body), {
        status: scripted.status,
        headers: {
          "content-type":
            scripted.status >= 400
              ? "application/problem+json"
              : "application/json",
        },
      }),
    );
  };
  return {
    session: {
      baseUrl: "https://api.example",
      accessToken: "session-token",
      fetch: fetchDouble,
    },
    calls,
  };
}

const assetPath = `${COMPANIES_PATH}/${COMPANY}${COMPANY_PITCH_SUFFIX}/${ASSET}`;

describe("apiPitchTransport", () => {
  it("creates, reserves, syncs and authorises on their own paths with the contract bodies", async () => {
    const { session, calls } = sessionDouble((path) => {
      if (path.endsWith(MEDIA_UPLOAD_SESSION_SUFFIX)) {
        return {
          status: 201,
          body: {
            mediaAssetId: ASSET,
            uploadMode: "DIRECT",
            uploadUrl: "https://upload.provider.example/one-time",
            expiresAt: "2026-09-23T09:30:00.000Z",
            maxDurationSeconds: 180,
            pitch: { ...PITCH, status: "UPLOAD_PENDING", version: 3 },
          },
        };
      }
      if (path.endsWith(MEDIA_SYNC_SUFFIX)) {
        return {
          status: 200,
          body: { pitch: { ...PITCH, status: "PROCESSING", version: 4 } },
        };
      }
      if (path.endsWith(MEDIA_PLAYBACK_SUFFIX)) {
        return {
          status: 200,
          body: {
            mediaAssetId: ASSET,
            playbackUrl:
              "https://edge.provider.example/tok/manifest/video.m3u8",
            posterUrl: null,
            expiresAt: "2026-09-23T09:15:00.000Z",
          },
        };
      }
      return {
        status: 201,
        body: {
          pitch: PITCH,
          replacedMediaAssetId: null,
          guidance: {
            targetMinSeconds: 30,
            targetMaxSeconds: 120,
            hardMaxSeconds: 180,
            preferredAspectRatio: "9:16",
          },
        },
      };
    });
    const transport = apiPitchTransport(session);

    const created = await transport.create(COMPANY, null);
    expect(created.pitch.status).toBe("CREATED");
    expect(created.guidance.hardMaxSeconds).toBe(180);
    await transport.create(COMPANY, ASSET);

    const reserved = await transport.reserve(COMPANY, ASSET, 1);
    expect(reserved.uploadUrl).toBe("https://upload.provider.example/one-time");
    expect(reserved.pitch.status).toBe("UPLOAD_PENDING");

    const synced = await transport.sync(COMPANY, ASSET);
    expect(synced.status).toBe("PROCESSING");

    const grant = await transport.authorise(COMPANY, ASSET);
    expect(grant.playbackUrl).toContain("/manifest/video.m3u8");

    expect(calls.map((call) => [call.method, call.path, call.body])).toEqual([
      ["POST", `${COMPANIES_PATH}/${COMPANY}${COMPANY_PITCH_SUFFIX}`, {}],
      [
        "POST",
        `${COMPANIES_PATH}/${COMPANY}${COMPANY_PITCH_SUFFIX}`,
        { replacesMediaAssetId: ASSET },
      ],
      [
        "POST",
        `${assetPath}${MEDIA_UPLOAD_SESSION_SUFFIX}`,
        { expectedVersion: 1 },
      ],
      ["POST", `${assetPath}${MEDIA_SYNC_SUFFIX}`, {}],
      ["POST", `${assetPath}${MEDIA_PLAYBACK_SUFFIX}`, {}],
    ]);
    for (const call of calls) {
      expect(call.authorization).toBe("Bearer session-token");
    }
  });

  it("reserves resumably with the length in the body and the key as a header, and cancels on its own path", async () => {
    const { session, calls } = sessionDouble((path) =>
      path.endsWith(MEDIA_UPLOAD_CANCEL_SUFFIX)
        ? {
            status: 200,
            body: { pitch: { ...PITCH, status: "UPLOAD_FAILED", version: 4 } },
          }
        : {
            status: 201,
            body: {
              mediaAssetId: ASSET,
              uploadMode: "RESUMABLE",
              uploadUrl: "https://upload.provider.example/tus/resource",
              expiresAt: "2026-09-23T11:00:00.000Z",
              maxDurationSeconds: 180,
              chunkSizeBytes: 5_242_880,
              pitch: { ...PITCH, status: "UPLOAD_PENDING", version: 3 },
            },
          },
    );
    const transport = apiPitchTransport(session);
    const reserved = await transport.reserve(COMPANY, ASSET, 1, {
      uploadLengthBytes: 6_291_456,
      idempotencyKey: "pitch-upload-key-0001",
    });
    expect(reserved.uploadMode).toBe("RESUMABLE");
    expect(reserved.chunkSizeBytes).toBe(5_242_880);
    const cancelled = await transport.cancel(COMPANY, ASSET);
    expect(cancelled.status).toBe("UPLOAD_FAILED");

    expect(
      calls.map((call) => [call.path, call.body, call.idempotencyKey]),
    ).toEqual([
      [
        `${assetPath}${MEDIA_UPLOAD_SESSION_SUFFIX}`,
        { expectedVersion: 1, uploadLengthBytes: 6_291_456 },
        "pitch-upload-key-0001",
      ],
      [`${assetPath}${MEDIA_UPLOAD_CANCEL_SUFFIX}`, {}, null],
    ]);
  });

  it("loads the company and its current pitch together", async () => {
    const { session, calls } = sessionDouble((path) =>
      path.endsWith(COMPANY_PITCH_SUFFIX)
        ? { status: 200, body: { pitch: null } }
        : {
            status: 200,
            body: {
              id: COMPANY,
              canonicalName: "Acme",
              legalName: null,
              slug: "acme",
              websiteUrl: null,
              foundedDate: null,
              headquartersCountry: null,
              headquartersCity: null,
              currentStageCode: null,
              primaryDescription: null,
              shortDescription: null,
              companyStatus: "active",
              marketplaceVisibility: "organisation_private",
              marketplaceReadinessState: "not_assessed",
              version: 1,
              createdAt: NOW,
              updatedAt: NOW,
            },
          },
    );
    const overview = await apiPitchTransport(session).load(COMPANY);
    expect(overview.company.canonicalName).toBe("Acme");
    expect(overview.company.pitch).toBeNull();
    expect(overview.pitch).toBeNull();
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET"]);
  });

  it("surfaces the server's refusal as a problem, with its status and detail", async () => {
    const { session } = sessionDouble(() => ({
      status: 503,
      body: {
        type: "https://capitalq.example/problems/provider-unavailable",
        title: "A required provider is temporarily unavailable.",
        status: 503,
        code: "PROVIDER_UNAVAILABLE",
        detail:
          "MEDIA_PROVIDER_NOT_CONFIGURED: No video provider is configured for playback: set CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN.",
        requestId: "req-1",
      },
    }));
    const failure = await apiPitchTransport(session)
      .authorise(COMPANY, ASSET)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiProblemError);
    expect((failure as ApiProblemError).status).toBe(503);
    expect((failure as ApiProblemError).problem?.detail).toContain(
      "CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN",
    );
  });
});
