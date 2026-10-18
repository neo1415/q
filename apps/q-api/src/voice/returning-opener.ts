import type { DatabaseExecutor } from "@capital-q/database";
import { arrivalGreeting, isTimeZone } from "@capital-q/q-core";
import type { ActorContext } from "@capital-q/security";

import { narrationOf } from "../composition/instructions/digest.js";

/**
 * What Q opens with for somebody coming back, when the web's arrival read
 * has not landed before the call opens. Read from the person's own rows,
 * composed without a model, so the greeting is neither slower nor
 * costlier. Since 2026-10-16 (owner) it says only that things are waiting
 * and offers to look at them; the facts are what decide whether they are.
 */
export type OpenerFacts = {
  readonly nextCall: {
    readonly purpose: string;
    readonly startsAt: Date;
  } | null;
  readonly remindersDue: number;
  readonly firstReminder: string | null;
  readonly notesReady: number;
  /**
   * Q's "How did it go?" from the notes notice (2026-10-02): the outcome Q
   * proposes from its notes, to be confirmed, and the follow-ups it offers.
   */
  readonly notesQuestion?: string | null | undefined;
  readonly unreadNotices: number;
  /** What the scout found about their company that they have not seen. */
  readonly scoutFinding?: string | null | undefined;
  /**
   * ADR 0043 S7: what Q did under their standing instruction and what
   * waits on them, composed by code from the recorded steps.
   */
  readonly instructionNews?: string | null | undefined;
  /**
   * Their own IANA time zone, when they set one (founder 2026-10-08:
   * "greet me according to the time"). Absent: a plain hello.
   */
  readonly timeZone?: string | null | undefined;
};

/**
 * The opener's question with nothing known to be waiting, and with no read
 * at all (unknown is not "nothing": it claims nothing either way).
 */
export const NOTHING_WAITING_QUESTION = "What would you like to look at?";

/**
 * Owner 2026-10-16: on sign-in Q greets, says that things are waiting in
 * one sentence, and asks whether to look at them now or talk about
 * something else -- never the list. The same opener the web composes from
 * the arrival's cards (apps/web briefing/opener.ts); this is the server's
 * fallback when a call opens before those are read. Its sources (the
 * person's notices, reminders, calls) are not the cards' sources, so it
 * never says a number it cannot stand behind: "a few things", never a
 * wrong count, and no item, name or detail.
 */
export function composeReturningOpener(
  name: string | null,
  facts: OpenerFacts,
  now: Date,
): string {
  // By their own clock when Q knows it ("Good afternoon, Zino."), else a
  // plain hello: Q never guesses a time of day from the server's zone.
  const hello = isTimeZone(facts.timeZone)
    ? arrivalGreeting({ firstName: name, now, timeZone: facts.timeZone })
    : name === null
      ? "Welcome back."
      : `Hi ${name}.`;
  const scout = facts.scoutFinding?.trim() ?? "";
  // What Q did for them under a standing instruction is news, not
  // something waiting; its NEEDS_YOU notices are counted as notices.
  const waiting =
    facts.nextCall !== null ||
    facts.remindersDue > 0 ||
    facts.notesReady > 0 ||
    facts.unreadNotices > 0 ||
    scout.length > 0;
  if (!waiting) return `${hello} ${NOTHING_WAITING_QUESTION}`;
  return `${hello} You have a few things waiting. Would you like to look at them now, or talk about something else?`;
}

/** The opener when the facts could not be read in time: the plain hello. */
export function plainOpener(name: string | null): string {
  return `${name === null ? "Hi." : `Hi ${name}.`} ${NOTHING_WAITING_QUESTION}`;
}

/** The person's own rows only: every predicate is their user id. */
export function createOpenerFacts(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly now?: (() => Date) | undefined;
}): (actor: ActorContext) => Promise<OpenerFacts> {
  const { sql } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  return async (actor) => {
    const current = now();
    const soon = new Date(current.getTime() + 36 * 3_600_000);
    const dayEnd = new Date(current.getTime() + 24 * 3_600_000);
    const [calls, reminders, notices, zone] = await Promise.all([
      sql<{ purpose: string; starts_at: Date }[]>`
        select m.purpose, m.starts_at
          from communication.meetings m
          join communication.meeting_participants p on p.meeting_id = m.id
         where p.user_id = ${actor.userId}
           and m.status = 'SCHEDULED'
           and m.starts_at > ${new Date(current.getTime() - 10 * 60_000)}
           and m.starts_at < ${soon}
         order by m.starts_at
         limit 1`,
      sql<{ title: string }[]>`
        select title from communication.reminders
         where owner_user_id = ${actor.userId}
           and status in ('PENDING', 'DELIVERED')
           and due_at < ${dayEnd}
         order by due_at
         limit 20`,
      sql<{ kind: string; n: number; body: string | null }[]>`
        select kind, count(*)::int as n, max(body) as body
          from communication.notifications
         where user_id = ${actor.userId} and read_at is null
         group by kind`,
      sql<{ timezone: string | null }[]>`
        select timezone from identity.user_profiles
         where id = ${actor.userId}`.catch(() => []),
    ]);
    const call = calls[0];
    // Their standing instruction's last day, from its own steps; what waits
    // on them, from its unread NEEDS_YOU notices. Absent tables (before the
    // migration) read as nothing.
    // What was done is read by kind (the step's action), so Q says what it
    // did in its own words -- never the goal's text (Zino live 2026-10-07).
    const instruction = await sql<
      {
        done: { action: string; n: number }[] | null;
        needs_you: number;
      }[]
    >`
      select (select coalesce(json_agg(json_build_object('action', d.action, 'n', d.n)), '[]'::json)
                from (select s.action, count(*)::int as n
                        from q_runtime.instruction_steps s
                       where s.instruction_id = i.id and s.status = 'DONE'
                         and s.created_at > ${new Date(current.getTime() - 24 * 3_600_000)}
                       group by s.action) d) as done,
             (select count(*)::int from communication.notifications n
               where n.user_id = ${actor.userId} and n.read_at is null
                 and n.priority = 'NEEDS_YOU'
                 and n.dedupe_key like 'instr:' || i.id::text || ':%') as needs_you
        from q_runtime.standing_instructions i
       where i.user_id = ${actor.userId} and i.tenant_id = ${actor.tenantId}
         and i.status in ('ACTIVE', 'PAUSED')
       order by i.updated_at desc
       limit 1`.catch(() => []);
    const latest = instruction[0];
    return {
      timeZone: zone[0]?.timezone ?? null,
      instructionNews:
        latest === undefined
          ? null
          : narrationOf({
              done: latest.done ?? [],
              needsYou: latest.needs_you,
            }),
      nextCall:
        call === undefined
          ? null
          : { purpose: call.purpose, startsAt: new Date(call.starts_at) },
      remindersDue: reminders.length,
      firstReminder: reminders[0]?.title ?? null,
      notesReady:
        notices.find((row) => row.kind === "MEETING_NOTES_READY")?.n ?? 0,
      notesQuestion:
        notices.find((row) => row.kind === "MEETING_NOTES_READY")?.body ?? null,
      unreadNotices: notices.reduce((sum, row) => sum + row.n, 0),
      scoutFinding: notices.find((row) => row.kind === "Q_SCOUT")?.body ?? null,
    };
  };
}
