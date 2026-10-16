import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CAPITAL_Q_PITCH,
  DEMO_INVESTORS,
  FOUNDER_QA_ENTRIES,
  FOUNDER_V6_ACTOR,
  FOUNDER_V6_LEDGER,
  FOUNDER_V6_PRESENTER_LINES,
  FOUNDER_V6_SCRIPT,
  QA_BANK,
  buildQaIndex,
  buildStepGraph,
  certifyTour,
  demoInvestor,
  pitchSectionAnchor,
} from "../src/index.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");

/** The same honesty rule the Q&A bank holds every answer to. */
const INVENTED =
  /\b\d[\d,.]*\s*(?:k|m|million)?\s*(?:customers|clients|users|investors|employees|people|staff)\b|\b(?:arr|mrr)\b|\brevenue of\b|\bteam of \d|\bwe have (?:signed|raised)\b|\b(?:paying|our) customers\b/iu;

const narration = FOUNDER_V6_SCRIPT.scenes.flatMap((scene) =>
  [...scene.lines, ...scene.fallbackLines].map((line) => line.text),
);

describe("the founder track (v6)", () => {
  const graph = buildStepGraph(FOUNDER_V6_SCRIPT);

  it("is a numbered step graph, each step id carrying its own number", () => {
    expect(graph.steps.length).toBe(16);
    graph.steps.forEach((step, index) => {
      const nn = String(index + 1).padStart(2, "0");
      expect(step.number).toBe(index + 1);
      expect(step.stepId.startsWith(`s.fdr.${nn}.`), step.stepId).toBe(true);
      expect(step.prevId).toBe(graph.steps[index - 1]?.stepId ?? null);
      expect(step.nextId).toBe(graph.steps[index + 1]?.stepId ?? null);
      expect(graph.byNumber(index + 1)).toBe(step);
    });
  });

  it("anchors every section it talks about to its own step", () => {
    for (const step of graph.steps) {
      const nn = step.stepId.slice("s.fdr.".length, "s.fdr.".length + 2);
      for (const anchor of step.anchors) {
        expect(anchor.startsWith(`fdr.${nn}.`), anchor).toBe(true);
      }
    }
    // The page steps light at least one section each; only the
    // notification panel (a dialog Q opens) and the hand-over have none.
    const unlit = graph.steps.filter((s) => s.anchors.length === 0);
    expect(unlit.map((s) => s.stepId)).toEqual([
      "s.fdr.11.notifications.panel",
      "s.fdr.16.home.close",
    ]);
  });

  it("passes the certification gate for its own founder account", () => {
    const gate = certifyTour(FOUNDER_V6_SCRIPT, FOUNDER_V6_LEDGER, {
      now: "2026-10-16T22:00:00Z",
      staleFeatureIds: [],
      acceptedStatuses: ["PRODUCTION_LIVE_VERIFIED", "CODE_VERIFIED"],
      audience: "INTERNAL_REHEARSAL",
    });
    expect(gate.rejectedLines).toEqual([]);
    expect(gate.decisions.every((d) => d.verdict === "ADMITTED")).toBe(true);
    for (const scene of FOUNDER_V6_SCRIPT.scenes) {
      expect(scene.actor).toEqual(FOUNDER_V6_ACTOR);
    }
  });

  it("does not admit an uncertified audience run", () => {
    const gate = certifyTour(FOUNDER_V6_SCRIPT, FOUNDER_V6_LEDGER, {
      now: "2026-10-16T22:00:00Z",
      staleFeatureIds: [],
      audience: "AUDIENCE",
    });
    expect(gate.scenes).toHaveLength(0);
  });

  it("opens only fictional demo investors, by key", () => {
    for (const scene of FOUNDER_V6_SCRIPT.scenes) {
      for (const action of scene.actions) {
        if (action.kind === "openInvestor") {
          expect(demoInvestor(action.investor), action.investor).not.toBeNull();
        }
      }
    }
    expect(Object.keys(DEMO_INVESTORS)).toContain("sahel-bridge-ventures");
  });

  it("is honest: pre-seed, bootstrapping, no invented traction or team", () => {
    for (const text of narration) {
      expect(INVENTED.test(text), text).toBe(false);
    }
    const all = narration.join(" ").toLowerCase();
    expect(all).toContain("pre-seed");
    expect(all).toContain("bootstrap");
    expect(all).toContain("no claim about its size");
    // No onboarding screens (owner addendum, 16 Oct): one line, no step.
    expect(
      FOUNDER_V6_SCRIPT.scenes.some((s) =>
        s.actions.some(
          (a) =>
            a.kind === "openRoute" && a.destination.startsWith("INTERVIEW"),
        ),
      ),
    ).toBe(false);
    expect(all).toContain("i interview you to onboard you");
  });
});

