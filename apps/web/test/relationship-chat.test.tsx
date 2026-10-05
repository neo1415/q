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
const attachment = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const block = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const report = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({
    askAbout,
    askNow: askAbout,
    open: false,
    setOpen: () => undefined,
  }),
}));
vi.mock("@/features/q-aperture", () => ({ QAperture: () => null }));
vi.mock("@/features/onboarding-kit/material-actions", () => ({
  materialUploadTargetAction: vi.fn(),
  materialUploadCompleteAction: vi.fn(),
}));
vi.mock("../src/features/chat/chat-actions", () => ({
  chatAttachmentAction: (...args: unknown[]) => attachment(...args),
  chatThreadAction: vi.fn(() =>
    Promise.resolve({ ok: false, kind: "NETWORK", message: "" }),
  ),
  markChatReadAction: vi.fn(() => Promise.resolve({ ok: true, value: null })),
  sendChatMessageAction: (...args: unknown[]) => send(...args),
  shareableDocumentsAction: vi.fn(),
  unsendChatMessageAction: vi.fn(),
  blockChatAction: (...args: unknown[]) => block(...args),
  unblockChatAction: vi.fn(),
  reportChatAction: (...args: unknown[]) => report(...args),
}));

const { RelationshipChat } =
  await import("../src/features/chat/relationship-chat");
const { voiceContainer } = await import("../src/features/chat/voice-recorder");

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
  blockedByYourSide: false,
});

afterEach(() => {
  cleanup();
  askAbout.mockReset();
  send.mockReset();
  block.mockReset();
  report.mockReset();
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
    // A long unbroken word wraps inside its bubble (break-it 2026-10-03).
    expect(screen.getByText("Deck is attached").className).toContain(
      "wrap-anywhere",
    );
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

  it("plays a voice note from a short-lived read, and opens a file in a new tab", async () => {
    const base = thread("OPEN").messages[0];
    if (base === undefined) throw new Error("fixture");
    const voice = {
      ...base,
      messageId: "00000000-0000-4000-8000-00000000d0e1",
      kind: "VOICE_NOTE" as const,
      body: null,
      voiceDurationMs: 7000,
      attachment: {
        documentId: "00000000-0000-4000-8000-00000000d0f1",
        title: "voice-note.webm",
        mimeType: "audio/webm",
        sizeBytes: 10,
      },
    };
    const file = {
      ...base,
      messageId: "00000000-0000-4000-8000-00000000d0f2",
      kind: "ATTACHMENT" as const,
      body: null,
      attachment: {
        documentId: "00000000-0000-4000-8000-00000000d0f2",
        title: "Seed deck",
        mimeType: "application/pdf",
        sizeBytes: 10,
      },
    };
    attachment.mockResolvedValue({
      ok: true,
      value: {
        url: "https://storage.example.invalid/object/sign/a?token=t",
        mimeType: "audio/webm",
      },
    });
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = render(
      <RelationshipChat
        relationshipId={REL}
        counterpart="Apex"
        initial={{ ...thread("OPEN"), messages: [voice, file] }}
      />,
    );
    expect(screen.getByText("0:07")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Voice note/ }));
      await Promise.resolve();
    });
    expect(container.querySelector("audio")?.getAttribute("src")).toContain(
      "/object/sign/",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Seed deck" }));
      await Promise.resolve();
    });
    expect(opened).toHaveBeenCalledWith(
      expect.stringContaining("/object/sign/"),
      "_blank",
      "noopener,noreferrer",
    );
    opened.mockRestore();
  });

  it("records into a container the upload admits, or says it can't", () => {
    expect(voiceContainer((t) => t === "audio/webm")).toEqual({
      mimeType: "audio/webm",
      extension: "webm",
    });
    expect(voiceContainer((t) => t === "audio/mp4")).toEqual({
      mimeType: "audio/mp4",
      extension: "m4a",
    });
    expect(voiceContainer(() => false)).toBeNull();
  });

  it("tells the blocked side only that it can't message, with no composer", () => {
    render(
      <RelationshipChat
        relationshipId={REL}
        counterpart="Apex"
        initial={{ ...thread("OPEN"), status: "BLOCKED" }}
      />,
    );
    expect(screen.queryByLabelText("Message Apex")).toBeNull();
    expect(
      screen.getByText("You can't message this relationship right now."),
    ).toBeTruthy();
    // History stays.
    expect(screen.getByText("Deck is attached")).toBeTruthy();
  });

  it("tells the side that blocked how to unblock", () => {
    render(
      <RelationshipChat
        relationshipId={REL}
        counterpart="Apex"
        initial={{
          ...thread("OPEN"),
          status: "BLOCKED",
          blockedByYourSide: true,
        }}
      />,
    );
    expect(screen.getByText(/You blocked messages/)).toBeTruthy();
  });

  it("reports the other side's message with a reason and an optional note, after confirmation", async () => {
    report.mockResolvedValue({ ok: true, value: null });
    render(
      <RelationshipChat
        relationshipId={REL}
        counterpart="Apex"
        initial={thread("OPEN")}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Report message from Ada" }),
    );
    const sendReport = await screen.findByRole("button", {
      name: "Send report",
    });
    // No reason chosen yet: nothing can be sent.
    expect((sendReport as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Scam or fraud"));
    fireEvent.change(screen.getByLabelText("Add detail (optional)"), {
      target: { value: "  Asked for a fee  " },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send report" }));
      await Promise.resolve();
    });
    expect(report).toHaveBeenCalledWith(
      REL,
      {
        reasonCode: "SCAM",
        messageId: "00000000-0000-4000-8000-00000000d001",
        note: "Asked for a fee",
      },
      expect.any(String),
    );
    expect(
      await screen.findByText("Report sent. Capital Q will review it."),
    ).toBeTruthy();
  });
});
