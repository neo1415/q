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
  STORY_CLOSING_QUESTION,
  STORY_CLOSING_QUIET_MS,
  TourActorSchema,
  buildQaIndex,
  certifyStory,
  cutAlignment,
  editionBeats,
  editionProductStep,
  STORY_EDITIONS,
  STORY_LEDGER,
  STORY_PRODUCT_BEAT,
  type StoryAudioWindow,
  type StoryBeat,
  type StoryEditionId,
  storyOwnerApproved,
  DEMONSTRATION_LABEL,
  STORY_CLAIMS,
  isDemonstrationClaim,
  parseStoryCommand,
  sameActor,
  stillClaims,
  stillPath,
  type StoryClaim,
  type StoryRoute,
  type StoryStillRoute,
  percentiles,
  routeAtBeat,
  subtitleForm,
  type QaEntry,
  type QaMatch,
  type ScheduledCue,
  type StoryAct,
  type StoryMood,
} from "@capital-q/q-pitch";

import {
  useQSessionOptional,
  type QSessionValue,
} from "@/features/q/q-session";
import { setTypedInterceptor } from "@/features/q/typed-intercept";
import { QSwarm } from "@/features/q-swarm/q-swarm";
import { presence } from "@/features/q-swarm/presence-cue";
import { isLineLive } from "@/features/voice/session";

import { answerAloud, setNarrationVoice } from "../narrator";
import { matchSpokenQuestion } from "../qa-match";
import { lightSection, placeAnchors, unlightAll } from "../section-light";
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
import {
  coversPage,
  EMPTY_STAGE,
  StoryStage,
  type StageState,
} from "./story-stage";

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

/** Q's moment to form on stage before the first word. */
const OPENING_FORM_MS = 800;

/** One rendered clip, through the story's audio clock. False if it failed. */
async function playClip(
  context: AudioContext,
  url: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const bytes = await (
      await fetch(url, { cache: "force-cache" })
    ).arrayBuffer();
    const buffer = await context.decodeAudioData(bytes);
    if (signal.aborted) return true;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    await new Promise<void>((resolve) => {
      const stop = () => {
        source.stop();
        resolve();
      };
      signal.addEventListener("abort", stop, { once: true });
      source.onended = () => {
        signal.removeEventListener("abort", stop);
        resolve();
      };
      source.start();
    });
    return true;
  } catch {
    return false;
  }
}

