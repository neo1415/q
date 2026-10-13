import { describe, expect, it } from "vitest";

import {
  PILOT_ACTOR,
  PILOT_SCRIPT,
  cursorOf,
  startTour,
  transition,
  type DirectorState,
  type GuideEffect,
  type GuideEvent,
  type TourActor,
  type Transition,
} from "../src/index.js";

const FOUNDER: TourActor = {
  role: "FOUNDER",
  account: "founder.ledgerfold@fictional.capitalq.local",
};

function start(): Transition {
  return startTour({
    scenes: PILOT_SCRIPT.scenes,
    chapters: PILOT_SCRIPT.chapters,
    actor: PILOT_ACTOR,
  });
}

function step(t: Transition, event: GuideEvent): Transition {
  return transition(t.state, event);
}

function prepared(
  state: DirectorState,
  actor: TourActor = state.actor,
): GuideEvent {
  const scene = state.scenes[state.sceneIndex];
  if (scene === undefined) throw new Error("no scene");
  return {
    type: "SCENE_PREPARED",
    sceneId: scene.sceneId,
    capsule: {
      sceneId: scene.sceneId,
      actor,
      sourceIds: ["src:a"],
      resourceIds: [],
    },
  };
}

function lastDispatch(
  t: Transition,
): Extract<GuideEffect, { type: "DISPATCH" }> {
  const found = t.effects.filter((e) => e.type === "DISPATCH").at(-1);
  if (found?.type !== "DISPATCH") throw new Error("no dispatch");
  return found;
}

function ack(t: Transition, ok = true): GuideEvent {
  const d = lastDispatch(t);
  return {
    type: "ACTION_RESULT",
    result: ok
      ? {
          actionId: d.action.actionId,
          dispatchId: d.dispatchId,
          ok: true,
          observedRoute: "/discover",
          visible: true,
          failureCode: null,
        }
      : {
          actionId: d.action.actionId,
          dispatchId: d.dispatchId,
          ok: false,
          observedRoute: null,
          visible: false,
          failureCode: "UNAUTHORIZED",
        },
  };
}

function types(t: Transition): string[] {
  return t.effects.map((e) => e.type);
}

/** Runs the current scene to its checkpoint, acknowledging every action. */
function runScene(t: Transition): Transition {
  let at = step(step(t, prepared(t.state)), { type: "BEGIN" });
  while (at.state.phase === "SPEAK_AND_ACT") at = step(at, ack(at));
  expect(at.state.phase).toBe("ACKNOWLEDGE");
  at = step(at, { type: "SPEECH_DONE" });
  expect(at.state.phase).toBe("CHECKPOINT");
  return at;
}

describe("the happy path, every forward transition", () => {
  it("PREPARE_SCENE → READY → SPEAK_AND_ACT → ACKNOWLEDGE → CHECKPOINT → ADVANCE … → COMPLETE", () => {
    let t = start();
    expect(t.state.phase).toBe("PREPARE_SCENE");
    expect(t.effects).toEqual([
      {
        type: "PREPARE",
        sceneId: "s.pilot.opening",
        actor: PILOT_ACTOR,
        prefetch: ["s.pilot.company", "s.pilot.compare"],
      },
    ]);
    t = step(t, prepared(t.state));
    expect(t.state.phase).toBe("READY");
    t = step(t, { type: "BEGIN" });
    expect(t.state.phase).toBe("SPEAK_AND_ACT");
    // Narrate what is about to happen, and act: before-ack lines only.
    const speak = t.effects[0];
    expect(speak?.type).toBe("SPEAK");
    if (speak?.type === "SPEAK") {
      expect(speak.lines.every((l) => l.timing === "BEFORE_ACK")).toBe(true);
    }
    expect(lastDispatch(t).action.kind).toBe("openRoute");
    t = step(t, ack(t));
    // One at a time: the next action only after the first was acknowledged.
    expect(t.state.phase).toBe("SPEAK_AND_ACT");
    expect(lastDispatch(t).action.kind).toBe("askApprovedQuestion");
    t = step(t, ack(t));
    expect(t.state.phase).toBe("ACKNOWLEDGE");
    const after = t.effects[0];
    expect(
      after?.type === "SPEAK" &&
        after.lines.every((l) => l.timing === "AFTER_ACK"),
    ).toBe(true);
    t = step(t, { type: "SPEECH_DONE" });
    expect(t.state.phase).toBe("CHECKPOINT");
    expect(types(t)).toEqual(["CHECKPOINT_REACHED"]);
    t = step(t, { type: "CONTINUE" });
    expect(t.state.phase).toBe("PREPARE_SCENE");
    expect(t.state.trail.slice(-2)).toEqual(["ADVANCE", "PREPARE_SCENE"]);
    t = runScene(t);
    t = runScene(step(t, { type: "CONTINUE" }));
    t = step(t, { type: "CONTINUE" });
    expect(t.state.phase).toBe("COMPLETE");
    expect(types(t)).toEqual(["COMPLETED"]);
    expect(t.state.validScenes).toEqual([0, 1, 2]);
  });

  it("an empty (fully suppressed) tour is COMPLETE at once", () => {
    const t = startTour({ scenes: [], chapters: [], actor: PILOT_ACTOR });
    expect(t.state.phase).toBe("COMPLETE");
  });
});

