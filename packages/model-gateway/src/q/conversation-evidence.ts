import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

/**
 * RC3 (Q voice audit, 15 Nov 2026): conversation-scoped evidence reuse.
 *
 * Audit evidence: 30 of 35 investor and 33 of 42 founder short contextual
 * follow-ups re-read the same context -- the account digest (approvals,
 * relationships, schedule, Q's work) and the wide reads (company, figures)
 * -- seconds after the previous turn read them. A short follow-up about the
 * last result ("why?", "what about the second one?", "go ahead") is answered
 * from what the previous turn of THIS conversation already read for THIS
 * person under THIS authority.
 *
 * Context Firewall: the key is tenant + person (user, organisation,
 * membership, actor type) + conversation + a hash of the run's access
 * context (policy version, ceiling, scopes, combination constraints). Kept
 * evidence is never served to another person, tenant, conversation or
 * authority: a revoked grant changes the plan's scopes and simply misses.
 * Authorisation still resolves before retrieval: the evidence was read by
 * this person's own authorised reads, and only those results are kept.
 *
 * Provenance: each entry keeps the run that read it, when, and which reads
 * produced it; facts inside keep their own provenance unchanged.
 *
 * Invalidation (no stale data):
 * - a short TTL (three minutes);
 * - any write of theirs through Q's tool seam, or an approval executed for
 *   them outside a run (`forgetPerson`);
 * - writes this process does not see (another person's relationship event,
 *   statement, approval or document): the watermark port is asked, before
 *   reuse, whether anything of theirs changed since the evidence was read; a
 *   failed answer is a miss. With no watermark configured (tests, tools
 *   without a database) the TTL and the in-process invalidation bound it.
 */
export const CONVERSATION_EVIDENCE_TTL_MS = 3 * 60_000;
const ENTRIES_MAX = 1_000;

/**
 * What is kept: the account digest, the turn's wide reads, and (DECISIONS
 * 104) the sources the last full answer was given, for the contextual
 * follow-up fast path (context-follow-up.ts).
 */
export type EvidenceSlot = "DIGEST" | "WIDE" | "ANSWER";

export type EvidenceScope = {
  readonly tenantId: string;
  readonly userId: string;
  readonly organisationId: string | null;
  readonly membershipId: string | null;
  readonly actorType: string;
  readonly conversationId: string;
  /** Hash of the run's access context (`accessContextKeyOf`). */
  readonly access: string;
  /**
   * The same access context, split so ANSWER evidence can be matched by
   * coverage (`accessGrantsOf`). Absent: exact `access` equality only.
   */
  readonly grants?: AccessGrants | undefined;
};

/**
 * A run's access context as the firewall granted it: everything but the
 * permitted scopes (policy version, tenant, actor, ceiling, combination
 * constraints), and each permitted scope, canonical.
 */
export type AccessGrants = {
  readonly base: string;
  readonly scopes: readonly string[];
};

export type EvidenceProvenance = {
  /** The run whose authorised reads produced it. */
  readonly runId: string;
  /** The reads (tool or port names) that produced it. */
  readonly reads: readonly string[];
};

export type KeptEvidence<T> = {
  readonly value: T;
  readonly provenance: EvidenceProvenance;
  /** When it was read (ms since the epoch). */
  readonly readAt: number;
};

/**
 * Whether anything this person can see changed since `since`: their
 * relationships' events, approvals or actions, documents, statements.
 * True, or a throw, is a change.
 */
export type EvidenceWatermark = (
  actor: {
    readonly tenantId: string;
    readonly userId: string;
    readonly organisationId: string | null;
  },
  since: Date,
) => Promise<boolean>;

export type ConversationEvidence = {
  readonly keep: <T>(
    scope: EvidenceScope,
    slot: EvidenceSlot,
    value: T,
    provenance: EvidenceProvenance,
  ) => void;
  /** Fresh, unchanged evidence for exactly this scope, or null. */
  readonly take: <T>(
    scope: EvidenceScope,
    slot: EvidenceSlot,
  ) => Promise<KeptEvidence<T> | null>;
  /** Something of theirs changed: nothing kept for them is trusted. */
  readonly forgetPerson: (actor: {
    readonly tenantId: string;
    readonly userId: string;
  }) => void;
  /**
   * Whether evidence for this scope is held and inside its TTL, without
   * asking the watermark: used to decide whether to start a read at all.
   * Never a reason to serve it: `take` decides that.
   */
  readonly holds: (scope: EvidenceScope, slot: EvidenceSlot) => boolean;
};

/** Stable JSON: the same value in any key order hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The access context a run's reads were authorised under. */
export function accessContextKeyOf(plan: PermittedContextPlan): string {
  return canonical([
    plan.policyVersion,
    plan.tenantId,
    plan.actor,
    plan.maxSensitivity,
    [...plan.scopes].map((scope) => canonical(scope)).sort(),
    plan.combinationConstraints,
  ]);
}

export function accessGrantsOf(plan: PermittedContextPlan): AccessGrants {
  return {
    base: canonical([
      plan.policyVersion,
      plan.tenantId,
      plan.actor,
      plan.maxSensitivity,
      plan.combinationConstraints,
    ]),
    scopes: [...plan.scopes].map((scope) => canonical(scope)).sort(),
  };
}

