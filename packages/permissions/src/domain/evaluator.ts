import { z } from "zod";

import type { ActorContext } from "@capital-q/security";

import {
  accessLevelSatisfies,
  DisclosureAccessLevelSchema,
  DisclosurePrincipalSchema,
  DisclosureResourceRefSchema,
  policyStatusAt,
  sameResource,
  UtcTimestampSchema,
  type DisclosureAccessLevel,
  type DisclosurePolicy,
  type DisclosurePrincipal,
  type DisclosureRecipient,
  type DisclosureResourceDescriptor,
  type DisclosureScope,
  type RelationshipParties,
  type UtcTimestamp,
} from "../contracts/index.js";
import type {
  DisclosureAllowReason,
  DisclosureDecision,
  DisclosureDenyReason,
  DisclosurePath,
} from "./decision.js";
import { policyRelationshipId } from "./policy-rules.js";

/**
 * The pure disclosure evaluator. No I/O, no clock of its own, no model:
 * given trusted facts -- the resolved resource, its unrevoked policies, the
 * exact parties of every relationship involved and an instant -- it answers
 * deterministically. The same facts always yield the same decision.
 *
 * Scopes are contextual predicates, never a numeric ladder: founder_private
 * and investor_private are not ordered against one another, and nothing
 * here says "level 3 includes level 2". Every path is evaluated on its own
 * and access is the union of the paths that hold, so revoking one share
 * never removes access another path still grants (§115).
 *
 *   intrinsic scope          the owning domain's classification of the resource
 *   explicit policies        deliberate shares, each with its own recipient,
 *                            access level, expiry and revocation
 *
 * Deny-by-default: no intrinsic scope and no matching policy is DENY, not
 * "probably organisation_private". No actor type is trusted: Q, SYSTEM and
 * CONNECTED_SYSTEM principals are refused outright until a later packet
 * resolves them to a human/organisation/purpose envelope (§77-78). Nothing
 * here looks at database privilege, a role name or a business title.
 */

export type DisclosureEvaluationRequest = {
  readonly principal: DisclosurePrincipal;
  readonly resource: DisclosureResourceDescriptor;
  readonly requestedAccess: DisclosureAccessLevel;
  /** Policies for this resource. Revoked and expired rows are handled here, by `now`. */
  readonly policies: readonly DisclosurePolicy[];
  /** Exact parties of every relationship the facts refer to, by RelationshipId. */
  readonly relationshipParties: Readonly<Record<string, RelationshipParties>>;
  readonly now: UtcTimestamp;
};

const RequestShapeSchema = z.object({
  principal: DisclosurePrincipalSchema,
  requestedAccess: DisclosureAccessLevelSchema,
  now: UtcTimestampSchema,
  resource: z.object({ resource: DisclosureResourceRefSchema }),
});

type ScopeFacts = {
  readonly ownerUserId: string | undefined;
  readonly ownerOrganisationId: string | undefined;
  readonly relationshipId: string | undefined;
  readonly recipient: DisclosureRecipient | null;
};

type ScopeMatch =
  | { readonly matched: true; readonly reason: DisclosureAllowReason }
  | { readonly matched: false; readonly reason: DisclosureDenyReason };

type Candidate = {
  readonly access: DisclosureAccessLevel;
  readonly reason: DisclosureAllowReason;
  readonly via: DisclosurePath;
};

/**
 * Deny-reason precedence when nothing allows. The most specific diagnosis
 * first: a revoked or expired grant that would otherwise have matched this
 * principal is more useful to an operator than "no matching scope".
 */
const DENY_PRECEDENCE: readonly DisclosureDenyReason[] = [
  "POLICY_REVOKED",
  "POLICY_EXPIRED",
  "UNRESOLVED_RELATIONSHIP",
  "AUTHENTICATION_REQUIRED",
  "WRONG_RECIPIENT",
  "NO_MATCHING_SCOPE",
  "UNKNOWN_RESOURCE_SCOPE",
];

function isParty(actor: ActorContext, parties: RelationshipParties): boolean {
  if (actor.organisationId === undefined) {
    return false;
  }
  const { company, investor } = parties;
  return (
    (actor.organisationId === company.organisationId &&
      actor.tenantId === company.tenantId) ||
    (actor.organisationId === investor.organisationId &&
      actor.tenantId === investor.tenantId)
  );
}

