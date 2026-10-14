import { describe, expect, it } from "vitest";
import {
  RelationshipPipelineExportQuerySchema,
  RelationshipPipelineQuerySchema,
} from "../src/http/relationship-pipeline.js";
describe("pipeline trust boundary", () => {
  it("rejects client authority and unknown mutable stages", () => {
    expect(
      RelationshipPipelineQuerySchema.safeParse({ tenantId: "forged" }).success,
    ).toBe(false);
    expect(
      RelationshipPipelineQuerySchema.safeParse({ state: "HOT_DEAL" }).success,
    ).toBe(false);
  });
  it("bounds search/page/cursor work", () => {
    expect(
      RelationshipPipelineQuerySchema.safeParse({ q: "x".repeat(121) }).success,
    ).toBe(false);
    expect(
      RelationshipPipelineQuerySchema.safeParse({ pageSize: 51 }).success,
    ).toBe(false);
    expect(
      RelationshipPipelineQuerySchema.parse({ pageSize: "25" }).pageSize,
    ).toBe(25);
  });
  it("refuses a page cursor or arbitrary source IDs in export scope", () => {
    expect(
      RelationshipPipelineExportQuerySchema.safeParse({ cursor: "x" }).success,
    ).toBe(false);
    expect(
      RelationshipPipelineExportQuerySchema.safeParse({
        selected: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(RelationshipPipelineExportQuerySchema.parse({}).selected).toEqual(
      [],
    );
  });
});
