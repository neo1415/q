import { jsonbParam, type DatabaseExecutor } from "@capital-q/database";
import type { MeetingEvent } from "@capital-q/communication";

/**
 * The meeting event record's writer (founder ask P3). Append-only: the
 * table refuses updates and deletes, so a correction is a new row. The
 * host runtime is the only writer, and only for a call it hosts: the
 * tenant comes from the booking it loaded, never from anything said.
 */
export type MeetingEventStore = {
  readonly append: (tenantId: string, event: MeetingEvent) => Promise<void>;
  /** One past the highest stored sequence for the meeting (a restart resumes). */
  readonly nextSeq: (meetingId: string) => Promise<number>;
};

export function createPostgresMeetingEventStore(
  sql: DatabaseExecutor,
): MeetingEventStore {
  return {
    append: async (tenantId, event) => {
      await sql`
        insert into communication.meeting_events
          (id, meeting_id, tenant_id, seq, occurred_at, speaker_name, speaker_user_id,
           speaker_side, kind, stance, body, owner_name, owner_user_id, due_text,
           refers_to, source_refs)
        values (${event.id}, ${event.meetingId}, ${tenantId}, ${event.seq}, ${event.at},
                ${event.speakerName}, ${event.speakerUserId}, ${event.speakerSide},
                ${event.kind}, ${event.stance}, ${event.text}, ${event.ownerName},
                ${event.ownerUserId}, ${event.dueText}, ${event.refersTo},
                ${jsonbParam(sql, event.sourceRefs.slice(0, 20))}::jsonb)
        on conflict (meeting_id, seq) do nothing`;
    },
    nextSeq: async (meetingId) => {
      const rows = await sql<{ next: number }[]>`
        select coalesce(max(seq), 0) + 1 as next
          from communication.meeting_events
         where meeting_id = ${meetingId}`;
      return Number(rows[0]?.next ?? 1);
    },
  };
}
