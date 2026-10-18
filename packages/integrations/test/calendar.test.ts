import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CALENDAR_EVENTS_SCOPE,
  createGoogleCalendarProvider,
  createIntegrationsService,
  createTokenCipher,
  GoogleProviderError,
  SecretToken,
  type GoogleHttp,
  type GoogleHttpRequest,
} from "@capital-q/integrations";
import {
  createFakeEmailProvider,
  createFakeGoogleOAuth,
  createInMemoryIntegrationsStore,
  createRecordingActivityWriter,
  FAKE_ACCESS_TOKEN,
  FAKE_REFRESH_TOKEN,
  inlineTransactions,
} from "@capital-q/integrations/testing";

/**
 * BIZ-008: the Google Calendar adapter against a scripted HTTP double
 * (nothing reaches Google), and the service's per-person calendar gate.
 */

const ACCESS = { accessToken: new SecretToken(FAKE_ACCESS_TOKEN) };
const EVENT_ID = "0123456789abcdef0123456789abcdef";

type Call = { url: string; request: GoogleHttpRequest };

function scripted(
  responses: readonly { status: number; body?: unknown }[],
): GoogleHttp & { calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const http = ((url: string, request: GoogleHttpRequest) => {
    calls.push({ url, request });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve({
      status: next?.status ?? 500,
      json: () => Promise.resolve(next?.body ?? {}),
    });
  }) as GoogleHttp & { calls: Call[] };
  http.calls = calls;
  return http;
}

const EVENT = {
  eventId: EVENT_ID,
  summary: "Call: Ada Ventures and Acme",
  description: "Intro",
  start: new Date("2026-10-06T09:00:00Z"),
  end: new Date("2026-10-06T09:30:00Z"),
  timeZone: "Europe/London",
  attendees: [{ email: "ada@example.invalid", displayName: "Ada" }],
};

