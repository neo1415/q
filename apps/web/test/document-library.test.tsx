// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentDto, QArtifactSummary } from "@capital-q/contracts";

/**
 * P3 documents page: one library of Q's documents and uploads, grid or
 * list (remembered), search, filter and sort, cursor pages that never
 * reorder, the quick-action menu, and delete with undo.
 */

const library = {
  loadLibraryPageAction: vi.fn<(input: unknown) => Promise<unknown>>(),
  renameDocumentAction: vi.fn<(input: unknown) => Promise<unknown>>(),
  archiveDocumentAction: vi.fn<(input: unknown) => Promise<unknown>>(),
  documentFileAction: vi.fn<(id: string) => Promise<unknown>>(),
};
vi.mock("../src/features/documents/library-actions", () => library);
vi.mock("../src/features/documents/deck-sharing-actions", () => ({
  setDeckAudienceAction: vi.fn(),
}));
vi.mock("../src/features/onboarding-kit/material-actions", () => ({
  materialUploadTargetAction: vi.fn(),
  materialUploadCompleteAction: vi.fn(),
}));
vi.mock("../src/features/q/actions", () => ({
  readQArtifactAction: () => Promise.resolve({ ok: false, message: "" }),
  readQArtifactVersionAction: () => Promise.resolve({ ok: false, message: "" }),
}));
const askAbout = vi.fn();
vi.mock("../src/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ askAbout, askNow: askAbout }),
}));

const model = await import("../src/features/documents/library-model");
const { DocumentLibrary } =
  await import("../src/features/documents/document-library");

