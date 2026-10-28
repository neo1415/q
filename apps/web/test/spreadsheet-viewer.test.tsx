// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
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
