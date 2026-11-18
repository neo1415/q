import type { DatabaseExecutor } from "@capital-q/database";

/**
 * What deleting the account does to each organisation the person is an
 * active member of (decision 107, privacy policy section 10):
 *
 *   CLOSES_WITH_ACCOUNT  nobody else is active in it: it closes with the
 *                        account, which the person confirms by name.
 *   TRANSFER_REQUIRED    they are its only owner and others remain: they
 *                        make someone else an owner first (Team settings).
 *   LEAVES               it continues; their membership ends.
 */

export type OrganisationOutcome =
  "CLOSES_WITH_ACCOUNT" | "TRANSFER_REQUIRED" | "LEAVES";

export type OrganisationForDeletion = {
  readonly organisationId: string;
  readonly name: string;
  readonly isOwner: boolean;
  readonly otherActiveMembers: number;
  readonly outcome: OrganisationOutcome;
};

export async function organisationsForDeletion(
  sql: DatabaseExecutor,
  userId: string,
): Promise<readonly OrganisationForDeletion[]> {
  const rows = await sql<
    {
      organisation_id: string;
      name: string;
      is_owner: boolean;
      others: number;
      other_owners: number;
    }[]
  >`
    with mine as (
      select m.id as membership_id, o.id as organisation_id, o.display_name as name
        from identity.organisation_memberships m
        join identity.organisations o on o.id = m.organisation_id
       where m.user_id = ${userId}
         and m.membership_status = 'active'
         and o.status = 'active'
    ), owners as (
      select mr.membership_id
        from identity.membership_roles mr
        join permissions.roles r on r.id = mr.role_id and r.code = 'organisation_owner'
       where mr.valid_from <= now()
         and (mr.valid_until is null or mr.valid_until > now())
    )
    select mine.organisation_id, mine.name,
           exists (select 1 from owners where owners.membership_id = mine.membership_id) as is_owner,
           (select count(*)::int from identity.organisation_memberships m2
             where m2.organisation_id = mine.organisation_id
               and m2.membership_status = 'active'
               and m2.user_id <> ${userId}) as others,
           (select count(*)::int from identity.organisation_memberships m3
             join owners on owners.membership_id = m3.id
             where m3.organisation_id = mine.organisation_id
               and m3.membership_status = 'active'
               and m3.user_id <> ${userId}) as other_owners
      from mine
     order by mine.name, mine.organisation_id`;
  return rows.map((row) => ({
    organisationId: row.organisation_id,
    name: row.name,
    isOwner: row.is_owner,
    otherActiveMembers: row.others,
    outcome:
      row.others === 0
        ? "CLOSES_WITH_ACCOUNT"
        : row.is_owner && row.other_owners === 0
          ? "TRANSFER_REQUIRED"
          : "LEAVES",
  }));
}
