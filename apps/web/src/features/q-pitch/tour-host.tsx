"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  PILOT_CERTIFICATION_LEDGER,
  PILOT_SCRIPT,
  TourActorSchema,
  TourRunner,
  certifyTour,
  type DuplexState,
  type TourActor,
  type TourControlKind,
  type TourSnapshot,
} from "@capital-q/q-pitch";

import { useTourPorts } from "./use-tour-ports";

/**
 * Q Pitch host (QP-F08/F09): Q narrates the real app. Mounted once in the
 * application layout, so a tour survives every client route change.
 *
 * Internal rehearsal only. The script is DRAFT (blueprint §15, §16), so the
 * certification gate admits it only as INTERNAL_REHEARSAL, and the overlay
 * says so. Every control is an AUDIENCE intent from a button or key. Nothing
 * Q or a rehearsal voice says can steer the tour.
 */

const NO_AUDIO: DuplexState = {
  narratorPlaying: false,
  counterpartPlaying: false,
  echoCancellation: false,
};

const CHECKPOINT_BEAT_MS = 1_200;

let intentSequence = 0;

const PHASE_WORDS: Record<TourSnapshot["phase"], string> = {
  PREPARE_SCENE: "Preparing",
  READY: "Ready",
  SPEAK_AND_ACT: "Working on screen",
  ACKNOWLEDGE: "Done on screen",
  CHECKPOINT: "Scene complete",
  ADVANCE: "Next scene",
  PAUSED: "Paused",
  INTERRUPTED: "Paused for your question",
  RESUME: "Resuming",
  SAFE_FALLBACK: "That step did not complete",
  COMPLETE: "Tour complete",
};

function actionWords(snapshot: TourSnapshot): string | null {
  const action = snapshot.awaiting;
  if (action === null) return null;
  switch (action.kind) {
    case "openRoute":
    case "openCompany":
    case "showReview":
    case "showQJob":
      return "Waiting for the page to open";
    case "selectTab":
    case "scrollTo":
      return "Waiting for the page to show it";
    case "askApprovedQuestion":
    case "buildComparison":
      return "Q is answering. Waiting for the answer on screen";
  }
}

export function QPitchHost({
  account,
  role,
  onExit,
}: {
  readonly account: string;
  readonly role: "INVESTOR" | "FOUNDER";
  readonly onExit: () => void;
}) {
  const actor = useMemo<TourActor | null>(() => {
    const parsed = TourActorSchema.safeParse({ role, account });
    return parsed.success ? parsed.data : null;
  }, [account, role]);
  const ports = useTourPorts(PILOT_SCRIPT);
  // The live runner, held in a tiny external store: the effect that owns
  // its lifetime publishes it, so a remount (Strict Mode) builds a fresh one.
  const slot = useMemo(() => createSlot<TourRunner>(), []);
  const runner = useSyncExternalStore(slot.subscribe, slot.get, slot.none);

  useEffect(() => {
    if (actor === null || ports === null) return;
    const gate = certifyTour(PILOT_SCRIPT, PILOT_CERTIFICATION_LEDGER, {
      now: new Date().toISOString(),
      // Rehearsal: the integration owner marks stale ids before any audience run.
      staleFeatureIds: [],
      audience: "INTERNAL_REHEARSAL",
    });
    const next = new TourRunner({
      scenes: gate.scenes,
      chapters: gate.chapters,
      actor,
      ports,
      checkpointBeatMs: CHECKPOINT_BEAT_MS,
    });
    slot.set(next);
    next.start();
    return () => {
      next.dispose();
      slot.set(null);
    };
  }, [actor, ports, slot]);

  if (actor === null) {
    return (
      <TourFrame onExit={onExit}>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Q Pitch runs only on a fictional demo account. This account is not
          one, so the tour has not started.
        </p>
      </TourFrame>
    );
  }
  if (runner === null) return null;
  return <TourOverlay runner={runner} onExit={onExit} />;
}

function createSlot<T>() {
  let value: T | null = null;
  const listeners = new Set<() => void>();
  return {
    get: (): T | null => value,
    none: (): T | null => null,
    set: (next: T | null) => {
      value = next;
      for (const notify of [...listeners]) notify();
    },
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  };
}

function useSnapshot(runner: TourRunner): TourSnapshot {
  const subscribe = useCallback(
    (notify: () => void) => runner.subscribe(() => notify()),
    [runner],
  );
  const get = useCallback(() => runner.snapshot(), [runner]);
  return useSyncExternalStore(subscribe, get, get);
}

