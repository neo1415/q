// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { QStreamEventSchema, type QStreamEvent } from "@capital-q/contracts";

/**
 * Batch 13 (owner, 8 Nov): Q expressed interest from the chat; the action
 * ran, but the page beside Q kept "Express interest". When a run resumed
 * after the person's yes completes, it has executed the approved action,
 * and the page is told its data changed (PageDataRefresher reads it again).
 * A run that completes without an approval announces nothing.
 */

const RUN = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";

const continueQRunAction =
  vi.fn<(...args: unknown[]) => Promise<{ ok: true; value: null }>>();
const askQAction = vi.fn((..._args: unknown[]) =>
  Promise.resolve({
    ok: true,
    value: { runId: RUN, conversationId: CONVERSATION },
  }),
);
let emit: ((event: QStreamEvent) => void) | null = null;

vi.mock("../src/features/q/actions", () => ({
  readQConversationAction: vi.fn(),
  pendingQApprovalsAction: () => Promise.resolve({ ok: true, value: [] }),
  listQConversationsAction: () =>
    Promise.resolve({ ok: true, value: { items: [] } }),
  askQAction: (...args: unknown[]) => askQAction(...args),
  continueQRunAction: (...args: unknown[]) => continueQRunAction(...args),
  cancelQRunAction: vi.fn(),
  approveQApprovalAction: () => Promise.resolve({ ok: true, value: null }),
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
        _run: unknown,
        handlers: { readonly onEvent: (event: QStreamEvent) => void },
      ) => {
        emit = handlers.onEvent;
        return new Promise(() => undefined);
      },
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
    occurredAt: "2026-09-27T10:00:00.000Z",
    type,
    data,
  });
}

const { PAGE_DATA_CHANGED_EVENT } =
  await import("../src/features/q/page-data-changed");

const handle: {
  ask: ((text: string) => Promise<void>) | null;
  approve: (() => Promise<void>) | null;
} = { ask: null, approve: null };

function Home() {
  const q = useQConversation({ conversationId: null });
  useEffect(() => {
    handle.ask = q.ask;
    handle.approve = q.approve;
  }, [q.ask, q.approve]);
  return <p data-testid="working">{String(q.working)}</p>;
}

describe("the page reads again after Q executes an approved action", () => {
  it("announces once, when the run resumed after the yes completes", async () => {
    const changed = vi.fn();
    window.addEventListener(PAGE_DATA_CHANGED_EVENT, changed);
    try {
      render(<Home />);
      await act(async () => {
        await handle.ask?.("Express interest in Harbourline Cargo");
      });
      await waitFor(() => {
        expect(emit).not.toBeNull();
      });
      act(() => {
        emit?.(
          event("q.run.started", {
            capability: "PREPARE_ACTION",
            status: "RECEIVED",
          }),
        );
        emit?.(
          event("q.approval.required", {
            proposalId: "123e4567-e89b-12d3-a456-426614174000",
            approvalId: "123e4567-e89b-12d3-a456-426614174001",
          }),
        );
      });
      expect(changed).not.toHaveBeenCalled();
      emit = null;
      await act(async () => {
        await handle.approve?.();
      });
      await waitFor(() => {
        expect(emit).not.toBeNull();
      });
      act(() => {
        emit?.(
          event("q.run.completed", {
            status: "COMPLETED",
            completedAt: "2026-09-27T10:00:05.000Z",
          }),
        );
      });
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(PAGE_DATA_CHANGED_EVENT, changed);
    }
  });

  it("a run that completes without an approval announces nothing", async () => {
    const changed = vi.fn();
    window.addEventListener(PAGE_DATA_CHANGED_EVENT, changed);
    try {
      emit = null;
      render(<Home />);
      await act(async () => {
        await handle.ask?.("How is my pipeline?");
      });
      await waitFor(() => {
        expect(emit).not.toBeNull();
      });
      act(() => {
        emit?.(
          event("q.run.started", { capability: "ANSWER", status: "RECEIVED" }),
        );
        emit?.(
          event("q.run.completed", {
            status: "COMPLETED",
            completedAt: "2026-09-27T10:00:05.000Z",
          }),
        );
      });
      expect(changed).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(PAGE_DATA_CHANGED_EVENT, changed);
    }
  });
});
