import type {
  QMeetingAssistantDto,
  QMeetingAssistantStatus,
  QMeetingCommitmentSignal,
  QMeetingFlag,
  QMeetingFollowUp,
} from "@capital-q/contracts";
import {
  decodeJsonbString,
  jsonbParam,
  type DatabaseExecutor,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { notesQuestions } from "./outcome-proposal.js";

/**
 * Q in a meeting (founder direction 2026-09-29).
 *
 * ADR 0027: Q attends every call booked on Capital Q (consent is asked at
 * booking; any participant may remove it). A meeting bot joins under Q's
 * name at the call's start; when the call ends Q keeps the transcript and
 * writes the meeting record -- summary, attendees, agreements, money
 * mentioned as commitment signals, flags, follow-ups -- which both sides
 * of the call can read, and the relationship's history marks it held.
 *
 * The bot is a paid provider; the collector enlists a call only shortly
 * before it starts and reads each bot only from the call's start until it
 * is settled, never before.
 */

type Logger = {
  readonly warn: (
    fields: Readonly<Record<string, unknown>>,
    message: string,
  ) => void;
};

export type MeetingBotState =
  | "WAITING"
  /** Held in the call's lobby until someone admits Q. */
  | "LOBBY"
  | "IN_CALL"
  | "ENDED"
  | "FAILED";

/** Why a call ended with nothing recorded (the provider's own reason). */
export type MeetingBotEnd =
  | "NOT_ADMITTED"
  | "REMOVED"
  | "NOBODY_CAME"
  | "NOT_RECORDED"
  | "TRANSCRIPT_FAILED"
  | "NO_RECORDING";

/** What each end means, said plainly on the assistant row and the record. */
export const MEETING_BOT_END: Readonly<
  Record<
    MeetingBotEnd,
    { readonly failure: string; readonly unrecorded: string }
  >
> = {
  NOT_ADMITTED: {
    failure: "Nobody let Q in from the call's lobby, so it heard nothing.",
    unrecorded: "Q was not admitted from the lobby",
  },
  REMOVED: {
    failure: "Q was removed from the call.",
    unrecorded: "Q was removed from the call",
  },
  NOBODY_CAME: {
    failure: "Nobody joined the call while Q was there.",
    unrecorded: "Nobody joined while Q was there",
  },
  NOT_RECORDED: {
    failure: "The call didn't let Q record.",
    unrecorded: "The call did not permit recording",
  },
  TRANSCRIPT_FAILED: {
    failure: "Q was in the call but its transcript failed.",
    unrecorded: "Q's transcript of the call failed",
  },
  NO_RECORDING: {
    failure: "The call ended before Q could record anything.",
    unrecorded: "The call ended before Q recorded anything",
  },
};

export type MeetingTranscriptLine = {
  readonly speaker: string | null;
  readonly text: string;
};

/**
 * How Q takes part when it hosts the call (MEET-HOST, ADR 0037): where the
 * call's live events go, and the hard limits on how long the bot stays.
 */
export type MeetingBotHosting = {
  /** Our verified endpoint for the call's live events. */
  readonly realtimeUrl: string;
  /** Alone in the call (or held in the waiting room) this long: leave. */
  readonly aloneLeaveMs: number;
  /** The hard cap on minutes in the call, whatever happens. */
  readonly maxCallMs: number;
  readonly metadata: Readonly<Record<string, string>>;
};

export type MeetingBotProvider = {
  readonly create: (input: {
    readonly meetingUrl: string;
    readonly joinAt: Date | null;
    readonly botName: string;
    readonly hosting?: MeetingBotHosting;
  }) => Promise<{ readonly botId: string }>;
  /** Plays a short spoken line (mp3) into the call. */
  readonly say?: (botId: string, mp3Base64: string) => Promise<void>;
  /** Leaves the call now (a participant asked Q to go). */
  readonly leave?: (botId: string) => Promise<void>;
  readonly read: (botId: string) => Promise<{
    readonly state: MeetingBotState;
    /** Present once the call has ended and its transcript is ready. */
    readonly transcript: readonly MeetingTranscriptLine[] | null;
    /** Ended with nothing to read, and why (absent while still processing). */
    readonly ended?: MeetingBotEnd;
  }>;
  readonly cancel: (botId: string) => Promise<void>;
};

export type MeetingNotes = {
  readonly summary: string;
  readonly flags: readonly QMeetingFlag[];
  readonly followUps: readonly QMeetingFollowUp[];
  readonly attendees: QMeetingAssistantDto["attendees"];
  readonly agreements: readonly string[];
  readonly commitments: readonly QMeetingCommitmentSignal[];
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
  transcript: unknown;
  attendees: unknown;
  agreements: unknown;
  commitments: unknown;
  declined_by_user_id: string | null;
  declined_by_name: string | null;
  declined_at: Date | null;
  updated_at: Date;
};

type MeetingRow = {
  id: string;
  relationship_id: string;
  organiser_user_id: string;
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
      readonly code:
        "NOT_FOUND" | "NO_LINK" | "OVER" | "UNAVAILABLE" | "ORGANISER_ONLY";
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
  /** Collector tick: bring Q to every booked call about to start (ADR 0027). */
  readonly enlist: (limit?: number) => Promise<number>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A scheduled bot needs a little notice; closer than this it joins now. */
const SCHEDULE_NOTICE_MS = 10 * 60_000;
/** A bot not settled this long after the call's end is given up on. */
const GIVE_UP_AFTER_END_MS = 3 * 3_600_000;
const TRANSCRIPT_MAX_CHARS = 60_000;
export const Q_MEETING_BOT_NAME = "Q (Capital Q notes)";

const OPEN = ["REQUESTED", "SCHEDULED", "IN_CALL", "COMPOSING"] as const;
/** How far ahead of a call Q is enlisted: close enough not to waste a bot. */
const ENLIST_AHEAD_MS = 30 * 60_000;
/** The transcript kept, in lines; a long call is still bounded. */
const TRANSCRIPT_MAX_LINES = 2_000;

function asArray<T>(value: unknown): T[] {
  // Rows written before 2026-10-01 hold the array as a JSON string (a
  // pre-stringified parameter cast to jsonb is encoded twice by the driver).
  const decoded = decodeJsonbString(value);
  return Array.isArray(decoded) ? (decoded as T[]) : [];
}

/**
 * Both sides of the call read what was said -- transcript, attendees,
 * agreements, money mentioned -- but Q's own analysis (summary, flags,
 * follow-ups) was written for the person who owns the assistant row and
 * stays theirs: one side's private Q analysis never reaches the other
 * (spec 6.9.6).
 */
export function meetingAssistantView(
  row: AssistantRow | null,
  meetingId: string,
  viewerUserId: string,
): QMeetingAssistantDto {
  if (row === null) {
    return {
      meetingId,
      status: "NONE",
      summary: null,
      flags: [],
      followUps: [],
      attendees: [],
      agreements: [],
      commitments: [],
      transcript: [],
      failure: null,
      declined: null,
      updatedAt: null,
    };
  }
  const own = row.user_id === viewerUserId;
  return {
    meetingId: row.meeting_id,
    status: row.status,
    summary: own ? row.summary : null,
    flags: own ? asArray<QMeetingFlag>(row.flags).slice(0, 20) : [],
    followUps: own
      ? asArray<QMeetingFollowUp>(row.follow_ups).slice(0, 20)
      : [],
    attendees: asArray<QMeetingAssistantDto["attendees"][number]>(
      row.attendees,
    ).slice(0, 20),
    agreements: asArray<string>(row.agreements).slice(0, 12),
    commitments: asArray<QMeetingCommitmentSignal>(row.commitments).slice(
      0,
      10,
    ),
    transcript: asArray<QMeetingAssistantDto["transcript"][number]>(
      row.transcript,
    ).slice(0, TRANSCRIPT_MAX_LINES),
    failure: row.failure,
    declined:
      row.status === "DECLINED" && row.declined_at !== null
        ? {
            byYou: row.declined_by_user_id === viewerUserId,
            byName: row.declined_by_name,
            at: new Date(row.declined_at).toISOString(),
          }
        : null,
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

/** MEET-HOST: Q is in the room a few minutes before the start. */
export const HOST_JOIN_EARLY_MS = 3 * 60_000;
/** ...and waits this long after the start if nobody comes. */
export const HOST_WAIT_AFTER_START_MS = 10 * 60_000;
/** Never longer in one call than this, whatever happens (cost cap). */
export const HOST_MAX_CALL_MS = 150 * 60_000;

/**
 * When the bot joins, and the limits it carries: early when there is
 * notice to schedule it, now when there is not; alone too long, or past
 * the call's length plus a margin, it leaves.
 */
export function hostedJoin(
  meeting: { readonly starts_at: Date; readonly ends_at: Date },
  current: Date,
): {
  readonly joinAt: Date | null;
  readonly aloneLeaveMs: number;
  readonly maxCallMs: number;
} {
  const target = meeting.starts_at.getTime() - HOST_JOIN_EARLY_MS;
  const joinAt =
    target - current.getTime() > SCHEDULE_NOTICE_MS ? new Date(target) : null;
  const joinsAt = joinAt?.getTime() ?? current.getTime();
  const aloneLeaveMs =
    Math.max(0, meeting.starts_at.getTime() - joinsAt) +
    HOST_WAIT_AFTER_START_MS;
  const length = meeting.ends_at.getTime() - meeting.starts_at.getTime();
  const maxCallMs = Math.min(
    HOST_MAX_CALL_MS,
    Math.max(0, meeting.starts_at.getTime() - joinsAt) + length + 20 * 60_000,
  );
  return { joinAt, aloneLeaveMs, maxCallMs };
}

export function createMeetingAssistantService(dependencies: {
  /** Privileged server connection; every call is authorised here first. */
  readonly sql: DatabaseExecutor;
  readonly bots: MeetingBotProvider | undefined;
  readonly composer: MeetingNotesComposer;
  /** The organiser's display name, for the record. */
  readonly nameOf: (userId: string) => Promise<string | null>;
  /** The call happened: marked on the relationship's history. */
  readonly onHeld?:
    | ((meeting: {
        readonly relationshipId: string;
        readonly meetingId: string;
        readonly organiserUserId: string;
        /** Who was there and the money said, from Q's record. */
        readonly attendees: MeetingNotes["attendees"];
        readonly commitments: MeetingNotes["commitments"];
      }) => Promise<void>)
    | undefined;
  /** A participant declined recording: marked on the relationship's history. */
  readonly onDeclined?:
    | ((meeting: {
        readonly relationshipId: string;
        readonly meetingId: string;
        readonly declinedByUserId: string;
      }) => Promise<void>)
    | undefined;
  readonly now?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
  /**
   * MEET-HOST (ADR 0037): where a hosted bot sends the call's live events,
   * per meeting. Absent: the bot stays the passive note-taker of ADR 0027.
   */
  readonly hosting?: ((meetingId: string) => string | undefined) | undefined;
}): MeetingAssistantService {
  const { sql, bots, composer, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  /** The meeting, when this person is a participant (either side). */
  /** The bot to book: a hosted one when hosting is set up, else ADR 0027's. */
  function botFor(
    meetingId: string,
    meetingUrl: string,
    meeting: { readonly starts_at: Date; readonly ends_at: Date },
    current: Date,
    startsIn: number,
  ) {
    const realtimeUrl = dependencies.hosting?.(meetingId);
    if (realtimeUrl === undefined) {
      return {
        meetingUrl,
        joinAt: startsIn > SCHEDULE_NOTICE_MS ? meeting.starts_at : null,
        botName: Q_MEETING_BOT_NAME,
      };
    }
    const plan = hostedJoin(meeting, current);
    return {
      meetingUrl,
      joinAt: plan.joinAt,
      botName: Q_MEETING_BOT_NAME,
      hosting: {
        realtimeUrl,
        aloneLeaveMs: plan.aloneLeaveMs,
        maxCallMs: plan.maxCallMs,
        metadata: { meeting_id: meetingId },
      },
    };
  }

  async function attended(
    actor: ActorContext,
    meetingId: string,
  ): Promise<MeetingRow | null> {
    if (!UUID.test(meetingId)) return null;
    const rows = await sql<MeetingRow[]>`
      select m.id, m.relationship_id, m.organiser_user_id, m.organiser_tenant_id,
             m.purpose, m.starts_at, m.ends_at, m.status, m.meet_link
        from communication.meetings m
       where m.id = ${meetingId}
         and (m.organiser_user_id = ${actor.userId}
              or exists (select 1 from communication.meeting_participants p
                          where p.meeting_id = m.id and p.user_id = ${actor.userId}))`;
    return rows[0] ?? null;
  }

  /** The meeting's one record (a row per meeting, whoever brought Q). */
  async function assistantOf(meetingId: string): Promise<AssistantRow | null> {
    const rows = await sql<AssistantRow[]>`
      select a.id, a.meeting_id, a.tenant_id, a.user_id, a.provider_bot_id,
             a.status, a.failure, a.summary, a.flags, a.follow_ups, a.transcript,
             a.attendees, a.agreements, a.commitments, a.declined_by_user_id,
             p.display_name as declined_by_name, a.declined_at, a.updated_at
        from communication.meeting_assistants a
        left join identity.user_profiles p on p.id = a.declined_by_user_id
       where a.meeting_id = ${meetingId}`;
    return rows[0] ?? null;
  }

  async function update(
    id: string,
    patch: {
      readonly status: AssistantRow["status"];
      readonly botId?: string | undefined;
      readonly failure?: string | null | undefined;
      readonly notes?: MeetingNotes | undefined;
      readonly transcript?: readonly MeetingTranscriptLine[] | undefined;
    },
  ): Promise<void> {
    await sql`
      update communication.meeting_assistants
         set status = ${patch.status},
             provider_bot_id = coalesce(${patch.botId ?? null}, provider_bot_id),
             failure = ${patch.failure ?? null},
             summary = coalesce(${patch.notes?.summary ?? null}, summary),
             flags = coalesce(${patch.notes === undefined ? null : jsonbParam(sql, patch.notes.flags)}::jsonb, flags),
             follow_ups = coalesce(${patch.notes === undefined ? null : jsonbParam(sql, patch.notes.followUps)}::jsonb, follow_ups),
             composer_version = coalesce(${patch.notes?.composerVersion ?? null}, composer_version),
             attendees = coalesce(${patch.notes === undefined ? null : jsonbParam(sql, patch.notes.attendees)}::jsonb, attendees),
             agreements = coalesce(${patch.notes === undefined ? null : jsonbParam(sql, patch.notes.agreements)}::jsonb, agreements),
             commitments = coalesce(${patch.notes === undefined ? null : jsonbParam(sql, patch.notes.commitments)}::jsonb, commitments),
             transcript = coalesce(${
               patch.transcript === undefined
                 ? null
                 : jsonbParam(
                     sql,
                     patch.transcript
                       .slice(0, TRANSCRIPT_MAX_LINES)
                       .map((line) => ({
                         speaker: line.speaker?.slice(0, 120) ?? null,
                         text: line.text.slice(0, 8_000),
                       })),
                   )
             }::jsonb, transcript),
             updated_at = clock_timestamp()
       where id = ${id}`;
  }

  /**
   * A meeting with no record says so, plainly, on the record both sides
   * read (ADR 0039): nobody can later claim it happened unwitnessed.
   */
  async function unrecorded(
    row: AssistantRow & MeetingRow,
    why: string,
  ): Promise<void> {
    const hhmm = (at: Date) => `${at.toISOString().slice(11, 16)} UTC`;
    await sql`
      insert into communication.meeting_host_notes
        (meeting_id, tenant_id, kind, body)
      values (${row.meeting_id}, ${row.organiser_tenant_id}, 'UNRECORDED',
              ${`Unrecorded: ${hhmm(row.starts_at)}–${hhmm(row.ends_at)}. ${why}.`.slice(0, 500)})`.catch(
      (error: unknown) => {
        logger?.warn(
          { err: error, meetingId: row.meeting_id },
          "unrecorded note not written",
        );
      },
    );
  }

  /**
   * Q is held in the call's lobby: everyone on the booking hears it once,
   * in the app, so someone admits it (Google Meet asks the organiser of the
   * Meet to let an unsigned-in guest in; nobody saw that live).
   */
  async function inLobby(row: AssistantRow & MeetingRow): Promise<void> {
    await sql`
      insert into communication.notifications
        (tenant_id, user_id, kind, title, body, link_path, reminder_id, meeting_id, dedupe_key)
      select p.participant_tenant_id, p.user_id, 'Q_MESSAGE',
             ${`Q is waiting to be let in: ${row.purpose}`.slice(0, 200)},
             ${'Q is in the call\'s lobby as "Q (Capital Q notes)". Admit it in the call so it can keep the record for both sides; until then it hears nothing.'},
             case when exists (
                    select 1 from identity.organisation_memberships m
                     where m.user_id = p.user_id
                       and m.organisation_id = c.organisation_id
                       and m.membership_status = 'active')
                  then '/relationships/investor/' || r.investor_organisation_id::text
                  else '/relationships/company/' || r.company_id::text
             end,
             null, ${row.meeting_id}, ${`meeting-lobby:${row.meeting_id}`}
        from communication.meeting_participants p
        join network.relationships r on r.id = ${row.relationship_id}
        join core.companies c on c.id = r.company_id
       where p.meeting_id = ${row.meeting_id}
       limit 20
      on conflict (user_id, dedupe_key) do nothing`.catch((error: unknown) => {
      logger?.warn(
        { err: error, meetingId: row.meeting_id },
        "the lobby notice was not written",
      );
    });
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
      await unrecorded(row, "Q was not admitted to the call");
      return;
    }
    if (read.state === "ENDED" && read.ended !== undefined) {
      const end = MEETING_BOT_END[read.ended];
      await update(row.id, { status: "FAILED", failure: end.failure });
      await unrecorded(row, end.unrecorded);
      return;
    }
    if (read.state === "LOBBY") await inLobby(row);
    if (read.state !== "ENDED" || read.transcript === null) {
      if (current.getTime() > row.ends_at.getTime() + GIVE_UP_AFTER_END_MS) {
        await update(row.id, {
          status: "FAILED",
          failure:
            read.state === "ENDED"
              ? "Q's transcript of the call never came back."
              : "Q never got into the call.",
        });
      } else if (read.state === "IN_CALL" && row.status !== "IN_CALL") {
        await update(row.id, { status: "IN_CALL" });
      }
      return;
    }
    const transcript = transcriptText(read.transcript);
    // Only Q's own voice came back (live cfccb9a9: its greeting was the
    // whole transcript): no person was heard, so there is nothing to note.
    const heardPeople = read.transcript.some(
      (line) => line.speaker !== "Q" && line.text.trim().length > 0,
    );
    if (transcript.length === 0 || !heardPeople) {
      await update(row.id, {
        status: "FAILED",
        failure: "Nothing was said that Q could hear.",
      });
      await unrecorded(row, "Q heard nothing in the call");
      return;
    }
    await update(row.id, {
      status: "COMPOSING",
      transcript: read.transcript,
    });
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
    await dependencies
      .onHeld?.({
        relationshipId: row.relationship_id,
        meetingId: row.meeting_id,
        organiserUserId: row.organiser_user_id,
        attendees: notes.attendees,
        commitments: notes.commitments,
      })
      .catch((error: unknown) => {
        logger?.warn(
          { err: error, meetingId: row.meeting_id },
          "meeting held not recorded on the relationship",
        );
      });
    // "How did it go?" (2026-10-02): Q proposes what the call led to from
    // its own notes, and offers its follow-ups and the proposals made to it
    // in the call; the person confirms on their relationship page or to Q.
    const inCallProposals = await sql<{ n: number }[]>`
      select count(*)::int as n from communication.meeting_host_notes
       where meeting_id = ${row.meeting_id} and kind = 'PROPOSAL'`
      .then((rows) => rows[0]?.n ?? 0)
      .catch(() => 0);
    const questions = notesQuestions({
      agreements: notes.agreements,
      followUps: notes.followUps,
      inCallProposals,
    });
    const ask = questions.organiser;
    await sql`
      insert into communication.notifications
        (tenant_id, user_id, kind, title, body, link_path, reminder_id, meeting_id, dedupe_key)
      select ${row.tenant_id}, ${row.user_id}, 'MEETING_NOTES_READY',
             ${`Q's notes are ready: ${row.purpose}`.slice(0, 200)}, ${ask.slice(0, 1000)},
             -- Their own side's relationship page, where the outcome is confirmed.
             case when exists (
                    select 1 from identity.organisation_memberships m
                     where m.user_id = ${row.user_id}
                       and m.organisation_id = c.organisation_id
                       and m.membership_status = 'active')
                  then '/relationships/investor/' || r.investor_organisation_id::text || '#outcome'
                  else '/relationships/company/' || r.company_id::text || '#outcome'
             end,
             null, ${row.meeting_id}, ${`meeting-notes:${row.meeting_id}`}
        from network.relationships r
        join core.companies c on c.id = r.company_id
       where r.id = ${row.relationship_id}
      on conflict (user_id, dedupe_key) do nothing`;
    // The other side's debrief (2026-10-02; was organiser-only, ADR 0027):
    // each other participant hears the record is ready, on their own side's
    // page. Context Firewall: their question is built only from what both
    // sides read (the agreements), never from the organiser's private Q
    // analysis (summary, flags, follow-ups) or the proposals made to Q.
    const theirs = questions.others;
    await sql`
      insert into communication.notifications
        (tenant_id, user_id, kind, title, body, link_path, reminder_id, meeting_id, dedupe_key)
      select p.participant_tenant_id, p.user_id, 'MEETING_NOTES_READY',
             ${`The call's record is ready: ${row.purpose}`.slice(0, 200)}, ${theirs.slice(0, 1000)},
             case when exists (
                    select 1 from identity.organisation_memberships m
                     where m.user_id = p.user_id
                       and m.organisation_id = c.organisation_id
                       and m.membership_status = 'active')
                  then '/relationships/investor/' || r.investor_organisation_id::text || '#outcome'
                  else '/relationships/company/' || r.company_id::text || '#outcome'
             end,
             null, ${row.meeting_id}, ${`meeting-notes:${row.meeting_id}`}
        from communication.meeting_participants p
        join network.relationships r on r.id = ${row.relationship_id}
        join core.companies c on c.id = r.company_id
       where p.meeting_id = ${row.meeting_id}
         and p.user_id <> ${row.user_id}
       limit 20
      on conflict (user_id, dedupe_key) do nothing`.catch((error: unknown) => {
      logger?.warn(
        { err: error, meetingId: row.meeting_id },
        "the other side's notes notice was not written",
      );
    });
  }

  return {
    read: async (actor, meetingId) => {
      const meeting = await attended(actor, meetingId);
      if (meeting === null) return null;
      return meetingAssistantView(
        await assistantOf(meeting.id),
        meeting.id,
        actor.userId,
      );
    },

    bring: async (actor, meetingId, idempotencyKey) => {
      // Any participant may bring Q; only the person who declined
      // recording can take the decline back.
      const meeting = await attended(actor, meetingId);
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
      const existing = await assistantOf(meeting.id);
      if (
        existing !== null &&
        ((OPEN as readonly string[]).includes(existing.status) ||
          (existing.status === "DECLINED" &&
            existing.declined_by_user_id !== actor.userId))
      ) {
        return {
          outcome: "OK",
          assistant: meetingAssistantView(existing, meeting.id, actor.userId),
        };
      }
      // One row per meeting: asking again after a failure or a cancel
      // reuses it rather than adding a second.
      const rows = await sql<{ id: string }[]>`
        insert into communication.meeting_assistants
          (meeting_id, tenant_id, user_id, provider, status, idempotency_key)
        values (${meeting.id}, ${meeting.organiser_tenant_id}, ${meeting.organiser_user_id}, 'recall',
                'REQUESTED', ${idempotencyKey})
        on conflict (meeting_id) do update
          set status = 'REQUESTED', failure = null, provider_bot_id = null,
              declined_by_user_id = null, declined_at = null,
              idempotency_key = excluded.idempotency_key, updated_at = clock_timestamp()
        returning id`;
      const id = rows[0]?.id;
      if (id === undefined) return { outcome: "REFUSED", code: "UNAVAILABLE" };
      const startsIn = meeting.starts_at.getTime() - current.getTime();
      try {
        const created = await bots.create(
          botFor(meeting.id, meeting.meet_link, meeting, current, startsIn),
        );
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
        assistant: meetingAssistantView(
          await assistantOf(meeting.id),
          meeting.id,
          actor.userId,
        ),
      };
    },

    // Any participant may decline recording -- their legal right -- but
    // the decline is itself recorded (founder direction 2026-09-30): who,
    // when, told to everyone on the call, and kept on the relationship's
    // history. The meeting still counts as held through Capital Q.
    dismiss: async (actor, meetingId) => {
      const meeting = await attended(actor, meetingId);
      if (meeting === null) return { outcome: "REFUSED", code: "NOT_FOUND" };
      // ADR 0039: Q is the record for both sides; only the organiser ends
      // it, here in Capital Q (never by a word in the call).
      if (meeting.organiser_user_id !== actor.userId) {
        return { outcome: "REFUSED", code: "ORGANISER_ONLY" };
      }
      const existing = await assistantOf(meeting.id);
      const settled =
        existing !== null &&
        (existing.status === "COMPOSING" ||
          existing.status === "DONE" ||
          existing.status === "DECLINED");
      if (!settled) {
        if (
          bots !== undefined &&
          existing !== null &&
          existing.provider_bot_id !== null
        ) {
          await bots
            .cancel(existing.provider_bot_id)
            .catch((error: unknown) => {
              logger?.warn(
                { err: error, meetingId },
                "meeting bot not cancelled",
              );
            });
        }
        await sql`
          insert into communication.meeting_assistants
            (meeting_id, tenant_id, user_id, provider, status, idempotency_key,
             declined_by_user_id, declined_at)
          values (${meeting.id}, ${meeting.organiser_tenant_id}, ${meeting.organiser_user_id},
                  'recall', 'DECLINED', ${`declined:${meeting.id}`},
                  ${actor.userId}, clock_timestamp())
          on conflict (meeting_id) do update
            set status = 'DECLINED', declined_by_user_id = ${actor.userId},
                declined_at = clock_timestamp(), updated_at = clock_timestamp()`;
        const others = await sql<{ user_id: string; tenant_id: string }[]>`
          select p.user_id, p.participant_tenant_id as tenant_id
            from communication.meeting_participants p
           where p.meeting_id = ${meeting.id} and p.user_id <> ${actor.userId}
          union
          select ${meeting.organiser_user_id}::uuid, ${meeting.organiser_tenant_id}::uuid
           where ${meeting.organiser_user_id}::uuid <> ${actor.userId}::uuid`;
        const who = (await dependencies.nameOf(actor.userId)) ?? "Someone";
        // On the record for both sides, plainly: who removed Q, when, and
        // which part of the meeting is unrecorded (ADR 0039).
        const removedAt = now();
        const from =
          removedAt.getTime() < meeting.starts_at.getTime()
            ? meeting.starts_at
            : removedAt;
        const hhmm = (at: Date) => `${at.toISOString().slice(11, 16)} UTC`;
        await sql`
          insert into communication.meeting_host_notes
            (meeting_id, tenant_id, kind, body, requested_by_name, requested_by_user_id)
          values
            (${meeting.id}, ${meeting.organiser_tenant_id}, 'REMOVED',
             ${`Q was removed by ${who} at ${hhmm(removedAt)}.`.slice(0, 500)},
             ${who.slice(0, 200)}, ${actor.userId}),
            (${meeting.id}, ${meeting.organiser_tenant_id}, 'UNRECORDED',
             ${`Unrecorded portion: ${hhmm(from)}–${hhmm(meeting.ends_at)}, removed by ${who}.`.slice(0, 500)},
             ${who.slice(0, 200)}, ${actor.userId})`;
        for (const other of others) {
          await sql`
            insert into communication.notifications
              (tenant_id, user_id, kind, title, body, link_path, reminder_id, meeting_id, dedupe_key)
            values (${other.tenant_id}, ${other.user_id}, 'MEETING_RECORDING_DECLINED',
                    ${`${who} declined recording: ${meeting.purpose}`.slice(0, 200)},
                    'Q will not keep a record of this call.', null, null, ${meeting.id},
                    ${`declined:${meeting.id}`})
            on conflict (user_id, dedupe_key) do nothing`;
        }
        await dependencies
          .onDeclined?.({
            relationshipId: meeting.relationship_id,
            meetingId: meeting.id,
            declinedByUserId: actor.userId,
          })
          .catch((error: unknown) => {
            logger?.warn(
              { err: error, meetingId },
              "declined recording not recorded on the relationship",
            );
          });
      }
      return {
        outcome: "OK",
        assistant: meetingAssistantView(
          await assistantOf(meeting.id),
          meeting.id,
          actor.userId,
        ),
      };
    },

    collect: async (limit = 20) => {
      if (bots === undefined) return 0;
      const current = now();
      // Only calls that have started: before that there is nothing to read.
      const rows = await sql<(AssistantRow & MeetingRow)[]>`
        select a.id, a.meeting_id, a.tenant_id, a.user_id, a.provider_bot_id, a.status,
               a.failure, a.summary, a.flags, a.follow_ups, a.transcript, a.attendees,
               a.agreements, a.commitments, a.declined_by_user_id,
               null::text as declined_by_name, a.declined_at, a.updated_at,
               m.relationship_id, m.organiser_user_id,
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

    enlist: async (limit = 10) => {
      if (bots === undefined) return 0;
      const current = now();
      const calls = await sql<MeetingRow[]>`
        select m.id, m.relationship_id, m.organiser_user_id, m.organiser_tenant_id,
               m.purpose, m.starts_at, m.ends_at, m.status, m.meet_link
          from communication.meetings m
         where m.status = 'SCHEDULED'
           and m.meet_link is not null
           and m.starts_at <= ${new Date(current.getTime() + ENLIST_AHEAD_MS)}
           and m.ends_at > ${current}
           and not exists (select 1 from communication.meeting_assistants a
                            where a.meeting_id = m.id)
         order by m.starts_at
         limit ${limit}`;
      let enlisted = 0;
      for (const call of calls) {
        const rows = await sql<{ id: string }[]>`
          insert into communication.meeting_assistants
            (meeting_id, tenant_id, user_id, provider, status, idempotency_key)
          values (${call.id}, ${call.organiser_tenant_id}, ${call.organiser_user_id},
                  'recall', 'REQUESTED', ${`enlist:${call.id}`})
          on conflict (meeting_id) do nothing
          returning id`;
        const id = rows[0]?.id;
        if (id === undefined || call.meet_link === null) continue;
        const startsIn = call.starts_at.getTime() - current.getTime();
        try {
          const created = await bots.create(
            botFor(call.id, call.meet_link, call, current, startsIn),
          );
          await update(id, { status: "SCHEDULED", botId: created.botId });
          enlisted += 1;
        } catch (error: unknown) {
          logger?.warn(
            { err: error, meetingId: call.id },
            "meeting bot not created",
          );
          await update(id, {
            status: "FAILED",
            failure: "Q couldn't be booked into this call.",
          });
        }
      }
      return enlisted;
    },
  };
}
