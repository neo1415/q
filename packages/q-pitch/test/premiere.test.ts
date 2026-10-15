import { describe, expect, it } from "vitest";

import {
  ATLAS_SCRIPT,
  PILOT_SCRIPT,
  PREMIERE_CERTIFICATION_LEDGER,
  PREMIERE_SCRIPT,
  TourControlGate,
  certifyTour,
  classifyAudienceJump,
  demoCompany,
  classifyAudienceSpeech,
  type TranscriptSegment,
} from "../src/index.js";

const NOW = "2026-10-15T12:00:00Z";

const MAIN = [
  "s.premiere.intro",
  "s.premiere.mandate",
  "s.premiere.feed",
  "s.premiere.save",
  "s.pilot.opening",
  "s.pilot.company",
  "s.pilot.compare",
  "s.premiere.gateq",
  "s.premiere.relationship",
  "s.premiere.crm-record",
  "s.premiere.meeting",
  "s.premiere.work",
  "s.premiere.documents",
  "s.premiere.notifications",
  "s.premiere.rehearsal",
  "s.premiere.capital-q",
  "s.premiere.close",
];

describe("v5 premiere and the certification gate", () => {
  it("is one continuous Q-led cut of the owner's beats, in order", () => {
    expect(PREMIERE_SCRIPT.scenes.map((s) => s.sceneId)).toEqual(MAIN);
    expect(PREMIERE_SCRIPT.chapters).toHaveLength(MAIN.length);
  });

  it("the default gate admits exactly the scenes whose features are browser-certified", () => {
    const gate = certifyTour(PREMIERE_SCRIPT, PREMIERE_CERTIFICATION_LEDGER, {
      now: NOW,
      staleFeatureIds: [],
      audience: "INTERNAL_REHEARSAL",
    });
    const live = new Set(
      PREMIERE_CERTIFICATION_LEDGER.filter(
        (e) => e.status === "PRODUCTION_LIVE_VERIFIED",
      ).map((e) => e.featureId),
    );
    const expected = PREMIERE_SCRIPT.scenes
      .filter((s) => s.featureIds.every((f) => live.has(f)))
      .map((s) => s.sceneId);
    expect(gate.scenes.map((s) => s.sceneId)).toEqual(expected);
    expect(expected).toContain("s.premiere.intro");
    expect(expected).toContain("s.premiere.close");
  });

  it("a rehearsal that opts into CODE_VERIFIED runs the full cut, every line approved", () => {
    const gate = certifyTour(PREMIERE_SCRIPT, PREMIERE_CERTIFICATION_LEDGER, {
      now: NOW,
      staleFeatureIds: [],
      audience: "INTERNAL_REHEARSAL",
      acceptedStatuses: ["PRODUCTION_LIVE_VERIFIED", "CODE_VERIFIED"],
    });
    expect(gate.scenes).toHaveLength(MAIN.length);
    expect(gate.rejectedLines).toEqual([]);
    const atlas = certifyTour(ATLAS_SCRIPT, PREMIERE_CERTIFICATION_LEDGER, {
      now: NOW,
      staleFeatureIds: [],
      audience: "INTERNAL_REHEARSAL",
      acceptedStatuses: ["PRODUCTION_LIVE_VERIFIED", "CODE_VERIFIED"],
    });
    expect(atlas.scenes).toHaveLength(ATLAS_SCRIPT.scenes.length);
    expect(atlas.rejectedLines).toEqual([]);
  });

  it("the Atlas holds every main chapter plus the deeper ones, each once", () => {
    const atlas = ATLAS_SCRIPT.scenes.map((s) => s.sceneId);
    for (const id of MAIN) expect(atlas).toContain(id);
    for (const id of [
      "s.premiere.explore",
      "s.atlas.risks",
      "s.premiere.privacy",
      "s.premiere.gateq-interview",
      "s.premiere.daily",
      "s.premiere.subject",
    ]) {
      expect(atlas).toContain(id);
      expect(MAIN).not.toContain(id);
    }
    expect(new Set(atlas).size).toBe(atlas.length);
  });

  it("speaks at a pace that fits 5 to 7 minutes (narration estimate, without waits)", () => {
    const words = PREMIERE_SCRIPT.scenes
      .flatMap((s) => s.lines)
      .reduce((n, l) => n + l.text.split(/\s+/u).length, 0);
    // About 150 words a minute: the narration alone stays under 5 minutes,
    // leaving room for the screens and Q's answers.
    expect(words / 150).toBeLessThan(5);
  });

  it("a DRAFT script never runs for an audience", () => {
    const gate = certifyTour(PREMIERE_SCRIPT, PREMIERE_CERTIFICATION_LEDGER, {
      now: NOW,
      staleFeatureIds: [],
      audience: "AUDIENCE",
      acceptedStatuses: ["PRODUCTION_LIVE_VERIFIED", "CODE_VERIFIED"],
    });
    expect(gate.scenes).toHaveLength(0);
  });

  it("stale certified features are suppressed when the integration owner marks them", () => {
    const gate = certifyTour(PREMIERE_SCRIPT, PREMIERE_CERTIFICATION_LEDGER, {
      now: NOW,
      staleFeatureIds: ["INV-COMPARE-TABLE"],
      audience: "INTERNAL_REHEARSAL",
    });
    expect(gate.scenes.map((s) => s.sceneId)).not.toContain("s.pilot.compare");
  });

  it("consequential steps are never tour actions: the meeting dialog opens, nothing is booked", () => {
    const acts = PREMIERE_SCRIPT.scenes.flatMap((s) => s.actions);
    for (const action of acts) {
      if (action.kind === "uiAct") {
        expect([
          "NEXT",
          "PREVIOUS",
          "SELECT_ITEM",
          "ACTIVATE",
          "OPEN",
          "CLOSE",
          "EXPAND",
          "SCROLL_TO",
        ]).toContain(action.act);
      }
    }
    const activated = acts.flatMap((a) =>
      a.kind === "uiAct" && a.act === "ACTIVATE" ? [a.target] : [],
    );
    // Save (reversible, private) and a list filter; never a booking button.
    expect(activated).toEqual(["button.feed-save", "button.documents-by-q"]);
    const meeting = PREMIERE_SCRIPT.scenes.find(
      (s) => s.sceneId === "s.premiere.meeting",
    );
    expect(meeting?.actions.map((a) => a.kind)).toEqual([
      "openRecord",
      "uiAct",
    ]);
    expect(
      meeting?.actions.some(
        (a) =>
          a.kind === "uiAct" &&
          a.target === "dialog.book-call" &&
          a.act === "OPEN",
      ),
    ).toBe(true);
  });
});

