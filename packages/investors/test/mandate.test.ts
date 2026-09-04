import { describe, expect, it } from "vitest";

import {
  ChequeAmountSchema,
  ContractValidationError,
  createEventRegistry,
  CreateInvestorMandateRequestSchema,
  DISCOVERY_MODES,
  InvestorMandateDtoSchema,
  MANDATE_CONSTRAINT_INPUT_DIMENSIONS,
  MANDATE_CONSTRAINT_OPERATORS,
  MANDATE_PREFERENCE_CLASSES,
  MandateChequeRangeSchema,
  MandateConstraintInputSchema,
  UpdateInvestorMandateRequestSchema,
  type CorrelationId,
  type MandateConstraintInput,
} from "@capital-q/contracts";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

import { InvestorOrganisationIdSchema } from "../src/contracts/index.js";
import {
  InvestorMandateConstraintIdSchema,
  InvestorMandateIdSchema,
  toInvestorMandateDto,
  type InvestorMandate,
} from "../src/contracts/mandate.js";
import { compareDecimalStrings } from "../src/domain/decimal.js";
import {
  hashCreateInvestorMandateRequest,
  hashInvestorMandateIdempotencyKey,
} from "../src/domain/mandate-idempotency.js";
import {
  automatedUseOf,
  MANDATE_CONSTRAINT_REGISTRY,
  validateChequeRange,
  validateMandateConstraints,
} from "../src/domain/mandate-registry.js";
import { INVESTOR_EVENTS } from "../src/events/index.js";
import {
  investorMandateActivatedEvent,
  investorMandateClosedEvent,
  investorMandateCreatedEvent,
  investorMandateUpdatedEvent,
  MANDATE_CHANGE_KINDS,
} from "../src/events/mandate.js";

const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = "d0000000-0000-4000-8000-000000000001";
const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const INVESTOR = InvestorOrganisationIdSchema.parse(
  "f0000000-0000-4000-8000-000000000001",
);
const MANDATE = InvestorMandateIdSchema.parse(
  "f0000000-0000-4000-8000-000000000010",
);
const CORRELATION: CorrelationId = "cor_123e4567-e89b-12d3-a456-426614174000";
const NOW = "2026-09-03T09:00:00.000Z";

function constraint(
  overrides: Partial<MandateConstraintInput> = {},
): MandateConstraintInput {
  return {
    dimension: "stage",
    operator: "IN",
    value: { kind: "codes", values: ["seed", "series_a"] },
    importance: "MUST",
    isHardExclusion: false,
    ...overrides,
  };
}

describe("vocabularies", () => {
  it("preference classes, discovery modes and operators are exactly the canonical sets", () => {
    expect([...MANDATE_PREFERENCE_CLASSES]).toEqual([
      "MUST",
      "STRONG",
      "NICE",
      "NEUTRAL",
      "AVOID",
      "HARD_EXCLUSION",
    ]);
    expect([...DISCOVERY_MODES]).toEqual(["STRICT", "BALANCED", "EXPLORATORY"]);
    expect([...MANDATE_CONSTRAINT_OPERATORS]).toEqual([
      "EQ",
      "NEQ",
      "IN",
      "NOT_IN",
      "GTE",
      "LTE",
      "BETWEEN",
    ]);
    expect([...MANDATE_CHANGE_KINDS]).toContain("HARD_EXCLUSION");
    for (const bad of ["SUPER_IMPORTANT", "LOW", "HIGH", "MEDIUM", "must"]) {
      expect(
        MandateConstraintInputSchema.safeParse(
          constraint({ importance: bad } as never),
        ).success,
      ).toBe(false);
    }
    expect(
      CreateInvestorMandateRequestSchema.safeParse({
        name: "x",
        discoveryMode: "OPEN",
      }).success,
    ).toBe(false);
  });

  it("identifiers are branded and distinct", () => {
    expect(InvestorMandateIdSchema.safeParse("nope").success).toBe(false);
    expect(InvestorMandateConstraintIdSchema.safeParse("").success).toBe(false);
    expect(MANDATE).not.toBe(INVESTOR);
  });
});

