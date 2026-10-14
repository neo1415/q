import { describe, it, expect } from "vitest";
import {
  RelationshipQuerySchema,
  RelationshipViewDefinitionSchema,
  SaveRelationshipViewRequestSchema,
  type RelationshipSummaryDto,
} from "@capital-q/contracts";
import {
  filterRelationshipView,
  queryRelationships,
  relationshipViewCsv,
} from "../src/application/relationship-query.js";
const one: RelationshipSummaryDto = {
  relationshipId: "00000000-0000-4000-8000-000000000001",
  counterpart: {
    kind: "COMPANY",
    id: "00000000-0000-4000-8000-000000000011",
    name: "Acme",
  },
  state: "CONNECTED",
  stateSince: "2026-10-14T08:00:00.000Z",
  nextStep: "NONE",
};
const two: RelationshipSummaryDto = {
  ...one,
  relationshipId: "00000000-0000-4000-8000-000000000002",
  counterpart: { ...one.counterpart, name: "Beta" },
  state: "IN_DILIGENCE",
};
describe("authorized relationship presentation", () => {
  it("combines name and canonical state without mutating source", () => {
    const original = structuredClone([one, two]);
    expect(
      filterRelationshipView(
        original,
        RelationshipViewDefinitionSchema.parse({
          nameQuery: "aC",
          states: ["CONNECTED"],
        }),
      ),
    ).toEqual([one]);
    expect(original).toEqual([one, two]);
  });
  it("never broadens missing results", () => {
    expect(
      filterRelationshipView(
        [one],
        RelationshipViewDefinitionSchema.parse({ nameQuery: "Beta" }),
      ),
    ).toEqual([]);
  });
  it("sorts stably with id tie breaker", () => {
    expect(
      filterRelationshipView(
        [two, one],
        RelationshipViewDefinitionSchema.parse({ sort: "RECENT" }),
      ),
    ).toEqual([one, two]);
  });
  it("pages without duplicates", () => {
    const query = RelationshipQuerySchema.parse({ limit: 1 });
    const first = queryRelationships([one, two], query);
    expect(first.items).toEqual([one]);
    const second = queryRelationships([one, two], {
      ...query,
      cursor: first.nextCursor,
    });
    expect(second.items).toEqual([two]);
    expect(second.nextCursor).toBeNull();
  });
  it("rejects a cursor from a different filter", () => {
    const query = RelationshipQuerySchema.parse({ limit: 1 });
    const cursor = queryRelationships([one, two], query).nextCursor;
    expect(() =>
      queryRelationships([one, two], { ...query, nameQuery: "Beta", cursor }),
    ).toThrow("RELATIONSHIP_CURSOR_STALE");
  });
  it("invalidates after visibility loss", () => {
    const query = RelationshipQuerySchema.parse({ limit: 1 });
    const cursor = queryRelationships([one, two], query).nextCursor;
    expect(() => queryRelationships([two], { ...query, cursor })).toThrow(
      "RELATIONSHIP_CURSOR_STALE",
    );
  });
  it("flags existing source capacity honestly", () => {
    expect(
      queryRelationships(
        Array.from({ length: 200 }, () => one),
        RelationshipQuerySchema.parse({}),
      ).sourceMayBeTruncated,
    ).toBe(true);
  });
  it("neutralizes spreadsheet formulas and quotes CSV", () => {
    const unsafe = {
      ...one,
      counterpart: { ...one.counterpart, name: ' =HYPERLINK("evil")' },
    };
    expect(relationshipViewCsv([unsafe])).toContain(
      '"\' =HYPERLINK(""evil"")"',
    );
  });
  it("exports no private digest, notes or identifiers", () => {
    expect(relationshipViewCsv([one])).not.toContain(one.relationshipId);
    expect(relationshipViewCsv([one])).toContain('"Acme","CONNECTED"');
  });
  it("rejects fabricated states and arbitrary preference payload", () => {
    expect(
      RelationshipViewDefinitionSchema.safeParse({ states: ["HOT_LEAD"] })
        .success,
    ).toBe(false);
    expect(
      SaveRelationshipViewRequestSchema.safeParse({
        name: "Private",
        scope: "PERSONAL",
        definition: { privateNotes: "secret" },
        expectedVersion: 0,
      }).success,
    ).toBe(false);
  });
});
