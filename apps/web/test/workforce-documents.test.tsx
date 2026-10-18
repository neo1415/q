// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QArtifactSummarySchema } from "@capital-q/contracts";

const askNow = vi.fn();
vi.mock("../src/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ askNow }),
}));
vi.mock("next/dynamic", () => ({
  default: () =>
    function Viewer({
      artifactId,
      onEditWithQ,
    }: {
      artifactId: string;
      onEditWithQ: (title: string) => void;
    }) {
      return (
        <div data-testid="canonical-viewer">
          {artifactId}
          <button onClick={() => onEditWithQ("Investment memo")}>
            Edit with Q
          </button>
        </div>
      );
    },
}));
const { DoneJobDocuments, WorkforceDocuments, primaryDocument } =
  await import("../src/features/work/workforce-documents");
const document = QArtifactSummarySchema.parse({
  artifactId: "c0000000-0000-4000-8000-000000000001",
  type: "MEMO",
  status: "READY",
  title: "Investment memo",
  currentVersion: 2,
  createdAt: "2026-10-12T07:00:00Z",
  updatedAt: "2026-10-12T07:00:00Z",
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Work's prepared documents", () => {
  it("opens the canonical document and continues through the existing Q edit path", async () => {
    render(<WorkforceDocuments documents={[document]} unavailable={false} />);
    expect(screen.getByText("Version 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open document" }));
    expect(
      (await screen.findByTestId("canonical-viewer")).textContent,
    ).toContain(document.artifactId);
    fireEvent.click(screen.getByRole("button", { name: "Edit with Q" }));
    expect(askNow).toHaveBeenCalledExactlyOnceWith(
      'Edit "Investment memo" with me — what would you change first?',
    );
  });

  it("never offers a PREPARING or version-zero artifact as completed", () => {
    render(
      <WorkforceDocuments
        documents={[{ ...document, status: "PREPARING", currentVersion: 0 }]}
        unavailable={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Open document" })).toBeNull();
    expect(screen.getByText(/isn’t available/u)).toBeTruthy();
  });

  it("keeps the server-rendered Open button disabled until its handler is attached", () => {
    const html = renderToString(
      <WorkforceDocuments documents={[document]} unavailable={false} />,
    );
    expect(html).toMatch(/<button[^>]*disabled/u);
  });
});

describe("a finished job's row in Done for you", () => {
  const research = QArtifactSummarySchema.parse({
    ...document,
    artifactId: "c0000000-0000-4000-8000-000000000002",
    type: "REPORT",
    title: "Research notes",
    currentVersion: 1,
    updatedAt: "2026-10-12T07:30:00Z",
  });

  it("chooses the revised memo (its highest version) as the primary document", () => {
    expect(primaryDocument([research, document])?.artifactId).toBe(
      document.artifactId,
    );
    expect(
      primaryDocument([{ ...document, status: "PREPARING" }, research])
        ?.artifactId,
    ).toBe(research.artifactId);
    expect(primaryDocument([])).toBeNull();
  });

  it("offers one Open for the primary document and the rest only on expand", async () => {
    render(
      <DoneJobDocuments documents={[research, document]} unavailable={false} />,
    );
    const opens = screen.getAllByRole("button", { name: /^Open document/u });
    expect(opens).toHaveLength(1);
    expect(screen.getByText("Investment memo · version 2")).toBeTruthy();
    expect(screen.queryByText("Research notes · version 1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "1 more document" }));
    expect(screen.getByText("Research notes · version 1")).toBeTruthy();

    fireEvent.click(opens[0] as HTMLElement);
    expect(
      (await screen.findByTestId("canonical-viewer")).textContent,
    ).toContain(document.artifactId);
  });

  it("says a document is unavailable instead of offering one that is not READY", () => {
    render(
      <DoneJobDocuments
        documents={[{ ...document, status: "PREPARING", currentVersion: 0 }]}
        unavailable={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /Open/u })).toBeNull();
    expect(screen.getByText(/isn’t available/u)).toBeTruthy();
  });

  it("renders nothing when the job prepared no document", () => {
    const { container } = render(
      <DoneJobDocuments documents={[]} unavailable={false} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
