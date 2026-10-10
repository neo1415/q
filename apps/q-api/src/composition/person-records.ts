import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  ExternalPersonSourceSchema,
  PersonBriefSchema,
  type ExternalPersonSource,
  type ExternalPersonSubject,
  type PersonBrief,
} from "@capital-q/contracts/q";
import {
  aliasKeyOf,
  externalPersonIdFor,
  type ResearchedEntityReader,
  type ResearchedEntityScope,
  type ResearchedEntityStore,
} from "@capital-q/q-research";

/**
 * The Postgres owner of researched (non-seed) entities and their versioned
 * briefs (W2; migration 20261222090000). Every read and write is scoped to
 * the asking tenant AND user: a record found for one member is never
 * visible to another, and a brief version is appended, never overwritten.
 * Only metadata, links, source references and derived summaries are stored.
 */

type PersonRow = {
  id: string;
  evidence_bundle_id: string;
  entity_kind: ExternalPersonSubject["entityKind"];
  research_status: ExternalPersonSubject["researchStatus"];
  requires_refresh: boolean;
  display_name: string;
  name_variants: string[];
  profile_url: string | null;
  role: string | null;
  organization: string | null;
  location: string | null;
  confidence: ExternalPersonSubject["confidence"];
  image: ExternalPersonSubject["image"];
  quotes: ExternalPersonSubject["quotes"];
  sources: unknown;
  brief_version: number;
};

