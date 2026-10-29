// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QArtifactIdSchema, type QArtifactDetail } from "@capital-q/contracts";

/**
 * XLSX-001: a spreadsheet Q prepared opens in the viewer as a table of
 * its first sheet (unknown reads "Not known", money keeps its currency)
 * with one Download control offering Excel and CSV -- the same request
 * the PDF and PowerPoint downloads make, through the narrow file route.
 */

const readQArtifactAction = vi.fn<(id: string) => Promise<unknown>>();
vi.mock("../src/features/q/actions", () => ({
  readQArtifactAction: (id: string) => readQArtifactAction(id),
  readQArtifactVersionAction: (id: string) => readQArtifactAction(id),
}));

const { ArtifactViewer } = await import("../src/features/q/artifact-viewer");
const { ArtifactCard } = await import("../src/features/q/artifact-card");
const { QBoardTimeline } = await import("../src/features/q/q-board-timeline");
const { boardFiles } = await import("../src/features/q/saved-files");
const { previewCell } = await import("../src/features/q/spreadsheet-preview");
const { qArtifactExportFormats } =
  await import("../src/features/q/wire-constants");

const ARTIFACT = QArtifactIdSchema.parse(
  "a0000000-0000-4000-8000-000000000009",
);
const NOW = "2026-10-28T10:00:00.000Z";

function spreadsheet(): QArtifactDetail {
  return {
    artifact: {
      artifactId: ARTIFACT,
      type: "SPREADSHEET",
      status: "READY",
      title: "Ledgerfold: stated figures",
      summary: "Ledgerfold's figures.",
      currentVersion: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
    current: {
      artifactId: ARTIFACT,
      version: 1,
      title: "Ledgerfold: stated figures",
      summary: "Ledgerfold's figures.",
      createdAt: NOW,
      content: {
        sections: [
          {
            heading: "What is in this spreadsheet",
            body: "Figures: 2 rows.",
            findings: [],
          },
        ],
        gaps: [],
        workbook: {
          sheets: [
            {
              name: "Figures",
              columns: [
                { key: "figure", label: "Figure", type: "text" },
                {
                  key: "amount",
                  label: "Amount",
                  type: "money",
                  currency: "USD",
                },
                { key: "percent", label: "Percent", type: "percent" },
              ],
              rows: [
                ["Monthly revenue", { amount: "38000", currency: "USD" }, null],
                ["PAR30", null, "3.8"],
              ],
              totals: [],
            },
            {
              name: "Saved and passed",
              columns: [{ key: "company", label: "Company", type: "text" }],
              rows: [["Zino"]],
              totals: [],
            },
          ],
          sources: [
            {
              sheet: "Figures",
              columns: ["Figure", "Amount", "Percent"],
              from: "Ledgerfold's published claims",
              truthClass: null,
              refs: [],
            },
          ],
          provenance:
            "Prepared by Q from your Capital Q records on 2026-10-28.",
        },
      },
    },
    history: [
      { version: 1, title: "Ledgerfold: stated figures", createdAt: NOW },
    ],
  };
}

const fetched: string[] = [];

beforeEach(() => {
  fetched.length = 0;
  readQArtifactAction.mockReset();
  readQArtifactAction.mockResolvedValue({ ok: true, value: spreadsheet() });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      fetched.push(url);
      return Promise.resolve({
        ok: true,
        headers: new Headers({
          "content-disposition": 'attachment; filename="Ledgerfold.xlsx"',
        }),
        blob: () => Promise.resolve(new Blob(["x"])),
      } as Response);
    }),
  );
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => undefined,
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a spreadsheet in the viewer", () => {
  it("previews the first sheet as a table, unknown as 'Not known', money with its currency", async () => {
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    const preview = await screen.findByRole("region", {
      name: "Spreadsheet preview",
    });
    const table = within(preview).getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Figure", "Amount (USD)", "Percent"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("USD");
    expect(within(rows[0] as HTMLElement).getByText("Not known")).toBeTruthy();
    expect(rows[1]?.textContent).toContain("3.8%");
    // The second sheet is in the file, not drawn here.
    expect(screen.getByText("One more sheet is in the file.")).toBeTruthy();
    // No slides are asked for: only the downloads below fetch anything.
    expect(fetched).toEqual([]);
  });

  it("offers Excel and CSV through one Download control, and downloads the .xlsx", async () => {
    render(<ArtifactViewer artifactId={ARTIFACT} onClose={vi.fn()} />);
    await screen.findByRole("region", { name: "Spreadsheet preview" });
    await userEvent.click(screen.getByRole("button", { name: /Download/u }));
    const excel = await screen.findByText("Excel (.xlsx)");
    expect(screen.getByText("CSV (.csv)")).toBeTruthy();
    expect(screen.queryByText("PDF document")).toBeNull();
    await userEvent.click(excel);
    expect(fetched).toEqual([`/api/q-artifact/${ARTIFACT}/xlsx?version=1`]);
  });
});

