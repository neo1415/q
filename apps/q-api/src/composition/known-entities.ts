import {
  jsonbParam,
  type DatabaseExecutor,
  type TransactionManager,
} from "@capital-q/database";
import {
  aliasKeyOf,
  preparedEntityIdFor,
  type KnownEntityRecord,
  type KnownEntityStore,
} from "@capital-q/q-research";

/**
 * The Postgres owner of public research entities (W2; migration
 * 20261222090000). Prepared seeds are platform reference data (no tenant);
 * W5's loader calls `upsertPrepared`, the Q API warms the in-memory index
 * from `listPrepared` at start-up and reads `findByAlias` only when cold.
 * Server-only: no client grants exist on these tables.
 */

type EntityRow = {
  id: string;
  profile_key: string;
  entity_kind: KnownEntityRecord["entityKind"];
  research_status: KnownEntityRecord["researchStatus"];
  requires_refresh: boolean;
  display_name: string;
  profile_url: string | null;
  role: string | null;
  organization: string | null;
  location: string | null;
  confidence: KnownEntityRecord["confidence"];
  quotes: KnownEntityRecord["quotes"];
  image: KnownEntityRecord["image"];
  profile: Record<string, unknown>;
  last_researched_at: Date | string;
  investor_organisation_id: string | null;
};

const iso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

