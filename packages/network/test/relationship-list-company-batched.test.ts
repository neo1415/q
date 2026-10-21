import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createListRelationshipsForCompany } from "../src/application/relationship-status.js";

/**
 * Speed lane 2026-10-20: a company's relationship list named each investor
 * with its own read (one per relationship, in a founder's cold arrival
 * snapshot). Batched, the names come from one read for the whole list and
 * the list is exactly what the per-relationship path returns.
 */

const TENANT = randomUUID();
const ORG = randomUUID();
const COMPANY = randomUUID();
const actor = {
  tenantId: TENANT,
  userId: randomUUID(),
  organisationId: ORG,
  membershipId: randomUUID(),
  actorType: "HUMAN",
} as const;

function event(relationshipId: string, sequence: number, type: string) {
  const at = new Date(Date.UTC(2026, 9, 1, 0, sequence)).toISOString();
  return {
    id: randomUUID(),
    tenantId: TENANT,
    relationshipId,
    sequence,
    eventType: type,
    visibilityScope: "relationship_shared",
    occurredAt: at,
    actor: { type: "USER", id: actor.userId },
    source: { type: "SYSTEM", id: null },
    payload: {},
    correlationId: null,
    createdAt: at,
  };
}

function world(options: { readonly batched: boolean }) {
  const investors = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const relationships = investors.map((investorOrganisationId) => ({
    id: randomUUID(),
    tenantId: TENANT,
    companyId: COMPANY,
    investorOrganisationId,
    currentState: "INTEREST_EXPRESSED",
    stateUpdatedAt: "2026-10-01T00:00:00.000Z",
    firstDiscoveredAt: "2026-10-01T00:00:00.000Z",
    lastEventSequence: 2,
    createdAt: "2026-10-01T00:00:00.000Z",
  }));
  // The last investor's organisation no longer exists: never listed.
  const gone = investors[3] ?? "";
  const histories = new Map<string, ReturnType<typeof event>[]>(
    relationships.map((r) => [
      r.id,
      [event(r.id, 1, "discovered"), event(r.id, 2, "interest_expressed")],
    ]),
  );
  const calls = { investor: 0, investors: 0, histories: 0, pages: 0 };
  const identity = (id: string) => ({
    id,
    tenantId: randomUUID(),
    organisationId: randomUUID(),
    investorType: "VC",
    displayName: `Fund ${id.slice(0, 4)}`,
    deploymentState: "ACTIVE",
  });
  const dependencies = {
    sql: {},
    authorization: { requireCapability: () => Promise.resolve() },
    companies: {
      findCanonicalCompany: (id: string) =>
        Promise.resolve({
          id,
          tenantId: TENANT,
          organisationId: ORG,
          canonicalName: "Zino Aviation",
          companyStatus: "active",
        }),
    },
    repositories: {
      relationships: { listByCompany: () => Promise.resolve(relationships) },
      events: {
        listByRelationship: (
          _sql: unknown,
          id: string,
          p: { afterSequence?: number; limit: number },
        ) => {
          calls.pages += 1;
          return Promise.resolve(
            (histories.get(id) ?? [])
              .filter((e) => e.sequence > (p.afterSequence ?? 0))
              .slice(0, p.limit),
          );
        },
        listFirstByRelationships: (
          _sql: unknown,
          ids: readonly string[],
          limit: number,
        ) => {
          calls.histories += 1;
          return Promise.resolve(
            ids.flatMap((id) => (histories.get(id) ?? []).slice(0, limit)),
          );
        },
      },
    },
    investors: {
      findCanonicalInvestorOrganisation: (id: string) => {
        calls.investor += 1;
        return Promise.resolve(id === gone ? null : identity(id));
      },
      ...(options.batched
        ? {
            findCanonicalInvestorOrganisations: (ids: readonly string[]) => {
              calls.investors += 1;
              return Promise.resolve(
                ids.filter((id) => id !== gone).map(identity),
              );
            },
          }
        : {}),
    },
  };
  return { dependencies, calls, relationships, gone };
}

const shape = (
  listings: readonly {
    readonly relationship: { readonly id: string };
    readonly counterpartName: string;
    readonly projection: { readonly state: string };
  }[],
) =>
  listings.map((l) => ({
    id: l.relationship.id,
    name: l.counterpartName,
    state: l.projection.state,
  }));

describe("a company's relationship list, investors named in one read", () => {
  it("returns exactly what the per-relationship path returns, in list order", async () => {
    const w = world({ batched: true });
    // The same world read both ways: without the batched read, then with it.
    const { findCanonicalInvestorOrganisations: _many, ...single } =
      w.dependencies.investors;
    const before = await createListRelationshipsForCompany({
      ...w.dependencies,
      investors: single,
    } as never)({ actor: actor as never, companyId: COMPANY });
    const perRow = { ...w.calls };
    const after = await createListRelationshipsForCompany(
      w.dependencies as never,
    )({ actor: actor as never, companyId: COMPANY });
    expect(shape(after)).toEqual(shape(before));
    expect(before.length).toBe(w.relationships.length - 1);
    expect(
      after.some((l) => l.relationship.investorOrganisationId === w.gone),
    ).toBe(false);
    // Before: one investor read per relationship. After: one for the list.
    expect(perRow).toMatchObject({
      investor: w.relationships.length,
      investors: 0,
    });
    expect(w.calls.investor - perRow.investor).toBe(0);
    expect(w.calls.investors - perRow.investors).toBe(1);
  });

  it("names each investor from the batched read", async () => {
    const w = world({ batched: true });
    const listed = await createListRelationshipsForCompany(
      w.dependencies as never,
    )({ actor: actor as never, companyId: COMPANY });
    for (const listing of listed) {
      expect(listing.counterpartName).toBe(
        `Fund ${listing.relationship.investorOrganisationId.slice(0, 4)}`,
      );
    }
    expect(listed).toHaveLength(w.relationships.length - 1);
  });
});