describe("hard exclusion invariant", () => {
  it.each([
    ["HARD_EXCLUSION + true", "HARD_EXCLUSION", true, true],
    ["HARD_EXCLUSION + false", "HARD_EXCLUSION", false, false],
    ["NICE + true", "NICE", true, false],
    ["AVOID + false", "AVOID", false, true],
  ] as const)("%s", (_, importance, isHardExclusion, valid) => {
    const input = constraint({
      dimension: "red_flag",
      operator: "IN",
      value: { kind: "codes", values: ["gambling"] },
      importance,
      isHardExclusion,
    });
    expect(MandateConstraintInputSchema.safeParse(input).success).toBe(valid);
    if (valid) {
      expect(() => validateMandateConstraints([input])).not.toThrow();
    }
  });
});

describe("money", () => {
  it("accepts exact decimal strings, rejects numbers, negatives and floats-as-text", () => {
    expect(ChequeAmountSchema.safeParse("250000").success).toBe(true);
    expect(ChequeAmountSchema.safeParse("250000.50").success).toBe(true);
    expect(ChequeAmountSchema.safeParse(250000).success).toBe(false);
    expect(ChequeAmountSchema.safeParse("-1").success).toBe(false);
    expect(ChequeAmountSchema.safeParse("1e6").success).toBe(false);
    expect(ChequeAmountSchema.safeParse("1,000").success).toBe(false);
  });

  it("compares exactly without floating point", () => {
    expect(compareDecimalStrings("0.1", "0.10")).toBe(0);
    expect(compareDecimalStrings("9007199254740993", "9007199254740992")).toBe(
      1,
    );
    expect(compareDecimalStrings("100.005", "100.0049999")).toBe(1);
    expect(compareDecimalStrings("-5", "0")).toBe(-1);
    expect(() => compareDecimalStrings("1e6", "1")).toThrow(TypeError);
  });

  it("validates min <= typical <= max and leaves unknown parts alone", () => {
    expect(
      MandateChequeRangeSchema.safeParse({ currency: "USD", min: "1" }).success,
    ).toBe(true);
    expect(() =>
      validateChequeRange({ currency: "USD", min: "500000", max: "250000" }),
    ).toThrow(ContractValidationError);
    expect(() =>
      validateChequeRange({
        currency: "USD",
        min: "250000",
        typical: "3000000",
        max: "2000000",
      }),
    ).toThrow(ContractValidationError);
    expect(() =>
      validateChequeRange({
        currency: "USD",
        min: "250000.00",
        typical: "250000",
        max: "2000000",
      }),
    ).not.toThrow();
    expect(() => validateChequeRange({ currency: "USD" })).not.toThrow();
    expect(
      MandateChequeRangeSchema.safeParse({ currency: "USD", min: 100 }).success,
    ).toBe(false);
  });
});

