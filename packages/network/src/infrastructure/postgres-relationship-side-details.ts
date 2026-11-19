import { z } from "zod";

import {
  RelationshipSidePrioritySchema,
  RelationshipSideStageSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

/**
 * network.relationship_side_details (migration 20261231599520): a side's
 * own pipeline fields on one canonical relationship. SQL only. Who may read
 * or write is decided by the caller (application/relationship-side-details)
 * and repeated in every WHERE: a row outside the actor's own tenant,
 * organisation and side is never read or written.
 */

/** The side the fields belong to: the actor organisation's own party. */
export type RelationshipSideOf = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly party: "INVESTOR" | "COMPANY";
  /** The side's own company or investor organisation. */
  readonly partyId: string;
};

/** The values a write sets; a field left out keeps its current value. */
export type SideDetailValues = {
  readonly stage?: string | null;
  readonly stageLabel?: string | null;
  readonly owner?: {
    readonly membershipId: string;
    readonly userId: string;
  } | null;
  readonly source?: string | null;
  readonly introducerName?: string | null;
  readonly introducerEmail?: string | null;
  readonly expected?: {
    readonly amount: string;
    readonly currency: string;
  } | null;
  readonly priority?: string | null;
};

const RowSchema = z.object({
  relationship_id: UuidSchema,
  stage: RelationshipSideStageSchema.nullable().catch(null),
  stage_label: z.string().nullable(),
  owner_membership_id: UuidSchema.nullable(),
  owner_user_id: UuidSchema.nullable(),
  owner_name: z.string().nullable(),
  source: z.string().nullable(),
  introducer_name: z.string().nullable(),
  introducer_email: z.string().nullable(),
  // numeric arrives as text: exact, never a float.
  expected_amount: z.string().nullable(),
  expected_currency: z.string().nullable(),
  priority: RelationshipSidePrioritySchema.nullable().catch(null),
  revision: z.number().int(),
  updated_at: z.union([z.date(), z.string()]),
});
export type RelationshipSideDetailRow = z.infer<typeof RowSchema>;

const MemberSchema = z.object({
  membership_id: UuidSchema,
  user_id: UuidSchema,
  name: z.string(),
});
export type RelationshipSideMemberRow = z.infer<typeof MemberSchema>;

const rows = (raw: readonly unknown[]) =>
  raw.map((row) => RowSchema.parse(row));

/** Members offered as an owner, at most (the contract's bound). */
const MEMBERS_MAX = 200;

export type RelationshipSideDetailRepository = ReturnType<
  typeof createPostgresRelationshipSideDetails
>;

