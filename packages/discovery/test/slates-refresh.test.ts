import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CompanyMarketplaceReadinessChangedEvent,
  CompanyUpdatedEvent,
  CompanyVisibilityChangedEvent,
} from "@capital-q/companies/events";
import type { CapitalQEvent } from "@capital-q/contracts";
import { INVESTOR_EVENTS } from "@capital-q/investors/events";
import { RelationshipCreatedEvent } from "@capital-q/network/events";
import {
  DisclosureGrantedEvent,
  DisclosureRevokedEvent,
} from "@capital-q/permissions/events";
import { EntityAssignmentsChangedEvent } from "@capital-q/taxonomy/events";

import { FEATURE_SCHEMA_VERSION } from "../src/features/contracts.js";
import {
  RECOMMENDATION_REFRESH_QUEUE,
  RefreshRecommendationSlateJob,
} from "../src/jobs/index.js";
import { RANKER_VERSION } from "../src/ranking/contracts.js";
import type { RefreshRequestStore, SlateKey } from "../src/slates/ports.js";
import {
  createRefreshRequester,
  createSlateInvalidationService,
  REFRESH_TRIGGER_EVENTS,
  refreshDirectiveFor,
  type RefreshQueue,
} from "../src/slates/refresh.js";
import { memorySlates } from "./support/memory-slates.js";

/**
 * Refresh and invalidation over fakes (CQ-REC-006 Checkpoint C): every
 * trigger name is a real event definition, each event maps to the right
 * scope, urgency and invalidation reason, a request coalesces per key and
 * sends one bounded message, and invalidation touches lifecycle only.
 */

const TENANT = "11111111-0000-4000-8000-000000000001";
const INVESTOR = "11111111-0000-4000-8000-000000000013";
const MANDATE = "33333333-0000-4000-8000-000000000031";
const COMPANY = "44444444-0000-4000-8000-000000000001";
const OTHER_COMPANY = "44444444-0000-4000-8000-000000000002";
const KEY: SlateKey = {
  tenantId: TENANT,
  investorOrganisationId: INVESTOR,
  mandateId: MANDATE,
  mode: "INVESTOR_DISCOVER",
};

/** `tenantId: null` builds an event that carries no tenant. */
function event(
  type: string,
  data: unknown,
  tenantId: string | null = TENANT,
): CapitalQEvent<unknown> {
  return {
    specVersion: "1.0",
    id: randomUUID(),
    type,
    source: "capitalq://api/test",
    time: "2026-09-19T10:00:00.000Z",
    subject: "test",
    dataContentType: "application/json",
    eventVersion: 1,
    ...(tenantId === null ? {} : { tenantId }),
    data,
  } as CapitalQEvent<unknown>;
}

const mandateData = (changeKinds?: readonly string[]) => ({
  investorMandateId: MANDATE,
  investorOrganisationId: INVESTOR,
  version: 2,
  ...(changeKinds === undefined ? {} : { changedFields: ["x"], changeKinds }),
});

