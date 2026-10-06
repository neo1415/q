import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  createMeetingScreenVision,
  MEETING_SCREEN_WS_PATH,
  type MeetingScreenStore,
} from "../src/composition/meeting-screen-vision.js";
import { botRequest, SCREEN_EVENTS } from "../src/composition/recall-bots.js";
import { attachWebSocketReceiver } from "../src/http/ws-receiver.js";

/**
 * P5: Q sees screens shared in a real call (Recall video_separate_png over
 * a websocket), never cameras, on a budget, and writes what it saw to the
 * owner's private notes only. No provider is reached: the model and the
 * store are fakes; the websocket is a real loopback connection.
 */

const SECRET = "recall-key-for-tests-0000000000000000";
const MEETING = "d9eda847-7f89-4a03-8352-042525b3d758";

function frame(type: "webcam" | "screenshare", buffer: string) {
  return JSON.stringify({
    event: "video_separate_png.data",
    data: {
      data: {
        buffer,
        timestamp: { absolute: "2026-10-06T08:10:00Z", relative: 12.5 },
        type,
        participant: { id: 100, name: "oyeniyi Daniel", is_host: true },
      },
      realtime_endpoint: { id: "re", metadata: {} },
      video_separate: { id: "vs", metadata: {} },
      recording: { id: "r", metadata: {} },
      bot: { id: "b", metadata: {} },
    },
  });
}

function harness(options: { declined?: boolean; worth?: boolean } = {}) {
  const clock = { at: 1_000_000 };
  const observed: Parameters<MeetingScreenStore["observe"]>[0][] = [];
  const looked: { image: string; recentWords: string }[] = [];
  const logs: string[] = [];
  const vision = createMeetingScreenVision({
    enabled: true,
    publicBase: "https://q-api.example",
    secret: SECRET,
    store: {
      context: () =>
        Promise.resolve({
          tenantId: "t-owner",
          ownerUserId: "u-owner",
          meetingText: "Purpose: Seed round",
          declined: options.declined ?? false,
        }),
      observe: (input) => {
        observed.push(input);
        return Promise.resolve();
      },
    },
    noter: {
      note: (_who, variables, png) => {
        looked.push({ image: png, recentWords: variables.recentWords });
        return Promise.resolve({
          worthNoting: options.worth ?? true,
          shows: "Slide 'Unit economics': CAC $120, payback 9 months.",
          take: "Payback is unverified; ask for the cohort data.",
        });
      },
    },
    recentWords: () => "oyeniyi Daniel: here are our unit economics",
    now: () => clock.at,
    logger: {
      info: (fields: unknown, message: string) => {
        logs.push(JSON.stringify(fields) + message);
      },
      warn: (fields: unknown, message: string) => {
        logs.push(JSON.stringify(fields) + message);
      },
    } as never,
  });
  return { vision, clock, observed, looked, logs };
}

