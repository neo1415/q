import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createListConnectionRequests } from "../src/application/connection-requests.js";

/**
 * Coordinator 2026-10-26 (live 8965cbe4, equator-line: "How do the top two
 * stack up?" spent 996 of its 1,058 round trips in fit_top_candidates):
 * the investor's inbox read each request's company with its own query, one
 * after another, up to 200 a call. One read now serves every request, and
 * the inbox says exactly what it said before.
 */

const TENANT = randomUUID();
const ORG = randomUUID();
const INVESTOR = randomUUID();
const actor = {
  tenantId: TENANT,
  userId: randomUUID(),
  organisationId: ORG,
  membershipId: randomUUID(),
  actorType: "HUMAN",
} as const;

function world(requests: number, options: { batched: boolean }) {
  const companies = Array.from({ length: Math.max(1, requests / 2) }, () =>
    randomUUID(),
  );
  // Two requests per company, and one company that no longer exists.
  const listed = Array.from({ length: requests }, (_, n) => ({
    id: randomUUID(),
    companyId:
      n === requests - 1
        ? randomUUID()
        : (companies[n % companies.length] ?? ""),
    investorOrganisationId: INVESTOR,
  }));
  const reads = { one: 0, many: 0 };
  const identity = (id: string) => ({
    id,
    tenantId: TENANT,
    organisationId: randomUUID(),
    canonicalName: `Company ${id.slice(0, 4)}`,
    companyStatus: "active",
  });
  const known = new Set<string>(companies);
  const list = createListConnectionRequests({
    sql: {},
    investorSubject: {
      investorOrganisationFor: () =>
        Promise.resolve({ investorOrganisationId: INVESTOR }),
    },
    authorization: { requireCapability: () => Promise.resolve() },
    interests: { listByInvestor: () => Promise.resolve(listed) },
    companies: {
      findCanonicalCompany: (id: string) => {
        reads.one += 1;
        return Promise.resolve(known.has(id) ? identity(id) : null);
      },
      ...(options.batched
        ? {
            findCanonicalCompanies: (ids: readonly string[]) => {
              reads.many += 1;
              return Promise.resolve(
                ids.filter((id) => known.has(id)).map(identity),
              );
            },
          }
        : {}),
    },
  } as never);
  return { list, reads, listed };
}

describe("the investor's inbox reads its companies in one go", () => {
  it.each([4, 60, 200])(
    "%i requests: one company read, whatever the count",
    async (count) => {
      const { list, reads } = world(count, { batched: true });
      const out = await list({ actor: actor as never });
      expect(reads).toEqual({ one: 0, many: 1 });
      // The request whose company is gone is left out, as before.
      expect(out).toHaveLength(count - 1);
    },
  );

  it("says the same as the one-by-one read, in the same order", async () => {
    const batched = world(10, { batched: true });
    const single = world(10, { batched: false });
    // Same requests in both worlds.
    const a = await batched.list({ actor: actor as never });
    expect(a.map((one) => one.interest.id)).toEqual(
      batched.listed.slice(0, -1).map((one) => one.id),
    );
    const b = await single.list({ actor: actor as never });
    expect(b.map((one) => one.interest.id)).toEqual(
      single.listed.slice(0, -1).map((one) => one.id),
    );
    // Without the batch read, one read per distinct company.
    expect(single.reads.one).toBe(6);
  });
});
