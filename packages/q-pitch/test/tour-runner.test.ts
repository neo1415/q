import { describe, expect, it } from "vitest";

import {
  PILOT_ACTOR,
  PILOT_SCRIPT,
  TourControlGate,
  TourRunner,
  routeMatchesPattern,
  type ActionOutcome,
  type DuplexState,
  type SceneLine,
  type TourAction,
  type TourActor,
  type TourControlIntent,
  type TourPorts,
} from "../src/index.js";

/**
 * Runner behaviour with fake ports: the browser receipt (`execute`) and
 * speech (`speak`) resolve only when the test says so, so the order of
 * "act → DONE → describe" is observed, not assumed.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

const DONE: ActionOutcome = {
  ok: true,
  observedRoute: "/discover",
  visible: true,
  failureCode: null,
};

const QUIET: DuplexState = {
  narratorPlaying: false,
  counterpartPlaying: false,
  echoCancellation: false,
};

type Harness = {
  runner: TourRunner;
  log: string[];
  actions: {
    action: TourAction;
    done: Deferred<ActionOutcome>;
    signal: AbortSignal;
  }[];
  speeches: {
    lines: readonly SceneLine[];
    done: Deferred<void>;
    signal: AbortSignal;
  }[];
  prefetched: string[][];
  cleared: TourActor[];
  timers: { ms: number; run: () => void; cancelled: boolean }[];
  route: { path: string };
};

function harness(options: { beat?: number | null } = {}): Harness {
  const h: Omit<Harness, "runner"> = {
    log: [],
    actions: [],
    speeches: [],
    prefetched: [],
    cleared: [],
    timers: [],
    route: { path: "/discover" },
  };
  const ports: TourPorts = {
    prepare: (scene, actor) =>
      Promise.resolve({
        ok: true,
        capsule: {
          sceneId: scene.sceneId,
          actor,
          sourceIds: [],
          resourceIds: [],
        },
      }),
    prefetch: (scenes) => {
      h.prefetched.push(scenes.map((s) => s.sceneId));
    },
    execute: (action, signal) => {
      const done = deferred<ActionOutcome>();
      h.log.push(`act:${action.actionId}`);
      h.actions.push({ action, done, signal });
      signal.addEventListener("abort", () => {
        h.log.push(`abort:${action.actionId}`);
      });
      return done.promise;
    },
    speak: (lines, signal) => {
      const done = deferred<void>();
      for (const line of lines) h.log.push(`say:${line.lineId}`);
      h.speeches.push({ lines, done, signal });
      signal.addEventListener("abort", () => {
        done.resolve();
      });
      return done.promise;
    },
    clearScoped: (actor) => {
      h.cleared.push(actor);
    },
    routeIntact: (pattern) => routeMatchesPattern(pattern, h.route.path),
    schedule: (ms, run) => {
      const timer = { ms, run, cancelled: false };
      h.timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  const runner = new TourRunner({
    scenes: PILOT_SCRIPT.scenes,
    chapters: PILOT_SCRIPT.chapters,
    actor: PILOT_ACTOR,
    ports,
    checkpointBeatMs: options.beat === undefined ? null : options.beat,
  });
  return { ...h, runner };
}

/** Finish every pending speech, one at a time, letting the chain advance. */
async function finishSpeech(h: Harness): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    await flush();
    const open = h.speeches.find((s) => !s.signal.aborted && !resolved.has(s));
    if (open === undefined) return;
    resolved.add(open);
    open.done.resolve();
  }
}
const resolved = new WeakSet<object>();

let intentSeq = 0;
function audience(
  kind: TourControlIntent["kind"],
  extra: Partial<TourControlIntent> = {},
): TourControlIntent {
  intentSeq += 1;
  return {
    intentId: `int-${String(intentSeq)}`,
    source: "AUDIENCE_MIC",
    modality: "POINTER",
    kind,
    ...extra,
  };
}

