import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createEventRegistry, createJobSchema } from "@capital-q/contracts";
import {
  RECOMMENDATION_REFRESH_QUEUE,
  RefreshRecommendationSlateJob,
  type BuildSlateResult,
  type RecommendationSlate,
  type RefreshQueue,
  type RefreshRequest,
  type RefreshRequestStore,
  type SlateBuilder,
  type SlateKey,
} from "@capital-q/discovery";
import { INVESTOR_EVENTS } from "@capital-q/investors/events";
import type { ActorContext } from "@capital-q/security";

import { createDomainEventHandler } from "../src/events/document-processing-handler.js";
import type { QueueClient, QueueMessage } from "../src/queue/pgmq.js";
import type { BuildPrincipalResolver } from "../src/recommendations/build-principal.js";
import { createRecommendationRefreshHandler } from "../src/recommendations/refresh-handler.js";
import { createRecordingLogger, TENANT_A } from "./support/fakes.js";

/**
 * The refresh consumer (CQ-REC-006 Checkpoint C): a message is a key and a
 * sequence, never the work. The claim row decides whether anything runs,
 * a build acts as the investor organisation's member, outcomes map to
 * bounded queue decisions, and a request that lands mid-build gets one
 * more message. The domain-event consumer offers every event to the
 * slate invalidation and keeps its own behaviour.
 */

const INVESTOR = "11111111-0000-4000-8000-000000000013";
const MANDATE = "33333333-0000-4000-8000-000000000031";
const KEY: SlateKey = {
  tenantId: TENANT_A,
  investorOrganisationId: INVESTOR,
  mandateId: MANDATE,
  mode: "INVESTOR_DISCOVER",
};
const ACTOR: ActorContext = {
  userId: "11111111-0000-4000-8000-000000000003",
  tenantId: TENANT_A,
  organisationId: "11111111-0000-4000-8000-000000000002",
  membershipId: "11111111-0000-4000-8000-000000000004",
  actorType: "HUMAN",
};

const JobSchema = createJobSchema(RefreshRecommendationSlateJob.dataSchema);

function jobMessage(
  overrides: Record<string, unknown> = {},
  data: Record<string, unknown> = {},
): QueueMessage {
  return {
    msgId: 7,
    readCount: 1,
    enqueuedAt: new Date().toISOString(),
    message: {
      id: randomUUID(),
      type: RefreshRecommendationSlateJob.name,
      jobVersion: RefreshRecommendationSlateJob.version,
      tenantId: TENANT_A,
      createdAt: new Date().toISOString(),
      data: {
        investorOrganisationId: INVESTOR,
        mandateId: MANDATE,
        mode: "INVESTOR_DISCOVER",
        reason: "MANDATE_ACTIVATED",
        priority: "NORMAL",
        requestSequence: 1,
        ...data,
      },
      ...overrides,
    },
  };
}

function memoryRequests(initial?: Partial<RefreshRequest>) {
  let row: RefreshRequest | null =
    initial === undefined
      ? null
      : {
          id: randomUUID(),
          tenantId: TENANT_A,
          investorOrganisationId: INVESTOR,
          mandateId: MANDATE,
          mode: "INVESTOR_DISCOVER",
          status: "PENDING",
          priority: "NORMAL",
          reason: "MANDATE_ACTIVATED",
          requestSequence: 1,
          claimedSequence: null,
          attempts: 0,
          ...initial,
        };
  const released: { outcome: string; code: string }[] = [];
  const store: RefreshRequestStore = {
    requestRefresh: () => Promise.reject(new Error("not used here")),
    claim: () => {
      if (row === null || row.status !== "PENDING")
        return Promise.resolve(null);
      row = {
        ...row,
        status: "CLAIMED",
        claimedSequence: row.requestSequence,
        attempts: row.attempts + 1,
      };
      return Promise.resolve(row);
    },
    complete: () => {
      if (row === null || row.status !== "CLAIMED") {
        return Promise.resolve({ reopened: false });
      }
      const reopened = row.requestSequence > (row.claimedSequence ?? 0);
      row = {
        ...row,
        status: reopened ? "PENDING" : "DONE",
        claimedSequence: null,
      };
      return Promise.resolve({ reopened });
    },
    release: (_id, outcome, code) => {
      released.push({ outcome, code });
      if (row !== null) {
        row = { ...row, status: outcome === "RETRY" ? "PENDING" : "FAILED" };
      }
      return Promise.resolve();
    },
    findByKey: () => Promise.resolve(row),
  };
  return {
    store,
    released,
    get row() {
      return row;
    },
    /** A change that arrives while the build runs. */
    bump: () => {
      if (row !== null) {
        row = {
          ...row,
          requestSequence: row.requestSequence + 1,
          reason: "COMPANY_UPDATED",
          priority: "HIGH",
        };
      }
    },
  };
}

