import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  createPlatformAdmin,
  type OwnReview,
  type PlatformAdmin,
} from "@capital-q/platform-admin";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";
import type { KybService, KybView } from "@capital-q/verification";

import { createApp } from "../src/app.js";

/**
 * ADMIN-3 routes: the person's own review requests and their
 * organisation's KYB, with the actor taken only from the resolved context;
 * and the console's verification decision closing the KYB submission.
 */

const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const CLAIM = "f0000000-0000-4000-8000-0000000000c1";
const KEY = { "idempotency-key": "key-0000-0001" };

const REVIEW: OwnReview = {
  reviewId: "f0000000-0000-4000-8000-0000000000a1",
  subjectType: "VERIFICATION_DECISION",
  subjectRef: "verification_claim:abc",
  reason: "The registry has our company under its old name.",
  source: "APP",
  status: "OPEN",
  outcome: null,
  decisionReason: null,
  dueAt: "2026-10-04T10:00:00.000Z",
  decidedAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
};

const VIEW: KybView = {
  standing: "PENDING",
  submission: null,
  organisationName: "Nixo",
  organisationKind: "COMPANY",
  person: { standing: "PENDING", declineReason: null, submission: null },
};

function security() {
  return {
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
        Promise.resolve({
          status: "RESOLVED" as const,
          context: {
            userId: USER,
            tenantId: TENANT,
            organisationId: ORG,
            membershipId: MembershipIdSchema.parse(
              "e0000000-0000-4000-8000-000000000001",
            ),
            actorType: "HUMAN" as const,
          },
        }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
}

function build(options: {
  readonly review?: Awaited<ReturnType<PlatformAdmin["requestReview"]>>;
  readonly kyb?: Awaited<ReturnType<KybService["submit"]>>;
}) {
  const asked: unknown[] = [];
  const sql = Object.assign(() => Promise.resolve([]), {
    json: (value: unknown) => value,
  }) as never;
  const admin: PlatformAdmin = {
    ...createPlatformAdmin({
      sql,
      transactions: { run: (work) => work({ sql }) },
    }),
    requestReview: (requester, input) => {
      asked.push({ requester, input });
      return Promise.resolve(
        options.review ?? { kind: "CREATED", review: REVIEW },
      );
    },
    ownReviews: () => Promise.resolve([REVIEW]),
  };
  const kyb: KybService = {
    current: () => Promise.resolve(VIEW),
    submit: (command) => {
      asked.push(command);
      return Promise.resolve(options.kyb ?? { kind: "SUBMITTED", view: VIEW });
    },
  };
  const app = createApp(parseApiConfig({ NODE_ENV: "test" }), security(), {
    admin,
    kyb,
  }).app;
  return { app, asked };
}

describe("POST /v1/reviews", () => {
  it("records the person's own request, taking who they are from the session", async () => {
    const { app, asked } = build({});
    const response = await app.inject({
      method: "POST",
      url: "/v1/reviews",
      headers: KEY,
      payload: {
        subjectType: "VERIFICATION_DECISION",
        subjectRef: "verification_claim:abc",
        reason: "The registry has our company under its old name.",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(asked[0]).toMatchObject({
      requester: { tenantId: TENANT, userId: USER, organisationId: ORG },
      input: {
        idempotencyKey: "key-0000-0001",
        subjectType: "VERIFICATION_DECISION",
      },
    });
    await app.close();
  });

  it("needs an Idempotency-Key, a reason, and refuses a smuggled requester", async () => {
    const { app } = build({});
    const noKey = await app.inject({
      method: "POST",
      url: "/v1/reviews",
      payload: { subjectType: "OTHER", reason: "Please look at this again" },
    });
    expect(noKey.statusCode).toBeGreaterThanOrEqual(400);
    expect(noKey.statusCode).toBeLessThan(500);
    const short = await app.inject({
      method: "POST",
      url: "/v1/reviews",
      headers: KEY,
      payload: { subjectType: "OTHER", reason: "why" },
    });
    expect(short.statusCode).toBe(422);
    const smuggled = await app.inject({
      method: "POST",
      url: "/v1/reviews",
      headers: KEY,
      payload: {
        subjectType: "OTHER",
        reason: "Please look at this again",
        userId: USER,
      },
    });
    expect(smuggled.statusCode).toBe(422);
    await app.close();
  });

  it("answers a replay with 200 and a full queue with 409", async () => {
    const replay = build({ review: { kind: "REPLAYED", review: REVIEW } });
    const again = await replay.app.inject({
      method: "POST",
      url: "/v1/reviews",
      headers: KEY,
      payload: { subjectType: "OTHER", reason: "Please look at this again" },
    });
    expect(again.statusCode).toBe(200);
    await replay.app.close();
    const full = build({ review: { kind: "TOO_MANY_OPEN" } });
    const refused = await full.app.inject({
      method: "POST",
      url: "/v1/reviews",
      headers: KEY,
      payload: { subjectType: "OTHER", reason: "Please look at this again" },
    });
    expect(refused.statusCode).toBe(409);
    await full.app.close();
  });

  it("lists the person's own cases", async () => {
    const { app } = build({});
    const response = await app.inject({ method: "GET", url: "/v1/reviews" });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ rows: unknown[] }>().rows).toHaveLength(1);
    await app.close();
  });
});

describe("POST /v1/kyb", () => {
  const organisation = {
    legalName: "Nixo Technologies Ltd",
    registrationNumber: "RC 1234567",
    jurisdictionCode: "NG",
    documentId: "f0000000-0000-4000-8000-0000000000d1",
  };
  // ADMIN-4: one flow, the person and the organisation together.
  const details = {
    organisation,
    person: { nameOnId: "Ada Example", role: "Founder" },
  };

  it("submits for the actor's own organisation", async () => {
    const { app, asked } = build({});
    const response = await app.inject({
      method: "POST",
      url: "/v1/kyb",
      headers: KEY,
      payload: details,
    });
    expect(response.statusCode).toBe(201);
    expect(asked[0]).toMatchObject({
      actor: { organisationId: ORG },
      organisation: {
        legalName: "Nixo Technologies Ltd",
        documentId: organisation.documentId,
      },
      person: { nameOnId: "Ada Example", role: "Founder", documentId: null },
    });
    await app.close();
  });

  it("refuses bad details, a foreign document and a second open submission", async () => {
    const bad = build({});
    const lower = await bad.app.inject({
      method: "POST",
      url: "/v1/kyb",
      headers: KEY,
      payload: {
        ...details,
        organisation: { ...organisation, jurisdictionCode: "ng" },
      },
    });
    expect(lower.statusCode).toBe(422);
    const nothing = await bad.app.inject({
      method: "POST",
      url: "/v1/kyb",
      headers: KEY,
      payload: { organisation: null, person: null },
    });
    expect(nothing.statusCode).toBe(422);
    await bad.app.close();
    for (const [outcome, status] of [
      [{ kind: "DOCUMENT_NOT_FOUND", part: "PERSON" }, 422],
      [{ kind: "ALREADY_OPEN", part: "ORGANISATION" }, 409],
      [{ kind: "ALREADY_VERIFIED", part: "PERSON" }, 409],
      [{ kind: "NO_ORGANISATION" }, 403],
    ] as const) {
      const kind = outcome.kind;
      const { app } = build({ kyb: outcome });
      const response = await app.inject({
        method: "POST",
        url: "/v1/kyb",
        headers: KEY,
        payload: details,
      });
      expect(response.statusCode, kind).toBe(status);
      await app.close();
    }
  });
});

describe("the console's verification decision", () => {
  it("closes the KYB submission behind the decided claim", async () => {
    const closed: unknown[] = [];
    const sql = Object.assign(
      (strings: TemplateStringsArray) => {
        const text = strings.join("?");
        if (text.includes("from identity.platform_admins")) {
          return Promise.resolve([{ role: "platform_owner" }]);
        }
        if (text.includes("from platform_ops.step_ups")) {
          return Promise.resolve([
            { id: CLAIM, expires_at: new Date(Date.now() + 60_000) },
          ]);
        }
        if (
          text.includes("select tenant_id from evidence.verification_claims")
        ) {
          return Promise.resolve([{ tenant_id: TENANT }]);
        }
        return Promise.resolve([]);
      },
      { json: (value: unknown) => value },
    ) as never;
    const app = createApp(parseApiConfig({ NODE_ENV: "test" }), security(), {
      admin: createPlatformAdmin({
        sql,
        transactions: { run: (work) => work({ sql }) },
      }),
      adminVerificationDecider: () =>
        Promise.resolve({ kind: "DECIDED", status: "REVOKED" }),
      adminCloseKyb: (input) => {
        closed.push(input);
        return Promise.resolve(true);
      },
    }).app;
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/verification/claims/${CLAIM}/decision`,
      payload: {
        status: "REVOKED",
        decisionBasis: "Registry shows a different company",
        revocationReason: "No matching registration",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(closed).toEqual([
      {
        claimId: CLAIM,
        approved: false,
        reason: "No matching registration",
        decidedByUserId: USER,
      },
    ]);
    await app.close();
  });
});
