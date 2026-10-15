"use client";

import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  PILOT_CERTIFICATION_LEDGER,
  PILOT_SCRIPT,
  PREMIERE_CERTIFICATION_LEDGER,
  PREMIERE_SCRIPT,
  SHORT_SCRIPT,
  TourActorSchema,
  TourRunner,
  certifyTour,
  type DuplexState,
  type TourActor,
  type TourControlKind,
  type TourSnapshot,
  type TranscriptSegment,
} from "@capital-q/q-pitch";

import { useQSessionOptional } from "@/features/q/q-session";

import type { TourSubject } from "./subject-model";
import { setNarrationVoice, standardVoicePlaying } from "./narrator";
import { openTourVoice } from "./tour-voice";
import { useTourPorts, type TranscriptSink } from "./use-tour-ports";

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
    case "runShortRehearsal":
      return "Simulation running. It ends on its own in about half a minute";
  }
}

export type TourChoice = "pilot" | "premiere" | "short";

/**
 * Which script, and what the gate may admit. The premiere opts into
 * CODE_VERIFIED scenes, as an INTERNAL_REHEARSAL only, to rehearse the full
 * r3 cut and collect the browser receipts that would promote them.
 */
const TOURS = {
  pilot: {
    script: PILOT_SCRIPT,
    ledger: PILOT_CERTIFICATION_LEDGER,
    accepted: ["PRODUCTION_LIVE_VERIFIED"],
    label: "Internal rehearsal · draft script · demonstration data",
  },
  short: {
    script: SHORT_SCRIPT,
    ledger: PREMIERE_CERTIFICATION_LEDGER,
    accepted: ["PRODUCTION_LIVE_VERIFIED"],
    label: "Internal rehearsal · two-minute draft · demonstration data",
  },
  premiere: {
    script: PREMIERE_SCRIPT,
    ledger: PREMIERE_CERTIFICATION_LEDGER,
    accepted: ["PRODUCTION_LIVE_VERIFIED", "CODE_VERIFIED"],
    label:
      "Internal rehearsal · draft r3 · includes code-verified scenes without a browser receipt · demonstration data",
  },
} as const;

