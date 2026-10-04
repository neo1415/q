import { createHmac } from "node:crypto";

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { MEETING_HOST_WEBHOOK_PATH } from "../src/composition/meeting-host-runtime.js";
import {
  createRecallBots,
  createRecallStatusWebhook,
  recallEventBotId,
  verifySvixSignature,
} from "../src/composition/recall-bots.js";
import { registerMeetingHostRoutes } from "../src/http/meeting-host.js";

/**
 * meet-47: a late transcript is settled the moment Recall's status webhook
 * names the bot (the collector's poll stays the fallback). The delivery is
 * Svix-signed; anything else is refused unread. Fixture secret only; no
 * provider is reached.
 */

const SECRET = `whsec_${Buffer.from("fixture-secret-0123456789abcdef").toString("base64")}`;
const NOW = new Date("2026-10-05T10:00:00Z");
const BOT = "ed286a30-bd50-4582-ac63-9f408fbd6811";

function signed(body: string, at = NOW, secret = SECRET) {
  const id = "msg_2mFixture";
  const timestamp = String(Math.floor(at.getTime() / 1_000));
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  };
}

// Recall's status webhook body (bot.status_change, v1).
const STATUS_CHANGE = JSON.stringify({
  event: "bot.status_change",
  data: {
    bot: { id: BOT, metadata: {} },
    data: { code: "done", sub_code: null, updated_at: "2026-10-02T12:29:36Z" },
  },
});

describe("Recall's status webhook", () => {
  it("verifies a Svix signature over the raw body", () => {
    const rawBody = Buffer.from(STATUS_CHANGE);
    expect(
      verifySvixSignature({
        secret: SECRET,
        headers: signed(STATUS_CHANGE),
        rawBody,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("refuses a wrong secret, a changed body and an old delivery", () => {
    const rawBody = Buffer.from(STATUS_CHANGE);
    const other = `whsec_${Buffer.from("another-secret-0123456789abcd").toString("base64")}`;
    expect(
      verifySvixSignature({
        secret: SECRET,
        headers: signed(STATUS_CHANGE, NOW, other),
        rawBody,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifySvixSignature({
        secret: SECRET,
        headers: signed(STATUS_CHANGE),
        rawBody: Buffer.from(STATUS_CHANGE.replace("done", "fatal")),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifySvixSignature({
        secret: SECRET,
        headers: signed(STATUS_CHANGE, new Date(NOW.getTime() - 10 * 60_000)),
        rawBody,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifySvixSignature({ secret: SECRET, headers: {}, rawBody, now: NOW }),
    ).toBe(false);
  });

  it("names the bot for status and transcript events only", () => {
    expect(recallEventBotId(JSON.parse(STATUS_CHANGE))).toBe(BOT);
    expect(
      recallEventBotId({
        event: "transcript.done",
        data: { bot: { id: BOT }, transcript: { id: "t1" } },
      }),
    ).toBe(BOT);
    expect(
      recallEventBotId({ event: "calendar.update", data: { bot_id: BOT } }),
    ).toBeNull();
    expect(recallEventBotId("not json")).toBeNull();
  });

  it("composes nothing without a whsec_ secret", () => {
    for (const secret of [undefined, "disabled-locally-000000000000"]) {
      expect(
        createRecallStatusWebhook({
          secret,
          settleBot: () => Promise.resolve(),
        }),
      ).toBeUndefined();
    }
  });
});

describe("the meeting-host path takes both deliveries", () => {
  async function app() {
    const settled: string[] = [];
    const received: unknown[] = [];
    const server = Fastify();
    registerMeetingHostRoutes(server, {
      host: {
        verify: (meetingId: string, token: string) =>
          meetingId === "00000000-0000-4000-8000-0000000000b1" &&
          token === "t".repeat(32),
        receive: (_meetingId: string, body: unknown) => {
          received.push(body);
          return Promise.resolve();
        },
      } as unknown as Parameters<typeof registerMeetingHostRoutes>[1]["host"],
      status: createRecallStatusWebhook({
        secret: SECRET,
        settleBot: (botId) => {
          settled.push(botId);
          return Promise.resolve();
        },
        now: () => NOW,
      }),
    });
    await server.ready();
    return { server, settled, received };
  }

  it("settles the bot a signed status delivery names", async () => {
    const t = await app();
    const response = await t.server.inject({
      method: "POST",
      url: MEETING_HOST_WEBHOOK_PATH,
      headers: { "content-type": "application/json", ...signed(STATUS_CHANGE) },
      payload: STATUS_CHANGE,
    });
    expect(response.statusCode).toBe(204);
    await new Promise((resolve) => setImmediate(resolve));
    expect(t.settled).toEqual([BOT]);
  });

  it("refuses an unsigned status delivery unread", async () => {
    const t = await app();
    const response = await t.server.inject({
      method: "POST",
      url: MEETING_HOST_WEBHOOK_PATH,
      headers: { "content-type": "application/json" },
      payload: STATUS_CHANGE,
    });
    expect(response.statusCode).toBe(401);
    expect(t.settled).toEqual([]);
  });

  it("still hands a call's live events, parsed, to the host", async () => {
    const t = await app();
    const response = await t.server.inject({
      method: "POST",
      url: `${MEETING_HOST_WEBHOOK_PATH}?meeting=00000000-0000-4000-8000-0000000000b1&token=${"t".repeat(32)}`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ event: "transcript.data", data: {} }),
    });
    expect(response.statusCode).toBe(204);
    expect(t.received).toEqual([{ event: "transcript.data", data: {} }]);
  });
});

describe("a bot removed part-way", () => {
  it("returns what it heard, marked cut short", async () => {
    const base = "https://eu-central-1.recall.ai/api/v1";
    const bots = createRecallBots({
      apiKey: "fixture-key-0000000000000000000",
      region: "eu-central-1",
      fetch: (url: string | URL | Request) => {
        const path =
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.href
              : url.url;
        const body =
          path === `${base}/bot/${BOT}/`
            ? {
                id: BOT,
                status_changes: [
                  { code: "in_call_recording", sub_code: null },
                  { code: "call_ended", sub_code: "bot_kicked_from_call" },
                  { code: "done", sub_code: null },
                ],
                recordings: [
                  {
                    media_shortcuts: {
                      transcript: {
                        status: { code: "done" },
                        data: { download_url: "https://files.example/t.json" },
                      },
                    },
                  },
                ],
              }
            : [
                {
                  participant: { id: 100, name: "Ada" },
                  words: [{ text: "We" }, { text: "grew." }],
                },
              ];
        return Promise.resolve(
          new Response(JSON.stringify(body), { status: 200 }),
        );
      },
    });
    const read = await bots?.read(BOT);
    expect(read).toEqual({
      state: "ENDED",
      transcript: [{ speaker: "Ada", text: "We grew." }],
      cutShort: "REMOVED",
    });
  });
});
