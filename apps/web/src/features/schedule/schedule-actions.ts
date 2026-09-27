"use server";

import { z } from "zod";

import {
  ApiProblemError,
  cancelMeeting,
  createReminder,
  dismissReminder,
  findMeetingSlots,
  markNotificationsRead,
  scheduleMeeting,
  type ApiSession,
} from "@capital-q/api-client";
import {
  MeetingDurationMinutesSchema,
  MeetingPurposeSchema,
  ReminderNoteSchema,
  ReminderTitleSchema,
  TimeZoneSchema,
  UtcTimestampSchema,
  type MeetingDto,
  type MeetingSlotsResponse,
  type ReminderDto,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * Meetings and reminders, server side (BIZ-008). Server actions so the
 * session token never reaches the browser. Ids are input, as they are to
 * the API, which decides whether this person is a party or the organiser.
 * Booking carries an idempotency key made once per press by the browser,
 * so a retry of the same press cannot invite twice.
 */

export type ScheduleActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();
const Key = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9:_-]+$/);

async function run<T>(
  work: (session: ApiSession) => Promise<T>,
): Promise<ScheduleActionResult<T>> {
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    return { ok: true, value: await work(session) };
  } catch (error: unknown) {
    if (error instanceof ApiProblemError && error.status < 500) {
      return {
        ok: false,
        message:
          error.status === 404
            ? "That isn't available."
            : (error.problem?.detail ?? "That didn't work. Please try again."),
      };
    }
    return {
      ok: false,
      message: "Couldn't reach Capital Q just now. Please try again.",
    };
  }
}

const invalid = { ok: false as const, message: "That isn't valid." };

export async function findSlotsAction(
  relationshipId: string,
  durationMinutes: number,
  timeZone: string | undefined,
): Promise<ScheduleActionResult<MeetingSlotsResponse>> {
  const id = Id.safeParse(relationshipId);
  const minutes = MeetingDurationMinutesSchema.safeParse(durationMinutes);
  const zone = TimeZoneSchema.optional().safeParse(timeZone);
  if (!id.success || !minutes.success || !zone.success) return invalid;
  return run((session) =>
    findMeetingSlots(session, id.data, {
      durationMinutes: minutes.data,
      ...(zone.data === undefined ? {} : { timeZone: zone.data }),
    }),
  );
}

export async function bookMeetingAction(input: {
  readonly relationshipId: string;
  readonly purpose: string;
  readonly startsAt: string;
  readonly durationMinutes: number;
  readonly timeZone?: string | undefined;
  readonly idempotencyKey: string;
}): Promise<ScheduleActionResult<MeetingDto>> {
  const parsed = z
    .object({
      relationshipId: Id,
      purpose: MeetingPurposeSchema,
      startsAt: UtcTimestampSchema,
      durationMinutes: MeetingDurationMinutesSchema,
      timeZone: TimeZoneSchema.optional(),
      idempotencyKey: Key,
    })
    .safeParse(input);
  if (!parsed.success) return invalid;
  const { relationshipId, idempotencyKey, ...request } = parsed.data;
  return run((session) =>
    scheduleMeeting(session, relationshipId, request, idempotencyKey),
  );
}

export async function cancelMeetingAction(
  meetingId: string,
): Promise<ScheduleActionResult<null>> {
  const id = Id.safeParse(meetingId);
  if (!id.success) return invalid;
  return run(async (session) => {
    await cancelMeeting(session, id.data);
    return null;
  });
}

export async function createReminderAction(input: {
  readonly title: string;
  readonly dueAt: string;
  readonly note?: string | undefined;
  readonly relationshipId?: string | undefined;
  readonly byEmail: boolean;
  readonly idempotencyKey: string;
}): Promise<ScheduleActionResult<ReminderDto>> {
  const parsed = z
    .object({
      title: ReminderTitleSchema,
      dueAt: UtcTimestampSchema,
      note: ReminderNoteSchema.optional(),
      relationshipId: Id.optional(),
      byEmail: z.boolean(),
      idempotencyKey: Key,
    })
    .safeParse(input);
  if (!parsed.success) return invalid;
  const { idempotencyKey, byEmail, ...request } = parsed.data;
  return run((session) =>
    createReminder(
      session,
      { ...request, channel: byEmail ? "EMAIL" : "IN_APP" },
      idempotencyKey,
    ),
  );
}

export async function dismissReminderAction(
  reminderId: string,
): Promise<ScheduleActionResult<null>> {
  const id = Id.safeParse(reminderId);
  if (!id.success) return invalid;
  return run(async (session) => {
    await dismissReminder(session, id.data);
    return null;
  });
}

export async function markNoticesReadAction(
  ids: readonly string[],
): Promise<ScheduleActionResult<null>> {
  const parsed = z.array(Id).min(1).max(50).safeParse(ids);
  if (!parsed.success) return invalid;
  return run(async (session) => {
    await markNotificationsRead(session, parsed.data);
    return null;
  });
}
