// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { discoverCompanies, type ApiSession } from "@capital-q/api-client";
import {
  DISCOVERY_COMPANIES_PATH,
  DISCOVERY_COMPANY_PASS_PATH,
  DISCOVERY_COMPANY_SAVE_PATH,
  DISCOVERY_COMPANY_UNSAVE_PATH,
  InteractionRecordedDtoSchema,
  type DiscoveredCompanyDto,
  type InteractionRecordedDto,
} from "@capital-q/contracts";

import type { FeedPositionStore } from "../src/features/discover/feed/feed-position";
import type { FeedTransport } from "../src/features/discover/feed/feed-transport";
import { useInvestorFeed } from "../src/features/discover/feed/use-investor-feed";

/**
 * The controller against the real endpoint (CQ-WEB-020).
 *
 * The reducer suite proves the rules; this proves the hook is wired to
 * them, and that the wire it is wired through is the discovery contract
 * and not a shape invented for the test. The slate arrives through the
 * real `discoverCompanies` client, so the response is parsed by the
 * contract's own schema -- a body the server could not send would fail
 * here rather than quietly becoming state.
 *
 * The double is `fetch`, injected into the session rather than stubbed
 * globally.
 */

const SLATE_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Real UUIDs, because the contract schema is doing real work here: a
 * `companyId` that is not one is rejected by `DiscoveredCompanyDtoSchema`
 * before it can reach the reducer.
 */
function companyId(n: number): string {
  return `0000000${n}-0000-4000-8000-000000000000`;
}

