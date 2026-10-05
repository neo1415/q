import type { DatabaseExecutor } from "@capital-q/database";

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
  | "Q_MESSAGE"
  | "TIME_PROPOSED"
  /** A pass, pause or resume on the relationship (2026-10-02). */
  | "RELATIONSHIP_OUTCOME"
  /** A diligence request or a shared document (2026-10-02). */
  | "DILIGENCE";

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
       * Where they act: their inbox, their chat, the relationship page, or
       * its Diligence tab. `{actor}` in the title becomes the acting side's
       * own name, read here from the relationship, never from the caller.
       */
      readonly target: "INBOX" | "CHAT" | "RELATIONSHIP" | "DILIGENCE";
      readonly key: string;
      readonly priority: "NEEDS_YOU" | "UPDATE";
    }): Promise<number> => {
      const rows = await sql<{ id: string }[]>`
        insert into communication.notifications
          (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
        select m.tenant_id, m.user_id, ${input.kind},
               left(replace(${input.title}, '{actor}',
                            case when ${input.actingSide} = 'INVESTOR' then i.display_name
                                 else c.canonical_name end), 200),
               ${input.body === null ? null : input.body.slice(0, 1000)},
               case
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
         where r.id = ${input.relationshipId}
         limit 20
        on conflict (user_id, dedupe_key) do nothing
        returning id`;
      return rows.length;
    },
  };
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
