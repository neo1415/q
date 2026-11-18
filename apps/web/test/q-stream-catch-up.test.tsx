// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QStreamEventSchema, type QStreamEvent } from "@capital-q/contracts";

/**
 * Decision 106 (owner, 2026-11-18): "it can take like 5 minutes before it
 * responds". Live, GateQ runs wrote Q's answer in 8 s (p50), 23 s (p95),
 * 30 s (max), but the dock showed it only when the event stream's bounded
 * reconnects (up to 20, 15 s apart, about four minutes) ran out and the
 * record was read. Now the record is read as soon as the stream has to
 * reconnect, or after a few silent seconds, and a finished run stops the
 * wait. The order is asserted: ask, stream drops, record read, answer
 * shown, Q no longer "working", all before the stream would give up.
 */

const RUN = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const MESSAGE = "123e4567-e89b-12d3-a456-426614174000";
const NOW = "2026-11-18T10:00:00.000Z";

type Handlers = {
  readonly onEvent: (event: QStreamEvent) => void;
  readonly onStatus?: (status: string, attempt: number) => void;
};
type Result = {
  readonly reason: string;
  readonly lastEventId: number;
  readonly reconnects: number;
  readonly unreadable: number;
};

const order: string[] = [];
const streams: {
  handlers: Handlers;
  signal: AbortSignal | undefined;
  end: (result: Result) => void;
}[] = [];

const readQConversationAction = vi.fn();
const askQAction = vi.fn((..._args: unknown[]) =>
  Promise.resolve({
    ok: true,
    value: { runId: RUN, conversationId: CONVERSATION },
  }),
);

vi.mock("../src/features/q/actions", () => ({
  readQConversationAction: (...args: unknown[]) => {
    order.push("record read");
    return readQConversationAction(...args) as unknown;
  },
  pendingQApprovalsAction: () => Promise.resolve({ ok: true, value: [] }),
  listQConversationsAction: () =>
    Promise.resolve({ ok: true, value: { items: [] } }),
  askQAction: (...args: unknown[]) => {
    order.push("asked");
    return askQAction(...args);
  },
  continueQRunAction: vi.fn(),
  cancelQRunAction: vi.fn(),
  approveQApprovalAction: vi.fn(),
  rejectQApprovalAction: vi.fn(),
}));
vi.mock("@capital-q/api-client", async () => {
  const actual = await vi.importActual<typeof import("@capital-q/api-client")>(
    "@capital-q/api-client",
  );
  return {
    ...actual,
    streamQRunEvents: vi.fn(
      (
        _config: unknown,
        _run: string,
        handlers: Handlers & { readonly signal?: AbortSignal },
      ) =>
        new Promise<Result>((resolve) => {
          streams.push({ handlers, signal: handlers.signal, end: resolve });
          handlers.signal?.addEventListener("abort", () => {
            order.push("stream stopped");
            resolve({
              reason: "ABORTED",
              lastEventId: 0,
              reconnects: 0,
              unreadable: 0,
            });
          });
        }),
    ),
  };
});

const { useQConversation } =
  await import("../src/features/q/use-q-conversation");

const answer = {
  messageId: MESSAGE,
  runId: RUN,
  role: "Q" as const,
  text: "Kazikit (fictional) has 40 paying customers, as they stated.",
  createdAt: NOW,
};

function recorded(status: string, messages: readonly unknown[]) {
  return {
    ok: true,
    value: {
      conversation: {
        conversationId: CONVERSATION,
        title: "Kazikit",
        subjects: [],
        createdAt: NOW,
        lastMessageAt: NOW,
      },
      messages,
      latestRun: {
        runId: RUN,
        conversationId: CONVERSATION,
        status,
        createdAt: NOW,
      },
    },
  };
}

type View = ReturnType<typeof useQConversation>;
const handle: { q: View | null } = { q: null };

function Surface() {
  const q = useQConversation({ conversationId: null });
  useEffect(() => {
    handle.q = q;
    if ((q.state.messages ?? []).some((m) => m.messageId === MESSAGE)) {
      if (!order.includes("answer shown")) order.push("answer shown");
    }
  });
  return null;
}

let sequence = 0;
function event(type: QStreamEvent["type"], data: Record<string, unknown>) {
  sequence += 1;
  return QStreamEventSchema.parse({
    contractVersion: 1,
    eventId: `${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
    runId: RUN,
    sequence,
    occurredAt: NOW,
    type,
    data,
  });
}

async function asked() {
  render(<Surface />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await handle.q?.ask("How many paying customers does Kazikit have?");
  });
  await waitFor(() => {
    expect(streams).toHaveLength(1);
  });
  act(() => {
    streams[0]?.handlers.onEvent(
      event("q.run.started", { capability: "ANSWER", status: "RECEIVED" }),
    );
  });
}

beforeEach(() => {
  streams.length = 0;
  order.length = 0;
  sequence = 0;
  handle.q = null;
  readQConversationAction.mockReset();
  askQAction.mockClear();
});

describe("decision 106: a reply never waits on a stalled stream", () => {
  it("reads the record as soon as the stream reconnects, shows the answer and stops waiting", async () => {
    readQConversationAction.mockResolvedValue(recorded("COMPLETED", [answer]));
    await asked();
    const started = Date.now();
    await act(async () => {
      order.push("stream reconnecting");
      streams[0]?.handlers.onStatus?.("RECONNECTING", 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(handle.q?.working).toBe(false);
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(
      (handle.q?.state.messages ?? []).filter((m) => m.messageId === MESSAGE),
    ).toHaveLength(1);
    expect(order).toEqual([
      "asked",
      "stream reconnecting",
      "record read",
      "stream stopped",
      "answer shown",
    ]);
  });

  it("a run still answering keeps its stream: nothing is cut short", async () => {
    readQConversationAction.mockResolvedValue(recorded("RUNNING", []));
    await asked();
    await act(async () => {
      streams[0]?.handlers.onStatus?.("RECONNECTING", 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(readQConversationAction).toHaveBeenCalledTimes(1);
    expect(order).not.toContain("stream stopped");
    expect(handle.q?.working).toBe(true);
    // A burst of reconnects reads the record once, not once each.
    await act(async () => {
      streams[0]?.handlers.onStatus?.("RECONNECTING", 2);
      streams[0]?.handlers.onStatus?.("RECONNECTING", 3);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(readQConversationAction).toHaveBeenCalledTimes(1);
  });

  it("a stream that connects and stays silent is caught up within seconds", async () => {
    readQConversationAction.mockResolvedValue(recorded("COMPLETED", [answer]));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await asked();
      expect(readQConversationAction).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      await waitFor(() => {
        expect(handle.q?.working).toBe(false);
      });
      expect(readQConversationAction).toHaveBeenCalledTimes(1);
      expect(
        (handle.q?.state.messages ?? []).filter((m) => m.messageId === MESSAGE),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
