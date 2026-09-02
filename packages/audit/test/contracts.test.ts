import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import { auditActorFromContext } from "../src/actor.js";
import { createAuditEventId } from "../src/contracts/ids.js";
import { MaterialActionAuditInputSchema } from "../src/contracts/material-action.js";
import {
  AUDIT_METADATA_MAX_BYTES,
  AuditMetadataSchema,
  isForbiddenMetadataKey,
} from "../src/contracts/metadata.js";
import { SecurityEventInputSchema } from "../src/contracts/security-event.js";
import {
  PERSISTED_ACTOR_TYPES,
  toPersistedActorType,
} from "../src/contracts/vocabulary.js";
import { AuditActorError } from "../src/errors.js";

const USER_A = randomUUID();
const USER_B = randomUUID();
const TENANT = randomUUID();
const ORG = randomUUID();

function base() {
  return {
    auditEventId: createAuditEventId(),
    tenantId: TENANT,
    actionType: "permission.granted",
    resourceType: "permission",
    resourceId: randomUUID(),
    occurredAt: "2026-09-02T10:00:00Z",
    outcome: "SUCCEEDED",
    correlationId: `cor_${randomUUID()}`,
  } as const;
}

describe("MaterialActionAuditInputSchema", () => {
  it("accepts a direct human action and fills authority with the actor", () => {
    const parsed = MaterialActionAuditInputSchema.parse({
      ...base(),
      actorType: "HUMAN",
      actorId: USER_A,
      organisationId: ORG,
      metadata: { previousRoleId: randomUUID(), newRoleId: randomUUID() },
    });
    expect(parsed.authorityUserId).toBe(USER_A);
    expect(parsed.metadata).toHaveProperty("newRoleId");
  });

  it("rejects a human whose authority is a different person", () => {
    const result = MaterialActionAuditInputSchema.safeParse({
      ...base(),
      actorType: "HUMAN",
      actorId: USER_A,
      authorityUserId: USER_B,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a human action without an actor id", () => {
    expect(
      MaterialActionAuditInputSchema.safeParse({
        ...base(),
        actorType: "HUMAN",
      }).success,
    ).toBe(false);
  });

  it("accepts system and connected-system actions without a human authority", () => {
    expect(
      MaterialActionAuditInputSchema.safeParse({
        ...base(),
        actorType: "SYSTEM",
      }).success,
    ).toBe(true);
    expect(
      MaterialActionAuditInputSchema.safeParse({
        ...base(),
        actorType: "CONNECTED_SYSTEM",
        actorId: randomUUID(),
      }).success,
    ).toBe(true);
  });

  it("requires a human authority for a Q action, and then accepts it", () => {
    const withoutAuthority = MaterialActionAuditInputSchema.safeParse({
      ...base(),
      actorType: "Q",
      actionType: "q.action.executed",
      resourceType: "q_action",
    });
    expect(withoutAuthority.success).toBe(false);

    const withAuthority = MaterialActionAuditInputSchema.parse({
      ...base(),
      actorType: "Q",
      actionType: "q.action.executed",
      resourceType: "q_action",
      authorityUserId: USER_A,
      metadata: { approvalId: randomUUID(), payloadHash: "sha256:0123abcd" },
    });
    expect(withAuthority.authorityUserId).toBe(USER_A);
    expect(withAuthority.actorId).toBeUndefined();
  });

  it.each([
    ["grant_permission", "resource"],
    ["Permission.Granted", "resource"],
    ["permission", "resource"],
    ["permission.granted", "Resource-Type"],
  ])(
    "rejects malformed action %s / resource %s",
    (actionType, resourceType) => {
      expect(
        MaterialActionAuditInputSchema.safeParse({
          ...base(),
          actorType: "SYSTEM",
          actionType,
          resourceType,
        }).success,
      ).toBe(false);
    },
  );

  it("accepts only the three outcomes", () => {
    for (const outcome of ["SUCCEEDED", "FAILED", "DENIED"]) {
      expect(
        MaterialActionAuditInputSchema.safeParse({
          ...base(),
          actorType: "SYSTEM",
          outcome,
        }).success,
      ).toBe(true);
    }
    expect(
      MaterialActionAuditInputSchema.safeParse({
        ...base(),
        actorType: "SYSTEM",
        outcome: "PENDING",
      }).success,
    ).toBe(false);
  });

  it("does not accept unknown fields", () => {
    expect(
      MaterialActionAuditInputSchema.safeParse({
        ...base(),
        actorType: "SYSTEM",
        requestBody: { anything: true },
      }).success,
    ).toBe(false);
  });
});

describe("actor mapping", () => {
  it("maps the four application actor types onto the persisted vocabulary", () => {
    expect(toPersistedActorType("HUMAN")).toBe("human");
    expect(toPersistedActorType("Q")).toBe("q");
    expect(toPersistedActorType("SYSTEM")).toBe("capital_q_system");
    expect(toPersistedActorType("CONNECTED_SYSTEM")).toBe("connected_system");
    expect(PERSISTED_ACTOR_TYPES).toHaveLength(4);
  });

  it("derives human attribution from a trusted ActorContext and refuses other actors", () => {
    const actor = auditActorFromContext(
      ActorContextSchema.parse({
        userId: USER_A,
        tenantId: TENANT,
        organisationId: ORG,
        membershipId: randomUUID(),
        actorType: "HUMAN",
      }),
    );
    expect(actor).toEqual({
      tenantId: TENANT,
      actorType: "HUMAN",
      actorId: USER_A,
      authorityUserId: USER_A,
      organisationId: ORG,
    });
    expect(() =>
      auditActorFromContext(
        ActorContextSchema.parse({
          userId: USER_A,
          tenantId: TENANT,
          actorType: "Q",
        }),
      ),
    ).toThrow(AuditActorError);
  });
});

describe("AuditMetadataSchema", () => {
  it("accepts safe scalar references", () => {
    expect(
      AuditMetadataSchema.safeParse({
        previousRoleId: randomUUID(),
        approvalId: randomUUID(),
        payloadHash: "sha256:abc",
        accessMode: "VIEW_ONLY",
        count: 3,
        forced: false,
        note: null,
        changedFields: ["stage", "description"],
      }).success,
    ).toBe(true);
  });

  it.each([
    "password",
    "accessToken",
    "refresh_token",
    "apiKey",
    "secret",
    "authorization",
    "cookie",
    "privateKey",
    "signedUrl",
    "documentBody",
    "documentText",
    "prompt",
    "fullPrompt",
    "modelPrompt",
    "rawRequest",
    "rawResponse",
    "fileContents",
  ])("refuses the forbidden key %s without echoing its value", (key) => {
    expect(isForbiddenMetadataKey(key)).toBe(true);
    const result = AuditMetadataSchema.safeParse({
      [key]: "super-secret-test-value",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        JSON.stringify(result.error.issues.map((i) => i.message)),
      ).not.toContain("super-secret-test-value");
    }
  });

  it("refuses nested objects, oversized values and too many keys", () => {
    expect(AuditMetadataSchema.safeParse({ nested: { a: 1 } }).success).toBe(
      false,
    );
    expect(
      AuditMetadataSchema.safeParse({ long: "x".repeat(600) }).success,
    ).toBe(false);
    expect(
      AuditMetadataSchema.safeParse(
        Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [`k${String(i)}`, i]),
        ),
      ).success,
    ).toBe(false);
    const big = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        `ref${String(i)}`,
        "y".repeat(500),
      ]),
    );
    expect(Buffer.byteLength(JSON.stringify(big))).toBeGreaterThan(
      AUDIT_METADATA_MAX_BYTES,
    );
    expect(AuditMetadataSchema.safeParse(big).success).toBe(false);
  });
});

