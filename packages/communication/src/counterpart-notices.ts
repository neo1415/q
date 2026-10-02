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
      /** Where they act: their inbox, their chat, or the relationship page. */
      readonly target: "INBOX" | "CHAT" | "RELATIONSHIP";
      readonly key: string;
      readonly priority: "NEEDS_YOU" | "UPDATE";
    }): Promise<number> => {
      const rows = await sql<{ id: string }[]>`
        insert into communication.notifications
          (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
        select m.tenant_id, m.user_id, ${input.kind}, ${input.title.slice(0, 200)},
               ${input.body === null ? null : input.body.slice(0, 1000)},
               case
                 when ${input.target} = 'INBOX' and ${input.actingSide} = 'INVESTOR' then '/company/interest'
                 when ${input.target} = 'INBOX' then '/investors'
                 when ${input.target} = 'RELATIONSHIP' and ${input.actingSide} = 'INVESTOR'
                   then '/relationships/investor/' || r.investor_organisation_id::text
                 when ${input.target} = 'RELATIONSHIP'
                   then '/relationships/company/' || r.company_id::text
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
