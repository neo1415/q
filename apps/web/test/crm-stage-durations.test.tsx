// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StageDurations } from "@/features/relationships/stage-durations";
import {
  durationWords,
  stageSpans,
} from "@/features/relationships/stage-spans";

afterEach(cleanup);

const now = Date.parse("2026-10-15T12:00:00.000Z");
const milestones = [
  { state: "CONNECTED" as const, at: "2026-10-05T12:00:00.000Z" },
  { state: "INTEREST_EXPRESSED" as const, at: "2026-10-01T12:00:00.000Z" },
  { state: "IN_DILIGENCE" as const, at: "2026-10-14T18:00:00.000Z" },
];

describe("time in each stage", () => {
  it("runs each stage to the next milestone and the current one to now", () => {
    const spans = stageSpans(milestones, now);
    expect(spans.map((span) => [span.state, durationWords(span.ms)])).toEqual([
      ["INTEREST_EXPRESSED", "4 days"],
      ["CONNECTED", "9 days"],
      ["IN_DILIGENCE", "under a day"],
    ]);
    expect(spans.at(-1)?.to).toBeNull();
  });

  it("draws nothing without a history of at least two stages", () => {
    expect(stageSpans(milestones.slice(0, 1), now)).toEqual([]);
    const { container } = render(
      <StageDurations milestones={milestones.slice(0, 1)} now={now} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("names every stage and the current one in words, not colour alone", () => {
    render(<StageDurations milestones={milestones} now={now} />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("4 days");
    expect(items[2]).toContain("now");
    expect(items[2]).toContain("under a day");
  });
});
