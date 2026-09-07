import { describe, expect, it } from "vitest";

import {
  CanonicalJsonError,
  canonicalJsonStringify,
  toCanonicalJsonValue,
} from "../src/common/canonical-json.js";

/**
 * The canonical serialiser every integrity hash is computed over
 * (CQ-Q-008 §25, §117). Structure decides the bytes; insertion order,
 * undefined properties and incidental JavaScript shape do not.
 */
describe("canonicalJsonStringify", () => {
  it("serialises structurally equal objects identically whatever the key order", () => {
    const a = { recipient: "sarah", body: "hello", attachments: ["x", "y"] };
    const b = { attachments: ["x", "y"], body: "hello", recipient: "sarah" };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
    expect(canonicalJsonStringify(a)).toBe(
      '{"attachments":["x","y"],"body":"hello","recipient":"sarah"}',
    );
  });

  it("sorts nested keys and keeps array order, because order is meaning", () => {
    expect(
      canonicalJsonStringify({ z: { b: 1, a: 2 }, list: [{ y: 1, x: 2 }] }),
    ).toBe('{"list":[{"x":2,"y":1}],"z":{"a":2,"b":1}}');
    expect(canonicalJsonStringify(["x", "y"])).not.toBe(
      canonicalJsonStringify(["y", "x"]),
    );
  });

  it("drops undefined properties and treats -0 as 0", () => {
    expect(canonicalJsonStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJsonStringify({ n: -0 })).toBe('{"n":0}');
  });

  it("refuses what JSON cannot carry exactly instead of coercing it", () => {
    for (const value of [
      { n: Number.NaN },
      { n: Number.POSITIVE_INFINITY },
      { big: BigInt(1) },
      { f: () => 1 },
      { d: new Date() },
      [undefined],
      { s: Symbol("x") },
    ]) {
      expect(() => canonicalJsonStringify(value)).toThrow(CanonicalJsonError);
    }
  });

  it("returns a plain canonical value for structural comparison", () => {
    expect(toCanonicalJsonValue({ b: [1, { d: 1, c: 2 }], a: null })).toEqual({
      a: null,
      b: [1, { c: 2, d: 1 }],
    });
  });
});