function collectingQueue(): RefreshQueue & {
  readonly sent: { queue: string; message: unknown }[];
} {
  const sent: { queue: string; message: unknown }[] = [];
  return {
    sent,
    send: (queue, message) => {
      sent.push({ queue, message });
      return Promise.resolve(sent.length);
    },
  };
}

const principals = (actor: ActorContext | null): BuildPrincipalResolver => ({
  resolve: () => Promise.resolve(actor),
});

const slate = { id: randomUUID(), status: "CURRENT" } as RecommendationSlate;

function builder(
  outcome: BuildSlateResult | Error,
  onBuild?: () => void,
): SlateBuilder & { readonly calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    build: (query) => {
      calls.push(query);
      onBuild?.();
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome);
    },
  };
}

describe("recommendation refresh consumer", () => {
  it("claims the request, builds as the investor's member, completes: DONE", async () => {
    const requests = memoryRequests({});
    const queue = collectingQueue();
    const b = builder({
      kind: "PUBLISHED",
      slate,
      supersededSlateId: null,
      fingerprint: "a".repeat(64),
      diagnostics: {
        structuredCandidates: 1,
        semanticCandidates: 0,
        semanticUnavailable: false,
        mergedCandidates: 1,
        featureSnapshots: 1,
        ranked: 1,
        scored: 1,
        buildDurationMs: 1,
      },
    });
    const handle = createRecommendationRefreshHandler({
      builder: b,
      requests: requests.store,
      principals: principals(ACTOR),
      queue,
      logger: createRecordingLogger(),
    });
    expect(await handle(jobMessage())).toEqual({ kind: "DONE" });
    expect(b.calls).toEqual([
      { actor: ACTOR, mode: "INVESTOR_DISCOVER", mandateId: MANDATE },
    ]);
    expect(requests.row?.status).toBe("DONE");
    expect(requests.row?.attempts).toBe(1);
    expect(queue.sent).toHaveLength(0);
  });

  it("nothing pending is DONE without a build: a coalesced or duplicate delivery does no work", async () => {
    const requests = memoryRequests({ status: "DONE" });
    const b = builder({ kind: "NO_ACTIVE_MANDATE" });
    const handle = createRecommendationRefreshHandler({
      builder: b,
      requests: requests.store,
      principals: principals(ACTOR),
      queue: collectingQueue(),
      logger: createRecordingLogger(),
    });
    expect(await handle(jobMessage())).toEqual({ kind: "DONE" });
    expect(b.calls).toHaveLength(0);
    const none = memoryRequests();
    expect(
      await createRecommendationRefreshHandler({
        builder: b,
        requests: none.store,
        principals: principals(ACTOR),
        queue: collectingQueue(),
        logger: createRecordingLogger(),
      })(jobMessage()),
    ).toEqual({ kind: "DONE" });
    expect(b.calls).toHaveLength(0);
  });

  it("a request that lands mid-build reopens the row and gets exactly one more message with the latest sequence", async () => {
    const requests = memoryRequests({});
    const queue = collectingQueue();
    const b = builder(
      { kind: "UNCHANGED", slate, fingerprint: "a".repeat(64) },
      () => requests.bump(),
    );
    const handle = createRecommendationRefreshHandler({
      builder: b,
      requests: requests.store,
      principals: principals(ACTOR),
      queue,
      logger: createRecordingLogger(),
    });
    expect(await handle(jobMessage())).toEqual({ kind: "DONE" });
    expect(requests.row?.status).toBe("PENDING");
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0]?.queue).toBe(RECOMMENDATION_REFRESH_QUEUE);
    const job = JobSchema.parse(queue.sent[0]?.message);
    expect(job.tenantId).toBe(TENANT_A);
    expect(job.data).toEqual({
      investorOrganisationId: INVESTOR,
      mandateId: MANDATE,
      mode: "INVESTOR_DISCOVER",
      reason: "COMPANY_UPDATED",
      priority: "HIGH",
      requestSequence: 2,
    });
    expect(job.causationId).toMatch(/^cau_/);
  });

  it("maps outcomes to bounded queue decisions: in progress retries, a refusal dead-letters, a store race retries, no member dead-letters", async () => {
    const run = async (
      outcome: BuildSlateResult | Error,
      actor: ActorContext | null = ACTOR,
    ) => {
      const requests = memoryRequests({});
      const result = await createRecommendationRefreshHandler({
        builder: builder(outcome),
        requests: requests.store,
        principals: principals(actor),
        queue: collectingQueue(),
        logger: createRecordingLogger(),
      })(jobMessage());
      return { result, requests };
    };
    const busy = await run({ kind: "BUILD_IN_PROGRESS", key: KEY });
    expect(busy.result).toEqual({
      kind: "RETRY",
      errorCode: "BUILD_IN_PROGRESS",
    });
    expect(busy.requests.row?.status).toBe("PENDING");

    const refused = await run({
      kind: "FAILED",
      slateId: randomUUID(),
      failureCode: "RANKER_REFUSED",
    });
    expect(refused.result).toEqual({
      kind: "PERMANENT",
      errorCode: "RANKER_REFUSED",
    });
    expect(refused.requests.row?.status).toBe("FAILED");
    expect(refused.requests.released).toEqual([
      { outcome: "FAILED", code: "RANKER_REFUSED" },
    ]);

    const race = await run({
      kind: "FAILED",
      slateId: randomUUID(),
      failureCode: "FINGERPRINT_MISMATCH",
    });
    expect(race.result).toEqual({
      kind: "RETRY",
      errorCode: "FINGERPRINT_MISMATCH",
    });
    expect(race.requests.row?.status).toBe("PENDING");

    const thrown = await run(new Error("connection reset"));
    expect(thrown.result).toEqual({ kind: "RETRY", errorCode: "BUILD_ERROR" });

    const orphan = await run({ kind: "NO_ACTIVE_MANDATE" }, null);
    expect(orphan.result).toEqual({
      kind: "PERMANENT",
      errorCode: "NO_BUILD_PRINCIPAL",
    });
    expect(orphan.requests.released).toEqual([
      { outcome: "FAILED", code: "NO_BUILD_PRINCIPAL" },
    ]);
  });

  it("a message this build cannot validate, or without a tenant, is dead-lettered without a claim", async () => {
    const requests = memoryRequests({});
    const b = builder({ kind: "NO_ACTIVE_MANDATE" });
    const handle = createRecommendationRefreshHandler({
      builder: b,
      requests: requests.store,
      principals: principals(ACTOR),
      queue: collectingQueue(),
      logger: createRecordingLogger(),
    });
    expect(await handle(jobMessage({}, { mode: "GATEQ" }))).toEqual({
      kind: "PERMANENT",
      errorCode: "INVALID_JOB",
    });
    expect(await handle(jobMessage({ tenantId: undefined }))).toEqual({
      kind: "PERMANENT",
      errorCode: "INVALID_JOB",
    });
    expect(
      await handle(jobMessage({ type: "evidence.document.process" })),
    ).toEqual({
      kind: "PERMANENT",
      errorCode: "UNKNOWN_JOB",
    });
    expect(requests.row?.status).toBe("PENDING");
    expect(b.calls).toHaveLength(0);
  });
});