function matchRelationship(
  actor: ActorContext,
  relationshipId: string | undefined,
  parties: Readonly<Record<string, RelationshipParties>>,
): ScopeMatch {
  if (relationshipId === undefined) {
    return { matched: false, reason: "UNRESOLVED_RELATIONSHIP" };
  }
  const resolved = parties[relationshipId];
  if (resolved === undefined) {
    return { matched: false, reason: "UNRESOLVED_RELATIONSHIP" };
  }
  return isParty(actor, resolved)
    ? { matched: true, reason: "RELATIONSHIP_PARTY" }
    : { matched: false, reason: "NO_MATCHING_SCOPE" };
}

/**
 * Does this principal satisfy `scope` given the ownership facts of the
 * path (the resource's own owner for the intrinsic path, the policy's owner
 * and recipient for an explicit one)?
 */
function matchScope(
  scope: DisclosureScope,
  facts: ScopeFacts,
  principal: DisclosurePrincipal,
  parties: Readonly<Record<string, RelationshipParties>>,
): ScopeMatch {
  // Deliberately public: the only scope an unauthenticated principal can hold.
  if (scope === "public_external") {
    return { matched: true, reason: "PUBLIC_EXTERNAL" };
  }
  if (principal.kind !== "ACTOR") {
    return { matched: false, reason: "AUTHENTICATION_REQUIRED" };
  }
  const actor = principal.actor;

  switch (scope) {
    case "network_visible":
      // Authenticated Capital Q context suffices for the visibility layer.
      // Verification and network entitlement are separate, later controls.
      return { matched: true, reason: "NETWORK_VISIBLE" };

    case "personal_private":
      // The owning Person only. A colleague in the same organisation is not
      // enough, and there is no organisation branch here on purpose.
      return facts.ownerUserId !== undefined &&
        actor.userId === facts.ownerUserId
        ? { matched: true, reason: "OWNER" }
        : { matched: false, reason: "NO_MATCHING_SCOPE" };

    case "organisation_private":
    case "founder_private":
    case "investor_private":
      // The owning side only. Founder-side and investor-side scopes use the
      // same predicate against different owners; a relationship between the
      // two sides changes nothing here (§19, §60-61).
      if (
        facts.ownerUserId !== undefined &&
        actor.userId === facts.ownerUserId
      ) {
        return { matched: true, reason: "OWNER" };
      }
      return facts.ownerOrganisationId !== undefined &&
        actor.organisationId !== undefined &&
        actor.organisationId === facts.ownerOrganisationId
        ? { matched: true, reason: "SAME_ORGANISATION" }
        : { matched: false, reason: "NO_MATCHING_SCOPE" };

    case "relationship_shared":
      return matchRelationship(actor, facts.relationshipId, parties);

    case "specifically_shared": {
      const recipient = facts.recipient;
      if (recipient === null) {
        // An intrinsic "specifically_shared" classification without a
        // recipient grants nobody; the explicit policies carry recipients.
        return { matched: false, reason: "WRONG_RECIPIENT" };
      }
      switch (recipient.type) {
        case "USER":
          return actor.userId === recipient.id
            ? { matched: true, reason: "EXPLICIT_RECIPIENT" }
            : { matched: false, reason: "WRONG_RECIPIENT" };
        case "MEMBERSHIP":
          // A revoked membership can no longer produce an ActorContext, so
          // the share dies with it without any policy change.
          return actor.membershipId !== undefined &&
            actor.membershipId === recipient.id
            ? { matched: true, reason: "EXPLICIT_RECIPIENT" }
            : { matched: false, reason: "WRONG_RECIPIENT" };
        case "ORGANISATION":
          return actor.organisationId !== undefined &&
            actor.organisationId === recipient.id
            ? { matched: true, reason: "EXPLICIT_RECIPIENT" }
            : { matched: false, reason: "WRONG_RECIPIENT" };
        case "RELATIONSHIP": {
          const match = matchRelationship(actor, recipient.id, parties);
          return match.matched || match.reason === "UNRESOLVED_RELATIONSHIP"
            ? match
            : { matched: false, reason: "WRONG_RECIPIENT" };
        }
      }
    }
  }
}

