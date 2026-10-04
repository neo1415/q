// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  QArtifactIdSchema,
  type QBrandKit,
  type QBrandKitState,
} from "@capital-q/contracts";

/**
 * DOCS: the Documents page (brand kit, every document), the PDF control
 * under an answer, and a preparing card that settles without a refresh.
 */

const actions = {
  readBrandKitAction: vi.fn<() => Promise<unknown>>(),
  setBrandKitAction: vi.fn<(input: unknown) => Promise<unknown>>(),
  suggestBrandKitAction: vi.fn<() => Promise<unknown>>(),
  answerBrandSuggestionAction: vi.fn<(input: unknown) => Promise<unknown>>(),
  exportAnswerAction: vi.fn<(input: unknown) => Promise<unknown>>(),
};
vi.mock("../src/features/documents/actions", () => actions);
vi.mock("../src/features/q/actions", () => ({
  readQArtifactAction: () => Promise.resolve({ ok: false, message: "" }),
  readQArtifactVersionAction: () => Promise.resolve({ ok: false, message: "" }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/documents" }));

const { BrandKitPanel } =
  await import("../src/features/documents/brand-kit-panel");
const { DocumentsScreen } =
  await import("../src/features/documents/documents-screen");
const { AnswerPdf } = await import("../src/features/documents/answer-pdf");
const {
  openDocumentViewer,
  resetReadyDocuments,
  useReadyDocuments,
  useViewingDocument,
} = await import("../src/features/documents/document-ready");
const { recordPagePath } = await import("../src/features/q/client-actions");
const { ArtifactCard } = await import("../src/features/q/artifact-card");

const NOW = "2026-10-01T10:00:00.000Z";
const kit = (over: Partial<QBrandKit> = {}): QBrandKit => ({
  version: 1,
  status: "RECOMMENDED",
  source: "WEBSITE",
  sourceUrl: "https://northstar.example.com/",
  palette: { primary: "#0b6e4f", secondary: "#f2a900" },
  pairing: "INTER_ONLY",
  hasLogo: true,
  createdAt: NOW,
  ...over,
});

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  resetReadyDocuments();
});

describe("the brand kit", () => {
  it("shows a suggestion with its hex values and source, and applies it only on Use this brand", async () => {
    const confirmed = kit({ version: 2, status: "CONFIRMED" });
    actions.answerBrandSuggestionAction.mockResolvedValue({
      ok: true,
      value: confirmed,
    });
    actions.readBrandKitAction.mockResolvedValue({
      ok: true,
      value: { effective: confirmed } satisfies QBrandKitState,
    });
    render(<BrandKitPanel initial={{ suggestion: kit() }} />);

    expect(
      screen.getByText(/Q found these on northstar\.example\.com/),
    ).toBeTruthy();
    // Meaning never by colour alone: each swatch says its value.
    expect(screen.getByText("#0b6e4f")).toBeTruthy();
    expect(screen.getByText("#f2a900")).toBeTruthy();
    expect(screen.getByText("Inter throughout")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Your logo" })).toHaveProperty(
      "src",
      expect.stringContaining("/api/q-brand-kit/logo?version=1"),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Use this brand" }),
    );
    expect(actions.answerBrandSuggestionAction).toHaveBeenCalledWith({
      version: 1,
      decision: "CONFIRM",
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Use this brand" }),
      ).toBeNull();
    });
    expect(screen.getByText(/New decks use this brand/)).toBeTruthy();
  });

  it("says what to do when the website gives nothing", async () => {
    actions.suggestBrandKitAction.mockResolvedValue({
      ok: false,
      message:
        "Your company has no website on record. Add your colours or a logo instead.",
    });
    render(<BrandKitPanel initial={{}} />);
    expect(screen.getByText(/No brand yet/)).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Read my website" }),
    );
    expect(await screen.findByText(/no website on record/)).toBeTruthy();
  });

  it("refuses a colour that is not a hex value before sending anything", async () => {
    render(<BrandKitPanel initial={{}} />);
    await userEvent.click(screen.getByRole("button", { name: "Set my brand" }));
    const primary = screen.getByLabelText("Primary");
    await userEvent.clear(primary);
    await userEvent.type(primary, "green");
    await userEvent.click(screen.getByRole("button", { name: "Save brand" }));
    expect(await screen.findByText(/hex value like #1f4f7a/)).toBeTruthy();
    expect(actions.setBrandKitAction).not.toHaveBeenCalled();
  });
});

describe("the documents list", () => {
  it("offers to ask Q for a deck when there are none", () => {
    render(<DocumentsScreen documents={[]} brand={{}} />);
    expect(screen.getByText(/No documents yet/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Ask Q for a deck" }),
    ).toBeTruthy();
  });

  it("lists each document with its version, and Open only when it is ready", () => {
    render(
      <DocumentsScreen
        brand={{}}
        documents={[
          {
            artifactId: QArtifactIdSchema.parse(
              "a0000000-0000-4000-8000-000000000001",
            ),
            type: "PITCH_DECK",
            status: "READY",
            title: "Northstar — investor deck",
            currentVersion: 3,
            createdAt: NOW,
            updatedAt: NOW,
          },
          {
            artifactId: QArtifactIdSchema.parse(
              "a0000000-0000-4000-8000-000000000002",
            ),
            type: "Q_REPORT",
            status: "PREPARING",
            title: "Call notes",
            currentVersion: 0,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ]}
      />,
    );
    expect(screen.getByText(/Version 3/)).toBeTruthy();
    expect(screen.getByText(/Q is writing this/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(1);
  });
});

describe("a document Q was asked to open (follow-55)", () => {
  const READY = "a0000000-0000-4000-8000-000000000003";
  const WRITING = "a0000000-0000-4000-8000-000000000004";
  const docs = [
    {
      artifactId: QArtifactIdSchema.parse(READY),
      type: "Q_REPORT" as const,
      status: "READY" as const,
      title: "Questions for Priya Khandelwal",
      currentVersion: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      artifactId: QArtifactIdSchema.parse(WRITING),
      type: "Q_REPORT" as const,
      status: "PREPARING" as const,
      title: "Brief",
      currentVersion: 0,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];
  function Viewing() {
    return (
      <output data-testid="viewing">{useViewingDocument() ?? "none"}</output>
    );
  }
  afterEach(() => openDocumentViewer(null));

  it("deep-links to the Documents page, which opens that document's viewer", async () => {
    expect(recordPagePath("DOCUMENT", READY.toUpperCase())).toBe(
      `/documents?open=${READY}`,
    );
    render(
      <>
        <DocumentsScreen documents={docs} brand={{}} openOnArrival={READY} />
        <Viewing />
      </>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("viewing").textContent).toBe(READY),
    );
  });

  it("opens nothing for a document that is not theirs or not ready", () => {
    for (const id of [WRITING, "a0000000-0000-4000-8000-0000000000ff"]) {
      const { unmount } = render(
        <>
          <DocumentsScreen documents={docs} brand={{}} openOnArrival={id} />
          <Viewing />
        </>,
      );
      expect(screen.getByTestId("viewing").textContent).toBe("none");
      unmount();
    }
  });
});

function Count() {
  return <output data-testid="ready">{useReadyDocuments().length}</output>;
}

describe("an answer as a PDF", () => {
  it("files exactly that answer and pops up the ready card", async () => {
    actions.exportAnswerAction.mockResolvedValue({
      ok: true,
      value: {
        artifactId: QArtifactIdSchema.parse(
          "a0000000-0000-4000-8000-000000000009",
        ),
        type: "Q_REPORT",
        status: "READY",
        title: "How you come across",
        currentVersion: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    render(
      <>
        <AnswerPdf
          runId="22222222-0000-4000-8000-000000000001"
          messageId="33333333-0000-4000-8000-000000000002"
        />
        <Count />
      </>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save this answer as a PDF" }),
    );
    expect(actions.exportAnswerAction).toHaveBeenCalledWith({
      runId: "22222222-0000-4000-8000-000000000001",
      messageId: "33333333-0000-4000-8000-000000000002",
    });
    await waitFor(() => {
      expect(screen.getByTestId("ready").textContent).toBe("1");
    });
    expect(screen.getByText("PDF ready")).toBeTruthy();
  });
});

describe("a card still being prepared", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("settles to Ready from the detail route without a refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ artifact: { status: "READY" }, history: [] }),
            { headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
    render(
      <ArtifactCard
        onOpen={() => undefined}
        block={{
          kind: "ARTIFACT_REFERENCE",
          artifactId: QArtifactIdSchema.parse(
            "a0000000-0000-4000-8000-000000000001",
          ),
          type: "PITCH_DECK",
          status: "PREPARING",
          title: "Northstar — investor deck",
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    await vi.advanceTimersByTimeAsync(4_500);
    expect(await screen.findByRole("button", { name: "Open" })).toBeTruthy();
  });
});