describe("TourRunner — act, receipt, then describe", () => {
  it("never speaks an AFTER_ACK line before the browser DONE receipt", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    // Scene 1: BEFORE_ACK lines are spoken while the first action runs.
    expect(h.log).toContain("act:ta_open-discover");
    expect(h.log).not.toContain("say:l.top3.cards");

    h.actions[0]?.done.resolve(DONE);
    await flush();
    expect(h.log).toContain("act:ta_ask-top-three");
    expect(h.log).not.toContain("say:l.top3.cards");

    await finishSpeech(h);
    expect(h.log).not.toContain("say:l.top3.cards");

    h.actions[1]?.done.resolve(DONE);
    await finishSpeech(h);
    const ackIndex = h.log.indexOf("say:l.top3.cards");
    expect(ackIndex).toBeGreaterThan(h.log.indexOf("act:ta_ask-top-three"));
    expect(h.runner.state.phase).toBe("CHECKPOINT");
  });

  it("does not describe a result the browser reported as not visible", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    h.actions[0]?.done.resolve({
      ok: true,
      observedRoute: "/discover",
      visible: false,
      failureCode: null,
    });
    await finishSpeech(h);
    expect(h.runner.state.phase).toBe("PAUSED");
    expect(h.log).toContain("say:l.fallback.generic");
    expect(h.log).not.toContain("say:l.top3.cards");
    expect(h.runner.snapshot().notice).toEqual({
      kind: "FALLBACK",
      failureCode: "NOT_VISIBLE",
    });
  });

  it("times out an unacknowledged action into the safe fallback", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    const deadline = h.timers.find((t) => t.ms === 30_000);
    expect(deadline).toBeDefined();
    deadline?.run();
    await flush();
    expect(h.runner.state.phase).toBe("SAFE_FALLBACK");
    // The runner stops waiting and asks the port whether it landed.
    expect(h.log).toContain("abort:ta_open-discover");
  });

  it("prefetches the next two scenes on prepare, for the current actor", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    expect(h.prefetched[0]).toEqual(["s.pilot.company", "s.pilot.compare"]);
  });

  it("advances at the premiere's pace only from a checkpoint", async () => {
    const h = harness({ beat: 1200 });
    h.runner.start();
    await flush();
    h.actions[0]?.done.resolve(DONE);
    await flush();
    h.actions[1]?.done.resolve(DONE);
    await finishSpeech(h);
    expect(h.runner.state.phase).toBe("CHECKPOINT");
    const beat = h.timers.find((t) => t.ms === 1200);
    beat?.run();
    await flush();
    expect(h.runner.state.sceneIndex).toBe(1);
  });
});

