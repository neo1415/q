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
 *   busy        the organiser's own busy times, from `events.list` on
 *               `primary` (freeBusy needs a scope Capital Q does not ask for)
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
  /**
   * AUTO (2026-10-02): the event's Meet link, read again; with `ask`, a new
   * conference request first. MISSING: no such event (not a Google one).
   */
  readonly conference: (
    access: MailboxAccess,
    eventId: string,
    options: { readonly ask: boolean },
  ) => Promise<
    | { readonly status: "READY"; readonly meetLink: string }
    | { readonly status: "PENDING" | "MISSING" }
  >;
  /** Send everyone the updated invite, now carrying the Meet link. */
  readonly announceLink: (
    access: MailboxAccess,
    eventId: string,
    meetLink: string,
  ) => Promise<void>;
};

const EventListSchema = z.object({
  timeZone: z.string().optional(),
  nextPageToken: z.string().nullish(),
  items: z
    .array(
      z.object({
        status: z.string().optional(),
        transparency: z.string().optional(),
        start: z
          .object({
            dateTime: z.string().optional(),
            date: z.string().optional(),
          })
          .optional(),
        end: z
          .object({
            dateTime: z.string().optional(),
            date: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});
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
    // Read from the events list, not freeBusy or the calendar resource:
    // Capital Q asks only for calendar.events (founder live 2026-09-29:
    // freeBusy answered 403 for every connected person), and that scope
    // lists events and reports the calendar's zone on the same response.
    busy: async (access, window) => {
      const busy: { start: Date; end: Date }[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const url = new URL(`${CALENDAR_API}/calendars/primary/events`);
        url.searchParams.set("timeMin", window.from.toISOString());
        url.searchParams.set("timeMax", window.to.toISOString());
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("orderBy", "startTime");
        url.searchParams.set("maxResults", "250");
        if (pageToken !== undefined)
          url.searchParams.set("pageToken", pageToken);
        const result = await call(
          http,
          url.toString(),
          { method: "GET", headers: headers(access) },
          EventListSchema,
        );
        for (const item of result.items ?? []) {
          // Free events and cancelled ones do not block a slot.
          if (
            item.status === "cancelled" ||
            item.transparency === "transparent"
          ) {
            continue;
          }
          const start = item.start?.dateTime ?? item.start?.date;
          const end = item.end?.dateTime ?? item.end?.date;
          if (start === undefined || end === undefined) continue;
          busy.push({ start: new Date(start), end: new Date(end) });
        }
        pageToken = result.nextPageToken ?? undefined;
        if (pageToken === undefined) break;
      }
      return busy;
    },

    timeZone: async (access) => {
      const url = new URL(`${CALENDAR_API}/calendars/primary/events`);
      url.searchParams.set("maxResults", "1");
      url.searchParams.set("timeMin", new Date().toISOString());
      const result = await call(
        http,
        url.toString(),
        { method: "GET", headers: headers(access) },
        EventListSchema,
      );
      return result.timeZone ?? "UTC";
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

    conference: async (access, eventId, options) => {
      if (options.ask) {
        // A fresh request id: Google creates a conference once per id.
        const asked = await send(
          http,
          `${eventUrl(eventId)}?conferenceDataVersion=1&sendUpdates=none`,
          {
            method: "PATCH",
            headers: headers(access, true),
            body: JSON.stringify({
              conferenceData: {
                createRequest: {
                  requestId: `${eventId}-retry`,
                  conferenceSolutionKey: { type: "hangoutsMeet" },
                },
              },
            }),
          },
        );
        if (asked.status === 404 || asked.status === 410) {
          return { status: "MISSING" };
        }
        if (asked.status < 200 || asked.status > 299) {
          throw errorForStatus(asked.status);
        }
      }
      const response = await send(
        http,
        `${eventUrl(eventId)}?conferenceDataVersion=1`,
        { method: "GET", headers: headers(access) },
      );
      if (response.status === 404 || response.status === 410) {
        return { status: "MISSING" };
      }
      if (response.status < 200 || response.status > 299) {
        throw errorForStatus(response.status);
      }
      const parsed = EventSchema.safeParse(await readJson(response));
      if (!parsed.success) {
        throw new GoogleProviderError("MALFORMED_RESPONSE", response.status);
      }
      const link = meetLinkOf(parsed.data);
      return link === null
        ? { status: "PENDING" }
        : { status: "READY", meetLink: link };
    },

    announceLink: async (access, eventId, meetLink) => {
      // Touching the event with sendUpdates=all is what makes Google send
      // every guest the updated invite, now with the link in it.
      await call(
        http,
        `${eventUrl(eventId)}?conferenceDataVersion=1&sendUpdates=all`,
        {
          method: "PATCH",
          headers: headers(access, true),
          body: JSON.stringify({ location: meetLink }),
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