function moodBefore(index: number, beats: readonly StoryBeat[]): Mood {
  let mood: Mood = "OFF";
  for (const beat of beats.slice(0, index)) {
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
  voice,
  autostart = false,
  film = false,
  edition = "FULL",
}: {
  readonly account: string;
  readonly role: "INVESTOR" | "FOUNDER";
  readonly onExit: () => void;
  /**
   * The design harness (/dev/story, never served in production): the
   * story over the dev review pages' fictional data, with no account.
   */
  readonly harness?:
    | {
        readonly pathFor: StoryPathFor;
        /** false: play as a viewer the story is not certified for (stills). */
        readonly live?: boolean;
      }
    | undefined;
  /** A rendered voice set other than Q's own (the harness's `?voice=`). */
  readonly voice?: string | undefined;
  /**
   * Asked for in words ("Hey Q, pitch yourself", the chip): starts with
   * voice as soon as it is ready, when the browser lets the audio play
   * (the ask was a gesture on this page); else the one Start press.
   */
  readonly autostart?: boolean;
  /** The recorded master (harness `?film=1`): film type sizes, no controls. */
  readonly film?: boolean;
  /** Which cut plays (editions.ts): everyone, investors or founders. */
  readonly edition?: StoryEditionId;
}) {
  const router = useRouter();
  const cut = STORY_EDITIONS[edition];
  const beats = useMemo(() => editionBeats(cut), [cut]);
  // Any signed-in account plays the story (owner, 23 Oct). The live product
  // pages are shown only to the demo actor the story is certified on (and
  // on the harness's fictional pages); everyone else sees stills of the
  // same fictional pages, so the story never opens their own pages or
  // shows their data.
  const viewer = useMemo(() => {
    const parsed = TourActorSchema.safeParse({ role, account });
    return parsed.success ? parsed.data : null;
  }, [account, role]);
  const certified = STORY_LEDGER[0]?.actorContext;
  const live =
    harness !== undefined
      ? harness.live !== false
      : viewer !== null &&
        certified !== undefined &&
        sameActor(viewer, certified);
  const pages = harness?.pathFor ?? storyPath;
  const pathFor = useMemo<StoryPathFor>(
    () => (live ? pages : (route) => (route === "home" ? pages(route) : null)),
    [live, pages],
  );
  // On stills, a product beat demonstrates the product rather than showing
  // it live: it is labelled "Demonstration data", and claims nothing live.
  const claims = useMemo(() => (live ? STORY_CLAIMS : stillClaims()), [live]);
  // The story's certification gate, once (claims per beat; story/claims.ts).
  // Until the owner approves and every product claim holds, the story is
  // an internal rehearsal and says so on screen.
  const gate = useMemo(() => {
    const actor = viewer ?? certified;
    return actor === undefined
      ? null
      : certifyStory(
          {
            now: new Date().toISOString(),
            actor,
            staleFeatureIds: [],
            // This cut's own approval: each edition is its own version.
            ownerApproved: storyOwnerApproved(cut.version),
          },
          claims,
          STORY_LEDGER,
          beats,
        );
  }, [viewer, certified, claims, cut, beats]);
  useEffect(() => {
    if (!film) return;
    const root = document.documentElement;
    root.setAttribute("data-story-film", "");
    return () => root.removeAttribute("data-story-film");
  }, [film]);
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
    const controller = new AbortController();
    void preloadStory({
      prefetch: (path) => router.prefetch(path),
      pathFor,
      ...(voice === undefined ? {} : { voice }),
      onProgress: setProgress,
      signal: controller.signal,
      order: beats.map((beat) => beat.n),
      stills: !live,
    }).then((loaded) => {
      if (!controller.signal.aborted) setAssets(loaded);
    });
    return () => controller.abort();
  }, [live, router, pathFor, voice, beats]);

  // The edition's timings: a cut part's words from its beat's timings, and
  // where it sits in the beat's clip (editions.ts, cutAlignment).
  const timings = useMemo(() => {
    if (assets === null) return null;
    const alignments = new Map(assets.alignments);
    const windows = new Map<number, StoryAudioWindow>();
    for (const beat of beats) {
      const full = assets.alignments.get(beat.n);
      if (beat.cut === null || full === undefined) continue;
      const part = cutAlignment(full, beat.cut);
      alignments.set(beat.n, part.alignment);
      windows.set(beat.n, part.window);
    }
    return { alignments, windows };
  }, [assets, beats]);

  const [player, setPlayer] = useState<StoryPlayer | null>(null);
  const voiceChosen = useRef(false);
  // Ended by the person (End, a command): never followed by the question.
  const exited = useRef(false);
  const mutedRef = useRef(false);

  // The ending, live only: Q asks once, aloud, and listens. On a line the
  // person does not have open yet, the line itself asks (its first words)
  // and then listens; with one open, the narrator's own recorded question
  // plays and the open line hears the answer. Captions only: nothing aloud.
  const askClosing = useCallback(
    async (signal: AbortSignal) => {
      if (
        !voiceChosen.current ||
        mutedRef.current ||
        exited.current ||
        signal.aborted
      ) {
        return;
      }
      const current = sessionRef.current;
      if (current !== null && !current.voice.active) {
        await current
          .talk({ greeting: STORY_CLOSING_QUESTION })
          .catch(() => undefined);
        return;
      }
      const clip = assets?.closing ?? null;
      const context = assets?.context ?? null;
      if (clip !== null && context !== null) {
        if (await playClip(context, clip, signal)) return;
      }
      await answerAloud(STORY_CLOSING_QUESTION, signal, "STORY");
    },
    [assets],
  );
  // Cancels a voice line still opening when the story is left (audit).
  // Made in the effect, so a Strict Mode remount gets a fresh one.
  const opening = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    opening.current = controller;
    return () => controller.abort();
  }, []);
  const [starting, setStarting] = useState(false);
  const stage = useMemo(() => createStore<StageState>(EMPTY_STAGE), []);
  /** The product page shown as a still (not live): null, the page itself. */
  const still = useMemo(() => createStore<StoryStillRoute | null>(null), []);
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
      voiceChosen.current = withVoice;
      let narrator: StoryNarrator;
      if (
        withVoice &&
        assets.rendered &&
        assets.context !== null &&
        assets.bank !== null
      ) {
        // The press is the gesture that lets the decoded audio play.
        await assets.context.resume();
        narrator = renderedNarrator(
          assets.context,
          assets.bank,
          timings?.windows,
        );
      } else if (
        withVoice &&
        (await openTourVoice(
          () => sessionRef.current,
          opening.current.signal,
        )) === "LIVE"
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
        beats,
        alignments: timings?.alignments ?? assets.alignments,
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
              case "navigate": {
                if (!live) {
                  // A still of the fictional page; Home is their own.
                  still.set(stillOf(act.route));
                  if (act.route !== "home") {
                    await frame();
                    return true;
                  }
                }
                const landed = await navigate(act, signal);
                // A page that did land clears an earlier fallback note.
                if (landed && stage.get().fallback !== null) {
                  stage.set(EMPTY_STAGE);
                }
                return landed;
              }
              case "light": {
                // Nothing on a picture to light; the words carry on.
                if (still.get() !== null) return true;
                const lit = await lightSection(
                  act.anchor,
                  {},
                  signal,
                  ACT_BUDGET_MS.light,
                );
                if (lit) clearCaptionBand();
                return lit;
              }
              case "unlight":
                unlightAll();
                return true;
              case "figure":
                // Lane S4: every legible Q presence forms the figure.
                presence.form(act.figure, { holdMs: act.holdMs });
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
            mood.set(moodBefore(index, beats));
            const route = routeAtBeat(index, beats) ?? "home";
            if (!live) still.set(stillOf(route));
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
      // The opening is set at the press, and Q is given a moment to form
      // before its first word, so "Hi. I'm Q." is said by a formed Q in
      // every edition (coordinator, 22 Oct).
      for (const cue of beats[0]?.cues ?? []) {
        if (cue.at !== 0) continue;
        if (cue.act.kind === "mood") mood.set(cue.act.mood);
        if (cue.act.kind === "stage") {
          stage.set({
            visual: cue.act.visual,
            step: cue.act.step,
            text: cue.act.text ?? null,
            fallback: null,
          });
        }
      }
      setPlayer(next);
      setStarting(false);
      await new Promise((resolve) => setTimeout(resolve, OPENING_FORM_MS));
      next.start(0);
    },
    [assets, timings, beats, mood, stage, still, live, pathFor],
  );

  // Asked for in words: with voice, as soon as it is ready, when the
  // browser lets the audio play; otherwise the Start press as usual.
  const autostarted = useRef(false);
  useEffect(() => {
    if (!autostart || autostarted.current) return;
    if (assets === null || player !== null) return;
    autostarted.current = true;
    const context = assets.context;
    queueMicrotask(() => {
      void (async () => {
        await context?.resume().catch(() => undefined);
        if (context === null || context.state === "running") {
          await begin(true);
        }
      })();
    });
  }, [autostart, assets, player, begin]);

  useEffect(() => {
    player?.setMuted(muted);
    mutedRef.current = muted;
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
      fallbackCues: player.fallbackCues,
      beat: player.snapshot().index + 1,
      phase: player.snapshot().phase,
    });
    return () => {
      player.dispose();
      unlightAll();
      delete window.__cqStoryEvidence;
    };
  }, [player, assets]);

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
      productStep={
        editionProductStep(beats, STORY_PRODUCT_BEAT) ?? STORY_PRODUCT_BEAT
      }
      rehearsal={gate?.audience !== "AUDIENCE"}
      claims={claims}
      stage={stage}
      still={still}
      mood={mood}
      captions={captions}
      onCaptions={setCaptions}
      muted={muted}
      onMuted={(on) => {
        setMuted(on);
      }}
      onClosing={askClosing}
      onExit={() => {
        exited.current = true;
        player.end();
        onExit();
      }}
    />
  );
}

