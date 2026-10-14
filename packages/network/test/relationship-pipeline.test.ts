import { describe, expect, it } from "vitest";
import type { RelationshipSummaryDto } from "@capital-q/contracts";
import {
  relationshipPipelineExportRows,
  selectRelationshipPipeline,
} from "../src/application/relationship-pipeline.js";
import {
  InterestNotFoundError,
  RelationshipPipelineQueryError,
} from "../src/domain/errors.js";
const row = (
  n: number,
  name: string,
  state: RelationshipSummaryDto["state"] = "CONNECTED",
): RelationshipSummaryDto => ({
  relationshipId: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  counterpart: {
    kind: "COMPANY",
    id: `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name,
  },
  state,
  stateSince: "2026-10-14T01:00:00.000Z",
  nextStep: "SCHEDULE_MEETING",
});
const rows = [row(2, "Same"), row(1, "Same"), row(3, "Other", "IN_DILIGENCE")];
describe("authorised relationship pipeline", () => {
  it("filters party-visible state and names without scoring", () => {
    expect(
      selectRelationshipPipeline(
        rows,
        { q: "same", state: "CONNECTED" },
        "actor",
      ).items.map((r) => r.relationshipId),
    ).toEqual([rows[1]?.relationshipId, rows[0]?.relationshipId]);
    expect(
      selectRelationshipPipeline(rows, { state: "PAUSED" }, "actor").total,
    ).toBe(0);
  });
  it("pages stable duplicate sort keys without omissions or repeats", () => {
    const first = selectRelationshipPipeline(
      rows,
      { sort: "name", pageSize: 1 },
      "actor",
    );
    expect(first.nextCursor).not.toBeNull();
    const second = selectRelationshipPipeline(
      rows,
      { sort: "name", pageSize: 1, cursor: first.nextCursor ?? undefined },
      "actor",
    );
    const third = selectRelationshipPipeline(
      rows,
      { sort: "name", pageSize: 1, cursor: second.nextCursor ?? undefined },
      "actor",
    );
    expect(
      new Set(
        [...first.items, ...second.items, ...third.items].map(
          (r) => r.relationshipId,
        ),
      ).size,
    ).toBe(3);
    expect(third.nextCursor).toBeNull();
  });
  it.each([
    { sort: "oldest" as const, pageSize: 1 },
    { sort: "name" as const, pageSize: 2 },
    { q: "Same", sort: "name" as const, pageSize: 1 },
    { state: "CONNECTED" as const, sort: "name" as const, pageSize: 1 },
  ])("binds cursors to filters/sort/page size", (changed) => {
    const cursor = selectRelationshipPipeline(
      rows,
      { sort: "name", pageSize: 1 },
      "actor",
    ).nextCursor;
    expect(() =>
      selectRelationshipPipeline(
        rows,
        { ...changed, cursor: cursor ?? undefined },
        "actor",
      ),
    ).toThrow(RelationshipPipelineQueryError);
  });
  it("rejects cross-user/org cursors without importing their scope", () => {
    const cursor = selectRelationshipPipeline(
      rows,
      { pageSize: 1 },
      "tenant:user:org",
    ).nextCursor;
    expect(() =>
      selectRelationshipPipeline(
        rows,
        { pageSize: 1, cursor: cursor ?? undefined },
        "other:actor:org",
      ),
    ).toThrow(RelationshipPipelineQueryError);
  });
  it("fails stale/revoked page boundaries instead of exposing stale rows", () => {
    const page = selectRelationshipPipeline(rows, { pageSize: 1 }, "actor");
    expect(() =>
      selectRelationshipPipeline(
        rows.filter((r) => r.relationshipId !== page.items[0]?.relationshipId),
        { pageSize: 1, cursor: page.nextCursor ?? undefined },
        "actor",
      ),
    ).toThrow(RelationshipPipelineQueryError);
  });
  it("rejects malformed cursor", () => {
    expect(() =>
      selectRelationshipPipeline(rows, { cursor: "garbage" }, "actor"),
    ).toThrow(RelationshipPipelineQueryError);
  });
  it("exports the entire matching filter, not just one page", () => {
    expect(
      relationshipPipelineExportRows(rows, { q: "Same" }, []).map(
        (r) => r.relationshipId,
      ),
    ).toEqual([rows[1]?.relationshipId, rows[0]?.relationshipId]);
  });
  it("exports only selected IDs still in the exact matching authorised scope", () => {
    const selected = rows[1];
    if (selected === undefined) throw new Error("Fixture missing");
    expect(
      relationshipPipelineExportRows(rows, { state: "CONNECTED" }, [
        selected.relationshipId,
      ]),
    ).toEqual([selected]);
    expect(() =>
      relationshipPipelineExportRows(rows, { state: "IN_DILIGENCE" }, [
        selected.relationshipId,
      ]),
    ).toThrow(InterestNotFoundError);
    expect(() =>
      relationshipPipelineExportRows(rows, {}, [
        "a0000000-0000-4000-8000-999999999999",
      ]),
    ).toThrow(InterestNotFoundError);
    expect(() =>
      relationshipPipelineExportRows(rows, {}, [
        selected.relationshipId,
        selected.relationshipId,
      ]),
    ).toThrow(InterestNotFoundError);
  });
});
