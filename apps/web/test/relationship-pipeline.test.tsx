// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "react-dom";
import {
  RELATIONSHIP_STATES_V2,
  type RelationshipPipelineDto,
  type RelationshipPipelineQuery,
} from "@capital-q/contracts";
import { RelationshipPipeline } from "@/features/relationships/relationship-pipeline";
import {
  BOARD_STATES,
  pipelinePresentedRows,
} from "@/features/relationships/pipeline-presentation";
import {
  controlOf,
  listItems,
  manifestControls,
  resetControls,
} from "@/features/q/control/registry";
import { performOnControl } from "@/features/q/control/perform";
import { noteRoute, resetRouteState } from "@/features/q/control/route-state";
const mock = vi.hoisted(() => ({
  push: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock("@/features/relationships/pipeline-view-actions", () => ({
  savePipelineViewAction: mock.save,
  deletePipelineViewAction: mock.remove,
}));
const saved = (input: Record<string, unknown>, id: string, version = 1) => ({
  ok: true as const,
  value: {
    id,
    name: input["name"],
    query: input["query"],
    layout: input["layout"],
    columns: input["columns"],
    scope: input["scope"],
    version,
    updatedAt: "2026-10-15T10:00:00.000Z",
    editable: true,
  },
});
const data: RelationshipPipelineDto = {
  total: 2,
  scope: "1".repeat(64),
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
  mock.save.mockReset();
  mock.remove.mockReset();
  mock.save.mockImplementation((id: string, input: Record<string, unknown>) =>
    Promise.resolve(saved(input, id, Number(input["expectedVersion"]) + 1)),
  );
  mock.remove.mockResolvedValue({ ok: true, value: true });
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
  it("preserves selection across pages and clears it on authorized scope change", () => {
    const page = render(<RelationshipPipeline {...props} />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Kivu Freight" }),
    );
    page.rerender(
      <RelationshipPipeline
        {...props}
        data={{
          ...data,
          items: data.items.slice(1, 2),
        }}
        query={{ cursor: "second" }}
      />,
    );
    expect(
      screen
        .getByRole("link", { name: "Export 1 selected" })
        .getAttribute("href"),
    ).toContain(data.items.at(0)?.relationshipId);
    page.rerender(
      <RelationshipPipeline
        {...props}
        data={{ ...data, scope: "2".repeat(64) }}
        query={{ state: "CONNECTED" }}
      />,
    );
    expect(
      screen.queryByRole("link", { name: "Export 1 selected" }),
    ).toBeNull();
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
    ).toBe(
      `/relationships/export?scope=${"1".repeat(64)}&q=Kivu&state=IN_DILIGENCE`,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Kivu Freight" }),
    );
    expect(
      screen
        .getByRole("link", { name: "Export 1 selected" })
        .getAttribute("href"),
    ).toContain(`selected=${data.items[0]?.relationshipId}`);
  });
  it("saves, renames, opens and deletes server views without cursor authority", async () => {
    render(
      <RelationshipPipeline
        {...props}
        views={{ items: [], teamEditable: false }}
        query={{ state: "CONNECTED", cursor: "page" }}
      />,
    );
    // Only an organisation admin may share with the team.
    expect(
      screen.queryByRole("combobox", { name: "Who sees this view" }),
    ).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "Connected" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    const option = await within(
      screen.getByRole("combobox", { name: "Saved view" }),
    ).findByRole<HTMLOptionElement>("option", { name: "Connected" });
    const [id, body] = (mock.save.mock.calls[0] ?? []) as [string, unknown];
    expect(body).toEqual({
      name: "Connected",
      query: { state: "CONNECTED" },
      layout: "table",
      columns: ["state", "since", "next"],
      scope: "PERSONAL",
      expectedVersion: 0,
    });
    expect(option.value).toBe(id);
    expect(option.parentElement?.getAttribute("label")).toBe("Mine");
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "Conversations" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename view" }));
    expect(
      await screen.findByRole("option", { name: "Conversations" }),
    ).toBeDefined();
    expect(
      (mock.save.mock.calls[1] as unknown[] | undefined)?.[1],
    ).toMatchObject({
      name: "Conversations",
      expectedVersion: 1,
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Saved view" }), {
      target: { value: id },
    });
    expect(mock.push).toHaveBeenLastCalledWith(
      "/relationships?view=pipeline&layout=table&state=CONNECTED",
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete view" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "Conversations" }),
      ).toBeNull(),
    );
    expect(mock.remove).toHaveBeenCalledWith(id, 2);
  });
  it("shows team views read-only to members and lets admins share", async () => {
    const team = {
      id: "f0000000-0000-4000-8000-000000000001",
      name: "Team diligence",
      query: { state: "IN_DILIGENCE" as const },
      layout: "board" as const,
      columns: ["state" as const],
      scope: "ORGANISATION" as const,
      version: 3,
      updatedAt: "2026-10-15T10:00:00.000Z",
      editable: false,
    };
    const member = render(
      <RelationshipPipeline
        {...props}
        views={{ items: [team], teamEditable: false }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Saved view" }), {
      target: { value: team.id },
    });
    expect(mock.push).toHaveBeenLastCalledWith(
      "/relationships?view=pipeline&layout=board&state=IN_DILIGENCE",
    );
    expect(screen.queryByRole("button", { name: "Delete view" })).toBeNull();
    member.unmount();
    render(
      <RelationshipPipeline
        {...props}
        views={{ items: [], teamEditable: true }}
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Who sees this view" }),
      { target: { value: "ORGANISATION" } },
    );
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "Shared" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    const option = await screen.findByRole("option", { name: "Shared" });
    expect(option.parentElement?.getAttribute("label")).toBe("Team");
  });
  it("says views couldn't load and keeps older device views removable", () => {
    window.localStorage.setItem(
      props.scopeKey,
      JSON.stringify({
        views: [
          {
            id: "e0000000-0000-4000-8000-000000000001",
            name: "Old device view",
            query: {},
            layout: "table",
            columns: ["state"],
          },
        ],
        columns: ["state", "since", "next"],
        layout: "table",
      }),
    );
    render(<RelationshipPipeline {...props} views={null} />);
    expect(
      screen.getByRole("option", { name: "Saved views couldn't load" }),
    ).toBeDefined();
    expect(
      screen
        .getByRole<HTMLButtonElement>("button", { name: "Save view" })
        .hasAttribute("disabled"),
    ).toBe(true);
    const old = screen.getByRole("option", { name: "Old device view" });
    expect(old.parentElement?.getAttribute("label")).toBe("On this device");
    fireEvent.change(screen.getByRole("combobox", { name: "Saved view" }), {
      target: { value: "e0000000-0000-4000-8000-000000000001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete view" }));
    expect(
      screen.queryByRole("option", { name: "Old device view" }),
    ).toBeNull();
    expect(mock.remove).not.toHaveBeenCalled();
  });
  it("folds the controls behind a View options summary of the view in use", () => {
    const { container } = render(
      <RelationshipPipeline
        {...props}
        layout="board"
        query={{ state: "CONNECTED", sort: "name" }}
      />,
    );
    const panel = container.querySelector("[data-pipeline-options]");
    expect(panel?.tagName).toBe("DETAILS");
    expect(panel?.querySelector("summary")?.textContent).toBe(
      "View optionsConnected · Name A–Z · Board",
    );
    // Search stays outside the panel; filters, views and layout are inside.
    expect(
      panel?.contains(
        screen.getByRole("textbox", { name: "Search companies" }),
      ),
    ).toBe(false);
    for (const name of [
      "Relationship state",
      "Sort relationships",
      "Saved view",
    ]) {
      expect(panel?.contains(screen.getByRole("combobox", { name }))).toBe(
        true,
      );
    }
  });
  it("shows Suitability and Investability as table columns, unknown as —, and keeps Suitability the default sort", () => {
    const scores = {
      "c0000000-0000-4000-8000-000000000001": {
        suitability: 74,
        investability: null,
      },
    };
    render(
      <RelationshipPipeline
        {...props}
        data={{ ...data, nextCursor: null }}
        scores={scores}
        ranked
      />,
    );
    const headers = screen
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers.slice(1, 4)).toEqual([
      "Company",
      "Suitability",
      "Investability",
    ]);
    const kivu = screen
      .getByRole("link", { name: "Kivu Freight" })
      .closest("tr");
    const cells = [...(kivu?.querySelectorAll("td") ?? [])].map(
      (td) => td.textContent,
    );
    expect(cells[2]).toBe("74");
    expect(cells[3]).toBe("—Not known yet");
    // A company the Q API did not score: both unknown, never 0.
    const maji = screen.getByRole("link", { name: "Maji" }).closest("tr");
    expect(
      [...(maji?.querySelectorAll("td") ?? [])]
        .slice(2, 4)
        .map((td) => td.textContent),
    ).toEqual(["—Not known yet", "—Not known yet"]);

    const sort = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Sort relationships",
    });
    expect(sort.value).toBe("suitability");
    fireEvent.change(sort, { target: { value: "recent" } });
    expect(mock.push).toHaveBeenLastCalledWith(
      "/relationships?view=pipeline&layout=table&sort=recent",
    );
  });
  it("keeps a chosen sort, and Suitability returns to the default URL", () => {
    render(
      <RelationshipPipeline
        {...props}
        query={{ sort: "name" }}
        scores={{}}
        ranked={false}
      />,
    );
    const sort = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Sort relationships",
    });
    expect(sort.value).toBe("name");
    fireEvent.change(sort, { target: { value: "suitability" } });
    expect(mock.push).toHaveBeenLastCalledWith(
      "/relationships?view=pipeline&layout=table",
    );
  });
  it("says a ranked view with more pages ranks within each page", () => {
    render(<RelationshipPipeline {...props} scores={{}} ranked />);
    expect(
      screen.getByText(/ranked by suitability within each page/),
    ).toBeDefined();
  });
  it("shows labelled scores on Board cards", () => {
    const { container } = render(
      <RelationshipPipeline
        {...props}
        layout="board"
        scores={{
          "c0000000-0000-4000-8000-000000000002": {
            suitability: 55,
            investability: 70,
          },
        }}
        ranked
      />,
    );
    const card = container.querySelector('[data-board-column="CONNECTED"] li');
    expect(card?.querySelector("[data-pipeline-scores]")?.textContent).toBe(
      "Suitability55Investability70",
    );
  });
  it("orders Board columns forward path first, every state once", () => {
    expect([...BOARD_STATES].toSorted()).toEqual(
      [...RELATIONSHIP_STATES_V2].toSorted(),
    );
    expect(BOARD_STATES.indexOf("DECLINED")).toBeGreaterThan(
      BOARD_STATES.indexOf("INVESTED"),
    );
    const { container } = render(
      <RelationshipPipeline {...props} layout="board" />,
    );
    expect(
      [...container.querySelectorAll("[data-board-column]")].map((column) =>
        column.getAttribute("data-board-column"),
      ),
    ).toEqual(["CONNECTED", "IN_DILIGENCE"]);
    expect(
      screen.getByRole("heading", { name: "In diligence 1" }),
    ).toBeDefined();
  });
  it("an empty view says why and offers the one way out", () => {
    const empty = { ...data, total: 0, items: [], nextCursor: null };
    const page = render(
      <RelationshipPipeline
        {...props}
        data={empty}
        query={{ state: "CONNECTED", sort: "name" }}
      />,
    );
    expect(screen.getByText("No relationships match this view.")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Clear filters" }).getAttribute("href"),
    ).toBe("/relationships?view=pipeline&layout=table&sort=name");
    page.rerender(<RelationshipPipeline {...props} data={empty} />);
    expect(screen.getByText("No relationships yet.")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Open Discover" }).getAttribute("href"),
    ).toBe("/discover");
    // Nothing to page through: no pagination at all.
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
  });
  it("says an upper-bound total as one", () => {
    render(
      <RelationshipPipeline {...props} data={{ ...data, totalExact: false }} />,
    );
    expect(screen.getByText(/up to 2 matching relationships/)).toBeDefined();
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
      flushSync(() =>
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
        ),
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

it("Q search filters through the server and confirms the resulting query", async () => {
  const page = render(<RelationshipPipeline {...props} />);
  mock.push.mockImplementation((path: string) => {
    flushSync(() =>
      page.rerender(
        <RelationshipPipeline
          {...props}
          query={{ q: "Maji" }}
          data={{
            ...data,
            items: data.items.filter((row) => row.counterpart.name === "Maji"),
            total: 1,
          }}
        />,
      ),
    );
    noteRoute(path);
  });
  const entry = controlOf("filter.pipeline-search");
  if (!entry) throw new Error("Missing executable search filter");
  let status: string | undefined;
  await act(async () => {
    status = await performOnControl(entry, {
      kind: "UI_ACT",
      actId: "uia_searchpipeline01",
      act: "FILTER",
      target: "filter.pipeline-search",
      value: "Maji",
    });
  });
  expect(status).toBe("DONE");
  expect(mock.push).toHaveBeenLastCalledWith(
    "/relationships?view=pipeline&layout=table&q=Maji",
  );
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "Search companies" })
      .value,
  ).toBe("Maji");
});

