import { describe, expect, it } from "vitest";

import { DecimalStringSchema } from "../src/common/decimal.js";

describe("DecimalStringSchema", () => {
  it.each(["0", "0.00", "123", "123.45", "-10.25", "2000000.00", "-0"])(
    "accepts the exact decimal %s",
    (value) => {
      expect(DecimalStringSchema.parse(value)).toBe(value);
    },
  );

  it.each([
    "1e6",
    "1E6",
    "1,000.00",
    "$100",
    "NaN",
    "Infinity",
    "-Infinity",
    "",
    " ",
    " 1.00 ",
    ".5",
    "1.",
    "007",
    "1.2.3",
    "--1",
    "abc",
  ])("rejects the unsafe or ambiguous value %s", (value) => {
    expect(DecimalStringSchema.safeParse(value).success).toBe(false);
  });

  it("rejects a JavaScript number outright", () => {
    // The whole point: exact values never arrive as binary floating point.
    expect(DecimalStringSchema.safeParse(123.45).success).toBe(false);
    expect(DecimalStringSchema.safeParse(0).success).toBe(false);
  });

  it("never converts to a number and never loses precision", () => {
    const value = "0.1000000000000000055511151231257827";
    const parsed = DecimalStringSchema.parse(value);

    expect(typeof parsed).toBe("string");
    expect(parsed).toBe(value);
    // Round-tripping through Number would destroy these digits.
    expect(parsed).not.toBe(String(Number(value)));
  });

  it("preserves trailing zeros as written", () => {
    // "10.50" and "10.5" carry different significance and are not normalised.
    expect(DecimalStringSchema.parse("10.50")).toBe("10.50");
    expect(DecimalStringSchema.parse("10.5")).toBe("10.5");
  });
});
