import { createHmac } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import type {
  ApplyProviderStatusReportCommand,
  MediaService,
  ProviderStatusReportOutcome,
} from "@capital-q/media";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * `POST /v1/webhooks/cloudflare-stream` at the HTTP boundary (CQ-MEDIA-012).
 *
 * The Media service is a recording double: what a report may do to an
 * asset is proven in the Media package, against memory and against the
 * database. What is proven here is that nothing reaches it unless the
 * exact bytes were signed recently with the configured secret, that the
 * signed bytes are the raw ones, and that every refusal is a problem
 * document that says nothing useful to a forger. Every value is synthetic.
 */

const SECRET = "synthetic-webhook-secret-not-real-0000000000";
const PATH = "/v1/webhooks/cloudflare-stream";
const UID = "f1e2d3c4b5a6978877665544332211ff";
const MEDIA_ASSET_ID = "11111111-1111-4111-8111-111111111111";

// Deliberately not JSON.stringify's canonical form: extra whitespace proves
// the signature is checked over the bytes as sent, not a re-serialisation.
const READY_BODY = `{
  "uid": "${UID}",
  "creator": "${MEDIA_ASSET_ID}",
  "readyToStream": true,
  "status": { "state": "ready", "pctComplete": "100.000000" },
  "duration": 87.4,
  "input": { "width": 1080, "height": 1920 },
  "uploaded": "2026-09-24T11:58:00.000Z"
}`;

const nowSeconds = () => Math.floor(Date.now() / 1_000);

function sign(body: string, time = nowSeconds(), secret = SECRET): string {
  const sig = createHmac("sha256", secret)
    .update(`${String(time)}.${body}`)
    .digest("hex");
  return `time=${String(time)},sig1=${sig}`;
}

function fakeMedia(
  outcome: ProviderStatusReportOutcome | Error = {
    kind: "APPLIED",
    mediaAssetId: MEDIA_ASSET_ID as never,
    status: "READY",
    appliedTransitions: ["PROCESSING", "READY"],
    metadataUpdated: true,
  },
) {
  const calls: ApplyProviderStatusReportCommand[] = [];
  const media = {
    applyProviderStatusReport: (command: ApplyProviderStatusReportCommand) => {
      calls.push(command);
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome);
    },
    // A pitch route, to prove the raw-body parser stays in its own scope.
    createCompanyPitch: () =>
      Promise.reject(new Error("the JSON parser still works; not under test")),
  } as unknown as MediaService;
  return { media, calls };
}