/**
 * The access an intrinsic classification grants. The owning side holds its
 * own resource fully; network and public visibility are view-only by
 * default (doc 15, 23.2: prefer view unless download is necessary), so a
 * download of network-visible material still needs a deliberate policy.
 */
function intrinsicAccess(scope: DisclosureScope): DisclosureAccessLevel {
  return scope === "network_visible" || scope === "public_external"
    ? "view"
    : "view_download";
}

export function evaluateDisclosure(
  request: DisclosureEvaluationRequest,
): DisclosureDecision {
  const resource = request.resource.resource;
  const requestedAccess = request.requestedAccess;

  if (!RequestShapeSchema.safeParse(request).success) {
    return {
      outcome: "DENY",
      resource,
      requestedAccess,
      reasonCode: "INVALID_REQUEST",
    };
  }

  // Zero ambient authority for non-human principals (§77). Q learns of a
  // resource through a human's resolved envelope later, never by asking.
  if (
    request.principal.kind === "ACTOR" &&
    request.principal.actor.actorType !== "HUMAN"
  ) {
    return {
      outcome: "DENY",
      resource,
      requestedAccess,
      reasonCode: "NON_HUMAN_PRINCIPAL",
    };
  }

  const candidates: Candidate[] = [];
  const blockers = new Set<DisclosureDenyReason>();
  const descriptor = request.resource;

  // Path 1: the resource's own classification.
  if (descriptor.intrinsicScope === undefined) {
    blockers.add("UNKNOWN_RESOURCE_SCOPE");
  } else {
    const match = matchScope(
      descriptor.intrinsicScope,
      {
        ownerUserId: descriptor.ownerUserId,
        ownerOrganisationId: descriptor.ownerOrganisationId,
        relationshipId: descriptor.relationshipId,
        recipient: null,
      },
      request.principal,
      request.relationshipParties,
    );
    if (match.matched) {
      candidates.push({
        access: intrinsicAccess(descriptor.intrinsicScope),
        reason: match.reason,
        via: { kind: "INTRINSIC" },
      });
    } else {
      blockers.add(match.reason);
    }
  }

  // Path 2..n: explicit policies, each on its own terms.
  for (const policy of request.policies) {
    if (!sameResource(policy.resource, resource)) {
      // A policy for another resource is never evidence for this one.
      continue;
    }
    const match = matchScope(
      policy.scopeType,
      {
        ownerUserId: policy.ownerUserId ?? undefined,
        ownerOrganisationId: policy.ownerOrganisationId ?? undefined,
        relationshipId: policyRelationshipId(policy),
        recipient: policy.recipient,
      },
      request.principal,
      request.relationshipParties,
    );
    if (!match.matched) {
      blockers.add(match.reason);
      continue;
    }
    switch (policyStatusAt(policy, request.now)) {
      case "REVOKED":
        blockers.add("POLICY_REVOKED");
        continue;
      case "EXPIRED":
        blockers.add("POLICY_EXPIRED");
        continue;
      case "ACTIVE":
        candidates.push({
          access: policy.accessLevel,
          reason: match.reason,
          via: { kind: "POLICY", disclosurePolicyId: policy.id },
        });
    }
  }

  const satisfying = candidates.find((candidate) =>
    accessLevelSatisfies(candidate.access, requestedAccess),
  );
  if (satisfying !== undefined) {
    return {
      outcome: "ALLOW",
      resource,
      requestedAccess,
      grantedAccess: satisfying.access,
      reasonCode: satisfying.reason,
      via: satisfying.via,
    };
  }
  if (candidates.length > 0) {
    // Some path holds, but only at a lower level: a view share never
    // satisfies a download request.
    return {
      outcome: "DENY",
      resource,
      requestedAccess,
      reasonCode: "INSUFFICIENT_ACCESS_LEVEL",
    };
  }
  const reasonCode =
    DENY_PRECEDENCE.find((reason) => blockers.has(reason)) ??
    "NO_MATCHING_SCOPE";
  return { outcome: "DENY", resource, requestedAccess, reasonCode };
}

/** Batch form for retrieval and feed projection filters. Pure; same semantics per item. */
export function evaluateDisclosureMany(
  requests: readonly DisclosureEvaluationRequest[],
): readonly DisclosureDecision[] {
  return requests.map(evaluateDisclosure);
}
