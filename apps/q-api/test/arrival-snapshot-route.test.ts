import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import { ArrivalSnapshotSchema } from "@capital-q/contracts";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";
import { registerArrivalSnapshotInvalidation } from "../src/http/q-arrival-snapshot.js";
import {
  buildArrivalSnapshot,
  createArrivalSnapshots,
} from "../src/composition/arrival-snapshot.js";
import {
  NOW,
  tensorGateBrief,
  tensorGateReport,
} from "./arrival-snapshot.fixtures.js";

/**
 * W1: GET /v1/q/arrival-snapshot is the session actor's own snapshot, and
 * a write by them ends trust in what was read before it.
 */

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

function buildApp(signedIn = true) {
  const security: QApiSecurityDependencies = {
    authenticator: {
      authenticate: () =>
        Promise.resolve(
          signedIn
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
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
  };
  let probes = 0;
  const snapshots = createArrivalSnapshots({
    attention: () => Promise.resolve(tensorGateReport()),
    briefs: () => Promise.resolve([tensorGateBrief()]),
    probe: () => {
      probes += 1;
      return Promise.resolve({ epoch: "a".repeat(32), stamp: "s" });
    },
  });
  const { app } = createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    arrivalSnapshots: snapshots,
  });
  return { app, probes: () => probes };
}

describe("GET /v1/q/arrival-snapshot", () => {
  it("returns the session actor's snapshot, uncached by the browser", async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/q/arrival-snapshot",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const snapshot = ArrivalSnapshotSchema.parse(response.json());
    expect(snapshot).toEqual(
      buildArrivalSnapshot({
        report: tensorGateReport(),
        briefs: [tensorGateBrief()],
        now: new Date(snapshot.asOf),
      }),
    );
    expect(NOW.getTime()).toBeGreaterThan(0);
  });

  it("is refused without a session", async () => {
    const { app, probes } = buildApp(false);
    const response = await app.inject({
      method: "GET",
      url: "/v1/q/arrival-snapshot",
    });
    expect(response.statusCode).toBe(401);
    expect(probes()).toBe(0);
  });

  it("a write by the person ends trust in what was read before it", async () => {
    const ended: string[] = [];
    const bare = Fastify();
    registerArrivalSnapshotInvalidation(bare, {
      invalidateActor: (userId) => {
        ended.push(userId);
        return 1;
      },
    });
    bare.addHook("onRequest", (request, _reply, done) => {
      Object.assign(request, { actorContext: CONTEXT });
      done();
    });
    bare.get("/r", () => ({ ok: true }));
    bare.post("/w", () => ({ ok: true }));
    await bare.inject({ method: "GET", url: "/r" });
    expect(ended).toEqual([]);
    await bare.inject({ method: "POST", url: "/w", payload: {} });
    expect(ended).toEqual([CONTEXT.userId]);
  });
});
