// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("@/features/relationships/relationship-notes-actions", () => ({
  addRelationshipNoteAction: mocks.add,
}));

const { RelationshipNotes } =
  await import("@/features/relationships/relationship-notes");

const RELATIONSHIP = "a0000000-0000-4000-8000-000000000101";
const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const note = (
  id: string,
  body: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  body,
  authorName: "Ada Obi",
  authoredByMe: true,
  createdAt: "2026-10-15T10:00:00.000Z",
  supersedesNoteId: null,
  ...extra,
});
const read = (items: ReturnType<typeof note>[]) => ({
  kind: "READ" as const,
  value: { items, visibility: "organisation_private" as const },
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("private notes on a relationship record (CRM S3)", () => {
  it("says who sees them, and that the counterpart and Q never do", () => {
    render(
      <RelationshipNotes
        relationshipId={RELATIONSHIP}
        side="INVESTOR"
        read={read([])}
        now={NOW}
      />,
    );
    expect(
      screen.getByText(
        /Only your firm sees these\. Never shared with them, never used by Q\./u,
      ),
    ).toBeDefined();
    expect(screen.getByText("No notes yet.")).toBeDefined();
  });

  it("is unavailable, never empty, when the notes cannot be read", () => {
    render(
      <RelationshipNotes
        relationshipId={RELATIONSHIP}
        side="COMPANY"
        read={{ kind: "UNAVAILABLE" }}
        now={NOW}
      />,
    );
    expect(screen.getByText(/couldn't be read just now/u)).toBeDefined();
    expect(screen.queryByText("No notes yet.")).toBeNull();
  });

  it("shows a note once the server confirms it, newest first", async () => {
    mocks.add.mockResolvedValue({
      ok: true,
      note: note("b0000000-0000-4000-8000-000000000002", "Check churn"),
    });
    render(
      <RelationshipNotes
        relationshipId={RELATIONSHIP}
        side="INVESTOR"
        read={read([
          note("b0000000-0000-4000-8000-000000000001", "Met founders"),
        ])}
        now={NOW}
      />,
    );
    fireEvent.change(screen.getByLabelText("Add a note"), {
      target: { value: "  Check churn  " },
    });
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      return Promise.resolve();
    });
    expect(mocks.add).toHaveBeenCalledWith({
      relationshipId: RELATIONSHIP,
      noteId: expect.any(String) as unknown,
      body: "Check churn",
    });
    const items = within(
      screen.getByRole("list", { name: "Notes" }),
    ).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Check churn"),
      expect.stringContaining("Met founders"),
    ]);
  });

  it("corrects a note: the new one replaces it in the list", async () => {
    const first = note("b0000000-0000-4000-8000-000000000001", "Revenue 2m");
    mocks.add.mockResolvedValue({
      ok: true,
      note: note("b0000000-0000-4000-8000-000000000003", "Revenue 1.2m", {
        supersedesNoteId: first.id,
      }),
    });
    render(
      <RelationshipNotes
        relationshipId={RELATIONSHIP}
        side="INVESTOR"
        read={read([first])}
        now={NOW}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Correct" }));
    const field = screen.getByLabelText("Correct this note");
    expect((field as HTMLTextAreaElement).value).toBe("Revenue 2m");
    fireEvent.change(field, { target: { value: "Revenue 1.2m" } });
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
      return Promise.resolve();
    });
    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({ supersedesNoteId: first.id }),
    );
    const list = screen.getByRole("list", { name: "Notes" });
    expect(list.textContent).toContain("Revenue 1.2m");
    expect(list.textContent).not.toContain("Revenue 2m");
    expect(list.textContent).toContain("corrected");
  });

  it("keeps the draft and says why when saving fails", async () => {
    mocks.add.mockResolvedValue({
      ok: false,
      message: "Couldn't save the note just now.",
    });
    render(
      <RelationshipNotes
        relationshipId={RELATIONSHIP}
        side="COMPANY"
        read={read([])}
        now={NOW}
      />,
    );
    fireEvent.change(screen.getByLabelText("Add a note"), {
      target: { value: "Follow up Tuesday" },
    });
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      return Promise.resolve();
    });
    expect(screen.getByRole("alert").textContent).toContain("Couldn't save");
    expect(screen.getByLabelText("Add a note")).toHaveProperty(
      "value",
      "Follow up Tuesday",
    );
  });

  it("offers Correct only on the reader's own notes", () => {
    render(
      <RelationshipNotes
        relationshipId={RELATIONSHIP}
        side="INVESTOR"
        read={read([
          note("b0000000-0000-4000-8000-000000000001", "Partner view", {
            authoredByMe: false,
          }),
        ])}
        now={NOW}
      />,
    );
    expect(screen.queryByRole("button", { name: "Correct" })).toBeNull();
    expect(screen.getByText("Ada Obi")).toBeDefined();
  });
});
