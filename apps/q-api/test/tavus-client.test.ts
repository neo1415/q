import { describe, expect, it, vi } from "vitest";

import {
  createTavusClient,
  TavusError,
} from "../src/composition/tavus/client.js";

/** ADR 0066: the Tavus adapter speaks the documented API with one server-side key. */

function fakeFetch(status: number, body: unknown) {
  return vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response(body === null ? "" : JSON.stringify(body), { status }),
    ),
  );
}

describe("the Tavus adapter", () => {
  it("creates a conversation capped at the live limit, with captions, never more", async () => {
    const fetch = fakeFetch(200, {
      conversation_id: "c123",
      conversation_url: "https://tavus.daily.co/c123",
      status: "active",
    });
    const client = createTavusClient({ apiKey: "k-secret", fetch });
    const made = await client.createConversation({
      palId: "p1",
      faceId: "r1",
      name: "Rehearsal",
      callbackUrl: null,
      greeting: null,
      context: null,
      maxCallSeconds: 180,
      testMode: true,
    });
    expect(made).toEqual({
      conversationId: "c123",
      conversationUrl: "https://tavus.daily.co/c123",
      status: "active",
      meetingToken: null,
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://tavusapi.com/v2/conversations");
    const sent = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({
      pal_id: "p1",
      face_id: "r1",
      test_mode: true,
      properties: { max_call_duration: 180, enable_closed_captions: true },
    });
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe(
      "k-secret",
    );
  });

  it("creates a PAL with the verified contract: default_face_id, our LLM, disclosure", async () => {
    const fetch = fakeFetch(200, { pal_id: "p9abc" });
    const made = await createTavusClient({ apiKey: "k", fetch }).createPal({
      name: "cq",
      systemPrompt: "Speak the lines you are given.",
      faceId: "r1",
      disclosure: { spoken: "This is an AI rehearsal.", shown: "AI rehearsal" },
      layers: {
        llm: {
          model: "capital-q-rehearsal",
          base_url: "https://q.example/v1/q/rehearsals/video/bridge/s1",
          api_key: "session-bearer",
          speculative_inference: false,
        },
      },
    });
    expect(made).toEqual({ palId: "p9abc" });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://tavusapi.com/v2/pals");
    const sent = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({
      pipeline_mode: "full",
      default_face_id: "r1",
      disclosure_type: "always",
      verbal_disclosure: "This is an AI rehearsal.",
      layers: { llm: { speculative_inference: false } },
    });
    expect(sent).not.toHaveProperty("face_id");
  });

  it("asks for a private two-person room and returns its join token", async () => {
    const fetch = fakeFetch(200, {
      conversation_id: "c1",
      conversation_url: "https://tavus.daily.co/c1",
      status: "active",
      meeting_token: "jwt",
    });
    const made = await createTavusClient({
      apiKey: "k",
      fetch,
    }).createConversation({
      palId: "p1",
      faceId: "r1",
      name: "Rehearsal",
      callbackUrl: null,
      greeting: "Hello",
      context: null,
      maxCallSeconds: 180,
      testMode: false,
      requireAuth: true,
    });
    expect(made.meetingToken).toBe("jwt");
    const sent = JSON.parse(
      (fetch.mock.calls[0]?.[1]?.body as string | undefined) ?? "{}",
    ) as Record<string, unknown>;
    expect(sent).toMatchObject({
      require_auth: true,
      max_participants: 2,
      custom_greeting: "Hello",
    });
  });

  it("classifies a concurrency refusal as QUOTA without echoing the body", async () => {
    const fetch = fakeFetch(400, {
      message: "User has reached maximum concurrent conversations",
    });
    const failed = await createTavusClient({ apiKey: "k", fetch })
      .endConversation("c1")
      .catch((error: unknown) => error);
    expect((failed as TavusError).kind).toBe("QUOTA");
    expect(String(failed)).not.toContain("concurrent");
  });

  it("ends a conversation through the documented endpoint", async () => {
    const fetch = fakeFetch(200, null);
    await createTavusClient({ apiKey: "k", fetch }).endConversation("c/1");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://tavusapi.com/v2/conversations/c%2F1/end");
    expect(init?.method).toBe("POST");
  });

  it.each([0, -1, 181, 180.5, NaN, Infinity])(
    "refuses an invalid %s-second duration before a paid provider request",
    async (maxCallSeconds) => {
      const fetch = fakeFetch(200, null);
      const client = createTavusClient({ apiKey: "k-secret", fetch });
      await expect(
        client.createConversation({
          palId: "p1",
          faceId: "r1",
          name: "Rehearsal",
          callbackUrl: null,
          greeting: null,
          context: null,
          maxCallSeconds,
          testMode: true,
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("adds at most a 30 s join grace to the provider's own cap", async () => {
    const fetch = fakeFetch(200, {
      conversation_id: "c1",
      conversation_url: "https://tavus.daily.co/c1",
      status: "active",
    });
    const client = createTavusClient({ apiKey: "k", fetch });
    const base = {
      palId: "p1",
      faceId: "r1",
      name: "GateQ",
      callbackUrl: null,
      greeting: null,
      context: null,
      maxCallSeconds: 180,
      testMode: true,
    };
    await client
      .createConversation({ ...base, joinGraceSeconds: 30 })
      .catch(() => undefined);
    const [, init] = fetch.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      properties: { max_call_duration: number };
    };
    expect(body.properties.max_call_duration).toBe(210);
    for (const joinGraceSeconds of [31, -1, 1.5])
      await expect(
        client.createConversation({ ...base, joinGraceSeconds }),
      ).rejects.toMatchObject({ status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails with the status only, never the provider's body", async () => {
    const fetch = fakeFetch(429, { message: "secret details k-secret" });
    const failed = await createTavusClient({ apiKey: "k-secret", fetch })
      .endConversation("c1")
      .catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(TavusError);
    expect(String(failed)).not.toContain("k-secret");
    expect((failed as TavusError).status).toBe(429);
  });
});

it("recovers only the recorded PAL's conversations from the same account", async () => {
  const fetch = fakeFetch(200, {
    data: [
      { conversation_id: "ours", pal_id: "pal0", status: "active" },
      { conversation_id: "unrelated", pal_id: "other", status: "active" },
    ],
    total_count: 2,
  });
  const client = createTavusClient({
    apiKey: "disabled-locally-000000000000",
    fetch,
  });
  expect(await client.findConversationsForPal("pal0")).toEqual([
    { conversationId: "ours", conversationUrl: null, status: "active" },
  ]);
  expect(fetch.mock.calls[0]?.[0]).toBe(
    "https://tavusapi.com/v2/conversations?limit=100&page=1",
  );
});

it("fails closed when a recovery inventory exceeds its safe scan bound", async () => {
  const fetch = fakeFetch(200, { data: [], total_count: 2001 });
  await expect(
    createTavusClient({
      apiKey: "disabled-locally-000000000000",
      fetch,
    }).findConversationsForPal("pal0"),
  ).rejects.toThrow(TavusError);
});
