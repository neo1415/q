"use client";

import "./story.css";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  ACT_BUDGET_MS,
  STORY_BEATS,
  TourActorSchema,
  buildQaIndex,
  parseStoryCommand,
  percentiles,
  routeAtBeat,
  type QaEntry,
  type ScheduledCue,
  type StoryAct,
  type StoryMood,
} from "@capital-q/q-pitch";

import {
  useQSessionOptional,
  type QSessionValue,
} from "@/features/q/q-session";
import { setTypedInterceptor } from "@/features/q/typed-intercept";
import { isLineLive } from "@/features/voice/session";

import { setNarrationVoice } from "../narrator";
import { lightSection, placeAnchors, unlightAll } from "../section-light";
import { answerAloud } from "../tour-host";
import { openTourVoice } from "../tour-voice";
import {
  liveNarrator,
  renderedNarrator,
  silentNarrator,
  type StoryNarrator,
} from "./story-narrators";
import {
  isOnStoryRoute,
  storyPath,
  STORY_ANCHORS,
  type StoryPathFor,
} from "./story-pages";
import { StoryPlayer, type StorySnapshot } from "./story-player";
import {
  preloadStory,
  type PreloadProgress,
  type StoryAssets,
} from "./story-preload";
import { EMPTY_STAGE, StoryStage, type StageState } from "./story-stage";

/**
 * Q Story host (v7, plan 2026-10-21): Q tells the owner's story over the
 * real app. Mounted by the Q Pitch entry (`?qpitch=story`), so it survives
 * every route change the story makes.
 *
 * Starts on the person's press (audio needs a gesture) and only once
 * everything is preloaded. While it plays: no database reads it starts, no
 * model calls (the live-voice fallback speaks the sealed words only), and
 * nothing consequential is pressed. Typed words go to the story's step
 * commands first, then to the investor QA bank; anything else reaches Q
 * as usual.
 */
placeAnchors(STORY_ANCHORS);

type Mood = StoryMood | "OFF";

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function moodBefore(index: number): Mood {
  let mood: Mood = "OFF";
  for (const beat of STORY_BEATS.slice(0, index)) {
    for (const cue of beat.cues)
      if (cue.act.kind === "mood") mood = cue.act.mood;
  }
  return mood;
}

const ROUTE_NAMES: Readonly<Record<string, string>> = {
  home: "Home",
  discover: "Discover",
  "capital-mandate": "Your mandate",
  "company-diligence": "A company's Diligence tab",
  "relationship-prep": "Meeting prep",
  "gateq-gate": "Your GateQ gate",
  "gateq-application": "A GateQ application",
  "gateq-inbox": "The GateQ inbox",
};

/** Evidence for the recording harness (no private data: timings only). */
declare global {
  interface Window {
    __cqStoryEvidence?: () => unknown;
  }
}

function liveLine(current: () => QSessionValue | null) {
  return () => {
    const voice = current()?.voice;
    const client = voice?.client;
    if (
      voice === undefined ||
      client === undefined ||
      !voice.active ||
      !isLineLive(client) ||
      client.narrate === undefined
    ) {
      return null;
    }
    return {
      say: (text: string) => client.narrate?.(text) ?? false,
      speaking: () => current()?.voice.client.state === "Q_SPEAKING",
      hush: (on: boolean) => client.hush?.(on),
      brief: (text: string) => void client.brief?.(text),
    };
  };
}