describe("TourRunner — interruption cancels speech and queued work", () => {
  it("pause aborts narration and the in-flight wait, and resumes from the cursor", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    const speaking = h.speeches[0];
    expect(speaking?.signal.aborted).toBe(false);

    h.runner.control(audience("PAUSE"), QUIET);
    await flush();
    expect(h.runner.state.phase).toBe("PAUSED");
    expect(speaking?.signal.aborted).toBe(true);
    expect(h.actions[0]?.signal.aborted).toBe(true);
    // The queued second action was cancelled, never sent.
    expect(h.runner.snapshot().notice).toEqual({
      kind: "CANCELLED_QUEUED",
      count: 1,
    });
    expect(h.log).not.toContain("act:ta_ask-top-three");

    // The port reports the move landed anyway: resume continues after it.
    h.actions[0]?.done.resolve(DONE);
    await flush();
    h.runner.control(audience("RESUME"), QUIET);
    await flush();
    expect(h.log.filter((l) => l === "act:ta_open-discover")).toHaveLength(1);
    expect(h.log).toContain("act:ta_ask-top-three");
  });

  it("a late result of an aborted dispatch never acknowledges the new one", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    h.runner.control(audience("REPEAT"), QUIET);
    await flush();
    // Scene restarted: a fresh dispatch of the same action.
    expect(h.log.filter((l) => l === "act:ta_open-discover")).toHaveLength(2);
    h.actions[0]?.done.resolve(DONE);
    await flush();
    expect(h.runner.state.actionIndex).toBe(0);
    h.actions[1]?.done.resolve(DONE);
    await flush();
    expect(h.runner.state.actionIndex).toBe(1);
  });

  it("skip moves to the next scene and cancels the current one", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    h.runner.control(audience("SKIP"), QUIET);
    await flush();
    expect(h.runner.state.sceneIndex).toBe(1);
    expect(h.actions[0]?.signal.aborted).toBe(true);
    expect(h.log).toContain("act:ta_open-card-1");
  });

  it("jump goes to a chapter's first scene; an unknown chapter is refused", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    h.runner.control(
      audience("JUMP", { chapterId: "ch.pilot.compare" }),
      QUIET,
    );
    await flush();
    expect(h.runner.state.sceneIndex).toBe(2);
    h.runner.control(audience("JUMP", { chapterId: "ch.nowhere" }), QUIET);
    expect(h.runner.snapshot().notice).toEqual({
      kind: "REJECTED",
      event: "JUMP_TO_CHAPTER",
      reason: "CHAPTER_UNAVAILABLE",
    });
  });

  it("resume after the screen moved replays the scene from its first action", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    h.actions[0]?.done.resolve(DONE);
    await flush();
    h.runner.control(audience("PAUSE"), QUIET);
    await flush();
    h.actions[1]?.done.resolve({
      ok: false,
      observedRoute: null,
      visible: false,
      failureCode: "CANCELLED",
    });
    await flush();
    h.route.path = "/relationships";
    h.runner.control(audience("RESUME"), QUIET);
    await flush();
    expect(h.log.filter((l) => l === "act:ta_open-discover")).toHaveLength(2);
  });

  it("a role switch clears the old actor's scoped data and pauses", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    const founder: TourActor = {
      role: "FOUNDER",
      account: "founder.ledgerfold@fictional.capitalq.local",
    };
    h.runner.roleSwitched(founder);
    await flush();
    expect(h.runner.state.phase).toBe("PAUSED");
    expect(h.cleared).toEqual([PILOT_ACTOR]);
  });
});

