// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { QStreamEventSchema, type QStreamEvent } from "@capital-q/contracts";

/**
 * Acceptance 2026-11-04 J4: an "okay" typed while Q was still working
 * (a plan being drafted) vanished. Words typed while Q is busy wait on
 * screen as theirs and are asked the moment Q is free; never dropped.
 */

const RUN = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6c";
const CONVERSATION = "c0000000-0000-4000-8000-000000000002";

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
    occurredAt: "2026-11-04T10:00:00.000Z",
    type,
    data,
  });
}

const handle: { ask: ((text: string) => Promise<void>) | null } = {
  ask: null,
};

function Home() {
  const q = useQConversation({ conversationId: null });
  useEffect(() => {
    handle.ask = q.ask;
  }, [q.ask]);
  return (
    <>
      <p data-testid="working">{String(q.working)}</p>
      <ul>
        {q.pending.map((turn) => (
          <li key={turn.id} data-testid="pending">
            {turn.text}
          </li>
        ))}
      </ul>
    </>
  );
}

describe("words typed while Q is working", () => {
  it("wait on screen and are asked once the run is done", async () => {
    render(<Home />);
    await act(async () => {
      await handle.ask?.("Make me a plan to follow up this week");
    });
    await waitFor(() => {
      expect(emit).not.toBeNull();
    });
    act(() => {
      emit?.(
        event("q.run.started", { capability: "ANSWER", status: "RECEIVED" }),
      );
    });
    expect(screen.getByTestId("working").textContent).toBe("true");

    await act(async () => {
      await handle.ask?.("okay");
    });
    // Not sent yet (Q is busy) but not lost: it is on screen as theirs.
    expect(askQAction.mock.calls.some((call) => call[0] === "okay")).toBe(
      false,
    );
    expect(
      screen.getAllByTestId("pending").map((item) => item.textContent),
    ).toContain("okay");

    act(() => {
      emit?.(
        event("q.run.completed", {
          status: "COMPLETED",
          completedAt: "2026-11-04T10:00:05.000Z",
        }),
      );
    });
    await waitFor(() => {
      expect(askQAction.mock.calls.some((call) => call[0] === "okay")).toBe(
        true,
      );
    });
    const reply = askQAction.mock.calls.find((call) => call[0] === "okay");
    expect(reply?.[1]).toBe(CONVERSATION);
    // Shown once, never twice.
    expect(
      screen
        .queryAllByTestId("pending")
        .filter((item) => item.textContent === "okay"),
    ).toHaveLength(1);
  });
});
