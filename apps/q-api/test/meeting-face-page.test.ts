import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { MeetingFaceService } from "../src/composition/meeting-face.js";
import {
  createMeetingFacePageHub,
  meetingFacePageKey,
  type MeetingFacePageVoice,
} from "../src/composition/meeting-face-page.js";
import {
  qMeetingFacePagePath,
  registerMeetingFaceRoutes,
} from "../src/http/meeting-face.js";

/**
 * Owner decision 2026-10-21: the page Recall's note-taker shows as its
 * camera. No provider is reached: the face service is a stub.
 */

const MEETING = "00000000-0000-4000-8000-00000000f001";
const OTHER = "00000000-0000-4000-8000-00000000f002";
const SECRET = "test-secret-0123456789abcdef0123456789";

function hub(now = () => 0) {
  return createMeetingFacePageHub({
    secret: SECRET,
    publicBaseUrl: "https://q.example/",
    pagePath: qMeetingFacePagePath,
    now,
  });
}

describe("the meeting face page hub", () => {
  it("gives each meeting its own key, and refuses another meeting's", () => {
    const pages = hub();
    const url = new URL(pages.pageUrl(MEETING));
    expect(url.origin + url.pathname).toBe(
      `https://q.example/v1/q/meetings/face/page/${MEETING}`,
    );
    const key = url.searchParams.get("k") ?? "";
    expect(key).toBe(meetingFacePageKey(SECRET, MEETING));
    expect(pages.verify(MEETING, key)).toBe(true);
    expect(pages.verify(OTHER, key)).toBe(false);
    expect(pages.verify(MEETING, `${key}x`)).toBe(false);
    expect(pages.verify(MEETING, "")).toBe(false);
  });

  it("plays to an open page, and keeps a line briefly for a page reconnecting", () => {
    let clock = 0;
    const pages = hub(() => clock);
    const audio: MeetingFacePageVoice = { kind: "AUDIO", mp3Base64: "bXAz" };
    expect(pages.speak(MEETING, audio)).toBe(false);
    const heard: MeetingFacePageVoice[] = [];
    const stop = pages.listen(MEETING, (voice) => heard.push(voice));
    expect(heard).toEqual([audio]);
    expect(pages.speak(MEETING, { kind: "STOP" })).toBe(true);
    stop();
    pages.speak(MEETING, audio);
    clock = 9_000;
    const late: MeetingFacePageVoice[] = [];
    pages.listen(MEETING, (voice) => late.push(voice));
    // Stale: never said late.
    expect(late).toEqual([]);
  });
});

describe("the meeting face page routes", () => {
  function app(room: { url: string; token: string } | null) {
    const server = Fastify();
    const face: Pick<MeetingFaceService, "bridge" | "room"> = {
      bridge: () => Promise.resolve({ kind: "UNAUTHORISED" }),
      room: (meetingId: string) => (meetingId === MEETING ? room : null),
    };
    registerMeetingFaceRoutes(server, { face, page: hub() });
    return server;
  }
  const key = meetingFacePageKey(SECRET, MEETING);

  it("serves the page only with the meeting's key, never cached, under a strict policy", async () => {
    const server = app(null);
    const refused = await server.inject({
      method: "GET",
      url: `${qMeetingFacePagePath(MEETING)}?k=${meetingFacePageKey(SECRET, OTHER)}`,
    });
    expect(refused.statusCode).toBe(404);
    const page = await server.inject({
      method: "GET",
      url: `${qMeetingFacePagePath(MEETING)}?k=${key}`,
    });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toMatch(/^text\/html/u);
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["referrer-policy"]).toBe("no-referrer");
    const csp = String(page.headers["content-security-policy"]);
    const nonce = /'nonce-([^']+)'/u.exec(csp)?.[1] ?? "";
    expect(nonce.length).toBeGreaterThan(10);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(page.body).toContain(`nonce="${nonce}"`);
    expect(page.body).toContain(
      'integrity="sha384-qkOcWks7O6ZM0W8bDQRvE2Zigs/pWm7ioqYeangGqWoaqMEFUNeAKYLp8J+qWiUS"',
    );
    // Q's card, never a provider's name.
    expect(page.body).toContain("Capital Q");
    expect(page.body).not.toContain("PAL");
  });

  it("hands the room to the page only with the key, and null until the face is live", async () => {
    const waiting = await app(null).inject({
      method: "GET",
      url: `${qMeetingFacePagePath(MEETING)}/room?k=${key}`,
    });
    expect(waiting.json()).toEqual({ room: null });
    const live = app({ url: "https://tavus.daily.co/r1", token: "t1" });
    const ready = await live.inject({
      method: "GET",
      url: `${qMeetingFacePagePath(MEETING)}/room?k=${key}`,
    });
    expect(ready.json()).toEqual({
      room: { url: "https://tavus.daily.co/r1", token: "t1" },
    });
    expect(ready.headers["cache-control"]).toBe("no-store");
    const refused = await live.inject({
      method: "GET",
      url: `${qMeetingFacePagePath(MEETING)}/room`,
    });
    expect(refused.statusCode).toBe(404);
  });
});
