// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  QConversationDetailSchema,
  QVoiceTurnStateSchema,
  type QConversationDetail,
  type QVoiceTurnState,
} from "@capital-q/contracts";

/**
 * A spoken answer that made a document lands its card (founder bug on
 * 164fc5c).
 *
 * "Give me a PDF of my mandate", said aloud: Q answered "download the PDF
 * from the card", and the recorded message carried an ARTIFACT_REFERENCE
 * block -- but the answer reached the screen only as speech and a
 * transcript line, so no card appeared on the stage or the Board. A
 * completed voice turn now reads the conversation back, and the card
 * comes with it: whatever the artifact type, with Open and the PDF.
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
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

/** The voice line, controlled by the test: a turn completes when it says so. */
const voiceState: { turn: QVoiceTurnState | null; listeners: Set<() => void> } =
  { turn: null, listeners: new Set() };
function completeVoiceTurn(turn: QVoiceTurnState) {
  voiceState.turn = turn;
  for (const listener of voiceState.listeners) listener();
}
vi.mock("../src/features/voice/use-voice-interview", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useVoiceInterview: () => {
      const [, force] = useState(0);
      useEffect(() => {
        const listener = () => force((n) => n + 1);
        voiceState.listeners.add(listener);
        return () => {
          voiceState.listeners.delete(listener);
        };
      }, []);
      return {
        client: {
          state: "LISTENING",
          inputLevel: 0,
          outputLevel: 0,
          muted: false,
          setMuted: vi.fn(),
          sendText: vi.fn(),
        },
        active: true,
        voice: "FEMALE",
        notice: null,
        talk: vi.fn(),
        end: vi.fn(),
        chooseVoice: vi.fn(),
        clearNotice: vi.fn(),
        turn: voiceState.turn,
      };
    },
  };
});

const { QSessionProvider, useQSession } =
  await import("../src/features/q/q-session");
const { QSubjectProvider } = await import("../src/features/q/q-subject");
const { QBoard } = await import("../src/features/q/q-board");

const CONVERSATION = "c0000000-0000-4000-8000-000000000001";
const RUN = "c0000000-0000-4000-8000-000000000002";
const ARTIFACT = "68739df2-0000-4000-8000-000000000003";

function conversation(withAnswer: boolean): QConversationDetail {
  const at = "2026-09-26T08:00:00.000Z";
  // Parsed, so the fixture is exactly what the Q API may send.
  return QConversationDetailSchema.parse({
    conversation: {
      conversationId: CONVERSATION,
      title: "Mandate",
      subjects: [],
      createdAt: at,
      lastMessageAt: at,
    },
    messages: withAnswer
      ? [
          {
            messageId: "d0000000-0000-4000-8000-000000000001",
            runId: RUN,
            role: "USER",
            text: "give me a PDF of my mandate",
            createdAt: at,
          },
          {
            messageId: "d0000000-0000-4000-8000-000000000002",
            runId: RUN,
            role: "Q",
            text: "Here's your mandate. Download the PDF from the card.",
            blocks: [
              {
                kind: "ARTIFACT_REFERENCE",
                artifactId: ARTIFACT,
                type: "INVESTOR_MANDATE",
                status: "READY",
                title: "Zino Aviation: investment mandate",
              },
            ],
            createdAt: at,
          },
        ]
      : [],
    latestRun: withAnswer
      ? {
          runId: RUN,
          conversationId: CONVERSATION,
          status: "COMPLETED",
          createdAt: at,
        }
      : null,
  });
}

function Stage() {
  const session = useQSession();
  return (
    <QBoard
      conversationId={session.q.conversationId}
      turns={session.turns}
      onAsk={() => undefined}
      onOpenArtifact={() => undefined}
    />
  );
}

function turn(sequence: number): QVoiceTurnState {
  return QVoiceTurnStateSchema.parse({
    sequence,
    asking: null,
    navigate: null,
    handoff: null,
    degraded: false,
    conversationId: CONVERSATION,
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  voiceState.turn = null;
  readQConversationAction.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("a voice-delivered answer with a document", () => {
  it("shows the card, labelled by its type, with Open and the PDF", async () => {
    // The voice line names the conversation before the answer is stored...
    readQConversationAction.mockResolvedValueOnce({
      ok: true,
      value: conversation(false),
    });
    // ...and every later read has the recorded answer.
    readQConversationAction.mockResolvedValue({
      ok: true,
      value: conversation(true),
    });

    render(
      <QSubjectProvider own={{ kind: "NONE", scope: "unset" }}>
        <QSessionProvider connected>
          <Stage />
        </QSessionProvider>
      </QSubjectProvider>,
    );

    act(() => completeVoiceTurn(turn(1)));

    // The first read (the voice line naming the conversation) has no
    // answer yet; the re-read after the turn does.
    await waitFor(
      () =>
        expect(
          screen.getByText("Zino Aviation: investment mandate"),
        ).toBeTruthy(),
      { timeout: 8000 },
    );
    expect(screen.getByText("Investment mandate")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /PDF/ }).getAttribute("href"),
    ).toContain(ARTIFACT);
  });
});

describe("artifact type labels", () => {
  it("names the known types and gives any other type the generic label", async () => {
    const { artifactTypeLabel } =
      await import("../src/features/q/artifact-type");
    expect(artifactTypeLabel("INVESTOR_MANDATE")).toBe("Investment mandate");
    expect(artifactTypeLabel("INVESTMENT_BRIEF")).toBe("Investment brief");
    expect(artifactTypeLabel("PITCH_DECK")).toBe("Investor deck");
    expect(artifactTypeLabel("SOMETHING_NEW")).toBe("Document");
  });
});
