import { describe, expect, it, vi } from "vitest";

const askQAction = vi.fn(() =>
  Promise.resolve({
    ok: true as const,
    value: { runId: "run-action", conversationId: undefined },
  }),
);
vi.mock("../src/features/q/actions", () => ({ askQAction }));

const { askQ, startedOf } = await import("../src/features/q/ask-route");

/**
 * V (K1, 2026-10-09): a typed question goes through /api/q-ask, not the
 * server-action queue it used to wait 1.6 s in behind /home's own actions;
 * the server action is only the fallback.
 */
describe("a typed question to Q is a route, not a queued server action", () => {
  it("posts the question as JSON to /api/q-ask and reads the started run", async () => {
    askQAction.mockClear();
    const doFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          ok: true,
          value: { runId: "run-route", conversationId: "c-1" },
        }),
      ),
    );
    const started = await askQ(
      "Show me three fintech companies",
      undefined,
      { investorOrganisationId: "dee698f0-0754-4803-8a98-5db4a88584fb" },
      "key-1",
      undefined,
      { route: "HOME" },
      undefined,
      doFetch,
    );
    expect(started).toEqual({
      ok: true,
      value: { runId: "run-route", conversationId: "c-1" },
    });
    expect(askQAction).not.toHaveBeenCalled();
    const [url, init] = doFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/q-ask");
    expect(init?.method).toBe("POST");
    const body = init?.body;
    expect(typeof body).toBe("string");
    expect(JSON.parse(typeof body === "string" ? body : "{}")).toMatchObject({
      question: "Show me three fintech companies",
      idempotencyKey: "key-1",
      screen: { route: "HOME" },
    });
  });

  it("falls back to the server action when the route is unreachable or unreadable, never losing the question", async () => {
    askQAction.mockClear();
    const down = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    expect(
      (
        await askQ(
          "q",
          undefined,
          undefined,
          "k",
          undefined,
          undefined,
          undefined,
          down,
        )
      ).ok,
    ).toBe(true);
    const odd = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ hello: 1 })),
    );
    await askQ(
      "q",
      undefined,
      undefined,
      "k",
      undefined,
      undefined,
      undefined,
      odd,
    );
    expect(askQAction).toHaveBeenCalledTimes(2);
  });

  it("reads a refusal as a refusal, and anything else as unreadable", () => {
    expect(startedOf({ ok: false, message: "No." })).toEqual({
      ok: false,
      message: "No.",
    });
    expect(startedOf({ ok: true, value: {} })).toBeNull();
    expect(startedOf(null)).toBeNull();
  });
});
