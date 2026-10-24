// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  QConversationDetailSchema,
  type QConversationDetail,
} from "@capital-q/contracts";

/**
 * F-41b (QA 2026-10-23): returning to the page reopened the voice line
 * with the arrival greeting ("Hi Amara, you're up late") on a
 * conversation already under way, as if it had started over. A line
 * opened on a conversation with turns resumes it; only a first line greets.
 */

const readQConversationAction = vi.fn<(id: string) => Promise<unknown>>();
vi.mock("../src/features/q/actions", () => ({
  readQConversationAction: (id: string) => readQConversationAction(id),
  pendingQApprovalsAction: () => Promise.resolve({ ok: true, value: [] }),
  listQConversationsAction: () =>
    Promise.resolve({ ok: true, value: { items: [] } }),
  resumeQAction: () =>
    Promise.resolve({ ok: true, value: { pending: [], conversations: [] } }),
  askQAction: vi.fn(),
  continueQRunAction: vi.fn(),
  cancelQRunAction: vi.fn(),
  approveQApprovalAction: vi.fn(),
  rejectQApprovalAction: vi.fn(),
  readQArtifactAction: vi.fn(),
  readQArtifactVersionAction: vi.fn(),
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
vi.mock("next/navigation", () => ({
  usePathname: () => "/discover",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../src/features/briefing/arrival-voice", () => ({
  voiceBriefing: () => Promise.resolve("Hi Amara, you're up late."),
}));

type TalkOptions = {
  readonly resume?: boolean;
  readonly firstMessage?: PromiseLike<string | undefined> | string;
  readonly thread: { readonly conversationId?: string };
};
const talk = vi.fn((_options: TalkOptions) => Promise.resolve());
vi.mock("../src/features/voice/use-voice-interview", async () => {
  const { createContext } = await import("react");
  const useVoiceInterview = () => ({
    client: {
      state: "IDLE",
      inputLevel: 0,
      outputLevel: 0,
      muted: false,
      setMuted: vi.fn(),
      sendText: vi.fn(),
      connected: false,
    },
    active: false,
    voice: "FEMALE",
    notice: null,
    talk,
    end: vi.fn(),
    chooseVoice: vi.fn(),
    clearNotice: vi.fn(),
    turn: null,
  });
  return {
    useVoiceInterview,
    VoiceInterviewSource: createContext(useVoiceInterview),
  };
});

const { QSessionProvider, useQSession } =
  await import("../src/features/q/q-session");
const { QSubjectProvider } = await import("../src/features/q/q-subject");

const CONVERSATION = "c0000000-0000-4000-8000-000000000041";
const at = "2026-10-23T21:00:00.000Z";

function detail(): QConversationDetail {
  return QConversationDetailSchema.parse({
    conversation: {
      conversationId: CONVERSATION,
      title: "Pipeline",
      subjects: [],
      createdAt: at,
      lastMessageAt: at,
    },
    messages: [
      {
        messageId: "d0000000-0000-4000-8000-000000000041",
        runId: "c0000000-0000-4000-8000-000000000042",
        role: "USER",
        text: "How is my pipeline?",
        createdAt: at,
      },
      {
        messageId: "d0000000-0000-4000-8000-000000000042",
        runId: "c0000000-0000-4000-8000-000000000042",
        role: "Q",
        text: "You have seven relationships.",
        createdAt: at,
      },
    ],
    latestRun: {
      runId: "c0000000-0000-4000-8000-000000000042",
      conversationId: CONVERSATION,
      status: "COMPLETED",
      createdAt: at,
    },
  });
}

const probe: { session: ReturnType<typeof useQSession> | null } = {
  session: null,
};
function Probe() {
  const session = useQSession();
  useEffect(() => {
    probe.session = session;
  });
  return null;
}
const mount = () =>
  render(
    <QSubjectProvider own={{ kind: "NONE", scope: "unset" }}>
      <QSessionProvider connected>
        <Probe />
      </QSessionProvider>
    </QSubjectProvider>,
  );

beforeEach(() => {
  window.sessionStorage.clear();
  talk.mockClear();
  readQConversationAction.mockReset();
  readQConversationAction.mockResolvedValue({ ok: true, value: detail() });
  probe.session = null;
});
afterEach(() => cleanup());

describe("a line opened on a conversation under way (F-41b)", () => {
  it("resumes it, in the same conversation, without the arrival greeting", async () => {
    window.sessionStorage.setItem(
      "cq.q.active-conversation.v1",
      JSON.stringify({ home: CONVERSATION }),
    );
    mount();
    await waitFor(() => expect(probe.session?.turns.length).toBe(2));
    await act(async () => {
      await probe.session?.talk();
    });
    const options = talk.mock.calls.at(-1)?.[0];
    expect(options?.resume).toBe(true);
    expect(options?.firstMessage).toBeUndefined();
    expect(options?.thread.conversationId).toBe(CONVERSATION);
  });

  it("a first line, with nothing said yet, still opens with the briefing", async () => {
    mount();
    await waitFor(() => expect(probe.session).not.toBeNull());
    await act(async () => {
      await probe.session?.talk();
    });
    const options = talk.mock.calls.at(-1)?.[0];
    expect(options?.resume).toBeUndefined();
    await expect(Promise.resolve(options?.firstMessage)).resolves.toBe(
      "Hi Amara, you're up late.",
    );
  });
});