type Store<T> = ReturnType<typeof createStore<T>>;

/** The still that stands for a route (Home has none: it is their own). */
function stillOf(route: StoryRoute): StoryStillRoute | null {
  return route === "home" ? null : route;
}

/** A fictional product page, as a picture where the page would be. */
function StoryStill({
  store,
}: {
  readonly store: Store<StoryStillRoute | null>;
}) {
  const route = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (route === null) return null;
  return (
    <div className="cq-story-still" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- static story files, decoded before playback; an optimiser would refetch them mid-story */}
      <img
        src={stillPath(route)}
        alt=""
        decoding="async"
        draggable={false}
        // A still that did not load shows the plain canvas, never a
        // broken-image mark; the words carry on.
        onError={(event) => {
          event.currentTarget.style.visibility = "hidden";
        }}
      />
    </div>
  );
}

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};
type Viewport = { readonly w: number; readonly h: number };

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.w - b.w) < 1 &&
    Math.abs(a.h - b.h) < 1
  );
}

const subscribeViewport = (notify: () => void) => {
  window.addEventListener("resize", notify);
  return () => window.removeEventListener("resize", notify);
};
let viewportCache: Viewport | null = null;
function viewportSnapshot(): Viewport {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (viewportCache?.w !== w || viewportCache.h !== h) {
    viewportCache = { w, h };
  }
  return viewportCache;
}
function useViewport(): Viewport | null {
  return useSyncExternalStore(subscribeViewport, viewportSnapshot, () => null);
}

