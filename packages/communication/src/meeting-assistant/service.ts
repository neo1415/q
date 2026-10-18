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
import type { MeetingRecap } from "./recap-email.js";

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
  /**
   * P5: our verified websocket for shared-screen frames; absent, the bot
   * streams no video at all.
   */
  readonly visionUrl?: string;
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
  /** Stops the line Q is playing (someone talked over it). */
  readonly stopSpeaking?: (botId: string) => Promise<void>;
  /** Leaves the call now (a participant asked Q to go). */
  readonly leave?: (botId: string) => Promise<void>;
  readonly read: (botId: string) => Promise<{
    readonly state: MeetingBotState;
    /** Present once the call has ended and its transcript is ready. */
    readonly transcript: readonly MeetingTranscriptLine[] | null;
    /** Ended with nothing to read, and why (absent while still processing). */
    readonly ended?: MeetingBotEnd;
    /**
     * A transcript came back but Q did not stay to the end (removed from
     * the call): the rest of the call is unrecorded, and said so.
     */
    readonly cutShort?: MeetingBotEnd;
  }>;
  readonly cancel: (botId: string) => Promise<void>;
};

/**
 * An agreed next step as Q read it from the call (MEETING_NOTES v3): what
 * kind of thing it is, whose, and dates only when they were said. Code
 * turns it into an approval card; nothing here acts.
 */
export type MeetingNextStepNote = {
  readonly kind:
    | "MESSAGE"
    | "REMINDER"
    | "NEXT_CALL"
    | "DOCUMENT_REQUEST"
    | "SHARE_DECK"
    | "OTHER";
  readonly what: string;
  readonly owner: string | null;
  readonly ownerSide: "FOUNDER" | "INVESTOR" | null;
  readonly dueDate: string | null;
  readonly callAt: string | null;
  readonly document: string | null;
};

export type MeetingNotes = {
  readonly summary: string;
  readonly flags: readonly QMeetingFlag[];
  readonly followUps: readonly QMeetingFollowUp[];
  readonly attendees: QMeetingAssistantDto["attendees"];
  readonly agreements: readonly string[];
  readonly commitments: readonly QMeetingCommitmentSignal[];
  /** Absent from composers before MEETING_NOTES v3. */
  readonly nextSteps?: readonly MeetingNextStepNote[] | undefined;
  readonly composerVersion: string;
};

