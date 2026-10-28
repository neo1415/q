import { describe, expect, it } from "vitest";

import { PERSONAL_BOOTSTRAP_TENANT_ID } from "@capital-q/security";

import { isSyntheticSubject } from "../src/index.js";

const tenant = "7d0f8f4e-2a8c-4c8e-9a51-3c1f5b1e6a10";
const user = "1b6c1f8e-6d3a-4f0b-8f2e-9c4d2a7b5e31";
const facts = (
  personSynthetic: boolean,
  tenantHasRealMember: boolean,
  tenantHasMembers = true,
) => ({ personSynthetic, tenantHasRealMember, tenantHasMembers });

describe("isSyntheticSubject (owner 2026-10-28: demo world vs real sign-ups)", () => {
  it("a seeded person in an all-synthetic tenant is synthetic", () => {
    expect(
      isSyntheticSubject(
        { tenantId: tenant, userId: user },
        facts(true, false),
      ),
    ).toBe(true);
  });

  it("a real person is a customer, wherever they are", () => {
    expect(
      isSyntheticSubject(
        { tenantId: tenant, userId: user },
        facts(false, true),
      ),
    ).toBe(false);
    expect(
      isSyntheticSubject(
        { tenantId: PERSONAL_BOOTSTRAP_TENANT_ID, userId: user },
        facts(false, true),
      ),
    ).toBe(false);
  });

  it("one real member makes the whole tenant a customer's", () => {
    expect(
      isSyntheticSubject({ tenantId: tenant, userId: user }, facts(true, true)),
    ).toBe(false);
    expect(isSyntheticSubject({ tenantId: tenant }, facts(true, true))).toBe(
      false,
    );
  });

  it("a job naming no person is synthetic only for an all-synthetic tenant with members", () => {
    expect(isSyntheticSubject({ tenantId: tenant }, facts(true, false))).toBe(
      true,
    );
    expect(
      isSyntheticSubject({ tenantId: tenant }, facts(true, false, false)),
    ).toBe(false);
  });

  it("before their first organisation the person decides alone; nobody named is a customer", () => {
    expect(
      isSyntheticSubject(
        { tenantId: PERSONAL_BOOTSTRAP_TENANT_ID, userId: user },
        facts(true, true),
      ),
    ).toBe(true);
    expect(
      isSyntheticSubject(
        { tenantId: PERSONAL_BOOTSTRAP_TENANT_ID },
        facts(true, false),
      ),
    ).toBe(false);
  });
});
