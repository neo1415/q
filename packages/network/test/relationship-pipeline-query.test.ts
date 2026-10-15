import { describe, expect, it, vi } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import {
  createRelationshipPipelineQuery,
  PIPELINE_REPAIR_LIMIT,
} from "../src/application/relationship-pipeline-query.js";
import {
  RelationshipPipelineLimitError,
  RelationshipPipelineQueryError,
} from "../src/domain/errors.js";
import type { PipelinePageRow } from "../src/infrastructure/postgres-relationship-party-states.js";

const actor = ActorContextSchema.parse({
  userId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000003",
  membershipId: "00000000-0000-4000-8000-000000000004",
  actorType: "HUMAN",
});
const investorId = "00000000-0000-4000-8000-000000000006";
const companyId = "00000000-0000-4000-8000-000000000007";

const row = (n: number): PipelinePageRow => ({
  relationshipId: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  counterpartId: `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  counterpartName: `Company ${String(n)}`,
  state: "CONNECTED",
  stateSince: "2026-10-14T01:00:00.000Z",
  nextStep: "SCHEDULE_MEETING",
  sortKey: `k${String(n).padStart(4, "0")}`,
});

function fixture(
  options: {
    rows?: readonly PipelinePageRow[];
    behind?: readonly string[];
    hidden?: ReadonlySet<string>;
    count?: number;
  } = {},
) {
  const all = options.rows ?? [1, 2, 3, 4, 5].map(row);
  const states = {
    upsert: vi.fn(() => Promise.resolve(true)),
    behind: vi.fn(() => Promise.resolve(options.behind ?? [])),
    count: vi.fn(() => Promise.resolve(options.count ?? all.length)),
    page: vi.fn(
      (
        _sql: unknown,
        _filter: unknown,
        _sort: unknown,
        after: { key: string } | null,
        limit: number,
      ) =>
        Promise.resolve(
          all
            .filter((entry) => after === null || entry.sortKey > after.key)
            .slice(0, limit),
        ),
    ),
  };
  const visibility = vi.fn((_actor: unknown, id: string) =>
    Promise.resolve(!(options.hidden ?? new Set()).has(id)),
  );
  const events = {
    listByRelationship: vi.fn(() =>
      Promise.resolve([
        {
          sequence: 1,
          eventType: "network.relationship.created",
          visibilityScope: "investor_private",
          occurredAt: "2026-10-14T01:00:00.000Z",
          payload: {},
        },
      ]),
    ),
  };
  const service = createRelationshipPipelineQuery({
    sql: {} as never,
    repositories: { relationships: {} as never, events: events as never },
    authorization: {
      requireCapability: vi.fn(() => Promise.resolve()),
    } as never,
    companies: {
      findCanonicalCompany: vi.fn(() =>
        Promise.resolve({
          id: companyId,
          tenantId: actor.tenantId,
          organisationId: actor.organisationId,
        }),
      ),
    } as never,
    investorSubject: {
      investorOrganisationFor: vi.fn(() =>
        Promise.resolve({ investorOrganisationId: investorId }),
      ),
    },
    companyVisibility: { isVisibleToInvestor: visibility },
    partyStates: states,
  });
  return { service, states, visibility, events };
}

const page = (
  service: ReturnType<typeof fixture>["service"],
  query: Record<string, unknown> = {},
  companyIdOf?: string,
) =>
  service.page({
    actor,
    companyId: companyIdOf,
    query: { pageSize: 2, ...query },
    actorScope: "scope",
  });

describe("CRM pipeline read model", () => {
  it("pages a company's own relationships with an exact total and a bound cursor", async () => {
    const { service, states, visibility } = fixture();
    const first = await page(service, {}, companyId);
    expect(first?.items.map((item) => item.counterpart.name)).toEqual([
      "Company 1",
      "Company 2",
    ]);
    expect(first).toMatchObject({ total: 5, totalExact: true });
    expect(states.page.mock.calls[0]?.[1]).toMatchObject({
      party: "COMPANY",
      partyId: companyId,
    });
    // The company side has no read-time sight check: its fold is its sight.
    expect(visibility).not.toHaveBeenCalled();
    const second = await page(
      service,
      { cursor: first?.nextCursor ?? undefined },
      companyId,
    );
    expect(second?.items.map((item) => item.counterpart.name)).toEqual([
      "Company 3",
      "Company 4",
    ]);
  });

  it("refuses a cursor made for another query or another actor", async () => {
    const { service } = fixture();
    const first = await page(service);
    await expect(
      page(service, {
        cursor: first?.nextCursor ?? undefined,
        state: "PAUSED",
      }),
    ).rejects.toBeInstanceOf(RelationshipPipelineQueryError);
    await expect(
      page(service, { cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(RelationshipPipelineQueryError);
  });

  it("drops companies out of the investor's sight and fills the page from later rows", async () => {
    const hidden = new Set([row(1).counterpartId, row(2).counterpartId]);
    const { service } = fixture({ hidden });
    const first = await page(service);
    expect(first?.items.map((item) => item.counterpart.name)).toEqual([
      "Company 3",
      "Company 4",
    ]);
    // More rows remain unchecked: the total is an upper bound, and says so.
    expect(first).toMatchObject({ totalExact: false, total: 3 });
  });

  it("reports an exact investor total once every candidate was checked", async () => {
    const { service } = fixture({
      rows: [1, 2].map(row),
      hidden: new Set([row(2).counterpartId]),
    });
    expect(await page(service)).toMatchObject({
      total: 1,
      totalExact: true,
      nextCursor: null,
    });
  });

  it("folds stale rows again from history before reading", async () => {
    const { service, states, events } = fixture({
      behind: ["a0000000-0000-4000-8000-000000000009"],
    });
    await page(service);
    expect(events.listByRelationship).toHaveBeenCalled();
    expect(states.upsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        relationshipId: "a0000000-0000-4000-8000-000000000009",
        party: "INVESTOR",
        sourceSequence: 1,
      }),
    );
  });

  it("defers to the existing path when too many rows are behind", async () => {
    const behind = Array.from(
      { length: PIPELINE_REPAIR_LIMIT + 1 },
      (_, at) => `a0000000-0000-4000-8000-${String(at).padStart(12, "0")}`,
    );
    const { service, states } = fixture({ behind });
    expect(await page(service)).toBeNull();
    expect(states.upsert).not.toHaveBeenCalled();
    expect(states.page).not.toHaveBeenCalled();
  });

  it("exports every visible row in order, and refuses an export too large", async () => {
    const { service } = fixture({ hidden: new Set([row(3).counterpartId]) });
    const rows = await service.all({ actor, query: {} });
    expect(rows?.map((item) => item.counterpart.name)).toEqual([
      "Company 1",
      "Company 2",
      "Company 4",
      "Company 5",
    ]);
    const large = fixture({ count: 5001 });
    await expect(
      large.service.all({ actor, query: {} }),
    ).rejects.toBeInstanceOf(RelationshipPipelineLimitError);
  });
});
