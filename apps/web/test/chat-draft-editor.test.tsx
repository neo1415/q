// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Live 2026-10-28: the chat reply Q drafted was not editable on its
 * approval card while the email was. The chat editor follows the email
 * editor exactly: open the draft, change the words, save; saving is a
 * revision the old approval does not cover, so the card asks again.
 */

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };
type Draft = {
  readonly approvalId: string;
  readonly relationshipId: string;
  readonly counterpartName: string;
  readonly body: string;
};
const readChatDraft = vi.fn<(id: string) => Promise<Result<Draft>>>();
const reviseChatDraftAction =
  vi.fn<(id: string, input: { body: string }) => Promise<Result<null>>>();
vi.mock("../src/features/integrations/integration-actions", () => ({
  readChatDraft: (id: string) => readChatDraft(id),
  reviseChatDraftAction: (id: string, input: { body: string }) =>
    reviseChatDraftAction(id, input),
}));

const { ChatDraftEditor } =
  await import("../src/features/integrations/chat-draft-editor");

const APPROVAL = "f0000000-0000-4000-8000-000000000003";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChatDraftEditor", () => {
  it("opens the drafted words, saves an edit as a revision, and reports it", async () => {
    readChatDraft.mockResolvedValue({
      ok: true,
      value: {
        approvalId: APPROVAL,
        relationshipId: "91000000-0000-4000-8000-000000000001",
        counterpartName: "Savanna Seed Partners",
        body: "Hi Amara, we'd love to meet next week.",
      },
    });
    reviseChatDraftAction.mockResolvedValue({ ok: true, value: null });
    const onRevised = vi.fn();
    render(<ChatDraftEditor approvalId={APPROVAL} onRevised={onRevised} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    const field = await screen.findByLabelText("Message");
    expect((field as HTMLTextAreaElement).value).toBe(
      "Hi Amara, we'd love to meet next week.",
    );
    fireEvent.change(field, {
      target: { value: "Hi Amara, Tuesday at 10 works for us." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onRevised).toHaveBeenCalledTimes(1));
    expect(reviseChatDraftAction).toHaveBeenCalledWith(APPROVAL, {
      body: "Hi Amara, Tuesday at 10 works for us.",
    });
    expect(screen.getByRole("button", { name: "Edit message" })).toBeTruthy();
  });

  it("shows the server's refusal instead of pretending it saved", async () => {
    readChatDraft.mockResolvedValue({
      ok: true,
      value: {
        approvalId: APPROVAL,
        relationshipId: "91000000-0000-4000-8000-000000000001",
        counterpartName: "Savanna Seed Partners",
        body: "Hi Amara.",
      },
    });
    reviseChatDraftAction.mockResolvedValue({
      ok: false,
      message: "That approval has already been decided.",
    });
    const onRevised = vi.fn();
    render(<ChatDraftEditor approvalId={APPROVAL} onRevised={onRevised} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    await screen.findByLabelText("Message");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("That approval has already been decided.");
    expect(onRevised).not.toHaveBeenCalled();
  });
});
