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

import {
  ELIGIBILITY_POLICY_VERSION,
  ELIGIBILITY_POLICY_VERSIONS,
} from "../src/eligibility/contracts.js";
import {
  FEATURE_SCHEMA_VERSION,
  FEATURE_SCHEMA_VERSIONS,
} from "../src/features/contracts.js";
import { RANKER_VERSION, RANKER_VERSIONS } from "../src/ranking/contracts.js";
import {
  COMPANY_REPRESENTATION_VERSION,
  COMPANY_REPRESENTATION_VERSIONS,
  INVESTOR_REPRESENTATION_VERSION,
  INVESTOR_REPRESENTATION_VERSIONS,
  SEMANTIC_GENERATOR_VERSION,
  SEMANTIC_GENERATOR_VERSIONS,
} from "../src/semantic/contracts.js";
import { STRUCTURED_GENERATOR_VERSION } from "../src/candidates/contracts.js";

/**
 * The same rule for every version a persisted artifact names (live
 * 2026-10-02: one bump made every slate unreadable). Each read-side list
 * holds v1 to the current, in a run, and the current one is in it. A
 * bump that forgets to append fails here, not in production.
 */
describe("every persisted version list runs v1 to the current", () => {
  const lists: readonly [string, readonly string[], string][] = [
    [
      "structured generator",
      STRUCTURED_GENERATOR_VERSIONS,
      STRUCTURED_GENERATOR_VERSION,
    ],
    [
      "eligibility policy",
      ELIGIBILITY_POLICY_VERSIONS,
      ELIGIBILITY_POLICY_VERSION,
    ],
    ["feature schema", FEATURE_SCHEMA_VERSIONS, FEATURE_SCHEMA_VERSION],
    ["ranker", RANKER_VERSIONS, RANKER_VERSION],
    [
      "semantic generator",
      SEMANTIC_GENERATOR_VERSIONS,
      SEMANTIC_GENERATOR_VERSION,
    ],
    [
      "company representation",
      COMPANY_REPRESENTATION_VERSIONS,
      COMPANY_REPRESENTATION_VERSION,
    ],
    [
      "investor representation",
      INVESTOR_REPRESENTATION_VERSIONS,
      INVESTOR_REPRESENTATION_VERSION,
    ],
  ];
  it.each(lists)("%s", (_name, list, current) => {
    expect(list).toContain(current);
    const numbers = list.map((v) => Number(/\.v(\d+)$/.exec(v)?.[1] ?? NaN));
    const latest = Number(/\.v(\d+)$/.exec(current)?.[1] ?? NaN);
    expect([...numbers].sort((a, b) => a - b)).toEqual(
      Array.from({ length: latest }, (_, i) => i + 1),
    );
  });
});
