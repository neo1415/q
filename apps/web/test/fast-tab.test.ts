// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  navigationHeard,
  resetFastNavigation,
  setNavigationTransport,
} from "../src/features/q/control/fast-navigation";
import {
  registerControl,
  resetControls,
} from "../src/features/q/control/registry";

/**
 * Turn latency 2026-10-20 (owner: "open the data room", "the pitch deck"
 * took 1.6-2 s, after a turn reading): a tab of the page on screen is that
 * page's own registered control, selected in the same task by code. No
 * server round trip, no model.
 */

afterEach(() => {
  resetControls();
  resetFastNavigation();
});

function tab(id: string) {
  const acts: string[] = [];
  registerControl({
    id,
    kind: "TAB",
    element: () => document.body,
    onAct: (intent) => {
      acts.push(intent.act);
      return Promise.resolve("DONE");
    },
  });
  return acts;
}

describe("a tab of this page, by its name", () => {
  it.each([
    ["open the data room", "tab.dataroom"],
    ["Now the pitch deck.", "tab.deck"],
    ["show me the team tab", "tab.team"],
  ])("%s selects %s at once, with no server call", async (said, id) => {
    const transport = vi.fn();
    setNavigationTransport(transport);
    const acts = tab(id);
    const started = performance.now();
    const moved = await navigationHeard(said);
    expect(performance.now() - started).toBeLessThan(300);
    expect(moved).toMatchObject({ path: `#${id}` });
    await Promise.resolve();
    expect(acts).toEqual(["SELECT_TAB"]);
    expect(transport).not.toHaveBeenCalled();
  });

  it("a tab this page does not have is left to Q", async () => {
    tab("tab.overview");
    expect(await navigationHeard("now the pitch deck")).toBeNull();
  });

  it("another record's tab is not this page's", async () => {
    const acts = tab("tab.deck");
    setNavigationTransport(() =>
      Promise.resolve({ kind: "LEAVE_TO_Q", ms: 1 }),
    );
    await navigationHeard("open Nixo's pitch deck");
    expect(acts).toEqual([]);
  });

  it("words taken back never move", async () => {
    const acts = tab("tab.dataroom");
    await navigationHeard("open the data room, no wait, never mind");
    expect(acts).toEqual([]);
  });
});