const seg = (
  text: string,
  source: TranscriptSegment["source"] = "AUDIENCE_MIC",
): TranscriptSegment => ({
  segmentId: `s-${text.length}-${source}`,
  source,
  channelId: "mic",
  text,
  final: true,
});

describe("audience speech classifier", () => {
  it("maps the closed phrase set and treats anything else as a question", () => {
    expect(classifyAudienceSpeech(seg("Pause."))).toBe("PAUSE");
    expect(classifyAudienceSpeech(seg("Q, show me that again"))).toBe("REPEAT");
    expect(classifyAudienceSpeech(seg("go back"))).toBe("BACK");
    expect(classifyAudienceSpeech(seg("Skip"))).toBe("SKIP");
    expect(classifyAudienceSpeech(seg("Carry on"))).toBe("RESUME");
    expect(classifyAudienceSpeech(seg("Is that evidence verified?"))).toBe(
      "INTERRUPT",
    );
  });

  it("yields nothing for a synthetic source or a partial segment", () => {
    expect(classifyAudienceSpeech(seg("Pause", "NARRATOR_Q"))).toBeNull();
    expect(
      classifyAudienceSpeech(seg("Skip", "REHEARSAL_COUNTERPART")),
    ).toBeNull();
    expect(
      classifyAudienceSpeech({ ...seg("Pause"), final: false }),
    ).toBeNull();
  });

  it("the gate still refuses an audience voice intent over Q's audio without echo cancellation", () => {
    const gate = new TourControlGate();
    const s = gate.noteSegment(seg("Pause"));
    expect(s).not.toBeNull();
    const decision = gate.admit(
      {
        intentId: "v-1",
        source: "AUDIENCE_MIC",
        modality: "VOICE",
        kind: "PAUSE",
        segmentId: s?.segmentId,
      },
      {
        narratorPlaying: true,
        counterpartPlaying: false,
        echoCancellation: false,
      },
    );
    expect(decision).toEqual({ admitted: false, reason: "ECHO_UNGUARDED" });
  });
});