function TourOverlay({
  runner,
  onExit,
}: {
  readonly runner: TourRunner;
  readonly onExit: () => void;
}) {
  const snapshot = useSnapshot(runner);
  const [chaptersOpen, setChaptersOpen] = useState(false);

  const send = (
    kind: TourControlKind,
    modality: "POINTER" | "KEYBOARD" = "POINTER",
    chapterId?: string,
  ) => {
    intentSequence += 1;
    runner.control(
      {
        intentId: `qp-${String(Date.now())}-${String(intentSequence)}`,
        source: "AUDIENCE_MIC",
        modality,
        kind,
        ...(chapterId === undefined ? {} : { chapterId }),
      },
      NO_AUDIO,
    );
  };

  const halted =
    snapshot.phase === "PAUSED" || snapshot.phase === "INTERRUPTED";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      // Escape pauses: the one key that is always safe to steal.
      if (event.key === "Escape" && !halted) send("PAUSE", "KEYBOARD");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const scene = snapshot.scene;
  const position =
    snapshot.cursor === null
      ? null
      : `Scene ${String(snapshot.cursor.sceneIndex + 1)} of ${String(snapshot.sceneCount)}`;
  const working = actionWords(snapshot);
  const fallback =
    snapshot.notice?.kind === "FALLBACK" ? snapshot.notice.failureCode : null;

  return (
    <TourFrame onExit={onExit}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="cq-label text-(--cq-text-primary)">
          {scene?.title ?? "Q Pitch"}
        </p>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {[position, PHASE_WORDS[snapshot.phase]].filter(Boolean).join(" · ")}
        </p>
      </div>
      <p
        className="cq-body min-h-12 text-(--cq-text-primary)"
        aria-live="polite"
        data-q-pitch-caption
      >
        {snapshot.caption?.text ?? working ?? ""}
      </p>
      {fallback === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          Q stopped here and won&apos;t describe it ({fallback}). Resume, or go
          back.
        </p>
      )}
      <div
        className="flex flex-wrap items-center gap-2"
        role="toolbar"
        aria-label="Tour controls"
      >
        <TourButton label="Back" onPress={() => send("BACK")} />
        {halted ? (
          <TourButton label="Resume" primary onPress={() => send("RESUME")} />
        ) : (
          <TourButton label="Pause" primary onPress={() => send("PAUSE")} />
        )}
        <TourButton label="Show me that again" onPress={() => send("REPEAT")} />
        <TourButton label="Skip" onPress={() => send("SKIP")} />
        <TourButton
          label="Chapters"
          expanded={chaptersOpen}
          onPress={() => setChaptersOpen((open) => !open)}
        />
      </div>
      {chaptersOpen ? (
        <ul className="flex flex-col gap-1" aria-label="Chapters">
          {snapshot.chapters.map((chapter) => (
            <li key={chapter.chapterId}>
              <TourButton
                label={chapter.title}
                onPress={() => {
                  setChaptersOpen(false);
                  send("JUMP", "POINTER", chapter.chapterId);
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </TourFrame>
  );
}

function TourFrame({
  children,
  onExit,
}: {
  readonly children: React.ReactNode;
  readonly onExit: () => void;
}) {
  return (
    <section
      aria-label="Q Pitch tour"
      data-q-pitch
      className="fixed inset-x-4 bottom-24 z-(--cq-z-presence) mx-auto flex max-w-xl flex-col gap-3 rounded-lg border border-(--cq-border) bg-(--cq-surface-raised) p-4 shadow-(--cq-shadow-overlay) lg:bottom-6"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Internal rehearsal · draft script · demonstration data
        </p>
        <TourButton label="End tour" onPress={onExit} />
      </div>
      {children}
    </section>
  );
}

function TourButton({
  label,
  onPress,
  primary = false,
  expanded,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly primary?: boolean;
  readonly expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-expanded={expanded}
      className={
        primary
          ? "inline-flex min-h-11 items-center rounded-md bg-(--cq-accent) px-4 cq-body-sm font-medium text-(--cq-text-inverse) hover:bg-(--cq-accent-hover)"
          : "inline-flex min-h-11 items-center rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 cq-body-sm text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
      }
    >
      {label}
    </button>
  );
}
