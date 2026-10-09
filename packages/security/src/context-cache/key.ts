import { createHash } from "node:crypto";

import type { QSensitivityClass } from "@capital-q/contracts";

import type { ActorContext } from "../actor-context/actor-context.js";

/**
 * The key every cached Q context is stored under (RECOVERY K, Part 11;
 * docs/recovery/specs/K-security.md §2).
 *
 * A prepared context is only ever correct for one asker, in one tenant,
 * acting for one organisation through one membership, under one state of
 * their permissions, for one kind of content at one sensitivity, about one
 * state of the subject's disclosure. Every one of those is in the key, so
 * a change to any of them makes the old entry unreachable rather than
 * relying on someone remembering to delete it:
 *
 *   tenantId, userId, organisationId, membershipId, actorType
 *   authzEpoch        private.actor_authz_epoch (revocation, roles, membership)
 *   kind              what is cached ("tierA.snapshot", "live.package", ...)
 *   sensitivity       the strongest class the entry may hold
 *   subject           what it is about, with private.subject_access_epoch
 *   policyVersion     the Context Firewall policy that admitted it
 *
 * Encoding: a JSON array in fixed field order with explicit nulls, hashed.
 * JSON escaping makes the encoding injective, so no two different scopes
 * share a key (no "tenant:a:b" vs "tenant:a" + "b:" ambiguity). The kind is
 * also kept in clear in the prefix so a cache can be inspected by kind
 * without being able to see whose entry it is.
 */

export type ContextCacheSubject = {
  readonly type:
    "COMPANY" | "INVESTOR_ORGANISATION" | "RELATIONSHIP" | "PERSON";
  readonly id: string;
  /** private.subject_access_epoch, or the projection version for Tier B. */
  readonly accessEpoch: string;
};

export type ContextCacheScope = {
  readonly actor: ActorContext;
  readonly authzEpoch: string;
  readonly kind: string;
  readonly sensitivity: QSensitivityClass;
  readonly subject?: ContextCacheSubject | undefined;
  readonly policyVersion: string;
};

const KIND = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9_]*)+$/;
const EPOCH = /^[0-9a-f]{32,64}$/;

export class ContextCacheScopeError extends Error {
  constructor(reason: string) {
    super(`context cache scope refused: ${reason}`);
    this.name = "ContextCacheScopeError";
  }
}

/**
 * Validates a scope before anything is read or written under it. A scope
 * missing its epoch, or an organisation without the membership that grants
 * it, is a programming error that would widen a key: it throws.
 */
export function assertContextCacheScope(scope: ContextCacheScope): void {
  if (!KIND.test(scope.kind)) throw new ContextCacheScopeError("kind");
  if (!EPOCH.test(scope.authzEpoch)) {
    throw new ContextCacheScopeError("authzEpoch");
  }
  if (
    (scope.actor.organisationId === undefined) !==
    (scope.actor.membershipId === undefined)
  ) {
    throw new ContextCacheScopeError("organisation without membership");
  }
  if (scope.subject !== undefined && !EPOCH.test(scope.subject.accessEpoch)) {
    throw new ContextCacheScopeError("subject accessEpoch");
  }
  if (scope.policyVersion.length === 0) {
    throw new ContextCacheScopeError("policyVersion");
  }
}

export function contextCacheKey(scope: ContextCacheScope): string {
  assertContextCacheScope(scope);
  const encoded = JSON.stringify([
    "ctx.v1",
    scope.actor.tenantId,
    scope.actor.userId,
    scope.actor.organisationId ?? null,
    scope.actor.membershipId ?? null,
    scope.actor.actorType,
    scope.authzEpoch,
    scope.kind,
    scope.sensitivity,
    scope.subject?.type ?? null,
    scope.subject?.id ?? null,
    scope.subject?.accessEpoch ?? null,
    scope.policyVersion,
  ]);
  const digest = createHash("sha256").update(encoded).digest("hex");
  return `ctx:v1:${scope.kind}:${digest}`;
}