describe("P5: Q's private notes on shared screens in a call", () => {
  it("never looks at a webcam; notes a shared screen for the owner only", async () => {
    const t = harness();
    t.vision.receive(MEETING, frame("webcam", "CAMERAFRAMEBYTES"));
    await t.vision.idle(MEETING);
    expect(t.looked).toEqual([]);
    t.vision.receive(MEETING, frame("screenshare", "SCREENFRAMEBYTES1"));
    await t.vision.idle(MEETING);
    expect(t.looked.map((l) => l.image)).toEqual(["SCREENFRAMEBYTES1"]);
    expect(t.looked[0]?.recentWords).toContain("unit economics");
    expect(t.observed).toHaveLength(1);
    expect(t.observed[0]).toMatchObject({
      meetingId: MEETING,
      tenantId: "t-owner",
      ownerUserId: "u-owner",
      sharedByName: "oyeniyi Daniel",
    });
    expect(t.observed[0]?.body).toContain("CAC $120");
    // Frames are never logged.
    expect(t.logs.join(" ")).not.toContain("FRAMEBYTES");
  });

  it("looks again only after the gap, and only when the screen changed", async () => {
    const t = harness();
    t.vision.receive(MEETING, frame("screenshare", "SLIDE-ONE-BYTES"));
    await t.vision.idle(MEETING);
    t.clock.at += 1_000;
    t.vision.receive(MEETING, frame("screenshare", "SLIDE-TWO-BYTES"));
    // Too soon: held. The share keeps streaming it; after the gap, it is seen.
    t.clock.at += 60_000;
    t.vision.receive(MEETING, frame("screenshare", "SLIDE-TWO-BYTES"));
    await t.vision.idle(MEETING);
    // The same slide again, after the gap: nothing new to note.
    t.clock.at += 60_000;
    t.vision.receive(MEETING, frame("screenshare", "SLIDE-TWO-BYTES"));
    await t.vision.idle(MEETING);
    expect(t.looked.map((l) => l.image)).toEqual([
      "SLIDE-ONE-BYTES",
      "SLIDE-TWO-BYTES",
    ]);
  });

  it("notes nothing when the assistant was declined, or the screen is not worth it", async () => {
    const declined = harness({ declined: true });
    declined.vision.receive(MEETING, frame("screenshare", "A-SCREEN"));
    await declined.vision.idle(MEETING);
    expect(declined.looked).toEqual([]);
    expect(declined.observed).toEqual([]);
    const blank = harness({ worth: false });
    blank.vision.receive(MEETING, frame("screenshare", "A-BLANK-SCREEN"));
    await blank.vision.idle(MEETING);
    expect(blank.observed).toEqual([]);
  });

  it("accepts only its own signed websocket URL", () => {
    const t = harness();
    const url = t.vision.urlFor(MEETING);
    expect(url).toMatch(
      /^wss:\/\/q-api\.example\/v1\/integrations\/recall\/meeting-screen\?/,
    );
    expect(t.vision.verify(new URL(url ?? ""))).toBe(MEETING);
    const forged = new URL(url ?? "");
    forged.searchParams.set("meeting", "00000000-0000-4000-8000-000000000000");
    expect(t.vision.verify(forged)).toBeNull();
  });

  it("is off unless enabled", () => {
    const off = createMeetingScreenVision({
      enabled: false,
      publicBase: "https://q-api.example",
      secret: SECRET,
      store: {
        context: () => Promise.resolve(null),
        observe: () => Promise.resolve(),
      },
      noter: { note: () => Promise.resolve(null) },
    });
    expect(off.urlFor(MEETING)).toBeUndefined();
  });
});

describe("P5: the bot streams video only when Q may look", () => {
  const base = {
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    joinAt: null,
    botName: "Q (Capital Q notes)",
  };
  const hosting = {
    realtimeUrl: "https://q-api.example/v1/integrations/recall/meeting-host?x",
    aloneLeaveMs: 600_000,
    maxCallMs: 7_200_000,
    metadata: { meeting_id: MEETING },
  };
  it("adds the websocket, separate PNG video and the 4-core variant", () => {
    const body = botRequest({
      ...base,
      hosting: { ...hosting, visionUrl: "wss://q-api.example/ws?x" },
    });
    expect(body).toMatchObject({
      variant: { google_meet: "web_4_core" },
      recording_config: {
        video_separate_png: {},
        realtime_endpoints: [
          { type: "webhook" },
          {
            type: "websocket",
            url: "wss://q-api.example/ws?x",
            events: [...SCREEN_EVENTS],
          },
        ],
      },
    });
  });
  it("adds no video without it", () => {
    const body = botRequest({ ...base, hosting });
    expect(JSON.stringify(body)).not.toContain("video_separate");
    expect(JSON.stringify(body)).not.toContain("web_4_core");
  });
});

describe("the websocket receiver (RFC 6455, receive-only)", () => {
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise<void>((done) => server?.close(() => done()) ?? done());
    server = null;
  });

  async function listen(
    accept: Parameters<typeof attachWebSocketReceiver>[1]["accept"],
  ): Promise<string> {
    server = createServer((_req, res) => res.end());
    attachWebSocketReceiver(server, { path: MEETING_SCREEN_WS_PATH, accept });
    await new Promise<void>((done) => server?.listen(0, "127.0.0.1", done));
    const port = (server.address() as AddressInfo).port;
    return `ws://127.0.0.1:${String(port)}${MEETING_SCREEN_WS_PATH}`;
  }

  it("receives small and large text messages from a real client", async () => {
    const got: string[] = [];
    const url = await listen((u) =>
      u.searchParams.get("token") === "good"
        ? { message: (text) => got.push(text) }
        : null,
    );
    const big = "x".repeat(200_000);
    const client = new WebSocket(`${url}?token=good`);
    await new Promise<void>((done, fail) => {
      client.onopen = () => {
        client.send("hello");
        client.send(big);
        client.close();
      };
      client.onclose = () => done();
      client.onerror = () => fail(new Error("socket error"));
    });
    await new Promise((done) => setTimeout(done, 50));
    expect(got).toEqual(["hello", big]);
  });

  it("refuses a connection it does not accept", async () => {
    const url = await listen(() => null);
    const client = new WebSocket(`${url}?token=bad`);
    const opened = await new Promise<boolean>((done) => {
      client.onopen = () => done(true);
      client.onerror = () => done(false);
    });
    expect(opened).toBe(false);
  });
});