describe("never advance before acknowledgement", () => {
  it("rejects CONTINUE in every state but CHECKPOINT", () => {
    let t = start();
    const states: string[] = [];
    const tryContinue = () => {
      const r = step(t, { type: "CONTINUE" });
      expect(r.state).toBe(t.state);
      expect(r.effects).toEqual([
        { type: "REJECTED", event: "CONTINUE", reason: "NOT_ACKNOWLEDGED" },
      ]);
      states.push(t.state.phase);
    };
    tryContinue();
    t = step(t, prepared(t.state));
    tryContinue();
    t = step(t, { type: "BEGIN" });
    tryContinue();
    t = step(step(t, ack(t)), ack(step(t, ack(t))));
    expect(t.state.phase).toBe("ACKNOWLEDGE");
    tryContinue();
    expect(states).toEqual([
      "PREPARE_SCENE",
      "READY",
      "SPEAK_AND_ACT",
      "ACKNOWLEDGE",
    ]);
  });

  it("a result that is not visible is a failure, not an acknowledgement", () => {
    let t = step(step(start(), prepared(start().state)), { type: "BEGIN" });
    const d = lastDispatch(t);
    t = step(t, {
      type: "ACTION_RESULT",
      result: {
        actionId: d.action.actionId,
        dispatchId: d.dispatchId,
        ok: false,
        observedRoute: "/discover",
        visible: false,
        failureCode: "NOT_VISIBLE",
      },
    });
    expect(t.state.phase).toBe("SAFE_FALLBACK");
    expect(t.state.validScenes).toEqual([]);
  });

  it("ignores a result for another dispatch or another action", () => {
    let t = step(step(start(), prepared(start().state)), { type: "BEGIN" });
    const d = lastDispatch(t);
    const stale = step(t, {
      type: "ACTION_RESULT",
      result: {
        actionId: d.action.actionId,
        dispatchId: `${d.action.actionId}#99`,
        ok: true,
        observedRoute: "/discover",
        visible: true,
        failureCode: null,
      },
    });
    expect(stale.state).toBe(t.state);
    expect(types(stale)).toEqual(["REJECTED"]);
    t = step(t, ack(t));
    expect(t.state.actionIndex).toBe(1);
  });

  it("a failure or a timeout goes to SAFE_FALLBACK and speaks only the fallback", () => {
    const begun = step(step(start(), prepared(start().state)), {
      type: "BEGIN",
    });
    const failed = step(begun, ack(begun, false));
    expect(failed.state.phase).toBe("SAFE_FALLBACK");
    expect(types(failed)).toEqual([
      "CANCEL_SPEECH",
      "CANCEL_QUEUED",
      "FALLBACK",
      "SPEAK",
    ]);
    const timedOut = step(begun, {
      type: "ACK_TIMEOUT",
      dispatchId: lastDispatch(begun).dispatchId,
    });
    expect(timedOut.state.phase).toBe("SAFE_FALLBACK");
    // The action may still land: the host is asked to resolve it.
    expect(types(timedOut)).toContain("RESOLVE_DISPATCHED");
    const done = step(failed, { type: "FALLBACK_DONE" });
    expect(done.state.phase).toBe("PAUSED");
    expect(done.state.actionIndex).toBe(0);
  });
});

