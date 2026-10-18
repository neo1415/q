import {
  classifyAudienceJump,
  classifyAudienceSpeech,
  TourControlGate,
  type ControlDecision,
  type DuplexState,
} from "./control-channel.js";
import { cursorOf, startTour, transition } from "./director.js";
import {
  parseStepCommand,
  resolveStepCommand,
  type StepMove,
} from "./step-commands.js";
import type { DirectorState } from "./director.js";
import type {
  GuideEffect,
  GuideEvent,
  SceneCapsule,
  SceneCursor,
} from "./guide.js";
import type { SceneId, TourActor } from "./scene-evidence.js";
import type { Chapter, SceneLine, SceneScript } from "./script.js";
import type {
  TourAction,
  TourActionResult,
  TourFailureCode,
} from "./tour-action.js";

/**
 * The tour runner: performs the director's effects through injected ports
 * and feeds the outcomes back as events. It owns timers, cancellation and
 * the order of speech and action; the director owns every decision.
 *
 * Invariants (each has a test in test/tour-runner.test.ts):
 * - An AFTER_ACK line is spoken only after the browser's DONE receipt for
 *   every action of the scene (the director's rule; the runner never
 *   short-cuts it).
 * - Pause, interrupt, back, skip, repeat and jump abort queued speech and
 *   the in-flight action's wait; a late result of an aborted dispatch is
 *   ignored by dispatch id.
 * - The next two scenes are warmed on every PREPARE, for the current actor.
 * - Tour control comes only through `TourControlGate`: synthetic sources
 *   (the narrator, a rehearsal counterpart, the script) never steer.
 *
 * No clock reads except through `ports.schedule`; no DOM, no network.
 */

export type ActionOutcome = Pick<
  TourActionResult,
  "ok" | "observedRoute" | "visible" | "failureCode"
>;

export type PrepareOutcome =
  | { readonly ok: true; readonly capsule: SceneCapsule }
  | { readonly ok: false; readonly failureCode: TourFailureCode };

export type TourPorts = {
  /** Resolve the scene's fixtures for `actor`; never for another actor. */
  readonly prepare: (
    scene: SceneScript,
    actor: TourActor,
    signal: AbortSignal,
  ) => Promise<PrepareOutcome>;
  /** Warm routes, data and media of upcoming scenes for this actor only. */
  readonly prefetch: (scenes: readonly SceneScript[], actor: TourActor) => void;
  /**
   * Perform one action through the app's acknowledged paths and resolve
   * with what the browser observed. Must settle promptly once `signal`
   * aborts, reporting truthfully whether the effect happened anyway.
   */
  readonly execute: (
    action: TourAction,
    signal: AbortSignal,
  ) => Promise<ActionOutcome>;
  /** Speak (or caption) lines in order; resolves when done or aborted. */
  readonly speak: (
    lines: readonly SceneLine[],
    signal: AbortSignal,
  ) => Promise<void>;
  /** Drop everything cached for `actor` (role switch, actor mismatch). */
  readonly clearScoped: (actor: TourActor) => void;
  /** Is the screen still on the scene's expected route pattern? */
  readonly routeIntact: (expectedRoute: string) => boolean;
  /** Timers; returns a cancel function. */
  readonly schedule: (ms: number, run: () => void) => () => void;
};

export type TourRunnerOptions = {
  readonly scenes: readonly SceneScript[];
  readonly chapters: readonly Chapter[];
  readonly actor: TourActor;
  readonly ports: TourPorts;
  /** Premiere pace: pause after a checkpoint, then CONTINUE. Null: wait. */
  readonly checkpointBeatMs: number | null;
};

export type TourNotice =
  | { readonly kind: "FALLBACK"; readonly failureCode: string }
  | { readonly kind: "CANCELLED_QUEUED"; readonly count: number }
  | {
      readonly kind: "REJECTED";
      readonly event: string;
      readonly reason: string;
    }
  | { readonly kind: "CONTROL_REFUSED"; readonly reason: string };

export type TourSnapshot = {
  readonly phase: DirectorState["phase"];
  readonly cursor: SceneCursor | null;
  readonly scene: SceneScript | null;
  /** The line on screen now, while spoken. */
  readonly caption: SceneLine | null;
  /** The action whose DONE receipt is awaited, if any. */
  readonly awaiting: TourAction | null;
  readonly notice: TourNotice | null;
  readonly chapters: readonly Chapter[];
  readonly sceneCount: number;
};

type Dispatch = {
  readonly dispatchId: string;
  readonly controller: AbortController;
  cancelTimer: () => void;
  outcome: ActionOutcome | null;
  readonly settled: Promise<ActionOutcome>;
};

