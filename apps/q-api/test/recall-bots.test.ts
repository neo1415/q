import { describe, expect, it } from "vitest";

import { transcriptText } from "@capital-q/communication";

import { createRecallBots, stateOf } from "../src/composition/recall-bots.js";

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
    expect(stateOf(["joining_call", "in_waiting_room"])).toBe("IN_CALL");
    expect(stateOf(["in_call_recording", "call_ended"])).toBe("ENDED");
    expect(stateOf(["joining_call", "fatal"])).toBe("FAILED");
  });
});