describe("pause, interruption and resume (blueprint §7)", () => {
  it("cancels queued narration and unexecuted actions, and resolves the dispatched one", () => {
    const begun = step(step(start(), prepared(start().state)), {
      type: "BEGIN",
    });
    const paused = step(begun, { type: "PAUSE" });
    expect(paused.state.phase).toBe("PAUSED");
    expect(paused.effects).toEqual([
      { type: "CANCEL_SPEECH" },
      { type: "CANCEL_QUEUED", actionIds: ["ta_ask-top-three"] },
      { type: "RESOLVE_DISPATCHED", dispatchId: "ta_open-discover#1" },
    ]);
    const interrupted = step(begun, { type: "INTERRUPT" });
    expect(interrupted.state.phase).toBe("INTERRUPTED");
    expect(types(interrupted)).toEqual([
      "CANCEL_SPEECH",
      "CANCEL_QUEUED",
      "RESOLVE_DISPATCHED",
    ]);
  });

  it("an action result that arrives while paused is not taken as an acknowledgement", () => {
    const begun = step(step(start(), prepared(start().state)), {
      type: "BEGIN",
    });
    const paused = step(begun, { type: "PAUSE" });
    const late = step(paused, ack(begun));
    expect(late.state).toBe(paused.state);
    expect(types(late)).toEqual(["REJECTED"]);
  });

  it("resume waits for the resolution, then continues after a completed action", () => {
    const begun = step(step(start(), prepared(start().state)), {
      type: "BEGIN",
    });
    const paused = step(begun, { type: "INTERRUPT" });
    let t = step(paused, { type: "RESUME", routeIntact: true });
    expect(t.state.phase).toBe("RESUME");
    expect(types(t)).toEqual(["RESOLVE_DISPATCHED"]);
    t = step(t, {
      type: "DISPATCH_RESOLVED",
      dispatchId: "ta_open-discover#1",
      completed: true,
    });
    expect(t.state.phase).toBe("PREPARE_SCENE");
    expect(cursorOf(t.state)?.actionIndex).toBe(1);
    t = step(step(t, prepared(t.state)), { type: "BEGIN" });
    // Resumed mid-scene: no repeated opening narration; the next action.
    expect(types(t)).toEqual(["DISPATCH"]);
    expect(lastDispatch(t).action.actionId).toBe("ta_ask-top-three");
  });

  it("an action that did not complete is redone on resume", () => {
    const begun = step(step(start(), prepared(start().state)), {
      type: "BEGIN",
    });
    let t = step(step(begun, { type: "PAUSE" }), {
      type: "DISPATCH_RESOLVED",
      dispatchId: "ta_open-discover#1",
      completed: false,
    });
    expect(t.state.pending).toBeNull();
    t = step(t, { type: "RESUME", routeIntact: true });
    t = step(step(t, prepared(t.state)), { type: "BEGIN" });
    const d = lastDispatch(t);
    expect(d.action.actionId).toBe("ta_open-discover");
    // A fresh dispatch id: the earlier attempt can never acknowledge it.
    expect(d.dispatchId).toBe("ta_open-discover#2");
  });

  it("replays the scene from its first action when the screen moved away", () => {
    const begun = step(step(start(), prepared(start().state)), {
      type: "BEGIN",
    });
    const moved = step(begun, ack(begun));
    let t = step(step(moved, { type: "PAUSE" }), {
      type: "DISPATCH_RESOLVED",
      dispatchId: lastDispatch(moved).dispatchId,
      completed: true,
    });
    expect(t.state.actionIndex).toBe(2);
    t = step(t, { type: "RESUME", routeIntact: false });
    expect(cursorOf(t.state)?.actionIndex).toBe(0);
  });

  it("resuming at a checkpoint keeps the cursor", () => {
    const at = runScene(start());
    let t = step(at, { type: "PAUSE" });
    expect(types(t)).toEqual(["CANCEL_SPEECH"]);
    t = step(t, { type: "RESUME", routeIntact: true });
    t = step(step(t, prepared(t.state)), { type: "BEGIN" });
    // Every action already landed: only the outcome narration is left.
    expect(t.state.phase).toBe("ACKNOWLEDGE");
    expect(types(t)).toEqual(["SPEAK"]);
  });

  it("refuses RESUME when not paused or interrupted, and a stale resolution", () => {
    const t = start();
    expect(types(step(t, { type: "RESUME", routeIntact: true }))).toEqual([
      "REJECTED",
    ]);
    expect(
      types(
        step(t, {
          type: "DISPATCH_RESOLVED",
          dispatchId: "ta_x1y#1",
          completed: true,
        }),
      ),
    ).toEqual(["REJECTED"]);
  });
});

