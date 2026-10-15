import { describe, expect, it } from "vitest";

import {
  PILOT_SCRIPT,
  PREMIERE_CERTIFICATION_LEDGER,
  PREMIERE_SCRIPT,
  TourControlGate,
  certifyTour,
  classifyAudienceSpeech,
  type TranscriptSegment,
} from "../src/index.js";

const NOW = "2026-10-15T12:00:00Z";

describe("r3 premiere and the certification gate", () => {
  it("the default gate admits only the browser-certified scenes", () => {
    const gate = certifyTour(PREMIERE_SCRIPT, PREMIERE_CERTIFICATION_LEDGER, {
      now: NOW,
      staleFeatureIds: [],
      audience: "INTERNAL_REHEARSAL",
    });
    expect(gate.scenes.map((s) => s.sceneId)).toEqual([
      "s.premiere.intro",
      "s.premiere.mandate",
      "s.pilot.opening",
      "s.pilot.company",
      "s.pilot.compare",
      "s.premiere.privacy",
      "s.premiere.gateq",
      "s.premiere.relationship",
      "s.premiere.close",
    ]);
    // Q-to-Q stays CODE_VERIFIED until the microphone "skip" test runs.
    const suppressed = gate.decisions.filter((d) => d.verdict === "SUPPRESSED");
    expect(suppressed.map((d) => d.sceneId)).toEqual(["s.premiere.rehearsal"]);
  });

  it("a rehearsal that opts into CODE_VERIFIED runs the full cut", () => {
    const gate = certifyTour(PREMIERE_SCRIPT, PREMIERE_CERTIFICATION_LEDGER, {
      now: NOW,
      staleFeatureIds: [],
      audience: "INTERNAL_REHEARSAL",
      acceptedStatuses: ["PRODUCTION_LIVE_VERIFIED", "CODE_VERIFIED"],
    });
    expect(gate.scenes).toHaveLength(10);
    expect(gate.rejectedLines).toEqual([]);
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
      staleFeatureIds: ["INV-RISKS-FOLLOWUP"],
      audience: "INTERNAL_REHEARSAL",
    });
    expect(gate.scenes.map((s) => s.sceneId)).not.toContain("s.pilot.company");
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
      "s.pilot.opening",
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