describe("constraint registry", () => {
  it("covers every client dimension with allowed and disallowed cases", () => {
    const cases: Record<
      (typeof MANDATE_CONSTRAINT_INPUT_DIMENSIONS)[number],
      {
        ok: MandateConstraintInput;
        badOperator: MandateConstraintInput["operator"];
        badValue: MandateConstraintInput["value"];
      }
    > = {
      stage: {
        ok: constraint(),
        badOperator: "BETWEEN",
        badValue: { kind: "codes", values: ["Series A"] },
      },
      "geography.country": {
        ok: constraint({
          dimension: "geography.country",
          value: { kind: "codes", values: ["NG", "GH", "KE"] },
        }),
        badOperator: "GTE",
        badValue: { kind: "codes", values: ["Africa"] },
      },
      sector: {
        ok: constraint({
          dimension: "sector",
          value: { kind: "codes", values: ["fintech"] },
        }),
        badOperator: "LTE",
        badValue: { kind: "text", text: "fintech" },
      },
      "business.attribute": {
        ok: constraint({
          dimension: "business.attribute",
          value: { kind: "codes", values: ["b2b", "saas"] },
        }),
        badOperator: "BETWEEN",
        badValue: { kind: "codes", values: ["b2b_saas_api_regulated"] },
      },
      "founder.business_attribute": {
        ok: constraint({
          dimension: "founder.business_attribute",
          value: { kind: "codes", values: ["technical_founding_capability"] },
          importance: "STRONG",
        }),
        badOperator: "GTE",
        badValue: { kind: "codes", values: ["age_under_30"] },
      },
      green_flag: {
        ok: constraint({
          dimension: "green_flag",
          value: { kind: "codes", values: ["enterprise_customers"] },
          importance: "STRONG",
        }),
        badOperator: "NOT_IN",
        badValue: { kind: "codes", values: ["unicorn_vibes"] },
      },
      red_flag: {
        ok: constraint({
          dimension: "red_flag",
          value: { kind: "codes", values: ["gambling"] },
          importance: "AVOID",
        }),
        badOperator: "NOT_IN",
        badValue: { kind: "text", text: "gambling" },
      },
      investment_role: {
        ok: constraint({
          dimension: "investment_role",
          value: { kind: "codes", values: ["lead", "co_invest"] },
          importance: "NICE",
        }),
        badOperator: "NEQ",
        badValue: { kind: "codes", values: ["LEAD"] },
      },
      "custom.text": {
        ok: constraint({
          dimension: "custom.text",
          operator: "EQ",
          value: { kind: "text", text: "Founders with strong distribution." },
          importance: "NICE",
        }),
        badOperator: "IN",
        badValue: { kind: "codes", values: ["x"] },
      },
    };
    for (const dimension of MANDATE_CONSTRAINT_INPUT_DIMENSIONS) {
      const { ok, badOperator, badValue } = cases[dimension];
      expect(() => validateMandateConstraints([ok]), dimension).not.toThrow();
      expect(
        () => validateMandateConstraints([{ ...ok, operator: badOperator }]),
        `${dimension} operator`,
      ).toThrow(ContractValidationError);
      expect(
        () => validateMandateConstraints([{ ...ok, value: badValue }]),
        `${dimension} value`,
      ).toThrow(ContractValidationError);
    }
  });

  it("EQ and NEQ take exactly one code; green flags cannot be negative; red flags cannot be positive", () => {
    expect(() =>
      validateMandateConstraints([constraint({ operator: "EQ" })]),
    ).toThrow(ContractValidationError);
    expect(() =>
      validateMandateConstraints([
        constraint({
          dimension: "green_flag",
          value: { kind: "codes", values: ["high_retention"] },
          importance: "AVOID",
        }),
      ]),
    ).toThrow(ContractValidationError);
    expect(() =>
      validateMandateConstraints([
        constraint({
          dimension: "red_flag",
          value: { kind: "codes", values: ["gambling"] },
          importance: "STRONG",
        }),
      ]),
    ).toThrow(ContractValidationError);
  });

  it("refuses arbitrary dimensions, protected characteristics, the derived typical cheque and anything executable", () => {
    for (const dimension of [
      "whatever.the.client.wants",
      "race",
      "ethnicity",
      "religion",
      "sexual_orientation",
      "disability",
      "political_affiliation",
      "union_membership",
      "founder.age",
      "cheque.typical",
    ]) {
      expect(
        MandateConstraintInputSchema.safeParse(
          constraint({ dimension } as never),
        ).success,
        dimension,
      ).toBe(false);
    }
    expect(
      MandateConstraintInputSchema.safeParse({
        dimension: "stage",
        operator: "SQL",
        value: "DROP TABLE core.investor_mandates",
        importance: "MUST",
        isHardExclusion: false,
      }).success,
    ).toBe(false);
    expect(
      MandateConstraintInputSchema.safeParse(
        constraint({
          value: { kind: "codes", values: ["seed"], expr: "1=1" } as never,
        }),
      ).success,
    ).toBe(false);
    // The derived dimension cannot be smuggled through the domain either.
    expect(() =>
      validateMandateConstraints([
        {
          dimension: "cheque.typical",
          operator: "EQ",
          value: { kind: "amount", amount: "1", currency: "USD" },
          importance: "NEUTRAL",
          isHardExclusion: false,
        } as never,
      ]),
    ).toThrow(ContractValidationError);
  });

  it("custom text is bounded and MANUAL_ONLY; every other dimension is ELIGIBLE", () => {
    expect(automatedUseOf("custom.text")).toBe("MANUAL_ONLY");
    for (const dimension of MANDATE_CONSTRAINT_INPUT_DIMENSIONS) {
      if (dimension !== "custom.text") {
        expect(automatedUseOf(dimension)).toBe("ELIGIBLE");
      }
    }
    expect(MANDATE_CONSTRAINT_REGISTRY["cheque.typical"].clientSupplied).toBe(
      false,
    );
    expect(
      MandateConstraintInputSchema.safeParse(
        constraint({
          dimension: "custom.text",
          operator: "EQ",
          value: { kind: "text", text: "x".repeat(1001) },
          importance: "NICE",
        }),
      ).success,
    ).toBe(false);
  });
});

