import { z } from "zod";

import type { Capability } from "./capability.js";
import type { ResourceScope } from "./resource-scope.js";

/** The five outcomes the security architecture defines (doc 15, 12). */
export const AUTHORIZATION_OUTCOMES = [
  "ALLOW",
  "DENY",
  "REQUIRES_STEP_UP",
  "REQUIRES_VERIFICATION",
  "REQUIRES_APPROVAL",
] as const;

export type AuthorizationOutcome = (typeof AUTHORIZATION_OUTCOMES)[number];

export const AuthorizationOutcomeSchema = z.enum(AUTHORIZATION_OUTCOMES);

/**
 * A further condition on an otherwise-granted capability.
 *
 * None of these is a capability. Verification proves a claim about a person or
 * organisation; step-up proves authentication assurance; approval binds a
 * specific action to a human decision. A satisfied requirement never creates
 * authority the policy did not already grant.
 *
 * Evaluated in this order: VERIFICATION, then STEP_UP, then APPROVAL.
 */
export const AUTHORIZATION_REQUIREMENTS = [
  "VERIFICATION",
  "STEP_UP",
  "APPROVAL",
] as const;

export type AuthorizationRequirement =
  (typeof AUTHORIZATION_REQUIREMENTS)[number];

export const AuthorizationRequirementSchema = z.enum(
  AUTHORIZATION_REQUIREMENTS,
);

/**
 * Stable internal reason codes.
 *
 * Safe for tests, server logs and future audit. They are not user-facing and
 * are never echoed into an HTTP response: "ORGANISATION_MISMATCH" tells a
 * caller an organisation exists, which is precisely what a denial must not say.
 */
export const AUTHORIZATION_REASONS = [
  "CAPABILITY_GRANTED",
  "NO_MATCHING_GRANT",
  "EXPLICIT_DENIAL",
  "TENANT_MISMATCH",
  "ORGANISATION_MISMATCH",
  "INVALID_REQUEST",
  "POLICY_UNAVAILABLE",
  "VERIFICATION_REQUIRED",
  "STEP_UP_REQUIRED",
  "APPROVAL_REQUIRED",
] as const;

export type AuthorizationReason = (typeof AUTHORIZATION_REASONS)[number];

/** Where a matched policy fact came from. Safe to record; never a role name. */
export const AUTHORITY_SOURCES = [
  "ROLE_TEMPLATE",
  "EXPLICIT_GRANT",
  "EXPLICIT_DENIAL",
] as const;

export type AuthoritySource = (typeof AUTHORITY_SOURCES)[number];

type DecisionBase = {
  readonly capability: Capability;
  readonly resource: ResourceScope;
  readonly reasonCode: AuthorizationReason;
};

/**
 * The evaluator's answer. Carries enough safe context -- capability, target
 * scope, reason, and the source of the deciding fact -- for a future audit
 * record to reconstruct why, without carrying anything private.
 */
export type AuthorizationDecision =
  | (DecisionBase & {
      readonly outcome: "ALLOW";
      readonly authority: AuthoritySource | undefined;
    })
  | (DecisionBase & {
      readonly outcome: "DENY";
      readonly authority: AuthoritySource | undefined;
    })
  | (DecisionBase & {
      readonly outcome:
        "REQUIRES_VERIFICATION" | "REQUIRES_STEP_UP" | "REQUIRES_APPROVAL";
      /** Every unmet requirement, in evaluation order. */
      readonly requirements: readonly AuthorizationRequirement[];
    });
