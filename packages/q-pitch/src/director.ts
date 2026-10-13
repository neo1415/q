import type {
  GuideEffect,
  GuideEvent,
  GuideState,
  RejectionReason,
  SceneCapsule,
  SceneCursor,
} from "./guide.js";
import { sameActor, type TourActor } from "./scene-evidence.js";
import type { Chapter, SceneScript } from "./script.js";
import type { TourFailureCode } from "./tour-action.js";

/**
 * The tour director (blueprint §5, §7): a pure, framework-free state
 * machine. `transition(state, event)` returns the next state and the
 * effects the host must perform. No clock, no I/O, no randomness, so
 * every rule below is asserted by unit tests.
 *
 * Rules:
 * - Never advance before acknowledgement: CHECKPOINT is reachable only
 *   after every action of the scene reported ok and visible, and the
 *   after-acknowledgement narration finished. CONTINUE anywhere else is
 *   rejected.
 * - Actions run one at a time; each dispatch has its own id, so a result
 *   for an earlier attempt can never acknowledge a later one.
 * - Pause, interruption, back, jump and role switch cancel queued
 *   narration and the actions not yet dispatched, and ask the host to
 *   resolve whether the dispatched one completed.
 * - RESUME waits for that resolution, then resumes from the cursor. When
 *   the screen moved away it replays the scene from its first action.
 * - goBack and jumpToChapter go to the last valid scene: the most recent
 *   one that reached its checkpoint, or the chapter's first admitted
 *   scene. They never use browser history.
 * - A role switch clears the scene capsule scoped to the old actor. A
 *   capsule prepared for another actor is refused, never used.
 */

type Pending = {
  readonly dispatchId: string;
  readonly actionIndex: number;
};

export type DirectorState = {
  readonly phase: GuideState;
  readonly scenes: readonly SceneScript[];
  readonly chapters: readonly Chapter[];
  readonly actor: TourActor;
  readonly sceneIndex: number;
  /** Actions of the current scene already acknowledged. */
  readonly actionIndex: number;
  /** The dispatched action whose acknowledgement is awaited or unresolved. */
  readonly pending: Pending | null;
  readonly attempts: number;
  readonly capsule: SceneCapsule | null;
  /** Scene indices that reached their checkpoint, in visiting order. */
  readonly validScenes: readonly number[];
  /** RESUME waiting for a resolution: whether the route was intact. */
  readonly resumeRouteIntact: boolean | null;
  /** The phases visited, oldest first, bounded. */
  readonly trail: readonly GuideState[];
};

export type Transition = {
  readonly state: DirectorState;
  readonly effects: readonly GuideEffect[];
};

const TRAIL_MAX = 64;

export type StartTourInput = {
  /** Scenes and chapters AFTER the certification gate (`certifyTour`). */
  readonly scenes: readonly SceneScript[];
  readonly chapters: readonly Chapter[];
  readonly actor: TourActor;
};

/** The first scene is prepared at once; an empty tour is COMPLETE. */
export function startTour(input: StartTourInput): Transition {
  const initial: DirectorState = {
    phase: "PREPARE_SCENE",
    scenes: input.scenes,
    chapters: input.chapters,
    actor: input.actor,
    sceneIndex: 0,
    actionIndex: 0,
    pending: null,
    attempts: 0,
    capsule: null,
    validScenes: [],
    resumeRouteIntact: null,
    trail: [],
  };
  if (input.scenes.length === 0) {
    return {
      state: enter(initial, "COMPLETE"),
      effects: [{ type: "COMPLETED" }],
    };
  }
  return prepare(initial, 0, 0);
}

export function cursorOf(state: DirectorState): SceneCursor | null {
  const scene = state.scenes[state.sceneIndex];
  if (scene === undefined) return null;
  return {
    sceneIndex: state.sceneIndex,
    sceneId: scene.sceneId,
    chapterId: scene.chapterId,
    actionIndex: state.actionIndex,
    expectedRoute: scene.expectedRoute,
  };
}

function enter(state: DirectorState, phase: GuideState): DirectorState {
  const trail = [...state.trail, phase];
  return {
    ...state,
    phase,
    trail: trail.length > TRAIL_MAX ? trail.slice(-TRAIL_MAX) : trail,
  };
}

function reject(
  state: DirectorState,
  event: GuideEvent,
  reason: RejectionReason,
): Transition {
  return { state, effects: [{ type: "REJECTED", event: event.type, reason }] };
}

function sceneAt(state: DirectorState, index: number): SceneScript {
  const scene = state.scenes[index];
  // Indices are the director's own and are bounds-checked where they are
  // set; a miss is a programming error, not an input to handle quietly.
  if (scene === undefined) throw new RangeError(`no scene at ${index}`);
  return scene;
}

