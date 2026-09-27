import { describe, expect, it } from "vitest";

import { createQActionRegistry } from "@capital-q/q-actions";
import { Q_CAPABILITIES, Q_CAPABILITY_EXCLUSIONS } from "@capital-q/q-tools";

import {
  assertComposedActionTypes,
  Q_API_ACTION_TYPES,
} from "../src/composition/q-action-types.js";

/**
 * Every Approval Engine action q-api composes is reachable from a
 * capability Q has, or excluded with a reason (R20); every action a
 * capability names is one q-api composes. Startup checks the composed
 * registry against the same list.
 */
describe("every q-api action is in the capability registry", () => {
  const executed = new Set(
    Q_CAPABILITIES.flatMap((capability) => capability.executes),
  );

  it("each composed action type has a capability, or a stated exclusion", () => {
    const missing = Q_API_ACTION_TYPES.filter(
      (type) =>
        !executed.has(type) &&
        (Q_CAPABILITY_EXCLUSIONS.actionTypes[type] ?? "").length === 0,
    );
    expect(missing).toEqual([]);
  });

  it("each action a capability names is composed", () => {
    const composed = new Set(Q_API_ACTION_TYPES);
    expect([...executed].filter((type) => !composed.has(type))).toEqual([]);
  });

  it("startup refuses a composed registry that differs from the list", () => {
    expect(() => {
      assertComposedActionTypes(createQActionRegistry([]));
    }).toThrow(/differs from Q_API_ACTION_TYPES/);
  });
});