describe("goBack and jumpToChapter go to the last valid scene", () => {
  it("goBack returns to the most recent scene that reached its checkpoint", () => {
    let t = runScene(start());
    t = step(t, { type: "CONTINUE" });
    t = step(step(t, prepared(t.state)), { type: "BEGIN" });
    expect(t.state.sceneIndex).toBe(1);
    const back = step(t, { type: "GO_BACK" });
    expect(back.state.phase).toBe("PREPARE_SCENE");
    expect(back.state.sceneIndex).toBe(0);
    expect(back.state.actionIndex).toBe(0);
    // In-flight work of the scene being left is cancelled and resolved.
    expect(types(back).slice(0, 3)).toEqual([
      "CANCEL_SPEECH",
      "CANCEL_QUEUED",
      "RESOLVE_DISPATCHED",
    ]);
    expect(types(back).at(-1)).toBe("PREPARE");
  });

  it("goBack with no valid scene is refused, never a history guess", () => {
    const t = step(step(start(), prepared(start().state)), { type: "BEGIN" });
    expect(step(t, { type: "GO_BACK" }).effects).toEqual([
      { type: "REJECTED", event: "GO_BACK", reason: "NO_VALID_SCENE" },
    ]);
  });

  it("jumps to a chapter's first admitted scene, and refuses an unavailable chapter", () => {
    const t = start();
    const jumped = step(t, {
      type: "JUMP_TO_CHAPTER",
      chapterId: "ch.pilot.compare",
    });
    expect(jumped.state.sceneIndex).toBe(2);
    expect(jumped.state.phase).toBe("PREPARE_SCENE");
    const refused = step(t, {
      type: "JUMP_TO_CHAPTER",
      chapterId: "ch.gateq.dossier",
    });
    expect(refused.state).toBe(t.state);
    expect(refused.effects).toEqual([
      {
        type: "REJECTED",
        event: "JUMP_TO_CHAPTER",
        reason: "CHAPTER_UNAVAILABLE",
      },
    ]);
  });

  it("can jump back into the tour from COMPLETE", () => {
    let t = runScene(start());
    t = runScene(step(t, { type: "CONTINUE" }));
    t = runScene(step(t, { type: "CONTINUE" }));
    t = step(t, { type: "CONTINUE" });
    expect(t.state.phase).toBe("COMPLETE");
    expect(step(t, { type: "GO_BACK" }).state.sceneIndex).toBe(1);
  });
});

describe("role switch clears scoped data", () => {
  it("clears the old actor's capsule and pauses", () => {
    let t = step(start(), prepared(start().state));
    expect(t.state.capsule?.actor).toEqual(PILOT_ACTOR);
    t = step(t, { type: "ROLE_SWITCHED", actor: FOUNDER });
    expect(t.state.capsule).toBeNull();
    expect(t.state.actor).toEqual(FOUNDER);
    expect(t.state.phase).toBe("PAUSED");
    expect(t.effects).toContainEqual({
      type: "CLEAR_SCOPED",
      actor: PILOT_ACTOR,
    });
  });

  it("refuses a capsule prepared for another actor, and a scene bound to the old one", () => {
    const t = start();
    const wrong = step(t, prepared(t.state, FOUNDER));
    expect(wrong.state.phase).toBe("SAFE_FALLBACK");
    expect(wrong.state.capsule).toBeNull();
    expect(wrong.effects).toContainEqual({
      type: "CLEAR_SCOPED",
      actor: FOUNDER,
    });

    // After a switch, the investor scene cannot run as the founder.
    let switched = step(step(t, prepared(t.state)), {
      type: "ROLE_SWITCHED",
      actor: FOUNDER,
    });
    switched = step(switched, { type: "RESUME", routeIntact: true });
    expect(switched.effects).toContainEqual(
      expect.objectContaining({ type: "PREPARE", actor: FOUNDER }),
    );
    const refused = step(switched, prepared(switched.state, FOUNDER));
    expect(refused.state.phase).toBe("SAFE_FALLBACK");
    expect(refused.effects).toContainEqual(
      expect.objectContaining({
        type: "FALLBACK",
        failureCode: "ACTOR_MISMATCH",
      }),
    );
  });

  it("a switch to the same actor changes nothing", () => {
    const t = start();
    expect(step(t, { type: "ROLE_SWITCHED", actor: PILOT_ACTOR }).state).toBe(
      t.state,
    );
  });
});

describe("stale preparation", () => {
  it("ignores a preparation for another scene and handles a failed one", () => {
    const t = start();
    const other = step(t, {
      type: "SCENE_PREPARED",
      sceneId: "s.pilot.compare",
      capsule: {
        sceneId: "s.pilot.compare",
        actor: PILOT_ACTOR,
        sourceIds: [],
        resourceIds: [],
      },
    });
    expect(other.state).toBe(t.state);
    const failed = step(t, {
      type: "SCENE_PREPARE_FAILED",
      sceneId: "s.pilot.opening",
      failureCode: "FIXTURE_UNRESOLVED",
    });
    expect(failed.state.phase).toBe("SAFE_FALLBACK");
  });
});
