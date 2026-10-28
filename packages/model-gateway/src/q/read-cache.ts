import type {
  QToolCallOutcome,
  QToolExecutionContext,
  QToolProposal,
} from "@capital-q/q-runtime";

/**
 * "What Q knows, Q knows" (owner 2026-10-21): a read this person already
 * made, under exactly the same authority, is not made again within a few
 * minutes -- the profile on their screen, the company Q just looked up,
 * the public page Q just read.
 *
 * Context Firewall: the key is the authority itself -- tenant, the person
 * (user, organisation, membership), the plan's ceiling, its permitted
 * scopes and constraints and its policy version -- plus the tool and its
 * arguments. A read made under one authority is never served under
 * another: a different person, role, ceiling or scope set (a revoked
 * grant changes the plan's scopes) simply misses. Only the reads below are
 * kept: entity knowledge that changes slowly, never what needs them, their
 * inbox, approvals, schedule or a document behind a disclosure grant.
 *
 * Freshness: ten minutes, cleared for the person whenever one of their
 * tools changes something, and bypassed (read anew, then kept) when they
 * ask for the latest ("check again", "current", "refresh").
 */
export const READ_CACHE_TTL_MS = 10 * 60_000;
const ENTRIES_MAX = 2_000;

export const READ_CACHE_TOOLS: ReadonlySet<string> = new Set([
  "search_companies",
  "get_company",
  "get_investor_mandate",
  "fit_profile",
  "fit_compare",
  "search_network",
  "thesis_reading",
  "research_public_web",
  "extract_public_web",
  "lookup_public_profile",
  "find_public_entity",
  "brief_public_entity",
]);

/** They asked for something newer than what Q holds. */
const FRESH_ASK =
  /\b(?:latest|newest|current(?:ly)?|right now|up[- ]to[- ]date|refresh|re-?check|check (?:it |that )?(?:again|once more)|look (?:it |that )?up again|any (?:news|updates?)|today)\b/iu;

export function asksForFresh(text: string | undefined): boolean {
  return text !== undefined && FRESH_ASK.test(text);
}

type Entry = { readonly outcome: QToolCallOutcome; readonly at: number };

function authorityOf(context: QToolExecutionContext): string {
  const { plan, actor } = context;
  return JSON.stringify([
    plan.policyVersion,
    plan.tenantId,
    actor.tenantId,
    actor.userId,
    actor.organisationId ?? null,
    actor.membershipId ?? null,
    actor.actorType,
    plan.actor,
    plan.maxSensitivity,
    [...plan.scopes].map((scope) => JSON.stringify(scope)).sort(),
    plan.combinationConstraints,
  ]);
}

function personOf(context: QToolExecutionContext): string {
  return `${context.actor.tenantId}:${context.actor.userId}`;
}

/** Stable JSON: the same arguments in any key order are the same read. */
export function canonical(value: unknown): string {
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

export type ReadCache = {
  /** A kept outcome for this exact read under this exact authority. */
  readonly get: (
    proposal: QToolProposal,
    context: QToolExecutionContext,
  ) => QToolCallOutcome | null;
  readonly keep: (
    proposal: QToolProposal,
    context: QToolExecutionContext,
    outcome: QToolCallOutcome,
  ) => void;
  /** Something of theirs changed: nothing kept for them is trusted. */
  readonly forget: (context: QToolExecutionContext) => void;
  /**
   * The same, by the person alone: an approved action executed for them
   * outside any run's tool seam (the card's Approve, a continuation) has
   * changed their records (live 2026-10-28: a mandate re-read 7 s after
   * its approved change still said the old cheque range).
   */
  readonly forgetPerson: (actor: {
    readonly tenantId: string;
    readonly userId: string;
  }) => void;
};

export function createReadCache(now: () => number = Date.now): ReadCache {
  const entries = new Map<string, Entry>();
  const byPerson = new Map<string, Set<string>>();
  const keyOf = (proposal: QToolProposal, context: QToolExecutionContext) =>
    `${personOf(context)}|${authorityOf(context)}|${proposal.name}|${canonical(proposal.arguments)}`;
  return {
    get: (proposal, context) => {
      if (!READ_CACHE_TOOLS.has(proposal.name)) return null;
      if (asksForFresh(context.conversation?.latestUserText)) return null;
      const key = keyOf(proposal, context);
      const entry = entries.get(key);
      if (entry === undefined) return null;
      if (now() - entry.at > READ_CACHE_TTL_MS) {
        entries.delete(key);
        return null;
      }
      return { ...entry.outcome, callId: proposal.callId, latencyMs: 0 };
    },
    keep: (proposal, context, outcome) => {
      if (!READ_CACHE_TOOLS.has(proposal.name)) return;
      if (outcome.status !== "SUCCEEDED" || !outcome.result.ok) return;
      if (outcome.classification !== "READ_ONLY") return;
      // Their own records change by their own approvals, some made off
      // this conversation (an approval tapped in the app): never kept.
      const data: unknown = outcome.result.data;
      if (
        typeof data === "object" &&
        data !== null &&
        (data as { readonly relationToYou?: unknown }).relationToYou === "OWN"
      ) {
        return;
      }
      const key = keyOf(proposal, context);
      entries.set(key, { outcome, at: now() });
      const person = personOf(context);
      const keys = byPerson.get(person) ?? new Set<string>();
      keys.add(key);
      byPerson.set(person, keys);
      while (entries.size > ENTRIES_MAX) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    forget: (context) => {
      forgetPerson(context.actor);
    },
    forgetPerson,
  };
  function forgetPerson(actor: {
    readonly tenantId: string;
    readonly userId: string;
  }): void {
    const person = `${actor.tenantId}:${actor.userId}`;
    for (const key of byPerson.get(person) ?? []) entries.delete(key);
    byPerson.delete(person);
  }
}
