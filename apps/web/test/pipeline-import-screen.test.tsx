// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PipelineImportMapping,
  PipelineImportPreview,
} from "@capital-q/contracts";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => "/relationships/import",
}));
// The real ops reach the server; every test here passes its own.
vi.mock("@/features/relationships/pipeline-import-ops", () => ({
  PIPELINE_IMPORT_OPS: {},
}));

const { PipelineImportScreen } =
  await import("@/features/relationships/pipeline-import-screen");
const { assignColumn, importedCount, mySideWords, resolutionsOf } =
  await import("@/features/relationships/pipeline-import-model");

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MAPPING: PipelineImportMapping = {
  counterpartName: "Organization",
  stage: "Status",
  owner: "Owners",
};

function preview(
  mapping: PipelineImportMapping = MAPPING,
): PipelineImportPreview {
  return {
    importId: id(1),
    proposalHash: "a".repeat(64),
    fileName: "deals.csv",
    side: "INVESTOR",
    mapping,
    mappingSource: mapping === MAPPING ? "Q" : "PERSON",
    columns: ["Organization", "Status", "Owners", "Notes"],
    unmappedColumns: ["Notes"],
    counts: { rows: 4, matched: 1, ambiguous: 1, new: 1, invalid: 1 },
    status: "PREPARED",
    rows: [
      {
        rowNumber: 1,
        name: "Northwind",
        stage: "DILIGENCE",
        stageLabel: "Deep dive",
        match: "MATCHED",
        matched: { id: id(11), name: "Northwind" },
        candidates: [],
      },
      {
        rowNumber: 2,
        name: "Atlas",
        stage: "CONTACTED",
        stageLabel: "Outreach",
        match: "AMBIGUOUS",
        matched: null,
        candidates: [
          { id: id(21), name: "Atlas Robotics Inc" },
          { id: id(22), name: "Atlas Robotics Africa" },
        ],
      },
      {
        rowNumber: 3,
        name: "Harmattan Foods",
        stage: "RESEARCH",
        stageLabel: "Lead",
        match: "NEW",
        matched: null,
        candidates: [],
      },
      {
        rowNumber: 4,
        name: null,
        stage: null,
        stageLabel: null,
        match: "INVALID",
        matched: null,
        candidates: [],
      },
    ],
  };
}

function ops(overrides: Record<string, unknown> = {}) {
  return {
    upload: vi.fn(() =>
      Promise.resolve({ ok: true as const, documentId: id(99) }),
    ),
    prepare: vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        retry: true,
        message: "Checking the file for safety…",
      })
      .mockImplementation((input: { mapping?: PipelineImportMapping }) =>
        Promise.resolve({ ok: true, value: preview(input.mapping) }),
      ),
    apply: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          importId: id(1),
          replayed: false,
          result: {
            linked: 2,
            relationshipsCreated: 1,
            keptPrivate: 1,
            skipped: 1,
            stageEvents: 2,
            notes: 2,
            tasks: 0,
            details: 2,
          },
          relationships: [
            {
              relationshipId: id(31),
              counterpartId: id(11),
              name: "Northwind",
            },
          ],
        },
      }),
    ),
    ...overrides,
  };
}

const file = (name = "deals.csv", size = 120) =>
  new File(["x".repeat(size)], name, { type: "text/csv" });

