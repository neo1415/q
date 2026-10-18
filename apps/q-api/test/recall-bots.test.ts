import { describe, expect, it } from "vitest";

import { transcriptText } from "@capital-q/communication";

import {
  botRequest,
  createRecallBots,
  endOf,
  speakerOf,
  stateOf,
  transcriberOf,
} from "../src/composition/recall-bots.js";

/**
 * Q in a meeting (founder direction 2026-09-29): the Recall adapter, over
 * a fake fetch. No test reaches the provider.
 */
function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const doFetch = ((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const key = `${method} ${url}`;
    if (!(key in routes)) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(routes[key]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { doFetch, calls };
}

const KEY = "0123456789abcdef0123456789abcdef01234567";
const BASE = "https://eu-central-1.recall.ai/api/v1";

describe("the Recall meeting bot", () => {
  it("is not composed without a real key", () => {
    expect(
      createRecallBots({ apiKey: undefined, region: "eu-central-1" }),
    ).toBeUndefined();
    expect(
      createRecallBots({
        apiKey: "disabled-locally-000000000000",
        region: "eu-central-1",
      }),
    ).toBeUndefined();
  });

  it("joins under Q's name at the call's start, using the call's captions", async () => {
    const { doFetch, calls } = fakeFetch({
      [`POST ${BASE}/bot/`]: { id: "bot-12345678" },
    });
    const bots = createRecallBots({
      apiKey: KEY,
      region: "eu-central-1",
      fetch: doFetch,
    });
    const at = new Date("2026-10-01T10:00:00.000Z");
    const created = await bots?.create({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      joinAt: at,
      botName: "Q (Capital Q notes)",
    });
    expect(created?.botId).toBe("bot-12345678");
    expect(calls[0]?.body).toMatchObject({
      meeting_url: "https://meet.google.com/abc-defg-hij",
      bot_name: "Q (Capital Q notes)",
      join_at: at.toISOString(),
      recording_config: { transcript: { provider: { meeting_captions: {} } } },
    });
  });

  it("reads an ended call's captions as speaker lines", async () => {
    const { doFetch } = fakeFetch({
      [`GET ${BASE}/bot/bot-12345678/`]: {
        id: "bot-12345678",
        status_changes: [
          { code: "joining_call" },
          { code: "in_call_recording" },
          { code: "done" },
        ],
        recordings: [
          {
            media_shortcuts: {
              transcript: {
                data: { download_url: "https://files.example/t.json" },
              },
            },
          },
        ],
      },
      "GET https://files.example/t.json": [
        {
          participant: { name: "Ada" },
          words: [{ text: "We" }, { text: "raised" }, { text: "$2m." }],
        },
        {
          participant: { name: "Zino" },
          words: [{ text: "Send" }, { text: "the" }, { text: "deck." }],
        },
      ],
    });
    const bots = createRecallBots({
      apiKey: KEY,
      region: "eu-central-1",
      fetch: doFetch,
    });
    const read = await bots?.read("bot-12345678");
    expect(read?.state).toBe("ENDED");
    expect(transcriptText(read?.transcript ?? [])).toBe(
      "Ada: We raised $2m.\nZino: Send the deck.",
    );
  });

  it("reads the bot's latest status as a state", () => {
    expect(stateOf([])).toBe("WAITING");
    expect(stateOf(["joining_call", "in_waiting_room"])).toBe("LOBBY");
    expect(stateOf(["in_waiting_room", "in_call_recording"])).toBe("IN_CALL");
    expect(stateOf(["in_call_recording", "call_ended"])).toBe("ENDED");
    expect(stateOf(["joining_call", "fatal"])).toBe("FAILED");
  });

  // Real Recall v1 shapes, read 2026-10-03 from the three live bots
  // (people renamed; ids, codes, timings and structure kept).
  const LOBBY_TIMEOUT = {
    id: "588ec4d1-914e-46e7-9014-d59a315b4e50",
    meeting_url: { meeting_id: "abc-defg-hij", platform: "google_meet" },
    bot_name: "Q (Capital Q notes)",
    status_changes: [
      {
        code: "joining_call",
        message: null,
        created_at: "2026-10-02T13:57:00.646418Z",
        sub_code: null,
      },
      {
        code: "in_waiting_room",
        message: null,
        created_at: "2026-10-02T13:57:01.951988Z",
        sub_code: null,
      },
      {
        code: "call_ended",
        message: null,
        created_at: "2026-10-02T14:10:03.111778Z",
        sub_code: "timeout_exceeded_waiting_room",
      },
      {
        code: "done",
        message: null,
        created_at: "2026-10-02T14:10:03.112131Z",
        sub_code: null,
      },
    ],
    recordings: [],
  };
  const GREETING_ONLY = {
    id: "ed286a30-bd50-4582-ac63-9f408fbd6811",
    status_changes: [
      { code: "joining_call", sub_code: null },
      { code: "in_waiting_room", sub_code: null },
      { code: "in_call_not_recording", sub_code: null },
      { code: "in_call_recording", sub_code: null },
      { code: "call_ended", sub_code: "bot_received_leave_call" },
      { code: "recording_done", sub_code: null },
      { code: "done", sub_code: null },
    ],
    recordings: [
      {
        id: "ad763e9b-8201-4cbf-95be-32a24a226dd9",
        status: { code: "done", sub_code: null },
        media_shortcuts: {
          transcript: {
            id: "c7405d42-9b3a-4004-86f1-76806831281e",
            status: {
              code: "done",
              sub_code: null,
              updated_at: "2026-10-02T12:29:36.542318Z",
            },
            provider: { meeting_captions: {} },
            data: {
              download_url: "https://files.example/greeting.json",
              provider_data_download_url: "https://files.example/provider.json",
            },
          },
          audio_mixed: null,
        },
      },
    ],
  };
  const GREETING_TRANSCRIPT = [
    {
      participant: {
        id: 2147483647,
        name: "Unknown",
        extra_data: null,
        is_host: null,
        platform: "unknown",
      },
      words: [
        {
          text: "Hi, Ada! I'm Q from capital Q here to take notes and help, say, Q leave",
          start_timestamp: {
            relative: 1.89,
            absolute: "2026-10-02T12:29:23.110160Z",
          },
          end_timestamp: {
            relative: 8.37,
            absolute: "2026-10-02T12:29:29.590160Z",
          },
        },
        {
          text: "to remove me.",
          start_timestamp: { relative: 8.37 },
          end_timestamp: { relative: 10.41 },
        },
      ],
      language_code: "en-US",
    },
  ];

  it("says why a call never admitted Q, at once, instead of waiting hours", async () => {
    const { doFetch } = fakeFetch({
      [`GET ${BASE}/bot/${LOBBY_TIMEOUT.id}/`]: LOBBY_TIMEOUT,
    });
    const bots = createRecallBots({
      apiKey: KEY,
      region: "eu-central-1",
      fetch: doFetch,
    });
    expect(await bots?.read(LOBBY_TIMEOUT.id)).toEqual({
      state: "ENDED",
      transcript: null,
      ended: "NOT_ADMITTED",
    });
  });

  it("reads a bot held in the lobby as LOBBY", async () => {
    const held = {
      ...LOBBY_TIMEOUT,
      status_changes: LOBBY_TIMEOUT.status_changes.slice(0, 2),
    };
    const { doFetch } = fakeFetch({ [`GET ${BASE}/bot/${held.id}/`]: held });
    const bots = createRecallBots({
      apiKey: KEY,
      region: "eu-central-1",
      fetch: doFetch,
    });
    expect((await bots?.read(held.id))?.state).toBe("LOBBY");
  });

  it("labels Q's own greeting as Q, never as a person, and fetches the presigned link unauthorized", async () => {
    const { doFetch, calls } = fakeFetch({
      [`GET ${BASE}/bot/${GREETING_ONLY.id}/`]: GREETING_ONLY,
      "GET https://files.example/greeting.json": GREETING_TRANSCRIPT,
    });
    const headers: (Headers | undefined)[] = [];
    const watched = ((input: string | URL, init?: RequestInit) => {
      headers.push(
        init?.headers === undefined ? undefined : new Headers(init.headers),
      );
      return doFetch(input, init);
    }) as typeof fetch;
    const bots = createRecallBots({
      apiKey: KEY,
      region: "eu-central-1",
      fetch: watched,
    });
    const read = await bots?.read(GREETING_ONLY.id);
    expect(read?.state).toBe("ENDED");
    expect(read?.transcript?.map((line) => line.speaker)).toEqual(["Q"]);
    expect(calls[1]?.url).toBe("https://files.example/greeting.json");
    expect(headers[1]?.get("authorization") ?? null).toBeNull();
  });

  it("waits while the transcript is processing and fails plainly when it failed", async () => {
    const processing = structuredClone(GREETING_ONLY);
    const shortcut = processing.recordings[0]?.media_shortcuts.transcript;
    if (shortcut === undefined) throw new Error("fixture");
    shortcut.status.code = "processing";
    shortcut.data = {
      download_url: null as unknown as string,
      provider_data_download_url: "",
    };
    const failed = structuredClone(processing);
    const failedShortcut = failed.recordings[0]?.media_shortcuts.transcript;
    if (failedShortcut === undefined) throw new Error("fixture");
    failedShortcut.status.code = "failed";
    const { doFetch } = fakeFetch({
      [`GET ${BASE}/bot/p/`]: { ...processing, id: "p" },
      [`GET ${BASE}/bot/f/`]: { ...failed, id: "f" },
    });
    const bots = createRecallBots({
      apiKey: KEY,
      region: "eu-central-1",
      fetch: doFetch,
    });
    expect(await bots?.read("p")).toEqual({ state: "ENDED", transcript: null });
    expect(await bots?.read("f")).toEqual({
      state: "ENDED",
      transcript: null,
      ended: "TRANSCRIPT_FAILED",
    });
  });

  it("reads each Recall end code as a reason", () => {
    expect(endOf([null, null, "timeout_exceeded_waiting_room", null])).toBe(
      "NOT_ADMITTED",
    );
    expect(endOf(["bot_kicked_from_waiting_room"])).toBe("NOT_ADMITTED");
    expect(endOf(["bot_kicked_from_call"])).toBe("REMOVED");
    expect(endOf(["timeout_exceeded_noone_joined"])).toBe("NOBODY_CAME");
    expect(endOf(["timeout_exceeded_recording_permission_denied"])).toBe(
      "NOT_RECORDED",
    );
    expect(endOf(["call_ended_by_host"])).toBe("NO_RECORDING");
  });

  it("keeps real speakers and leaves the unattributed unknown", () => {
    expect(speakerOf("Ada Fictional", "We raised two million.")).toBe(
      "Ada Fictional",
    );
    expect(speakerOf("Unknown", "We raised two million.")).toBeNull();
    expect(speakerOf("Q (Capital Q notes)", "Happy to help.")).toBe("Q");
  });

  it("uses Recall's streaming transcription only when chosen", () => {
    const input = {
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      joinAt: null,
      botName: "Q (Capital Q notes)",
    };
    expect(transcriberOf(undefined)).toBe("meeting_captions");
    expect(transcriberOf("anything")).toBe("meeting_captions");
    expect(
      botRequest({
        ...input,
        transcriber: transcriberOf("recallai_streaming"),
      }),
    ).toMatchObject({
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: {
              mode: "prioritize_low_latency",
              language_code: "en",
            },
          },
        },
      },
    });
  });
});
