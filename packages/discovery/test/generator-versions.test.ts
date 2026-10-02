import { describe, expect, it } from "vitest";

import { STRUCTURED_GENERATOR_VERSIONS } from "../src/candidates/contracts.js";

describe("persisted candidate provenance stays readable", () => {
  it("lists every structured generator version ever written, v1 to the current", () => {
    const numbers = STRUCTURED_GENERATOR_VERSIONS.map((v) =>
      Number(v.replace("structured-mandate.v", "")),
    );
    const latest = Math.max(...numbers);
    expect(numbers.sort((a, b) => a - b)).toEqual(
      Array.from({ length: latest }, (_, i) => i + 1),
    );
  });
});
