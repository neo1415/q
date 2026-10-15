import { describe, expect, it } from "vitest";

import {
  RelationshipViewVersionSchema,
  SaveRelationshipViewRequestSchema,
  SavedRelationshipViewSchema,
} from "../src/index.js";

const save = {
  name: "Connected",
  query: { state: "CONNECTED", sort: "recent" },
  layout: "table",
  columns: ["state", "next"],
  scope: "PERSONAL",
  expectedVersion: 0,
};

describe("CRM saved views contract", () => {
  it("accepts a presentation-only view", () => {
    expect(SaveRelationshipViewRequestSchema.parse(save).name).toBe(
      "Connected",
    );
  });

  it("never persists a cursor, a selection or a note", () => {
    for (const extra of [
      { query: { cursor: "abc" } },
      { selected: ["00000000-0000-4000-8000-000000000001"] },
      { notes: "private" },
    ]) {
      expect(
        SaveRelationshipViewRequestSchema.safeParse({ ...save, ...extra })
          .success,
      ).toBe(false);
    }
  });

  it("rejects repeated or unknown columns and blank names", () => {
    for (const extra of [
      { columns: ["state", "state"] },
      { columns: ["revenue"] },
      { name: "   " },
      { scope: "PUBLIC" },
      { layout: "map" },
    ]) {
      expect(
        SaveRelationshipViewRequestSchema.safeParse({ ...save, ...extra })
          .success,
      ).toBe(false);
    }
  });

  it("reads a view and a delete version", () => {
    expect(
      SavedRelationshipViewSchema.parse({
        id: "00000000-0000-4000-8000-000000000005",
        name: "Team pipeline",
        query: {},
        layout: "board",
        columns: [],
        scope: "ORGANISATION",
        version: 2,
        updatedAt: "2026-10-15T10:00:00.000Z",
        editable: false,
      }).scope,
    ).toBe("ORGANISATION");
    expect(RelationshipViewVersionSchema.parse("3")).toBe(3);
    expect(RelationshipViewVersionSchema.safeParse("0").success).toBe(false);
  });
});
