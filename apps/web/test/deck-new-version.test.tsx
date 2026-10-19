// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Bug 2026-10-19: "Upload a new version" on the founder's Pitch deck tab
 * sent them to /documents, where the upload became a second deck. It must
 * add version N+1 to the same deck document (so its sharing stays and Q
 * reads the new version), and never navigate away to make a new document.
 */

const target = vi.fn((input: unknown) => {
  void input;
  return Promise.resolve({
    ok: true,
    value: {
      uploadSessionId: "11111111-1111-4111-8111-111111111111",
      documentId: "22222222-2222-4222-8222-222222222222",
      url: "https://storage.example/put",
      method: "PUT",
      headers: { "content-type": "application/pdf" },
    },
  });
});
const complete = vi.fn((id: string) => {
  void id;
  return Promise.resolve({ ok: true, value: { documentId: "x" } });
});
const refresh = vi.fn();

vi.mock("../src/features/onboarding-kit/material-actions", () => ({
  materialUploadTargetAction: target,
  materialUploadCompleteAction: complete,
}));
vi.mock("../src/features/company/material/material-actions", () => ({
  openDeckAction: vi.fn(),
  confirmReadingAction: vi.fn(),
  reviewSectionAction: vi.fn(),
  readAgainAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const { DeckCoach } = await import("../src/features/company/material/deck");
const fixtures =
  await import("../src/features/company/material/review-fixtures");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Upload a new version on the deck tab", () => {
  it("uploads into the same deck document instead of linking to /documents", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null)));
    vi.stubGlobal("fetch", fetchMock);
    const view = fixtures.reviewDeck("OWNER");
    if (view.coaching === null || view.deck === null)
      throw new Error("fixture");
    const { container, getByRole } = render(
      <DeckCoach
        companyId={fixtures.REVIEW_COMPANY_ID}
        view={view}
        coaching={view.coaching}
      />,
    );
    // A button, not a link to the documents library.
    const button = getByRole("button", { name: "Upload a new version" });
    expect(button).toBeTruthy();
    expect(container.querySelector('a[href="/documents"] svg')).toBeNull();

    const input = container.querySelector<HTMLInputElement>(
      "[data-deck-new-version-input]",
    );
    if (input === null) throw new Error("no file input");
    const file = new File(["%PDF-1.7"], "deck-v2.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(target).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: fixtures.REVIEW_COMPANY_ID,
        existingDocumentId: view.deck.documentId,
        documentType: "PITCH_DECK",
        filename: "deck-v2.pdf",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.example/put",
      expect.objectContaining({ method: "PUT", body: file }),
    );
    expect(complete).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
  });
});