/** Where the caption band starts (its top edge), or the viewport bottom. */
function captionBandTop(): number {
  const band = document.querySelector<HTMLElement>(".cq-story-captions");
  return band?.getBoundingClientRect().top ?? window.innerHeight;
}

/**
 * The caption band is reserved space (coordinator, 22 Oct): once a section
 * is lit, scroll it so its bottom clears the band, keeping its top in view.
 */
function clearCaptionBand(): void {
  const element = document.querySelector<HTMLElement>("[data-qp-lit]");
  if (element === null) return;
  const box = element.getBoundingClientRect();
  const limit = captionBandTop() - 16;
  if (box.bottom <= limit) return;
  const by = Math.min(box.bottom - limit, Math.max(0, box.top - 72));
  if (by > 1) window.scrollBy({ top: by, behavior: "smooth" });
}

/** The page dimmed everywhere but around the lit section (even-odd). */
function spotlightPath(lit: Rect, view: Viewport): string {
  const pad = 10;
  const x = Math.max(0, lit.x - pad);
  const y = Math.max(0, lit.y - pad);
  const w = Math.min(view.w - x, lit.w + pad * 2);
  // Never into the caption band: the band is the words' place.
  const h = Math.max(0, Math.min(captionBandTop() - y, lit.h + pad * 2));
  return `path(evenodd, "M0 0H${String(view.w)}V${String(view.h)}H0Z M${String(x)} ${String(y)}h${String(w)}v${String(h)}h-${String(w)}Z")`;
}

