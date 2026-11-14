import type { DatabaseExecutor } from "@capital-q/database";

import { isKnownTimeZone } from "./schedule/slots.js";

/**
 * Notices for the OTHER side of a relationship (AUTO, 2026-10-02): an
 * investor's interest or a founder's connection request arriving, the
 * first message Q sends on someone's behalf, a time Q proposes. Each goes
 * to the receiving organisation's active members, once per happening
 * (dedupe key), with a link to their own page for it. The words name who
 * acted and that Q acted for them; nothing is disclosed that the receiving
 * side was not already sent.
 */

export type CounterpartNoticeKind =
  | "INTEREST_RECEIVED"
  | "CONNECTION_REQUESTED"
  /** The other side accepted the interest or request (audit 2026-11-13 D1). */
  | "INTEREST_ACCEPTED"
  | "Q_MESSAGE"
  | "TIME_PROPOSED"
  /** A pass, pause or resume on the relationship (2026-10-02). */
  | "RELATIONSHIP_OUTCOME"
  /** A diligence request or a shared document (2026-10-02). */
  | "DILIGENCE"
  /** A commitment moved a step: amount, sent, received (2026-10-04). */
  | "COMMITMENT";

export function createCounterpartNotices(sql: DatabaseExecutor) {
  return {
    notify: async (input: {
      readonly relationshipId: string;
      /** The side that acted; its counterpart's people are told. */
      readonly actingSide: "INVESTOR" | "COMPANY";
      readonly kind: CounterpartNoticeKind;
      readonly title: string;
      readonly body: string | null;
      /**
       * The body in one recipient's own time zone (a call time said in
       * their local time, live audit 2026-11-14 D2). Used for each
       * recipient whose profile names a known zone; everyone else reads
       * `body`, already worded in the proposal's own zone.
       */
      readonly bodyInZone?: ((timeZone: string) => string) | undefined;
      /**
       * Where they act: their inbox, their chat, the relationship page, or
       * its Diligence tab, or Capital. `{actor}` in the title becomes the acting side's
       * own name, read here from the relationship, never from the caller.
       */
      readonly target:
        | "INBOX"
        | "CHAT"
        | "RELATIONSHIP"
        | "DILIGENCE"
        | "CAPITAL"
        /**
         * 2026-10-08: the founder's Documents inbox, opened at this
         * request or question set (`key` is its id).
         */
        | "DOCUMENTS"
        /** 2026-10-08: the investor's view of the company (data room, answers). */
        | "COMPANY_PROFILE";
      readonly key: string;
      readonly priority: "NEEDS_YOU" | "UPDATE";
    }): Promise<number> => {
      const zoned = await zonedBodies(input);
      const rows = await sql<{ id: string }[]>`
        insert into communication.notifications
          (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
        select m.tenant_id, m.user_id, ${input.kind},
               left(replace(${input.title}, '{actor}',
                            case when ${input.actingSide} = 'INVESTOR' then i.display_name
                                 else c.canonical_name end), 200),
               coalesce(
                 (select z.body
                    from unnest(${zoned.zones}::text[], ${zoned.bodies}::text[]) as z(zone, body)
                   where z.zone = up.timezone
                   limit 1),
                 ${input.body === null ? null : input.body.slice(0, 1000)}),
               case
                 when ${input.target} = 'DOCUMENTS'
                   then '/documents?tab=requested&item=' || ${encodeURIComponent(input.key)}
                 when ${input.target} = 'COMPANY_PROFILE'
                   then '/company/' || r.company_id::text || '#data-room'
                 when ${input.target} = 'CAPITAL' then '/capital'
                 when ${input.target} = 'INBOX' and ${input.actingSide} = 'INVESTOR' then '/company/interest'
                 when ${input.target} = 'INBOX' then '/investors'
                 when ${input.target} = 'RELATIONSHIP' and ${input.actingSide} = 'INVESTOR'
                   then '/relationships/investor/' || r.investor_organisation_id::text
                 when ${input.target} = 'RELATIONSHIP'
                   then '/relationships/company/' || r.company_id::text
                 when ${input.target} = 'DILIGENCE' and ${input.actingSide} = 'INVESTOR'
                   then '/relationships/investor/' || r.investor_organisation_id::text || '/diligence'
                 when ${input.target} = 'DILIGENCE'
                   then '/relationships/company/' || r.company_id::text || '/diligence'
                 when ${input.actingSide} = 'INVESTOR'
                   then '/relationships/investor/' || r.investor_organisation_id::text || '/messages'
                 else '/relationships/company/' || r.company_id::text || '/messages'
               end,
               ${`${input.kind.toLowerCase()}:${input.key}`.slice(0, 200)},
               ${input.priority}
          from network.relationships r
          join core.companies c on c.id = r.company_id
          join core.investor_organisations i on i.id = r.investor_organisation_id
          join identity.organisation_memberships m
            on m.organisation_id = case when ${input.actingSide} = 'INVESTOR'
                                        then c.organisation_id else i.organisation_id end
           and m.membership_status = 'active'
          left join identity.user_profiles up on up.id = m.user_id
         where r.id = ${input.relationshipId}
         limit 20
        on conflict (user_id, dedupe_key) do nothing
        returning id`;
      return rows.length;
    },
  };

  /**
   * One body per zone the receiving side's people have set: read first
   * (a short select), worded here, matched to each person in the insert.
   */
  async function zonedBodies(input: {
    readonly relationshipId: string;
    readonly actingSide: "INVESTOR" | "COMPANY";
    readonly bodyInZone?: ((timeZone: string) => string) | undefined;
  }): Promise<{ zones: string[]; bodies: string[] }> {
    const zones: string[] = [];
    const bodies: string[] = [];
    if (input.bodyInZone === undefined) return { zones, bodies };
    const rows = await sql<{ timezone: string }[]>`
      select distinct up.timezone
        from network.relationships r
        join core.companies c on c.id = r.company_id
        join core.investor_organisations i on i.id = r.investor_organisation_id
        join identity.organisation_memberships m
          on m.organisation_id = case when ${input.actingSide} = 'INVESTOR'
                                      then c.organisation_id else i.organisation_id end
         and m.membership_status = 'active'
        join identity.user_profiles up on up.id = m.user_id
       where r.id = ${input.relationshipId} and up.timezone is not null
       limit 20`;
    for (const row of rows) {
      if (!isKnownTimeZone(row.timezone)) continue;
      zones.push(row.timezone);
      bodies.push(input.bodyInZone(row.timezone).slice(0, 1000));
    }
    return { zones, bodies };
  }
}

