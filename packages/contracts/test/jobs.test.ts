import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createJobSchema, JobTypeSchema } from "../src/jobs/envelope.js";
import {
  defineJob,
  deriveIdempotencyKey,
  IdempotencyKeySchema,
  JobRetryPolicySchema,
} from "../src/jobs/definition.js";
import { createJobRegistry } from "../src/jobs/registry.js";
import { MESSAGE_SENSITIVITIES } from "../src/messaging/sensitivity.js";
import { REPLAY_SAFETIES } from "../src/messaging/replay.js";

const JOB_ID = "123e4567-e89b-12d3-a456-426614174000";
const DOCUMENT_ID = "223e4567-e89b-12d3-a456-426614174000";
const TENANT_ID = "323e4567-e89b-12d3-a456-426614174000";

const RETRY_POLICY = {
  maxAttempts: 5,
  visibilityTimeoutSeconds: 300,
  backoff: {
    strategy: "EXPONENTIAL" as const,
    initialDelaySeconds: 5,
    maxDelaySeconds: 600,
    jitter: true,
  },
  retryableErrorCodes: ["PROVIDER_UNAVAILABLE"],
  deadLetter: true,
};

/** Test-only contract, defined in test source and never exported. */
const FixtureProcess = defineJob({
  name: "test.fixture.process",
  version: 1,
  owner: "test",
  handlerOwner: "test-worker",
  sensitivity: "INTERNAL",
  dataSchema: z.object({
    documentId: z.uuid(),
    processingPipelineVersion: z.number().int().min(1),
  }),
  idempotency: {
    describes: "documentId + processingPipelineVersion",
    derive: (data) =>
      `${data.documentId}:${String(data.processingPipelineVersion)}`,
  },
  retryPolicy: RETRY_POLICY,
  description: "Process a test fixture document.",
});

function validJob(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: JOB_ID,
    type: "test.fixture.process",
    jobVersion: 1,
    createdAt: "2026-09-02T13:10:00Z",
    data: { documentId: DOCUMENT_ID, processingPipelineVersion: 3 },
    ...overrides,
  };
}

const Schema = createJobSchema(FixtureProcess.dataSchema);

describe("job envelope", () => {
  it("accepts a canonical job", () => {
    expect(Schema.safeParse(validJob()).success).toBe(true);
  });

  it("requires a UUID job id and a UTC createdAt", () => {
    expect(Schema.safeParse(validJob({ id: "nope" })).success).toBe(false);
    expect(
      Schema.safeParse(validJob({ createdAt: "2026-09-02T13:10:00+01:00" }))
        .success,
    ).toBe(false);
  });

  it("requires a positive job version", () => {
    expect(Schema.safeParse(validJob({ jobVersion: 0 })).success).toBe(false);
  });

  it("validates attempt as a positive integer when present", () => {
    expect(Schema.safeParse(validJob({ attempt: 1 })).success).toBe(true);
    expect(Schema.safeParse(validJob({ attempt: 0 })).success).toBe(false);
    expect(Schema.safeParse(validJob({ attempt: -1 })).success).toBe(false);
    expect(Schema.safeParse(validJob({ attempt: "2" })).success).toBe(false);
  });

  it("carries tenant, correlation and causation context", () => {
    expect(
      Schema.safeParse(
        validJob({
          tenantId: TENANT_ID,
          correlationId: "cor_123e4567-e89b-12d3-a456-426614174000",
          causationId: "cau_123e4567-e89b-12d3-a456-426614174000",
        }),
      ).success,
    ).toBe(true);
  });

  it("validates the payload rather than accepting any object", () => {
    expect(Schema.safeParse(validJob({ data: {} })).success).toBe(false);
    expect(
      Schema.safeParse(validJob({ data: { documentId: "nope" } })).success,
    ).toBe(false);
  });

  it("carries no idempotencyKey on the wire envelope", () => {
    // Document 22 does not define one; each definition derives its own instead.
    const parsed = Schema.parse(
      validJob({ idempotencyKey: "smuggled" }),
    ) as Record<string, unknown>;

    expect(parsed).not.toHaveProperty("idempotencyKey");
  });
});

describe("job type naming", () => {
  it.each([
    "evidence.document.process",
    "knowledge.subject.reassess",
    "recommendation.slate.rebuild",
    "notification.delivery.send",
    "integration.connection.sync",
  ])("accepts the architecture example %s", (name) => {
    expect(JobTypeSchema.safeParse(name).success).toBe(true);
  });

  it.each(["ProcessDocument", "PROCESS_DOCUMENT", "process-document", "a.b"])(
    "rejects the malformed name %s",
    (name) => {
      expect(JobTypeSchema.safeParse(name).success).toBe(false);
    },
  );
});