/**
 * Whether a run granted `current` may be given what was read under `kept`:
 * the same policy, tenant, actor, ceiling and combination constraints, and
 * every scope the evidence was read under still permitted. A run whose
 * plan also permits more (live 18 Nov: a follow-up asked from the company
 * page adds COMPANY_PROFILE) is still covered; a revoked or narrowed scope,
 * a changed ceiling or a new combination constraint is not.
 */
export function grantsCover(
  kept: AccessGrants,
  current: AccessGrants,
): boolean {
  if (kept.base !== current.base) return false;
  const permitted = new Set(current.scopes);
  return kept.scopes.every((scope) => permitted.has(scope));
}

export function evidenceScopeOf(input: {
  readonly actor: ActorContext;
  readonly plan: PermittedContextPlan;
  readonly conversationId: string;
}): EvidenceScope {
  return {
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    organisationId: input.actor.organisationId ?? null,
    membershipId: input.actor.membershipId ?? null,
    actorType: input.actor.actorType,
    conversationId: input.conversationId,
    access: accessContextKeyOf(input.plan),
    grants: accessGrantsOf(input.plan),
  };
}

type Entry = KeptEvidence<unknown> & {
  /** The access context it was read under: never refreshed by reuse. */
  readonly access: string;
  readonly grants: AccessGrants | undefined;
};

/**
 * Live 18 Nov 2026 (conversation 9ec5e264): a chain of follow-ups got the
 * fast path once. Turn 1's full answer kept its sources under a key that
 * hashed every permitted scope; turn 2 answered from them and moved the
 * person to the company page, so turn 3's plan also permitted
 * COMPANY_PROFILE, its key differed and the lookup missed (NO_EVIDENCE)
 * although nothing the sources came from had been withdrawn. ANSWER
 * evidence is therefore held once per person and conversation (the newest
 * full answer replaces it) with the access context it was read under, and
 * served only to a run whose grants cover that context (`grantsCover`).
 * Its read time, and so its TTL, carry forward unchanged through every
 * follow-up answered from it. DIGEST and WIDE keep exact access keys.
 */
const COVERED_SLOTS: ReadonlySet<EvidenceSlot> = new Set(["ANSWER"]);

function served(
  entry: Entry,
  scope: EvidenceScope,
  slot: EvidenceSlot,
): boolean {
  if (!COVERED_SLOTS.has(slot)) return true;
  if (entry.grants !== undefined && scope.grants !== undefined) {
    return grantsCover(entry.grants, scope.grants);
  }
  return entry.access === scope.access;
}

export function createConversationEvidence(
  options: {
    readonly now?: () => number;
    readonly ttlMs?: number;
    readonly watermark?: EvidenceWatermark | undefined;
  } = {},
): ConversationEvidence {
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? CONVERSATION_EVIDENCE_TTL_MS;
  const entries = new Map<string, Entry>();
  const byPerson = new Map<string, Set<string>>();
  const personOf = (actor: {
    readonly tenantId: string;
    readonly userId: string;
  }) => `${actor.tenantId}:${actor.userId}`;
  const keyOf = (scope: EvidenceScope, slot: EvidenceSlot) =>
    canonical([
      scope.tenantId,
      scope.userId,
      scope.organisationId,
      scope.membershipId,
      scope.actorType,
      scope.conversationId,
      // ANSWER: one per conversation, matched by coverage in `served`.
      COVERED_SLOTS.has(slot) ? null : scope.access,
      slot,
    ]);
  const drop = (key: string) => {
    entries.delete(key);
  };
  return {
    keep: (scope, slot, value, provenance) => {
      const key = keyOf(scope, slot);
      entries.delete(key);
      entries.set(key, {
        value,
        provenance: {
          runId: provenance.runId,
          reads: [...provenance.reads],
        },
        readAt: now(),
        access: scope.access,
        grants: scope.grants,
      });
      const person = personOf(scope);
      const keys = byPerson.get(person) ?? new Set<string>();
      keys.add(key);
      byPerson.set(person, keys);
      while (entries.size > ENTRIES_MAX) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        drop(oldest);
      }
    },
    take: async <T>(scope: EvidenceScope, slot: EvidenceSlot) => {
      const key = keyOf(scope, slot);
      const entry = entries.get(key);
      if (entry === undefined) return null;
      // Not covered: kept for a run it may serve, never served to this one.
      if (!served(entry, scope, slot)) return null;
      if (now() - entry.readAt > ttl) {
        drop(key);
        return null;
      }
      if (options.watermark !== undefined) {
        const changed = await options
          .watermark(
            {
              tenantId: scope.tenantId,
              userId: scope.userId,
              organisationId: scope.organisationId,
            },
            new Date(entry.readAt),
          )
          .catch(() => true);
        if (changed) {
          drop(key);
          return null;
        }
        // Dropped while the watermark was asked (a write of theirs).
        if (entries.get(key) !== entry) return null;
      }
      return {
        value: entry.value as T,
        provenance: entry.provenance,
        readAt: entry.readAt,
      };
    },
    forgetPerson: (actor) => {
      const person = personOf(actor);
      for (const key of byPerson.get(person) ?? []) drop(key);
      byPerson.delete(person);
    },
    holds: (scope, slot) => {
      const entry = entries.get(keyOf(scope, slot));
      return (
        entry !== undefined &&
        served(entry, scope, slot) &&
        now() - entry.readAt <= ttl
      );
    },
  };
}
