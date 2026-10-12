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
