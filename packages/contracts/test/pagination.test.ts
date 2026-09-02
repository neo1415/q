import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createCursorPageSchema,
  CursorPageRequestSchema,
  CursorSchema,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PageSizeSchema,
} from "../src/common/pagination.js";

const CURSOR = "eyJyYW5rIjo0Miwic2xhdGUiOiJhYmMifQ";

describe("CursorSchema", () => {
  it("accepts an opaque server-generated string", () => {
    expect(CursorSchema.parse(CURSOR)).toBe(CURSOR);
  });

  it("rejects an empty cursor", () => {
    expect(CursorSchema.safeParse("").success).toBe(false);
  });

  it("rejects a page number or offset masquerading as a cursor", () => {
    // A cursor is continuation state, not a position.
    expect(CursorSchema.safeParse(2).success).toBe(false);
    expect(CursorSchema.safeParse(0).success).toBe(false);
  });

  it("rejects an implausibly long client-supplied cursor", () => {
    expect(CursorSchema.safeParse("x".repeat(2049)).success).toBe(false);
  });
});

describe("PageSizeSchema", () => {
  it("uses the documented normal-list bounds", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(20);
    expect(MAX_PAGE_SIZE).toBe(100);
  });

  it.each([1, 20, 100])("accepts the page size %i", (size) => {
    expect(PageSizeSchema.parse(size)).toBe(size);
  });

  it.each([0, -1, 101, 999999, 1.5])(
    "rejects the page size %s rather than clamping it",
    (size) => {
      // Silently turning 999999 into 100 would hide a client bug and make the
      // response disagree with the request.
      expect(PageSizeSchema.safeParse(size).success).toBe(false);
    },
  );

  it("rejects a numeric string", () => {
    expect(PageSizeSchema.safeParse("20").success).toBe(false);
  });
});

describe("CursorPageRequestSchema", () => {
  it("accepts a first page with neither cursor nor limit", () => {
    expect(CursorPageRequestSchema.parse({})).toEqual({});
  });

  it("accepts a continuation with both", () => {
    expect(
      CursorPageRequestSchema.parse({ cursor: CURSOR, limit: 50 }),
    ).toEqual({ cursor: CURSOR, limit: 50 });
  });

  it("rejects an invalid limit", () => {
    expect(CursorPageRequestSchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
  });

  it("has no offset or page-number field", () => {
    // Offset pagination skips and duplicates rows as the set changes.
    const parsed: Record<string, unknown> = CursorPageRequestSchema.parse({
      offset: 40,
      page: 3,
    });

    expect(parsed).not.toHaveProperty("offset");
    expect(parsed).not.toHaveProperty("page");
  });
});

describe("createCursorPageSchema", () => {
  const ItemSchema = z.object({ id: z.uuid() });
  const PageSchema = createCursorPageSchema(ItemSchema);
  const ITEM = { id: "123e4567-e89b-12d3-a456-426614174000" };

  it("validates items and an optional next cursor", () => {
    expect(PageSchema.parse({ items: [ITEM], nextCursor: CURSOR })).toEqual({
      items: [ITEM],
      nextCursor: CURSOR,
    });
  });

  it("treats an absent next cursor as the end of the set", () => {
    expect(PageSchema.parse({ items: [] })).toEqual({ items: [] });
  });

  it("rejects items that fail the element schema", () => {
    expect(PageSchema.safeParse({ items: [{ id: "nope" }] }).success).toBe(
      false,
    );
  });

  it("omits totalCount and pageNumber by default", () => {
    // An exact count over a filtered, permission-scoped set is expensive and is
    // requested explicitly when a product requirement needs it.
    const parsed: Record<string, unknown> = PageSchema.parse({
      items: [],
      totalCount: 500,
      pageNumber: 3,
    });

    expect(parsed).not.toHaveProperty("totalCount");
    expect(parsed).not.toHaveProperty("pageNumber");
  });

  it("infers the element type through the helper", () => {
    type Page = z.infer<typeof PageSchema>;
    const page: Page = { items: [ITEM] };

    expect(page.items[0]?.id).toBe(ITEM.id);
  });
});