export class TourRunner {
  #state: DirectorState;
  readonly #ports: TourPorts;
  readonly #beat: number | null;
  readonly #gate = new TourControlGate();
  readonly #listeners = new Set<(snapshot: TourSnapshot) => void>();
  #speech = new AbortController();
  #speechChain: Promise<void> = Promise.resolve();
  #prepare: AbortController | null = null;
  #dispatch: Dispatch | null = null;
  #cancelBeat: (() => void) | null = null;
  #caption: SceneLine | null = null;
  #notice: TourNotice | null = null;
  #started = false;
  #snapshot: TourSnapshot | null = null;
  #disposed = false;
  readonly #initialEffects: readonly GuideEffect[];

  constructor(options: TourRunnerOptions) {
    this.#ports = options.ports;
    this.#beat = options.checkpointBeatMs;
    const begun = startTour({
      scenes: options.scenes,
      chapters: options.chapters,
      actor: options.actor,
    });
    this.#state = begun.state;
    this.#initialEffects = begun.effects;
  }

  /** Performs the first scene's preparation. Idempotent. */
  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    this.#perform(this.#initialEffects);
    this.#emit();
  }

  get state(): DirectorState {
    return this.#state;
  }

  /** Stable between changes, so a UI store can compare by identity. */
  snapshot(): TourSnapshot {
    this.#snapshot ??= this.#compute();
    return this.#snapshot;
  }

  #compute(): TourSnapshot {
    const scene = this.#state.scenes[this.#state.sceneIndex] ?? null;
    const pending = this.#state.pending;
    return {
      phase: this.#state.phase,
      cursor: cursorOf(this.#state),
      scene,
      caption: this.#caption,
      awaiting:
        pending === null || scene === null
          ? null
          : (scene.actions[pending.actionIndex] ?? null),
      notice: this.#notice,
      chapters: this.#state.chapters,
      sceneCount: this.#state.scenes.length,
    };
  }

  subscribe(listener: (snapshot: TourSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * The only way a person steers the tour. The intent is validated, its
   * source checked and de-duplicated; RESUME reads the route first.
   */
  control(raw: unknown, duplex: DuplexState): ControlDecision {
    const decision = this.#gate.admit(raw, duplex);
    if (!decision.admitted) {
      this.#notice = { kind: "CONTROL_REFUSED", reason: decision.reason };
      this.#emit();
      return decision;
    }
    if (decision.intent.kind === "RESUME") {
      const scene = this.#state.scenes[this.#state.sceneIndex];
      const routeIntact =
        scene === undefined
          ? false
          : this.#ports.routeIntact(scene.expectedRoute);
      this.#feed({ type: "RESUME", routeIntact });
    } else if (decision.event !== null) {
      this.#feed(decision.event);
    }
    return decision;
  }

  /** Transcript from any channel: recorded, never interpreted as control. */
  noteTranscript(raw: unknown): void {
    this.#gate.noteSegment(raw);
  }

  /**
   * A final segment from the audience mic: recorded, classified by the
   * tour's closed phrase set, and offered to the gate as a VOICE intent.
   * A segment from any other source is only recorded. While the tour is
   * halted, a question is not an interruption (nothing is running).
   */
  hearAudience(raw: unknown, duplex: DuplexState): ControlDecision | null {
    const segment = this.#gate.noteSegment(raw);
    if (segment === null) return null;
    // v6: a spoken step command, numbers and all, before the phrase set.
    if (segment.source === "AUDIENCE_MIC" && segment.final) {
      const stepped = this.stepCommand(
        segment.text,
        {
          intentId: `voice-${segment.segmentId}`,
          modality: "VOICE",
          segmentId: segment.segmentId,
        },
        duplex,
      );
      if (stepped !== null) {
        return stepped.decision ?? { admitted: false, reason: "INVALID" };
      }
    }
    const spoken = classifyAudienceSpeech(segment);
    if (spoken === null) return null;
    // "Show me GateQ": a jump, when it names one of this tour's chapters.
    const chapterId =
      spoken === "INTERRUPT"
        ? classifyAudienceJump(segment, this.#state.chapters)
        : null;
    if (chapterId !== null) {
      return this.control(
        {
          intentId: `voice-${segment.segmentId}`.slice(0, 128),
          source: segment.source,
          modality: "VOICE",
          kind: "JUMP",
          chapterId,
          segmentId: segment.segmentId,
        },
        duplex,
      );
    }
    const kind = spoken;
    const halted =
      this.#state.phase === "PAUSED" ||
      this.#state.phase === "INTERRUPTED" ||
      this.#state.phase === "COMPLETE";
    if (kind === "INTERRUPT" && halted) return null;
    return this.control(
      {
        intentId: `voice-${segment.segmentId}`.slice(0, 128),
        source: segment.source,
        modality: "VOICE",
        kind,
        segmentId: segment.segmentId,
      },
      duplex,
    );
  }

  /**
   * v6: a step command, typed or spoken ("next", "back two", "go to step
   * 7"), resolved against the step on screen and offered to the gate.
   * Null when the text is not a whole command (it stays a question).
   * OUT_OF_RANGE is returned undecided, so the host can say there is no
   * such step instead of landing anywhere else.
   */
  stepCommand(
    text: string,
    input: {
      readonly intentId: string;
      readonly modality: "KEYBOARD" | "VOICE";
      readonly segmentId?: string | undefined;
    },
    duplex: DuplexState,
  ): {
    readonly move: StepMove;
    readonly decision: ControlDecision | null;
  } | null {
    const command = parseStepCommand(text);
    if (command === null) return null;
    const move = resolveStepCommand(
      command,
      this.#state.sceneIndex,
      this.#state.scenes.length,
    );
    if (move.kind === "OUT_OF_RANGE") return { move, decision: null };
    const base = {
      intentId: input.intentId.slice(0, 128),
      source: "AUDIENCE_MIC" as const,
      modality: input.modality,
      ...(input.segmentId === undefined ? {} : { segmentId: input.segmentId }),
    };
    const decision = this.control(
      move.kind === "STEP"
        ? { ...base, kind: "STEP", step: move.step }
        : { ...base, kind: move.kind },
      duplex,
    );
    return { move, decision };
  }

  /** A server-confirmed workspace switch (QP-F10); never a UI toggle. */
  roleSwitched(actor: TourActor): void {
    this.#feed({ type: "ROLE_SWITCHED", actor });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#speech.abort();
    this.#prepare?.abort();
    this.#abortDispatch();
    this.#cancelBeat?.();
    this.#listeners.clear();
  }

  #feed(event: GuideEvent): void {
    if (this.#disposed) return;
    const next = transition(this.#state, event);
    this.#state = next.state;
    this.#perform(next.effects);
    // READY means prepared and not halted: begin at once.
    if (this.#state.phase === "READY") {
      const began = transition(this.#state, { type: "BEGIN" });
      this.#state = began.state;
      this.#perform(began.effects);
    }
    this.#emit();
  }

  #emit(): void {
    this.#snapshot = this.#compute();
    const snapshot = this.#snapshot;
    for (const listener of [...this.#listeners]) listener(snapshot);
  }

  #perform(effects: readonly GuideEffect[]): void {
    for (const effect of effects) this.#effect(effect);
  }

  #effect(effect: GuideEffect): void {
    switch (effect.type) {
      case "PREPARE": {
        this.#cancelBeat?.();
        this.#prepare?.abort();
        const controller = new AbortController();
        this.#prepare = controller;
        const scene = this.#state.scenes.find(
          (s) => s.sceneId === effect.sceneId,
        );
        if (scene === undefined) return;
        const upcoming = effect.prefetch
          .map((id: SceneId) =>
            this.#state.scenes.find((s) => s.sceneId === id),
          )
          .filter((s): s is SceneScript => s !== undefined);
        if (upcoming.length > 0) this.#ports.prefetch(upcoming, effect.actor);
        void this.#ports
          .prepare(scene, effect.actor, controller.signal)
          .catch((): PrepareOutcome => ({
            ok: false,
            failureCode: "FIXTURE_UNRESOLVED",
          }))
          .then((outcome) => {
            if (controller.signal.aborted || this.#prepare !== controller)
              return;
            this.#prepare = null;
            this.#feed(
              outcome.ok
                ? {
                    type: "SCENE_PREPARED",
                    sceneId: scene.sceneId,
                    capsule: outcome.capsule,
                  }
                : {
                    type: "SCENE_PREPARE_FAILED",
                    sceneId: scene.sceneId,
                    failureCode: outcome.failureCode,
                  },
            );
          });
        return;
      }
      case "SPEAK": {
        const signal = this.#speech.signal;
        const phaseAtRequest = this.#state.phase;
        const lines = effect.lines;
        this.#speechChain = this.#speechChain.then(async () => {
          for (const line of lines) {
            if (signal.aborted) return;
            this.#caption = line;
            this.#emit();
            await this.#ports.speak([line], signal).catch(() => undefined);
          }
          if (signal.aborted) return;
          this.#caption = null;
          this.#emit();
          // Only the narration the director is waiting on reports back.
          if (
            phaseAtRequest === "ACKNOWLEDGE" &&
            this.#state.phase === "ACKNOWLEDGE"
          ) {
            this.#feed({ type: "SPEECH_DONE" });
          } else if (
            phaseAtRequest === "SAFE_FALLBACK" &&
            this.#state.phase === "SAFE_FALLBACK"
          ) {
            this.#feed({ type: "FALLBACK_DONE" });
          }
        });
        return;
      }
      case "CANCEL_SPEECH": {
        this.#speech.abort();
        this.#speech = new AbortController();
        this.#speechChain = Promise.resolve();
        this.#caption = null;
        this.#cancelBeat?.();
        this.#cancelBeat = null;
        this.#prepare?.abort();
        this.#prepare = null;
        return;
      }
      case "CANCEL_QUEUED": {
        this.#notice = {
          kind: "CANCELLED_QUEUED",
          count: effect.actionIds.length,
        };
        return;
      }
      case "DISPATCH": {
        this.#abortDispatch();
        const controller = new AbortController();
        const { dispatchId } = effect;
        let record: Dispatch | null = null;
        const settled = this.#ports
          .execute(effect.action, controller.signal)
          .catch((): ActionOutcome => ({
            ok: false,
            observedRoute: null,
            visible: false,
            failureCode: "FAILED",
          }))
          .then((outcome) => {
            if (record !== null) {
              record.outcome = outcome;
              record.cancelTimer();
            }
            if (this.#dispatch?.dispatchId !== dispatchId) return outcome;
            if (this.#state.phase === "SPEAK_AND_ACT") {
              this.#feed({
                type: "ACTION_RESULT",
                result: {
                  actionId: effect.action.actionId,
                  dispatchId,
                  ...normalise(outcome),
                },
              });
            }
            return outcome;
          });
        record = {
          dispatchId,
          controller,
          cancelTimer: () => undefined,
          outcome: null,
          settled,
        };
        record.cancelTimer = this.#ports.schedule(effect.deadlineMs, () => {
          if (this.#dispatch?.dispatchId === dispatchId) {
            this.#feed({ type: "ACK_TIMEOUT", dispatchId });
          }
        });
        this.#dispatch = record;
        return;
      }
      case "RESOLVE_DISPATCHED": {
        const record = this.#dispatch;
        if (record === null || record.dispatchId !== effect.dispatchId) return;
        record.cancelTimer();
        // Stop waiting for it; the port reports whether it landed anyway.
        if (record.outcome === null) record.controller.abort();
        void record.settled.then((outcome) => {
          if (this.#dispatch !== record) return;
          this.#dispatch = null;
          this.#feed({
            type: "DISPATCH_RESOLVED",
            dispatchId: record.dispatchId,
            completed: outcome.ok && outcome.visible,
          });
        });
        return;
      }
      case "CLEAR_SCOPED": {
        this.#ports.clearScoped(effect.actor);
        return;
      }
      case "CHECKPOINT_REACHED": {
        if (this.#beat === null) return;
        this.#cancelBeat?.();
        this.#cancelBeat = this.#ports.schedule(this.#beat, () => {
          this.#cancelBeat = null;
          if (this.#state.phase === "CHECKPOINT")
            this.#feed({ type: "CONTINUE" });
        });
        return;
      }
      case "FALLBACK": {
        this.#notice = { kind: "FALLBACK", failureCode: effect.failureCode };
        return;
      }
      case "REJECTED": {
        this.#notice = {
          kind: "REJECTED",
          event: effect.event,
          reason: effect.reason,
        };
        return;
      }
      case "COMPLETED": {
        this.#caption = null;
        return;
      }
    }
  }

  #abortDispatch(): void {
    const record = this.#dispatch;
    if (record === null) return;
    record.cancelTimer();
    // A settled action is left alone: aborting it would ask the port to
    // undo or stop something that already finished.
    if (record.outcome === null) record.controller.abort();
    this.#dispatch = null;
  }
}

/** Keeps the result schema's invariants whatever a port reports. */
function normalise(outcome: ActionOutcome): ActionOutcome {
  if (outcome.ok && outcome.visible && outcome.failureCode === null) {
    return outcome;
  }
  return {
    ok: false,
    observedRoute: outcome.observedRoute,
    visible: outcome.visible,
    failureCode:
      outcome.failureCode ?? (outcome.visible ? "FAILED" : "NOT_VISIBLE"),
  };
}

/** `/company/[companyId]` style pattern against a concrete path. */
export function routeMatchesPattern(pattern: string, path: string): boolean {
  const clean = (p: string) =>
    (p.split(/[?#]/u)[0] ?? "").replace(/\/+$/u, "") || "/";
  const want = clean(pattern).split("/");
  const got = clean(path).split("/");
  if (want.length !== got.length) return false;
  return want.every((segment, i) => {
    const actual = got[i] ?? "";
    return /^\[[A-Za-z0-9_]+\]$/u.test(segment)
      ? actual.length > 0
      : segment === actual;
  });
}