export function StoryHost({
  account,
  role,
  onExit,
  harness,
}: {
  readonly account: string;
  readonly role: "INVESTOR" | "FOUNDER";
  readonly onExit: () => void;
  /**
   * The design harness (/dev/story, never served in production): the
   * story over the dev review pages' fictional data, with no account.
   */
  readonly harness?: { readonly pathFor: StoryPathFor } | undefined;
}) {
  const router = useRouter();
  const pathFor = harness?.pathFor ?? storyPath;
  const actor = useMemo(
    () =>
      harness !== undefined ||
      TourActorSchema.safeParse({ role, account }).success,
    [account, role, harness],
  );
  const session = useQSessionOptional();
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Preload on entry, before the press: the press then starts at once.
  const [assets, setAssets] = useState<StoryAssets | null>(null);
  const [progress, setProgress] = useState<PreloadProgress>({
    done: 0,
    total: 1,
  });
  useEffect(() => {
    if (!actor) return;
    const controller = new AbortController();
    void preloadStory({
      prefetch: (path) => router.prefetch(path),
      pathFor,
      onProgress: setProgress,
      signal: controller.signal,
    }).then((loaded) => {
      if (!controller.signal.aborted) setAssets(loaded);
    });
    return () => controller.abort();
  }, [actor, router, pathFor]);

  const [player, setPlayer] = useState<StoryPlayer | null>(null);
  const [starting, setStarting] = useState(false);
  const stage = useMemo(() => createStore<StageState>(EMPTY_STAGE), []);
  const mood = useMemo(() => createStore<Mood>("OFF"), []);
  const [captions, setCaptions] = useState(true);
  const [muted, setMuted] = useState(false);

  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const begin = useCallback(
    async (withVoice: boolean) => {
      if (assets === null) return;
      setStarting(true);
      setNarrationVoice(withVoice);
      let narrator: StoryNarrator;
      if (withVoice && assets.rendered && assets.context !== null) {
        // The press is the gesture that lets the decoded audio play.
        await assets.context.resume();
        narrator = renderedNarrator(assets.context, assets.buffers);
      } else if (
        withVoice &&
        (await openTourVoice(() => sessionRef.current)) === "LIVE"
      ) {
        narrator = liveNarrator(liveLine(() => sessionRef.current));
      } else {
        narrator = silentNarrator();
      }
      const navigate = async (
        act: Extract<StoryAct, { kind: "navigate" }>,
        signal: AbortSignal,
      ) => {
        const path = pathFor(act.route);
        if (path === null) return false;
        const here = () => isOnStoryRoute(act.route, window.location, pathFor);
        if (!here()) routerRef.current.push(path);
        const until = performance.now() + ACT_BUDGET_MS.navigate;
        while (!signal.aborted && performance.now() < until) {
          if (here() && document.querySelector("main") !== null) {
            await frame();
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return false;
      };
      const next = new StoryPlayer({
        alignments: assets.alignments,
        narrator,
        acts: {
          run: async (
            act: StoryAct,
            _cue: ScheduledCue,
            signal: AbortSignal,
          ) => {
            switch (act.kind) {
              case "mood":
                mood.set(act.mood);
                await frame();
                return true;
              case "stage":
                stage.set({
                  visual: act.visual,
                  step: act.step,
                  text: act.text ?? null,
                  fallback: null,
                });
                await frame();
                return true;
              case "navigate":
                return navigate(act, signal);
              case "light":
                return lightSection(
                  act.anchor,
                  {},
                  signal,
                  ACT_BUDGET_MS.light,
                );
              case "unlight":
                unlightAll();
                return true;
            }
          },
          fallback: (act) => {
            // SAFE_FALLBACK: stay on the Q stage and say so; the words go on.
            if (act.kind === "navigate") {
              stage.set({
                ...EMPTY_STAGE,
                fallback: ROUTE_NAMES[act.route] ?? "That page",
              });
            }
          },
          warm: (route) => {
            const path = pathFor(route);
            if (path !== null) routerRef.current.prefetch(path);
          },
          settle: (index) => {
            unlightAll();
            stage.set(EMPTY_STAGE);
            mood.set(moodBefore(index));
            const route = routeAtBeat(index) ?? "home";
            const path = pathFor(route);
            if (
              path !== null &&
              !isOnStoryRoute(route, window.location, pathFor)
            ) {
              routerRef.current.push(path);
            }
          },
        },
      });
      setPlayer(next);
      setStarting(false);
      next.start(0);
    },
    [assets, mood, stage, pathFor],
  );

  useEffect(() => {
    player?.setMuted(muted);
  }, [player, muted]);

  useEffect(() => {
    if (player === null) return;
    window.__cqStoryEvidence = () => ({
      narrator: assets?.rendered === true ? "RENDERED" : "FALLBACK",
      preloadMs: assets?.ms ?? null,
      offsets: percentiles(player.samples.map((s) => s.offsetMs)),
      offsetsByKind: Object.fromEntries(
        (["stage", "mood", "navigate", "light"] as const).map((kind) => [
          kind,
          percentiles(
            player.samples
              .filter((s) => s.kind === kind)
              .map((s) => s.offsetMs),
          ),
        ]),
      ),
      frames: player.frames,
      fallbacks: player.snapshot().fallbacks,
      beat: player.snapshot().index + 1,
      phase: player.snapshot().phase,
    });
    return () => {
      player.dispose();
      unlightAll();
      delete window.__cqStoryEvidence;
    };
  }, [player, assets]);

  if (!actor) {
    return (
      <div className="cq-story-gate" role="dialog" aria-label="Q Story">
        <p>
          Q Story runs only on a fictional demo account. This account is not
          one, so it has not started.
        </p>
        <button type="button" className="cq-story-btn" onClick={onExit}>
          Close
        </button>
      </div>
    );
  }
  if (player === null) {
    const ready = assets !== null;
    return (
      <div className="cq-story-gate" role="dialog" aria-label="Q Story">
        <p className="cq-story-gate-title">Q tells the Capital Q story</p>
        <p>
          About seven minutes, in Q&apos;s voice. Turn your sound on. You can
          pause, go back, skip or ask a question at any point.
        </p>
        <p className="cq-story-gate-meta" aria-live="polite">
          {ready
            ? assets.rendered
              ? "Ready."
              : "Ready. Q will speak in its live voice."
            : `Getting everything ready… ${String(Math.round((progress.done / Math.max(1, progress.total)) * 100))}%`}
        </p>
        <div className="cq-story-gate-actions">
          <button
            type="button"
            className="cq-story-btn cq-story-btn-primary"
            disabled={!ready || starting}
            onClick={() => void begin(true)}
          >
            {starting ? "Starting…" : "Start the story"}
          </button>
          <button
            type="button"
            className="cq-story-btn"
            disabled={!ready || starting}
            onClick={() => void begin(false)}
          >
            Captions only
          </button>
          <button type="button" className="cq-story-btn" onClick={onExit}>
            Not now
          </button>
        </div>
      </div>
    );
  }
  return (
    <StoryOverlay
      player={player}
      stage={stage}
      mood={mood}
      captions={captions}
      onCaptions={setCaptions}
      muted={muted}
      onMuted={(on) => {
        setMuted(on);
      }}
      onExit={() => {
        player.end();
        onExit();
      }}
    />
  );
}

type Store<T> = ReturnType<typeof createStore<T>>;

/** The verbatim line holding word `word`, with its first word's index. */
function captionLine(
  beat: StorySnapshot["beat"],
  word: number,
): { readonly start: number; readonly words: readonly string[] } {
  let start = 0;
  for (const [index, text] of beat.lines.entries()) {
    const words = text.split(/\s+/u).filter(Boolean);
    if (word < start + words.length || index === beat.lines.length - 1) {
      return { start, words };
    }
    start += words.length;
  }
  return { start: 0, words: beat.words };
}

function StoryOverlay({
  player,
  stage,
  mood,
  captions,
  onCaptions,
  muted,
  onMuted,
  onExit,
}: {
  readonly player: StoryPlayer;
  readonly stage: Store<StageState>;
  readonly mood: Store<Mood>;
  readonly captions: boolean;
  readonly onCaptions: (on: boolean) => void;
  readonly muted: boolean;
  readonly onMuted: (on: boolean) => void;
  readonly onExit: () => void;
}) {
  const snapshot: StorySnapshot = useSyncExternalStore(
    player.subscribe,
    player.snapshot,
    player.snapshot,
  );
  const stageNow = useSyncExternalStore(stage.subscribe, stage.get, stage.get);
  const moodNow = useSyncExternalStore(mood.subscribe, mood.get, mood.get);
  const done = snapshot.phase === "DONE";

  // Story mode on the document: chrome dims, the pulse breathes.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-story", moodNow);
    return () => root.removeAttribute("data-story");
  }, [moodNow]);

  // Measured after paint, on the next frame: captions never cover a lit
  // section (they move above it), and from Act 4 Q's presence docks to the
  // side it is not pointing at, following the highlight (a spring under
  // 300 ms, transform only). Acts 0-3 keep Q centre stage.
  const [layout, setLayout] = useState<{
    readonly captionsTop: boolean;
    readonly presence: { readonly x: number; readonly y: number } | null;
  }>({ captionsTop: false, presence: null });
  const act = snapshot.beat.act;
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const lit = document.querySelector<HTMLElement>("[data-qp-lit]");
      const rect = lit?.getBoundingClientRect() ?? null;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const captionsTop =
        rect !== null && rect.bottom > height - 220 && rect.top > 160;
      let presence: { x: number; y: number } | null = null;
      if (act >= 4) {
        presence =
          rect === null
            ? { x: width - 72, y: 96 }
            : {
                x: rect.left + rect.width / 2 < width / 2 ? width - 72 : 24,
                y: Math.min(
                  height - 160,
                  Math.max(96, rect.top + rect.height / 2),
                ),
              };
      }
      setLayout({ captionsTop, presence });
    });
    return () => cancelAnimationFrame(id);
  }, [snapshot.word, snapshot.index, act]);
  const { captionsTop, presence } = layout;

  // Typed words: story commands, then the QA bank, else Q as usual.
  const qa = useMemo(() => buildQaIndex("INVESTOR"), []);
  const [answer, setAnswer] = useState<QaEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const speaking = useRef<AbortController | null>(null);
  useEffect(() => {
    const release = setTypedInterceptor((text) => {
      const command = parseStoryCommand(
        text,
        player.snapshot().index,
        player.total,
      );
      if (command !== null) {
        setNotice(null);
        if (command.kind === "END") onExit();
        else if (command.kind === "CAPTIONS")
          onCaptions(command.on ?? !captions);
        else if (command.kind === "MUTE") onMuted(command.on ?? !muted);
        else {
          const { move } = command;
          if (move.kind === "PAUSE") player.pause();
          else if (move.kind === "RESUME") {
            setAnswer(null);
            player.resume();
          } else if (move.kind === "STEP") {
            setAnswer(null);
            player.goTo(move.step - 1);
          } else if (move.kind === "SKIP") onExit();
          else
            setNotice(
              `There is no such beat. The story has ${String(player.total)}.`,
            );
        }
        return true;
      }
      const entry = qa.answer(text);
      if (entry === null) return false;
      player.interrupt();
      setAnswer(entry);
      speaking.current?.abort();
      const controller = new AbortController();
      speaking.current = controller;
      void answerAloud(entry.answer, controller.signal);
      return true;
    });
    return () => {
      release();
      speaking.current?.abort();
    };
  }, [player, qa, onExit, onCaptions, onMuted, captions, muted]);

  const { beat, word } = snapshot;
  // The caption is the line being spoken, lit word by word.
  const line = captionLine(beat, word);

  const halted =
    snapshot.phase === "PAUSED" || snapshot.phase === "INTERRUPTED";
  return (
    <>
      <div className="cq-story-scrim" data-mood={moodNow} aria-hidden />
      <StoryStage
        stage={stageNow}
        mood={moodNow === "OFF" ? "STORY" : moodNow}
      />
      <span
        className="cq-story-presence"
        data-docked={presence === null ? undefined : ""}
        data-speaking={snapshot.phase === "PLAYING" ? "" : undefined}
        style={
          presence === null
            ? undefined
            : {
                transform: `translate3d(${String(presence.x)}px, ${String(presence.y)}px, 0)`,
              }
        }
        aria-hidden
      />
      {captions && !done && word >= 0 ? (
        <p
          className="cq-story-captions"
          data-top={captionsTop ? "" : undefined}
          aria-live="off"
        >
          {line.words.map((text, i) => (
            <span
              key={`${String(beat.n)}-${String(line.start + i)}`}
              data-said={line.start + i <= word ? "" : undefined}
            >
              {text}{" "}
            </span>
          ))}
        </p>
      ) : null}
      {answer !== null ? (
        <div className="cq-story-answer" role="status">
          <p className="cq-story-kicker">{answer.question}</p>
          <p>{answer.answer}</p>
          <button
            type="button"
            className="cq-story-btn cq-story-btn-primary"
            onClick={() => {
              speaking.current?.abort();
              setAnswer(null);
              player.resume();
            }}
          >
            Carry on
          </button>
        </div>
      ) : null}
      {done ? (
        <div className="cq-story-answer" role="status">
          <p className="cq-story-kicker">The story is over</p>
          <p>Ask me anything about Capital Q: type your question below.</p>
          <button type="button" className="cq-story-btn" onClick={onExit}>
            Close
          </button>
        </div>
      ) : null}
      <nav className="cq-story-controls" aria-label="Story controls">
        <span className="cq-story-count">
          {String(snapshot.index + 1)} / {String(player.total)}
        </span>
        <button
          type="button"
          className="cq-story-btn"
          aria-label="Previous beat"
          onClick={() => player.goTo(Math.max(0, snapshot.index - 1))}
        >
          Back
        </button>
        <button
          type="button"
          className="cq-story-btn"
          onClick={() => (halted ? player.resume() : player.pause())}
        >
          {halted ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="cq-story-btn"
          aria-label="Next beat"
          onClick={() =>
            player.goTo(Math.min(player.total - 1, snapshot.index + 1))
          }
        >
          Next
        </button>
        <button
          type="button"
          className="cq-story-btn"
          aria-pressed={captions}
          data-wide=""
          onClick={() => onCaptions(!captions)}
        >
          Captions
        </button>
        <button
          type="button"
          className="cq-story-btn"
          aria-pressed={muted}
          data-wide=""
          onClick={() => onMuted(!muted)}
        >
          {muted ? "Unmute" : "Mute"}
        </button>
        <button type="button" className="cq-story-btn" onClick={onExit}>
          End
        </button>
        {notice !== null ? (
          <span className="cq-story-notice">{notice}</span>
        ) : null}
      </nav>
    </>
  );
}