describe("Google Calendar adapter", () => {
  it("inserts with a Meet create request, conferenceDataVersion=1 and sendUpdates=all", async () => {
    const http = scripted([
      {
        status: 200,
        body: {
          id: EVENT_ID,
          hangoutLink: "https://meet.google.com/abc-defg-hij",
        },
      },
    ]);
    const result = await createGoogleCalendarProvider(http).insert(
      ACCESS,
      EVENT,
    );
    expect(result.meetLink).toBe("https://meet.google.com/abc-defg-hij");
    const [call] = http.calls;
    expect(call?.url).toContain("conferenceDataVersion=1");
    expect(call?.url).toContain("sendUpdates=all");
    const body = JSON.parse(call?.request.body ?? "{}") as {
      id: string;
      attendees: { email: string }[];
      conferenceData: {
        createRequest: {
          requestId: string;
          conferenceSolutionKey: { type: string };
        };
      };
    };
    expect(body.id).toBe(EVENT_ID);
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe(
      "hangoutsMeet",
    );
    expect(body.conferenceData.createRequest.requestId).toBe(EVENT_ID);
    expect(body.attendees.map((a) => a.email)).toEqual(["ada@example.invalid"]);
    expect(call?.request.headers.authorization).toBe(
      `Bearer ${FAKE_ACCESS_TOKEN}`,
    );
  });

  it("treats a 409 on retry as the same event and reads its link back", async () => {
    const http = scripted([
      { status: 409 },
      {
        status: 200,
        body: {
          id: EVENT_ID,
          conferenceData: {
            entryPoints: [
              {
                entryPointType: "video",
                uri: "https://meet.google.com/xyz-abcd-efg",
              },
            ],
          },
        },
      },
    ]);
    const result = await createGoogleCalendarProvider(http).insert(
      ACCESS,
      EVENT,
    );
    expect(result.meetLink).toBe("https://meet.google.com/xyz-abcd-efg");
    expect(http.calls).toHaveLength(2);
    expect(http.calls[1]?.request.method).toBe("GET");
  });

  it("never accepts a non-Meet link", async () => {
    const http = scripted([
      {
        status: 200,
        body: { id: EVENT_ID, hangoutLink: "https://evil.example/x" },
      },
      { status: 200, body: { id: EVENT_ID } },
    ]);
    const result = await createGoogleCalendarProvider(http).insert(
      ACCESS,
      EVENT,
    );
    expect(result.meetLink).toBeNull();
  });

  // AUTO (2026-10-02): a Meet link Google attached late.
  it("re-reads the conference, asking for one first when told to", async () => {
    const pending = scripted([{ status: 200, body: { id: EVENT_ID } }]);
    expect(
      await createGoogleCalendarProvider(pending).conference(ACCESS, EVENT_ID, {
        ask: false,
      }),
    ).toEqual({ status: "PENDING" });
    expect(pending.calls.map((call) => call.request.method)).toEqual(["GET"]);

    const asked = scripted([
      { status: 200, body: { id: EVENT_ID } },
      {
        status: 200,
        body: {
          id: EVENT_ID,
          hangoutLink: "https://meet.google.com/abc-defg-hij",
        },
      },
    ]);
    expect(
      await createGoogleCalendarProvider(asked).conference(ACCESS, EVENT_ID, {
        ask: true,
      }),
    ).toEqual({
      status: "READY",
      meetLink: "https://meet.google.com/abc-defg-hij",
    });
    expect(asked.calls[0]?.request.method).toBe("PATCH");
    expect(asked.calls[0]?.url).toContain("conferenceDataVersion=1");
    expect(String(asked.calls[0]?.request.body)).toContain(`${EVENT_ID}-retry`);

    const gone = scripted([{ status: 404 }]);
    expect(
      await createGoogleCalendarProvider(gone).conference(ACCESS, EVENT_ID, {
        ask: false,
      }),
    ).toEqual({ status: "MISSING" });
  });

  it("announces the link to every guest with sendUpdates=all", async () => {
    const http = scripted([{ status: 200, body: { id: EVENT_ID } }]);
    await createGoogleCalendarProvider(http).announceLink(
      ACCESS,
      EVENT_ID,
      "https://meet.google.com/abc-defg-hij",
    );
    expect(http.calls[0]?.request.method).toBe("PATCH");
    expect(http.calls[0]?.url).toContain("sendUpdates=all");
  });

  it("cancels with sendUpdates=all and treats already-gone as done", async () => {
    const http = scripted([{ status: 410 }]);
    await createGoogleCalendarProvider(http).cancel(ACCESS, EVENT_ID);
    expect(http.calls[0]?.request.method).toBe("DELETE");
    expect(http.calls[0]?.url).toContain("sendUpdates=all");
  });

  it("moves with a PATCH of the times", async () => {
    const http = scripted([{ status: 200, body: { id: EVENT_ID } }]);
    await createGoogleCalendarProvider(http).move(ACCESS, EVENT_ID, {
      start: EVENT.start,
      end: EVENT.end,
      timeZone: "UTC",
    });
    expect(http.calls[0]?.request.method).toBe("PATCH");
    expect(http.calls[0]?.url).toContain("sendUpdates=all");
  });

  it("reads busy times from the events list, within calendar.events", async () => {
    const ok = scripted([
      {
        status: 200,
        body: {
          timeZone: "Africa/Lagos",
          items: [
            {
              status: "confirmed",
              start: { dateTime: "2026-10-06T09:00:00Z" },
              end: { dateTime: "2026-10-06T10:00:00Z" },
            },
            // Free and cancelled events do not block a slot.
            {
              status: "confirmed",
              transparency: "transparent",
              start: { dateTime: "2026-10-06T11:00:00Z" },
              end: { dateTime: "2026-10-06T12:00:00Z" },
            },
            {
              status: "cancelled",
              start: { dateTime: "2026-10-06T13:00:00Z" },
              end: { dateTime: "2026-10-06T14:00:00Z" },
            },
          ],
        },
      },
    ]);
    const busy = await createGoogleCalendarProvider(ok).busy(ACCESS, {
      from: new Date("2026-10-06T00:00:00Z"),
      to: new Date("2026-10-07T00:00:00Z"),
    });
    expect(busy).toEqual([
      {
        start: new Date("2026-10-06T09:00:00Z"),
        end: new Date("2026-10-06T10:00:00Z"),
      },
    ]);
    // Never freeBusy: it needs a scope Capital Q does not ask for.
    expect(ok.calls[0]?.url).toContain("/calendars/primary/events");
    expect(ok.calls[0]?.request.method).toBe("GET");
    const refused = scripted([{ status: 403, body: { error: "forbidden" } }]);
    await expect(
      createGoogleCalendarProvider(refused).busy(ACCESS, {
        from: new Date(),
        to: new Date(),
      }),
    ).rejects.toBeInstanceOf(GoogleProviderError);
  });

  it("reads the calendar's zone from the events list", async () => {
    const http = scripted([
      { status: 200, body: { timeZone: "Europe/London", items: [] } },
    ]);
    expect(await createGoogleCalendarProvider(http).timeZone(ACCESS)).toBe(
      "Europe/London",
    );
  });
});

