import { z } from "zod";

import { Q_CONTEXT_FIREWALL_POLICY_VERSION } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type {
  CompanyKnowledgePort,
  MandateSummary,
} from "@capital-q/discovery";
import type { ActorContext } from "@capital-q/security";
import {
  createContextCache,
  type ContextCache,
  type ContextCacheScope,
} from "@capital-q/security/context-cache";
import type { ContextEpochReader } from "@capital-q/security/postgres";

/**
 * K Part 4 (founder brief 2026-10-09): the per-actor working snapshot,
 * Tier A. Who is asking, for which organisation, and the stable facts
 * every turn of theirs needs -- an investor's own mandate summary, a
 * founder's own company -- built once and reused across turns instead of
 * read again on each.
 *
 * Isolation is F's (K Part 11, @capital-q/security/context-cache): the
 * entry lives under the full scope key -- tenant, user, organisation,
 * membership, the actor's authorisation epoch read fresh per request, the
 * kind, the sensitivity and the Context Firewall policy version -- so a
 * changed role, membership, organisation or policy can never reach an old
 * entry. Staleness of content is D's: the snapshot keeps the Tier B and
 * canonical versions it was built from and asks for them again before it
 * is reused; a different version, or one no longer the actor's, rebuilds.
 *
 * Only the actor's own facts are in it: their own organisation's mandate
 * (D's summary is the viewer's own or none) and their own organisation's
 * company. Never another organisation's private data, never a raw row.
 * A snapshot is a convenience, never authority.
 */

export const WORKING_SNAPSHOT_KIND = "tierA.snapshot";

export type WorkingSnapshot = {
  readonly v: 1;
  readonly builtAt: string;
  readonly side: "INVESTOR" | "COMPANY" | "NONE";
  readonly organisationId: string | null;
  readonly organisationName: string | null;
  /** Their own investor organisation's single active mandate, or null. */
  readonly mandate: MandateSummary | null;
  /** Their own organisation's company, as their own record says it. */
  readonly company: {
    readonly companyId: string;
    readonly name: string;
    readonly shortDescription: string | null;
    readonly stageCode: string | null;
    readonly countryCode: string | null;
    /** core.companies.version, for the reuse check. */
    readonly version: string;
  } | null;
};

export type WorkingSnapshots = {
  /** The actor's snapshot, reused when still current; null when none. */
  readonly forActor: (actor: ActorContext) => Promise<WorkingSnapshot | null>;
  /** Frees every entry of this actor (logout, role change). */
  readonly invalidateActor: (userId: string) => number;
  readonly invalidateOrganisation: (organisationId: string) => number;
};

const OrganisationRow = z.object({
  display_name: z.string(),
  investor: z.boolean(),
});

const CompanyRow = z.object({
  id: z.string(),
  canonical_name: z.string(),
  short_description: z.string().nullable(),
  current_stage_code: z.string().nullable(),
  headquarters_country: z.string().nullable(),
  version: z.union([z.string(), z.number(), z.bigint()]).transform(String),
});

