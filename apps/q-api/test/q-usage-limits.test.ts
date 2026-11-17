import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import type { QRuntimeService } from "@capital-q/q-runtime";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp } from "../src/app.js";
import {
  createQRunLimiter,
  DEFAULT_Q_USAGE_LIMITS,
  parseQUsageLimits,
  QUsageLimitError,
} from "../src/http/q-usage-limits.js";

/** Launch readiness 9: per-person Q run limits. */

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
const OTHER: ActorContext = {
  ...CONTEXT,
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000002"),
};

describe("createQRunLimiter", () => {
  it("refuses past the per-minute allowance, per person, and again after the window", async () => {
    let clock = Date.UTC(2026, 10, 17, 12, 0, 0);
    const limiter = createQRunLimiter({
      limits: { runsPerMinute: 2, runsPerDay: 100 },
      runsSince: () => Promise.resolve(0),
      now: () => clock,
    });
    await limiter.admit(CONTEXT);
    await limiter.admit(CONTEXT);
    await expect(limiter.admit(CONTEXT)).rejects.toMatchObject({
      scope: "MINUTE",
      retryAfterSeconds: 60,
    });
    await limiter.admit(OTHER);
    clock += 60_001;
    await limiter.admit(CONTEXT);
  });

  it("refuses past the daily allowance counted from today's runs, until midnight UTC", async () => {
    const at = Date.UTC(2026, 10, 17, 23, 0, 0);
    const asked: { actor: ActorContext; since: Date }[] = [];
    const limiter = createQRunLimiter({
      limits: { runsPerMinute: 10, runsPerDay: 5 },
      runsSince: (actor, since) => {
        asked.push({ actor, since });
        return Promise.resolve(5);
      },
      now: () => at,
    });
    const refusal = await limiter
      .admit(CONTEXT)
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(QUsageLimitError);
    expect(refusal).toMatchObject({ scope: "DAY", retryAfterSeconds: 3600 });
    expect(asked[0]?.since.toISOString()).toBe("2026-11-17T00:00:00.000Z");
    expect(asked[0]?.actor).toBe(CONTEXT);
  });

  it("admits when today's count cannot be read, and says so", async () => {
    const failures: unknown[] = [];
    const limiter = createQRunLimiter({
      limits: { runsPerMinute: 10, runsPerDay: 1 },
      runsSince: () => Promise.reject(new Error("db down")),
      onCountFailure: (error) => failures.push(error),
    });
    await limiter.admit(CONTEXT);
    expect(failures).toHaveLength(1);
  });

  it("reads bounded limits from the environment", () => {
    expect(parseQUsageLimits({})).toEqual(DEFAULT_Q_USAGE_LIMITS);
    expect(
      parseQUsageLimits({ CQ_Q_RUNS_PER_MINUTE: "5", CQ_Q_RUNS_PER_DAY: "50" }),
    ).toEqual({ runsPerMinute: 5, runsPerDay: 50 });
    // A typo or zero never removes the bound.
    expect(
      parseQUsageLimits({ CQ_Q_RUNS_PER_MINUTE: "0", CQ_Q_RUNS_PER_DAY: "x" }),
    ).toEqual(DEFAULT_Q_USAGE_LIMITS);
  });
});

describe("POST /v1/q/runs under a limit", () => {
  it("answers 429 problem details with Retry-After and plain words, and creates nothing", async () => {
    const created: unknown[] = [];
    const service = {
      createRun: (command: unknown) => {
        created.push(command);
        return Promise.reject(new Error("not reached"));
      },
    } as unknown as QRuntimeService;
    const { app } = createApp(
      parseQApiConfig({ NODE_ENV: "test" }),
      {
        authenticator: {
          authenticate: () =>
            Promise.resolve({
              authUserId: AuthUserIdSchema.parse(
                "a0000000-0000-4000-8000-000000000001",
              ),
            }),
        },
        resolver: {
          resolveHumanContext: () =>
            Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
        },
      },
      {
        qRuntime: service,
        qRunLimiter: createQRunLimiter({
          limits: { runsPerMinute: 10, runsPerDay: 3 },
          runsSince: () => Promise.resolve(3),
        }),
      },
    );
    const response = await app.inject({
      method: "POST",
      url: "/v1/q/runs",
      headers: { "idempotency-key": "client-key-000001" },
      payload: {
        capability: "ANSWER",
        message: { text: "What changed this week?" },
        modality: "TEXT",
      },
    });
    expect(response.statusCode).toBe(429);
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    expect(response.json()).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      detail:
        "You've reached today's limit for questions to Q. It resets at midnight UTC.",
    });
    expect(created).toHaveLength(0);
    await app.close();
  });
});
