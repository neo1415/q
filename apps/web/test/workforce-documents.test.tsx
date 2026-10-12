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
const { WorkforceDocuments } =
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
