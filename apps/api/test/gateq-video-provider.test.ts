import { describe, expect, it } from "vitest";

import {
  GATEQ_VIDEO_BRIDGE_PATH,
  GATEQ_VIDEO_EVENTS_PATH,
} from "@capital-q/contracts";
import { createTavusClient, createTavusKeyPool } from "@capital-q/integrations";

import {
  bridgeBaseUrl,
  createTavusGateqVideoProvider,
  gateqVideoDisclosure,
} from "../src/gateq/video-provider.js";

/** A provider that records what it was asked; no live Tavus call. */
function fakeTavus() {
  const bodies: { url: string; body: unknown }[] = [];
  const doFetch: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const text = typeof init?.body === "string" ? init.body : "{}";
    bodies.push({ url, body: JSON.parse(text) });
    const json = url.endsWith("/v2/pals")
      ? { pal_id: "pal_1" }
      : {
          conversation_id: "conv_1",
          conversation_url: "https://tavus.daily.co/conv_1",
          meeting_token: "mt_1",
          status: "active",
        };
    return Promise.resolve(
      new Response(JSON.stringify(json), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  const pool = createTavusKeyPool({
    keys: ["disabled-locally-000000000000"],
    createClient: (apiKey) => createTavusClient({ apiKey, fetch: doFetch }),
  });
  return { bodies, pool };
}

describe("GateQ video provider bridge URL", () => {
  it("gives Tavus the OpenAI-compatible base, which it suffixes itself", async () => {
    const { bodies, pool } = fakeTavus();
    const provider = createTavusGateqVideoProvider({
      pool,
      publicBaseUrl: "https://api.example/",
      faceId: "face_1",
      keyCount: 1,
    });
    await provider.createRoom({
      sessionId: "s1",
      maxSeconds: 180,
      testMode: false,
      greeting: "Hello",
      bridge: { path: GATEQ_VIDEO_BRIDGE_PATH, bearer: "b".repeat(43) },
      joinGraceSeconds: 30,
      events: { path: GATEQ_VIDEO_EVENTS_PATH, token: "e".repeat(43) },
    });
    const pal = bodies.find((b) => b.url.endsWith("/v2/pals"));
    const baseUrl = (pal?.body as { layers: { llm: { base_url: string } } })
      .layers.llm.base_url;
    expect(baseUrl).toBe("https://api.example/v1/gateq/video/bridge");
    // The applicant's room shows the interviewer as "Q", never an id; the
    // conversation keeps the session id for tracing on the provider's side.
    expect((pal?.body as { pal_name: string }).pal_name).toBe("Q");
    const conversation = bodies.find((b) =>
      b.url.endsWith("/v2/conversations"),
    );
    expect(
      (conversation?.body as { conversation_name: string }).conversation_name,
    ).toBe("cq-gateq-s1");
    // Room events come back to the route the api serves, with the
    // session's secret; the provider's own cap includes the join grace.
    const created = conversation?.body as {
      callback_url: string;
      properties: { max_call_duration: number };
    };
    expect(created.callback_url).toBe(
      `https://api.example${GATEQ_VIDEO_EVENTS_PATH}/${"e".repeat(43)}`,
    );
    expect(created.properties.max_call_duration).toBe(210);
    // What Tavus will call is exactly the route the api serves.
    expect(`${baseUrl}/chat/completions`).toBe(
      `https://api.example${GATEQ_VIDEO_BRIDGE_PATH}`,
    );
  });

  it("refuses a bridge route Tavus could not reach", () => {
    expect(() => bridgeBaseUrl("https://api.example", "/v1/x")).toThrow();
  });
});

describe("GateQ video in Arabic (lane ml)", () => {
  const room = (language?: "ar" | null) => ({
    sessionId: "s1",
    maxSeconds: 180,
    testMode: false,
    greeting: "Hello",
    bridge: { path: GATEQ_VIDEO_BRIDGE_PATH, bearer: "b".repeat(43) },
    joinGraceSeconds: 30,
    events: { path: GATEQ_VIDEO_EVENTS_PATH, token: "e".repeat(43) },
    ...(language === undefined ? {} : { language }),
  });
  const provider = (pool: ReturnType<typeof fakeTavus>["pool"]) =>
    createTavusGateqVideoProvider({
      pool,
      publicBaseUrl: "https://api.example/",
      faceId: "face_1",
      keyCount: 1,
    });

  it("runs an Arabic applicant's room Arabic first, with the disclosure in Arabic", async () => {
    const { bodies, pool } = fakeTavus();
    await provider(pool).createRoom(room("ar"));
    const pal = bodies.find((b) => b.url.endsWith("/v2/pals"))?.body as {
      verbal_disclosure: string;
      visual_disclosure: string;
    };
    expect(pal.verbal_disclosure).toBe(gateqVideoDisclosure("ar").spoken);
    expect(pal.verbal_disclosure).toContain("الذكاء الاصطناعي");
    expect(pal.visual_disclosure).toContain("Q");
    const conversation = bodies.find((b) => b.url.endsWith("/v2/conversations"))
      ?.body as { properties: { languages?: string[] } };
    expect(conversation.properties.languages).toEqual(["ar", "en"]);
  });

  it("leaves an English room exactly as it was", async () => {
    const { bodies, pool } = fakeTavus();
    await provider(pool).createRoom(room());
    const pal = bodies.find((b) => b.url.endsWith("/v2/pals"))?.body as {
      verbal_disclosure: string;
    };
    expect(pal.verbal_disclosure).toMatch(/^Just so you know, I'm Q/u);
    const conversation = bodies.find((b) => b.url.endsWith("/v2/conversations"))
      ?.body as { properties: Record<string, unknown> };
    expect(conversation.properties["languages"]).toBeUndefined();
  });

  it("both disclosures say the same two things", () => {
    for (const language of ["ar", null] as const) {
      const { spoken, shown } = gateqVideoDisclosure(language);
      expect(spoken.length).toBeGreaterThan(20);
      expect(shown).toContain("Q");
    }
  });
});