export function createPostgresRelationshipSideDetails() {
  const companyOf = (side: RelationshipSideOf) =>
    side.party === "COMPANY" ? side.partyId : null;
  const investorOf = (side: RelationshipSideOf) =>
    side.party === "INVESTOR" ? side.partyId : null;

  return {
    /** Whether the relationship has this side as one of its two parties. */
    async isParty(
      sql: DatabaseExecutor,
      relationshipId: string,
      side: RelationshipSideOf,
    ): Promise<boolean> {
      const [row] =
        side.party === "COMPANY"
          ? await sql`
              select 1 as one from network.relationships
               where id = ${relationshipId} and company_id = ${side.partyId}
               limit 1`
          : await sql`
              select 1 as one from network.relationships
               where id = ${relationshipId}
                 and investor_organisation_id = ${side.partyId}
               limit 1`;
      return row !== undefined;
    },

    /** The relationship's two parties, or null when there is none. */
    async partiesOf(
      sql: DatabaseExecutor,
      relationshipId: string,
    ): Promise<{
      readonly companyId: string;
      readonly investorOrganisationId: string;
    } | null> {
      const [row] = await sql`
        select company_id, investor_organisation_id
          from network.relationships where id = ${relationshipId}`;
      if (row === undefined) return null;
      const parsed = z
        .object({
          company_id: UuidSchema,
          investor_organisation_id: UuidSchema,
        })
        .parse(row);
      return {
        companyId: parsed.company_id,
        investorOrganisationId: parsed.investor_organisation_id,
      };
    },

    /** The side's fields on some of its relationships (a pipeline page). */
    async forRelationships(
      sql: DatabaseExecutor,
      side: RelationshipSideOf,
      relationshipIds: readonly string[],
    ): Promise<readonly RelationshipSideDetailRow[]> {
      if (relationshipIds.length === 0) return [];
      return rows(
        await sql`
          select d.relationship_id, d.stage, d.stage_label,
                 d.owner_membership_id, d.owner_user_id,
                 nullif(btrim(coalesce(p.display_name,
                   concat_ws(' ', p.given_name, p.family_name))), '') as owner_name,
                 d.source, d.introducer_name, d.introducer_email,
                 d.expected_amount::text as expected_amount, d.expected_currency,
                 d.priority, d.revision, d.updated_at
            from network.relationship_side_details d
            left join identity.user_profiles p on p.id = d.owner_user_id
           where d.tenant_id = ${side.tenantId}
             and d.organisation_id = ${side.organisationId}
             and d.party = ${side.party}
             and d.company_id is not distinct from ${companyOf(side)}
             and d.investor_organisation_id is not distinct from ${investorOf(side)}
             and d.relationship_id = any(${[...relationshipIds]}::uuid[])`,
      );
    },

    /** The active members of the side's organisation, by name. */
    async activeMembers(
      sql: DatabaseExecutor,
      side: RelationshipSideOf,
    ): Promise<readonly RelationshipSideMemberRow[]> {
      const found = await sql`
        select m.id as membership_id, m.user_id,
               coalesce(nullif(btrim(coalesce(p.display_name,
                 concat_ws(' ', p.given_name, p.family_name))), ''), 'A colleague') as name
          from identity.organisation_memberships m
          join identity.user_profiles p on p.id = m.user_id
         where m.tenant_id = ${side.tenantId}
           and m.organisation_id = ${side.organisationId}
           and m.membership_status = 'active'
         order by name, m.id
         limit ${MEMBERS_MAX}`;
      return found.map((row) => MemberSchema.parse(row));
    },

    /**
     * Writes the side's values as the next revision. `expectedRevision`
     * 0: the side has none yet (insert); otherwise the revision the writer
     * saw. Null: someone else saved first (or the row is not this side's).
     * `null` for expectedRevision merges onto whatever is there (the
     * import's own write, inside the apply's transaction).
     */
    async write(
      sql: DatabaseExecutor,
      input: {
        readonly relationshipId: string;
        readonly side: RelationshipSideOf;
        readonly userId: string;
        readonly expectedRevision: number | null;
        readonly values: SideDetailValues;
      },
    ): Promise<number | null> {
      const { side, values } = input;
      const has = (key: keyof SideDetailValues) => key in values;
      const [current] = await sql`
        select revision, stage, stage_label, owner_membership_id, owner_user_id,
               source, introducer_name, introducer_email,
               expected_amount::text as expected_amount, expected_currency, priority
          from network.relationship_side_details
         where relationship_id = ${input.relationshipId}
           and party = ${side.party}
           and tenant_id = ${side.tenantId}
           and organisation_id = ${side.organisationId}
         for update`;
      const now = current as Record<string, unknown> | undefined;
      const revision =
        typeof now?.["revision"] === "number" ? now["revision"] : 0;
      if (
        input.expectedRevision !== null &&
        input.expectedRevision !== revision
      )
        return null;
      const keep = <T>(key: keyof SideDetailValues, column: string, next: T) =>
        has(key) ? next : ((now?.[column] ?? null) as T);
      const owner = values.owner;
      const expected = values.expected;
      const merged = {
        stage: keep("stage", "stage", values.stage ?? null),
        stageLabel: keep(
          "stageLabel",
          "stage_label",
          values.stageLabel ?? null,
        ),
        ownerMembershipId: keep(
          "owner",
          "owner_membership_id",
          owner?.membershipId ?? null,
        ),
        ownerUserId: keep("owner", "owner_user_id", owner?.userId ?? null),
        source: keep("source", "source", values.source ?? null),
        introducerName: keep(
          "introducerName",
          "introducer_name",
          values.introducerName ?? null,
        ),
        introducerEmail: keep(
          "introducerEmail",
          "introducer_email",
          values.introducerEmail ?? null,
        ),
        amount: keep("expected", "expected_amount", expected?.amount ?? null),
        currency: keep(
          "expected",
          "expected_currency",
          expected?.currency ?? null,
        ),
        priority: keep("priority", "priority", values.priority ?? null),
      };
      if (now === undefined) {
        const inserted = await sql`
          insert into network.relationship_side_details
            (relationship_id, party, tenant_id, organisation_id, company_id,
             investor_organisation_id, stage, stage_label, owner_membership_id,
             owner_user_id, source, introducer_name, introducer_email,
             expected_amount, expected_currency, priority, updated_by_user_id)
          values
            (${input.relationshipId}, ${side.party}, ${side.tenantId},
             ${side.organisationId}, ${companyOf(side)}, ${investorOf(side)},
             ${merged.stage}, ${merged.stageLabel}, ${merged.ownerMembershipId},
             ${merged.ownerUserId}, ${merged.source}, ${merged.introducerName},
             ${merged.introducerEmail}, ${merged.amount}::numeric,
             ${merged.currency}, ${merged.priority}, ${input.userId})
          on conflict (relationship_id, party) do nothing
          returning revision`;
        const [row] = inserted as unknown as { revision: number }[];
        return row?.revision ?? null;
      }
      const updated = await sql`
        update network.relationship_side_details
           set stage = ${merged.stage},
               stage_label = ${merged.stageLabel},
               owner_membership_id = ${merged.ownerMembershipId},
               owner_user_id = ${merged.ownerUserId},
               source = ${merged.source},
               introducer_name = ${merged.introducerName},
               introducer_email = ${merged.introducerEmail},
               expected_amount = ${merged.amount}::numeric,
               expected_currency = ${merged.currency},
               priority = ${merged.priority},
               updated_by_user_id = ${input.userId},
               revision = revision + 1
         where relationship_id = ${input.relationshipId}
           and party = ${side.party}
           and tenant_id = ${side.tenantId}
           and organisation_id = ${side.organisationId}
           and revision = ${revision}
        returning revision`;
      const [row] = updated as unknown as { revision: number }[];
      return row?.revision ?? null;
    },
  };
}
