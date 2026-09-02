import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CausationIdSchema,
  CorrelationIdSchema,
  createUuidIdSchema,
  RequestIdSchema,
  UuidSchema,
} from "../src/common/ids.js";

const UUID_V4 = "123e4567-e89b-12d3-a456-426614174000";
const UUID_V7 = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";

describe("UuidSchema", () => {
  it("accepts architecture-approved UUID forms", () => {
    // No version is pinned: v4 and v7 are both permitted by the data model.
    expect(UuidSchema.parse(UUID_V4)).toBe(UUID_V4);
    expect(UuidSchema.parse(UUID_V7)).toBe(UUID_V7);
  });

  it.each([
    "nope",
    "123e4567e89b12d3a456426614174000",
    "123e4567-e89b-12d3-a456-42661417400",
    "",
    "1",
    "00000000-0000-0000-0000-00000000000g",
  ])("rejects the malformed identifier %s", (value) => {
    expect(UuidSchema.safeParse(value).success).toBe(false);
  });

  it("rejects sequential numeric identifiers", () => {
    expect(UuidSchema.safeParse(1).success).toBe(false);
    expect(UuidSchema.safeParse("1").success).toBe(false);
  });

  it("keeps the wire representation a plain string", () => {
    const parsed: unknown = UuidSchema.parse(UUID_V4);
    expect(typeof parsed).toBe("string");
    expect(JSON.stringify({ id: parsed })).toBe(`{"id":"${UUID_V4}"}`);
  });
});

describe("createUuidIdSchema", () => {
  const CompanyIdSchema = createUuidIdSchema("CompanyId");
  // Only its inferred type is used below; the schema value itself is not
  // exercised at runtime in this case.
  const _InvestorOrganisationIdSchema = createUuidIdSchema(
    "InvestorOrganisationId",
  );

  it("produces a working UUID schema", () => {
    expect(CompanyIdSchema.parse(UUID_V4)).toBe(UUID_V4);
    expect(CompanyIdSchema.safeParse("nope").success).toBe(false);
  });

  it("brands only in the type system, not on the wire", () => {
    const id = CompanyIdSchema.parse(UUID_V4);
    expect(typeof id).toBe("string");
    expect(JSON.parse(JSON.stringify({ id })) as unknown).toEqual({
      id: UUID_V4,
    });
  });

  it("makes different domain identifiers mutually unassignable", () => {
    type CompanyId = z.infer<typeof CompanyIdSchema>;
    type InvestorOrganisationId = z.infer<typeof _InvestorOrganisationIdSchema>;

    const companyId: CompanyId = CompanyIdSchema.parse(UUID_V4);

    // The whole point of branding: passing a CompanyId where an
    // InvestorOrganisationId is required must not compile. If this assignment
    // ever starts succeeding, the brand has been lost and the compiler has
    // stopped catching swapped identifiers.
    // @ts-expect-error a CompanyId is not an InvestorOrganisationId
    const wrong: InvestorOrganisationId = companyId;

    expect(typeof wrong).toBe("string");
  });
});

describe("infrastructure correlation identifiers", () => {
  // These literals are exactly what @capital-q/observability generates. They
  // are what keeps the two packages agreeing without a dependency between them.
  const REQUEST_ID = `req_${UUID_V4}`;
  const CORRELATION_ID = `cor_${UUID_V4}`;
  const CAUSATION_ID = `cau_${UUID_V4}`;

  it("accepts the format observability actually emits", () => {
    expect(RequestIdSchema.parse(REQUEST_ID)).toBe(REQUEST_ID);
    expect(CorrelationIdSchema.parse(CORRELATION_ID)).toBe(CORRELATION_ID);
    expect(CausationIdSchema.parse(CAUSATION_ID)).toBe(CAUSATION_ID);
  });

  it("keeps the three kinds distinct rather than interchangeable", () => {
    // A correlation id passed where a request id belongs must fail, so a
    // mis-wired identifier surfaces at the boundary instead of propagating.
    expect(RequestIdSchema.safeParse(CORRELATION_ID).success).toBe(false);
    expect(CorrelationIdSchema.safeParse(REQUEST_ID).success).toBe(false);
    expect(CausationIdSchema.safeParse(CORRELATION_ID).success).toBe(false);
  });

  it("rejects a bare uuid and a malformed suffix", () => {
    expect(RequestIdSchema.safeParse(UUID_V4).success).toBe(false);
    expect(RequestIdSchema.safeParse("req_not-a-uuid").success).toBe(false);
    expect(RequestIdSchema.safeParse("req_").success).toBe(false);
  });
});