function prepare(
  state: DirectorState,
  sceneIndex: number,
  actionIndex: number,
): Transition {
  const scene = sceneAt(state, sceneIndex);
  const next = enter(
    {
      ...state,
      sceneIndex,
      actionIndex,
      pending: null,
      capsule: null,
      resumeRouteIntact: null,
    },
    "PREPARE_SCENE",
  );
  const prefetch = state.scenes
    .slice(sceneIndex + 1, sceneIndex + 3)
    .map((s) => s.sceneId);
  return {
    state: next,
    effects: [
      { type: "PREPARE", sceneId: scene.sceneId, actor: state.actor, prefetch },
    ],
  };
}

function dispatch(
  state: DirectorState,
  phase: GuideState,
  leading: readonly GuideEffect[],
): Transition {
  const scene = sceneAt(state, state.sceneIndex);
  const action = scene.actions[state.actionIndex];
  if (action === undefined) throw new RangeError("no action to dispatch");
  const attempts = state.attempts + 1;
  const dispatchId = `${action.actionId}#${String(attempts)}`;
  return {
    state: enter(
      {
        ...state,
        attempts,
        pending: { dispatchId, actionIndex: state.actionIndex },
      },
      phase,
    ),
    effects: [
      ...leading,
      {
        type: "DISPATCH",
        dispatchId,
        action,
        deadlineMs: scene.ackTimeoutMs,
      },
    ],
  };
}

function linesAt(scene: SceneScript, timing: "BEFORE_ACK" | "AFTER_ACK") {
  return scene.lines.filter((line) => line.timing === timing);
}

/** All actions acknowledged: narrate the outcome, then CHECKPOINT. */
function acknowledge(state: DirectorState): Transition {
  const scene = sceneAt(state, state.sceneIndex);
  const after = linesAt(scene, "AFTER_ACK");
  const acked = enter({ ...state, pending: null }, "ACKNOWLEDGE");
  if (after.length > 0) {
    return { state: acked, effects: [{ type: "SPEAK", lines: after }] };
  }
  return checkpoint(acked);
}

function checkpoint(state: DirectorState): Transition {
  const validScenes = [
    ...state.validScenes.filter((i) => i !== state.sceneIndex),
    state.sceneIndex,
  ];
  const next = enter({ ...state, validScenes }, "CHECKPOINT");
  const cursor = cursorOf(next);
  return {
    state: next,
    effects: cursor === null ? [] : [{ type: "CHECKPOINT_REACHED", cursor }],
  };
}

/**
 * Stop what is in flight: queued narration, the actions not yet
 * dispatched, and a request to resolve the dispatched one (§7 steps 1-3).
 */
function halt(state: DirectorState): GuideEffect[] {
  const scene = state.scenes[state.sceneIndex];
  const effects: GuideEffect[] = [{ type: "CANCEL_SPEECH" }];
  if (scene !== undefined) {
    const from =
      state.pending === null
        ? state.actionIndex
        : state.pending.actionIndex + 1;
    const queued = scene.actions.slice(from).map((a) => a.actionId);
    if (queued.length > 0)
      effects.push({ type: "CANCEL_QUEUED", actionIds: queued });
  }
  if (state.pending !== null) {
    effects.push({
      type: "RESOLVE_DISPATCHED",
      dispatchId: state.pending.dispatchId,
    });
  }
  return effects;
}

function fallback(
  state: DirectorState,
  failureCode: TourFailureCode | "ACTOR_MISMATCH",
  leading: readonly GuideEffect[] = [],
): Transition {
  const scene = sceneAt(state, state.sceneIndex);
  return {
    state: enter({ ...state, capsule: null }, "SAFE_FALLBACK"),
    effects: [
      ...leading,
      ...halt(state),
      { type: "FALLBACK", sceneId: scene.sceneId, failureCode },
      { type: "SPEAK", lines: scene.fallbackLines },
    ],
  };
}

/** Leave the current scene for another one (back, jump). */
function moveTo(state: DirectorState, target: number): Transition {
  const effects = halt(state);
  const moved = prepare(
    { ...state, validScenes: state.validScenes.filter((i) => i < target) },
    target,
    0,
  );
  return { state: moved.state, effects: [...effects, ...moved.effects] };
}

function lastValidBefore(state: DirectorState): number | null {
  const scenesBefore = state.validScenes.filter((i) => i < state.sceneIndex);
  const last = scenesBefore.at(-1);
  if (last !== undefined) return last;
  // Nothing before it completed: the current scene itself, if it did.
  return state.validScenes.includes(state.sceneIndex) ? state.sceneIndex : null;
}

