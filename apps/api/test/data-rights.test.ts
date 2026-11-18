import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import type { DataRightsService, StepUpProof } from "@capital-q/data-rights";
import {
  AuthUserIdSchema,
  UserIdSchema,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";

import { createApp } from "../src/app.js";

/**
 * "Your data" routes (decision 107): the person is the verified session's
 * profile, never an id in the request; deletion needs a verified fresh
 * re-authentication of that same person.
 */

const AUTH_A = AuthUserIdSchema.parse("a0000000-0000-4000-8000-0000000000a1");
const AUTH_B = AuthUserIdSchema.parse("a0000000-0000-4000-8000-0000000000b1");
const USER_A = UserIdSchema.parse("b0000000-0000-4000-8000-0000000000a1");
const EXPORT_ID = "c0000000-0000-4000-8000-000000000001";
const NOW = new Date().toISOString();

const identities: ApplicationIdentityLookup = {
  lookup: (principal) =>
    Promise.resolve(
      principal.authUserId === AUTH_A
        ? { userId: USER_A, displayName: "A" }
        : null,
    ),
};

type Calls = {
  exports: { userId: string; idempotencyKey: string }[];
  links: { userId: string; exportId: string }[];
  deletions: {
    userId: string;
    stepUp: StepUpProof | null;
    confirmation: string;
  }[];
  cancels: string[];
};

function fakeService(calls: Calls): DataRightsService {
  const view = {
    id: EXPORT_ID,
    status: "REQUESTED" as const,
    requestedAt: NOW,
    completedAt: null,
    expiresAt: null,
    byteSize: null,
  };
  return {
    overview: () =>
      Promise.resolve({
        latestExport: null,
        exportsLeftToday: 3,
        deletion: null,
        organisations: [],
        kept: [],
        policy: {
          graceDays: 14,
          exportDays: 7,
          confirmationWords: "DELETE MY ACCOUNT",
        },
      }),
    requestExport: (input) => {
      calls.exports.push(input);
      return Promise.resolve({ kind: "REQUESTED", export: view });
    },
    createDownloadLink: (input) => {
      calls.links.push(input);
      return Promise.resolve({ kind: "NOT_FOUND" });
    },
    preflight: () => Promise.resolve([]),
    requestDeletion: (input) => {
      calls.deletions.push({
        userId: input.userId,
        stepUp: input.stepUp,
        confirmation: input.confirmation,
      });
      return Promise.resolve(
        input.stepUp === null
          ? { kind: "STEP_UP_REQUIRED" }
          : {
              kind: "SCHEDULED",
              deletion: {
                id: EXPORT_ID,
                status: "SCHEDULED",
                requestedAt: NOW,
                scheduledFor: NOW,
                blockedReason: null,
              },
            },
      );
    },
    cancelDeletion: (userId) => {
      calls.cancels.push(userId);
      return Promise.resolve({ kind: "CANCELLED" });
    },
  };
}

function build(
  principal: AuthenticatedPrincipal | null,
  fresh: AuthenticatedPrincipal | null,
) {
  const calls: Calls = { exports: [], links: [], deletions: [], cancels: [] };
  const { app } = createApp(
    parseApiConfig({ NODE_ENV: "test" }),
    {
      authenticator: { authenticate: () => Promise.resolve(principal) },
      resolver: {
        resolveHumanContext: () =>
          Promise.resolve({ status: "CONTEXT_REQUIRED" }),
      },
      identities,
    },
    {
      dataRights: fakeService(calls),
      adminFreshTokens: { authenticate: () => Promise.resolve(fresh) },
    },
  );
  return { app, calls };
}

/** An unsigned token whose `amr` says a password sign-in just now (the fake verifier accepts it). */
function freshToken(at = Math.floor(Date.now() / 1000)): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ amr: [{ method: "password", timestamp: at }] })}.signature-ignored`;
}

describe("data rights routes", () => {
  it("is 401 without a session and 403 for a session with no profile", async () => {
    const anonymous = build(null, null);
    expect(
      (await anonymous.app.inject({ method: "GET", url: "/v1/me/data-rights" }))
        .statusCode,
    ).toBe(401);
    await anonymous.app.close();
    const stranger = build({ authUserId: AUTH_B }, null);
    expect(
      (await stranger.app.inject({ method: "GET", url: "/v1/me/data-rights" }))
        .statusCode,
    ).toBe(403);
    expect(stranger.calls.exports).toEqual([]);
    await stranger.app.close();
  });

  it("asks for a download as the signed-in person only, with an idempotency key", async () => {
    const { app, calls } = build({ authUserId: AUTH_A }, null);
    const missing = await app.inject({
      method: "POST",
      url: "/v1/me/data-exports",
    });
    expect(missing.statusCode).toBe(422);
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/me/data-exports",
      headers: { "idempotency-key": "web-key-123456" },
      payload: { userId: "someone-else" },
    });
    expect(accepted.statusCode).toBe(202);
    expect(calls.exports).toEqual([
      { userId: USER_A, idempotencyKey: "web-key-123456" },
    ]);
    await app.close();
  });

  it("answers 404 for a download that is not the person's own", async () => {
    const { app, calls } = build({ authUserId: AUTH_A }, null);
    const response = await app.inject({
      method: "POST",
      url: `/v1/me/data-exports/${EXPORT_ID}/link`,
    });
    expect(response.statusCode).toBe(404);
    expect(calls.links).toEqual([{ userId: USER_A, exportId: EXPORT_ID }]);
    await app.close();
  });

  it("refuses deletion without a verified fresh re-authentication", async () => {
    const { app, calls } = build({ authUserId: AUTH_A }, null);
    const response = await app.inject({
      method: "POST",
      url: "/v1/me/account-deletion",
      payload: {
        accessToken: freshToken(),
        confirmation: "DELETE MY ACCOUNT",
        organisationsToClose: [],
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe("STEP_UP_REQUIRED");
    expect(calls.deletions[0]?.stepUp).toBeNull();
    await app.close();
  });

  it("passes the verified re-authentication's own account to the service", async () => {
    const { app, calls } = build(
      { authUserId: AUTH_A },
      { authUserId: AUTH_A },
    );
    const at = Math.floor(Date.now() / 1000);
    const response = await app.inject({
      method: "POST",
      url: "/v1/me/account-deletion",
      payload: {
        accessToken: freshToken(at),
        confirmation: "DELETE MY ACCOUNT",
        organisationsToClose: [],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(calls.deletions).toEqual([
      {
        userId: USER_A,
        stepUp: { authUserId: AUTH_A, method: "password", at },
        confirmation: "DELETE MY ACCOUNT",
      },
    ]);
    const cancel = await app.inject({
      method: "POST",
      url: "/v1/me/account-deletion/cancel",
    });
    expect(cancel.statusCode).toBe(204);
    expect(calls.cancels).toEqual([USER_A]);
    await app.close();
  });
});
