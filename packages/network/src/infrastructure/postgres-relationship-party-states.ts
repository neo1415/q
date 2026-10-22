import { z } from "zod";

import {
  RELATIONSHIP_NEXT_STEPS,
  RelationshipStateV2Schema,
  UuidSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

/**
 * network.relationship_party_states (migration 20261226210000): the CRM
 * pipeline's read model. SQL only. The caller decides which party may be
 * read; every query here is bound to exactly that party.
 *
 * Counterpart names are joined fresh from the canonical company and
 * investor organisation records at query time (the same pattern as the
 * diligence questions read), so a rename is never stale here.
 */

export type PipelineParty = "INVESTOR" | "COMPANY";
export type PipelineSort = "recent" | "oldest" | "name" | "name-desc";

export type PartyStateWrite = {
  readonly relationshipId: string;
  readonly party: PipelineParty;
  /** Null: nothing on record this party may see. */
  readonly view: {
    readonly state: string;
    readonly stateSince: string;
    readonly nextStep: string;
  } | null;
  /** The relationship history's last sequence that this fold read. */
  readonly sourceSequence: number;
  readonly version: string;
};

const PageRowSchema = z.object({
  relationship_id: UuidSchema,
  counterpart_id: UuidSchema,
  counterpart_name: z.string().min(1).max(200),
  state: RelationshipStateV2Schema,
  state_since: z.union([z.date(), z.string()]),
  next_step: z.enum(RELATIONSHIP_NEXT_STEPS),
  /** The keyset value this row sorts by, as text. */
  sort_key: z.string(),
});
export type PipelinePageRow = {
  readonly relationshipId: string;
  readonly counterpartId: string;
  readonly counterpartName: string;
  readonly state: z.infer<typeof RelationshipStateV2Schema>;
  readonly stateSince: string;
  readonly nextStep: (typeof RELATIONSHIP_NEXT_STEPS)[number];
  readonly sortKey: string;
};

export type PipelineFilter = {
  readonly party: PipelineParty;
  /** The investor organisation's or the company's id: the party itself. */
  readonly partyId: string;
  /** Lower-cased, trimmed; empty matches every name. */
  readonly q: string;
  readonly state: string | null;
};

const iso = (value: Date | string) => new Date(value).toISOString();

export function createPostgresRelationshipPartyStates() {
  /** The party, its counterpart's canonical name and the filters. */
  const scoped = (sql: DatabaseExecutor, filter: PipelineFilter) =>
    filter.party === "INVESTOR"
      ? sql`
          from network.relationship_party_states s
          join core.companies c on c.id = s.company_id
         where s.party = 'INVESTOR'
           and s.investor_organisation_id = ${filter.partyId}
           and s.visible
           and (${filter.state}::text is null or s.state = ${filter.state}::text)
           and (${filter.q} = '' or strpos(lower(c.canonical_name), ${filter.q}) > 0)`
      : sql`
          from network.relationship_party_states s
          join core.investor_organisations c on c.id = s.investor_organisation_id
         where s.party = 'COMPANY'
           and s.company_id = ${filter.partyId}
           and s.visible
           and (${filter.state}::text is null or s.state = ${filter.state}::text)
           and (${filter.q} = '' or strpos(lower(c.display_name), ${filter.q}) > 0)`;

  const nameOf = (sql: DatabaseExecutor, party: PipelineParty) =>
    party === "INVESTOR" ? sql`c.canonical_name` : sql`c.display_name`;

  return {
    /**
     * Writes one party's fold. A compare-and-set on the source sequence:
     * a fold that read less history never replaces one that read more,
     * except to roll out a new projector version.
     */
    async upsert(sql: DatabaseExecutor, input: PartyStateWrite) {
      const rows = await sql`
        insert into network.relationship_party_states
          (relationship_id, party, tenant_id, company_id, investor_organisation_id,
           visible, state, state_since, next_step, source_sequence, projector_version)
        select r.id, ${input.party}, r.tenant_id, r.company_id, r.investor_organisation_id,
               ${input.view !== null},
               ${input.view?.state ?? null}::text,
               date_trunc('milliseconds', ${input.view?.stateSince ?? null}::text::timestamptz),
               ${input.view?.nextStep ?? null}::text,
               ${input.sourceSequence}, ${input.version}
          from network.relationships r
         where r.id = ${input.relationshipId}
           and ${input.sourceSequence} <= r.last_event_sequence
        on conflict (relationship_id, party) do update
           set visible = excluded.visible,
               state = excluded.state,
               state_since = excluded.state_since,
               next_step = excluded.next_step,
               source_sequence = excluded.source_sequence,
               projector_version = excluded.projector_version,
               projected_at = clock_timestamp()
         where network.relationship_party_states.source_sequence < excluded.source_sequence
            or (network.relationship_party_states.source_sequence = excluded.source_sequence
                and network.relationship_party_states.projector_version <> excluded.projector_version)
        returning relationship_id`;
      return rows.length > 0;
    },

    /**
     * This party's relationships whose stored fold is missing or behind
     * its history (or from another projector version), up to `limit`.
     */
    async behind(
      sql: DatabaseExecutor,
      party: PipelineParty,
      partyId: string,
      version: string,
      limit: number,
    ): Promise<readonly string[]> {
      const rows = await sql`
        select r.id
          from network.relationships r
          left join network.relationship_party_states s
            on s.relationship_id = r.id and s.party = ${party}
         where ${party === "INVESTOR" ? sql`r.investor_organisation_id` : sql`r.company_id`} = ${partyId}
           and (s.relationship_id is null
                or s.source_sequence < r.last_event_sequence
                or s.projector_version <> ${version})
         order by r.id
         limit ${limit}`;
      return rows.map((row) => UuidSchema.parse(row["id"]));
    },

    /**
     * Every relationship (any party) whose stored folds are missing or behind,
     * in id order after `after`: the worker's backfill at start.
     */
    async behindAll(
      sql: DatabaseExecutor,
      page: {
        readonly after: string | null;
        readonly limit: number;
        readonly version: string;
      },
    ): Promise<readonly string[]> {
      const rows = await sql`
        select r.id
          from network.relationships r
         where (${page.after}::uuid is null or r.id > ${page.after}::uuid)
           and exists (
             select 1
               from (values ('INVESTOR'), ('COMPANY')) as p(party)
               left join network.relationship_party_states s
                 on s.relationship_id = r.id and s.party = p.party
              where s.relationship_id is null
                 or s.source_sequence < r.last_event_sequence
                 or s.projector_version <> ${page.version})
         order by r.id
         limit ${page.limit}`;
      return rows.map((row) => UuidSchema.parse(row["id"]));
    },

    async count(sql: DatabaseExecutor, filter: PipelineFilter) {
      const [row] =
        await sql`select count(*)::int as count ${scoped(sql, filter)}`;
      return z.object({ count: z.number().int() }).parse(row).count;
    },

    /**
     * One keyset page in the pipeline's own order: the sort key, then the
     * relationship id ascending as the tie-break, exactly as the in-memory
     * selection ordered it. Names compare lower-cased in code-point order
     * (collate "C"), as JavaScript compares strings.
     */
    async page(
      sql: DatabaseExecutor,
      filter: PipelineFilter,
      sort: PipelineSort,
      after: { readonly key: string; readonly id: string } | null,
      limit: number,
    ): Promise<readonly PipelinePageRow[]> {
      const name = nameOf(sql, filter.party);
      const byName = sort === "name" || sort === "name-desc";
      const key = byName ? sql`lower(${name}) collate "C"` : sql`s.state_since`;
      const keyText = byName
        ? sql`lower(${name})`
        : sql`to_char(s.state_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
      const typedAfter =
        after === null
          ? null
          : byName
            ? sql`${after.key}::text collate "C"`
            : sql`${after.key}::timestamptz`;
      const descending = sort === "recent" || sort === "name-desc";
      const seek =
        typedAfter === null || after === null
          ? sql``
          : descending
            ? sql`and (${key} < ${typedAfter} or (${key} = ${typedAfter} and s.relationship_id > ${after.id}::uuid))`
            : sql`and (${key} > ${typedAfter} or (${key} = ${typedAfter} and s.relationship_id > ${after.id}::uuid))`;
      const order = descending
        ? sql`order by ${key} desc, s.relationship_id asc`
        : sql`order by ${key} asc, s.relationship_id asc`;
      const rows = await sql`
        select s.relationship_id,
               ${filter.party === "INVESTOR" ? sql`s.company_id` : sql`s.investor_organisation_id`} as counterpart_id,
               ${name} as counterpart_name,
               s.state, s.state_since, s.next_step,
               ${keyText} as sort_key
          ${scoped(sql, filter)}
          ${seek}
          ${order}
         limit ${limit}`;
      return rows.map((raw) => {
        const row = PageRowSchema.parse(raw);
        return {
          relationshipId: row.relationship_id,
          counterpartId: row.counterpart_id,
          counterpartName: row.counterpart_name,
          state: row.state,
          stateSince: iso(row.state_since),
          nextStep: row.next_step,
          sortKey: row.sort_key,
        };
      });
    },
  };
}
export type RelationshipPartyStateRepository = ReturnType<
  typeof createPostgresRelationshipPartyStates
>;

/**
 * A company's investor conversations counted by its own projected state
 * (Q Card, Q Story S6): counts only, never who. Only rows the company's
 * own fold may see are counted, exactly as its pipeline shows them.
 */
export function createPostgresCompanyPipelineCounts({
  sql,
}: {
  readonly sql: DatabaseExecutor;
}) {
  return {
    async byState(
      companyId: string,
    ): Promise<Readonly<Record<string, number>>> {
      const rows = await sql`
        select s.state, count(*)::int as count
          from network.relationship_party_states s
         where s.party = 'COMPANY'
           and s.company_id = ${companyId}
           and s.visible
         group by s.state`;
      const parsed = z
        .array(
          z.object({
            state: RelationshipStateV2Schema,
            count: z.number().int(),
          }),
        )
        .parse(rows);
      return Object.fromEntries(parsed.map((row) => [row.state, row.count]));
    },
  };
}