describe("domain events reach the slate invalidation", () => {
  const registry = createEventRegistry([...INVESTOR_EVENTS]);
  const client: QueueClient = {
    send: () => Promise.resolve(1),
    read: () => Promise.resolve([]),
    remove: () => Promise.resolve(),
    archive: () => Promise.resolve(),
    delayVisibility: () => Promise.resolve(),
  };
  const activated = (): QueueMessage => ({
    msgId: 9,
    readCount: 1,
    enqueuedAt: new Date().toISOString(),
    message: {
      specVersion: "1.0",
      id: randomUUID(),
      type: "core.investor_mandate.activated",
      source: "capitalq://api/investors",
      time: new Date().toISOString(),
      subject: `investor_mandate/${MANDATE}`,
      dataContentType: "application/json",
      eventVersion: 1,
      tenantId: TENANT_A,
      organisationId: randomUUID(),
      correlationId: `cor_${randomUUID()}`,
      aggregate: { type: "investor_mandate", id: MANDATE, version: 2 },
      data: {
        investorMandateId: MANDATE,
        investorOrganisationId: INVESTOR,
        version: 2,
        effectiveFrom: new Date().toISOString(),
      },
    },
  });

  it("offers every validated event to the invalidation and archives it as before", async () => {
    const seen: string[] = [];
    const handle = createDomainEventHandler({
      registry,
      queues: client,
      pipelineVersion: "evidence-processing-v1",
      recommendations: {
        onEvent: (event) => {
          seen.push(event.type);
          return Promise.resolve({ invalidated: 0, enqueued: 1 });
        },
      },
      logger: createRecordingLogger(),
    });
    expect(await handle(activated())).toEqual({ kind: "ARCHIVE" });
    expect(seen).toEqual(["core.investor_mandate.activated"]);
  });

  it("a failed invalidation retries the message rather than losing the event", async () => {
    const logger = createRecordingLogger();
    const handle = createDomainEventHandler({
      registry,
      queues: client,
      pipelineVersion: "evidence-processing-v1",
      recommendations: {
        onEvent: () => Promise.reject(new Error("connection reset")),
      },
      logger,
    });
    expect(await handle(activated())).toEqual({
      kind: "RETRY",
      errorCode: "RECOMMENDATION_REFRESH_FAILED",
    });
    expect(logger.lines.some((l) => l.level === "warn")).toBe(true);
  });
});