export function createPostgresResearchedEntityStore(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): ResearchedEntityStore & ResearchedEntityReader {
  const { sql, transactions } = dependencies;
  return {
    remember: async (scope, input) => {
      const { subject } = input;
      const id = externalPersonIdFor(
        scope.tenantId,
        scope.userId,
        input.profileKey,
      );
      const role = subject.entityKind === "PERSON" ? subject.role : null;
      const rows = await transactions.run(async (tx) => {
        const saved = await tx.sql<
          { id: string; evidence_bundle_id: string }[]
        >`
          insert into q_runtime.external_persons
            (id, tenant_id, user_id, entity_kind, research_status,
             requires_refresh, profile_key, display_name, name_variants,
             profile_url, role, organization, location, confidence, image,
             quotes, sources, last_researched_at)
          values (${id}, ${scope.tenantId}, ${scope.userId},
                  ${subject.entityKind}, 'RESEARCHED', false,
                  ${input.profileKey}, ${subject.displayName.slice(0, 200)},
                  ${JSON.stringify(subject.nameVariants.slice(0, 24))}::jsonb,
                  ${subject.profileUrl}, ${role}, ${subject.organization},
                  ${subject.location}, ${subject.confidence},
                  ${JSON.stringify(subject.image)}::jsonb,
                  ${JSON.stringify(subject.quotes)}::jsonb,
                  ${JSON.stringify(input.sources.slice(0, 16))}::jsonb,
                  clock_timestamp())
          on conflict (tenant_id, user_id, profile_key) where tenant_id is not null
          do update set
            display_name = excluded.display_name,
            name_variants = excluded.name_variants,
            profile_url = excluded.profile_url,
            role = excluded.role,
            organization = excluded.organization,
            location = excluded.location,
            confidence = excluded.confidence,
            sources = excluded.sources,
            research_status = 'RESEARCHED',
            last_researched_at = clock_timestamp(),
            updated_at = clock_timestamp()
          returning id, evidence_bundle_id`;
        const row = saved[0];
        if (row === undefined) throw new Error("external person not saved");
        await tx.sql`delete from q_runtime.external_entity_aliases where external_person_id = ${row.id}`;
        const seen = new Set<string>();
        for (const alias of [subject.displayName, ...subject.nameVariants]) {
          const key = aliasKeyOf(alias);
          if (key.length === 0 || seen.has(key)) continue;
          seen.add(key);
          await tx.sql`
            insert into q_runtime.external_entity_aliases
              (external_person_id, alias_key, alias)
            values (${row.id}, ${key}, ${alias.slice(0, 200)})`;
        }
        return saved;
      });
      const row = rows[0];
      if (row === undefined) throw new Error("external person not saved");
      return {
        externalPersonId: row.id,
        evidenceBundleId: row.evidence_bundle_id,
      };
    },

    latestBrief: async (scope, externalPersonId) => {
      const rows = await sql<
        {
          external_person_id: string;
          version: number;
          built_at: Date | string;
          fresh_until: Date | string;
          sources: unknown;
          assertions: unknown;
          entity_kind: string;
        }[]
      >`
        select b.external_person_id, b.version, b.built_at, b.fresh_until,
               b.sources, b.assertions, p.entity_kind
          from q_runtime.external_person_briefs b
          join q_runtime.external_persons p on p.id = b.external_person_id
         where b.external_person_id = ${externalPersonId}
           and p.tenant_id = ${scope.tenantId} and p.user_id = ${scope.userId}
         order by b.version desc
         limit 1`;
      const row = rows[0];
      if (row === undefined) return null;
      const parsed = PersonBriefSchema.safeParse({
        externalPersonId: row.external_person_id,
        entityKind: row.entity_kind,
        version: row.version,
        builtAt: new Date(row.built_at).toISOString(),
        freshUntil: new Date(row.fresh_until).toISOString(),
        sources: row.sources,
        assertions: row.assertions,
      });
      return parsed.success ? parsed.data : null;
    },

    appendBrief: async (scope: ResearchedEntityScope, brief: PersonBrief) => {
      await transactions.run(async (tx) => {
        const owned = await tx.sql<{ id: string }[]>`
          select id from q_runtime.external_persons
           where id = ${brief.externalPersonId}
             and tenant_id = ${scope.tenantId} and user_id = ${scope.userId}`;
        if (owned.length === 0) throw new Error("not the asker's entity");
        await tx.sql`
          insert into q_runtime.external_person_briefs
            (external_person_id, tenant_id, user_id, version, built_at,
             fresh_until, sources, assertions)
          values (${brief.externalPersonId}, ${scope.tenantId}, ${scope.userId},
                  ${brief.version}, ${brief.builtAt}::timestamptz,
                  ${brief.freshUntil}::timestamptz,
                  ${JSON.stringify(brief.sources)}::jsonb,
                  ${JSON.stringify(brief.assertions)}::jsonb)`;
        await tx.sql`
          update q_runtime.external_persons
             set brief_version = ${brief.version}, updated_at = clock_timestamp()
           where id = ${brief.externalPersonId}`;
      });
    },

    find: async (scope, by) => {
      const rows =
        by.externalPersonId !== undefined
          ? await sql<PersonRow[]>`
              select id, evidence_bundle_id, entity_kind, research_status,
                     requires_refresh, display_name, name_variants, profile_url,
                     role, organization, location, confidence, image, quotes,
                     sources, brief_version
                from q_runtime.external_persons
               where id = ${by.externalPersonId}
                 and tenant_id = ${scope.tenantId} and user_id = ${scope.userId}`
          : by.aliasKey === undefined
            ? []
            : await sql<PersonRow[]>`
                select p.id, p.evidence_bundle_id, p.entity_kind,
                       p.research_status, p.requires_refresh, p.display_name,
                       p.name_variants, p.profile_url, p.role, p.organization,
                       p.location, p.confidence, p.image, p.quotes, p.sources,
                       p.brief_version
                  from q_runtime.external_persons p
                  join q_runtime.external_entity_aliases a
                    on a.external_person_id = p.id
                 where a.alias_key = ${by.aliasKey}
                   and p.tenant_id = ${scope.tenantId}
                   and p.user_id = ${scope.userId}
                 order by p.last_researched_at desc
                 limit 1`;
      const row = rows[0];
      if (row === undefined) return null;
      const sources: ExternalPersonSource[] = [];
      for (const raw of Array.isArray(row.sources) ? row.sources : []) {
        const parsed = ExternalPersonSourceSchema.safeParse(raw);
        if (parsed.success) sources.push(parsed.data);
      }
      if (sources.length === 0) return null;
      return {
        subject: {
          externalPersonId: row.id,
          entityKind: row.entity_kind,
          researchStatus: row.research_status,
          requiresRefresh: row.requires_refresh,
          image: row.image,
          quotes: row.quotes,
          displayName: row.display_name,
          nameVariants: row.name_variants,
          profileUrl: row.profile_url,
          role: row.role,
          organization: row.organization,
          location: row.location,
          evidenceBundleId: row.evidence_bundle_id,
          briefVersion: row.brief_version,
          confidence: row.confidence,
        },
        sources,
      };
    },
  };
}
