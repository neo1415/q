import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Q Workspace §8 A6: notices to a company's founders, through the existing
 * notices table (the delivery ticker pushes and emails them as it does
 * every notice). Each obeys its admin setting, read in the same statement
 * through analytics.settings(), and words identity only at the level the
 * investor allowed. Never "get in touch": saving and viewing are not an
 * invitation (§6.7.14).
 */

export type EngagementNotices = {
  /** An investor saved the company (an intent signal). Returns notices written. */
  readonly companySaved: (input: {
    readonly saverUserId: string;
    /** core.investor_organisations id, as the interaction records it. */
    readonly investorOrganisationId: string;
    readonly companyId: string;
  }) => Promise<number>;
  /**
   * The week's passive viewing for every company above the floor, aggregate
   * only, when the admin turned the digest on. Idempotent per company and
   * week. Returns notices written.
   */
  readonly weeklyDigest: (input: { readonly now: Date }) => Promise<number>;
};

export function createEngagementNotices(
  sql: DatabaseExecutor,
): EngagementNotices {
  return {
    companySaved: async ({
      saverUserId,
      investorOrganisationId,
      companyId,
    }) => {
      const rows = await sql<{ id: string }[]>`
        with saver as (
          select io.organisation_id, o.display_name as firm, p.display_name as person,
                 coalesce(s.visibility, analytics.default_viewing_visibility()) as level
            from core.investor_organisations io
            join identity.organisations o on o.id = io.organisation_id
            join identity.user_profiles p on p.id = ${saverUserId}::uuid
            left join analytics.viewing_privacy_settings s on s.user_id = p.id
           where io.id = ${investorOrganisationId}::uuid
        ),
        company as (
          select c.id, c.tenant_id, c.organisation_id from core.companies c
           where c.id = ${companyId}::uuid
        )
        insert into communication.notifications
          (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
        select m.tenant_id, m.user_id, 'COMPANY_SAVED',
               left(case saver.level
                      when 'FULL_IDENTITY' then coalesce(saver.person, 'Someone') || ' from ' || saver.firm || ' saved your company'
                      when 'ORGANISATION_ONLY' then 'Someone from ' || saver.firm || ' saved your company'
                      else 'An investor saved your company'
                    end, 200),
               'Saving means they want to come back to it; it is not interest yet.',
               '/analytics',
               -- One notice per firm, company and day, however often they
               -- save and unsave.
               'company-saved:' || ${investorOrganisationId} || ':' || company.id::text || ':'
                 || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
               'UPDATE'
          from saver, company
          join identity.organisation_memberships m
            on m.organisation_id = company.organisation_id
           and m.tenant_id = company.tenant_id
           and m.membership_status = 'active'
         where (analytics.settings()).intent_signal_notifications
           and saver.organisation_id <> company.organisation_id
        on conflict do nothing
        returning id`;
      return rows.length;
    },

    weeklyDigest: async ({ now }) => {
      // The week just completed; a run during it never sees the current one.
      const rows = await sql<{ id: string }[]>`
        with settings as (select (analytics.settings()).passive_view_notifications as on_),
        week as (
          select date_trunc('week', ${now}::timestamptz) - interval '7 days' as start,
                 date_trunc('week', ${now}::timestamptz) as finish
        ),
        per_company as (
          select e.company_id, count(distinct e.viewer_organisation_id)::int as organisations,
                 count(*) filter (where e.engagement_type = 'PROFILE_VIEW')::int as profile_views,
                 count(*) filter (where e.engagement_type = 'DECK_OPEN')::int as deck_opens
            from analytics.engagement_events e
            join core.companies c on c.id = e.company_id and c.tenant_id = e.company_tenant_id
            cross join week
           where e.occurred_at >= week.start and e.occurred_at < week.finish
             and e.viewer_organisation_id <> c.organisation_id
           group by e.company_id
          having count(distinct e.viewer_organisation_id) >= analytics.engagement_floor()
        )
        insert into communication.notifications
          (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
        select m.tenant_id, m.user_id, 'VIEWING_DIGEST',
               pc.organisations || ' investor organisations viewed your company last week',
               pc.profile_views || ' profile views and ' || pc.deck_opens
                 || ' deck opens. Viewing is not interest, and not an invitation to get in touch.',
               '/analytics',
               'viewing-digest:' || pc.company_id::text || ':' || to_char(week.start, 'YYYY-MM-DD'),
               'UPDATE'
          from per_company pc
          cross join week
          join core.companies c on c.id = pc.company_id
          join identity.organisation_memberships m
            on m.organisation_id = c.organisation_id
           and m.tenant_id = c.tenant_id
           and m.membership_status = 'active'
         where (select on_ from settings)
        on conflict do nothing
        returning id`;
      return rows.length;
    },
  };
}

type DecideOutcome = {
  readonly kind: string;
  readonly deduplicated?: boolean;
  readonly event?: {
    readonly investorOrganisationId: string;
    readonly companyId: string;
  };
};

/**
 * Wraps a Discover decision (`decide`) so that a newly recorded save tells
 * the company's founders. The decision is already committed; a notice that
 * fails is lost, never the save.
 */
export function noticeSaves<
  T extends string,
  C extends { readonly actor: { readonly userId: string } },
  O extends DecideOutcome,
>(
  decide: (type: T, command: C) => Promise<O>,
  notices: Pick<EngagementNotices, "companySaved">,
): (type: T, command: C) => Promise<O> {
  return async (type, command) => {
    const outcome = await decide(type, command);
    if (
      type === "SAVE" &&
      outcome.kind === "RECORDED" &&
      outcome.deduplicated !== true &&
      outcome.event !== undefined
    ) {
      await notices
        .companySaved({
          saverUserId: command.actor.userId,
          investorOrganisationId: outcome.event.investorOrganisationId,
          companyId: outcome.event.companyId,
        })
        .catch(() => 0);
    }
    return outcome;
  };
}