describe("request contracts", () => {
  it("create refuses identity, authority, lifecycle, behaviour and GateQ fields", () => {
    expect(
      CreateInvestorMandateRequestSchema.safeParse({ name: "Primary Seed" })
        .success,
    ).toBe(true);
    for (const extra of [
      { id: MANDATE },
      { tenantId: TENANT },
      { investorOrganisationId: INVESTOR },
      { createdByUserId: USER },
      { version: 2 },
      { status: "ACTIVE" },
      { effectiveFrom: NOW },
      { effectiveTo: NOW },
      { observedBehaviour: {} },
      { qInference: "likes API" },
      { gateqMode: "OPEN" },
      { inboundMode: "OPEN" },
      { deploymentState: "PAUSED" },
      { rawMandateText: "x".repeat(8193) },
      { constraints: Array.from({ length: 101 }, () => constraint()) },
    ]) {
      expect(
        CreateInvestorMandateRequestSchema.safeParse({ name: "x", ...extra })
          .success,
        JSON.stringify(Object.keys(extra)),
      ).toBe(false);
    }
  });

  it("update requires expectedVersion and at least one field; null clears; nothing lifecycle-shaped is accepted", () => {
    expect(
      UpdateInvestorMandateRequestSchema.safeParse({ expectedVersion: 1 })
        .success,
    ).toBe(false);
    expect(
      UpdateInvestorMandateRequestSchema.safeParse({
        expectedVersion: 1,
        chequeRange: null,
        discoveryMode: null,
        constraints: [],
      }).success,
    ).toBe(true);
    for (const extra of [
      { status: "CLOSED" },
      { effectiveTo: NOW },
      { version: 3 },
      { investorOrganisationId: INVESTOR },
      { tenantId: TENANT },
    ]) {
      expect(
        UpdateInvestorMandateRequestSchema.safeParse({
          expectedVersion: 1,
          name: "x",
          ...extra,
        }).success,
      ).toBe(false);
    }
  });
});