describe("refresh directives (CQ-REC-006)", () => {
  it("every trigger is a registered event name", () => {
    const names = new Set([
      ...INVESTOR_EVENTS.map((e) => e.name),
      CompanyUpdatedEvent.name,
      CompanyVisibilityChangedEvent.name,
      CompanyMarketplaceReadinessChangedEvent.name,
      EntityAssignmentsChangedEvent.name,
      DisclosureGrantedEvent.name,
      DisclosureRevokedEvent.name,
      RelationshipCreatedEvent.name,
    ]);
    for (const trigger of Object.values(REFRESH_TRIGGER_EVENTS)) {
      expect(names.has(trigger), trigger).toBe(true);
    }
  });

  it("mandate events: activation is HIGH, a hard change invalidates, a preference change is NORMAL, closing invalidates without a rebuild", () => {
    expect(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.MANDATE_ACTIVATED, mandateData()),
      ),
    ).toEqual({
      kind: "MANDATE",
      key: KEY,
      invalidate: null,
      refresh: true,
      reason: "MANDATE_ACTIVATED",
      priority: "HIGH",
    });
    expect(
      refreshDirectiveFor(
        event(
          REFRESH_TRIGGER_EVENTS.MANDATE_UPDATED,
          mandateData(["PREFERENCE", "HARD_EXCLUSION"]),
        ),
      ),
    ).toMatchObject({
      kind: "MANDATE",
      invalidate: "MANDATE_HARD_CHANGED",
      reason: "MANDATE_HARD_CHANGED",
      priority: "HIGH",
    });
    expect(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.MANDATE_UPDATED, mandateData(["NAME"])),
      ),
    ).toMatchObject({
      kind: "MANDATE",
      invalidate: null,
      reason: "MANDATE_UPDATED",
      priority: "NORMAL",
    });
    expect(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.MANDATE_CLOSED, mandateData()),
      ),
    ).toMatchObject({
      kind: "MANDATE",
      invalidate: "MANDATE_CLOSED",
      refresh: false,
      priority: "HIGH",
    });
    // A mandate event without its tenant names nothing.
    expect(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.MANDATE_ACTIVATED, mandateData(), null),
      ).kind,
    ).toBe("IGNORED");
  });

  it("company events: withdrawal invalidates the slates that serve it; becoming discoverable fans out to every slate", () => {
    expect(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.COMPANY_VISIBILITY_CHANGED, {
          companyId: COMPANY,
          version: 3,
          visibility: "organisation_private",
        }),
      ),
    ).toEqual({
      kind: "COMPANY",
      companyId: COMPANY,
      scope: "CONTAINING",
      invalidate: "VISIBILITY_CHANGED",
      reason: "COMPANY_VISIBILITY_CHANGED",
      priority: "HIGH",
    });
    expect(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.COMPANY_VISIBILITY_CHANGED, {
          companyId: COMPANY,
          version: 3,
          visibility: "network_visible",
        }),
      ),
    ).toMatchObject({ scope: "ALL", invalidate: null, priority: "NORMAL" });
    expect(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.COMPANY_READINESS_CHANGED, {
          companyId: COMPANY,
          version: 3,
          readinessState: "requirements_outstanding",
          policyVersion: "marketplace-readiness.v1",
        }),
      ),
    ).toMatchObject({
      scope: "CONTAINING",
      invalidate: "MARKETPLACE_DISABLED",
      priority: "HIGH",
    });
    expect(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.COMPANY_READINESS_CHANGED, {
          companyId: COMPANY,
          version: 3,
          readinessState: "marketplace_ready",
          policyVersion: "marketplace-readiness.v1",
        }),
      ),
    ).toMatchObject({ scope: "ALL", invalidate: null, priority: "NORMAL" });
    expect(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.COMPANY_UPDATED, {
          companyId: COMPANY,
          version: 3,
          changedFields: ["short_description"],
        }),
      ),
    ).toMatchObject({
      scope: "CONTAINING",
      invalidate: null,
      reason: "COMPANY_UPDATED",
      priority: "NORMAL",
    });
    expect(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.TAXONOMY_ASSIGNMENTS_CHANGED, {
          subjectType: "COMPANY",
          subjectId: COMPANY,
          changedVocabularyCodes: ["industry"],
        }),
      ),
    ).toMatchObject({ scope: "CONTAINING", reason: "TAXONOMY_CHANGED" });
    expect(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.DISCLOSURE_REVOKED, {
          disclosurePolicyId: randomUUID(),
          resourceType: "company",
          resourceId: COMPANY,
          scopeType: "specifically_shared",
        }),
      ),
    ).toMatchObject({
      scope: "CONTAINING",
      invalidate: "SECURITY_RESTRICTION",
      reason: "DISCLOSURE_CHANGED",
      priority: "HIGH",
    });
    expect(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.DISCLOSURE_GRANTED, {
          disclosurePolicyId: randomUUID(),
          resourceType: "document",
          resourceId: COMPANY,
          scopeType: "specifically_shared",
          accessLevel: "view",
        }),
      ).kind,
    ).toBe("IGNORED");
    expect(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.RELATIONSHIP_CREATED, {
          relationshipId: randomUUID(),
          companyId: COMPANY,
          investorOrganisationId: INVESTOR,
        }),
      ),
    ).toMatchObject({ scope: "CONTAINING", reason: "RELATIONSHIP_CHANGED" });
    expect(refreshDirectiveFor(event("evidence.document.ready", {})).kind).toBe(
      "IGNORED",
    );
  });
});

// ---------------------------------------------------------------------------
// Requester and invalidation over fakes.
// ---------------------------------------------------------------------------

