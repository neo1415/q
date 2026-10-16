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
  FOUNDER_V6_LEDGER,
  FOUNDER_V6_SCRIPT,
  PILOT_CERTIFICATION_LEDGER,
  PILOT_SCRIPT,
  PREMIERE_CERTIFICATION_LEDGER,
  ATLAS_SCRIPT,
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
import { RESUME_KEY } from "./resume";
import { unlightAll } from "./section-light";
import { openTourVoice } from "./tour-voice";
import { viewerQuestions } from "./live-question";
import { useTourPorts, type TranscriptSink } from "./use-tour-ports";
import { useT } from "@/features/i18n/language";

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
    case "openRecord":
    case "openInvestor":
    case "openTourPage":
    case "showReview":
    case "showQJob":
      return "Waiting for the page to open";
    case "selectTab":
    case "scrollTo":
    case "uiAct":
      return "Waiting for the page to show it";
    case "askApprovedQuestion":
    case "buildComparison":
      return "Q is answering. Waiting for the answer on screen";
    case "runShortRehearsal":
      return "Simulation running. It ends on its own in under a minute";
  }
}

export type TourChoice =
  "pilot" | "premiere" | "short" | "atlas" | "founder-v6";

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
  atlas: {
    script: ATLAS_SCRIPT,
    ledger: PREMIERE_CERTIFICATION_LEDGER,
    accepted: ["PRODUCTION_LIVE_VERIFIED", "CODE_VERIFIED"],
    label:
      "Internal rehearsal · Feature Atlas · includes code-verified scenes without a browser receipt · demonstration data",
  },
  // Q Pitch v6, founder track (Lane qpf): Capital Q presented to founders.
  "founder-v6": {
    script: FOUNDER_V6_SCRIPT,
    ledger: FOUNDER_V6_LEDGER,
    accepted: ["PRODUCTION_LIVE_VERIFIED", "CODE_VERIFIED"],
    label: "Q Pitch · founder track · demonstration data",
  },
  premiere: {
    script: PREMIERE_SCRIPT,
    ledger: PREMIERE_CERTIFICATION_LEDGER,
    accepted: ["PRODUCTION_LIVE_VERIFIED", "CODE_VERIFIED"],
    label:
      "Internal rehearsal · premiere v5 · includes code-verified scenes without a browser receipt · demonstration data",
  },
} as const;

/** How long "Tour complete" shows before normal Q takes over. */
const HANDOVER_MS = 4_000;

