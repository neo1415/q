// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RelationshipPipelineDto,
  RelationshipPipelineQuery,
} from "@capital-q/contracts";
import { RelationshipPipeline } from "@/features/relationships/relationship-pipeline";
import { pipelinePresentedRows } from "@/features/relationships/pipeline-presentation";
import {
  controlOf,
  listItems,
  manifestControls,
  resetControls,
} from "@/features/q/control/registry";
import { performOnControl } from "@/features/q/control/perform";
import { noteRoute, resetRouteState } from "@/features/q/control/route-state";
const mock = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
const data: RelationshipPipelineDto = {
  total: 2,
  nextCursor: "next-cursor",
  items: [
    {
      relationshipId: "a0000000-0000-4000-8000-000000000001",
      counterpart: {
        kind: "COMPANY",
        id: "c0000000-0000-4000-8000-000000000001",
        name: "Kivu Freight",
      },
      state: "IN_DILIGENCE",
      stateSince: "2026-10-14T01:00:00.000Z",
      nextStep: "DECIDE_NEXT_STEP",
    },
    {
      relationshipId: "a0000000-0000-4000-8000-000000000002",
      counterpart: {
        kind: "COMPANY",
        id: "c0000000-0000-4000-8000-000000000002",
        name: "Maji",
      },
      state: "CONNECTED",
      stateSince: "2026-10-14T01:00:00.000Z",
      nextStep: "SCHEDULE_MEETING",
    },
  ],
};
const props = {
  data,
  query: {} as RelationshipPipelineQuery,
  scopeKey: "test:user:investor",
  layout: "table" as const,
  side: "INVESTOR" as const,
};
beforeEach(() => {
  window.localStorage.clear();
  mock.push.mockReset();
});
afterEach(() => {
  cleanup();
  resetControls();
  resetRouteState();
});
describe("real pipeline controls", () => {
  it("searches/filter/sorts through server URLs, preserving exact query scope", () => {
    render(<RelationshipPipeline {...props} />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search companies" }),
      { target: { value: "Maji" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(mock.push).toHaveBeenLastCalledWith(
      "/relationships?view=pipeline&layout=table&q=Maji",
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Relationship state" }),
      { target: { value: "IN_DILIGENCE" } },
    );
    expect(mock.push).toHaveBeenLastCalledWith(
      "/relationships?view=pipeline&layout=table&state=IN_DILIGENCE",
    );
  });
  it("exports exactly filtered scope or selection without a page cursor", () => {
    render(
      <RelationshipPipeline
        {...props}
        query={{
          q: "Kivu",
          state: "IN_DILIGENCE",
          cursor: "page",
          pageSize: 25,
        }}
      />,
    );
    expect(
      screen
        .getByRole("link", { name: "Export filtered CSV" })
        .getAttribute("href"),
    ).toBe("/relationships/export?q=Kivu&state=IN_DILIGENCE");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Kivu Freight" }),
    );
    expect(
      screen
        .getByRole("link", { name: "Export 1 selected" })
        .getAttribute("href"),
    ).toContain(`selected=${data.items[0]?.relationshipId}`);
  });
  it("saves, restores, renames and deletes view preferences without cursor authority", () => {
    const page = render(
      <RelationshipPipeline
        {...props}
        query={{ state: "CONNECTED", cursor: "page" }}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "Connected" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(screen.getByRole("option", { name: "Connected" })).toBeDefined();
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "Conversations" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename view" }));
    expect(screen.getByRole("option", { name: "Conversations" })).toBeDefined();
    const id = (
      screen.getByRole("option", { name: "Conversations" }) as HTMLOptionElement
    ).value;
    fireEvent.change(screen.getByRole("combobox", { name: "Saved view" }), {
      target: { value: id },
    });
    expect(mock.push).toHaveBeenLastCalledWith(
      "/relationships?view=pipeline&layout=table&state=CONNECTED",
    );
    page.unmount();
    render(<RelationshipPipeline {...props} />);
    expect(screen.getByRole("option", { name: "Conversations" })).toBeDefined();
    fireEvent.change(screen.getByRole("combobox", { name: "Saved view" }), {
      target: { value: id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete view" }));
    expect(screen.queryByRole("option", { name: "Conversations" })).toBeNull();
  });
  it("isolates another user's preferences and persists columns", () => {
    const page = render(<RelationshipPipeline {...props} />);
    const cols = screen.getByText("Columns").parentElement;
    if (cols === null) throw new Error("Missing columns");
    fireEvent.click(
      within(cols).getByRole("checkbox", { name: "State changed" }),
    );
    expect(
      screen.queryByRole("columnheader", { name: "State changed" }),
    ).toBeNull();
    page.unmount();
    render(<RelationshipPipeline {...props} scopeKey="other:user:role" />);
    expect(
      screen.getByRole("columnheader", { name: "State changed" }),
    ).toBeDefined();
  });
  it("uses the same canonical rows for board, with matching actual Q item order", () => {
    render(<RelationshipPipeline {...props} layout="board" />);
    const list = controlOf("list.pipeline")?.element();
    if (list === undefined || list === null) throw new Error("Missing list");
    expect(listItems(list).map((entry) => entry.textContent)).toEqual(
      pipelinePresentedRows(data.items, "board").map(
        (row) => row.counterpart.name,
      ),
    );
  });
  it("Q's table list items open records rather than selection checkboxes", () => {
    render(<RelationshipPipeline {...props} />);
    const list = controlOf("list.pipeline")?.element();
    if (list === undefined || list === null) throw new Error("Missing list");
    expect(listItems(list)[0]?.tagName).toBe("A");
    expect(listItems(list)[0]?.getAttribute("href")).toBe(
      `/relationships/company/${data.items[0]?.counterpart.id}`,
    );
  });
  it("opens an actual preview and native record link", () => {
    render(<RelationshipPipeline {...props} />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Preview" })[0] ?? document.body,
    );
    expect(screen.getByRole("dialog", { name: "Kivu Freight" })).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Open relationship" })
        .getAttribute("href"),
    ).toContain(data.items[0]?.counterpart.id);
  });
  it("Q filter receipt waits for settled route and actual returned data", async () => {
    const page = render(<RelationshipPipeline {...props} />);
    mock.push.mockImplementation((path: string) => {
      page.rerender(
        <RelationshipPipeline
          {...props}
          query={{ state: "IN_DILIGENCE" }}
          data={{
            ...data,
            items: [data.items[0] ?? data.items[1]].filter(
              (row) => row !== undefined,
            ),
            total: 1,
          }}
        />,
      );
      noteRoute(path);
    });
    const entry = controlOf("filter.pipeline-state");
    if (entry === undefined) throw new Error("Missing state control");
    let result: string | undefined;
    await act(async () => {
      result = await performOnControl(entry, {
        kind: "UI_ACT",
        actId: "uia_pipeline01",
        act: "FILTER",
        target: "filter.pipeline-state",
        value: "IN_DILIGENCE",
      });
    });
    expect(result).toBe("DONE");
    expect(
      manifestControls().some((entry) => entry.id === "filter.pipeline-view"),
    ).toBe(true);
  });
  it("rejects invalid Q state/search values before navigation", async () => {
    render(<RelationshipPipeline {...props} />);
    const entry = controlOf("filter.pipeline-state");
    if (entry === undefined) throw new Error("Missing control");
    expect(
      await performOnControl(entry, {
        kind: "UI_ACT",
        actId: "uia_pipeline02",
        act: "FILTER",
        target: "filter.pipeline-state",
        value: "HOT_DEAL",
      }),
    ).toBe("NOT_APPLICABLE");
    expect(mock.push).not.toHaveBeenCalled();
  });
});
