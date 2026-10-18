import { describe, expect, it } from "vitest";

import type { QAttentionReport } from "@capital-q/contracts";

import { createQApiAttentionReader } from "@/features/briefing/attention";

/**
 * RECOVERY-2026-10 B1: the arrival reads "what needs you" from the Q API
 * (GET /v1/q/attention) -- the same reader as Q's answer. A failure is
 * null, so the arrival falls back to its bridge; never an empty report.
 */

const SESSION = { baseUrl: "https://q.example.test", accessToken: "tok" };
const SINCE = "2026-10-07T12:00:00.000Z";

const REPORT: QAttentionReport = {
  items: [
    {
      key: "msg:1",
      source: "UNANSWERED_MESSAGE",
      title: "Zino Aviation Capital is waiting for your reply",
      since: "2026-10-07T15:43:00.000Z",
      decidable: true,
    },
  ],
  activity: null,
  unread: ["NOTICE"],
  readAt: "2026-10-08T12:00:00.000Z",
};

function fakeFetch(
  respond: () => Response | Promise<Response>,
  seen: { url?: string; auth?: string | null } = {},
): typeof fetch {
  return (input: URL | RequestInfo, init?: RequestInit) => {
    seen.url =
      input instanceof URL
        ? input.href
        : typeof input === "string"
          ? input
          : input.url;
    seen.auth = new Headers(init?.headers).get("authorization");
    return Promise.resolve(respond());
  };
}

describe("the arrival's attention reader", () => {
  it("reads the person's report with their session and since", async () => {
    const seen: { url?: string; auth?: string | null } = {};
    const read = createQApiAttentionReader(
      SESSION,
      fakeFetch(() => Response.json(REPORT), seen),
    );
    expect(await read(SINCE)).toEqual(REPORT);
    expect(seen.url).toBe(
      `https://q.example.test/v1/q/attention?since=${encodeURIComponent(SINCE)}`,
    );
    expect(seen.auth).toBe("Bearer tok");
  });

  it("is null, never an empty report, when the read fails or is malformed", async () => {
    for (const respond of [
      () => new Response("nope", { status: 503 }),
      () => Response.json({ items: [] }),
      () => Promise.reject(new Error("offline")),
    ]) {
      const read = createQApiAttentionReader(SESSION, fakeFetch(respond));
      expect(await read(SINCE)).toBeNull();
    }
    expect(await createQApiAttentionReader(null)(SINCE)).toBeNull();
  });
});