export function createWorkingSnapshots(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly knowledge: CompanyKnowledgePort;
  readonly epochs: ContextEpochReader;
  readonly cache?: ContextCache<WorkingSnapshot | null> | undefined;
  readonly now?: (() => Date) | undefined;
}): WorkingSnapshots {
  const { sql, knowledge, epochs } = dependencies;
  const cache =
    dependencies.cache ??
    createContextCache<WorkingSnapshot | null>({ ttlMs: 10 * 60_000 });
  const now = dependencies.now ?? (() => new Date());

  async function build(actor: ActorContext): Promise<WorkingSnapshot | null> {
    const organisationId = actor.organisationId ?? null;
    if (organisationId === null) {
      return {
        v: 1,
        builtAt: now().toISOString(),
        side: "NONE",
        organisationId: null,
        organisationName: null,
        mandate: null,
        company: null,
      };
    }
    const [organisation] = (
      await sql`
        select o.display_name,
               exists (select 1 from core.investor_organisations io
                        where io.organisation_id = o.id
                          and io.tenant_id = o.tenant_id) as investor
          from identity.organisations o
         where o.id = ${organisationId} and o.tenant_id = ${actor.tenantId}
           -- Built only for a membership that is active now, whatever the
           -- context in hand says: an ended one builds nothing.
           and exists (select 1 from identity.organisation_memberships m
                        where m.id = ${actor.membershipId ?? null}::uuid
                          and m.user_id = ${actor.userId}
                          and m.organisation_id = o.id
                          and m.tenant_id = o.tenant_id
                          and m.membership_status = 'active')`
    ).map((row) => OrganisationRow.parse(row));
    if (organisation === undefined) return null;
    // Their side is the platform's fact: an investor organisation of theirs.
    const investor = organisation.investor;
    const [mandate, company] = await Promise.all([
      investor ? knowledge.mandateSummary(actor) : Promise.resolve(null),
      investor
        ? Promise.resolve(undefined)
        : sql`
            select c.id, c.canonical_name, c.short_description, c.current_stage_code,
                   c.headquarters_country, c.version
              from core.companies c
             where c.tenant_id = ${actor.tenantId}
               and c.organisation_id = ${organisationId}
             order by c.created_at
             limit 1`.then((rows) =>
            rows.map((row) => CompanyRow.parse(row)).at(0),
          ),
    ]);
    return {
      v: 1,
      builtAt: now().toISOString(),
      side: investor ? "INVESTOR" : "COMPANY",
      organisationId,
      organisationName: organisation.display_name,
      mandate,
      company:
        company === undefined
          ? null
          : {
              companyId: company.id,
              name: company.canonical_name,
              shortDescription: company.short_description,
              stageCode: company.current_stage_code,
              countryCode: company.headquarters_country,
              version: company.version,
            },
    };
  }

  /** Whether the facts it was built from are still the current ones. */
  async function current(
    actor: ActorContext,
    snapshot: WorkingSnapshot,
  ): Promise<boolean> {
    const [mandateOk, companyOk] = await Promise.all([
      snapshot.mandate === null
        ? Promise.resolve(true)
        : knowledge
            .versions(actor, "MANDATE", [snapshot.mandate.mandateId])
            .then(
              (versions) =>
                versions.get(snapshot.mandate?.mandateId ?? "") ===
                snapshot.mandate?.version,
            ),
      snapshot.company === null
        ? Promise.resolve(true)
        : sql<{ version: string }[]>`
            select c.version::text as version from core.companies c
             where c.id = ${snapshot.company.companyId}
               and c.tenant_id = ${actor.tenantId}
               and c.organisation_id = ${snapshot.organisationId}`.then(
            (rows) => rows[0]?.version === snapshot.company?.version,
          ),
    ]);
    return mandateOk && companyOk;
  }

  return {
    forActor: async (actor) => {
      if (actor.actorType !== "HUMAN") return null;
      const scope: ContextCacheScope = {
        actor,
        // Read fresh every request: a revocation changes it at once.
        authzEpoch: await epochs.actorEpoch(actor),
        kind: WORKING_SNAPSHOT_KIND,
        sensitivity: "CONFIDENTIAL",
        policyVersion: String(Q_CONTEXT_FIREWALL_POLICY_VERSION),
      };
      const held = await cache.getOrLoad(scope, () => build(actor));
      if (held === null || (await current(actor, held))) return held;
      // Built from facts that have since changed: rebuild under the same
      // scope, never serve the old one.
      cache.invalidateActor(actor.userId);
      return cache.getOrLoad(scope, () => build(actor));
    },
    invalidateActor: (userId) => cache.invalidateActor(userId),
    invalidateOrganisation: (organisationId) =>
      cache.invalidateOrganisation(organisationId),
  };
}
