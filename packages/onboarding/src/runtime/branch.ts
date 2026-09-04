import type { OnboardingResponseValue } from "@capital-q/contracts";

import {
  BRANCH_MAX_DEPTH,
  type BranchExpression,
  type BranchScalar,
} from "../definitions/schema.js";

/**
 * Deterministic branch evaluation over prior responses. The expression is
 * data (validated by the manifest schema); there is no code path, no SQL,
 * no external lookup. A response is visible to branching only when its step
 * is itself currently eligible, so a revised earlier answer removes both a
 * downstream step and anything that depended on that step's answer.
 */

export type ResponseSnapshot = ReadonlyMap<string, OnboardingResponseValue>;

/** The comparable scalar of a response, or null where none exists. */
export function scalarOf(value: OnboardingResponseValue): BranchScalar | null {
  switch (value.type) {
    case "SINGLE_SELECT":
      return value.optionKey;
    case "CONFIRMATION":
      return value.confirmed;
    case "RANGE":
      return value.value;
    case "TEXT":
      return value.text;
    case "MULTI_SELECT":
    case "RESOURCE_REFERENCE":
      return null;
  }
}

function equalsScalar(actual: BranchScalar | null, expected: BranchScalar) {
  if (actual === null) {
    return false;
  }
  // A RANGE value is an exact decimal string; a manifest may write the
  // comparison as a number. Compare as strings so 5 and "5" agree while
  // "5.0" stays distinct from "5" -- no float arithmetic anywhere.
  if (typeof actual === "string" && typeof expected === "number") {
    return actual === String(expected);
  }
  return actual === expected;
}

function contains(value: OnboardingResponseValue, expected: BranchScalar) {
  switch (value.type) {
    case "MULTI_SELECT":
      return value.optionKeys.some((key) => key === expected);
    case "RESOURCE_REFERENCE":
      return value.resourceIds.some((id) => id === expected);
    case "SINGLE_SELECT":
    case "RANGE":
    case "TEXT":
    case "CONFIRMATION":
      return equalsScalar(scalarOf(value), expected);
  }
}

export function evaluateBranch(
  expression: BranchExpression,
  snapshot: ResponseSnapshot,
  depth = 0,
): boolean {
  if (depth > BRANCH_MAX_DEPTH) {
    // Validated at publication; defensive against a corrupted stored tree.
    return false;
  }
  switch (expression.op) {
    case "EXISTS":
      return snapshot.has(expression.stepKey);
    case "EQUALS": {
      const value = snapshot.get(expression.stepKey);
      return value === undefined
        ? false
        : equalsScalar(scalarOf(value), expression.value);
    }
    case "IN": {
      const value = snapshot.get(expression.stepKey);
      if (value === undefined) {
        return false;
      }
      const scalar = scalarOf(value);
      return expression.values.some((candidate) =>
        equalsScalar(scalar, candidate),
      );
    }
    case "CONTAINS": {
      const value = snapshot.get(expression.stepKey);
      return value === undefined ? false : contains(value, expression.value);
    }
    case "ALL":
      return expression.expressions.every((child) =>
        evaluateBranch(child, snapshot, depth + 1),
      );
    case "ANY":
      return expression.expressions.some((child) =>
        evaluateBranch(child, snapshot, depth + 1),
      );
    case "NOT":
      return !evaluateBranch(expression.expression, snapshot, depth + 1);
  }
}

/** Every step key an expression references, for publication-time validation. */
export function referencedStepKeys(expression: BranchExpression): string[] {
  switch (expression.op) {
    case "EXISTS":
    case "EQUALS":
    case "IN":
    case "CONTAINS":
      return [expression.stepKey];
    case "ALL":
    case "ANY":
      return expression.expressions.flatMap(referencedStepKeys);
    case "NOT":
      return referencedStepKeys(expression.expression);
  }
}

export function branchDepth(expression: BranchExpression): number {
  switch (expression.op) {
    case "ALL":
    case "ANY":
      return 1 + Math.max(...expression.expressions.map(branchDepth));
    case "NOT":
      return 1 + branchDepth(expression.expression);
    case "EXISTS":
    case "EQUALS":
    case "IN":
    case "CONTAINS":
      return 1;
  }
}