/** RESUME with no unresolved dispatch: back to work from the cursor. */
function resumeFromCursor(
  state: DirectorState,
  routeIntact: boolean,
): Transition {
  // The screen moved during the pause: the scene's own actions put it
  // back, from the first, rather than acting on the wrong page.
  return prepare(state, state.sceneIndex, routeIntact ? state.actionIndex : 0);
}

const HALTABLE: ReadonlySet<GuideState> = new Set<GuideState>([
  "PREPARE_SCENE",
  "READY",
  "SPEAK_AND_ACT",
  "ACKNOWLEDGE",
  "CHECKPOINT",
  "RESUME",
  "SAFE_FALLBACK",
  "PAUSED",
  "INTERRUPTED",
]);

export function transition(
  state: DirectorState,
  event: GuideEvent,
): Transition {
  switch (event.type) {
    case "SCENE_PREPARED": {
      if (state.phase !== "PREPARE_SCENE")
        return reject(state, event, "NOT_IN_THIS_STATE");
      const scene = sceneAt(state, state.sceneIndex);
      if (
        event.sceneId !== scene.sceneId ||
        event.capsule.sceneId !== scene.sceneId
      ) {
        return reject(state, event, "STALE_SCENE");
      }
      // A capsule for anyone but the current actor is never used: it may
      // hold another role's authorised citations.
      if (
        !sameActor(event.capsule.actor, state.actor) ||
        !sameActor(scene.actor, state.actor)
      ) {
        return fallback(state, "ACTOR_MISMATCH", [
          { type: "CLEAR_SCOPED", actor: event.capsule.actor },
        ]);
      }
      return {
        state: enter({ ...state, capsule: event.capsule }, "READY"),
        effects: [],
      };
    }
    case "SCENE_PREPARE_FAILED": {
      if (state.phase !== "PREPARE_SCENE")
        return reject(state, event, "NOT_IN_THIS_STATE");
      if (event.sceneId !== sceneAt(state, state.sceneIndex).sceneId) {
        return reject(state, event, "STALE_SCENE");
      }
      return fallback(state, event.failureCode);
    }
    case "BEGIN": {
      if (state.phase !== "READY")
        return reject(state, event, "NOT_IN_THIS_STATE");
      const scene = sceneAt(state, state.sceneIndex);
      if (state.actionIndex >= scene.actions.length) {
        // Resumed after every action landed: only the outcome is left.
        return acknowledge(enter(state, "SPEAK_AND_ACT"));
      }
      const before =
        state.actionIndex === 0 ? linesAt(scene, "BEFORE_ACK") : [];
      return dispatch(
        state,
        "SPEAK_AND_ACT",
        before.length > 0 ? [{ type: "SPEAK", lines: before }] : [],
      );
    }
    case "ACTION_RESULT": {
      if (state.phase !== "SPEAK_AND_ACT")
        return reject(state, event, "NOT_IN_THIS_STATE");
      const { result } = event;
      const scene = sceneAt(state, state.sceneIndex);
      const expected =
        state.pending === null
          ? undefined
          : scene.actions[state.pending.actionIndex];
      if (
        state.pending === null ||
        result.dispatchId !== state.pending.dispatchId ||
        expected === undefined ||
        result.actionId !== expected.actionId
      ) {
        return reject(state, event, "STALE_DISPATCH");
      }
      if (!result.ok || !result.visible) {
        // The outcome is known (failed), so nothing is left to resolve.
        return fallback(
          { ...state, pending: null },
          result.failureCode ?? "NOT_VISIBLE",
        );
      }
      const advanced: DirectorState = {
        ...state,
        actionIndex: state.pending.actionIndex + 1,
        pending: null,
      };
      if (advanced.actionIndex < scene.actions.length) {
        return dispatch(advanced, "SPEAK_AND_ACT", []);
      }
      return acknowledge(advanced);
    }
    case "ACK_TIMEOUT": {
      if (state.phase !== "SPEAK_AND_ACT")
        return reject(state, event, "NOT_IN_THIS_STATE");
      if (
        state.pending === null ||
        event.dispatchId !== state.pending.dispatchId
      ) {
        return reject(state, event, "STALE_DISPATCH");
      }
      // It may still land: the host is asked to resolve it (halt does).
      return fallback(state, "ACK_TIMEOUT");
    }
    case "SPEECH_DONE": {
      if (state.phase !== "ACKNOWLEDGE")
        return reject(state, event, "NOT_IN_THIS_STATE");
      return checkpoint(state);
    }
    case "CONTINUE": {
      if (state.phase !== "CHECKPOINT")
        return reject(state, event, "NOT_ACKNOWLEDGED");
      const advancing = enter(state, "ADVANCE");
      const next = state.sceneIndex + 1;
      if (next >= state.scenes.length) {
        return {
          state: enter({ ...advancing, capsule: null }, "COMPLETE"),
          effects: [{ type: "COMPLETED" }],
        };
      }
      return prepare(advancing, next, 0);
    }
    case "PAUSE":
    case "INTERRUPT": {
      if (!HALTABLE.has(state.phase))
        return reject(state, event, "NOT_IN_THIS_STATE");
      const target: GuideState =
        event.type === "PAUSE" ? "PAUSED" : "INTERRUPTED";
      const already = state.phase === "PAUSED" || state.phase === "INTERRUPTED";
      return {
        state: enter({ ...state, resumeRouteIntact: null }, target),
        // Already halted: nothing new is in flight to cancel.
        effects: already ? [] : halt(state),
      };
    }
    case "DISPATCH_RESOLVED": {
      if (
        state.pending === null ||
        event.dispatchId !== state.pending.dispatchId
      ) {
        return reject(state, event, "STALE_DISPATCH");
      }
      if (
        state.phase !== "PAUSED" &&
        state.phase !== "INTERRUPTED" &&
        state.phase !== "RESUME" &&
        state.phase !== "SAFE_FALLBACK"
      ) {
        return reject(state, event, "NOT_IN_THIS_STATE");
      }
      const resolved: DirectorState = {
        ...state,
        actionIndex: event.completed
          ? state.pending.actionIndex + 1
          : state.pending.actionIndex,
        pending: null,
      };
      if (state.phase === "RESUME" && state.resumeRouteIntact !== null) {
        return resumeFromCursor(resolved, state.resumeRouteIntact);
      }
      return { state: resolved, effects: [] };
    }
    case "RESUME": {
      if (state.phase !== "PAUSED" && state.phase !== "INTERRUPTED") {
        return reject(state, event, "NOT_IN_THIS_STATE");
      }
      if (state.scenes[state.sceneIndex] === undefined) {
        return reject(state, event, "NO_VALID_SCENE");
      }
      const resuming = enter(
        { ...state, resumeRouteIntact: event.routeIntact },
        "RESUME",
      );
      if (state.pending !== null) {
        // §7 step 3: whether it landed decides where to resume from.
        return {
          state: resuming,
          effects: [
            {
              type: "RESOLVE_DISPATCHED",
              dispatchId: state.pending.dispatchId,
            },
          ],
        };
      }
      return resumeFromCursor(resuming, event.routeIntact);
    }
    case "GO_BACK": {
      const target = lastValidBefore(state);
      if (target === null) return reject(state, event, "NO_VALID_SCENE");
      return moveTo(state, target);
    }
    case "JUMP_TO_CHAPTER": {
      const chapter = state.chapters.find(
        (c) => c.chapterId === event.chapterId,
      );
      const target =
        chapter === undefined
          ? -1
          : state.scenes.findIndex((s) => chapter.sceneIds.includes(s.sceneId));
      if (target < 0) return reject(state, event, "CHAPTER_UNAVAILABLE");
      return moveTo(state, target);
    }
    case "ROLE_SWITCHED": {
      if (sameActor(event.actor, state.actor))
        return reject(state, event, "SAME_ACTOR");
      const already = state.phase === "PAUSED" || state.phase === "INTERRUPTED";
      const effects: GuideEffect[] = [
        ...(already || state.phase === "COMPLETE" ? [] : halt(state)),
        // Everything scoped to the old actor goes, whatever the phase.
        { type: "CLEAR_SCOPED", actor: state.actor },
      ];
      return {
        state: enter(
          {
            ...state,
            actor: event.actor,
            capsule: null,
            resumeRouteIntact: null,
          },
          state.phase === "COMPLETE" ? "COMPLETE" : "PAUSED",
        ),
        effects,
      };
    }
    case "FALLBACK_DONE": {
      if (state.phase !== "SAFE_FALLBACK")
        return reject(state, event, "NOT_IN_THIS_STATE");
      // Back to the last valid scene, or this scene's start, and let the
      // person decide: a failed step is never retried behind their back.
      const target = lastValidBefore(state) ?? state.sceneIndex;
      return {
        state: enter(
          { ...state, sceneIndex: target, actionIndex: 0, pending: null },
          "PAUSED",
        ),
        effects: [],
      };
    }
  }
}