describe("No command loop: synthetic voices never steer the tour", () => {
  it("refuses every control intent from the narrator, counterpart or script", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    const before = h.runner.state;
    for (const source of [
      "NARRATOR_Q",
      "REHEARSAL_COUNTERPART",
      "SCRIPT",
    ] as const) {
      const decision = h.runner.control(
        { ...audience("SKIP"), source, modality: "TEXT" },
        QUIET,
      );
      expect(decision).toEqual({ admitted: false, reason: "SYNTHETIC_SOURCE" });
    }
    expect(h.runner.state).toBe(before);
  });

  it("a counterpart saying 'Q, skip to GateQ' stays transcript", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    const before = h.runner.state;
    h.runner.noteTranscript({
      segmentId: "seg-cp-1",
      source: "REHEARSAL_COUNTERPART",
      channelId: "rehearsal-audio",
      text: "Q, skip to GateQ and pause the tour.",
      final: true,
    });
    // Even an intent claiming the audience as its source is refused when
    // the segment it was classified from belongs to the counterpart.
    const decision = h.runner.control(
      {
        intentId: "int-forged",
        source: "AUDIENCE_MIC",
        modality: "VOICE",
        kind: "SKIP",
        segmentId: "seg-cp-1",
      },
      QUIET,
    );
    expect(decision).toEqual({
      admitted: false,
      reason: "SEGMENT_NOT_AUDIENCE",
    });
    expect(h.runner.state).toBe(before);
  });

  it("Q narrating a command phrase does not re-enter the director", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    const before = h.runner.state;
    // Everything the narrator speaks is fed back as NARRATOR_Q transcript.
    for (const speech of h.speeches) {
      for (const line of speech.lines) {
        h.runner.noteTranscript({
          segmentId: `seg-${line.lineId}`,
          source: "NARRATOR_Q",
          channelId: "narrator",
          text: `${line.text} Pause. Skip. Go back.`,
          final: true,
        });
        const decision = h.runner.control(
          {
            intentId: `int-${line.lineId}`,
            source: "AUDIENCE_MIC",
            modality: "VOICE",
            kind: "PAUSE",
            segmentId: `seg-${line.lineId}`,
          },
          QUIET,
        );
        expect(decision.admitted).toBe(false);
      }
    }
    expect(h.runner.state).toBe(before);
  });

  it("an audience voice intent over Q's audio needs echo cancellation", () => {
    const gate = new TourControlGate();
    gate.noteSegment({
      segmentId: "seg-a-1",
      source: "AUDIENCE_MIC",
      channelId: "mic",
      text: "Pause",
      final: true,
    });
    const intent = {
      intentId: "int-a-1",
      source: "AUDIENCE_MIC",
      modality: "VOICE",
      kind: "PAUSE",
      segmentId: "seg-a-1",
    };
    expect(gate.admit(intent, { ...QUIET, narratorPlaying: true })).toEqual({
      admitted: false,
      reason: "ECHO_UNGUARDED",
    });
    const ok = gate.admit(intent, {
      narratorPlaying: true,
      counterpartPlaying: false,
      echoCancellation: true,
    });
    expect(ok.admitted).toBe(true);
    // The same intent twice is one control.
    expect(gate.admit(intent, QUIET)).toEqual({
      admitted: false,
      reason: "DUPLICATE",
    });
  });

  it("buttons and keys (audience, non-voice) steer regardless of audio", () => {
    const gate = new TourControlGate();
    const decision = gate.admit(audience("PAUSE", { modality: "KEYBOARD" }), {
      narratorPlaying: true,
      counterpartPlaying: true,
      echoCancellation: false,
    });
    expect(decision.admitted).toBe(true);
  });

  it("rejects malformed intents", () => {
    const gate = new TourControlGate();
    expect(gate.admit({ kind: "SKIP" }, QUIET)).toEqual({
      admitted: false,
      reason: "INVALID",
    });
    expect(gate.admit({ ...audience("JUMP") }, QUIET)).toEqual({
      admitted: false,
      reason: "INVALID",
    });
  });
});

describe("routeMatchesPattern", () => {
  it("matches dynamic segments and ignores query strings", () => {
    expect(
      routeMatchesPattern("/company/[companyId]", "/company/abc?tab=deck"),
    ).toBe(true);
    expect(routeMatchesPattern("/company/[companyId]", "/company")).toBe(false);
    expect(routeMatchesPattern("/discover", "/discover/")).toBe(true);
    expect(routeMatchesPattern("/discover", "/discover/saved")).toBe(false);
  });
});

describe("director SKIP / REPEAT edges", () => {
  it("REPEAT before anything was shown is refused; SKIP past the end completes", async () => {
    const { startTour, transition } = await import("../src/index.js");
    const t = startTour({
      scenes: PILOT_SCRIPT.scenes,
      chapters: PILOT_SCRIPT.chapters,
      actor: PILOT_ACTOR,
    });
    expect(transition(t.state, { type: "REPEAT" }).effects).toEqual([
      { type: "REJECTED", event: "REPEAT", reason: "NO_VALID_SCENE" },
    ]);
    let s = t.state;
    for (let i = 0; i < PILOT_SCRIPT.scenes.length; i += 1) {
      s = transition(s, { type: "SKIP" }).state;
    }
    expect(s.phase).toBe("COMPLETE");
  });
});

