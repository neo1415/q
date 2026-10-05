// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Who can download a pitch deck (ADR 0041): one choice in the pitch's own
 * words, private by default, saved with the version the screen saw.
 */

type Result =
  | {
      readonly ok: true;
      readonly value: {
        documentId: string;
        downloadAudience: "ORGANISATION" | "INVESTORS";
        version: number;
      };
    }
  | { readonly ok: false; readonly message: string };
const setDeckAudienceAction = vi.fn<(input: unknown) => Promise<Result>>();

vi.mock("../src/features/documents/deck-sharing-actions", () => ({
  setDeckAudienceAction: (input: unknown) => setDeckAudienceAction(input),
}));

const { DeckSharing, DECK_AUDIENCE_OPTIONS } =
  await import("../src/features/documents/deck-sharing");

configure({ asyncUtilTimeout: 8000 });
afterEach(cleanup);

const DECK = {
  documentId: "5a1d3c2a-4b5e-4f70-8a91-0b2c3d4e5f60",
  title: "Seed deck",
  downloadAudience: "ORGANISATION" as const,
  version: 3,
};

describe("deck sharing", () => {
  it("offers exactly the pitch's two words, and is private by default", () => {
    expect(DECK_AUDIENCE_OPTIONS.map((option) => option.label)).toEqual([
      "Only my organisation",
      "Investors who can find us",
    ]);
    render(<DeckSharing decks={[DECK]} />);
    const select = screen.getByLabelText<HTMLSelectElement>(
      "Who can download it",
    );
    expect(select.value).toBe("ORGANISATION");
    expect(
      screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("saves the one choice with the version it saw, and can turn it off again", async () => {
    setDeckAudienceAction
      .mockResolvedValueOnce({
        ok: true,
        value: {
          documentId: DECK.documentId,
          downloadAudience: "INVESTORS",
          version: 4,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          documentId: DECK.documentId,
          downloadAudience: "ORGANISATION",
          version: 5,
        },
      });
    render(<DeckSharing decks={[DECK]} />);
    const select = screen.getByLabelText("Who can download it");
    fireEvent.change(select, { target: { value: "INVESTORS" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.getByText("Saved.")).toBeTruthy();
    });
    expect(setDeckAudienceAction.mock.calls[0]?.[0]).toEqual({
      documentId: DECK.documentId,
      audience: "INVESTORS",
      expectedVersion: 3,
    });
    fireEvent.change(select, { target: { value: "ORGANISATION" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(setDeckAudienceAction).toHaveBeenCalledTimes(2);
    });
    expect(setDeckAudienceAction.mock.calls[1]?.[0]).toEqual({
      documentId: DECK.documentId,
      audience: "ORGANISATION",
      expectedVersion: 4,
    });
  });

  it("shows nothing when the organisation has no pitch deck", () => {
    const { container } = render(<DeckSharing decks={[]} />);
    expect(container.textContent).toBe("");
  });
});

describe("Documents page order (design-48 v2; P3)", () => {
  it("shows the library first, with the brand folded after it", async () => {
    vi.doMock("../src/components/app-shell/global-q", () => ({
      useGlobalQ: () => ({ askAbout: vi.fn() }),
    }));
    vi.doMock("../src/features/documents/brand-kit-panel", () => ({
      BrandKitPanel: () => <p>brand panel</p>,
    }));
    vi.doMock("../src/features/documents/library-actions", () => ({}));
    vi.doMock("../src/features/onboarding-kit/material-actions", () => ({}));
    const { DocumentsScreen } =
      await import("../src/features/documents/documents-screen");
    const { container } = render(
      <DocumentsScreen
        initial={{ items: [], cursors: { q: null, uploads: null } }}
        companyId={null}
        brand={null}
      />,
    );
    const text = container.textContent ?? "";
    expect(text.indexOf("No documents yet")).toBeLessThan(
      text.indexOf("brand panel"),
    );
    const brand = container.querySelector("details[data-brand-fold]");
    expect(brand?.hasAttribute("open")).toBe(false);
    expect(brand?.textContent).toContain("brand panel");
  });
});