export function createPostgresKnownEntityStore(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): KnownEntityStore {
  const { sql, transactions } = dependencies;

  const hydrate = async (
    rows: readonly EntityRow[],
  ): Promise<readonly KnownEntityRecord[]> => {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const idsJson = jsonbParam(sql, ids);
    const aliases = await sql<{ id: string; alias: string }[]>`
      select external_person_id as id, alias
        from q_runtime.external_entity_aliases
       where external_person_id in
             (select value::uuid from jsonb_array_elements_text(${idsJson}::jsonb))`;
    const sources = await sql<
      {
        id: string;
        source_id: string;
        url: string;
        description: string | null;
        published_at: Date | string | null;
        evidence_class: string | null;
      }[]
    >`
      select external_person_id as id, source_id, url, description,
             published_at, evidence_class
        from q_runtime.external_entity_sources
       where external_person_id in
             (select value::uuid from jsonb_array_elements_text(${idsJson}::jsonb))
       order by source_id`;
    const facts = await sql<
      {
        id: string;
        claim: string;
        source_ids: string[];
        evidence_class: string | null;
      }[]
    >`
      select external_person_id as id, claim, source_ids, evidence_class
        from q_runtime.external_entity_facts
       where external_person_id in
             (select value::uuid from jsonb_array_elements_text(${idsJson}::jsonb))
       order by ordinal`;
    return rows.map((row) => ({
      externalPersonId: row.id,
      profileKey: row.profile_key,
      entityKind: row.entity_kind,
      researchStatus: row.research_status,
      requiresRefresh: row.requires_refresh,
      displayName: row.display_name,
      aliases: aliases.filter((a) => a.id === row.id).map((a) => a.alias),
      profileUrl: row.profile_url,
      role: row.role,
      organization: row.organization,
      location: row.location,
      confidence: row.confidence,
      facts: facts
        .filter((f) => f.id === row.id)
        .map((f) => ({
          claim: f.claim,
          sourceIds: f.source_ids,
          evidenceClass: f.evidence_class,
        })),
      sources: sources
        .filter((s) => s.id === row.id)
        .map((s) => ({
          sourceId: s.source_id,
          url: s.url,
          description: s.description,
          publishedAt: s.published_at === null ? null : iso(s.published_at),
          evidenceClass: s.evidence_class,
        })),
      quotes: row.quotes,
      image: row.image,
      profile: row.profile,
      lastResearchedAt: iso(row.last_researched_at),
      investorOrganisationId: row.investor_organisation_id,
    }));
  };

  return {
    upsertPrepared: async (entity) => {
      const id = preparedEntityIdFor(entity.profileKey);
      const role = entity.entityKind === "PERSON" ? entity.role : null;
      await transactions.run(async (tx) => {
        await tx.sql`
          insert into q_runtime.external_persons
            (id, tenant_id, user_id, entity_kind, research_status,
             requires_refresh, profile_key, display_name, name_variants,
             profile_url, role, organization, location, confidence, image,
             quotes, profile, last_researched_at)
          values (${id}, null, null, ${entity.entityKind}, 'PREPARED_PUBLIC_SEED',
                  ${entity.requiresRefresh}, ${entity.profileKey},
                  ${entity.displayName},
                  ${jsonbParam(tx.sql, entity.aliases.slice(0, 24))},
                  ${entity.profileUrl}, ${role}, ${entity.organization},
                  ${entity.location}, ${entity.confidence},
                  ${jsonbParam(tx.sql, entity.image)},
                  ${jsonbParam(tx.sql, entity.quotes)},
                  ${jsonbParam(tx.sql, entity.profile)},
                  ${entity.lastResearchedAt}::timestamptz)
          on conflict (profile_key) where tenant_id is null do update set
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
            updated_at = clock_timestamp()`;
        // Children are replaced as a set so a re-load is exact, not additive.
        await tx.sql`delete from q_runtime.external_entity_aliases where external_person_id = ${id}`;
        await tx.sql`delete from q_runtime.external_entity_sources where external_person_id = ${id}`;
        await tx.sql`delete from q_runtime.external_entity_facts where external_person_id = ${id}`;
        const seen = new Set<string>();
        for (const alias of [entity.displayName, ...entity.aliases]) {
          const key = aliasKeyOf(alias);
          if (key.length === 0 || seen.has(key)) continue;
          seen.add(key);
          await tx.sql`
            insert into q_runtime.external_entity_aliases
              (external_person_id, alias_key, alias)
            values (${id}, ${key}, ${alias.slice(0, 200)})`;
        }
        for (const source of entity.sources) {
          await tx.sql`
            insert into q_runtime.external_entity_sources
              (external_person_id, source_id, url, description, published_at,
               evidence_class)
            values (${id}, ${source.sourceId}, ${source.url},
                    ${source.description}, ${source.publishedAt}::timestamptz,
                    ${source.evidenceClass})`;
        }
        let ordinal = 0;
        for (const fact of entity.facts) {
          await tx.sql`
            insert into q_runtime.external_entity_facts
              (external_person_id, ordinal, claim, source_ids, evidence_class)
            values (${id}, ${ordinal}, ${fact.claim},
                    array(select jsonb_array_elements_text(${jsonbParam(tx.sql, fact.sourceIds)}::jsonb)),
                    ${fact.evidenceClass})`;
          ordinal += 1;
        }
      });
      return { externalPersonId: id };
    },

    listPrepared: async () => {
      const rows = await sql<EntityRow[]>`
        select id, profile_key, entity_kind, research_status, requires_refresh,
               display_name, profile_url, role, organization, location,
               confidence, quotes, image, profile, last_researched_at,
               investor_organisation_id
          from q_runtime.external_persons
         where research_status = 'PREPARED_PUBLIC_SEED' and tenant_id is null
         order by profile_key`;
      return hydrate(rows);
    },

    findByAlias: async (aliasKey) => {
      const rows = await sql<EntityRow[]>`
        select p.id, p.profile_key, p.entity_kind, p.research_status,
               p.requires_refresh, p.display_name, p.profile_url, p.role,
               p.organization, p.location, p.confidence, p.quotes, p.image,
               p.profile, p.last_researched_at, p.investor_organisation_id
          from q_runtime.external_persons p
          join q_runtime.external_entity_aliases a
            on a.external_person_id = p.id
         where a.alias_key = ${aliasKey}
           and p.research_status = 'PREPARED_PUBLIC_SEED' and p.tenant_id is null
         limit 4`;
      return hydrate(rows);
    },
  };
}
