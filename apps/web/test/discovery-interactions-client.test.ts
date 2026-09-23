import { describe, expect, it } from "vitest";

import { type ApiSession } from "@capital-q/api-client";

import { apiFeedTransport } from "../src/features/discover/feed/api-feed-transport";

/**
 * Save, unsave and pass on the wire (CQ-WEB-021; CQ-REC-008).
 *
 * The controller was built against an injected port; this is the adapter
 * that port resolves to in the app, so what matters is that each intent
 * reaches its own contract path with a body the strict request schema
 * would accept -- and that the fields the server owns are absent.
 */

const COMPANY_ID = "00000001-0000-4000-8000-000000000000";
const SLATE_ID = "11111111-1111-4111-8111-111111111111";

type Recorded = {
  readonly method: string;
  readonly path: string;
  readonly search: string;
  readonly body: unknown;
  readonly authorization: string | null;
};

function sessionDouble(status = 200): {
  readonly session: ApiSession;
  readonly calls: Recorded[];
} {
  const calls: Recorded[] = [];

  const fetchDouble: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      search: url.search,
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : null,
      authorization: headers.get("authorization"),
    });

    if (status !== 200) {
      return Promise.resolve(
        new Response(JSON.stringify({ title: "Nope", status }), {
          status,
          headers: { "content-type": "application/problem+json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          recorded: true,
          deduplicated: false,
          state: { saved: url.pathname.endsWith("/save"), passed: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  };

  return {
    session: {
      baseUrl: "https://api.test",
      accessToken: "token",
      fetch: fetchDouble,
    },
    calls,
  };
}

describe("the feed transport", () => {
  it("sends each intent to its own path", async () => {
    const { session, calls } = sessionDouble();
    const transport = apiFeedTransport(session);

    for (const intent of ["SAVE", "UNSAVE", "PASS"] as const) {
      await transport.decide({
        companyId: COMPANY_ID,
        intent,
        slateId: SLATE_ID,
        clientEventId: "cq:test:0001",
      });
    }

    expect(calls.map((call) => call.path)).toEqual([
      `/v1/discovery/companies/${COMPANY_ID}/save`,
      `/v1/discovery/companies/${COMPANY_ID}/unsave`,
      `/v1/discovery/companies/${COMPANY_ID}/pass`,
    ]);
    expect(calls.every((call) => call.method === "POST")).toBe(true);
    expect(calls.every((call) => call.authorization === "Bearer token")).toBe(
      true,
    );
  });

  it("names the surface and the slate, and nothing the server owns", async () => {
    const { session, calls } = sessionDouble();

    await apiFeedTransport(session).decide({
      companyId: COMPANY_ID,
      intent: "SAVE",
      slateId: SLATE_ID,
      clientEventId: "cq:test:0001",
    });

    expect(calls[0]?.body).toEqual({
      clientEventId: "cq:test:0001",
      surface: "RECOMMENDATION_FEED",
      slateId: SLATE_ID,
    });
  });

  it("omits the slate rather than sending null when there is none", async () => {
    const { session, calls } = sessionDouble();

    await apiFeedTransport(session).decide({
      companyId: COMPANY_ID,
      intent: "PASS",
      slateId: null,
      clientEventId: "cq:test:0002",
    });

    const body = calls[0]?.body as Record<string, unknown>;
    expect("slateId" in body).toBe(false);
    // Doc 17 §67: no reason is demanded, so none is sent.
    expect("reason" in body).toBe(false);
  });

  it("returns the server's own saved/passed state", async () => {
    const { session } = sessionDouble();

    const recorded = await apiFeedTransport(session).decide({
      companyId: COMPANY_ID,
      intent: "SAVE",
      slateId: SLATE_ID,
      clientEventId: "cq:test:0003",
    });

    expect(recorded.recorded).toBe(true);
    expect(recorded.state).toEqual({ saved: true, passed: false });
  });

  it("rejects on a problem response, so the optimistic flag is reverted", async () => {
    const { session } = sessionDouble(409);

    await expect(
      apiFeedTransport(session).decide({
        companyId: COMPANY_ID,
        intent: "SAVE",
        slateId: SLATE_ID,
        clientEventId: "cq:test:0004",
      }),
    ).rejects.toThrow();
  });

  it("loads the slate by cursor, never by offset", async () => {
    const { session, calls } = sessionDouble();

    // The double answers the interaction shape, so the schema rejects it
    // here; the request is what this asserts.
    await apiFeedTransport(session)
      .loadSlate({ cursor: "cursor-2", signal: new AbortController().signal })
      .catch(() => undefined);

    expect(calls[0]?.path).toBe("/v1/discovery/companies");
    expect(calls[0]?.method).toBe("GET");

    const params = new URLSearchParams(calls[0]?.search ?? "");
    expect(params.get("cursor")).toBe("cursor-2");
    expect(params.get("offset")).toBeNull();
    expect(params.get("page")).toBeNull();
  });
});