export type MeetingNotesComposer = {
  readonly compose: (input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly purpose: string;
    readonly organiserName: string;
    readonly transcript: string;
    /** The call's date, YYYY-MM-DD (UTC), for days said in the call. */
    readonly callDate: string;
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
  /**
   * The provider said a bot changed (its status webhook): settle that one
   * call now rather than on the next tick. Unknown bots are ignored.
   */
  readonly settleBot: (botId: string) => Promise<boolean>;
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
/**
 * meet-47: creating the bot is retried with backoff, never final on the
 * first provider error: 1, 2, 4, 8, 15 minutes, then Q says it couldn't.
 */
export const BOT_CREATE_MAX_ATTEMPTS = 6;
export function botRetryDelayMs(attempts: number): number {
  return Math.min(15, 2 ** Math.max(0, attempts - 1)) * 60_000;
}
/** A claimed attempt is held this long; a crash mid-attempt retries after it. */
const ATTEMPT_LEASE_MS = 3 * 60_000;
/** A REQUESTED row from before retries existed, idle this long, is picked up. */
const STALE_REQUEST_MS = 2 * 60_000;
/**
 * Bots are read from a little before the start: a hosted bot joins three
 * minutes early, and a lobby is worth telling people about at once.
 */
const READ_AHEAD_MS = 5 * 60_000;
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
  /**
   * Founder brief J7: what a call's agreed lines led to, read by meaning
   * (MEETING_OUTCOME_READER). Absent or failing: no proposal; Q just asks.
   */
  readonly outcomeReader?:
    | ((
        who: { readonly tenantId: string; readonly userId: string },
        lines: readonly string[],
      ) => Promise<
        | "DILIGENCE"
        | "FOLLOW_UP_MEETING"
        | "MATERIALS_REQUESTED"
        | "INTRODUCTIONS"
        | "NONE"
        | null
      >)
    | undefined;
  /** The call happened: marked on the relationship's history. */
  readonly onHeld?:
    | ((meeting: {
        readonly relationshipId: string;
        readonly meetingId: string;
        readonly organiserUserId: string;
        /** Who was there and the money said, from Q's record. */
        readonly attendees: MeetingNotes["attendees"];
        readonly commitments: MeetingNotes["commitments"];
        /** For the follow-through cards (meet-47). */
        readonly purpose: string;
        readonly startsAt: Date;
        readonly agreements: MeetingNotes["agreements"];
        readonly nextSteps: readonly MeetingNextStepNote[];
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
  /** P5: the shared-screen websocket per meeting, when Q may look. */
  readonly screenHosting?:
    ((meetingId: string) => string | undefined) | undefined;
  /**
   * meet2-64: the recap email to each participant once the record exists
   * (only what both sides read; see recap-email.ts). Absent: no email.
   */
  readonly recap?: ((recap: MeetingRecap) => Promise<void>) | undefined;
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
    const visionUrl = dependencies.screenHosting?.(meetingId);
    return {
      meetingUrl,
      joinAt: plan.joinAt,
      botName: Q_MEETING_BOT_NAME,
      hosting: {
        realtimeUrl,
        aloneLeaveMs: plan.aloneLeaveMs,
        maxCallMs: plan.maxCallMs,
        metadata: { meeting_id: meetingId },
        ...(visionUrl === undefined ? {} : { visionUrl }),
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
    row: Pick<
      MeetingRow & AssistantRow,
      "meeting_id" | "organiser_tenant_id" | "starts_at" | "ends_at"
    >,
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
   * A notice to everyone on the call, once per kind (meet-47: whatever
   * happens to Q in a call, both sides hear it in the app; nothing about
   * Q's presence fails silently). Each lands on their own side's page.
   */
  async function tellBoth(
    row: Pick<MeetingRow, "relationship_id" | "purpose"> & {
      readonly meeting_id: string;
    },
    notice: {
      readonly key: string;
      readonly title: string;
      readonly body: string;
    },
  ): Promise<void> {
    await sql`
      insert into communication.notifications
        (tenant_id, user_id, kind, title, body, link_path, reminder_id, meeting_id, dedupe_key)
      select p.participant_tenant_id, p.user_id, 'Q_MESSAGE',
             ${`${notice.title}: ${row.purpose}`.slice(0, 200)},
             ${notice.body.slice(0, 1000)},
             case when exists (
                    select 1 from identity.organisation_memberships m
                     where m.user_id = p.user_id
                       and m.organisation_id = c.organisation_id
                       and m.membership_status = 'active')
                  then '/relationships/investor/' || r.investor_organisation_id::text
                  else '/relationships/company/' || r.company_id::text
             end,
             null, ${row.meeting_id}, ${`${notice.key}:${row.meeting_id}`}
        from communication.meeting_participants p
        join network.relationships r on r.id = ${row.relationship_id}
        join core.companies c on c.id = r.company_id
       where p.meeting_id = ${row.meeting_id}
       limit 20
      on conflict (user_id, dedupe_key) do nothing`.catch((error: unknown) => {
      logger?.warn(
        { err: error, meetingId: row.meeting_id, notice: notice.key },
        "the meeting notice was not written",
      );
    });
  }

  /**
   * Q is held in the call's lobby: everyone on the booking hears it once,
   * in the app, so someone admits it (Google Meet asks the organiser of the
   * Meet to let an unsigned-in guest in; nobody saw that live).
   */
  async function inLobby(row: AssistantRow & MeetingRow): Promise<void> {
    await tellBoth(row, {
      key: "meeting-lobby",
      title: "Q is waiting to be let in",
      body: `Q is in the call's lobby as "${Q_MEETING_BOT_NAME}". Admit it in the call so it can keep the record for both sides; until then it hears nothing.`,
    });
  }

  /**
   * Q has no record of the call (or of part of it): the assistant row says
   * why, the record both sides read says "Unrecorded" (ADR 0039), and both
   * sides hear it.
   */
  async function failed(
    row: Pick<
      MeetingRow & AssistantRow,
      | "meeting_id"
      | "relationship_id"
      | "purpose"
      | "organiser_tenant_id"
      | "starts_at"
      | "ends_at"
    > & { readonly id: string },
    failure: string,
    why: string,
  ): Promise<void> {
    await update(row.id, { status: "FAILED", failure });
    await unrecorded(row, why);
    await tellBoth(row, {
      key: "meeting-q-failed",
      title: "Q has no record of this call",
      body: `${failure} The meeting record says so for both sides.`,
    });
  }

  /**
   * One try at creating the bot for a call (meet-47). A provider error is
   * retried with backoff while the call can still be joined; only the last
   * try fails the record, and both sides are told either way.
   */
  async function book(
    assistantId: string,
    call: MeetingRow,
    attempts: number,
    current: Date,
  ): Promise<boolean> {
    if (bots === undefined || call.meet_link === null) return false;
    const startsIn = call.starts_at.getTime() - current.getTime();
    try {
      const created = await bots.create(
        botFor(call.id, call.meet_link, call, current, startsIn),
      );
      await sql`
        update communication.meeting_assistants
           set status = 'SCHEDULED', provider_bot_id = ${created.botId},
               failure = null, next_attempt_at = null,
               booked_starts_at = ${call.starts_at}, booked_meet_link = ${call.meet_link},
               updated_at = clock_timestamp()
         where id = ${assistantId}`;
      return true;
    } catch (error: unknown) {
      logger?.warn(
        { err: error, meetingId: call.id, attempts },
        "meeting bot not created",
      );
      const next = new Date(current.getTime() + botRetryDelayMs(attempts));
      const row = { ...call, id: assistantId, meeting_id: call.id };
      if (
        attempts >= BOT_CREATE_MAX_ATTEMPTS ||
        next.getTime() >= call.ends_at.getTime()
      ) {
        await failed(
          row,
          `Q couldn't be booked into this call (${String(attempts)} tries).`,
          "Q could not be booked into the call",
        );
        return false;
      }
      const hhmm = `${next.toISOString().slice(11, 16)} UTC`;
      await sql`
        update communication.meeting_assistants
           set status = 'REQUESTED', provider_bot_id = null,
               failure = ${`Q couldn't be booked into the call yet; trying again at ${hhmm}.`},
               next_attempt_at = ${next}, updated_at = clock_timestamp()
         where id = ${assistantId}`;
      await tellBoth(row, {
        key: "meeting-q-retrying",
        title: "Q is having trouble joining",
        body: "Q couldn't be booked into the call on its first try. It keeps trying, and the meeting record will say if it can't get in.",
      });
      return false;
    }
  }

  /**
   * The sweep before bots are booked (meet-47): a cancelled call stands Q
   * down; a call moved, or given a new link, after Q was booked gets a
   * fresh bot at its new time; a request whose call ended unbooked fails
   * visibly.
   */
  async function reconcile(current: Date, limit: number): Promise<void> {
    const cancelled = await sql<
      { id: string; provider_bot_id: string | null }[]
    >`
      select a.id, a.provider_bot_id
        from communication.meeting_assistants a
        join communication.meetings m on m.id = a.meeting_id
       where a.status in ('REQUESTED', 'SCHEDULED')
         and m.status = 'CANCELLED'
       limit ${limit}`;
    for (const row of cancelled) {
      if (bots !== undefined && row.provider_bot_id !== null) {
        await bots.cancel(row.provider_bot_id).catch((error: unknown) => {
          logger?.warn({ err: error }, "meeting bot not cancelled");
        });
      }
      await sql`
        update communication.meeting_assistants
           set status = 'CANCELLED', next_attempt_at = null, updated_at = clock_timestamp()
         where id = ${row.id} and status in ('REQUESTED', 'SCHEDULED')`;
    }
    const moved = await sql<
      { id: string; provider_bot_id: string | null; starts_at: Date }[]
    >`
      select a.id, a.provider_bot_id, m.starts_at
        from communication.meeting_assistants a
        join communication.meetings m on m.id = a.meeting_id
       where a.status = 'SCHEDULED'
         and m.status = 'SCHEDULED'
         and m.starts_at > ${current}
         and ((a.booked_starts_at is not null and a.booked_starts_at <> m.starts_at)
              or (a.booked_meet_link is not null and a.booked_meet_link is distinct from m.meet_link))
       limit ${limit}`;
    for (const row of moved) {
      if (bots !== undefined && row.provider_bot_id !== null) {
        await bots.cancel(row.provider_bot_id).catch((error: unknown) => {
          logger?.warn({ err: error }, "moved call's old bot not cancelled");
        });
      }
      const due = Math.max(
        current.getTime(),
        row.starts_at.getTime() - ENLIST_AHEAD_MS,
      );
      await sql`
        update communication.meeting_assistants
           set status = 'REQUESTED', provider_bot_id = null, failure = null,
               attempts = 0, next_attempt_at = ${new Date(due)},
               booked_starts_at = null, booked_meet_link = null,
               updated_at = clock_timestamp()
         where id = ${row.id} and status = 'SCHEDULED'`;
    }
    const unbooked = await sql<(MeetingRow & { assistant_id: string })[]>`
      select a.id as assistant_id, m.id, m.relationship_id, m.organiser_user_id,
             m.organiser_tenant_id, m.purpose, m.starts_at, m.ends_at, m.status, m.meet_link
        from communication.meeting_assistants a
        join communication.meetings m on m.id = a.meeting_id
       where a.status = 'REQUESTED'
         and m.status = 'SCHEDULED'
         and m.ends_at <= ${current}
       limit ${limit}`;
    for (const call of unbooked) {
      await failed(
        { ...call, id: call.assistant_id, meeting_id: call.id },
        call.meet_link === null
          ? "The call never had a link, so Q couldn't join it."
          : "Q never got into the call.",
        "Q was never booked into the call",
      );
    }
  }

  /**
   * What Q heard live in the call (meet2-64): the host runtime saves the
   * lines as they arrive, so a call that ends early, or whose provider
   * transcript fails or never comes back, still keeps what was heard.
   */
  function liveLines(row: AssistantRow): MeetingTranscriptLine[] {
    return asArray<{ speaker?: unknown; text?: unknown }>(row.transcript)
      .filter(
        (line): line is { speaker: unknown; text: string } =>
          typeof line.text === "string" && line.text.trim().length > 0,
      )
      .map((line) => ({
        speaker: typeof line.speaker === "string" ? line.speaker : null,
        text: line.text,
      }));
  }

  const heardSomeone = (lines: readonly MeetingTranscriptLine[]) =>
    lines.some((line) => line.speaker !== "Q" && line.text.trim().length > 0);

  /**
   * The call ended without a usable provider transcript. When Q heard
   * people live, that is the record (partial, and said so); only when it
   * heard nobody is the call marked unrecorded.
   */
  async function endedWithout(
    row: AssistantRow & MeetingRow,
    failure: string,
    why: string,
  ): Promise<void> {
    const live = liveLines(row);
    if (heardSomeone(live)) {
      await record(row, live, { failure, why });
      return;
    }
    await failed(row, failure, why);
  }

  async function settle(row: AssistantRow & MeetingRow): Promise<void> {
    if (bots === undefined || row.provider_bot_id === null) return;
    const current = now();
    const read = await bots.read(row.provider_bot_id);
    if (read.state === "FAILED") {
      await failed(
        row,
        "Q couldn't get into the call.",
        "Q was not admitted to the call",
      );
      return;
    }
    if (read.state === "ENDED" && read.ended !== undefined) {
      const end = MEETING_BOT_END[read.ended];
      await endedWithout(row, end.failure, end.unrecorded);
      return;
    }
    if (read.state === "LOBBY") await inLobby(row);
    if (read.state !== "ENDED" || read.transcript === null) {
      if (current.getTime() > row.ends_at.getTime() + GIVE_UP_AFTER_END_MS) {
        if (read.state === "ENDED") {
          await endedWithout(
            row,
            "Q's transcript of the call never came back.",
            "Q's transcript never came back",
          );
        } else {
          await failed(
            row,
            "Q never got into the call.",
            "Q never got into the call",
          );
        }
      } else if (read.state === "IN_CALL" && row.status !== "IN_CALL") {
        await update(row.id, { status: "IN_CALL" });
      }
      return;
    }
    // Only Q's own voice came back (live cfccb9a9: its greeting was the
    // whole transcript): no person was heard in the provider's transcript.
    if (!heardSomeone(read.transcript)) {
      await endedWithout(
        row,
        "Nothing was said that Q could hear.",
        "Q heard nothing in the call",
      );
      return;
    }
    await record(
      row,
      read.transcript,
      read.cutShort === undefined
        ? null
        : {
            failure: MEETING_BOT_END[read.cutShort].failure,
            why: MEETING_BOT_END[read.cutShort].unrecorded,
          },
    );
  }

  /**
   * The call's record from what was heard, then everything that follows
   * from it. Live 2026-10-04: the record was written but the first notice
   * failed a constraint, and everything after it (the other side's notice,
   * any email) was skipped, so both sides saw nothing. Each step after the
   * record now stands alone: one failing never stops the others.
   */
  async function record(
    row: AssistantRow & MeetingRow,
    transcriptLines: readonly MeetingTranscriptLine[],
    partial: { readonly failure: string; readonly why: string } | null,
  ): Promise<void> {
    const transcript = transcriptText(transcriptLines);
    await update(row.id, {
      status: "COMPOSING",
      transcript: transcriptLines,
    });
    const notes = await composer.compose({
      tenantId: row.tenant_id,
      userId: row.user_id,
      purpose: row.purpose,
      organiserName:
        (await dependencies.nameOf(row.user_id)) ?? "the organiser",
      transcript,
      callDate: row.starts_at.toISOString().slice(0, 10),
    });
    if (notes === null) {
      // The transcript is kept and both sides still read it; only Q's
      // notes are missing, so this is said, not marked unrecorded.
      await update(row.id, {
        status: "FAILED",
        failure: "Q couldn't write the notes. Ask it about the call instead.",
      });
      await tellBoth(row, {
        key: "meeting-q-failed",
        title: "Q couldn't write the notes",
        body: "Q kept the call's transcript, but couldn't write its notes. The transcript is on the meeting record; ask Q about the call instead.",
      });
      return;
    }
    await update(row.id, { status: "DONE", notes });
    const step = async (name: string, run: () => Promise<unknown>) => {
      await run().catch((error: unknown) => {
        logger?.warn(
          { err: error, meetingId: row.meeting_id, step: name },
          "a step after the meeting record failed",
        );
      });
    };
    // Part of the call is missing: what Q heard is the record, and the
    // rest is said to be unrecorded rather than left to look complete.
    if (partial !== null) {
      await step("partial", async () => {
        await unrecorded(row, `${partial.why} before it ended`);
        await tellBoth(row, {
          key: "meeting-q-cut-short",
          title: "Q's record of this call is partial",
          body: `${partial.failure} Q kept what it heard until then; the rest of the call is unrecorded.`,
        });
      });
    }
    await step("held", async () =>
      dependencies.onHeld?.({
        relationshipId: row.relationship_id,
        meetingId: row.meeting_id,
        organiserUserId: row.organiser_user_id,
        attendees: notes.attendees,
        commitments: notes.commitments,
        purpose: row.purpose,
        startsAt: row.starts_at,
        agreements: notes.agreements,
        nextSteps: notes.nextSteps ?? [],
      }),
    );
    // "How did it go?" (2026-10-02): Q proposes what the call led to from
    // its own notes, and offers its follow-ups and the proposals made to it
    // in the call; the person confirms on their relationship page or to Q.
    const inCallProposals = await sql<{ n: number }[]>`
      select count(*)::int as n from communication.meeting_host_notes
       where meeting_id = ${row.meeting_id} and kind = 'PROPOSAL'`
      .then((rows) => rows[0]?.n ?? 0)
      .catch(() => 0);
    const questions = await notesQuestions(
      {
        agreements: notes.agreements,
        followUps: notes.followUps,
        inCallProposals,
      },
      dependencies.outcomeReader === undefined
        ? undefined
        : (lines) =>
            dependencies.outcomeReader?.(
              { tenantId: row.tenant_id, userId: row.user_id },
              lines,
            ) ?? Promise.resolve(null),
    );
    const ask = questions.organiser;
    // A notice's link is a plain path: the notifications check allows no
    // fragment or query (an outcome fragment failed it live, 2026-10-04).
    await step(
      "organiser-notice",
      async () => sql`
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
                  then '/relationships/investor/' || r.investor_organisation_id::text
                  else '/relationships/company/' || r.company_id::text
             end,
             null, ${row.meeting_id}, ${`meeting-notes:${row.meeting_id}`}
        from network.relationships r
        join core.companies c on c.id = r.company_id
       where r.id = ${row.relationship_id}
      on conflict (user_id, dedupe_key) do nothing`,
    );
    // The other side's debrief (2026-10-02; was organiser-only, ADR 0027):
    // each other participant hears the record is ready, on their own side's
    // page. Context Firewall: their question is built only from what both
    // sides read (the agreements), never from the organiser's private Q
    // analysis (summary, flags, follow-ups) or the proposals made to Q.
    const theirs = questions.others;
    await step(
      "participant-notice",
      async () => sql`
      insert into communication.notifications
        (tenant_id, user_id, kind, title, body, link_path, reminder_id, meeting_id, dedupe_key)
      select p.participant_tenant_id, p.user_id, 'MEETING_NOTES_READY',
             ${`The call's record is ready: ${row.purpose}`.slice(0, 200)}, ${theirs.slice(0, 1000)},
             case when exists (
                    select 1 from identity.organisation_memberships m
                     where m.user_id = p.user_id
                       and m.organisation_id = c.organisation_id
                       and m.membership_status = 'active')
                  then '/relationships/investor/' || r.investor_organisation_id::text
                  else '/relationships/company/' || r.company_id::text
             end,
             null, ${row.meeting_id}, ${`meeting-notes:${row.meeting_id}`}
        from communication.meeting_participants p
        join network.relationships r on r.id = ${row.relationship_id}
        join core.companies c on c.id = r.company_id
       where p.meeting_id = ${row.meeting_id}
         and p.user_id <> ${row.user_id}
       limit 20
      on conflict (user_id, dedupe_key) do nothing`,
    );
    const send = dependencies.recap;
    if (send === undefined) return;
    await step("recap-email", async () => {
      // Claimed once per person on their own notice (emailed_at), so a
      // second settle never sends a second recap.
      const claimed = await sql<
        {
          user_id: string;
          email: string | null;
          display_name: string | null;
          link_path: string | null;
        }[]
      >`
        update communication.notifications n
           set emailed_at = clock_timestamp()
          from communication.meeting_participants p
         where n.meeting_id = ${row.meeting_id}
           and n.dedupe_key = ${`meeting-notes:${row.meeting_id}`}
           and n.emailed_at is null
           and p.meeting_id = n.meeting_id
           and p.user_id = n.user_id
        returning n.user_id, p.email, p.display_name, n.link_path`;
      for (const person of claimed) {
        if (person.email === null || person.email.length === 0) continue;
        await send({
          meetingId: row.meeting_id,
          userId: person.user_id,
          to: person.email,
          name: person.display_name,
          purpose: row.purpose,
          startsAt: row.starts_at,
          linkPath: person.link_path,
          attendees: notes.attendees.map((a) => a.name).slice(0, 20),
          agreements: notes.agreements,
          money: notes.commitments.map((c) => ({
            party: c.party,
            amount: c.amount,
            quote: c.quote,
          })),
          partial: partial !== null,
          transcript: transcriptLines.map((line) => ({
            speaker: line.speaker,
            text: line.text,
          })),
        }).catch((error: unknown) => {
          logger?.warn(
            { err: error, meetingId: row.meeting_id },
            "the recap email was not sent",
          );
        });
      }
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
          (meeting_id, tenant_id, user_id, provider, status, idempotency_key,
           attempts, next_attempt_at)
        values (${meeting.id}, ${meeting.organiser_tenant_id}, ${meeting.organiser_user_id}, 'recall',
                'REQUESTED', ${idempotencyKey}, 1, ${new Date(current.getTime() + ATTEMPT_LEASE_MS)})
        on conflict (meeting_id) do update
          set status = 'REQUESTED', failure = null, provider_bot_id = null,
              declined_by_user_id = null, declined_at = null,
              attempts = 1, next_attempt_at = excluded.next_attempt_at,
              booked_starts_at = null, booked_meet_link = null,
              idempotency_key = excluded.idempotency_key, updated_at = clock_timestamp()
        returning id`;
      const id = rows[0]?.id;
      if (id === undefined) return { outcome: "REFUSED", code: "UNAVAILABLE" };
      // A provider error is retried by the collector, and said on the record.
      await book(id, meeting, 1, current);
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
           and m.status <> 'CANCELLED'
           and m.starts_at <= ${new Date(current.getTime() + READ_AHEAD_MS)}
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
      await reconcile(current, limit);
      // Every booked (or joined) call about to start with a link and no
      // record yet: a call booked inside the window, or given its link
      // late, is picked up on the next tick like any other.
      await sql`
        insert into communication.meeting_assistants
          (meeting_id, tenant_id, user_id, provider, status, idempotency_key,
           attempts, next_attempt_at)
        select m.id, m.organiser_tenant_id, m.organiser_user_id, 'recall', 'REQUESTED',
               'enlist:' || m.id::text, 0, ${current}
          from communication.meetings m
         where m.status = 'SCHEDULED'
           and m.meet_link is not null
           and m.starts_at <= ${new Date(current.getTime() + ENLIST_AHEAD_MS)}
           and m.ends_at > ${current}
           and not exists (select 1 from communication.meeting_assistants a
                            where a.meeting_id = m.id)
         order by m.starts_at
         limit ${limit}
        on conflict (meeting_id) do nothing`;
      // Claim each due try atomically (a lease), so two ticks never book
      // two bots for one call.
      const due = await sql<
        (MeetingRow & { assistant_id: string; attempts: number })[]
      >`
        update communication.meeting_assistants a
           set attempts = a.attempts + 1,
               next_attempt_at = ${new Date(current.getTime() + ATTEMPT_LEASE_MS)},
               updated_at = clock_timestamp()
          from communication.meetings m
         where m.id = a.meeting_id
           and a.id in (
             select a2.id
               from communication.meeting_assistants a2
               join communication.meetings m2 on m2.id = a2.meeting_id
              where a2.status = 'REQUESTED'
                and a2.attempts < ${BOT_CREATE_MAX_ATTEMPTS}
                and (a2.next_attempt_at <= ${current}
                     or (a2.next_attempt_at is null
                         and a2.updated_at <= ${new Date(current.getTime() - STALE_REQUEST_MS)}))
                and m2.status = 'SCHEDULED'
                and m2.meet_link is not null
                and m2.starts_at <= ${new Date(current.getTime() + ENLIST_AHEAD_MS)}
                and m2.ends_at > ${current}
              order by m2.starts_at
              limit ${limit}
              for update of a2 skip locked)
        returning a.id as assistant_id, a.attempts, m.id, m.relationship_id,
                  m.organiser_user_id, m.organiser_tenant_id, m.purpose,
                  m.starts_at, m.ends_at, m.status, m.meet_link`;
      let enlisted = 0;
      for (const call of due) {
        if (await book(call.assistant_id, call, call.attempts, current)) {
          enlisted += 1;
        }
      }
      return enlisted;
    },

    settleBot: async (botId) => {
      if (bots === undefined || !/^[A-Za-z0-9-]{8,80}$/.test(botId)) {
        return false;
      }
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
         where a.provider_bot_id = ${botId}
           and a.status in ('SCHEDULED', 'IN_CALL')
         limit 1`;
      const row = rows[0];
      if (row === undefined) return false;
      await settle(row);
      return true;
    },
  };
}
