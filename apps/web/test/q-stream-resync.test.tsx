// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QStreamEventSchema, type QStreamEvent } from "@capital-q/contracts";

/**
 * A5 (audit D9/D10): an answer could vanish until a reload -- a frame over
 * the server's bound was skipped, one unknown kind or block dropped the
 * event, and nothing read the record at the end -- and a stream that gave
 * up left the composer on a run nobody followed, in silence. The record
 * is now read back when the stream could not carry the answer, a lost
 * stream says so and follows the same run again (never a new one), and a
 * completed answer shows exactly once.
 */

const RUN = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const MESSAGE = "123e4567-e89b-12d3-a456-426614174000";
const NOW = "2026-11-04T10:00:00.000Z";

type Handlers = {
  readonly onEvent: (event: QStreamEvent) => void;
  readonly onUnreadable?: (frame: unknown) => void;
};
type Result = {
  readonly reason: string;
  readonly lastEventId: number;
  readonly reconnects: number;
  readonly unreadable: number;
};

const streams: {
  run: string;
  handlers: Handlers;
  end: (result: Result) => void;
}[] = [];

const readQConversationAction = vi.fn();
const continueQRunAction = vi.fn();
const askQAction = vi.fn((..._args: unknown[]) =>
  Promise.resolve({
    ok: true,
    value: { runId: RUN, conversationId: CONVERSATION },
  }),
);

vi.mock("../src/features/q/actions", () => ({
  readQConversationAction: (...args: unknown[]) =>
    readQConversationAction(...args) as unknown,
  pendingQApprovalsAction: () => Promise.resolve({ ok: true, value: [] }),
  listQConversationsAction: () =>
    Promise.resolve({ ok: true, value: { items: [] } }),
  askQAction: (...args: unknown[]) => askQAction(...args),
  continueQRunAction: (...args: unknown[]) =>
    continueQRunAction(...args) as unknown,
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
      (_config: unknown, run: string, handlers: Handlers) =>
        new Promise<Result>((resolve) => {
          streams.push({ run, handlers, end: resolve });
        }),
    ),
  };
});

const { useQConversation } =
  await import("../src/features/q/use-q-conversation");

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

const answer = {
  messageId: MESSAGE,
  runId: RUN,
  role: "Q" as const,
  text: "Ledgerline's deck states a monthly net burn of about $39,000.",
  createdAt: NOW,
};

function recorded(status: string, messages: readonly unknown[]) {
  return {
    ok: true,
    value: {
      conversation: {
        conversationId: CONVERSATION,
        title: "Ledgerline",
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
  });
  return null;
}

const answersShown = () =>
  (handle.q?.state.messages ?? []).filter((m) => m.messageId === MESSAGE)
    .length;

async function asked() {
  render(<Surface />);
  // The surface's own open settles first (a person types after it shows).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await handle.q?.ask("What is Ledgerline's burn?");
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
  sequence = 0;
  handle.q = null;
  readQConversationAction.mockReset();
  continueQRunAction.mockReset();
  askQAction.mockClear();
});

