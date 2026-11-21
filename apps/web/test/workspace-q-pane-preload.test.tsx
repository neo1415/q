// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

/**
 * W4-E (production 21 Nov 2026): the Q pane's greeting is the largest
 * paint on Home and Settings in the Q Workspace. Its code is split from
 * the first download (W4-B), so it must be asked for the moment the pane's
 * module runs in the browser, beside hydration, never only when the pane
 * first renders after it.
 */
const loaded: string[] = [];

vi.mock("@/features/q/q-conversation", () => {
  loaded.push("q-conversation");
  return { QConversationPanel: () => null };
});
vi.mock("@/features/briefing/arrival-stage", () => {
  loaded.push("arrival-stage");
  return { ArrivalStage: () => null };
});

describe("the Q pane's code", () => {
  it("is fetched as soon as the pane's module loads, before anything renders it", async () => {
    await import("../src/features/workspace/workspace-q-pane-lazy");
    await vi.waitFor(() => {
      expect(loaded).toEqual(
        expect.arrayContaining(["q-conversation", "arrival-stage"]),
      );
    });
  });
});
