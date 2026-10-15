import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { readHistories } from "../src/application/relationship-projection.js";
import { createListRelationshipsForInvestor } from "../src/application/relationship-status.js";

/**
 * S5 (lane S, live 2026-10-15): a cold arrival snapshot spent 92 of its
 * 126 round trips on four reads per relationship (visibility, policies,
 * company, history). Batched, the list reads the same things once for the
 * whole list and returns exactly what the per-relationship path returns.
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

type Event = {
  readonly id: string;
  readonly relationshipId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly visibilityScope: string;
  readonly occurredAt: string;
  readonly actor: { readonly type: string; readonly id: string | null };
  readonly source: { readonly type: string; readonly id: string | null };
  readonly payload: Record<string, unknown>;
  readonly tenantId: string;
  readonly correlationId: string | null;
  readonly createdAt: string;
};

function event(relationshipId: string, sequence: number, type: string): Event {
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

function world(options: { batched: boolean; longHistory?: boolean }) {
  const companies = [randomUUID(), randomUUID(), randomUUID()];
  const hidden = companies[1] ?? "";
  const relationships = companies.map((companyId) => ({
    id: randomUUID(),
    tenantId: TENANT,
    companyId,
    investorOrganisationId: INVESTOR,
    currentState: "INTEREST_EXPRESSED",
    stateUpdatedAt: "2026-10-01T00:00:00.000Z",
    firstDiscoveredAt: "2026-10-01T00:00:00.000Z",
    lastEventSequence: 2,
    createdAt: "2026-10-01T00:00:00.000Z",
  }));
  const histories = new Map<string, Event[]>(
    relationships.map((r, index) => [
      r.id,
      index === 0 && options.longHistory === true
        ? Array.from({ length: 1_203 }, (_, n) =>
            event(r.id, n + 1, n === 0 ? "discovered" : "interest_expressed"),
          )
        : [event(r.id, 1, "discovered"), event(r.id, 2, "interest_expressed")],
    ]),
  );
  const calls = { visibility: 0, companies: 0, histories: 0, pages: 0 };
  const page = (id: string, after: number, limit: number) =>
    (histories.get(id) ?? []).filter((e) => e.sequence > after).slice(0, limit);
  const dependencies = {
    sql: {},
    investorSubject: {
      investorOrganisationFor: () =>
        Promise.resolve({ investorOrganisationId: INVESTOR }),
    },
    authorization: { requireCapability: () => Promise.resolve() },
    repositories: {
      relationships: {
        listByInvestorOrganisation: () => Promise.resolve(relationships),
      },
      events: {
        listByRelationship: (
          _sql: unknown,
          id: string,
          p: { afterSequence?: number; limit: number },
        ) => {
          calls.pages += 1;
          return Promise.resolve(page(id, p.afterSequence ?? 0, p.limit));
        },
        ...(options.batched
          ? {
              listFirstByRelationships: (
                _sql: unknown,
                ids: readonly string[],
                limit: number,
              ) => {
                calls.histories += 1;
                return Promise.resolve(ids.flatMap((id) => page(id, 0, limit)));
              },
            }
          : {}),
      },
    },
    companyVisibility: {
      isVisibleToInvestor: (_actor: unknown, id: string) => {
        calls.visibility += 1;
        return Promise.resolve(id !== hidden);
      },
      ...(options.batched
        ? {
            visibleToInvestorAmong: (
              _actor: unknown,
              ids: readonly string[],
            ) => {
              calls.visibility += 1;
              return Promise.resolve(
                new Set(ids.filter((id) => id !== hidden)),
              );
            },
          }
        : {}),
    },
    companies: {
      findCanonicalCompany: (id: string) => {
        calls.companies += 1;
        return Promise.resolve({
          id,
          tenantId: TENANT,
          organisationId: randomUUID(),
          canonicalName: `Co ${id.slice(0, 4)}`,
          companyStatus: "active",
        });
      },
      ...(options.batched
        ? {
            findCanonicalCompanies: (ids: readonly string[]) => {
              calls.companies += 1;
              return Promise.resolve(
                ids.map((id) => ({
                  id,
                  tenantId: TENANT,
                  organisationId: randomUUID(),
                  canonicalName: `Co ${id.slice(0, 4)}`,
                  companyStatus: "active",
                })),
              );
            },
          }
        : {}),
    },
  };
  return { dependencies, calls, hidden, relationships, histories };
}

const shape = (
  listings: readonly {
    readonly relationship: { readonly id: string };
    readonly counterpartName: string;
    readonly projection: { readonly state: string };
    readonly visibleHistory: readonly unknown[];
  }[],
) =>
  listings.map((l) => ({
    id: l.relationship.id,
    name: l.counterpartName,
    state: l.projection.state,
    events: l.visibleHistory.length,
  }));

describe("S5: a relationship list read in batches", () => {
  it("returns exactly what the per-relationship path returns, in list order", async () => {
    const one = world({ batched: false });
    const batched = world({ batched: true });
    // Same rows in both worlds, so compare their shapes.
    const before = await createListRelationshipsForInvestor(
      one.dependencies as never,
    )({ actor: actor as never });
    const after = await createListRelationshipsForInvestor(
      batched.dependencies as never,
    )({ actor: actor as never });
    expect(after.map((l) => l.relationship.id)).toEqual(
      batched.relationships
        .filter((r) => r.companyId !== batched.hidden)
        .map((r) => r.id),
    );
    expect(shape(after).map(({ id: _id, name: _n, ...rest }) => rest)).toEqual(
      shape(before).map(({ id: _id, name: _n, ...rest }) => rest),
    );
    // Per relationship before; once for the whole list after.
    expect(one.calls).toMatchObject({ visibility: 3, companies: 2 });
    expect(batched.calls).toEqual({
      visibility: 1,
      companies: 1,
      histories: 1,
      pages: 0,
    });
  });

  it("never reads anything more of a company out of the investor's sight", async () => {
    const w = world({ batched: true });
    const listed = await createListRelationshipsForInvestor(
      w.dependencies as never,
    )({ actor: actor as never });
    expect(listed.some((l) => l.relationship.companyId === w.hidden)).toBe(
      false,
    );
  });

  it("readHistories continues a full first page exactly as readHistory does", async () => {
    const w = world({ batched: true, longHistory: true });
    const ids = w.relationships.map((r) => r.id);
    const out = await readHistories(w.dependencies as never, ids as never);
    for (const id of ids) {
      expect(out.get(id as never)?.map((e) => e.sequence)).toEqual(
        w.histories.get(id)?.map((e) => e.sequence),
      );
    }
    // 1,203 events: the first 500 in the batch, then two more pages.
    expect(w.calls.histories).toBe(1);
    expect(w.calls.pages).toBe(2);
  });
});