function buildApp(options: {
  readonly media: MediaService;
  readonly secret?: string | undefined;
  /** A signed-in founder, for the one test that needs a person's route. */
  readonly signedIn?: boolean | undefined;
}): FastifyInstance {
  const security: ApiSecurityDependencies = {
    authenticator: {
      authenticate: () =>
        Promise.resolve(
          options.signedIn === true
            ? {
                authUserId: AuthUserIdSchema.parse(
                  "a0000000-0000-4000-8000-000000000001",
                ),
              }
            : null,
        ),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve(
          options.signedIn === true
            ? {
                status: "RESOLVED",
                context: {
                  userId: UserIdSchema.parse(
                    "b0000000-0000-4000-8000-000000000001",
                  ),
                  tenantId: TenantIdSchema.parse(
                    "c0000000-0000-4000-8000-000000000001",
                  ),
                  organisationId: OrganisationIdSchema.parse(
                    "d0000000-0000-4000-8000-000000000001",
                  ),
                  membershipId: MembershipIdSchema.parse(
                    "e0000000-0000-4000-8000-000000000001",
                  ),
                  actorType: "HUMAN",
                },
              }
            : { status: "CONTEXT_REQUIRED" },
        ),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  return createApp(
    parseApiConfig({
      NODE_ENV: "test",
      ...(options.secret === undefined
        ? {}
        : { CLOUDFLARE_STREAM_WEBHOOK_SECRET: options.secret }),
    }),
    security,
    { media: options.media },
  ).app;
}

function deliver(
  app: FastifyInstance,
  body: string,
  signature: string | undefined,
  contentType = "application/json",
) {
  return app.inject({
    method: "POST",
    url: PATH,
    headers: {
      "content-type": contentType,
      ...(signature === undefined ? {} : { "webhook-signature": signature }),
    },
    payload: body,
  });
}

function expectRefusal(
  response: Awaited<ReturnType<typeof deliver>>,
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  expect(response.headers["content-type"]).toContain(
    "application/problem+json",
  );
  const problem = response.json<{ code: string; detail?: string }>();
  expect(problem.code).toBe(code);
  // Nothing of the secret, the signature or the body comes back.
  expect(response.payload).not.toContain(SECRET);
  expect(response.payload).not.toContain(UID);
}

describe("POST /v1/webhooks/cloudflare-stream", () => {
  it("applies a correctly signed delivery through Media, normalised, with our reference", async () => {
    const { media, calls } = fakeMedia();
    const app = buildApp({ media, secret: SECRET });
    const response = await deliver(app, READY_BODY, sign(READY_BODY));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      provider: "CLOUDFLARE_STREAM",
      mediaAssetId: MEDIA_ASSET_ID,
      report: {
        providerAssetId: UID,
        status: "READY",
        durationSeconds: 87,
        width: 1080,
        height: 1920,
        thumbnailReference: `${UID}/thumbnails/thumbnail.jpg`,
      },
    });
    expect(calls[0]?.correlationId).toEqual(expect.any(String));
    await app.close();
  });

  it("verifies whatever the declared content type, because the bytes are what was signed", async () => {
    const { media, calls } = fakeMedia();
    const app = buildApp({ media, secret: SECRET });
    const response = await deliver(
      app,
      READY_BODY,
      sign(READY_BODY),
      "text/plain",
    );
    expect(response.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    await app.close();
  });

  it("acknowledges a duplicate the service found already applied", async () => {
    const { media, calls } = fakeMedia({
      kind: "UNCHANGED",
      mediaAssetId: MEDIA_ASSET_ID as never,
      status: "READY",
      stale: false,
    });
    const app = buildApp({ media, secret: SECRET });
    const signature = sign(READY_BODY);
    for (let i = 0; i < 2; i += 1) {
      const response = await deliver(app, READY_BODY, signature);
      expect(response.statusCode).toBe(200);
    }
    expect(calls).toHaveLength(2);
    await app.close();
  });

  it("answers 2xx for a provider id that names nothing of ours, so it is not retried forever", async () => {
    const { media } = fakeMedia({ kind: "UNKNOWN_ASSET" });
    const app = buildApp({ media, secret: SECRET });
    const response = await deliver(app, READY_BODY, sign(READY_BODY));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    await app.close();
  });

  it("refuses an unsigned delivery", async () => {
    const { media, calls } = fakeMedia();
    const app = buildApp({ media, secret: SECRET });
    expectRefusal(
      await deliver(app, READY_BODY, undefined),
      401,
      "AUTHENTICATION_REQUIRED",
    );
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("refuses a tampered body", async () => {
    const { media, calls } = fakeMedia();
    const app = buildApp({ media, secret: SECRET });
    const signature = sign(READY_BODY);
    const tampered = READY_BODY.replace('"ready"', '"error"');
    expectRefusal(
      await deliver(app, tampered, signature),
      401,
      "AUTHENTICATION_REQUIRED",
    );
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("refuses a delivery signed with another secret", async () => {
    const { media, calls } = fakeMedia();
    const app = buildApp({ media, secret: SECRET });
    expectRefusal(
      await deliver(
        app,
        READY_BODY,
        sign(READY_BODY, nowSeconds(), "another-secret-entirely-00000"),
      ),
      401,
      "AUTHENTICATION_REQUIRED",
    );
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("refuses a stale, replayed delivery", async () => {
    const { media, calls } = fakeMedia();
    const app = buildApp({ media, secret: SECRET });
    expectRefusal(
      await deliver(app, READY_BODY, sign(READY_BODY, nowSeconds() - 3_600)),
      401,
      "AUTHENTICATION_REQUIRED",
    );
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("is closed, not open, when no signing secret is configured", async () => {
    const { media, calls } = fakeMedia();
    const app = buildApp({ media });
    expectRefusal(
      await deliver(app, READY_BODY, sign(READY_BODY)),
      503,
      "PROVIDER_UNAVAILABLE",
    );
    expectRefusal(
      await deliver(app, READY_BODY, undefined),
      503,
      "PROVIDER_UNAVAILABLE",
    );
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("refuses a signed body that is not JSON, without reaching Media", async () => {
    const { media, calls } = fakeMedia();
    const app = buildApp({ media, secret: SECRET });
    const body = "{not json";
    expectRefusal(await deliver(app, body, sign(body)), 400, "INVALID_REQUEST");
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("acknowledges but does not apply a vendor state this build does not know", async () => {
    const { media, calls } = fakeMedia();
    const app = buildApp({ media, secret: SECRET });
    const body = READY_BODY.replace('"ready"', '"live-inprogress"');
    const response = await deliver(app, body, sign(body));
    expect(response.statusCode).toBe(200);
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("refuses an oversized delivery before reading it", async () => {
    const { media, calls } = fakeMedia();
    const app = buildApp({ media, secret: SECRET });
    const body = JSON.stringify({ uid: UID, padding: "x".repeat(70 * 1024) });
    expectRefusal(await deliver(app, body, sign(body)), 413, "INVALID_REQUEST");
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("fails loudly when Media cannot apply, so the provider retries", async () => {
    const { media } = fakeMedia(new Error("database unavailable"));
    const app = buildApp({ media, secret: SECRET });
    const response = await deliver(app, READY_BODY, sign(READY_BODY));
    expect(response.statusCode).toBe(500);
    expect(response.payload).not.toContain("database unavailable");
    await app.close();
  });

  it("keeps the raw-body parser to its own scope: other routes still read JSON", async () => {
    const { media } = fakeMedia();
    const app = buildApp({ media, secret: SECRET, signedIn: true });
    const response = await app.inject({
      method: "POST",
      url: "/v1/companies/aa000000-0000-4000-8000-000000000001/pitch",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    // Malformed JSON is still the JSON parser's refusal there. Had the raw
    // parser leaked, the handler would have received a buffer instead.
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("INVALID_REQUEST");
    await app.close();
  });
});