describe("the spreadsheet's wire values", () => {
  it("offers a SPREADSHEET as xlsx and csv on a card", () => {
    expect(qArtifactExportFormats("SPREADSHEET")).toEqual(["xlsx", "csv"]);
  });

  it("writes a cell for reading without inventing a value", () => {
    expect(
      previewCell({ key: "a", label: "A", type: "number" }, null),
    ).toBeNull();
    expect(previewCell({ key: "a", label: "A", type: "boolean" }, true)).toBe(
      "Yes",
    );
    expect(
      previewCell({ key: "a", label: "A", type: "date" }, "2026-03-31"),
    ).toBe("2026-03-31");
  });
});

/** A sheet wider and longer than the card's glance. */
function wide(): QArtifactDetail {
  const base = spreadsheet();
  const columns = Array.from({ length: 8 }, (_unused, at) => ({
    key: `c${String(at + 1)}`,
    label: `Column ${String(at + 1)}`,
    type: "text" as const,
  }));
  const rows = Array.from({ length: 9 }, (_unused, row) =>
    columns.map((_column, at) => `r${String(row + 1)}c${String(at + 1)}`),
  );
  const current = base.current;
  if (current === null || current === undefined) return base;
  const workbook = current.content.workbook;
  if (workbook === undefined) return base;
  return {
    ...base,
    current: {
      ...current,
      content: {
        ...current.content,
        workbook: {
          ...workbook,
          sheets: [{ name: "Pipeline", columns, rows, totals: [] }],
          sources: workbook.sources
            .slice(0, 1)
            .map((source) => ({ ...source, sheet: "Pipeline" })),
        },
      },
    },
  };
}

describe("XLSX-002 · a spreadsheet's card shows a first look", () => {
  it("the card in the thread shows the first 5 rows and 6 columns in a scroll wrapper", async () => {
    readQArtifactAction.mockResolvedValue({ ok: true, value: wide() });
    render(
      <ArtifactCard
        block={{
          kind: "ARTIFACT_REFERENCE",
          artifactId: ARTIFACT,
          type: "SPREADSHEET",
          status: "READY",
          title: "Pipeline",
        }}
        onOpen={vi.fn()}
      />,
    );
    const glance = await waitFor(() => {
      const found = document.querySelector("[data-q-spreadsheet-glance]");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(
      glance.querySelectorAll("[data-q-spreadsheet-glance-head]"),
    ).toHaveLength(6);
    expect(
      glance.querySelectorAll("[data-q-spreadsheet-glance-row]"),
    ).toHaveLength(5);
    // Wider than a phone: it scrolls inside its own wrapper.
    expect(glance.querySelector(".overflow-x-auto")).not.toBeNull();
    expect(within(glance).getByText("r1c1")).toBeTruthy();
    expect(within(glance).queryByText("r6c1")).toBeNull();
    expect(within(glance).queryByText("r1c7")).toBeNull();
    expect(
      within(glance).getByText(
        "A first look. Open it for every row and column.",
      ),
    ).toBeTruthy();
  });

  it("a card for any other document reads nothing more", async () => {
    render(
      <ArtifactCard
        block={{
          kind: "ARTIFACT_REFERENCE",
          artifactId: ARTIFACT,
          type: "Q_REPORT",
          status: "READY",
          title: "Comparison",
        }}
      />,
    );
    await screen.findByText("Comparison");
    expect(readQArtifactAction).not.toHaveBeenCalled();
    expect(document.querySelector("[data-q-spreadsheet-glance]")).toBeNull();
  });
});

describe("XLSX-002 · the Board's Files come from the server", () => {
  it("after a reload (no turns in memory) Files lists the saved spreadsheet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        fetched.push(url);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [
                {
                  artifactId: ARTIFACT,
                  type: "SPREADSHEET",
                  status: "READY",
                  title: "Pipeline",
                  currentVersion: 1,
                  updatedAt: NOW,
                },
                {
                  artifactId: "a0000000-0000-4000-8000-000000000010",
                  type: "Q_REPORT",
                  status: "PREPARING",
                  title: "Still being written",
                  currentVersion: 0,
                  updatedAt: NOW,
                },
              ],
            }),
        } as Response);
      }),
    );
    const opened = vi.fn();
    render(
      <QBoardTimeline
        conversationId={null}
        turns={[]}
        onOpenArtifact={opened}
      />,
    );
    const file = await screen.findByRole("button", { name: /Pipeline/u });
    expect(fetched).toContain("/api/q-artifact/recent");
    expect(screen.queryByText("Nothing on the Board yet")).toBeNull();
    expect(screen.queryByText("Still being written")).toBeNull();
    await userEvent.click(file);
    expect(opened).toHaveBeenCalledWith(ARTIFACT);
  });

  it("merges what this tab made with what is saved, each once", () => {
    expect(
      boardFiles(
        [
          {
            artifactId: "a",
            title: "A",
            detail: "Made by Q because you asked",
          },
        ],
        [
          { artifactId: "a", title: "A", detail: "Spreadsheet, saved" },
          { artifactId: "b", title: "B", detail: "Report, saved" },
        ],
      ).map((file) => `${file.artifactId}:${file.detail}`),
    ).toEqual(["a:Made by Q because you asked", "b:Report, saved"]);
  });
});
