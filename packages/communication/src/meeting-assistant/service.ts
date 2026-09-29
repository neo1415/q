import type {
  QMeetingAssistantDto,
  QMeetingAssistantStatus,
  QMeetingFlag,
  QMeetingFollowUp,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

/**
 * Q in a meeting (founder direction 2026-09-29).
 *
 * The organiser of a booked call asks Q to come. A meeting bot joins the
 * call under Q's name at its start; when the call ends, its captions are
 * turned into notes (a summary, flags, follow-ups) that only the
 * organiser sees, and they are told the notes are ready. Nothing joins a
 * call nobody asked Q to join: every bot is one organiser's own click,
 * idempotent by its key, and the transcript itself is never stored.
 *
 * The bot is a paid provider; the collector reads each bot's state only
 * from the call's start until it is settled, never before.
 */

type Logger = {
  readonly warn: (
    fields: Readonly<Record<string, unknown>>,
    message: string,
  ) => void;
};

export type MeetingBotState = "WAITING" | "IN_CALL" | "ENDED" | "FAILED";

export type MeetingTranscriptLine = {
  readonly speaker: string | null;
  readonly text: string;
};

export type MeetingBotProvider = {
  readonly create: (input: {
    readonly meetingUrl: string;
    readonly joinAt: Date | null;
    readonly botName: string;
  }) => Promise<{ readonly botId: string }>;
  readonly read: (botId: string) => Promise<{
    readonly state: MeetingBotState;
    /** Present once the call has ended and its captions are ready. */
    readonly transcript: readonly MeetingTranscriptLine[] | null;
  }>;
  readonly cancel: (botId: string) => Promise<void>;
};

export type MeetingNotes = {
  readonly summary: string;
  readonly flags: readonly QMeetingFlag[];
  readonly followUps: readonly QMeetingFollowUp[];
  readonly composerVersion: string;
};

export type MeetingNotesComposer = {
  readonly compose: (input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly purpose: string;
    readonly organiserName: string;
    readonly transcript: string;
  }) => Promise<MeetingNotes | null>;
};

type AssistantRow = {
  id: string;
  meeting_id: string;
  tenant_id: string;
  user_id: string;
  provider_bot_id: string | null;
  status: Exclude<QMeetingAssistantStatus, "NONE">;
  failure: string | null;
  summary: string | null;
  flags: unknown;
  follow_ups: unknown;
  updated_at: Date;
};

type MeetingRow = {
  id: string;
  organiser_tenant_id: string;
  purpose: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  meet_link: string | null;
};

export type MeetingAssistantOutcome =
  | { readonly outcome: "OK"; readonly assistant: QMeetingAssistantDto }
  | {
      readonly outcome: "REFUSED";
      readonly code: "NOT_FOUND" | "NO_LINK" | "OVER" | "UNAVAILABLE";
    };