describe("job registry", () => {
  const registry = createJobRegistry([FixtureProcess]);

  it("looks a definition up and exposes its metadata", () => {
    const definition = registry.get("test.fixture.process", 1);

    expect(definition?.owner).toBe("test");
    expect(definition?.handlerOwner).toBe("test-worker");
    expect(definition?.sensitivity).toBe("INTERNAL");
    expect(definition?.idempotency.describes).toBe(
      "documentId + processingPipelineVersion",
    );
    expect(definition?.retryPolicy.maxAttempts).toBe(5);
  });

  it("rejects duplicate registration", () => {
    expect(() => createJobRegistry([FixtureProcess, FixtureProcess])).toThrow(
      /Duplicate job definition/,
    );
  });

  it("distinguishes unknown type from unsupported version", () => {
    const unknownType = registry.parse(
      validJob({ type: "evidence.document.process" }),
    );
    const unknownVersion = registry.parse(validJob({ jobVersion: 9 }));

    if (!unknownType.ok) expect(unknownType.rejection).toBe("UNKNOWN_TYPE");
    if (!unknownVersion.ok)
      expect(unknownVersion.rejection).toBe("UNSUPPORTED_VERSION");
  });

  it("recovers the payload type through parseAs", () => {
    const result = registry.parseAs(FixtureProcess, validJob());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.data.processingPipelineVersion).toBe(3);
    }
  });

  it("never puts the payload in a rejection", () => {
    const result = registry.parse(
      validJob({
        data: {
          documentId: "super-secret-test-value",
          processingPipelineVersion: 1,
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("super-secret-test-value");
  });
});

describe("idempotency", () => {
  it("derives the same key for the same work identity", () => {
    const data = { documentId: DOCUMENT_ID, processingPipelineVersion: 3 };

    expect(deriveIdempotencyKey(FixtureProcess, data)).toBe(
      deriveIdempotencyKey(FixtureProcess, { ...data }),
    );
  });

  it("derives a different key for genuinely different work", () => {
    const first = deriveIdempotencyKey(FixtureProcess, {
      documentId: DOCUMENT_ID,
      processingPipelineVersion: 3,
    });
    const second = deriveIdempotencyKey(FixtureProcess, {
      documentId: DOCUMENT_ID,
      processingPipelineVersion: 4,
    });

    // A pipeline version change is different work, not a duplicate.
    expect(first).not.toBe(second);
  });

  it("rejects a key carrying unbounded or unsafe content", () => {
    // Keys reach queue storage and logs, so they must not smuggle payload text.
    expect(IdempotencyKeySchema.safeParse("a".repeat(201)).success).toBe(false);
    expect(
      IdempotencyKeySchema.safeParse("private note: we are running out of cash")
        .success,
    ).toBe(false);
    expect(IdempotencyKeySchema.safeParse("").success).toBe(false);
  });

  it("lets each job declare its own strategy rather than one global formula", () => {
    const other = defineJob({
      ...FixtureProcess,
      name: "test.other.rebuild",
      idempotency: {
        describes: "documentId only",
        derive: (data) => data.documentId,
      },
    });

    const data = { documentId: DOCUMENT_ID, processingPipelineVersion: 3 };
    expect(deriveIdempotencyKey(other, data)).not.toBe(
      deriveIdempotencyKey(FixtureProcess, data),
    );
  });
});

describe("retry policy metadata", () => {
  it("accepts a well-formed policy", () => {
    expect(JobRetryPolicySchema.safeParse(RETRY_POLICY).success).toBe(true);
  });

  it("requires at least one attempt and a positive visibility timeout", () => {
    expect(
      JobRetryPolicySchema.safeParse({ ...RETRY_POLICY, maxAttempts: 0 })
        .success,
    ).toBe(false);
    expect(
      JobRetryPolicySchema.safeParse({
        ...RETRY_POLICY,
        visibilityTimeoutSeconds: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects a negative delay and an unknown backoff strategy", () => {
    expect(
      JobRetryPolicySchema.safeParse({
        ...RETRY_POLICY,
        backoff: { ...RETRY_POLICY.backoff, initialDelaySeconds: -1 },
      }).success,
    ).toBe(false);
    expect(
      JobRetryPolicySchema.safeParse({
        ...RETRY_POLICY,
        backoff: { ...RETRY_POLICY.backoff, strategy: "RANDOM" },
      }).success,
    ).toBe(false);
  });

  it("allows a job that is never retried automatically", () => {
    expect(
      JobRetryPolicySchema.safeParse({
        ...RETRY_POLICY,
        maxAttempts: 1,
        retryableErrorCodes: [],
        deadLetter: false,
      }).success,
    ).toBe(true);
  });
});

describe("shared message metadata", () => {
  it("uses the canonical security sensitivity classes", () => {
    expect([...MESSAGE_SENSITIVITIES]).toEqual([
      "PUBLIC",
      "NETWORK_VISIBLE",
      "INTERNAL",
      "CONFIDENTIAL",
      "HIGHLY_CONFIDENTIAL",
      "RESTRICTED",
    ]);
  });

  it("uses explicit replay classes rather than a boolean", () => {
    expect([...REPLAY_SAFETIES]).toEqual(["REPLAY_SAFE", "SIDE_EFFECTING"]);
  });
});
