import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";
import { PERSONAL_BOOTSTRAP_TENANT_ID } from "@capital-q/security";

/**
 * Owner 2026-10-28: the staging deployment holds the seeded demo world AND
 * the first real people signing up with their own email. Which one a
 * model request belongs to decides whether the synthetic-demo routing
 * allowance may apply to it (doc 15 §62). Only the service-role marker
 * counts: `auth.users.raw_app_meta_data -> 'synthetic'`, the same one the
 * verification sweep reads. Never user_metadata, never an email pattern:
 * a person cannot make themselves synthetic.
 */
export type SyntheticSubject = {
  readonly tenantId: string;
  readonly userId?: string | undefined;
};

export type SyntheticSubjectFacts = {
  /** The person is marked synthetic; true when no person was named. */
  readonly personSynthetic: boolean;
  /** Anyone in the tenant (current membership) is not marked synthetic. */
  readonly tenantHasRealMember: boolean;
  readonly tenantHasMembers: boolean;
};

/**
 * Synthetic only when nothing real is involved. Before their first
 * organisation everyone shares the personal bootstrap tenant, so there the
 * person decides alone, and a request naming nobody is a customer's.
 * Elsewhere the tenant must have members, all of them synthetic.
 */
export function isSyntheticSubject(
  subject: SyntheticSubject,
  facts: SyntheticSubjectFacts,
): boolean {
  if (subject.tenantId === PERSONAL_BOOTSTRAP_TENANT_ID) {
    return subject.userId !== undefined && facts.personSynthetic;
  }
  return (
    facts.personSynthetic &&
    facts.tenantHasMembers &&
    !facts.tenantHasRealMember
  );
}

const FactsRow = z.object({
  person_synthetic: z.boolean(),
  tenant_has_real_member: z.boolean(),
  tenant_has_members: z.boolean(),
});

const CACHE_LIMIT = 5000;

/**
 * Reads the facts and decides, remembering each answer for `ttlMs` (a
 * marker is set once, at seeding). A failed read is a real customer.
 */
export function createPostgresSyntheticSubjectReader(options: {
  readonly sql: DatabaseExecutor;
  readonly ttlMs?: number | undefined;
  readonly now?: (() => number) | undefined;
}): (subject: SyntheticSubject) => Promise<boolean> {
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const now = options.now ?? Date.now;
  const known = new Map<string, { readonly synthetic: boolean; at: number }>();
  return async (subject) => {
    const key = `${subject.tenantId}|${subject.userId ?? ""}`;
    const hit = known.get(key);
    if (hit !== undefined && now() - hit.at < ttlMs) return hit.synthetic;
    let synthetic: boolean;
    try {
      const userId = subject.userId ?? null;
      const [row] = await options.sql`
        select
          (${userId}::uuid is null or exists (
             select 1
               from identity.user_profiles p
               join auth.users u on u.id = p.auth_user_id
              where p.id = ${userId}::uuid
                and coalesce(u.raw_app_meta_data -> 'synthetic' = 'true'::jsonb, false)
          )) as person_synthetic,
          exists (
            select 1
              from identity.organisation_memberships m
              join identity.user_profiles p on p.id = m.user_id
              join auth.users u on u.id = p.auth_user_id
             where m.tenant_id = ${subject.tenantId}::uuid
               and m.left_at is null
               and not coalesce(u.raw_app_meta_data -> 'synthetic' = 'true'::jsonb, false)
          ) as tenant_has_real_member,
          exists (
            select 1
              from identity.organisation_memberships m
             where m.tenant_id = ${subject.tenantId}::uuid
               and m.left_at is null
          ) as tenant_has_members`;
      const facts = FactsRow.parse(row);
      synthetic = isSyntheticSubject(subject, {
        personSynthetic: facts.person_synthetic,
        tenantHasRealMember: facts.tenant_has_real_member,
        tenantHasMembers: facts.tenant_has_members,
      });
    } catch {
      return false;
    }
    if (known.size >= CACHE_LIMIT) known.clear();
    known.set(key, { synthetic, at: now() });
    return synthetic;
  };
}
