import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Live check 15 Nov 2026 (O1): a NEEDS_YOU notice is history, written once
 * when something asked the person to act. Whether it still asks is the
 * subject's current state, read here from the communication context's own
 * rows. Each function returns the ids of the given notices whose subject no
 * longer waits on the person; a notice whose subject cannot be found is not
 * returned (unknown stays shown). Notices are never changed or deleted.
 */

export type NoticeToCheck = {
  readonly id: string;
  readonly userId: string;
  /** The notice's stored dedupe key, e.g. `chat:<conversation id>`. */
  readonly dedupeKey: string;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PROPOSAL_KEY = new RegExp(
  `^time_proposed:proposal:(${UUID}):r(\\d{1,2})(:counter)?$`,
  "iu",
);
const CHAT_KEY = new RegExp(`^chat:(${UUID})$`, "iu");

/**
 * TIME_PROPOSED (`proposal:<id>:r<revision>`, the investor to answer the
 * founder's times; `…:counter`, the founder to answer the investor's):
 * settled once that revision is no longer the one waiting on this side --
 * accepted, declined, countered or re-proposed.
 */
export async function settledProposalNotices(
  sql: DatabaseExecutor,
  notices: readonly NoticeToCheck[],
): Promise<ReadonlySet<string>> {
  const parsed = notices.flatMap((notice) => {
    const match = PROPOSAL_KEY.exec(notice.dedupeKey);
    if (match === null) return [];
    const [, proposalId, revision, counter] = match;
    if (proposalId === undefined || revision === undefined) return [];
    return [
      {
        id: notice.id,
        proposalId: proposalId.toLowerCase(),
        revision: Number(revision),
        counter: counter !== undefined,
      },
    ];
  });
  if (parsed.length === 0) return new Set();
  const rows = await sql<{ id: string; state: string; revision: number }[]>`
    select id, state, revision
      from communication.meeting_time_proposals
     where id = any(${[...new Set(parsed.map((one) => one.proposalId))]}::uuid[])`;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const settled = new Set<string>();
  for (const one of parsed) {
    const proposal = byId.get(one.proposalId);
    if (proposal === undefined) continue;
    const waiting = one.counter
      ? proposal.state === "COUNTERPROPOSED"
      : proposal.state === "PROPOSED" || proposal.state === "INVESTOR_REVIEW";
    if (!waiting || proposal.revision !== one.revision) settled.add(one.id);
  }
  return settled;
}

/**
 * CHAT_MESSAGE (`chat:<conversation id>`): settled once the conversation's
 * latest message (unsent ones left out) came from the person's own side --
 * they, a colleague or Q for them replied.
 */
export async function settledChatNotices(
  sql: DatabaseExecutor,
  notices: readonly NoticeToCheck[],
): Promise<ReadonlySet<string>> {
  const parsed = notices.flatMap((notice) => {
    const conversationId = CHAT_KEY.exec(notice.dedupeKey)?.[1];
    return conversationId === undefined
      ? []
      : [{ ...notice, conversationId: conversationId.toLowerCase() }];
  });
  if (parsed.length === 0) return new Set();
  const rows = await sql<{ id: string }[]>`
    select n.id
      from unnest(${parsed.map((one) => one.id)}::uuid[],
                  ${parsed.map((one) => one.userId)}::uuid[],
                  ${parsed.map((one) => one.conversationId)}::uuid[])
             as n(id, user_id, conversation_id)
      join communication.conversations cv on cv.id = n.conversation_id
      join network.relationships r on r.id = cv.relationship_id
      join core.companies c on c.id = r.company_id
      join core.investor_organisations i on i.id = r.investor_organisation_id
      cross join lateral (
        select m.sender_side
          from communication.messages m
         where m.conversation_id = cv.id
           and m.kind in ('TEXT', 'ATTACHMENT', 'VOICE_NOTE')
           and not exists (
             select 1 from communication.messages t
              where t.revises_message_id = m.id and t.kind = 'TOMBSTONE')
         order by m.created_at desc
         limit 1) latest
     where exists (
       select 1 from identity.organisation_memberships om
        where om.user_id = n.user_id
          and om.membership_status = 'active'
          and om.organisation_id = case when latest.sender_side = 'COMPANY'
                                        then c.organisation_id
                                        else i.organisation_id end)`;
  return new Set(rows.map((row) => row.id));
}