async function upload(o: ReturnType<typeof ops>) {
  render(
    <PipelineImportScreen side="INVESTOR" ops={o as never} scanWaitMs={1} />,
  );
  const input = document.querySelector<HTMLInputElement>("[data-import-file]");
  if (input === null) throw new Error("no file input");
  fireEvent.change(input, { target: { files: [file()] } });
  await screen.findByText("deals.csv", { selector: "span" });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the CRM import screen (decision 106)", () => {
  it("uploads, waits out the safety check, then shows Q's columns and the rows by match", async () => {
    const o = ops();
    await upload(o);
    expect(o.upload).toHaveBeenCalledTimes(1);
    // First read: still being checked; asked again, then the proposal.
    expect(o.prepare).toHaveBeenCalledTimes(2);
    expect(o.prepare).toHaveBeenLastCalledWith({ documentId: id(99) });
    const counts = document.querySelector("[data-import-counts]");
    expect(counts?.textContent).toContain("In Capital Q1");
    // A choice is waiting, so the review opens on it.
    const rows = document.querySelector("[data-import-group]");
    expect(rows?.getAttribute("data-import-group")).toBe("ambiguous");
    expect(screen.getByLabelText("Atlas Robotics Inc")).toBeDefined();
    expect(screen.getByLabelText("Keep as a private prospect")).toBeDefined();
    // Each column is an editable choice, mapped as Q proposed.
    const status = screen.getByLabelText<HTMLSelectElement>("Status");
    expect(status.value).toBe("stage");
    expect(screen.getByLabelText<HTMLSelectElement>("Notes").value).toBe("");
  });

  it("refuses a file that is not CSV or Excel before uploading it", async () => {
    const o = ops();
    render(
      <PipelineImportScreen side="INVESTOR" ops={o as never} scanWaitMs={1} />,
    );
    const input =
      document.querySelector<HTMLInputElement>("[data-import-file]");
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [file("deck.pdf")] },
    });
    expect(
      await screen.findByText("Choose a CSV or an Excel (.xlsx) file."),
    ).toBeDefined();
    expect(o.upload).not.toHaveBeenCalled();
  });

  it("reads the file again with the person's columns before it can be approved", async () => {
    const o = ops();
    await upload(o);
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "notes" },
    });
    const approve = document.querySelector<HTMLButtonElement>(
      "[data-import-approve-button]",
    );
    expect(approve?.disabled).toBe(true);
    fireEvent.click(screen.getByText("Read again with these columns"));
    await waitFor(() =>
      expect(o.prepare).toHaveBeenLastCalledWith({
        documentId: id(99),
        mapping: { ...MAPPING, notes: "Notes" },
      }),
    );
    await screen.findByText("Read with the columns you chose.");
    expect(
      document.querySelector<HTMLButtonElement>("[data-import-approve-button]")
        ?.disabled,
    ).toBe(false);
  });

  it("approves the exact proposal with the person's choices, then links the relationships", async () => {
    const o = ops();
    await upload(o);
    fireEvent.click(screen.getByLabelText("Atlas Robotics Inc"));
    fireEvent.click(
      document.querySelector("[data-import-approve-button]") as HTMLElement,
    );
    await screen.findByText("Imported");
    expect(o.apply).toHaveBeenCalledTimes(1);
    const sent = (o.apply.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(sent).toMatchObject({
      importId: id(1),
      documentId: id(99),
      proposalHash: "a".repeat(64),
      counts: { rows: 4, matched: 1, ambiguous: 1, new: 1, invalid: 1 },
      resolutions: [{ rowNumber: 2, choice: id(21) }],
    });
    expect(typeof sent["idempotencyKey"]).toBe("string");
    const links = document.querySelector("[data-import-links]");
    const link = within(links as HTMLElement).getByRole("link", {
      name: /Northwind/u,
    });
    expect(link.getAttribute("href")).toBe(`/relationships/company/${id(11)}`);
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the same key when an approval is retried after a failure", async () => {
    const o = ops({
      apply: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          message:
            "Couldn't finish the import just now. Approving again continues it without duplicates.",
        })
        .mockResolvedValue({ ok: false, message: "again" }),
    });
    await upload(o);
    const press = () =>
      fireEvent.click(
        document.querySelector("[data-import-approve-button]") as HTMLElement,
      );
    press();
    await screen.findByText(/Approving again continues it/u);
    press();
    await screen.findByText("again");
    const keys = (
      o.apply.mock.calls as unknown as [{ idempotencyKey: string }][]
    ).map(([input]) => input.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe("the import screen's model", () => {
  it("gives each field one column: choosing a held field frees the other column", () => {
    expect(assignColumn(MAPPING, "Notes", "owner")).toEqual({
      counterpartName: "Organization",
      stage: "Status",
      owner: "Notes",
    });
    expect(assignColumn(MAPPING, "Status", "")).toEqual({
      counterpartName: "Organization",
      owner: "Owners",
    });
  });

  it("only sends choices that are one of the row's candidates, keep or skip", () => {
    const p = preview();
    expect(
      resolutionsOf({ 2: id(22), 1: id(21), 3: "KEEP_PRIVATE" }, p),
    ).toEqual([{ rowNumber: 2, choice: id(22) }]);
    expect(resolutionsOf({ 2: id(99) }, p)).toEqual([]);
    expect(
      importedCount(p.counts, [{ rowNumber: 2, choice: "KEEP_PRIVATE" }]),
    ).toEqual({ linked: 1, kept: 2 });
  });

  it("words the reader's own side on a pipeline row, or nothing", () => {
    const t = (english: string) => english;
    expect(mySideWords(undefined, t)).toBeNull();
    expect(
      mySideWords(
        {
          stage: "DILIGENCE",
          stageLabel: "Deep dive",
          priority: "HIGH",
          ownerName: "Ada Obi",
        },
        t,
      ),
    ).toBe("Diligence · High priority · Ada Obi");
    expect(
      mySideWords(
        {
          stage: null,
          stageLabel: "Tracking",
          priority: null,
          ownerName: null,
        },
        t,
      ),
    ).toBe("Tracking");
    expect(
      mySideWords(
        { stage: null, stageLabel: null, priority: null, ownerName: null },
        t,
      ),
    ).toBeNull();
  });
});
