import { describe, expect, it } from "vitest";

import {
  INVESTOR_V6_ACTOR,
  INVESTOR_V6_LEDGER,
  INVESTOR_V6_SCRIPT,
  buildStepGraph,
  certifyTour,
} from "../src/index.js";

const scenes = INVESTOR_V6_SCRIPT.scenes;
const lines = scenes.flatMap((s) => s.lines);

describe("the investor track (v6)", () => {
  it("is a numbered step graph, each step id carrying its own number", () => {
    const graph = buildStepGraph(INVESTOR_V6_SCRIPT);
    expect(graph.steps).toHaveLength(22);
    graph.steps.forEach((step) => {
      expect(step.stepId).toMatch(
        new RegExp(
          `^s\\.inv\\.${String(step.number).padStart(2, "0")}\\.`,
          "u",
        ),
      );
    });
  });

  it("follows the owner's order: intro, matches, Discover, the profile's tabs, Explore, the record, Capital, CRM, Work, Daily, GateQ, hand-over", () => {
    expect(scenes.map((s) => s.sceneId.split(".").slice(3).join("."))).toEqual([
      "home.intro",
      "discover.match",
      "discover.feed",
      "profile.overview",
      "profile.diligence",
      "profile.elevator",
      "profile.dataroom",
      "profile.deck",
      "profile.team",
      "explore.mosaic",
      "relationship.record",
      "relationship.messages",
      "relationship.calls",
      "capital.commitments",
      "crm.overview",
      "crm.pipeline",
      "work.agents",
      "work.team",
      "daily.edition",
      "gateq.application",
      "documents.library",
      "home.close",
    ]);
  });

  it("lights every section it talks about, each anchor its own step's", () => {
    for (const scene of scenes.slice(1, -1)) {
      const step = scene.sceneId.split(".")[2] ?? "";
      const after = scene.lines.filter((l) => l.timing === "AFTER_ACK");
      expect(after.length, scene.sceneId).toBeGreaterThan(0);
      for (const line of after) {
        expect(line.anchor, line.lineId).toBeDefined();
        expect(line.anchor?.startsWith(`inv.${step}.`), line.lineId).toBe(true);
      }
    }
  });

  it("passes the certification gate for its own investor account", () => {
    const gate = certifyTour(INVESTOR_V6_SCRIPT, INVESTOR_V6_LEDGER, {
      now: "2026-10-17T00:00:00Z",
      staleFeatureIds: [],
      acceptedStatuses: ["PRODUCTION_LIVE_VERIFIED", "CODE_VERIFIED"],
      audience: "INTERNAL_REHEARSAL",
    });
    expect(gate.rejectedLines).toEqual([]);
    expect(gate.decisions.every((d) => d.verdict === "ADMITTED")).toBe(true);
    for (const scene of scenes) expect(scene.actor).toEqual(INVESTOR_V6_ACTOR);
  });

  it("is honest: no traction, customers, revenue, investors or team size for Capital Q, and no onboarding screens", () => {
    const invented =
      /\b\d[\d,.]*\s*(?:k|m|million)?\s*(?:customers|clients|users|investors|employees)\b|\b(?:arr|mrr)\b|\brevenue of\b/iu;
    for (const line of lines) {
      expect(invented.test(line.text), line.lineId).toBe(false);
    }
    expect(lines.map((l) => l.text).join(" ")).toMatch(
      /pre-seed and bootstrapping/u,
    );
    expect(scenes.some((s) => s.expectedRoute.includes("onboarding"))).toBe(
      false,
    );
    expect(lines[1]?.text).toMatch(/I interview you/u);
  });

  it("fits a premiere: narration under eight minutes at a presenter's pace", () => {
    const words =
      lines.join(" ").length === 0
        ? 0
        : lines
            .map((l) => l.text)
            .join(" ")
            .split(/\s+/u).length;
    expect(words / 150).toBeLessThan(8);
  });
});
