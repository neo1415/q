import { describe, expect, it } from "vitest";

import {
  PREMIERE_SCRIPT,
  SceneLineSchema,
  buildStepGraph,
} from "../src/index.js";

describe("the step graph (v6: steps addressed by id)", () => {
  const graph = buildStepGraph(PREMIERE_SCRIPT);

  it("numbers every scene from 1 and links each to its neighbours", () => {
    expect(graph.steps).toHaveLength(PREMIERE_SCRIPT.scenes.length);
    graph.steps.forEach((step, index) => {
      expect(step.number).toBe(index + 1);
      expect(step.prevId).toBe(graph.steps[index - 1]?.stepId ?? null);
      expect(step.nextId).toBe(graph.steps[index + 1]?.stepId ?? null);
      expect(graph.byId(step.stepId)).toBe(step);
      expect(graph.byNumber(step.number)).toBe(step);
    });
    expect(graph.byNumber(0)).toBeNull();
    expect(graph.byId("s.nope")).toBeNull();
  });
});

describe("a line about a section", () => {
  const base = {
    lineId: "l.inv.07.moats",
    kind: "CONNECTIVE" as const,
    text: "Here is what keeps it defensible.",
    claimIds: [],
    source: "v6",
  };

  it("names its section by stable id and is spoken once the page is there", () => {
    expect(
      SceneLineSchema.safeParse({
        ...base,
        timing: "AFTER_ACK",
        anchor: "inv.07.profile.overview.moats",
        open: true,
      }).success,
    ).toBe(true);
    expect(
      SceneLineSchema.safeParse({
        ...base,
        timing: "BEFORE_ACK",
        anchor: "inv.07.profile.overview.moats",
      }).success,
    ).toBe(false);
  });

  it("refuses a selector or URL as an anchor, and open without one", () => {
    for (const anchor of [".cq-shell main", "/company/x", "inv.7.profile"]) {
      expect(
        SceneLineSchema.safeParse({ ...base, timing: "AFTER_ACK", anchor })
          .success,
      ).toBe(false);
    }
    expect(
      SceneLineSchema.safeParse({ ...base, timing: "AFTER_ACK", open: true })
        .success,
    ).toBe(false);
  });
});