export type MeetingAssistantService = {
  readonly read: (
    actor: ActorContext,
    meetingId: string,
  ) => Promise<QMeetingAssistantDto | null>;
  readonly bring: (
    actor: ActorContext,
    meetingId: string,
    idempotencyKey: string,
  ) => Promise<MeetingAssistantOutcome>;
  readonly dismiss: (
    actor: ActorContext,
    meetingId: string,
  ) => Promise<MeetingAssistantOutcome>;
  /** Collector tick: settle bots whose calls have started. */
  readonly collect: (limit?: number) => Promise<number>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A scheduled bot needs a little notice; closer than this it joins now. */
const SCHEDULE_NOTICE_MS = 10 * 60_000;
/** A bot not settled this long after the call's end is given up on. */
const GIVE_UP_AFTER_END_MS = 3 * 3_600_000;
const TRANSCRIPT_MAX_CHARS = 60_000;
export const Q_MEETING_BOT_NAME = "Q (Capital Q notes)";

const OPEN = ["REQUESTED", "SCHEDULED", "IN_CALL", "COMPOSING"] as const;

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toDto(
  row: AssistantRow | null,
  meetingId: string,
): QMeetingAssistantDto {
  if (row === null) {
    return {
      meetingId,
      status: "NONE",
      summary: null,
      flags: [],
      followUps: [],
      failure: null,
      updatedAt: null,
    };
  }
  return {
    meetingId: row.meeting_id,
    status: row.status,
    summary: row.summary,
    flags: asArray<QMeetingFlag>(row.flags).slice(0, 20),
    followUps: asArray<QMeetingFollowUp>(row.follow_ups).slice(0, 20),
    failure: row.failure,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** "Speaker: words" per line, bounded, oldest first. */
export function transcriptText(
  lines: readonly MeetingTranscriptLine[],
): string {
  const text = lines
    .filter((line) => line.text.trim().length > 0)
    .map((line) => `${line.speaker ?? "Someone"}: ${line.text.trim()}`)
    .join("\n");
  return text.length > TRANSCRIPT_MAX_CHARS
    ? text.slice(text.length - TRANSCRIPT_MAX_CHARS)
    : text;
}

export function createMeetingAssistantService(dependencies: {
  /** Privileged server connection; every call is authorised here first. */
  readonly sql: DatabaseExecutor;
  readonly bots: MeetingBotProvider | undefined;
  readonly composer: MeetingNotesComposer;
  /** The organiser's display name, for "you" in the notes. */
  readonly nameOf: (userId: string) => Promise<string | null>;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
}): MeetingAssistantService {
  const { sql, bots, composer, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  /** The meeting, only when this person organised it. */
  async function organised(
    actor: ActorContext,
    meetingId: string,
  ): Promise<MeetingRow | null> {
    if (!UUID.test(meetingId)) return null;
    const rows = await sql<MeetingRow[]>`
      select id, organiser_tenant_id, purpose, starts_at, ends_at, status, meet_link
        from communication.meetings
       where id = ${meetingId} and organiser_user_id = ${actor.userId}`;
    return rows[0] ?? null;
  }

  async function assistantOf(
    meetingId: string,
    userId: string,
  ): Promise<AssistantRow | null> {
    const rows = await sql<AssistantRow[]>`
      select id, meeting_id, tenant_id, user_id, provider_bot_id, status, failure,
             summary, flags, follow_ups, updated_at
        from communication.meeting_assistants
       where meeting_id = ${meetingId} and user_id = ${userId}`;
    return rows[0] ?? null;
  }

  async function update(
    id: string,
    patch: {
      readonly status: AssistantRow["status"];
      readonly botId?: string | undefined;
      readonly failure?: string | null | undefined;
      readonly notes?: MeetingNotes | undefined;
    },
  ): Promise<void> {
    await sql`
      update communication.meeting_assistants
         set status = ${patch.status},
             provider_bot_id = coalesce(${patch.botId ?? null}, provider_bot_id),
             failure = ${patch.failure ?? null},
             summary = coalesce(${patch.notes?.summary ?? null}, summary),
             flags = coalesce(${patch.notes === undefined ? null : JSON.stringify(patch.notes.flags)}::jsonb, flags),
             follow_ups = coalesce(${patch.notes === undefined ? null : JSON.stringify(patch.notes.followUps)}::jsonb, follow_ups),
             composer_version = coalesce(${patch.notes?.composerVersion ?? null}, composer_version),
             updated_at = clock_timestamp()
       where id = ${id}`;
  }

  async function settle(row: AssistantRow & MeetingRow): Promise<void> {
    if (bots === undefined || row.provider_bot_id === null) return;
    const current = now();
    const read = await bots.read(row.provider_bot_id);
    if (read.state === "FAILED") {
      await update(row.id, {
        status: "FAILED",
        failure: "Q couldn't get into the call.",
      });
      return;
    }
    if (read.state !== "ENDED" || read.transcript === null) {
      if (current.getTime() > row.ends_at.getTime() + GIVE_UP_AFTER_END_MS) {
        await update(row.id, {
          status: "FAILED",
          failure: "The call's captions never came back.",
        });
      } else if (read.state === "IN_CALL" && row.status !== "IN_CALL") {
        await update(row.id, { status: "IN_CALL" });
      }
      return;
    }
    const transcript = transcriptText(read.transcript);
    if (transcript.length === 0) {
      await update(row.id, {
        status: "FAILED",
        failure: "Nothing was said that Q could hear.",
      });
      return;
    }
    await update(row.id, { status: "COMPOSING" });
    const notes = await composer.compose({
      tenantId: row.tenant_id,
      userId: row.user_id,
      purpose: row.purpose,
      organiserName:
        (await dependencies.nameOf(row.user_id)) ?? "the organiser",
      transcript,
    });
    if (notes === null) {
      await update(row.id, {
        status: "FAILED",
        failure: "Q couldn't write the notes. Ask it about the call instead.",
      });
      return;
    }
    await update(row.id, { status: "DONE", notes });
    await sql`
      insert into communication.notifications
        (tenant_id, user_id, kind, title, body, link_path, reminder_id, meeting_id, dedupe_key)
      values (${row.tenant_id}, ${row.user_id}, 'MEETING_NOTES_READY',
              ${`Q's notes are ready: ${row.purpose}`.slice(0, 200)}, null, null, null,
              ${row.meeting_id}, ${`meeting-notes:${row.meeting_id}`})
      on conflict (user_id, dedupe_key) do nothing`;
  }

  return {
    read: async (actor, meetingId) => {
      const meeting = await organised(actor, meetingId);
      if (meeting === null) return null;
      return toDto(await assistantOf(meeting.id, actor.userId), meeting.id);
    },

    bring: async (actor, meetingId, idempotencyKey) => {
      const meeting = await organised(actor, meetingId);
      if (meeting === null) return { outcome: "REFUSED", code: "NOT_FOUND" };
      if (meeting.status !== "SCHEDULED" || meeting.meet_link === null) {
        return { outcome: "REFUSED", code: "NO_LINK" };
      }
      const current = now();
      if (meeting.ends_at.getTime() <= current.getTime()) {
        return { outcome: "REFUSED", code: "OVER" };
      }
      if (bots === undefined)
        return { outcome: "REFUSED", code: "UNAVAILABLE" };
      const existing = await assistantOf(meeting.id, actor.userId);
      if (
        existing !== null &&
        (OPEN as readonly string[]).includes(existing.status)
      ) {
        return { outcome: "OK", assistant: toDto(existing, meeting.id) };
      }
      // One row per meeting: asking again after a failure or a cancel
      // reuses it rather than adding a second.
      const rows = await sql<{ id: string }[]>`
        insert into communication.meeting_assistants
          (meeting_id, tenant_id, user_id, provider, status, idempotency_key)
        values (${meeting.id}, ${meeting.organiser_tenant_id}, ${actor.userId}, 'recall',
                'REQUESTED', ${idempotencyKey})
        on conflict (meeting_id) do update
          set status = 'REQUESTED', failure = null, provider_bot_id = null,
              idempotency_key = excluded.idempotency_key, updated_at = clock_timestamp()
        returning id`;
      const id = rows[0]?.id;
      if (id === undefined) return { outcome: "REFUSED", code: "UNAVAILABLE" };
      const startsIn = meeting.starts_at.getTime() - current.getTime();
      try {
        const created = await bots.create({
          meetingUrl: meeting.meet_link,
          joinAt: startsIn > SCHEDULE_NOTICE_MS ? meeting.starts_at : null,
          botName: Q_MEETING_BOT_NAME,
        });
        await update(id, { status: "SCHEDULED", botId: created.botId });
      } catch (error: unknown) {
        logger?.warn({ err: error, meetingId }, "meeting bot not created");
        await update(id, {
          status: "FAILED",
          failure: "Q couldn't be booked into this call just now.",
        });
      }
      return {
        outcome: "OK",
        assistant: toDto(
          await assistantOf(meeting.id, actor.userId),
          meeting.id,
        ),
      };
    },

    dismiss: async (actor, meetingId) => {
      const meeting = await organised(actor, meetingId);
      if (meeting === null) return { outcome: "REFUSED", code: "NOT_FOUND" };
      const existing = await assistantOf(meeting.id, actor.userId);
      if (
        existing !== null &&
        (existing.status === "REQUESTED" || existing.status === "SCHEDULED")
      ) {
        if (bots !== undefined && existing.provider_bot_id !== null) {
          await bots
            .cancel(existing.provider_bot_id)
            .catch((error: unknown) => {
              logger?.warn(
                { err: error, meetingId },
                "meeting bot not cancelled",
              );
            });
        }
        await update(existing.id, { status: "CANCELLED" });
      }
      return {
        outcome: "OK",
        assistant: toDto(
          await assistantOf(meeting.id, actor.userId),
          meeting.id,
        ),
      };
    },

    collect: async (limit = 20) => {
      if (bots === undefined) return 0;
      const current = now();
      // Only calls that have started: before that there is nothing to read.
      const rows = await sql<(AssistantRow & MeetingRow)[]>`
        select a.id, a.meeting_id, a.tenant_id, a.user_id, a.provider_bot_id, a.status,
               a.failure, a.summary, a.flags, a.follow_ups, a.updated_at,
               m.organiser_tenant_id, m.purpose, m.starts_at, m.ends_at,
               m.status as meeting_status, m.meet_link
          from communication.meeting_assistants a
          join communication.meetings m on m.id = a.meeting_id
         where a.status in ('SCHEDULED', 'IN_CALL', 'COMPOSING')
           and m.starts_at <= ${current}
         order by m.starts_at
         limit ${limit}`;
      let settled = 0;
      for (const row of rows) {
        try {
          await settle(row);
          settled += 1;
        } catch (error: unknown) {
          logger?.warn(
            { err: error, meetingId: row.meeting_id },
            "meeting assistant not settled this tick",
          );
        }
      }
      return settled;
    },
  };
}