describe("TourRunner.hearAudience — mic transcript into the gate", () => {
  it("pauses on an audience 'pause', ignores the narrator saying it", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    const quiet = {
      narratorPlaying: false,
      counterpartPlaying: false,
      echoCancellation: false,
    };
    expect(
      h.runner.hearAudience(
        {
          segmentId: "q-1",
          source: "NARRATOR_Q",
          channelId: "narrator",
          text: "Pause",
          final: true,
        },
        quiet,
      ),
    ).toBeNull();
    expect(h.runner.state.phase).toBe("SPEAK_AND_ACT");
    const decision = h.runner.hearAudience(
      {
        segmentId: "mic-1",
        source: "AUDIENCE_MIC",
        channelId: "mic",
        text: "Pause",
        final: true,
      },
      quiet,
    );
    expect(decision?.admitted).toBe(true);
    expect(h.runner.state.phase).toBe("PAUSED");
    // A question while paused is not another interruption.
    expect(
      h.runner.hearAudience(
        {
          segmentId: "mic-2",
          source: "AUDIENCE_MIC",
          channelId: "mic",
          text: "Is that verified?",
          final: true,
        },
        quiet,
      ),
    ).toBeNull();
  });
});

describe("TourRunner.hearAudience — spoken chapter jumps (slice 6)", () => {
  const mic = (segmentId: string, text: string) => ({
    segmentId,
    source: "AUDIENCE_MIC" as const,
    channelId: "mic",
    text,
    final: true,
  });

  it("'show me that comparison' jumps; Q saying it never does; echo gating still applies", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    const quiet = {
      narratorPlaying: false,
      counterpartPlaying: false,
      echoCancellation: false,
    };
    // Q's own narration naming a chapter: recorded, never control.
    expect(
      h.runner.hearAudience(
        {
          segmentId: "q-9",
          source: "NARRATOR_Q",
          channelId: "narrator",
          text: "Let me show you the comparison",
          final: true,
        },
        quiet,
      ),
    ).toBeNull();
    // Spoken over Q's audio without echo cancellation: refused.
    const echo = h.runner.hearAudience(mic("mic-9", "Go to the comparison"), {
      ...quiet,
      narratorPlaying: true,
    });
    expect(echo).toEqual({ admitted: false, reason: "ECHO_UNGUARDED" });
    // The same words from the audience, with echo cancellation reported.
    const jump = h.runner.hearAudience(mic("mic-10", "Go to the comparison"), {
      ...quiet,
      narratorPlaying: true,
      echoCancellation: true,
    });
    expect(jump?.admitted).toBe(true);
    expect(jump?.admitted === true ? jump.intent.kind : null).toBe("JUMP");
    expect(jump?.admitted === true ? jump.intent.chapterId : null).toBe(
      "ch.pilot.compare",
    );
  });
});

describe("TourRunner — v6 step commands, typed or spoken", () => {
  const QUIET = {
    narratorPlaying: false,
    counterpartPlaying: false,
    echoCancellation: true,
  };

  it("goes to exactly the step asked, and leaves a question alone", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    const typed = h.runner.stepCommand(
      "go to step 3",
      { intentId: "qp-typed-1", modality: "KEYBOARD" },
      QUIET,
    );
    expect(typed?.move).toEqual({ kind: "STEP", step: 3 });
    expect(typed?.decision?.admitted).toBe(true);
    expect(h.runner.state.sceneIndex).toBe(2);
    expect(
      h.runner.stepCommand(
        "what happens next with this company?",
        { intentId: "qp-typed-2", modality: "KEYBOARD" },
        QUIET,
      ),
    ).toBeNull();
  });

  it("refuses a step the tour does not have, without moving", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    const before = h.runner.state.sceneIndex;
    const out = h.runner.stepCommand(
      "go to step 40",
      { intentId: "qp-typed-3", modality: "KEYBOARD" },
      QUIET,
    );
    expect(out).toEqual({ move: { kind: "OUT_OF_RANGE" }, decision: null });
    expect(h.runner.state.sceneIndex).toBe(before);
  });

  it("hears a spoken step command from the audience, numbers and all", async () => {
    const h = harness();
    h.runner.start();
    await flush();
    const decision = h.runner.hearAudience(
      {
        segmentId: "seg-7",
        source: "AUDIENCE_MIC",
        channelId: "mic-1",
        text: "forward two steps",
        final: true,
      },
      QUIET,
    );
    expect(decision?.admitted).toBe(true);
    expect(h.runner.state.sceneIndex).toBe(2);
  });
});