describe("Unicorn Potential in the Pipeline (owner 2026-10-18)", () => {
  const kivu = "c0000000-0000-4000-8000-000000000001";
  const maji = "c0000000-0000-4000-8000-000000000002";
  const premium = {
    [kivu]: {
      suitability: 74,
      investability: 61,
      unicorn: { status: "SCORED" as const, score: 67 },
    },
    [maji]: {
      suitability: 50,
      investability: null,
      unicorn: { status: "INSUFFICIENT_EVIDENCE" as const, score: null },
    },
  };

  it("adds a third column with the score or the honest words, each opening the assessment", () => {
    render(
      <RelationshipPipeline
        {...props}
        data={{ ...data, nextCursor: null }}
        scores={premium}
        ranked
      />,
    );
    const headers = screen
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers.slice(1, 5)).toEqual([
      "Company",
      "Suitability",
      "Investability",
      "Unicorn Potential",
    ]);
    const score = screen.getByRole("link", {
      name: "Unicorn Potential 67. Open the assessment",
    });
    expect(score.getAttribute("href")).toBe(
      `/company/${kivu}#unicorn-potential-${kivu}`,
    );
    const words = screen.getByRole("link", {
      name: "Unicorn Potential: Insufficient evidence. Open the assessment",
    });
    expect(words.textContent).toBe("Insufficient evidence");
    expect(words.textContent).not.toContain("0");
  });

  it("shows no Unicorn column, option or filter without premium", () => {
    render(
      <RelationshipPipeline
        {...props}
        query={{ sort: "unicorn-60" }}
        scores={{ [kivu]: { suitability: 74, investability: 61 } }}
        ranked={false}
      />,
    );
    expect(
      screen
        .getAllByRole("columnheader")
        .map((th) => th.textContent)
        .includes("Unicorn Potential"),
    ).toBe(false);
    expect(
      screen.queryByRole("combobox", { name: "Unicorn Potential" }),
    ).toBeNull();
    expect(document.querySelector("[data-unicorn-link]")).toBeNull();
  });

  it("sorts and narrows through the URL, keeping search and state, and exports without the view", () => {
    render(
      <RelationshipPipeline
        {...props}
        query={{ q: "kivu", state: "IN_DILIGENCE" }}
        scores={premium}
        ranked
      />,
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Sort relationships" }),
      { target: { value: "unicorn" } },
    );
    expect(mock.push).toHaveBeenLastCalledWith(
      "/relationships?view=pipeline&layout=table&q=kivu&state=IN_DILIGENCE&sort=unicorn",
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Unicorn Potential" }),
      { target: { value: "unicorn-60" } },
    );
    expect(mock.push).toHaveBeenLastCalledWith(
      "/relationships?view=pipeline&layout=table&q=kivu&state=IN_DILIGENCE&sort=unicorn-60",
    );
    cleanup();
    render(
      <RelationshipPipeline
        {...props}
        query={{ sort: "unicorn-60" }}
        scores={premium}
      />,
    );
    const exportLink = screen.getByRole("link", {
      name: "Export filtered CSV",
    });
    expect(exportLink.getAttribute("href")).not.toContain("unicorn");
    expect(screen.getByText(/ranked by Unicorn Potential/)).toBeDefined();
    expect(
      screen.getByText(/Insufficient evidence is not a low score/),
    ).toBeDefined();
  });

  it("an empty Unicorn narrowing says so and returns to every relationship", () => {
    render(
      <RelationshipPipeline
        {...props}
        data={{ ...data, items: [], total: 0, nextCursor: null }}
        query={{ state: "CONNECTED", sort: "unicorn-80" }}
        scores={premium}
      />,
    );
    expect(
      screen.getByText(
        "No company in this view has a Unicorn Potential score here yet.",
      ),
    ).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Show all relationships" })
        .getAttribute("href"),
    ).toBe("/relationships?view=pipeline&layout=table&state=CONNECTED");
  });

  it("saves a Unicorn view as the view's sort", async () => {
    render(
      <RelationshipPipeline
        {...props}
        query={{ sort: "unicorn-40" }}
        scores={premium}
        views={{ items: [], teamEditable: false }}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), {
      target: { value: "Unicorn 40+" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    const option = await within(
      screen.getByRole("combobox", { name: "Saved view" }),
    ).findByRole<HTMLOptionElement>("option", { name: "Unicorn 40+" });
    const input = mock.save.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(input["query"]).toEqual({ sort: "unicorn-40" });
    // Opening it again re-runs the same view through the URL.
    fireEvent.change(screen.getByRole("combobox", { name: "Saved view" }), {
      target: { value: option.value },
    });
    expect(mock.push).toHaveBeenLastCalledWith(
      "/relationships?view=pipeline&layout=table&sort=unicorn-40",
    );
  });

  it("shows the three scores, labelled, on Board cards", () => {
    const { container } = render(
      <RelationshipPipeline
        {...props}
        layout="board"
        scores={premium}
        ranked
      />,
    );
    const card = container.querySelector('[data-board-column="CONNECTED"] li');
    expect(card?.querySelector("[data-pipeline-scores]")?.textContent).toBe(
      "Suitability50Investability—Not known yetUnicorn PotentialInsufficient evidence",
    );
  });
});
