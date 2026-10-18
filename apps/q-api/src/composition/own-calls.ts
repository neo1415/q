import type { OwnReadItem } from "@capital-q/app-actions";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

/**
 * Their recent calls with Q's notes (2026-10-02), for read_my("calls"): so
 * "how did it go?", the follow-ups and what was proposed to Q in a call can
 * be turned into reminders or message drafts, each behind the approval
 * card. The person's own rows only, as the meeting page shows them to
 * them: what was agreed is both sides'; Q's follow-ups stay with the person
 * whose assistant wrote them (spec 6.9.6); a proposal made to Q in the call
 * is the organiser's to approve, so only the organiser reads it.
 */

const CALLS_MAX = 5;
const FACT_MAX = 200;

function clip(parts: readonly string[]): string | null {
  const joined = parts
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0)
    .join("; ");
  if (joined.length === 0) return null;
  return joined.length > FACT_MAX
    ? `${joined.slice(0, FACT_MAX - 1)}…`
    : joined;
}

const texts = (value: unknown, key?: string): string[] =>
  Array.isArray(value)
    ? value.flatMap((entry: unknown) => {
        if (typeof entry === "string") return [entry];
        if (
          key !== undefined &&
          typeof entry === "object" &&
          entry !== null &&
          key in entry
        ) {
          const text: unknown = Reflect.get(entry, key);
          return typeof text === "string" ? [text] : [];
        }
        return [];
      })
    : [];

export function createOwnCalls(dependencies: {
  readonly sql: DatabaseExecutor;
}): (actor: ActorContext) => Promise<readonly OwnReadItem[]> {
  const { sql } = dependencies;
  return async (actor) => {
    const rows = await sql<
      {
        id: string;
        purpose: string;
        starts_at: Date;
        agreements: unknown;
        follow_ups: unknown;
        own_notes: boolean;
        organiser: boolean;
        proposals: string[] | null;
        screen_notes: string[] | null;
      }[]
    >`
      select m.id, m.purpose, m.starts_at,
             a.agreements,
             a.follow_ups,
             a.user_id = ${actor.userId} as own_notes,
             m.organiser_user_id = ${actor.userId} as organiser,
             (select array_agg(n.body order by n.created_at)
                from communication.meeting_host_notes n
               where n.meeting_id = m.id and n.kind = 'PROPOSAL') as proposals,
             -- P5: Q's private notes on shared screens: the owner's alone.
             (select array_agg(o.body order by o.observed_at)
                from communication.meeting_private_observations o
               where o.meeting_id = m.id
                 and o.owner_user_id = ${actor.userId}
                 and o.tenant_id = ${actor.tenantId}) as screen_notes
        from communication.meetings m
        join communication.meeting_participants p
          on p.meeting_id = m.id and p.user_id = ${actor.userId}
        join communication.meeting_assistants a
          on a.meeting_id = m.id and a.status = 'DONE'
       where m.starts_at > now() - interval '30 days'
       order by m.starts_at desc
       limit ${CALLS_MAX}`;
    return rows.map((row) => ({
      id: row.id,
      title: row.purpose.slice(0, 200),
      status: "notes ready",
      at: new Date(row.starts_at).toISOString(),
      facts: {
        agreed: clip(texts(row.agreements)),
        yourFollowUps: row.own_notes
          ? clip(texts(row.follow_ups, "text"))
          : null,
        proposedToQInTheCall: row.organiser ? clip(row.proposals ?? []) : null,
        // Never shared with the other side or put in the recap.
        yourPrivateScreenNotes: clip(row.screen_notes ?? []),
        // How Q acts on any of it: a reminder or a message draft, each
        // prepared for their approval; an outcome is recorded once they
        // confirm it.
        next: "offer reminders or message drafts for approval; ask how it went",
      },
    }));
  };
}
