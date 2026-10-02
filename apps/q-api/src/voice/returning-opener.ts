import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

/**
 * What Q opens with for somebody coming back (founder direction
 * 2026-09-29: "a very proactive Q"). Not "I'm listening": the one or two
 * things that are theirs to deal with now -- a call coming up, a reminder
 * due, notes from a call, notices waiting -- and an offer to help with the
 * first. Read from the person's own rows, composed without a model, so the
 * greeting is neither slower nor costlier than it was.
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
};

const TRIM = 70;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > TRIM ? `${flat.slice(0, TRIM - 1)}…` : flat;
}

function whenFrom(startsAt: Date, now: Date): string {
  const minutes = Math.round((startsAt.getTime() - now.getTime()) / 60_000);
  if (minutes <= 5) return "starting now";
  if (minutes < 60) return `in ${String(minutes)} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 20)
    return `in about ${String(hours)} hour${hours === 1 ? "" : "s"}`;
  return "tomorrow";
}

export function composeReturningOpener(
  name: string | null,
  facts: OpenerFacts,
  now: Date,
): string {
  const hello = name === null ? "Welcome back." : `Hi ${name}.`;
  if (facts.nextCall !== null) {
    const call = `You have "${clip(facts.nextCall.purpose)}" ${whenFrom(facts.nextCall.startsAt, now)}.`;
    const also =
      facts.remindersDue > 0
        ? ` And ${String(facts.remindersDue)} reminder${facts.remindersDue === 1 ? "" : "s"} due today.`
        : "";
    return `${hello} ${call}${also} Want me to prep you for it?`;
  }
  if (facts.notesReady > 0) {
    return facts.notesQuestion === undefined || facts.notesQuestion === null
      ? `${hello} My notes from your last call are ready. Want the short version?`
      : `${hello} My notes from your last call are ready. ${facts.notesQuestion}`;
  }
  if (facts.scoutFinding !== undefined && facts.scoutFinding !== null) {
    return `${hello} I spotted something new about your company: "${clip(facts.scoutFinding)}". Want the gist?`;
  }
  if (facts.remindersDue > 0 && facts.firstReminder !== null) {
    return `${hello} You asked me to remind you: "${clip(facts.firstReminder)}". Want to deal with it now?`;
  }
  if (facts.unreadNotices > 0) {
    return `${hello} ${String(facts.unreadNotices)} thing${facts.unreadNotices === 1 ? "" : "s"} came in since you were last here. Want me to go through them?`;
  }
  return `${hello} Want me to see what's new for you, or is there something on your mind?`;
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
    const [calls, reminders, notices] = await Promise.all([
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
    ]);
    const call = calls[0];
    return {
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
