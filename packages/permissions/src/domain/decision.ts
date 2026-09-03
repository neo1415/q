import type {
  DisclosureAccessLevel,
  DisclosurePolicyId,
  DisclosureResourceRef,
} from "../contracts/index.js";

/**
 * Stable internal reason codes. Safe for tests, server logs and audit; never
 * echoed to an untrusted client, because "WRONG_RECIPIENT" tells a caller
 * that a private share exists.
 */
export const DISCLOSURE_ALLOW_REASONS = [
  "OWNER",
  "SAME_ORGANISATION",
  "EXPLICIT_RECIPIENT",
  "RELATIONSHIP_PARTY",
  "NETWORK_VISIBLE",
  "PUBLIC_EXTERNAL",
] as const;
export type DisclosureAllowReason = (typeof DISCLOSURE_ALLOW_REASONS)[number];

export const DISCLOSURE_DENY_REASONS = [
  "INVALID_REQUEST",
  "NON_HUMAN_PRINCIPAL",
  "AUTHENTICATION_REQUIRED",
  "UNKNOWN_RESOURCE",
  "UNKNOWN_RESOURCE_SCOPE",
  "NO_MATCHING_SCOPE",
  "WRONG_RECIPIENT",
  "UNRESOLVED_RELATIONSHIP",
  "POLICY_EXPIRED",
  "POLICY_REVOKED",
  "INSUFFICIENT_ACCESS_LEVEL",
] as const;
export type DisclosureDenyReason = (typeof DISCLOSURE_DENY_REASONS)[number];

/** Which path granted access: the resource's own classification, or one explicit policy. */
export type DisclosurePath =
  | { readonly kind: "INTRINSIC" }
  | {
      readonly kind: "POLICY";
      readonly disclosurePolicyId: DisclosurePolicyId;
    };

export type DisclosureDecision =
  | {
      readonly outcome: "ALLOW";
      readonly resource: DisclosureResourceRef;
      readonly requestedAccess: DisclosureAccessLevel;
      /** The level actually held on the granting path; always satisfies the request. */
      readonly grantedAccess: DisclosureAccessLevel;
      readonly reasonCode: DisclosureAllowReason;
      readonly via: DisclosurePath;
    }
  | {
      readonly outcome: "DENY";
      readonly resource: DisclosureResourceRef;
      readonly requestedAccess: DisclosureAccessLevel;
      readonly reasonCode: DisclosureDenyReason;
    };
