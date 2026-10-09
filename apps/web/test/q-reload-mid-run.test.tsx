// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A reload while Home's first question was still being accepted reopens
 * that conversation (CQ-QX-007 H1).
 *
 * Asking is a server action; Next.js runs a page's actions one at a time,
 * so the question can wait seconds behind another before it is accepted,
 * and only then is there a conversation id to put in the URL. Live, a
 * reload 2.5 s after asking landed on a blank Home while the run completed
 * elsewhere. The question is now remembered for the tab with its
 * idempotency key, and a reload asks again under the SAME key — the Q API
 * answers with the run it already created — and names the conversation.
 */

const askQAction =
  vi.fn<(...args: unknown[]) => Promise<{ ok: true; value: unknown }>>();

vi.mock("../src/features/q/actions", () => ({
  readQConversationAction: vi.fn(),
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
    streamQRunEvents: vi.fn(() => new Promise(() => undefined)),
  };
});

const { useQConversation } =
  await import("../src/features/q/use-q-conversation");
const { readPendingAsk, rememberPendingAsk } =
  await import("../src/features/q/pending-ask");

const COMPANY = "c0000000-0000-4000-8000-000000000009";
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const RUN = "c0000000-0000-4000-8000-000000000002";
const KEY = "c0000000-0000-4000-8000-000000000003";

function Home({
  onConversation,
  companyId = COMPANY,
}: {
  readonly onConversation: (id: string) => void;
  readonly companyId?: string;
}) {
  const q = useQConversation({
    companyId,
    conversationId: null,
    onConversation,
  });
  return (
    <div data-testid="home" data-conversation={q.conversationId ?? ""}>
      {q.pending.map((turn) => (
        <p key={turn.id}>{turn.text}</p>
      ))}
    </div>
  );
}

beforeEach(() => {
  askQAction.mockReset();
  window.sessionStorage.clear();
});

describe("H1 · a reload mid-run reopens the conversation", () => {
  it("asks again under the same key, shows the question, and names the conversation", async () => {
    rememberPendingAsk({
      idempotencyKey: KEY,
      text: "who's our biggest customer?",
      at: new Date().toISOString(),
      companyId: COMPANY,
    });
    askQAction.mockResolvedValue({
      ok: true,
      value: { runId: RUN, conversationId: CONVERSATION },
    });
    const named: string[] = [];
    render(
      <StrictMode>
        <Home onConversation={(id) => named.push(id)} />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(named).toEqual([CONVERSATION]);
    });
    expect(screen.getByText("who's our biggest customer?")).toBeTruthy();
    // Once, under the key the first attempt used, about the same company.
    expect(askQAction).toHaveBeenCalledTimes(1);
    // The /api/q-ask fallback passes every parameter; the trailing ones
    // (viewing, screen, opening) are absent on a reload.
    expect(askQAction.mock.calls[0]).toEqual([
      "who's our biggest customer?",
      undefined,
      { companyId: COMPANY },
      KEY,
      undefined,
      undefined,
      undefined,
    ]);
    expect(readPendingAsk()).toBeNull();
  });

  it("does nothing for a different surface, or for a question that is not recent", async () => {
    rememberPendingAsk({
      idempotencyKey: KEY,
      text: "about another company",
      at: new Date().toISOString(),
      companyId: "c0000000-0000-4000-8000-00000000000a",
    });
    render(<Home onConversation={() => undefined} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(askQAction).not.toHaveBeenCalled();

    window.sessionStorage.clear();
    rememberPendingAsk({
      idempotencyKey: KEY,
      text: "long ago",
      at: new Date(Date.now() - 10 * 60_000).toISOString(),
      companyId: COMPANY,
    });
    expect(readPendingAsk()).toBeNull();
  });
});