function memoryRequests(): RefreshRequestStore & {
  readonly rows: Map<
    string,
    ReturnType<RefreshRequestStore["findByKey"]> extends Promise<infer R>
      ? NonNullable<R>
      : never
  >;
} {
  const rows = new Map<
    string,
    {
      id: string;
      tenantId: string;
      investorOrganisationId: string;
      mandateId: string;
      mode: string;
      status: string;
      priority: "NORMAL" | "HIGH";
      reason: never;
      requestSequence: number;
      claimedSequence: number | null;
      attempts: number;
    }
  >();
  const keyOf = (k: SlateKey) =>
    `${k.investorOrganisationId}:${k.mandateId}:${k.mode}`;
  return {
    rows,
    requestRefresh: (input) => {
      const existing = rows.get(keyOf(input));
      if (existing === undefined) {
        const row = {
          id: randomUUID(),
          tenantId: input.tenantId,
          investorOrganisationId: input.investorOrganisationId,
          mandateId: input.mandateId,
          mode: input.mode,
          status: "PENDING",
          priority: input.priority,
          reason: input.reason as never,
          requestSequence: 1,
          claimedSequence: null,
          attempts: 0,
        };
        rows.set(keyOf(input), row);
        return Promise.resolve({ request: row, coalesced: false });
      }
      const prior = existing.status;
      existing.status =
        prior === "DONE" || prior === "FAILED" ? "PENDING" : prior;
      existing.priority =
        prior === "DONE" || prior === "FAILED"
          ? input.priority
          : existing.priority === "HIGH" || input.priority === "HIGH"
            ? "HIGH"
            : "NORMAL";
      existing.reason = input.reason as never;
      existing.requestSequence += 1;
      return Promise.resolve({
        request: existing,
        coalesced: prior === "PENDING" || prior === "CLAIMED",
      });
    },
    claim: (key, _at) => {
      const row = rows.get(keyOf(key));
      if (row === undefined || row.status !== "PENDING")
        return Promise.resolve(null);
      row.status = "CLAIMED";
      row.claimedSequence = row.requestSequence;
      row.attempts += 1;
      return Promise.resolve(row);
    },
    complete: (id) => {
      const row = [...rows.values()].find((r) => r.id === id);
      if (row === undefined || row.status !== "CLAIMED")
        return Promise.resolve({ reopened: false });
      const reopened = row.requestSequence > (row.claimedSequence ?? 0);
      row.status = reopened ? "PENDING" : "DONE";
      row.claimedSequence = null;
      return Promise.resolve({ reopened });
    },
    release: (id, outcome) => {
      const row = [...rows.values()].find((r) => r.id === id);
      if (row !== undefined && row.status === "CLAIMED") {
        row.status = outcome === "RETRY" ? "PENDING" : "FAILED";
        row.claimedSequence = null;
      }
      return Promise.resolve();
    },
    findByKey: (key) => Promise.resolve(rows.get(keyOf(key)) ?? null),
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

const VERSIONS = {
  eligibilityPolicyVersion: "eligibility.v2" as const,
  structuredGeneratorVersion: "structured-mandate.v2" as const,
  semanticGeneratorVersion: "semantic-mandate.v1" as const,
  featureSchemaVersion: FEATURE_SCHEMA_VERSION,
  rankerVersion: RANKER_VERSION,
  rankingConfigVersion: "ranking-config.v1",
  taxonomyVersion: null,
};

async function publishedSlate(
  store: ReturnType<typeof memorySlates>,
  key: SlateKey,
  companyIds: readonly string[],
) {
  const slate = await store.repo.beginBuild({
    ...key,
    mandateVersion: 1,
    versions: VERSIONS,
    generatedAt: "2026-09-19T09:00:00.000Z",
  });
  await store.repo.insertItems(
    slate.id,
    key.tenantId,
    companyIds.map((companyId, index) => ({
      companyId,
      companyTenantId: "22222222-0000-4000-8000-000000000001",
      rank: index + 1,
      internalScore: 0.5,
      reasonCodes: ["STAGE_ALIGNED"],
      featureSnapshotId: "66666666-0000-4000-8000-000000000001",
      featureSnapshotFingerprint: "a".repeat(64),
      candidateProvenance: {
        structured: {
          generatorVersion: "structured-mandate.v2",
          reasonCodes: ["STAGE_OVERLAP"],
        },
        semantic: null,
      },
    })),
  );
  const published = await store.repo.publish(
    { run: () => Promise.reject(new Error("unused")) },
    {
      slateId: slate.id,
      generationFingerprint: "b".repeat(64),
      itemCount: companyIds.length,
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
      publishedAt: "2026-09-19T09:00:00.000Z",
      expiresAt: "2026-09-20T09:00:00.000Z",
    },
  );
  return published.slate;
}

describe("refresh requester (CQ-REC-006)", () => {
  it("sends one bounded job per new request, coalesces a pending one, and always sends for HIGH", async () => {
    const requests = memoryRequests();
    const queue = collectingQueue();
    const requester = createRefreshRequester({
      requests,
      queue,
      clock: () => new Date("2026-09-19T10:00:00.000Z"),
    });
    const first = await requester.request({
      ...KEY,
      reason: "MANDATE_ACTIVATED",
      priority: "NORMAL",
      causationId: `cau_${randomUUID()}`,
    });
    expect(first.kind).toBe("ENQUEUED");
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0]?.queue).toBe(RECOMMENDATION_REFRESH_QUEUE);
    const job = queue.sent[0]?.message as Record<string, unknown>;
    expect(job["type"]).toBe(RefreshRecommendationSlateJob.name);
    expect(job["jobVersion"]).toBe(RefreshRecommendationSlateJob.version);
    expect(job["tenantId"]).toBe(TENANT);
    expect(job["data"]).toEqual({
      investorOrganisationId: INVESTOR,
      mandateId: MANDATE,
      mode: "INVESTOR_DISCOVER",
      reason: "MANDATE_ACTIVATED",
      priority: "NORMAL",
      requestSequence: 1,
    });
    // Identifiers only: no mandate field, no company, no snapshot.
    expect(Object.keys(job["data"] as object).sort()).toEqual([
      "investorOrganisationId",
      "mandateId",
      "mode",
      "priority",
      "reason",
      "requestSequence",
    ]);

    const second = await requester.request({
      ...KEY,
      reason: "COMPANY_UPDATED",
      priority: "NORMAL",
    });
    expect(second.kind).toBe("COALESCED");
    expect(second.request.requestSequence).toBe(2);
    expect(queue.sent).toHaveLength(1);

    const urgent = await requester.request({
      ...KEY,
      reason: "MANDATE_HARD_CHANGED",
      priority: "HIGH",
    });
    expect(urgent.kind).toBe("ENQUEUED");
    expect(urgent.request.priority).toBe("HIGH");
    expect(queue.sent).toHaveLength(2);
    expect(
      (queue.sent[1]?.message as { data: { requestSequence: number } }).data
        .requestSequence,
    ).toBe(3);
  });
});

