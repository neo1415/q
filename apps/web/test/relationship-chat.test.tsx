// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatThreadDto } from "@capital-q/contracts";

/**
 * The relationship chat panel (R34): the thread renders as the server gave
 * it; "@Q …" opens Q with that question and is never sent to the other
 * side; a relationship that is not connected shows no composer.
 */

// jsdom does not lay out, so it has no scrollIntoView.
Element.prototype.scrollIntoView = vi.fn();

const askAbout = vi.fn();
const send = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ askAbout, open: false, setOpen: () => undefined }),
}));
vi.mock("@/features/q-aperture", () => ({ QAperture: () => null }));
vi.mock("@/features/onboarding-kit/material-actions", () => ({
  materialUploadTargetAction: vi.fn(),
  materialUploadCompleteAction: vi.fn(),
}));
vi.mock("../src/features/chat/chat-actions", () => ({
  chatThreadAction: vi.fn(() =>
    Promise.resolve({ ok: false, kind: "NETWORK", message: "" }),
  ),
  markChatReadAction: vi.fn(() => Promise.resolve({ ok: true, value: null })),
  sendChatMessageAction: (...args: unknown[]) => send(...args),
  shareableDocumentsAction: vi.fn(),
  unsendChatMessageAction: vi.fn(),
}));

const { RelationshipChat } =
  await import("../src/features/chat/relationship-chat");

const REL = "00000000-0000-4000-8000-00000000c001";
const thread = (status: ChatThreadDto["status"]): ChatThreadDto => ({
  relationshipId: REL,
  status,
  messages:
    status === "OPEN"
      ? [
          {
            messageId: "00000000-0000-4000-8000-00000000d001",
            side: "COMPANY",
            mine: false,
            senderName: "Ada",
            kind: "TEXT",
            body: "Deck is attached",
            attachment: null,
            voiceDurationMs: null,
            edited: false,
            unsent: false,
            viaQ: false,
            sentAt: "2026-09-27T09:00:00.000Z",
          },
        ]
      : [],
  cursor: null,
  counterpartLastReadMessageId: null,
  unread: 1,
});

afterEach(() => {
  cleanup();
  askAbout.mockReset();
  send.mockReset();
});

describe("RelationshipChat", () => {
  it("shows the thread and sends a plain message", async () => {
    send.mockResolvedValue({
      ok: true,
      value: {
        ...thread("OPEN").messages[0],
        messageId: "00000000-0000-4000-8000-00000000d002",
        mine: true,
        body: "Thanks",
      },
    });
    render(
      <RelationshipChat
        relationshipId={REL}
        counterpart="Apex"
        initial={thread("OPEN")}
      />,
    );
    expect(screen.getByText("Deck is attached")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message Apex"), {
      target: { value: "Thanks" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledWith(
      REL,
      { kind: "TEXT", body: "Thanks" },
      expect.any(String),
    );
    expect(askAbout).not.toHaveBeenCalled();
  });

  it("hands @Q to Q and never sends it to the other side", async () => {
    render(
      <RelationshipChat
        relationshipId={REL}
        counterpart="Apex"
        initial={thread("OPEN")}
      />,
    );
    fireEvent.change(screen.getByLabelText("Message Apex"), {
      target: { value: "@Q what did they ask for?" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await Promise.resolve();
    });
    expect(askAbout).toHaveBeenCalledWith("what did they ask for?");
    expect(send).not.toHaveBeenCalled();
  });

  it("has no composer before the relationship is connected", () => {
    render(
      <RelationshipChat
        relationshipId={REL}
        counterpart="Apex"
        initial={thread("NOT_CONNECTED")}
      />,
    );
    expect(screen.queryByLabelText("Message Apex")).toBeNull();
    expect(
      screen.getByText(/Messages open once you're connected/),
    ).toBeTruthy();
  });
});
