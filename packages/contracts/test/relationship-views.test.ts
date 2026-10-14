import { describe, expect, it } from "vitest";
import {
  SaveRelationshipViewRequestSchema,
  SavedRelationshipViewListSchema,
} from "../src/http/relationship-views.js";
const view = {
  name: "Connected",
  scope: "PERSONAL",
  query: { state: "CONNECTED" },
  layout: "table",
  columns: ["state", "next"],
  expectedVersion: 0,
};
describe("saved pipeline preferences boundary", () => {
  it("reuses canonical pipeline definitions without persisting cursor or authority", () => {
    expect(SaveRelationshipViewRequestSchema.safeParse(view).success).toBe(
      true,
    );
    for (const query of [
      { cursor: "stale" },
      { tenantId: "forged" },
      { selected: ["private-record"] },
      { state: "HOT_DEAL" },
    ]) {
      expect(
        SaveRelationshipViewRequestSchema.safeParse({ ...view, query }).success,
      ).toBe(false);
    }
    expect(
      SaveRelationshipViewRequestSchema.safeParse({
        ...view,
        ownerUserId: "someone",
      }).success,
    ).toBe(false);
  });
  it("refuses notes and business-state fields in presentation preferences", () => {
    for (const extra of [
      { notes: "private founder note" },
      { evidence: ["document-id"] },
      { stage: "APPROVED" },
    ]) {
      expect(
        SaveRelationshipViewRequestSchema.safeParse({ ...view, ...extra })
          .success,
      ).toBe(false);
    }
  });
  it("bounds versions and displayed server views", () => {
    expect(
      SaveRelationshipViewRequestSchema.safeParse({
        ...view,
        expectedVersion: -1,
      }).success,
    ).toBe(false);
    expect(
      SavedRelationshipViewListSchema.safeParse({
        items: [],
        teamEditable: false,
      }).success,
    ).toBe(true);
  });
});
