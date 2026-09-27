// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { QStreamEventSchema, type QStreamEvent } from "@capital-q/contracts";

/**
 * R30 #6: Q says "tap Approve on the card, or tell me to go ahead", so a
 * run paused on the person's approval is waiting for them, not working:
 * the composer stays usable and what they type is the run's next turn.
 */

const RUN = "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b";
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";

const continueQRunAction =
  vi.fn<(...args: unknown[]) => Promise<{ ok: true; value: null }>>();
let emit: ((event: QStreamEvent) => void) | null = null;

vi.mock("../src/features/q/actions", () => ({
  readQConversationAction: vi.fn(),
  askQAction: vi.fn(() =>
    Promise.resolve({
      ok: true,
      value: { runId: RUN, conversationId: CONVERSATION },
    }),
  ),
  continueQRunAction: (...args: unknown[]) => continueQRunAction(...args),
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
    occurredAt: "2026-09-27T10:00:00.000Z",
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
  return <p data-testid="working">{String(q.working)}</p>;
}

describe("typed approval while a change waits", () => {
  it("is not 'working' while waiting, and a typed reply continues the run", async () => {
    render(<Home />);
    await act(async () => {
      await handle.ask?.("Change my headline to: Credit for Lagos traders");
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
    });
    expect(screen.getByTestId("working").textContent).toBe("true");
    act(() => {
      emit?.(
        event("q.approval.required", {
          proposalId: "123e4567-e89b-12d3-a456-426614174000",
          approvalId: "123e4567-e89b-12d3-a456-426614174001",
        }),
      );
    });
    expect(screen.getByTestId("working").textContent).toBe("false");

    continueQRunAction.mockResolvedValue({ ok: true, value: null });
    await act(async () => {
      await handle.ask?.("go ahead");
    });
    expect(continueQRunAction).toHaveBeenCalledWith(RUN, "go ahead");
  });
});
