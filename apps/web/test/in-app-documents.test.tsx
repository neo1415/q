// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Owner 2026-10-17: "everything happens within the app". A report, an
 * edition or a transcript opens in the in-app reader; "Save a copy" in
 * the reader is the secondary act for someone who wants the file. A CSV
 * stays a data export (a download, and says so).
 */

const pdf = vi.hoisted(() => ({
  urls: [] as string[],
  pages: 2,
}));
vi.mock("../src/features/q/room/pdf-page", () => ({
  usePdfDocument: (url: string) => {
    pdf.urls.push(url);
    return {
      state: { kind: "ready", document: { numPages: pdf.pages } },
      retry: () => undefined,
    };
  },
  PdfPage: ({ page }: { readonly page: number }) => (
    <div data-testid="pdf-page">{page}</div>
  ),
}));

const { InAppReader, OpenPdfButton } =
  await import("../src/features/documents/in-app-reader");
const { ResultsDashboard } =
  await import("../src/features/results/results-dashboard");
const { reviewResults } = await import("../app/dev/results/fixtures");
const { isPdfFile } = await import("../src/features/documents/library-model");

afterEach(() => {
  cleanup();
  pdf.urls = [];
  vi.restoreAllMocks();
});

describe("the in-app reader", () => {
  it("opens a PDF inside the app, every page, with Save a copy as the secondary act", async () => {
    render(
      <OpenPdfButton
        title="Report"
        url="/results/report?format=pdf&range=30d"
        className=""
      >
        Open report
      </OpenPdfButton>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open report" }));
    const dialog = await screen.findByRole("dialog", { name: "Report" });
    expect(within(dialog).getAllByTestId("pdf-page")).toHaveLength(2);
    expect(pdf.urls).toContain("/results/report?format=pdf&range=30d");
    const save = within(dialog).getByRole("link", { name: "Save a copy" });
    expect(save.getAttribute("href")).toBe(
      "/results/report?format=pdf&range=30d",
    );
    expect(save.hasAttribute("download")).toBe(true);
  });

  it("shows a transcript as text and saves it only when asked", async () => {
    const created = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:transcript");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clicked = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(
      <InAppReader
        document={{
          kind: "text",
          title: "Transcript",
          text: "You: hello\nQ: hello back",
          fileName: "capital-q-conversation.txt",
        }}
        onClose={() => undefined}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Transcript" });
    expect(within(dialog).getByText(/Q: hello back/u)).toBeTruthy();
    expect(created).not.toHaveBeenCalled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save a copy" }),
    );
    expect(created).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("tells a PDF from other uploads by its file name", () => {
    expect(isPdfFile("Deck.PDF")).toBe(true);
    expect(isPdfFile("model.xlsx")).toBe(false);
    expect(isPdfFile(null)).toBe(false);
  });
});

describe("the CRM Overview / Results report", () => {
  it("opens the PDF report in the app and keeps the CSV as a labelled download", async () => {
    const { investor, usage } = reviewResults(Date.now(), "30d", false);
    render(
      <ResultsDashboard
        basePath="/crm"
        range="30d"
        stage={null}
        download="range=30d"
        usage={usage}
        results={investor}
      />,
    );
    expect(screen.queryByRole("link", { name: "Download PDF" })).toBeNull();
    const csv = screen.getByRole("link", { name: "Download CSV" });
    expect(csv.getAttribute("href")).toBe(
      "/results/report?format=csv&range=30d",
    );
    expect(csv.hasAttribute("download")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Open report" }));
    const dialog = await screen.findByRole("dialog");
    expect(pdf.urls).toContain("/results/report?format=pdf&range=30d");
    expect(
      within(dialog)
        .getByRole("link", { name: "Save a copy" })
        .getAttribute("href"),
    ).toBe("/results/report?format=pdf&range=30d");
  });
});