/** A spoken line id as a segment id (the gate's opaque id grammar). */
function segmentIdOf(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^A-Za-z0-9:._-]/gu, "_")}`.slice(0, 128);
}

export function QPitchHost({
  account,
  role,
  tour,
  chapter,
  subject,
  onExit,
}: {
  readonly account: string;
  /** The subject company, already re-checked for this viewer on the server. */
  readonly subject: TourSubject | null;
  readonly role: "INVESTOR" | "FOUNDER";
  readonly tour: TourChoice;
  /** Feature Atlas: start at this chapter (a director jump, never a URL). */
  readonly chapter: string | null;
  readonly onExit: () => void;
}) {
  const choice = TOURS[tour];
  const actor = useMemo<TourActor | null>(() => {
    const parsed = TourActorSchema.safeParse({ role, account });
    return parsed.success ? parsed.data : null;
  }, [account, role]);
  const transcript: TranscriptSink = useRef(null);
  const ports = useTourPorts(choice.script, transcript, subject);
  const session = useQSessionOptional();
  // The tour starts on the person's press (a gesture, so Q's voice may
  // play), after Q's live line is open when it is offered (owner 15 Oct).
  const [phase, setPhase] = useState<"WAITING" | "STARTING" | "RUNNING">(
    "WAITING",
  );
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const begin = useCallback(async (withVoice: boolean) => {
    setNarrationVoice(withVoice);
    setPhase("STARTING");
    if (withVoice) await openTourVoice(() => sessionRef.current);
    setPhase("RUNNING");
  }, []);
  // The live runner, held in a tiny external store: the effect that owns
  // its lifetime publishes it, so a remount (Strict Mode) builds a fresh one.
  const slot = useMemo(() => createSlot<TourRunner>(), []);
  const runner = useSyncExternalStore(slot.subscribe, slot.get, slot.none);
  const heard = useMemo(() => createSlot<TranscriptSegment>(), []);
  const simulation = useSyncExternalStore(
    heard.subscribe,
    heard.get,
    heard.none,
  );
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (actor === null || ports === null || phase !== "RUNNING") return;
    const gate = certifyTour(choice.script, choice.ledger, {
      now: new Date().toISOString(),
      // Rehearsal: the integration owner marks stale ids before any audience run.
      staleFeatureIds: [],
      audience: "INTERNAL_REHEARSAL",
      acceptedStatuses: choice.accepted,
    });
    const next = new TourRunner({
      scenes: gate.scenes,
      chapters: gate.chapters,
      actor,
      ports,
      checkpointBeatMs: CHECKPOINT_BEAT_MS,
    });
    // Rehearsal turns are transcript for the gate, and captions; never control.
    transcript.current = (segment) => {
      next.noteTranscript(segment);
      heard.set(segment);
    };
    slot.set(next);
    next.start();
    if (chapter !== null) {
      // The Atlas entry: an audience jump through the gate, like the
      // Chapters control; an unknown chapter is refused by the director.
      next.control(
        {
          intentId: `qp-atlas-${String(Date.now())}`,
          source: "AUDIENCE_MIC",
          modality: "POINTER",
          kind: "JUMP",
          chapterId: chapter,
        },
        NO_AUDIO,
      );
    }
    return () => {
      transcript.current = null;
      next.dispose();
      slot.set(null);
      heard.set(null);
    };
  }, [actor, ports, slot, heard, choice, transcript, chapter, phase]);

  // The voice line's transcript. The person's lines are AUDIENCE_MIC and
  // offered to the gate; Q's own spoken lines are recorded as NARRATOR_Q
  // and can never steer. Lines said before the tour started are ignored.
  const spoken = session?.spoken;
  const qSpeaking = session?.presence.state === "SPEAKING";
  useEffect(() => {
    if (runner === null || spoken === undefined) return;
    if (seen.current === null) {
      seen.current = new Set(spoken.map((line) => line.id));
      return;
    }
    for (const line of spoken) {
      if (seen.current.has(line.id)) continue;
      seen.current.add(line.id);
      const text = line.text.trim().slice(0, 2000);
      if (text.length === 0) continue;
      if (line.role === "user") {
        runner.hearAudience(
          {
            segmentId: segmentIdOf("mic", line.id),
            source: "AUDIENCE_MIC",
            channelId: "mic",
            text,
            final: true,
          },
          {
            // Q's live line (narration included) is Q_SPEAKING; a line read
            // in the standard TTS voice is the narrator's own audio too.
            narratorPlaying: qSpeaking || standardVoicePlaying(),
            counterpartPlaying: false,
            // The voice providers ask for echo cancellation but do not
            // report it back, so it is not assumed: spoken control while
            // Q is talking is refused (ECHO_UNGUARDED); buttons still work.
            echoCancellation: false,
          },
        );
      } else {
        runner.noteTranscript({
          segmentId: segmentIdOf("q", line.id),
          source: "NARRATOR_Q",
          channelId: "q-voice",
          text,
          final: true,
        });
      }
    }
  }, [runner, spoken, qSpeaking]);

  if (actor === null) {
    return (
      <TourFrame label={choice.label} onExit={onExit}>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Q Pitch runs only on a fictional demo account. This account is not
          one, so the tour has not started.
        </p>
      </TourFrame>
    );
  }
  if (phase !== "RUNNING") {
    return (
      <TourFrame label={choice.label} onExit={onExit}>
        <p className="cq-body text-(--cq-text-primary)">
          {phase === "STARTING"
            ? "Opening Q's voice…"
            : "Q will present this tour aloud, in its own voice. Turn your sound on."}
        </p>
        {phase === "WAITING" ? (
          <div className="flex flex-wrap gap-2">
            <TourButton
              label="Start the tour"
              primary
              onPress={() => void begin(true)}
            />
            <TourButton
              label="Captions only"
              onPress={() => void begin(false)}
            />
          </div>
        ) : null}
      </TourFrame>
    );
  }
  if (runner === null) return null;
  return (
    <TourOverlay
      runner={runner}
      label={choice.label}
      simulation={simulation}
      onExit={onExit}
    />
  );
}

/**
 * The open Q side panel, if any. It is a modal dialog, so while it is open
 * everything outside it (the tour overlay too) is inert; the tour then
 * renders its compact controls inside it (lead decision 15 Oct: tour
 * controls stay usable without a keyboard).
 */
function findQPanel(): HTMLElement | null {
  for (const dialog of document.querySelectorAll<HTMLElement>(
    '[role="dialog"]',
  )) {
    const labelId = dialog.getAttribute("aria-labelledby");
    const label =
      labelId === null ? null : document.getElementById(labelId)?.textContent;
    if (label?.trim() === "Q") return dialog;
  }
  return null;
}

function subscribePanel(notify: () => void): () => void {
  const observer = new MutationObserver(() => notify());
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

function useQPanel(): HTMLElement | null {
  return useSyncExternalStore(subscribePanel, findQPanel, () => null);
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
  label,
  simulation,
  onExit,
}: {
  readonly runner: TourRunner;
  readonly label: string;
  readonly simulation: TranscriptSegment | null;
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

  const panel = useQPanel();
  const panelControls =
    panel === null
      ? null
      : createPortal(
          // In flow, not absolute: the panel is a flex column, so `order-first`
          // makes this its own strip above the header instead of covering the
          // panel's subtitle (browser receipt 41b3b4ee, 15 Oct).
          <div
            role="toolbar"
            aria-label="Tour controls"
            data-q-pitch-panel-controls
            className="order-first flex shrink-0 items-center justify-end gap-1 border-b border-(--cq-border) px-4 py-2"
          >
            <TourButton label="Back" onPress={() => send("BACK")} />
            {halted ? (
              <TourButton
                label="Resume tour"
                primary
                onPress={() => send("RESUME")}
              />
            ) : (
              <TourButton
                label="Pause tour"
                primary
                onPress={() => send("PAUSE")}
              />
            )}
            <TourButton label="Skip" onPress={() => send("SKIP")} />
          </div>,
          panel,
        );

  return (
    <TourFrame label={label} onExit={onExit}>
      {panelControls}
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
      {simulation === null ||
      snapshot.awaiting?.kind !== "runShortRehearsal" ? null : (
        <p
          className="cq-body-sm text-(--cq-text-secondary)"
          data-q-pitch-simulation
        >
          Simulation ·{" "}
          {simulation.source === "REHEARSAL_COUNTERPART" ? "Counterpart" : "Q"}:{" "}
          {simulation.text}
        </p>
      )}
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
  label,
  onExit,
}: {
  readonly children: React.ReactNode;
  readonly label: string;
  readonly onExit: () => void;
}) {
  return (
    <section
      aria-label="Q Pitch tour"
      data-q-pitch
      className="fixed inset-x-4 bottom-24 z-(--cq-z-presence) mx-auto flex max-w-xl flex-col gap-3 rounded-lg border border-(--cq-border) bg-(--cq-surface-raised) p-4 shadow-(--cq-shadow-overlay) lg:bottom-6"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="cq-body-sm text-(--cq-text-secondary)">{label}</p>
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