export type CounterpartNotices = ReturnType<typeof createCounterpartNotices>;

/**
 * A new chat message, told to the other side (QA run 8a1d57b9: neither
 * side was told). One notice per person per conversation (dedupe key
 * `chat:<conversation id>`): a message while it is unread folds into it
 * (no second push); one after they read it raises it again. The words are
 * never copied in: the notice names who wrote and links to the thread.
 *
 * Idempotent: the notice carries the message's own time, and a notice is
 * only moved forward by a newer message, so a redelivered event changes
 * nothing.
 */
export function createChatMessageNotices(sql: DatabaseExecutor) {
  return {
    notify: async (input: {
      readonly relationshipId: string;
      readonly conversationId: string;
      /** The side that wrote; the other side's people are told. */
      readonly senderSide: "INVESTOR" | "COMPANY";
      /** When the message was sent (the event's time). */
      readonly at: Date;
    }): Promise<number> => {
      const rows = await sql<{ id: string }[]>`
        insert into communication.notifications as n
          (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority, created_at)
        select m.tenant_id, m.user_id, 'CHAT_MESSAGE',
               left(case when ${input.senderSide} = 'INVESTOR' then i.display_name
                         else c.canonical_name end || ' sent you a message', 200),
               'Open the conversation to read it and reply.',
               case when ${input.senderSide} = 'INVESTOR'
                    then '/relationships/investor/' || r.investor_organisation_id::text || '/messages'
                    else '/relationships/company/' || r.company_id::text || '/messages' end,
               ${`chat:${input.conversationId}`}, 'NEEDS_YOU', ${input.at}
          from network.relationships r
          join core.companies c on c.id = r.company_id
          join core.investor_organisations i on i.id = r.investor_organisation_id
          join identity.organisation_memberships m
            on m.organisation_id = case when ${input.senderSide} = 'INVESTOR'
                                        then c.organisation_id else i.organisation_id end
           and m.membership_status = 'active'
         where r.id = ${input.relationshipId}
         limit 20
        on conflict (user_id, dedupe_key) do update
           set title = excluded.title,
               body = case when n.read_at is null
                           then 'New messages. Open the conversation to read them and reply.'
                           else excluded.body end,
               created_at = excluded.created_at,
               -- Still unread: folded in, not pushed or emailed again.
               pushed_at = case when n.read_at is null then n.pushed_at end,
               emailed_at = case when n.read_at is null then n.emailed_at end,
               read_at = null
         where n.created_at < excluded.created_at
        returning n.id`;
      return rows.length;
    },
  };
}

export type ChatMessageNotices = ReturnType<typeof createChatMessageNotices>;
