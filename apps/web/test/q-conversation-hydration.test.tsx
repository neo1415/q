// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QConversationDetail } from "@capital-q/contracts";

/**
 * Reopening a conversation (QX-003A; CQ-Q-BLOCKS-HISTORY-001).
 *
 * This covers the lifecycle rather than the read. The repository call was
 * never the broken part: it returned the recorded turns every time, and a
 * render carrying them was observed. What failed was everything around
 * it — the hook committed "this conversation is open" before the read it
 * guards, and its cleanup did not take that back. A second invocation of
 * the effect then found the conversation already marked open, returned
 * early, and the surface stayed empty for the rest of the page's life.
 *
 * `StrictMode` is how that second invocation is produced deterministically:
 * React runs a mount effect, its cleanup, and the effect again. It is not
 * the only way to produce one — any remount of the panel does — which is
 * why the bug outlived the belief that it was a development-only artefact.
 *
 * So the assertion is deliberately not "the action was called". It is that
 * the turns are on screen once the lifecycle has settled.
 */

const readQConversationAction = vi.fn<(id: string) => Promise<unknown>>();

vi.mock("../src/features/q/actions", () => ({
  readQConversationAction: (id: string) => readQConversationAction(id),
  // Nothing waits for a decision in these conversations.
  pendingQApprovalsAction: () => Promise.resolve({ ok: true, value: [] }),
  askQAction: vi.fn(),
  continueQRunAction: vi.fn(),
  cancelQRunAction: vi.fn(),
  approveQApprovalAction: vi.fn(),
  rejectQApprovalAction: vi.fn(),
}));

// The stream is a network concern and there is no run to follow here:
// every turn under test is a recorded one.
vi.mock("@capital-q/api-client", async () => {
  const actual = await vi.importActual<typeof import("@capital-q/api-client")>(
    "@capital-q/api-client",
  );
  return {
    ...actual,
    streamQRunEvents: vi.fn(() => Promise.resolve(undefined)),
  };
});

const { useQConversation } =
  await import("../src/features/q/use-q-conversation");

const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const RUN = "c0000000-0000-4000-8000-000000000002";
const AT = "2026-09-21T17:24:59.000Z";

function detail(): QConversationDetail {
  return {
    conversationId: CONVERSATION,
    title: "Company review",
    createdAt: AT,
    updatedAt: AT,
    latestRun: { runId: RUN, status: "COMPLETED", createdAt: AT },
    messages: [
      {
        messageId: "c0000000-0000-4000-8000-000000000003",
        runId: RUN,
        role: "USER",
        text: "Review my company",
        createdAt: AT,
      },
      {
        messageId: "c0000000-0000-4000-8000-000000000004",
        runId: RUN,
        role: "Q",
        text: "Here is what the record supports.",
        createdAt: AT,
      },
    ],
  } as unknown as QConversationDetail;
}

function Surface({ conversationId }: { readonly conversationId: string }) {
  const q = useQConversation({ conversationId });
  return (
    <div data-testid="surface" data-turns={String(q.state.messages.length)}>
      {q.state.messages.map((message) => (
        <p key={message.messageId}>{message.text}</p>
      ))}
    </div>
  );
}

beforeEach(() => {
  readQConversationAction.mockReset();
  readQConversationAction.mockResolvedValue({ ok: true, value: detail() });
});

describe("QX-003A · a conversation reopened from its URL", () => {
  it("restores its recorded turns when the effect runs twice", async () => {
    render(
      <StrictMode>
        <Surface conversationId={CONVERSATION} />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("surface").dataset["turns"]).toBe("2");
    });
    expect(screen.getByText("Review my company")).toBeTruthy();
    expect(screen.getByText("Here is what the record supports.")).toBeTruthy();
  });

  it("keeps them once the lifecycle has settled", async () => {
    const { rerender } = render(
      <StrictMode>
        <Surface conversationId={CONVERSATION} />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("surface").dataset["turns"]).toBe("2");
    });

    // Later renders of the same conversation are not a request to reopen
    // it, and must not clear what was restored.
    rerender(
      <StrictMode>
        <Surface conversationId={CONVERSATION} />
      </StrictMode>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("surface").dataset["turns"]).toBe("2");
  });
});

describe("a conversation opened while its run is still answering", () => {
  it("shows the person's own question from the record, not only Q's side (Home card → /home?c=)", async () => {
    const live = detail();
    readQConversationAction.mockResolvedValue({
      ok: true,
      value: {
        ...live,
        latestRun: { runId: RUN, status: "RUNNING", createdAt: AT },
        // Q has not written anything yet: only the question is recorded.
        messages: live.messages.filter((m) => m.role === "USER"),
      },
    });
    render(
      <StrictMode>
        <Surface conversationId={CONVERSATION} />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(screen.getByText("Review my company")).toBeTruthy();
    });
  });
});