describe("Capital Q on the fourteen-section template", () => {
  it("follows the owner's template, in order", () => {
    expect(CAPITAL_Q_PITCH.map((s) => s.title)).toEqual([
      "Opportunity and Economics",
      "The Problem",
      "Solution",
      "How It Works",
      "Business Model",
      "Our Vision",
      "Our Team",
      "Go-to-Market Strategy",
      "Competitive Landscape",
      "Moats",
      "Roadmap",
      "Why Us? Why Now?",
      "Our Ask",
      "Closing",
    ]);
  });

  it("is narrated section by section, each section lit and opened", () => {
    const pitch = FOUNDER_V6_SCRIPT.scenes[1];
    const anchored = (pitch?.lines ?? []).filter((l) => l.anchor !== undefined);
    expect(anchored.map((l) => l.anchor)).toEqual(
      CAPITAL_Q_PITCH.map((s) => pitchSectionAnchor(s.key)),
    );
    expect(anchored.every((l) => l.open === true)).toBe(true);
  });

  it("states no traction, labels the raise as a claim, and names real sources", () => {
    for (const section of CAPITAL_Q_PITCH) {
      for (const text of [section.summary, ...section.points]) {
        expect(INVENTED.test(text), text).toBe(false);
      }
      for (const source of section.sources) {
        const path = source.split(" ")[0] ?? "";
        if (!path.includes("/")) continue;
        expect(existsSync(join(ROOT, path)), `${section.key}: ${path}`).toBe(
          true,
        );
      }
    }
    const ask = CAPITAL_Q_PITCH.find((s) => s.key === "ask");
    expect(ask?.standing).toBe("FOUNDER_CLAIM");
    expect(CAPITAL_Q_PITCH.find((s) => s.key === "team")?.standing).toBe(
      "NOT_KNOWN",
    );
  });
});

describe("Q-to-Q: Q presents Capital Q", () => {
  it("speaks only prepared lines, in the presenter's role", () => {
    const [open, ...rest] = FOUNDER_V6_PRESENTER_LINES;
    expect(open?.text).toMatch(/I'm presenting Capital Q/u);
    for (const line of FOUNDER_V6_PRESENTER_LINES) {
      // First person, as the company presenting; never the investor's
      // side asking about "your company" or "your mandate".
      expect(line.text, line.questionId).toMatch(
        /\b(?:I|I'm|we|We|We're|our|Our)\b/u,
      );
      expect(line.text).not.toMatch(
        /\byour (?:company|startup|business|mandate|fund)\b/iu,
      );
      expect(INVENTED.test(line.text), line.questionId).toBe(false);
      expect(line.text).not.toMatch(/Harbourline/iu);
    }
    expect(rest.length).toBeGreaterThan(0);
    const scene = FOUNDER_V6_SCRIPT.scenes.find((s) =>
      s.actions.some((a) => a.kind === "runShortRehearsal"),
    );
    const run = scene?.actions.find((a) => a.kind === "runShortRehearsal");
    expect(run?.kind === "runShortRehearsal" && run.lines).toEqual(
      FOUNDER_V6_PRESENTER_LINES.map((l) => l.questionId),
    );
    expect(run?.kind === "runShortRehearsal" && run.maxMs).toBeLessThanOrEqual(
      45_000,
    );
    // It says aloud that the other voice is a simulation.
    expect(scene?.lines.map((l) => l.text).join(" ")).toMatch(
      /labelled simulation/u,
    );
  });
});

describe("founder questions", () => {
  const founder = buildQaIndex("FOUNDER");
  it("are in the bank and answered by meaning", () => {
    for (const entry of FOUNDER_QA_ENTRIES) {
      expect(QA_BANK.map((e) => e.id)).toContain(entry.id);
    }
    expect(
      founder.answer("Is the investor I rehearse with a real person?")?.id,
    ).toBe("qa.founder.rehearsal");
    expect(founder.answer("Can I just send a fund a cold message?")?.id).toBe(
      "qa.founder.reach-investor",
    );
    expect(founder.answer("Why did these investors show up for me?")?.id).toBe(
      "qa.founder.which-investors",
    );
  });
});