const at = (day: number) =>
  `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const upload = (n: number, over: Partial<DocumentDto> = {}): DocumentDto => ({
  id: `d0000000-0000-4000-8000-00000000000${String(n)}`,
  companyId: "c0000000-0000-4000-8000-000000000001",
  documentType: "FINANCIAL_MODEL",
  title: `Model ${String(n)}`,
  status: "ACTIVE",
  visibilityScope: "organisation_private",
  sensitivityClass: "CONFIDENTIAL",
  downloadAudience: "ORGANISATION",
  currentVersion: {
    id: `e0000000-0000-4000-8000-00000000000${String(n)}`,
    versionNumber: 1,
    originalFilename: `model-${String(n)}.xlsx`,
    mimeType: "application/pdf",
    sizeBytes: 2_400_000,
    sha256: "a".repeat(64),
    uploadedAt: at(n),
    processingStatus: "COMPLETED",
    malwareScanStatus: "CLEAN",
    textExtractionStatus: "COMPLETED",
  },
  createdAt: at(n),
  updatedAt: at(n),
  version: 1,
  ...over,
});
const made = (n: number, title: string): QArtifactSummary =>
  ({
    artifactId: `a0000000-0000-4000-8000-00000000000${String(n)}`,
    type: "PITCH_DECK",
    status: "READY",
    title,
    currentVersion: 2,
    createdAt: at(n),
    updatedAt: at(n),
  }) as QArtifactSummary;

beforeEach(() => {
  for (const action of Object.values(library)) action.mockReset();
  askAbout.mockReset();
  window.localStorage.clear();
});

describe("the library model", () => {
  it("names who can see it and whether Q has read it", () => {
    const deck = model.fromUpload(
      upload(1, { documentType: "PITCH_DECK", downloadAudience: "INVESTORS" }),
    );
    expect(deck.sharing).toBe("Investors can download");
    expect(deck.qRead).toBe("READ");
    expect(deck.group).toBe("DECK");
    const reading = model.fromUpload(
      upload(2, {
        currentVersion: {
          ...(upload(2).currentVersion ?? ({} as never)),
          processingStatus: "PROCESSING",
          textExtractionStatus: "NOT_STARTED",
        },
      }),
    );
    expect(reading.qRead).toBe("READING");
    expect(reading.sharing).toBe("Only your team");
    expect(model.sizeLabel(2_400_000)).toBe("2.3 MB");
  });

  it("filters, searches and sorts by recent, name and type", () => {
    const items = [
      model.fromUpload(upload(3, { title: "Zebra model" })),
      model.fromArtifact(made(5, "Alpha deck")),
      model.fromUpload(
        upload(4, { title: "Term sheet", documentType: "LEGAL" }),
      ),
    ];
    expect(
      items.filter((i) => model.matches(i, "BY_Q", "")).map((i) => i.title),
    ).toEqual(["Alpha deck"]);
    expect(
      items.filter((i) => model.matches(i, "LEGAL", "")).map((i) => i.title),
    ).toEqual(["Term sheet"]);
    expect(
      items.filter((i) => model.matches(i, "ALL", "zebra")).map((i) => i.title),
    ).toEqual(["Zebra model"]);
    expect(model.sortItems(items, "RECENT").map((i) => i.title)).toEqual([
      "Alpha deck",
      "Term sheet",
      "Zebra model",
    ]);
    expect(model.sortItems(items, "NAME").map((i) => i.title)).toEqual([
      "Alpha deck",
      "Term sheet",
      "Zebra model",
    ]);
  });

  it("merging two cursor-paged sources shows nothing the next page could still precede", () => {
    const items = [
      model.fromArtifact(made(9, "Q new")),
      model.fromArtifact(made(5, "Q older")),
      model.fromUpload(upload(8, { title: "Upload new" })),
    ];
    // Uploads have more: anything older than day 8 waits for their next page.
    expect(
      model
        .visibleUpTo(items, { q: null, uploads: "next" })
        .map((i) => i.title),
    ).toEqual(["Q new", "Upload new"]);
    expect(model.visibleUpTo(items, { q: null, uploads: null })).toHaveLength(
      3,
    );
  });

  it("guesses a deck from its file name", () => {
    expect(model.documentTypeForFile("Ajopot Pitch Deck v3.pdf")).toBe(
      "PITCH_DECK",
    );
    expect(model.documentTypeForFile("FY25 model.xlsx")).toBe(
      "FINANCIAL_MODEL",
    );
    expect(model.documentTypeForFile("Shareholders Agreement.pdf")).toBe(
      "LEGAL",
    );
    expect(model.documentTypeForFile("photo.png")).toBe("UNCLASSIFIED");
  });
});

describe("the documents library", () => {
  const first = {
    items: [
      model.fromArtifact(made(9, "Northstar deck")),
      model.fromUpload(upload(8, { title: "FY25 model" })),
    ],
    cursors: { q: null, uploads: "cursor-2" },
  };

  it("switches between grid and list and remembers it on this device", async () => {
    const { unmount } = render(
      <DocumentLibrary initial={first} companyId={null} />,
    );
    expect(document.querySelector("[data-view=grid]")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "List" }));
    expect(document.querySelector("[data-view=list]")).toBeTruthy();
    expect(window.localStorage.getItem("cq.documents.view")).toBe("list");
    unmount();
    render(<DocumentLibrary initial={first} companyId={null} />);
    await waitFor(() =>
      expect(document.querySelector("[data-view=list]")).toBeTruthy(),
    );
  });

  it("loads the next page by cursor and filters by chip and search", async () => {
    library.loadLibraryPageAction.mockResolvedValue({
      ok: true,
      value: {
        items: [
          model.fromUpload(
            upload(2, { title: "Old contract", documentType: "LEGAL" }),
          ),
        ],
        cursors: { q: null, uploads: null },
      },
    });
    render(<DocumentLibrary initial={first} companyId={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(library.loadLibraryPageAction).toHaveBeenCalledWith({
      q: null,
      uploads: "cursor-2",
    });
    expect((await screen.findAllByText("Old contract")).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Legal" }));
    expect(screen.queryByText("Northstar deck")).toBeNull();
    expect(screen.getAllByText("Old contract").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    await userEvent.type(screen.getByRole("searchbox"), "north");
    expect(screen.getAllByText("Northstar deck").length).toBeGreaterThan(0);
    expect(screen.queryByText("FY25 model")).toBeNull();
  });

  it("deletes an upload from its menu, and Undo brings it back", async () => {
    library.archiveDocumentAction.mockResolvedValue({
      ok: true,
      value: { version: 2 },
    });
    library.loadLibraryPageAction.mockResolvedValue({ ok: true, value: first });
    render(<DocumentLibrary initial={first} companyId={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for FY25 model" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Delete" }),
    );
    expect(library.archiveDocumentAction).toHaveBeenCalledWith({
      documentId: upload(8).id,
      archived: true,
    });
    expect(await screen.findByText('Deleted "FY25 model".')).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Open FY25 model" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(library.archiveDocumentAction).toHaveBeenLastCalledWith({
      documentId: upload(8).id,
      archived: false,
    });
  });

  it("asks Q about a document from its menu, and Q's own documents cannot be deleted here", async () => {
    render(<DocumentLibrary initial={first} companyId={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Actions for Northstar deck" }),
    );
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Ask Q about it" }),
    );
    expect(askAbout).toHaveBeenCalledWith('About "Northstar deck": ');
  });

  it("says what failed and offers to try again", () => {
    render(<DocumentLibrary initial={null} companyId={null} />);
    expect(screen.getByText("Your documents didn't load")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