describe("slate invalidation (CQ-REC-006)", () => {
  function harness() {
    const store = memorySlates();
    const requests = memoryRequests();
    const queue = collectingQueue();
    const requester = createRefreshRequester({ requests, queue });
    const service = createSlateInvalidationService({
      slates: store.repo,
      requester,
      clock: () => new Date("2026-09-19T10:00:00.000Z"),
    });
    return { store, requests, queue, service };
  }

  it("a hard mandate change invalidates the CURRENT slate and asks for a HIGH rebuild; a closed mandate invalidates without one", async () => {
    const h = harness();
    const slate = await publishedSlate(h.store, KEY, [COMPANY]);
    const outcome = await h.service.apply(
      refreshDirectiveFor(
        event(
          REFRESH_TRIGGER_EVENTS.MANDATE_UPDATED,
          mandateData(["HARD_EXCLUSION"]),
        ),
      ),
      { causationId: `cau_${randomUUID()}` },
    );
    expect(outcome).toEqual({ invalidated: 1, enqueued: 1, coalesced: 0 });
    const row = await h.store.repo.findById(slate.id);
    expect(row?.status).toBe("INVALIDATED");
    expect(row?.invalidationReason).toBe("MANDATE_HARD_CHANGED");
    expect(row?.invalidatedAt).toBe("2026-09-19T10:00:00.000Z");
    // Content untouched: lifecycle only.
    expect(row?.generationFingerprint).toBe("b".repeat(64));
    expect(h.store.rows.get(slate.id)?.items).toHaveLength(1);
    expect((await h.requests.findByKey(KEY))?.priority).toBe("HIGH");

    const closed = await h.service.apply(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.MANDATE_CLOSED, mandateData()),
      ),
    );
    // Nothing CURRENT remains to invalidate, and no rebuild is asked for.
    expect(closed).toEqual({ invalidated: 0, enqueued: 0, coalesced: 0 });
    expect(h.queue.sent).toHaveLength(1);
  });

  it("a withdrawn company invalidates only the slates that serve it, once per key; an ordinary change refreshes without invalidating", async () => {
    const h = harness();
    const otherKey: SlateKey = {
      ...KEY,
      investorOrganisationId: "11111111-0000-4000-8000-000000000014",
      mandateId: "33333333-0000-4000-8000-000000000032",
    };
    const thirdKey: SlateKey = {
      ...KEY,
      investorOrganisationId: "11111111-0000-4000-8000-000000000015",
      mandateId: "33333333-0000-4000-8000-000000000033",
    };
    const serving = await publishedSlate(h.store, KEY, [
      COMPANY,
      OTHER_COMPANY,
    ]);
    const alsoServing = await publishedSlate(h.store, otherKey, [COMPANY]);
    const notServing = await publishedSlate(h.store, thirdKey, [OTHER_COMPANY]);

    const outcome = await h.service.apply(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.COMPANY_VISIBILITY_CHANGED, {
          companyId: COMPANY,
          version: 2,
          visibility: "organisation_private",
        }),
      ),
    );
    expect(outcome).toEqual({ invalidated: 2, enqueued: 2, coalesced: 0 });
    expect((await h.store.repo.findById(serving.id))?.status).toBe(
      "INVALIDATED",
    );
    expect((await h.store.repo.findById(serving.id))?.invalidationReason).toBe(
      "VISIBILITY_CHANGED",
    );
    expect((await h.store.repo.findById(alsoServing.id))?.status).toBe(
      "INVALIDATED",
    );
    expect((await h.store.repo.findById(notServing.id))?.status).toBe(
      "CURRENT",
    );
    expect(h.queue.sent).toHaveLength(2);

    // An ordinary profile change on the untouched slate: refresh, no invalidation.
    const ordinary = await h.service.apply(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.COMPANY_UPDATED, {
          companyId: OTHER_COMPANY,
          version: 2,
          changedFields: ["short_description"],
        }),
      ),
    );
    expect(ordinary).toEqual({ invalidated: 0, enqueued: 1, coalesced: 0 });
    expect((await h.store.repo.findById(notServing.id))?.status).toBe(
      "CURRENT",
    );
    expect((await h.requests.findByKey(thirdKey))?.priority).toBe("NORMAL");

    // Repeating it coalesces into the pending request.
    const again = await h.service.apply(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.COMPANY_UPDATED, {
          companyId: OTHER_COMPANY,
          version: 3,
          changedFields: ["short_description"],
        }),
      ),
    );
    expect(again).toEqual({ invalidated: 0, enqueued: 0, coalesced: 1 });
    expect(h.queue.sent).toHaveLength(3);
  });

  it("a newly discoverable company asks every CURRENT slate for a NORMAL rebuild, bounded", async () => {
    const h = harness();
    const keys = [0, 1, 2].map<SlateKey>((n) => ({
      ...KEY,
      investorOrganisationId: `11111111-0000-4000-8000-00000000002${n}`,
      mandateId: `33333333-0000-4000-8000-00000000004${n}`,
    }));
    for (const key of keys) await publishedSlate(h.store, key, [OTHER_COMPANY]);
    const bounded = createSlateInvalidationService({
      slates: h.store.repo,
      requester: createRefreshRequester({
        requests: h.requests,
        queue: h.queue,
      }),
      fanOutMax: 2,
    });
    const outcome = await bounded.apply(
      refreshDirectiveFor(
        event(REFRESH_TRIGGER_EVENTS.COMPANY_READINESS_CHANGED, {
          companyId: COMPANY,
          version: 2,
          readinessState: "marketplace_ready",
          policyVersion: "marketplace-readiness.v1",
        }),
      ),
    );
    expect(outcome).toEqual({ invalidated: 0, enqueued: 2, coalesced: 0 });
    expect(await h.store.repo.listCurrent(10)).toHaveLength(3);
    expect(
      await h.service.apply({ kind: "IGNORED", why: "NOT_A_TRIGGER" }),
    ).toEqual({
      invalidated: 0,
      enqueued: 0,
      coalesced: 0,
    });
  });
});