describe("calendarOf", () => {
  const TENANT = "00000000-0000-4000-8000-00000000000a";
  const USER = "00000000-0000-4000-8000-0000000000b1";
  const KEY = randomBytes(32).toString("base64");

  async function world(
    scopes: readonly string[],
    responses: readonly { status: number; body?: unknown }[] = [
      { status: 200, body: { timeZone: "Europe/London" } },
    ],
  ) {
    const store = createInMemoryIntegrationsStore();
    const cipher = createTokenCipher(KEY);
    await store.connectAccount({
      tenantId: TENANT,
      userId: USER,
      googleSubject: "1234",
      email: "organiser@example.invalid",
      scopes,
      refreshTokenCiphertext: cipher.encrypt(
        new SecretToken(FAKE_REFRESH_TOKEN),
        USER,
      ),
      keyVersion: 1,
      historyId: null,
    });
    const http = scripted(responses);
    const service = createIntegrationsService({
      store,
      transactions: inlineTransactions,
      activity: createRecordingActivityWriter(),
      google: {
        oauth: createFakeGoogleOAuth(),
        cipher,
        email: createFakeEmailProvider(),
        calendar: createGoogleCalendarProvider(http),
      },
    });
    return { service, http, store };
  }

  it("binds the person's own connection and mints access from the sealed token", async () => {
    const w = await world(["openid", CALENDAR_EVENTS_SCOPE]);
    const calendar = await w.service.calendarOf(USER);
    expect(calendar?.email).toBe("organiser@example.invalid");
    expect(await calendar?.timeZone()).toBe("Europe/London");
    expect(JSON.stringify(calendar)).not.toContain(FAKE_ACCESS_TOKEN);
  });

  it("is null without the calendar scope or a connection", async () => {
    const w = await world(["openid"]);
    expect(await w.service.calendarOf(USER)).toBeNull();
    expect(
      await w.service.calendarOf("00000000-0000-4000-8000-0000000000b2"),
    ).toBeNull();
  });

  it("types a missing calendar from the rows alone: revoked apart from never connected (meetfix-57)", async () => {
    const w = await world(["openid", CALENDAR_EVENTS_SCOPE]);
    expect(await w.service.calendarState(USER)).toBe("CONNECTED");
    const account = w.store.accounts[0];
    if (account === undefined) throw new Error("no account");
    await w.store.endConnection(account.id, "REVOKED_BY_PROVIDER");
    expect(await w.service.calendarState(USER)).toBe("REVOKED");
    expect(await w.service.status(USER)).toMatchObject({ status: "REVOKED" });
    expect(
      await w.service.calendarState("00000000-0000-4000-8000-0000000000b2"),
    ).toBe("NOT_CONNECTED");
    // Nothing reached Google for any of it.
    expect(w.http.calls).toHaveLength(0);
    const narrow = await world(["openid"]);
    expect(await narrow.service.calendarState(USER)).toBe("NOT_CONNECTED");
  });

  // Deck wave 8: a connected Google account is not a connected calendar.
  it("says Calendar access was not granted when the grant lacks the scope, without asking Google", async () => {
    const w = await world(["openid"]);
    expect(await w.service.status(USER)).toMatchObject({
      status: "CONNECTED",
      calendar: "NOT_GRANTED",
    });
    expect(w.http.calls).toHaveLength(0);
  });

  it("checks the calendar once with the grant, and remembers the answer", async () => {
    const w = await world(
      ["openid", CALENDAR_EVENTS_SCOPE],
      [{ status: 200, body: { items: [] } }],
    );
    expect(await w.service.status(USER)).toMatchObject({
      status: "CONNECTED",
      calendar: "GRANTED",
    });
    await w.service.status(USER);
    expect(w.http.calls).toHaveLength(1);
    expect(w.http.calls[0]?.url).toContain("/calendars/primary/events");
    expect(w.http.calls[0]?.url).toContain("maxResults=1");
  });

  it("a grant Google refuses for the calendar is NOT_GRANTED", async () => {
    const w = await world(
      ["openid", CALENDAR_EVENTS_SCOPE],
      [{ status: 403, body: { error: "insufficientPermissions" } }],
    );
    expect(await w.service.status(USER)).toMatchObject({
      calendar: "NOT_GRANTED",
    });
  });

  it("an outage while checking keeps the recorded scope's answer", async () => {
    const w = await world(["openid", CALENDAR_EVENTS_SCOPE], [{ status: 503 }]);
    expect(await w.service.status(USER)).toMatchObject({
      calendar: "GRANTED",
    });
  });
});

describe("probe", () => {
  it("is GRANTED on 200, DENIED on 401/403, and throws on an outage", async () => {
    expect(
      await createGoogleCalendarProvider(
        scripted([{ status: 200, body: { items: [] } }]),
      ).probe(ACCESS),
    ).toBe("GRANTED");
    for (const status of [401, 403]) {
      expect(
        await createGoogleCalendarProvider(scripted([{ status }])).probe(
          ACCESS,
        ),
      ).toBe("DENIED");
    }
    await expect(
      createGoogleCalendarProvider(scripted([{ status: 500 }])).probe(ACCESS),
    ).rejects.toBeInstanceOf(GoogleProviderError);
  });
});