/** The beat between Q's answer to a live question and the tour resuming. */
const RESUME_AFTER_ANSWER_MS = 3_000;

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
  const t = useT();
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
      unlightAll();
      slot.set(null);
      heard.set(null);
    };
  }, [actor, ports, slot, heard, choice, transcript, chapter, phase]);

  // A live question (owner 16 Oct): the viewer's own question to Q, typed
  // or spoken, pauses the tour; once Q's answer has landed (typed) or Q
  // has finished saying it (spoken), the tour resumes by itself. The
  // tour's scripted questions never count (isTourAsk).
  const turns = session?.turns;
  const working = session?.q.working ?? false;
  const seenTurns = useRef<Set<string> | null>(null);
  const askedHere = useRef(new Set<string>());
  const answering = useRef(false);
  const answeringAloud = useRef(false);
  useEffect(() => {
    if (runner === null || turns === undefined) return;
    if (seenTurns.current === null) {
      seenTurns.current = new Set(turns.map((turn) => turn.id));
      return;
    }
    for (const id of viewerQuestions(
      turns,
      seenTurns.current,
      askedHere.current,
    )) {
      const decision = runner.control(
        {
          intentId: `qp-ask-${id}`.slice(0, 128),
          source: "AUDIENCE_MIC",
          modality: "KEYBOARD",
          kind: "INTERRUPT",
        },
        NO_AUDIO,
      );
      if (decision.admitted) answering.current = true;
    }
  }, [runner, turns]);
  useEffect(() => {
    if (runner === null || !answering.current || working) return;
    if (turns?.at(-1)?.kind !== "Q") return;
    const timer = window.setTimeout(() => {
      answering.current = false;
      if (runner.state.phase !== "INTERRUPTED") return;
      runner.control(
        {
          intentId: `qp-resume-${String(Date.now())}`,
          source: "AUDIENCE_MIC",
          modality: "POINTER",
          kind: "RESUME",
        },
        NO_AUDIO,
      );
    }, RESUME_AFTER_ANSWER_MS);
    return () => window.clearTimeout(timer);
  }, [runner, working, turns]);

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
        const decision = runner.hearAudience(
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
            // Only as the live line's mic track reports it, never assumed:
            // without it, spoken control while Q is talking is refused
            // (ECHO_UNGUARDED); the menu and Escape still work.
            echoCancellation:
              sessionRef.current?.voice.client.echoCancelled?.() ?? false,
          },
        );
        if (
          decision?.admitted === true &&
          decision.intent.kind === "INTERRUPT"
        ) {
          answeringAloud.current = true;
        }
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

  // A spoken question: resume once Q has answered aloud and gone quiet.
  useEffect(() => {
    if (runner === null || !answeringAloud.current || qSpeaking) return;
    if (spoken?.at(-1)?.role === "user") return;
    const timer = window.setTimeout(() => {
      answeringAloud.current = false;
      if (runner.state.phase !== "INTERRUPTED") return;
      runner.control(
        {
          intentId: `qp-resume-voice-${String(Date.now())}`,
          source: "AUDIENCE_MIC",
          modality: "POINTER",
          kind: "RESUME",
        },
        NO_AUDIO,
      );
    }, RESUME_AFTER_ANSWER_MS);
    return () => window.clearTimeout(timer);
  }, [runner, qSpeaking, spoken]);

  if (actor === null) {
    return (
      <TourFrame label={choice.label} onExit={onExit}>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {t(
            "Q Pitch runs only on a fictional demo account. This account is not one, so the tour has not started.",
          )}
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
              label={t("Start the tour")}
              primary
              onPress={() => void begin(true)}
            />
            <TourButton
              label={t("Captions only")}
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
      voiceHint={session?.voice.active === true}
      tour={tour}
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
  voiceHint,
  tour,
  onExit,
}: {
  readonly runner: TourRunner;
  readonly label: string;
  readonly simulation: TranscriptSegment | null;
  /** A voice line is open, so the audience can steer by speaking. */
  readonly voiceHint: boolean;
  readonly tour: TourChoice;
  readonly onExit: () => void;
}) {
  const t = useT();
  const snapshot = useSnapshot(runner);
  const [menuOpen, setMenuOpen] = useState(false);
  // After the finale, normal Q (owner 16 Oct): the tour hands over and ends
  // itself, so nothing of the tour stays on screen or holds the voice.
  const complete = snapshot.phase === "COMPLETE";
  useEffect(() => {
    if (!complete) return;
    const timer = window.setTimeout(onExit, HANDOVER_MS);
    return () => window.clearTimeout(timer);
  }, [complete, onExit]);
  const chapterNow = snapshot.scene?.chapterId ?? null;
  useEffect(() => {
    if (chapterNow === null) return;
    try {
      window.sessionStorage.setItem(
        RESUME_KEY,
        JSON.stringify({
          tour,
          chapter: snapshot.phase === "COMPLETE" ? null : chapterNow,
        }),
      );
    } catch {
      // A preference that cannot be kept is simply not kept.
    }
  }, [tour, chapterNow, snapshot.phase]);

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
      // Escape closes the menu, else pauses: always safe to steal.
      if (event.key !== "Escape") return;
      if (menuOpen) setMenuOpen(false);
      else if (!halted) send("PAUSE", "KEYBOARD");
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
  const menu = (placement: "up" | "down") => (
    <TourMenu
      label={label}
      placement={placement}
      halted={halted}
      chapters={snapshot.chapters}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      onControl={(kind, chapterId) => send(kind, "POINTER", chapterId)}
      onExit={onExit}
    />
  );
  // While the Q side panel (a modal) is open, everything outside it is
  // inert, so the same small menu is offered inside it.
  const panelControls =
    panel === null
      ? null
      : createPortal(
          <div
            data-q-pitch-panel-controls
            className="order-first flex shrink-0 items-center justify-between gap-2 border-b border-(--cq-border) px-4 py-2"
          >
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Q Pitch {halted ? "· paused" : "· playing"}
            </p>
            {menu("down")}
          </div>,
          panel,
        );

  const meta = [scene?.title, position, PHASE_WORDS[snapshot.phase]]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      aria-label={t("Q Pitch tour")}
      data-q-pitch
      className="fixed inset-x-4 bottom-24 z-(--cq-z-presence) mx-auto flex max-w-2xl items-end gap-3 border border-(--cq-border) bg-(--cq-surface-raised) px-4 py-3 shadow-(--cq-shadow-overlay) lg:bottom-6"
    >
      {panelControls}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="cq-body-sm text-(--cq-text-secondary)">{meta}</p>
        <p
          className="cq-body text-(--cq-text-primary)"
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
            {simulation.source === "REHEARSAL_COUNTERPART"
              ? "Counterpart"
              : "Q"}
            : {simulation.text}
          </p>
        )}
        {fallback === null ? null : (
          <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
            Q stopped here and won&apos;t describe it ({fallback}).
          </p>
        )}
        {halted || voiceHint ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {voiceHint
              ? halted
                ? "Paused. Say “continue”, or name a part to see."
                : "Say “pause”, “go back”, or “show me GateQ”."
              : "Paused. Resume from the Tour menu."}
          </p>
        ) : null}
      </div>
      {menu("up")}
    </section>
  );
}