describe("idempotency hashing", () => {
  it("is namespaced and key-order independent, including nested constraints", () => {
    expect(hashInvestorMandateIdempotencyKey("k")).toMatch(/^[0-9a-f]{64}$/);
    const a = hashCreateInvestorMandateRequest({
      name: "A",
      constraints: [constraint()],
      chequeRange: { currency: "USD", min: "1" },
    });
    const b = hashCreateInvestorMandateRequest({
      chequeRange: { min: "1", currency: "USD" },
      constraints: [
        {
          isHardExclusion: false,
          importance: "MUST",
          value: { values: ["seed", "series_a"], kind: "codes" },
          operator: "IN",
          dimension: "stage",
        },
      ],
      name: "A",
    });
    const c = hashCreateInvestorMandateRequest({
      name: "A",
      constraints: [constraint({ importance: "STRONG" })],
      chequeRange: { currency: "USD", min: "1" },
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("DTO", () => {
  it("assembles the cheque range from the row and the derived typical constraint, and hides the derived constraint", () => {
    const mandate: InvestorMandate = {
      id: MANDATE,
      tenantId: TENANT,
      investorOrganisationId: INVESTOR,
      name: "Primary Seed",
      status: "DRAFT",
      effectiveFrom: null,
      effectiveTo: null,
      discoveryMode: "EXPLORATORY",
      minCheque: "250000",
      maxCheque: "2000000",
      currencyCode: "USD",
      minStageCode: "seed",
      maxStageCode: "series_a",
      rawMandateText: "We back technical founders.",
      createdByUserId: USER,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
      constraints: [
        {
          id: InvestorMandateConstraintIdSchema.parse(
            "f0000000-0000-4000-8000-000000000101",
          ),
          tenantId: TENANT,
          mandateId: MANDATE,
          dimension: "cheque.typical",
          operator: "EQ",
          value: { kind: "amount", amount: "750000", currency: "USD" },
          importance: "NEUTRAL",
          isHardExclusion: false,
        },
        {
          id: InvestorMandateConstraintIdSchema.parse(
            "f0000000-0000-4000-8000-000000000102",
          ),
          tenantId: TENANT,
          mandateId: MANDATE,
          dimension: "red_flag",
          operator: "IN",
          value: { kind: "codes", values: ["gambling"] },
          importance: "HARD_EXCLUSION",
          isHardExclusion: true,
        },
      ],
      taxonomyPreferences: [],
    };
    const dto = toInvestorMandateDto(mandate);
    expect(InvestorMandateDtoSchema.safeParse(dto).success).toBe(true);
    expect(dto.chequeRange).toEqual({
      currency: "USD",
      min: "250000",
      typical: "750000",
      max: "2000000",
    });
    expect(dto.constraints.map((c) => c.dimension)).toEqual(["red_flag"]);
    expect(dto).not.toHaveProperty("tenantId");
    expect(dto).not.toHaveProperty("createdByUserId");
    expect(dto.discoveryMode).toBe("EXPLORATORY");
    expect(dto.constraints[0]?.isHardExclusion).toBe(true);
  });
});

describe("mandate events", () => {
  const registry = createEventRegistry([...INVESTOR_EVENTS]);
  const context = {
    tenantId: TENANT,
    organisationId: ORG,
    actorUserId: USER,
    correlationId: CORRELATION,
    investorMandateId: MANDATE,
    investorOrganisationId: INVESTOR,
    version: 2,
  };

  it("registers the four mandate events at version 1 as CONFIDENTIAL", () => {
    for (const name of [
      "core.investor_mandate.created",
      "core.investor_mandate.updated",
      "core.investor_mandate.activated",
      "core.investor_mandate.closed",
    ]) {
      const definition = registry.get(name, 1);
      expect(definition?.owner).toBe("@capital-q/investors");
      expect(definition?.sensitivity).toBe("CONFIDENTIAL");
      expect(registry.has(name, 2)).toBe(false);
    }
  });

  it("carries identifiers, versions, field names and change kinds only", () => {
    const created = investorMandateCreatedEvent({ ...context, version: 1 });
    const updated = investorMandateUpdatedEvent({
      ...context,
      changedFields: ["constraints"],
      changeKinds: ["HARD_EXCLUSION", "PREFERENCE"],
    });
    const activated = investorMandateActivatedEvent({
      ...context,
      effectiveFrom: NOW,
    });
    const closed = investorMandateClosedEvent({
      ...context,
      version: 3,
      effectiveTo: NOW,
    });
    for (const event of [created, updated, activated, closed]) {
      expect(registry.parse(event).ok).toBe(true);
      expect(event.aggregate?.type).toBe("investor_mandate");
    }
    expect(updated.data).toEqual({
      investorMandateId: MANDATE,
      investorOrganisationId: INVESTOR,
      version: 2,
      changedFields: ["constraints"],
      changeKinds: ["HARD_EXCLUSION", "PREFERENCE"],
    });
    for (const smuggled of [
      { hardExclusions: ["gambling"] },
      { rawMandateText: "PRIVATE-INVESTOR-MANDATE-TEXT-DO-NOT-EMIT" },
      { minCheque: "250000" },
    ]) {
      expect(
        registry.parse({ ...updated, data: { ...updated.data, ...smuggled } })
          .ok,
      ).toBe(false);
    }
    expect(
      registry.parse({
        ...updated,
        data: { ...updated.data, changeKinds: ["SLATE_REBUILD"] },
      }).ok,
    ).toBe(false);
  });
});