function company(n: number): DiscoveredCompanyDto {
  return {
    companyId: companyId(n),
    canonicalName: `Company ${n}`,
    websiteUrl: null,
    headquartersCountry: null,
    currentStageCode: null,
    shortDescription: null,
    reasons: [],
    reasonCodes: [],
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

type Call = { readonly method: string; readonly path: string };

/**
 * A fetch double that answers the two real discovery routes.
 *
 * Page one carries a cursor; page two does not. Save and pass answer with
 * the contract's `InteractionRecordedDto`, and `failDecisions` makes the
 * write reject so the optimistic revert can be observed.
 */
function apiDouble(options: { readonly failDecisions?: boolean } = {}): {
  readonly session: ApiSession;
  readonly calls: readonly Call[];
} {
  const calls: Call[] = [];

  const fetchDouble: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname });

    if (url.pathname === DISCOVERY_COMPANIES_PATH) {
      const cursor = url.searchParams.get("cursor");
      return Promise.resolve(
        jsonResponse(
          cursor === null
            ? {
                slateId: SLATE_ID,
                rankingVersion: "declared.v1",
                items: [company(1), company(2)],
                notes: [],
                nextCursor: "cursor-2",
              }
            : {
                slateId: SLATE_ID,
                rankingVersion: "declared.v1",
                items: [company(2), company(3), company(4)],
                notes: [],
                nextCursor: null,
              },
        ),
      );
    }

    if (options.failDecisions === true) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Conflict",
            status: 409,
          }),
          {
            status: 409,
            headers: { "content-type": "application/problem+json" },
          },
        ),
      );
    }

    const saved = url.pathname.endsWith("/save");
    return Promise.resolve(
      jsonResponse({
        recorded: true,
        deduplicated: false,
        state: { saved, passed: url.pathname.endsWith("/pass") },
      }),
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

function transportFor(session: ApiSession): FeedTransport {
  return {
    // The generated client takes no signal; the hook's own abort scope is
    // what stops a late response from becoming state.
    loadSlate: ({ cursor }) =>
      discoverCompanies(session, cursor === undefined ? {} : { cursor }),
    decide: async (input): Promise<InteractionRecordedDto> => {
      const template =
        input.intent === "SAVE"
          ? DISCOVERY_COMPANY_SAVE_PATH
          : input.intent === "UNSAVE"
            ? DISCOVERY_COMPANY_UNSAVE_PATH
            : DISCOVERY_COMPANY_PASS_PATH;
      const path = template.replace(":companyId", input.companyId);

      const response = await (session.fetch ?? fetch)(
        `${session.baseUrl}${path}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clientEventId: input.clientEventId,
            surface: "RECOMMENDATION_FEED",
            slateId: SLATE_ID,
          }),
        },
      );
      if (!response.ok) throw new Error("rejected");
      return InteractionRecordedDtoSchema.parse(await response.json());
    },
  };
}

function memoryStore(seed: Record<string, string> = {}): FeedPositionStore {
  const held = new Map(Object.entries(seed));
  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
  };
}

let eventIds = 0;
const newClientEventId = () => `cq:test:${String(++eventIds).padStart(4, "0")}`;

beforeEach(() => {
  eventIds = 0;
});

describe("the feed controller over the discovery endpoint", () => {
  it("loads the first page and hands the card and its window to the caller", async () => {
    const { session, calls } = apiDouble();
    const { result } = renderHook(() =>
      useInvestorFeed({
        transport: transportFor(session),
        positionStore: memoryStore(),
        newClientEventId,
      }),
    );

    await waitFor(() => expect(result.current.card).not.toBeNull());

    expect(calls[0]).toEqual({ method: "GET", path: DISCOVERY_COMPANIES_PATH });
    expect(result.current.state.slateId).toBe(SLATE_ID);
    expect(result.current.card?.companyId).toBe(companyId(1));
    expect(result.current.activeCompanyId).toBe(companyId(1));
    expect(result.current.prefetch.active).toBe(companyId(1));
    expect(result.current.prefetch.policyByCompanyId[companyId(1)]).toBe(
      "ACTIVE",
    );
  });

  it("follows the cursor and appends the next page without duplicating", async () => {
    const { session, calls } = apiDouble();
    const { result } = renderHook(() =>
      useInvestorFeed({
        transport: transportFor(session),
        positionStore: memoryStore(),
        newClientEventId,
      }),
    );

    await waitFor(() => expect(result.current.state.items).toHaveLength(4));

    // c-2 came back on both pages and appears once.
    expect(result.current.state.items.map((item) => item.companyId)).toEqual([
      companyId(1),
      companyId(2),
      companyId(3),
      companyId(4),
    ]);
    expect(
      calls.filter((call) => call.path === DISCOVERY_COMPANIES_PATH),
    ).toHaveLength(2);
  });

  it("makes no request at all when the reader moves between cards", async () => {
    const { session, calls } = apiDouble();
    const { result } = renderHook(() =>
      useInvestorFeed({
        transport: transportFor(session),
        positionStore: memoryStore(),
        newClientEventId,
      }),
    );

    await waitFor(() => expect(result.current.state.items).toHaveLength(4));
    const settled = calls.length;

    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.previous());

    expect(result.current.activeCompanyId).toBe(companyId(2));
    // Viewing is not interest: no impression, no Q call, no beacon.
    expect(calls).toHaveLength(settled);
  });

  it("shows a save at once and then takes the server's answer", async () => {
    const { session, calls } = apiDouble();
    const { result } = renderHook(() =>
      useInvestorFeed({
        transport: transportFor(session),
        positionStore: memoryStore(),
        newClientEventId,
      }),
    );
    await waitFor(() => expect(result.current.card).not.toBeNull());

    act(() => result.current.save(companyId(1)));
    // Optimistic, in the same tick the person clicked.
    expect(result.current.decisionFor(companyId(1)).saved).toBe(true);

    await waitFor(() =>
      expect(result.current.isDeciding(companyId(1))).toBe(false),
    );
    expect(result.current.decisionFor(companyId(1)).saved).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.method === "POST" &&
          call.path === `/v1/discovery/companies/${companyId(1)}/save`,
      ),
    ).toBe(true);
  });

  it("puts a rejected save back, rather than leaving a card looking saved", async () => {
    const { session } = apiDouble({ failDecisions: true });
    const { result } = renderHook(() =>
      useInvestorFeed({
        transport: transportFor(session),
        positionStore: memoryStore(),
        newClientEventId,
      }),
    );
    await waitFor(() => expect(result.current.card).not.toBeNull());

    act(() => result.current.save(companyId(1)));
    expect(result.current.decisionFor(companyId(1)).saved).toBe(true);

    await waitFor(() =>
      expect(result.current.isDeciding(companyId(1))).toBe(false),
    );
    expect(result.current.decisionFor(companyId(1)).saved).toBe(false);
  });

  it("remembers the card and comes back to it, not to the top of the slate", async () => {
    const store = memoryStore();

    const first = renderHook(() =>
      useInvestorFeed({
        transport: transportFor(apiDouble().session),
        positionStore: store,
        newClientEventId,
      }),
    );
    await waitFor(() =>
      expect(first.result.current.state.items).toHaveLength(4),
    );
    act(() => first.result.current.next());
    act(() => first.result.current.next());
    await waitFor(() =>
      expect(first.result.current.activeCompanyId).toBe(companyId(3)),
    );
    first.unmount();

    // A fresh mount, as a Back from the company profile produces.
    const second = renderHook(() =>
      useInvestorFeed({
        transport: transportFor(apiDouble().session),
        positionStore: store,
        newClientEventId,
      }),
    );

    await waitFor(() =>
      expect(second.result.current.activeCompanyId).toBe(companyId(3)),
    );
    expect(second.result.current.prefetch.active).toBe(companyId(3));
  });

  it("ignores a remembered position belonging to a different slate", async () => {
    const store = memoryStore({
      "cq.discover.feed.position": JSON.stringify({
        slateId: "99999999-9999-4999-8999-999999999999",
        companyId: companyId(3),
      }),
    });
    const { result } = renderHook(() =>
      useInvestorFeed({
        transport: transportFor(apiDouble().session),
        positionStore: store,
        newClientEventId,
      }),
    );

    await waitFor(() => expect(result.current.state.items).toHaveLength(4));
    expect(result.current.activeCompanyId).toBe(companyId(1));
  });

  it("survives a browser that refuses storage", async () => {
    const hostile: FeedPositionStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const { result } = renderHook(() =>
      useInvestorFeed({
        transport: transportFor(apiDouble().session),
        positionStore: hostile,
        newClientEventId,
      }),
    );

    await waitFor(() => expect(result.current.card).not.toBeNull());
    expect(result.current.activeCompanyId).toBe(companyId(1));
  });

  it("runs with persistence switched off entirely", async () => {
    const { session } = apiDouble();
    const { result } = renderHook(() =>
      useInvestorFeed({
        transport: transportFor(session),
        positionStore: null,
        newClientEventId,
      }),
    );

    await waitFor(() => expect(result.current.state.items).toHaveLength(4));
    act(() => result.current.next());

    expect(result.current.activeCompanyId).toBe(companyId(2));
  });
});