/**
 * The tour's one visible control: a small menu (owner 15 Oct: no control
 * bar over the product). Voice is the main way to steer; this is the
 * accessible fallback, and Escape pauses.
 */
function TourMenu({
  label,
  placement,
  halted,
  chapters,
  open,
  onOpenChange,
  onControl,
  onExit,
}: {
  readonly label: string;
  readonly placement: "up" | "down";
  readonly halted: boolean;
  readonly chapters: readonly { chapterId: string; title: string }[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onControl: (kind: TourControlKind, chapterId?: string) => void;
  readonly onExit: () => void;
}) {
  const t = useT();
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const act = (kind: TourControlKind, chapterId?: string) => {
    onOpenChange(false);
    setChaptersOpen(false);
    onControl(kind, chapterId);
  };
  const item =
    "flex min-h-11 w-full items-center px-3 text-start cq-body-sm text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)";
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="inline-flex min-h-11 items-center border border-(--cq-border) bg-(--cq-surface) px-3 cq-body-sm text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
      >
        {t("Tour")}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={t("Tour")}
          className={`absolute end-0 z-(--cq-z-popover) flex max-h-96 w-72 flex-col gap-1 overflow-y-auto border border-(--cq-border) bg-(--cq-surface-raised) p-2 shadow-(--cq-shadow-overlay) ${placement === "up" ? "bottom-full mb-2" : "top-full mt-2"}`}
        >
          <p className="px-3 py-1 cq-body-sm text-(--cq-text-secondary)">
            {label}
          </p>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => act(halted ? "RESUME" : "PAUSE")}
          >
            {halted ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => act("BACK")}
          >
            {t("Back")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => act("REPEAT")}
          >
            {t("Show me that again")}
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => act("SKIP")}
          >
            {t("Skip")}
          </button>
          <button
            type="button"
            role="menuitem"
            aria-expanded={chaptersOpen}
            className={item}
            onClick={() => setChaptersOpen((value) => !value)}
          >
            {t("Chapters")}
          </button>
          {chaptersOpen ? (
            <ul className="flex flex-col gap-1 ps-3" aria-label={t("Chapters")}>
              {chapters.map((chapter) => (
                <li key={chapter.chapterId}>
                  <button
                    type="button"
                    role="menuitem"
                    className={item}
                    onClick={() => act("JUMP", chapter.chapterId)}
                  >
                    {chapter.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              onOpenChange(false);
              onExit();
            }}
          >
            {t("End tour")}
          </button>
        </div>
      ) : null}
    </div>
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
  const t = useT();
  return (
    <section
      aria-label={t("Q Pitch tour")}
      data-q-pitch
      className="fixed inset-x-4 bottom-24 z-(--cq-z-presence) mx-auto flex max-w-xl flex-col gap-3 border border-(--cq-border) bg-(--cq-surface-raised) p-4 shadow-(--cq-shadow-overlay) lg:bottom-6"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="cq-body-sm text-(--cq-text-secondary)">{label}</p>
        <TourButton label={t("End tour")} onPress={onExit} />
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
          ? "inline-flex min-h-11 items-center bg-(--cq-accent) px-4 cq-body-sm font-medium text-(--cq-text-inverse) hover:bg-(--cq-accent-hover)"
          : "inline-flex min-h-11 items-center border border-(--cq-border) bg-(--cq-surface) px-3 cq-body-sm text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
      }
    >
      {label}
    </button>
  );
}