describe("A5: the record is authoritative when the stream could not carry it", () => {
  it("a completed answer the stream carried renders exactly once, with no extra read", async () => {
    await asked();
    await act(async () => {
      streams[0]?.handlers.onEvent(
        event("q.message.completed", { message: answer }),
      );
      streams[0]?.handlers.onEvent(
        event("q.run.completed", { status: "COMPLETED", completedAt: NOW }),
      );
      streams[0]?.end({
        reason: "TERMINAL",
        lastEventId: sequence,
        reconnects: 0,
        unreadable: 0,
      });
      await Promise.resolve();
    });
    expect(answersShown()).toBe(1);
    expect(readQConversationAction).not.toHaveBeenCalled();
    expect(handle.q?.working).toBe(false);
  });

  it("an unknown kind or an oversized frame: the answer is read from the record, once", async () => {
    readQConversationAction.mockResolvedValue(
      recorded("COMPLETED", [
        {
          messageId: "123e4567-e89b-12d3-a456-426614174009",
          runId: RUN,
          role: "USER",
          text: "What is Ledgerline's burn?",
          createdAt: NOW,
        },
        answer,
      ]),
    );
    await asked();
    await act(async () => {
      // The completed message did not reach the client as an event.
      streams[0]?.handlers.onUnreadable?.({
        type: "q.message.completed",
        sequence: 2,
        durable: true,
      });
      streams[0]?.handlers.onEvent(
        event("q.run.completed", { status: "COMPLETED", completedAt: NOW }),
      );
      streams[0]?.end({
        reason: "TERMINAL",
        lastEventId: 3,
        reconnects: 0,
        unreadable: 1,
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(answersShown()).toBe(1);
    });
    expect(readQConversationAction).toHaveBeenCalledTimes(1);
    expect(readQConversationAction.mock.calls[0]?.[0]).toBe(CONVERSATION);
    // No new run, no second stream.
    expect(askQAction).toHaveBeenCalledTimes(1);
    expect(streams).toHaveLength(1);
  });

  it("after a reconnect the record is read, and an answer both carried is still shown once", async () => {
    readQConversationAction.mockResolvedValue(recorded("COMPLETED", [answer]));
    await asked();
    await act(async () => {
      streams[0]?.handlers.onEvent(
        event("q.message.completed", { message: answer }),
      );
      streams[0]?.handlers.onEvent(
        event("q.run.completed", { status: "COMPLETED", completedAt: NOW }),
      );
      streams[0]?.end({
        reason: "TERMINAL",
        lastEventId: sequence,
        reconnects: 1,
        unreadable: 0,
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(readQConversationAction).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(answersShown()).toBe(1);
  });
});

describe("A5: a stream that gave up is never a silent dead run", () => {
  it("still running: says so, and the next turn follows the same run again (no new run)", async () => {
    readQConversationAction.mockResolvedValue(recorded("RUNNING", []));
    continueQRunAction.mockResolvedValue({ ok: true, value: null });
    await asked();
    await act(async () => {
      streams[0]?.end({
        reason: "GAVE_UP",
        lastEventId: 1,
        reconnects: 20,
        unreadable: 0,
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(handle.q?.streamLost).toBe(true);
    });
    expect(handle.q?.notice).toMatch(
      /lost the connection while Q was answering/u,
    );
    expect(handle.q?.working).toBe(false);

    await act(async () => {
      await handle.q?.ask("Are you still there?");
    });
    // Appended to the run that is still going, and followed again.
    expect(continueQRunAction).toHaveBeenCalledWith(
      RUN,
      "Are you still there?",
    );
    expect(askQAction).toHaveBeenCalledTimes(1);
    expect(streams.map((s) => s.run)).toEqual([RUN, RUN]);
    expect(handle.q?.streamLost).toBe(false);
  });

  it("reconnect follows the lost run again", async () => {
    readQConversationAction.mockResolvedValue(recorded("RUNNING", []));
    await asked();
    await act(async () => {
      streams[0]?.end({
        reason: "GAVE_UP",
        lastEventId: 1,
        reconnects: 20,
        unreadable: 0,
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(handle.q?.streamLost).toBe(true);
    });
    act(() => {
      handle.q?.reconnect?.();
    });
    await waitFor(() => {
      expect(streams.map((s) => s.run)).toEqual([RUN, RUN]);
    });
    expect(handle.q?.notice).toBeNull();
  });

  it("finished meanwhile: its answer is shown from the record and the next question starts a new run", async () => {
    readQConversationAction.mockResolvedValue(recorded("COMPLETED", [answer]));
    await asked();
    await act(async () => {
      streams[0]?.end({
        reason: "GAVE_UP",
        lastEventId: 1,
        reconnects: 20,
        unreadable: 0,
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(answersShown()).toBe(1);
    });
    expect(handle.q?.streamLost).toBe(false);
    expect(handle.q?.notice).toBeNull();
    await act(async () => {
      await handle.q?.ask("And its runway?");
    });
    expect(continueQRunAction).not.toHaveBeenCalled();
    expect(askQAction).toHaveBeenCalledTimes(2);
  });

  it("failed meanwhile: says the answer could not be finished", async () => {
    readQConversationAction.mockResolvedValue(recorded("FAILED", []));
    await asked();
    await act(async () => {
      streams[0]?.end({
        reason: "GAVE_UP",
        lastEventId: 1,
        reconnects: 20,
        unreadable: 0,
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(handle.q?.notice).toBe(
        "Q couldn't finish that answer. Ask again to retry.",
      );
    });
  });
});
