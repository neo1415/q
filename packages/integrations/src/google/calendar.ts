import { z } from "zod";

import type { MailboxAccess } from "../email-provider.js";
import {
  errorForStatus,
  GoogleProviderError,
  readJson,
  send,
  type GoogleHttp,
  type GoogleHttpRequest,
} from "./http.js";

/**
 * The Google Calendar adapter for the CalendarProvider port (BIZ-008),
 * over the REST API with the setup contract's one calendar scope,
 * `calendar.events`. No SDK.
 *
 *   busy        the organiser's own busy times (free/busy on `primary`)
 *   timeZone    the organiser's calendar time zone
 *   insert      `events.insert` with a client-chosen event id,
 *               `conferenceDataVersion=1` + a `hangoutsMeet` create
 *               request, and `sendUpdates=all`: a retry is the SAME event
 *               (409 → read it back), never a second invite
 *   move        `events.patch` of the times, `sendUpdates=all`
 *   cancel      `events.delete`, `sendUpdates=all`; already gone is done
 *
 * Only called by an approved action's executor (or the person's own
 * confirmed request); the attendee list is decided by the caller from the
 * relationship's parties.
 */

export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type CalendarAttendee = {
  readonly email: string;
  readonly displayName: string;
};

export type CalendarEventInput = {
  /** base32hex, 5-1024 chars; the idempotency of the insert. */
  readonly eventId: string;
  readonly summary: string;
  readonly description: string;
  readonly start: Date;
  readonly end: Date;
  readonly timeZone: string;
  readonly attendees: readonly CalendarAttendee[];
};

export type CalendarProvider = {
  readonly busy: (
    access: MailboxAccess,
    window: { readonly from: Date; readonly to: Date },
  ) => Promise<readonly { readonly start: Date; readonly end: Date }[]>;
  readonly timeZone: (access: MailboxAccess) => Promise<string>;
  readonly insert: (
    access: MailboxAccess,
    event: CalendarEventInput,
  ) => Promise<{ readonly meetLink: string | null }>;
  readonly move: (
    access: MailboxAccess,
    eventId: string,
    times: {
      readonly start: Date;
      readonly end: Date;
      readonly timeZone: string;
    },
  ) => Promise<void>;
  readonly cancel: (access: MailboxAccess, eventId: string) => Promise<void>;
};

const FreeBusySchema = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      busy: z
        .array(z.object({ start: z.string(), end: z.string() }))
        .optional(),
      errors: z.array(z.unknown()).optional(),
    }),
  ),
});
const CalendarSchema = z.object({ timeZone: z.string().optional() });
const EventSchema = z.object({
  id: z.string(),
  hangoutLink: z.string().optional(),
  conferenceData: z
    .object({
      entryPoints: z
        .array(
          z.object({ entryPointType: z.string(), uri: z.string().optional() }),
        )
        .optional(),
    })
    .optional(),
});

const MEET = /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,64}$/;

function meetLinkOf(event: z.infer<typeof EventSchema>): string | null {
  const candidates = [
    event.hangoutLink,
    ...(event.conferenceData?.entryPoints ?? [])
      .filter((entry) => entry.entryPointType === "video")
      .map((entry) => entry.uri),
  ];
  return candidates.find((uri) => uri !== undefined && MEET.test(uri)) ?? null;
}

function headers(access: MailboxAccess, json = false): Record<string, string> {
  return {
    authorization: `Bearer ${access.accessToken.reveal()}`,
    accept: "application/json",
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

async function call<T>(
  http: GoogleHttp,
  url: string,
  request: GoogleHttpRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await send(http, url, request);
  if (response.status < 200 || response.status > 299) {
    throw errorForStatus(response.status);
  }
  const parsed = schema.safeParse(await readJson(response));
  if (!parsed.success) {
    throw new GoogleProviderError("MALFORMED_RESPONSE", response.status);
  }
  return parsed.data;
}

const eventUrl = (eventId: string) =>
  `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`;

export function createGoogleCalendarProvider(
  http: GoogleHttp,
): CalendarProvider {
  return {
    busy: async (access, window) => {
      const result = await call(
        http,
        `${CALENDAR_API}/freeBusy`,
        {
          method: "POST",
          headers: headers(access, true),
          body: JSON.stringify({
            timeMin: window.from.toISOString(),
            timeMax: window.to.toISOString(),
            items: [{ id: "primary" }],
          }),
        },
        FreeBusySchema,
      );
      const primary = result.calendars.primary;
      if (primary === undefined || (primary.errors?.length ?? 0) > 0) {
        // Never guess free time from a calendar Google could not read.
        throw new GoogleProviderError("MALFORMED_RESPONSE", 200);
      }
      return (primary.busy ?? []).map((slot) => ({
        start: new Date(slot.start),
        end: new Date(slot.end),
      }));
    },

    timeZone: async (access) => {
      const calendar = await call(
        http,
        `${CALENDAR_API}/calendars/primary`,
        { method: "GET", headers: headers(access) },
        CalendarSchema,
      );
      return calendar.timeZone ?? "UTC";
    },

    insert: async (access, event) => {
      const body = JSON.stringify({
        id: event.eventId,
        summary: event.summary,
        description: event.description,
        start: {
          dateTime: event.start.toISOString(),
          timeZone: event.timeZone,
        },
        end: { dateTime: event.end.toISOString(), timeZone: event.timeZone },
        attendees: event.attendees.map((attendee) => ({
          email: attendee.email,
          displayName: attendee.displayName,
        })),
        conferenceData: {
          createRequest: {
            requestId: event.eventId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        reminders: { useDefault: true },
      });
      const response = await send(
        http,
        `${CALENDAR_API}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`,
        { method: "POST", headers: headers(access, true), body },
      );
      // 409: the id already exists (a previous attempt created it); the
      // link is read back below.
      let created: z.infer<typeof EventSchema> | null = null;
      if (response.status !== 409) {
        if (response.status < 200 || response.status > 299) {
          throw errorForStatus(response.status);
        }
        const parsed = EventSchema.safeParse(await readJson(response));
        if (!parsed.success) {
          throw new GoogleProviderError("MALFORMED_RESPONSE", response.status);
        }
        created = parsed.data;
      }
      const link = created === null ? null : meetLinkOf(created);
      if (link !== null) return { meetLink: link };
      // The Meet link can arrive a moment after the insert: read once more.
      const again = await call(
        http,
        `${eventUrl(event.eventId)}?conferenceDataVersion=1`,
        { method: "GET", headers: headers(access) },
        EventSchema,
      );
      return { meetLink: meetLinkOf(again) };
    },

    move: async (access, eventId, times) => {
      await call(
        http,
        `${eventUrl(eventId)}?sendUpdates=all`,
        {
          method: "PATCH",
          headers: headers(access, true),
          body: JSON.stringify({
            start: {
              dateTime: times.start.toISOString(),
              timeZone: times.timeZone,
            },
            end: {
              dateTime: times.end.toISOString(),
              timeZone: times.timeZone,
            },
          }),
        },
        EventSchema,
      );
    },

    cancel: async (access, eventId) => {
      const response = await send(
        http,
        `${eventUrl(eventId)}?sendUpdates=all`,
        {
          method: "DELETE",
          headers: headers(access),
        },
      );
      // 404/410: already deleted (a retry, or by hand in Google Calendar).
      if (response.status === 404 || response.status === 410) return;
      if (response.status < 200 || response.status > 299) {
        throw errorForStatus(response.status);
      }
    },
  };
}
