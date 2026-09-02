import { describe, expect, it } from "vitest";

import { ResourceVersionSchema, VersionSchema } from "../src/common/version.js";

describe("VersionSchema", () => {
  it.each([1, 2, 7, 1000])("accepts the positive integer %i", (value) => {
    expect(VersionSchema.parse(value)).toBe(value);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %s",
    (value) => {
      // Zero is rejected so an absent version and a zero version cannot be
      // confused for one another.
      expect(VersionSchema.safeParse(value).success).toBe(false);
    },
  );

  it("rejects a string version", () => {
    expect(VersionSchema.safeParse("1").success).toBe(false);
  });

  it("stays a JSON number, unlike money", () => {
    const parsed: unknown = VersionSchema.parse(7);
    expect(typeof parsed).toBe("number");
  });
});

describe("ResourceVersionSchema", () => {
  it("shares the version primitive for optimistic concurrency", () => {
    expect(ResourceVersionSchema.parse(7)).toBe(7);
    expect(ResourceVersionSchema.safeParse(0).success).toBe(false);
  });
});
