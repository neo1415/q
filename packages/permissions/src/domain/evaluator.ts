import { z } from "zod";

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

/** Where a principal stands: the only two fields party membership turns on. */
type Standing = {
  readonly tenantId: string;
  readonly organisationId: string | undefined;
};

function isParty(standing: Standing, parties: RelationshipParties): boolean {
  if (standing.organisationId === undefined) {
    return false;
  }
  const { company, investor } = parties;
  return (
    (standing.organisationId === company.organisationId &&
      standing.tenantId === company.tenantId) ||
    (standing.organisationId === investor.organisationId &&
      standing.tenantId === investor.tenantId)
  );
}

function matchRelationship(
  standing: Standing,
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
  return isParty(standing, resolved)
    ? { matched: true, reason: "RELATIONSHIP_PARTY" }
    : { matched: false, reason: "NO_MATCHING_SCOPE" };
}

/**
 * What an organisation may see, asked as an organisation
 * (CQ-PERM-ORG-VIEW-001).
 *
 * Strictly narrower than any of its members. Two scopes carry the whole
 * point: `personal_private` can never match, because a Person's own
 * material is not the organisation's; and `specifically_shared` matches
 * only a grant that names the ORGANISATION, because a share addressed to
 * one member is that member's and does not become institutional knowledge
 * by being useful.
 *
 * There is no membership list here on purpose. Asking "can any member see
 * it" would be the union of every member's access, which is the thing this
 * exists to avoid; asking "can every member see it" would make one
 * colleague's absence change what the organisation knows.
 */
function matchOrganisationScope(
  scope: DisclosureScope,
  facts: ScopeFacts,
  principal: { readonly tenantId: string; readonly organisationId: string },
  parties: Readonly<Record<string, RelationshipParties>>,
): ScopeMatch {
  const standing = {
    tenantId: principal.tenantId,
    organisationId: principal.organisationId,
  };
  switch (scope) {
    case "public_external":
      // Handled before this function; listed so the switch stays exhaustive.
      return { matched: true, reason: "PUBLIC_EXTERNAL" };

    case "network_visible":
      // An organisation is an authenticated Capital Q context in its own
      // right; the visibility layer asks nothing more.
      return { matched: true, reason: "NETWORK_VISIBLE" };

    case "personal_private":
      // A Person's own material, never the organisation's. No branch here,
      // deliberately: this is the scope the whole principal exists for.
      return { matched: false, reason: "NO_MATCHING_SCOPE" };

    case "organisation_private":
    case "founder_private":
    case "investor_private":
      // The owning side, as a side. An owner who is a Person is not the
      // organisation, so `ownerUserId` is not consulted.
      return facts.ownerOrganisationId !== undefined &&
        facts.ownerOrganisationId === principal.organisationId
        ? { matched: true, reason: "SAME_ORGANISATION" }
        : { matched: false, reason: "NO_MATCHING_SCOPE" };

    case "relationship_shared":
      // Relationship parties ARE organisations, so this answers identically
      // for the organisation and for any of its members.
      return matchRelationship(standing, facts.relationshipId, parties);

    case "specifically_shared": {
      const recipient = facts.recipient;
      if (recipient === null) {
        return { matched: false, reason: "WRONG_RECIPIENT" };
      }
      switch (recipient.type) {
        case "ORGANISATION":
          return recipient.id === principal.organisationId
            ? { matched: true, reason: "EXPLICIT_RECIPIENT" }
            : { matched: false, reason: "WRONG_RECIPIENT" };
        case "RELATIONSHIP": {
          const match = matchRelationship(standing, recipient.id, parties);
          return match.matched || match.reason === "UNRESOLVED_RELATIONSHIP"
            ? match
            : { matched: false, reason: "WRONG_RECIPIENT" };
        }
        case "USER":
        case "MEMBERSHIP":
          // Addressed to a person. It stays theirs.
          return { matched: false, reason: "WRONG_RECIPIENT" };
      }
    }
  }
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
  if (principal.kind === "ORGANISATION") {
    return matchOrganisationScope(scope, facts, principal, parties);
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
      return matchRelationship(
        { tenantId: actor.tenantId, organisationId: actor.organisationId },
        facts.relationshipId,
        parties,
      );

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
          const match = matchRelationship(
            { tenantId: actor.tenantId, organisationId: actor.organisationId },
            recipient.id,
            parties,
          );
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
  // An ORGANISATION principal is not one of these: it is not an agent that
  // could ask on its own behalf, and it answers strictly less than any of
  // its human members (CQ-PERM-ORG-VIEW-001).
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
