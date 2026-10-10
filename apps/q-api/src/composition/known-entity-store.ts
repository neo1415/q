import { createHash } from "node:crypto";

import {
  ExternalEntityImageSchema,
  ExternalEntityQuoteSchema,
} from "@capital-q/contracts/q";
import {
  jsonbParam,
  type DatabaseExecutor,
  type TransactionManager,
} from "@capital-q/database";
import {
  aliasKeyOf,
  preparedEntityIdFor,
  type EntityFactRecord,
  type EntitySourceRecord,
  type KnownEntityRecord,
  type PreparedEntityUpsert,
} from "@capital-q/q-research";
import { z } from "zod";

import type { PreparedEntityStore } from "./prepared-entities.js";

/**
 * The Postgres owner of prepared (global, public) research entities
 * (W5 on W2's `q_runtime.external_persons` and its alias, source and fact
 * tables). Platform reference data: no tenant, no user, never canonical
 * business truth. Server-only: the tables have RLS on and no client grants.
 *
 * One query loads every prepared entity with the version it was read at;
 * the version is `count:max(updated_at)` over the prepared rows, so a
 * write anywhere changes it and an identical reload does not.
 */

const Row = z.object({
  id: z.string(),
  profile_key: z.string(),
  entity_kind: z.enum(["PERSON", "ORGANIZATION", "GOVERNMENT_AGENCY"]),
  requires_refresh: z.boolean(),
  display_name: z.string(),
  profile_url: z.string().nullable(),
  role: z.string().nullable(),
  organization: z.string().nullable(),
  location: z.string().nullable(),
  confidence: z.enum(["STRONG", "PLAUSIBLE", "WEAK"]),
  image: z.unknown(),
  quotes: z.unknown(),
  profile: z.record(z.string(), z.unknown()),
  last_researched_at: z.union([z.string(), z.date()]),
  aliases: z.array(z.string()),
  facts: z.array(
    z.object({
      claim: z.string(),
      sourceIds: z.array(z.string()),
      evidenceClass: z.string().nullable(),
    }),
  ),
  sources: z.array(
    z.object({
      sourceId: z.string(),
      url: z.string(),
      description: z.string().nullable(),
      publishedAt: z.string().nullable(),
      evidenceClass: z.string().nullable(),
    }),
  ),
  version: z.string(),
});

const toIso = (value: string | Date): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

