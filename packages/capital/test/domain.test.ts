import { describe, expect, it } from "vitest";

import {
  CAPITAL_OBJECTIVE_CLOSURE_REASONS,
  CAPITAL_OBJECTIVE_STATUSES,
  CapitalObjectiveDtoSchema,
  CapitalObjectiveStatusSchema,
  CapitalTargetSchema,
  CloseCapitalObjectiveRequestSchema,
  createEventRegistry,
  CreateCapitalObjectiveRequestSchema,
  LocalDateSchema,
  ReplaceCapitalObjectiveRequestSchema,
  UpdateCapitalObjectiveRequestSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import { CompanyIdSchema } from "@capital-q/companies";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

import {
  CapitalObjectiveIdSchema,
  toCapitalObjectiveDto,
  toCapitalObjectiveSnapshot,
  type CapitalObjective,
} from "../src/contracts/index.js";
import {
  CAPITAL_CHANGE_KINDS,
  CapitalHistoryPayloadSchema,
  serializeHistoryPayload,
} from "../src/domain/history.js";
import {
  hashCapitalObjectiveIdempotencyKey,
  hashCreateCapitalObjectiveRequest,
} from "../src/domain/idempotency.js";
import {
  CAPITAL_EVENTS,
  capitalObjectiveClosedEvent,
  capitalObjectiveCreatedEvent,
  capitalObjectiveUpdatedEvent,
} from "../src/events/index.js";

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = "d0000000-0000-4000-8000-000000000001";
const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const COMPANY = CompanyIdSchema.parse("f0000000-0000-4000-8000-000000000001");
const OBJECTIVE = CapitalObjectiveIdSchema.parse(
  "f0000000-0000-4000-8000-000000000020",
);
const REPLACEMENT = "f0000000-0000-4000-8000-000000000021";
const CORRELATION: CorrelationId = "cor_123e4567-e89b-12d3-a456-426614174000";
const NOW = "2026-09-03T09:00:00.000Z";
const TARGET = { amount: "4000000.10", currency: "USD" };

describe("identifiers, statuses and reasons", () => {
  it("CapitalObjectiveId is a branded UUID distinct from CompanyId", () => {
    expect(CapitalObjectiveIdSchema.safeParse("nope").success).toBe(false);
    expect(CapitalObjectiveIdSchema.safeParse(OBJECTIVE).success).toBe(true);
    expect(OBJECTIVE).not.toBe(COMPANY);
  });

  it("only the canonical statuses and closure reasons exist; no FAILED or COMPLETED", () => {
    expect([...CAPITAL_OBJECTIVE_STATUSES]).toEqual([
      "ACTIVE",
      "ACHIEVED",
      "CLOSED_BY_FOUNDER",
      "DISCONTINUED",
      "REPLACED",
    ]);
    expect([...CAPITAL_OBJECTIVE_CLOSURE_REASONS]).toEqual([
      "ACHIEVED",
      "CLOSED_BY_FOUNDER",
      "DISCONTINUED",
    ]);
    for (const bad of ["FAILED", "COMPLETED", "SUCCESSFUL", "active"]) {
      expect(CapitalObjectiveStatusSchema.safeParse(bad).success).toBe(false);
      expect(
        CloseCapitalObjectiveRequestSchema.safeParse({
          reason: bad,
          expectedVersion: 1,
        }).success,
      ).toBe(false);
    }
    // REPLACED is produced by the replace workflow, never stated as a reason.
    expect(
      CloseCapitalObjectiveRequestSchema.safeParse({
        reason: "REPLACED",
        expectedVersion: 1,
      }).success,
    ).toBe(false);
  });
});

describe("money", () => {
  it.each([
    ["exact decimal", { amount: "4000000.10", currency: "USD" }, true],
    ["integer string", { amount: "250000", currency: "EUR" }, true],
    ["JS number", { amount: 4000000, currency: "USD" }, false],
    ["zero", { amount: "0", currency: "USD" }, false],
    ["zero with decimals", { amount: "0.00", currency: "USD" }, false],
    ["negative", { amount: "-1", currency: "USD" }, false],
    ["exponent", { amount: "4e6", currency: "USD" }, false],
    ["missing currency", { amount: "1" }, false],
    ["currency symbol", { amount: "1", currency: "$" }, false],
    ["lowercase currency", { amount: "1", currency: "usd" }, false],
  ])("%s", (_, target, valid) => {
    expect(CapitalTargetSchema.safeParse(target).success).toBe(valid);
  });
});

describe("dates", () => {
  it("accepts a calendar date and rejects timestamps or malformed dates", () => {
    expect(LocalDateSchema.safeParse("2026-12-01").success).toBe(true);
    expect(LocalDateSchema.safeParse("2026-12-01T00:00:00Z").success).toBe(
      false,
    );
    expect(LocalDateSchema.safeParse("2026-13-01").success).toBe(false);
    expect(LocalDateSchema.safeParse("01/12/2026").success).toBe(false);
  });
});

describe("request contracts", () => {
  it("create requires a target; refuses identity, lifecycle, authority, progress, readiness and disclosure fields", () => {
    expect(
      CreateCapitalObjectiveRequestSchema.safeParse({ target: TARGET }).success,
    ).toBe(true);
    expect(
      CreateCapitalObjectiveRequestSchema.safeParse({
        target: TARGET,
        targetStage: "series_a",
        instrumentCode: "safe",
        targetCloseDate: "2026-12-01",
        useOfFundsSummary: "Product and hiring.",
      }).success,
    ).toBe(true);
    expect(CreateCapitalObjectiveRequestSchema.safeParse({}).success).toBe(
      false,
    );
    for (const extra of [
      { id: OBJECTIVE },
      { tenantId: TENANT },
      { companyId: COMPANY },
      { createdByUserId: USER },
      { status: "ACHIEVED" },
      { startedAt: NOW },
      { closedAt: NOW },
      { version: 2 },
      { confirmedAmount: "1" },
      { softCommitments: "1" },
      { readinessScore: 0.9 },
      { qualityScore: 5 },
      { fitScore: 0.5 },
      { marketplaceVisibility: "network_visible" },
      { verified: true },
      { valuation: "10000000" },
      { objectiveType: "SAFE" },
      { instrumentCode: "Priced Equity" },
      { targetStage: "Series A" },
      { useOfFundsSummary: "x".repeat(2001) },
    ]) {
      expect(
        CreateCapitalObjectiveRequestSchema.safeParse({
          target: TARGET,
          ...extra,
        }).success,
        JSON.stringify(Object.keys(extra)),
      ).toBe(false);
    }
  });

  it("update requires expectedVersion and a field; null clears; status is not editable", () => {
    expect(
      UpdateCapitalObjectiveRequestSchema.safeParse({ expectedVersion: 1 })
        .success,
    ).toBe(false);
    expect(
      UpdateCapitalObjectiveRequestSchema.safeParse({
        expectedVersion: 1,
        targetCloseDate: null,
        instrumentCode: "convertible_note",
      }).success,
    ).toBe(true);
    for (const extra of [
      { status: "ACHIEVED" },
      { closedAt: NOW },
      { objectiveType: "RAISE" },
      { companyId: COMPANY },
    ]) {
      expect(
        UpdateCapitalObjectiveRequestSchema.safeParse({
          expectedVersion: 1,
          target: TARGET,
          ...extra,
        }).success,
      ).toBe(false);
    }
    expect(
      ReplaceCapitalObjectiveRequestSchema.safeParse({
        expectedVersion: 1,
        replacement: { target: TARGET },
      }).success,
    ).toBe(true);
    expect(
      ReplaceCapitalObjectiveRequestSchema.safeParse({
        expectedVersion: 1,
        replacement: { target: TARGET, status: "ACTIVE" },
      }).success,
    ).toBe(false);
  });
});

describe("history payloads", () => {
  it("are typed per event kind and bounded", () => {
    expect(
      CapitalHistoryPayloadSchema.safeParse({
        kind: "RECALIBRATED",
        changedFields: ["target"],
        changeKinds: ["TARGET_AMOUNT"],
        previous: { target: { amount: "2000000", currency: "USD" } },
        next: { target: { amount: "4000000", currency: "USD" } },
        previousVersion: 1,
        newVersion: 2,
      }).success,
    ).toBe(true);
    expect(
      CapitalHistoryPayloadSchema.safeParse({
        kind: "CLOSED",
        reason: "FAILED",
        previousVersion: 1,
        newVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      CapitalHistoryPayloadSchema.safeParse({
        kind: "CREATED",
        status: "ACTIVE",
        values: {
          objectiveType: "RAISE",
          target: TARGET,
          targetStage: null,
          instrumentCode: null,
          targetCloseDate: null,
          useOfFundsSummary: null,
        },
        qConversation: "...",
      }).success,
    ).toBe(false);
    expect(() =>
      serializeHistoryPayload({
        kind: "CREATED",
        status: "ACTIVE",
        values: {
          objectiveType: "RAISE",
          target: TARGET,
          targetStage: null,
          instrumentCode: null,
          targetCloseDate: null,
          useOfFundsSummary: "x".repeat(2000),
        },
      }),
    ).not.toThrow();
    expect([...CAPITAL_CHANGE_KINDS]).toEqual([
      "TARGET_AMOUNT",
      "CURRENCY",
      "TARGET_STAGE",
      "INSTRUMENT",
      "TIMELINE",
      "USE_OF_FUNDS",
    ]);
  });
});

describe("idempotency hashing", () => {
  it("is namespaced and key-order independent", () => {
    expect(hashCapitalObjectiveIdempotencyKey("k")).toMatch(/^[0-9a-f]{64}$/);
    const a = hashCreateCapitalObjectiveRequest({
      target: { amount: "1", currency: "USD" },
      targetStage: "seed",
    });
    const b = hashCreateCapitalObjectiveRequest({
      targetStage: "seed",
      target: { currency: "USD", amount: "1" },
    });
    const c = hashCreateCapitalObjectiveRequest({
      target: { amount: "2", currency: "USD" },
      targetStage: "seed",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("DTO and snapshot", () => {
  const objective: CapitalObjective = {
    id: OBJECTIVE,
    tenantId: TENANT,
    companyId: COMPANY,
    objectiveType: "RAISE",
    status: "ACTIVE",
    target: TARGET,
    targetStage: "series_a",
    instrumentCode: "safe",
    targetCloseDate: "2026-12-01",
    useOfFundsSummary: "PRIVATE-USE-OF-FUNDS-DO-NOT-EMIT",
    startedAt: NOW,
    closedAt: null,
    createdByUserId: USER,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("the internal DTO carries the target and summary, hides tenant and creator; the snapshot drops the narrative", () => {
    const dto = toCapitalObjectiveDto(objective);
    expect(CapitalObjectiveDtoSchema.safeParse(dto).success).toBe(true);
    expect(dto.target).toEqual(TARGET);
    expect(dto).not.toHaveProperty("tenantId");
    expect(dto).not.toHaveProperty("createdByUserId");
    expect(Object.keys(dto)).not.toContain("readinessScore");
    const snapshot = toCapitalObjectiveSnapshot(objective);
    expect(snapshot.target).toEqual(TARGET);
    expect(snapshot).not.toHaveProperty("useOfFundsSummary");
  });
});

describe("capital objective events", () => {
  const registry = createEventRegistry([...CAPITAL_EVENTS]);
  const context = {
    tenantId: TENANT,
    organisationId: ORG,
    actorUserId: USER,
    correlationId: CORRELATION,
    capitalObjectiveId: OBJECTIVE,
    companyId: COMPANY,
    version: 2,
  };

  it("registers the three events at version 1 as CONFIDENTIAL", () => {
    for (const name of [
      "core.capital_objective.created",
      "core.capital_objective.updated",
      "core.capital_objective.closed",
    ]) {
      const definition = registry.get(name, 1);
      expect(definition?.owner).toBe("@capital-q/capital");
      expect(definition?.sensitivity).toBe("CONFIDENTIAL");
      expect(registry.has(name, 2)).toBe(false);
    }
    expect(registry.has("core.capital_objective.replaced", 1)).toBe(false);
  });

  it("carries ids, versions, change kinds and closure reasons only", () => {
    const created = capitalObjectiveCreatedEvent({ ...context, version: 1 });
    const updated = capitalObjectiveUpdatedEvent({
      ...context,
      changedFields: ["target"],
      changeKinds: ["TARGET_AMOUNT"],
    });
    const closed = capitalObjectiveClosedEvent({
      ...context,
      version: 3,
      closureReason: "REPLACED",
      replacementCapitalObjectiveId: REPLACEMENT,
    });
    for (const event of [created, updated, closed]) {
      expect(registry.parse(event).ok).toBe(true);
      expect(event.aggregate?.type).toBe("capital_objective");
    }
    expect(updated.data).toEqual({
      capitalObjectiveId: OBJECTIVE,
      companyId: COMPANY,
      version: 2,
      changedFields: ["target"],
      changeKinds: ["TARGET_AMOUNT"],
    });
    expect(closed.data).toEqual({
      capitalObjectiveId: OBJECTIVE,
      companyId: COMPANY,
      version: 3,
      closureReason: "REPLACED",
      replacementCapitalObjectiveId: REPLACEMENT,
    });
    for (const smuggled of [
      { targetAmount: "4000000" },
      { useOfFundsSummary: "PRIVATE-USE-OF-FUNDS-DO-NOT-EMIT" },
      { changeKinds: ["SLATE_REBUILD"] },
    ]) {
      expect(
        registry.parse({ ...updated, data: { ...updated.data, ...smuggled } })
          .ok,
      ).toBe(false);
    }
    expect(
      registry.parse({
        ...closed,
        data: { ...closed.data, closureReason: "FAILED" },
      }).ok,
    ).toBe(false);
    expect(registry.parse({ ...created, eventVersion: 2 }).ok).toBe(false);
  });
});