describe("two-minute cut", () => {
  it("parses, and the default gate admits all of it (certified features only)", async () => {
    const { SHORT_SCRIPT } = await import("../src/index.js");
    const gate = certifyTour(SHORT_SCRIPT, PREMIERE_CERTIFICATION_LEDGER, {
      now: NOW,
      staleFeatureIds: [],
      audience: "INTERNAL_REHEARSAL",
    });
    expect(gate.scenes.map((s) => s.sceneId)).toEqual([
      "s.pilot.opening",
      "s.short.risks",
      "s.premiere.close",
    ]);
  });

  it("r4: Q introduces itself first, then the real mandate, and every scene opens with a spoken line", () => {
    const ids = PREMIERE_SCRIPT.scenes.map((s) => s.sceneId);
    expect(ids.slice(0, 3)).toEqual([
      "s.premiere.intro",
      "s.premiere.mandate",
      "s.premiere.feed",
    ]);
    const intro = PREMIERE_SCRIPT.scenes[0];
    expect(intro?.lines.map((l) => l.kind)).toEqual([
      "CONNECTIVE",
      "CONNECTIVE",
      "CONNECTIVE",
      "CONNECTIVE",
    ]);
    expect(intro?.lines[0]?.text).toMatch(/^Hello, I'm Q/u);
    // A transition before anything happens on screen, in every scene but
    // the intro (which speaks once Home is open) and the close.
    for (const scene of PREMIERE_SCRIPT.scenes.slice(1, -1)) {
      expect(scene.lines[0]?.timing, scene.sceneId).toBe("BEFORE_ACK");
    }
    // Premiere copies keep the pilot's actions and claims.
    const top = PREMIERE_SCRIPT.scenes.find(
      (s) => s.sceneId === "s.pilot.opening",
    );
    const pilotTop = PILOT_SCRIPT.scenes.find(
      (s) => s.sceneId === "s.pilot.opening",
    );
    expect(top?.actions).toEqual(pilotTop?.actions);
    expect(top?.approvedClaimIds).toEqual(pilotTop?.approvedClaimIds);
  });
});

describe("spoken chapter jumps (slice 6)", () => {
  const seg = (
    text: string,
    source: "AUDIENCE_MIC" | "NARRATOR_Q" = "AUDIENCE_MIC",
  ) => ({
    segmentId: "s-1",
    source,
    channelId: "mic",
    text,
    final: true,
  });
  const chapters = ATLAS_SCRIPT.chapters;

  it.each([
    ["Show me GateQ.", "ch.premiere.gateq"],
    ["Go to the CRM part", "ch.premiere.relationship"],
    ["Demo rehearsals", "ch.premiere.rehearsal"],
    ["Can you take me to the mandate?", "ch.premiere.mandate"],
    ["rehearsals", "ch.premiere.rehearsal"],
    ["Q, jump to privacy please", "ch.premiere.privacy"],
  ])("%s -> %s", (text, chapterId) => {
    expect(classifyAudienceJump(seg(text), chapters)).toBe(chapterId);
  });

  it("a question that mentions a chapter is not a jump; Q's narration never is", () => {
    expect(
      classifyAudienceJump(seg("What does GateQ cost?"), chapters),
    ).toBeNull();
    expect(
      classifyAudienceJump(seg("Show me the weather"), chapters),
    ).toBeNull();
    expect(
      classifyAudienceJump(seg("Show me GateQ", "NARRATOR_Q"), chapters),
    ).toBeNull();
  });
});

describe("coverage (slice 7)", () => {
  it("every premiere chapter can be named aloud, and every major area has one", () => {
    for (const chapter of ATLAS_SCRIPT.chapters) {
      expect(
        chapter.spokenNames?.length ?? 0,
        chapter.chapterId,
      ).toBeGreaterThan(0);
    }
    const said = (text: string) =>
      classifyAudienceJump(
        {
          segmentId: "c-1",
          source: "AUDIENCE_MIC",
          channelId: "mic",
          text,
          final: true,
        },
        ATLAS_SCRIPT.chapters,
      );
    for (const [text, chapterId] of [
      ["show me the mandate", "ch.premiere.mandate"],
      ["go to discover", "ch.pilot.discover"],
      ["show me explore", "ch.premiere.explore"],
      ["show me gateq", "ch.premiere.gateq"],
      ["go to the crm part", "ch.premiere.relationship"],
      ["show me q work", "ch.premiere.work"],
      ["show me documents", "ch.premiere.documents"],
      ["show me the q daily", "ch.premiere.daily"],
      ["demo rehearsals", "ch.premiere.rehearsal"],
      ["show me privacy", "ch.premiere.privacy"],
      ["show me capital q", "ch.premiere.capital-q"],
      ["show me the gateq interview", "ch.premiere.gateq-interview"],
    ] as const) {
      expect(said(text), text).toBe(chapterId);
    }
  });
});

describe("named fictional companies after the top three (owner decision 15 Oct)", () => {
  it("open Harbourline Cargo (and its data room) and compare it with Clinicrest, never a ranked card", () => {
    const company = PREMIERE_SCRIPT.scenes.find(
      (s) => s.sceneId === "s.pilot.company",
    );
    const compare = PREMIERE_SCRIPT.scenes.find(
      (s) => s.sceneId === "s.pilot.compare",
    );
    expect(company?.actions[0]).toMatchObject({
      kind: "openCompany",
      company: "harbourline-cargo",
    });
    expect(company?.actions.at(-1)).toMatchObject({
      kind: "selectTab",
      target: "tab.dataroom",
    });
    expect(compare?.actions[0]).toMatchObject({
      kind: "buildComparison",
      companies: ["harbourline-cargo", "clinicrest"],
    });
    const keys = JSON.stringify([company?.actions, compare?.actions]);
    expect(keys).not.toMatch(/card-[0-9]/u);
    for (const key of ["harbourline-cargo", "clinicrest"]) {
      expect(demoCompany(key)).not.toBeNull();
    }
  });
});