export function createPostgresPreparedEntityStore(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): PreparedEntityStore {
  const { sql, transactions } = dependencies;

  const versionOf = async (): Promise<string> => {
    const [row] = await sql<{ version: string }[]>`
      select count(*)::text || ':' || coalesce(max(updated_at)::text, '') as version
        from q_runtime.external_persons
       where tenant_id is null and research_status = 'PREPARED_PUBLIC_SEED'`;
    return row?.version ?? "0:";
  };

  const listWithVersion = async () => {
    const rows = await sql`
      select p.id, p.profile_key, p.entity_kind, p.requires_refresh,
             p.display_name, p.profile_url, p.role, p.organization,
             p.location, p.confidence, p.image, p.quotes, p.profile,
             p.last_researched_at,
             coalesce((select jsonb_agg(a.alias order by a.alias_key)
                         from q_runtime.external_entity_aliases a
                        where a.external_person_id = p.id
                          and a.alias <> p.display_name), '[]'::jsonb) as aliases,
             coalesce((select jsonb_agg(jsonb_build_object(
                         'claim', f.claim,
                         'sourceIds', to_jsonb(f.source_ids),
                         'evidenceClass', f.evidence_class) order by f.ordinal)
                         from q_runtime.external_entity_facts f
                        where f.external_person_id = p.id), '[]'::jsonb) as facts,
             coalesce((select jsonb_agg(jsonb_build_object(
                         'sourceId', s.source_id,
                         'url', s.url,
                         'description', s.description,
                         'publishedAt', s.published_at,
                         'evidenceClass', s.evidence_class) order by s.source_id)
                         from q_runtime.external_entity_sources s
                        where s.external_person_id = p.id), '[]'::jsonb) as sources,
             (count(*) over ())::text || ':' ||
               coalesce((max(p.updated_at) over ())::text, '') as version
        from q_runtime.external_persons p
       where p.tenant_id is null and p.research_status = 'PREPARED_PUBLIC_SEED'
       order by p.profile_key`;
    const parsed = rows.map((row) => Row.parse(row));
    const records: KnownEntityRecord[] = parsed.map((row) => ({
      externalPersonId: row.id,
      profileKey: row.profile_key,
      entityKind: row.entity_kind,
      researchStatus: "PREPARED_PUBLIC_SEED",
      requiresRefresh: row.requires_refresh,
      displayName: row.display_name,
      aliases: row.aliases,
      profileUrl: row.profile_url,
      role: row.role,
      organization: row.organization,
      location: row.location,
      confidence: row.confidence,
      facts: row.facts satisfies EntityFactRecord[],
      sources: row.sources satisfies EntitySourceRecord[],
      quotes: z.array(ExternalEntityQuoteSchema).parse(row.quotes),
      image: ExternalEntityImageSchema.parse(row.image),
      profile: row.profile,
      lastResearchedAt: toIso(row.last_researched_at),
    }));
    return { version: parsed[0]?.version ?? "0:", records };
  };

  return {
    version: versionOf,
    listWithVersion,
    listPrepared: async () => (await listWithVersion()).records,

    findByAlias: async (aliasKey) => {
      const { records } = await listWithVersion();
      return records.filter((record) =>
        [record.displayName, ...record.aliases].some(
          (alias) => aliasKeyOf(alias) === aliasKey,
        ),
      );
    },

    upsertPrepared: async (entity: PreparedEntityUpsert) => {
      const id = preparedEntityIdFor(entity.profileKey);
      // A hash of everything written, so a change in any child row shows
      // in the parent row (and in the version) and an identical load does not.
      const profile = {
        ...entity.profile,
        contentHash: createHash("sha256")
          .update(JSON.stringify({ ...entity, profile: entity.profile }))
          .digest("hex"),
      };
      const aliases = new Map<string, string>();
      for (const alias of [entity.displayName, ...entity.aliases]) {
        const key = aliasKeyOf(alias);
        if (key.length > 0 && !aliases.has(key)) aliases.set(key, alias);
      }
      // Short transaction, no network inside: the rows of one entity
      // commit together or not at all.
      await transactions.run(async ({ sql: tx }) => {
        const written = await tx`
          insert into q_runtime.external_persons
            (id, tenant_id, user_id, entity_kind, research_status,
             requires_refresh, profile_key, display_name, name_variants,
             profile_url, role, organization, location, confidence, image,
             quotes, profile, last_researched_at, updated_at)
          values
            (${id}, null, null, ${entity.entityKind}, 'PREPARED_PUBLIC_SEED',
             ${entity.requiresRefresh}, ${entity.profileKey}, ${entity.displayName},
             ${jsonbParam(tx, [...aliases.values()].slice(0, 24))},
             ${entity.profileUrl}, ${entity.role}, ${entity.organization},
             ${entity.location}, ${entity.confidence},
             ${jsonbParam(tx, entity.image)},
             ${jsonbParam(tx, entity.quotes)},
             ${jsonbParam(tx, profile)},
             ${entity.lastResearchedAt}, clock_timestamp())
          on conflict (profile_key) where tenant_id is null
          do update set
            entity_kind = excluded.entity_kind,
            requires_refresh = excluded.requires_refresh,
            display_name = excluded.display_name,
            name_variants = excluded.name_variants,
            profile_url = excluded.profile_url,
            role = excluded.role,
            organization = excluded.organization,
            location = excluded.location,
            confidence = excluded.confidence,
            image = excluded.image,
            quotes = excluded.quotes,
            profile = excluded.profile,
            last_researched_at = excluded.last_researched_at,
            updated_at = clock_timestamp()
          where q_runtime.external_persons.profile
                  ->> 'contentHash' is distinct from excluded.profile ->> 'contentHash'
          returning id`;
        // No row back means the stored hash already matches: the children
        // were written with it in the same transaction, so nothing to do.
        if (written.length === 0) return;
        await tx`delete from q_runtime.external_entity_aliases where external_person_id = ${id}`;
        await tx`delete from q_runtime.external_entity_facts where external_person_id = ${id}`;
        await tx`delete from q_runtime.external_entity_sources where external_person_id = ${id}`;
        for (const [key, alias] of aliases) {
          await tx`
            insert into q_runtime.external_entity_aliases
              (external_person_id, alias_key, alias)
            values (${id}, ${key}, ${alias})`;
        }
        for (const [ordinal, fact] of entity.facts.entries()) {
          await tx`
            insert into q_runtime.external_entity_facts
              (external_person_id, ordinal, claim, source_ids, evidence_class)
            values (${id}, ${ordinal}, ${fact.claim},
                    ${tx.array([...fact.sourceIds])}::text[], ${fact.evidenceClass})`;
        }
        for (const source of entity.sources) {
          await tx`
            insert into q_runtime.external_entity_sources
              (external_person_id, source_id, url, description, published_at,
               evidence_class, retrieved_at)
            values (${id}, ${source.sourceId}, ${source.url}, ${source.description},
                    ${source.publishedAt}, ${source.evidenceClass},
                    ${entity.lastResearchedAt})`;
        }
      });
      return { externalPersonId: id };
    },
  };
}