/** Where a side panel sits: beside the lit section, on the roomier side. */
const PANEL_W = 380;
function besidePlace(
  lit: Rect,
  view: Viewport,
): { readonly x: number; readonly y: number } | null {
  const gap = 16;
  const y = Math.min(view.h - 420, Math.max(72, lit.y));
  if (view.w - (lit.x + lit.w) >= PANEL_W + gap * 2) {
    return { x: lit.x + lit.w + gap, y };
  }
  if (lit.x >= PANEL_W + gap * 2) return { x: lit.x - gap - PANEL_W, y };
  return null;
}

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
  productStep,
  rehearsal,
  claims,
  stage,
  still,
  mood,
  captions,
  onCaptions,
  muted,
  onMuted,
  onClosing,
  onExit,
}: {
  readonly player: StoryPlayer;
  /** "Skip to the product": its step in the edition playing. */
  readonly productStep: number;
  /** Not certified for an audience: labelled as an internal rehearsal. */
  readonly rehearsal: boolean;
  /** What each beat claims as it plays here (live or stills). */
  readonly claims: Readonly<Record<number, StoryClaim>>;
  readonly stage: Store<StageState>;
  readonly still: Store<StoryStillRoute | null>;
  readonly mood: Store<Mood>;
  readonly captions: boolean;
  readonly onCaptions: (on: boolean) => void;
  readonly muted: boolean;
  readonly onMuted: (on: boolean) => void;
  /** The live ending: Q's question, after the quiet (see askClosing). */
  readonly onClosing: (signal: AbortSignal) => Promise<void>;
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
  const aperture = stageNow.visual === "aperture";

  // After the last laugh, a few seconds of quiet; then the question.
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!done) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setClosing(true);
      void onClosing(controller.signal);
    }, STORY_CLOSING_QUIET_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [done, onClosing]);

  // Story mode on the document: chrome dims, the pulse breathes.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-story", moodNow);
    return () => root.removeAttribute("data-story");
  }, [moodNow]);

  // The lit section, measured every few frames while the story plays (it
  // moves while the page scrolls it into view). From it: the spotlight's
  // cut-out, where Q's docked presence sits (the side Q is not pointing
  // at, a spring under 300 ms) and where a side panel goes (beside the lit
  // section, never over it). Paint-only: transforms, `translate` and
  // clip-path, so nothing here shifts layout.
  const [lit, setLit] = useState<Rect | null>(null);
  useEffect(() => {
    let frame = 0;
    let id = 0;
    let last: Rect | null = null;
    const tick = () => {
      frame += 1;
      if (frame % 3 === 0) {
        const element = document.querySelector<HTMLElement>("[data-qp-lit]");
        const box = element?.getBoundingClientRect() ?? null;
        const next: Rect | null =
          box === null || box.width === 0
            ? null
            : { x: box.left, y: box.top, w: box.width, h: box.height };
        if (!sameRect(last, next)) {
          last = next;
          setLit(next);
        }
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  const woke = moodNow === "WAKE";
  const viewport = useViewport();
  const centreStage = !woke;
  // Docked on product beats: in the caption band, beside its own words
  // (the band has no page text under it), so Q never covers the page.
  const docked =
    centreStage || viewport === null
      ? null
      : { x: 24, y: viewport.h - 88 - 56 };
  const beside =
    lit === null || viewport === null ? null : besidePlace(lit, viewport);

  // The controls step back while the story plays: shown on a pointer move,
  // a tap or a key, gone again after 2 s (kept while focused or halted).
  const [chrome, setChrome] = useState(true);
  const playing = snapshot.phase === "PLAYING";
  useEffect(() => {
    let timer = window.setTimeout(() => setChrome(false), 2_000);
    const wake = () => {
      setChrome(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setChrome(false), 2_000);
    };
    for (const type of ["pointermove", "pointerdown", "keydown"] as const) {
      window.addEventListener(type, wake, { passive: true });
    }
    return () => {
      window.clearTimeout(timer);
      for (const type of ["pointermove", "pointerdown", "keydown"] as const) {
        window.removeEventListener(type, wake);
      }
    };
  }, []);

  // Words, typed or said: story commands first, then the investor QA bank
  // (answered at once, in plain words, and Q offers to carry on from the
  // same beat), else Q as usual. No model call for either.
  const qa = useMemo(() => buildQaIndex("INVESTOR"), []);
  const [answer, setAnswer] = useState<QaEntry | null>(null);
  const [asked, setAsked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [clarify, setClarify] = useState<Extract<
    QaMatch,
    { kind: "CLARIFY" }
  > | null>(null);
  const speaking = useRef<AbortController | null>(null);
  const asking = useRef<AbortController | null>(null);
  // A prepared answer, at once. Typed: spoken in the narrator's voice (one
  // voice inside the story). Said: Q's open line is answering aloud.
  const show = useCallback(
    (entry: QaEntry, from: "TYPED" | "VOICE", controller: AbortController) => {
      setAsked(false);
      setClarify(null);
      setAnswer(entry);
      speaking.current?.abort();
      speaking.current = controller;
      if (from === "TYPED") {
        void answerAloud(entry.answer, controller.signal, "STORY");
      }
    },
    [],
  );
  const hear = useCallback(
    (text: string, from: "TYPED" | "VOICE"): boolean => {
      const command = parseStoryCommand(
        text,
        player.snapshot().index,
        player.total,
        productStep,
      );
      if (command !== null) {
        setNotice(null);
        setAsked(false);
        setClarify(null);
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
      const after = player.snapshot().phase === "DONE";
      const decide = (decided: QaMatch, controller: AbortController) => {
        if (controller.signal.aborted) return;
        if (decided.kind === "ANSWER") {
          show(decided.entry, from, controller);
        } else if (decided.kind === "CLARIFY") {
          setAnswer(null);
          setAsked(false);
          setClarify(decided);
        } else if (!after) {
          // Not the bank's: Q's own open line answers it; then the offer
          // to carry on from the same beat.
          setAnswer(null);
          setClarify(null);
          setAsked(true);
        }
      };
      asking.current?.abort();
      const controller = new AbortController();
      asking.current = controller;
      if (from === "TYPED") {
        // Taken or not is decided now, so tier 1 alone: a typed question
        // the bank does not hold goes to Q exactly as before.
        const decided = qa.match(text);
        if (decided.kind === "LEAVE_TO_Q") return false;
        if (!after) player.interrupt();
        decide(decided, controller);
        return true;
      }
      // Said aloud (mid-story, or after "Do you have any questions?"): the
      // story stops at once; the bank decides, tier 1 in the browser and
      // tier 2 (meaning) only when unsure, so a reworded question still
      // gets its prepared answer.
      if (!after) player.interrupt();
      void matchSpokenQuestion(qa, text, "INVESTOR", {
        signal: controller.signal,
      }).then((decided) => decide(decided, controller));
      return true;
    },
    [
      player,
      qa,
      show,
      onExit,
      onCaptions,
      onMuted,
      captions,
      muted,
      productStep,
    ],
  );
  useEffect(() => {
    const release = setTypedInterceptor((text) => hear(text, "TYPED"));
    return () => {
      release();
      speaking.current?.abort();
      asking.current?.abort();
    };
  }, [hear]);

  // Spoken interruption (plan §4; control-channel's rules): the person's
  // own lines on Q's open voice line. While the story's audio is playing,
  // a line counts only when the mic reports echo cancellation, so Q's own
  // narration can never steer the story. Lines from before the story
  // started are ignored.
  const session = useQSessionOptional();
  const spoken = session?.spoken;
  const heardLines = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (spoken === undefined) return;
    if (heardLines.current === null) {
      heardLines.current = new Set(spoken.map((line) => line.id));
      return;
    }
    for (const line of spoken) {
      if (heardLines.current.has(line.id)) continue;
      heardLines.current.add(line.id);
      if (line.role !== "user") continue;
      const text = line.text.trim().slice(0, 600);
      if (text.length === 0) continue;
      const playingNow = player.snapshot().phase === "PLAYING";
      const echoSafe = session?.voice.client.echoCancelled?.() ?? false;
      if (playingNow && !echoSafe) continue;
      // After this render: hearing updates the overlay's own state.
      queueMicrotask(() => hear(text, "VOICE"));
    }
  }, [spoken, player, hear, session]);

  const { beat, word } = snapshot;
  // The caption is the line being spoken, lit word by word.
  const line = captionLine(beat, word);

  const halted =
    snapshot.phase === "PAUSED" || snapshot.phase === "INTERRUPTED";
  return (
    <>
      {/* Q, the narrator, always on screen. Centre stage in the story acts,
          inside the scrim: the scrim's night is the surface the particles
          read (QSwarm's surfaceIsDark), so no shape is drawn behind Q, only
          a faint gold bloom. Docked in the caption band on product beats.
          Two placements, two elements (a resize would be a layout shift). */}
      <StoryStill store={still} />
      <div
        className="cq-story-scrim"
        data-mood={moodNow}
        data-covering={coversPage(stageNow) ? "" : undefined}
        aria-hidden
      >
        {docked === null ? (
          // Re-keyed when the scrim turns from night to day: the particles
          // read their surface once, at mount.
          // Large at the centre on the opening and the close (the
          // aperture): Q is who says "Hi. I'm Q.", from the first frame.
          <div
            key={`${moodNow === "DAY" ? "centre-day" : "centre-night"}${aperture ? "-aperture" : ""}`}
            className="cq-story-presence"
            data-aperture={aperture ? "" : undefined}
          >
            <QSwarm
              state={playing ? "SPEAKING" : "IDLE"}
              pixels={aperture ? 320 : 160}
            />
          </div>
        ) : null}
      </div>
      {/* Product beats: the page dims around the lit section, so the gold
          breathing highlight is the one thing to look at. */}
      <div
        className="cq-story-spotlight"
        data-on={woke && lit !== null ? "" : undefined}
        style={
          lit === null || viewport === null
            ? undefined
            : { clipPath: spotlightPath(lit, viewport) }
        }
        aria-hidden
      />
      {docked === null ? null : (
        <div
          key="docked"
          className="cq-story-presence"
          data-docked=""
          style={{
            transform: `translate3d(${String(docked.x)}px, ${String(docked.y)}px, 0)`,
          }}
          aria-hidden
        >
          <QSwarm state={playing ? "SPEAKING" : "IDLE"} pixels={56} />
        </div>
      )}
      <StoryStage
        stage={stageNow}
        mood={moodNow === "OFF" ? "STORY" : moodNow}
        beside={beside}
      />
      {captions && !done && word >= 0 ? (
        // One place, always: a bottom band with its own soft scrim. The
        // line is keyed, so a new line is a new element (CLS 0).
        <p className="cq-story-captions" aria-live="off">
          <span
            className="cq-story-caption-line"
            key={`${String(beat.n)}-${String(line.start)}`}
          >
            {line.words.map((text, i) => (
              <span
                key={`${String(beat.n)}-${String(line.start + i)}`}
                data-said={line.start + i <= word ? "" : undefined}
              >
                {subtitleForm(text)}{" "}
              </span>
            ))}
          </span>
        </p>
      ) : null}
      {(() => {
        const standing = [
          rehearsal ? "Internal rehearsal" : null,
          isDemonstrationClaim(claims[beat.n]) ? DEMONSTRATION_LABEL : null,
        ]
          .filter((part) => part !== null)
          .join(" · ");
        // Keyed by its words: a new label is a new element (CLS 0).
        return (
          <p key={standing} className="cq-story-standing">
            {standing}
          </p>
        );
      })()}
      {asked && answer === null ? (
        <div className="cq-story-answer" role="status">
          <p className="cq-story-kicker">Paused for your question</p>
          <p>
            Q is answering. When you are ready, I&apos;ll carry on from here.
          </p>
          <button
            type="button"
            className="cq-story-btn cq-story-btn-primary"
            onClick={() => {
              setAsked(false);
              player.resume();
            }}
          >
            Carry on
          </button>
        </div>
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
              setAsked(false);
              if (!done) player.resume();
            }}
          >
            {done ? "Back" : "Carry on"}
          </button>
        </div>
      ) : null}
      {clarify !== null && answer === null ? (
        // A close call: Q asks rather than guess (S3's matcher).
        <div className="cq-story-answer" role="status">
          <p className="cq-story-kicker">{clarify.prompt}</p>
          <div className="cq-story-choices">
            {clarify.candidates.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="cq-story-btn"
                onClick={() => {
                  const controller = new AbortController();
                  asking.current?.abort();
                  asking.current = controller;
                  show(entry, "TYPED", controller);
                }}
              >
                {entry.question}
              </button>
            ))}
            <button
              type="button"
              className="cq-story-btn"
              onClick={() => {
                setClarify(null);
                if (!done) player.resume();
              }}
            >
              {done ? "Neither" : "Neither, carry on"}
            </button>
          </div>
        </div>
      ) : null}
      {done && closing && answer === null && clarify === null ? (
        <div className="cq-story-answer" role="status">
          <p className="cq-story-kicker">{STORY_CLOSING_QUESTION}</p>
          <p>Ask me aloud, or type your question below.</p>
          <button type="button" className="cq-story-btn" onClick={onExit}>
            Close
          </button>
        </div>
      ) : null}
      <nav
        className="cq-story-controls"
        aria-label="Story controls"
        data-hidden={chrome || !playing ? undefined : ""}
      >
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