describe("SecurityEventInputSchema", () => {
  const event = () => ({
    auditEventId: createAuditEventId(),
    tenantId: TENANT,
    userId: USER_A,
    eventType: "permission_denied",
    severity: "MEDIUM",
    resourceType: "document",
    resourceId: randomUUID(),
    occurredAt: "2026-09-02T10:00:00Z",
    ipHash: "sha256:9f86d081884c7d659a2feaa0c55ad015",
    userAgentHash: "sha256:2c26b46b68ffc68ff99b453c1d304134",
    correlationId: `cor_${randomUUID()}`,
  });

  it("accepts hashed network identifiers and a bounded severity", () => {
    expect(SecurityEventInputSchema.safeParse(event()).success).toBe(true);
    expect(
      SecurityEventInputSchema.safeParse({ ...event(), severity: "PANIC" })
        .success,
    ).toBe(false);
  });

  it("has no raw network fields and fails when they are supplied", () => {
    expect(
      SecurityEventInputSchema.safeParse({ ...event(), rawIp: "203.0.113.7" })
        .success,
    ).toBe(false);
    expect(
      SecurityEventInputSchema.safeParse({
        ...event(),
        userAgent: "Mozilla/5.0",
      }).success,
    ).toBe(false);
    expect(
      SecurityEventInputSchema.safeParse({ ...event(), ip: "203.0.113.7" })
        .success,
    ).toBe(false);
    expect(
      SecurityEventInputSchema.safeParse({ ...event(), ipHash: "203.0.113.7" })
        .success,
    ).toBe(false);
  });

  it("allows tenant-less, user-less events such as a rate limit on an anonymous request", () => {
    const { tenantId: _t, userId: _u, ...anonymous } = event();
    expect(
      SecurityEventInputSchema.safeParse({
        ...anonymous,
        eventType: "rate_limit_triggered",
      }).success,
    ).toBe(true);
  });
});
