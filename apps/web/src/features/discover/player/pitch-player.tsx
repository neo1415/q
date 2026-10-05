"use client";

import { useEffect, useRef, useState } from "react";

import type {
  DiscoveredCompanyDto,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import {
  Captions,
  CaptionsOff,
  ICON_SIZE,
  ICON_STROKE,
  Pause,
  Play,
  RotateCw,
  Signal,
  Volume2,
  VolumeX,
  WifiOff,
} from "@capital-q/ui/icons";

import type { FeedPreloadPolicy } from "../feed/feed-state";
import {
  attachNativeSource,
  FIRST_FRAME_TIMEOUT_MS,
  PLAYBACK_FAILED_EVENT,
  type AttachSource,
  type PlaybackSource,
} from "./pitch-playback";
import { claimActivePlayer, releaseActivePlayer } from "./active-player";
import { reportPlaybackStall } from "../feed/use-feed-budget";
import { setStreamWarmth } from "./hls-source";
import { usePitchPlayback } from "./use-pitch-playback";

/**
 * The pitch player (CQ-WEB-021; doc 20 §35-§36, §44-§50, §60; ADR-001).
 *
 * A wrapper, not a player: a plain `<video>`, an injected strategy for
 * getting a URL onto it, and an injected way of asking the server whether
 * this viewer may watch. Everything about which card is playing comes from
 * the feed controller's policy, so there is no state here that could
 * disagree with the feed.
 *
 * Three rules are enforced by construction rather than by remembering:
 * bytes never pass through the app origin (the element is pointed at the
 * CDN URL the server authorised); nothing plays without the controller
 * saying ACTIVE; and audio is off until a person turns it on.
 */

/**
 * The frame a pitch is shown in: its CSS aspect ratio, and how wide it may
 * be so that its height stays within `--cq-pitch-max-height`.
 *
 * Media stores a ratio as `W:H` ("4:3", "9:16"); CSS wants `W / H`. The
 * stored form used to be handed to `style.aspectRatio` as it was, the
 * browser rejected it, and the frame took whatever height the video
 * happened to have loaded -- 150 px, then 570 px on a laptop, with Save,
 * Pass and Ask Q pushed below the fold and the page shifting under the
 * person as it arrived. Both spellings are read here; anything else falls
 * back to the portrait default rather than to no frame at all.
 *
 * Capping the width, not the height, is what keeps the ratio: a max-height
 * on a full-width box would crop the video instead of shrinking it.
 */
const DEFAULT_RATIO = { width: 9, height: 16 } as const;
const RATIO = /^\s*(\d{1,3}(?:\.\d+)?)\s*(?::|\/)\s*(\d{1,3}(?:\.\d+)?)\s*$/;

export function pitchFrame(aspectRatio: string | null | undefined): {
  readonly aspectRatio: string;
  readonly maxWidth: string;
} {
  const match = aspectRatio == null ? null : RATIO.exec(aspectRatio);
  const width = match === null ? 0 : Number(match[1]);
  const height = match === null ? 0 : Number(match[2]);
  const ratio = width > 0 && height > 0 ? { width, height } : DEFAULT_RATIO;
  return {
    aspectRatio: `${String(ratio.width)} / ${String(ratio.height)}`,
    maxWidth: `min(100%, calc(var(--cq-pitch-max-height) * ${String(ratio.width)} / ${String(ratio.height)}))`,
  };
}

/** Set every text track on the element to showing or hidden. */
function showCaptions(video: HTMLVideoElement | null, on: boolean): void {
  const tracks = video?.textTracks;
  if (tracks === undefined) return;
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    if (track !== undefined) track.mode = on ? "showing" : "hidden";
  }
}

type PitchPlayerProps = {
  readonly company: DiscoveredCompanyDto;
  /** The tier this card is in, from the feed controller. */
  readonly policy: FeedPreloadPolicy;
  readonly authorize: PlaybackSource;
  readonly reducedMotion: boolean;
  /** Swappable for an MSE engine; the native path is the default. */
  readonly attachSource?: AttachSource;
  /**
   * `inline`: a framed player in a page (the founder's own review).
   * `stage`: the Discover feed's full-bleed slot, which sizes the video;
   * the controls float over it (spec §9).
   */
  readonly variant?: "inline" | "stage" | undefined;
  /**
   * Hold playback even where the tier says ACTIVE: while the feed is
   * still settling on this card, while Q is speaking, or while a sheet
   * covers the stage (spec §9.4-§9.5).
   */
  readonly hold?: boolean | undefined;
  /** Controlled sound, so one choice carries from card to card. */
  readonly muted?: boolean | undefined;
  readonly onMutedChange?: ((muted: boolean) => void) | undefined;
  /** The server's authorization for the first card, so its poster is SSR'd. */
  readonly initialAuthorization?: PlaybackAuthorizationDto | null | undefined;
  /**
   * Poster first, and nothing fetched or played until somebody presses
   * Play (R36): for a page with a pitch on it rather than a feed of them.
   * Until then the controller's tier is capped at POSTER, so no media
   * bytes move; pressing Play lifts the cap and starts it.
   */
  readonly startOnRequest?: boolean | undefined;
  /** Stage only: the viewer's speed (client-only, Discover v2). */
  readonly rate?: number | undefined;
  /** Stage only: captions shown, when the pitch has them. */
  readonly captionsOn?: boolean | undefined;
  /**
   * Stage only, the card in view: its element, for the feed's progress
   * bar and speed. Called with null when it stops being that card.
   */
  readonly onElement?: ((video: HTMLVideoElement | null) => void) | undefined;
  /** Stage only: the browser says there is no network at all. */
  readonly offline?: boolean | undefined;
};

/**
 * A stall shorter than this shows nothing: most recover before a person
 * would notice, and a ring that flashes reads as a fault (Discover v2).
 */
export const BUFFERING_DELAY_MS = 400;
/** A rendition whose short side is below this is "lower quality". */
const LOW_QUALITY_SHORT_SIDE = 360;

/**
 * The tier a request-to-play player is really in: the controller's, but
 * never beyond a poster until it has been asked to play.
 */
export function requestedPolicy(
  policy: FeedPreloadPolicy,
  requested: boolean,
): FeedPreloadPolicy {
  if (requested || policy === "NONE") return policy;
  return "POSTER";
}

const CANNOT_PLAY =
  "This pitch can't play in this browser. Try another browser or device; the rest of the company's profile is here.";

export function PitchPlayer({
  company,
  policy,
  authorize,
  reducedMotion,
  attachSource = attachNativeSource,
  variant = "inline",
  hold = false,
  muted: controlledMuted,
  onMutedChange,
  initialAuthorization = null,
  startOnRequest = false,
  rate = 1,
  captionsOn: stageCaptionsOn = true,
  onElement,
  offline = false,
}: PitchPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Sound on (ADR 0026), except under reduced motion, where audio stays
  // off until the person enables it (ADR-001 D5).
  const [ownMuted, setOwnMuted] = useState(reducedMotion);
  const muted = controlledMuted ?? ownMuted;
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  // A muted fallback because the browser refused sound before any tap.
  const [soundBlocked, setSoundBlocked] = useState(false);
  // What the person hears, which the control shows: muted by them, or by
  // the browser until their first tap.
  const silent = muted || soundBlocked;
  const toggleSound = () => {
    if (soundBlocked) {
      // Their tap on the control is the gesture the browser waited for.
      const video = videoRef.current;
      if (video !== null) video.muted = false;
      setSoundBlocked(false);
      if (muted) setMuted(false);
      return;
    }
    setMuted(!muted);
  };
  const setMuted = (next: boolean) => {
    if (onMutedChange !== undefined) onMutedChange(next);
    else setOwnMuted(next);
  };
  const [playing, setPlaying] = useState(false);
  /** Somebody pressed Play on a request-to-play player. */
  const [requested, setRequested] = useState(!startOnRequest);
  /** A press that is waiting for its source to attach. */
  const pendingPlay = useRef(false);
  const [captionsOn, setCaptionsOn] = useState(true);

  const { intent, posterUrl, playbackUrl, failed, retry } = usePitchPlayback({
    mediaAssetId: company.pitch?.mediaAssetId ?? null,
    policy: requestedPolicy(policy, requested),
    authorize,
    reducedMotion,
    initialAuthorization,
  });

  // The controller's tier, told to the stream engine before it attaches
  // (effects run in order) and again whenever the tier changes: a warm
  // card buffers a short start, the playing one runs ahead. Same engine,
  // no re-attach, so the swipe keeps what was already buffered.
  const warmth = policy === "ACTIVE" ? "active" : "warm";
  useEffect(() => {
    const video = videoRef.current;
    if (video !== null) setStreamWarmth(video, warmth);
  }, [warmth]);

  // Declared before the attach effect on purpose: effects run in order, so
  // the failure listeners are on the element before any source is attached
  // and a failure raised while attaching is never missed (a flaky test
  // dispatched one in the gap, design-48).
  // A source that cannot play here says so, rather than leaving a poster
  // that never moves: an error on the element, a fatal error from the
  // stream engine, or no first frame within a bounded time of being asked
  // to play (a browser without H.264 raises nothing at all).
  const [unplayable, setUnplayable] = useState<string | null>(null);
  /**
   * A pitch that has already played and then fails -- at its end, on the
   * loop back to the start, or when its stream session lapses -- is not a
   * browser that cannot play it (founder, 2026-10-05: the end of a pitch
   * showed "This pitch can't play here"). That source is refreshed once,
   * silently: a new grant, a new attach, playing from the start. Only a
   * source that fails again before it plays says so.
   */
  const silentRefresh = useRef<(() => void) | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (video === null || playbackUrl === null) return;
    let timer: number | undefined;
    let played = false;
    const give = () => {
      if (played && silentRefresh.current !== null) {
        played = false;
        silentRefresh.current();
        return;
      }
      setUnplayable(playbackUrl);
    };
    const stopWaiting = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const startWaiting = () => {
      stopWaiting();
      // The first-frame bound is for the first frame only: a loop back to
      // the start re-buffering for a moment is not a failure.
      if (played) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
      timer = window.setTimeout(() => {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) give();
      }, FIRST_FRAME_TIMEOUT_MS);
    };
    const progressed = () => {
      if (video.currentTime > 0 || video.ended) {
        played = true;
        stopWaiting();
      }
    };
    video.addEventListener("error", give);
    video.addEventListener(PLAYBACK_FAILED_EVENT, give);
    video.addEventListener("play", startWaiting);
    video.addEventListener("loadeddata", stopWaiting);
    video.addEventListener("pause", stopWaiting);
    video.addEventListener("timeupdate", progressed);
    video.addEventListener("ended", progressed);
    return () => {
      stopWaiting();
      video.removeEventListener("error", give);
      video.removeEventListener(PLAYBACK_FAILED_EVENT, give);
      video.removeEventListener("play", startWaiting);
      video.removeEventListener("loadeddata", stopWaiting);
      video.removeEventListener("pause", stopWaiting);
      video.removeEventListener("timeupdate", progressed);
      video.removeEventListener("ended", progressed);
    };
  }, [playbackUrl]);
  // Attaching and detaching is the strategy's job, including cancelling an
  // in-flight fetch when this card goes cold (doc 20 §236).
  useEffect(() => {
    const video = videoRef.current;
    if (video === null || playbackUrl === null) return;
    return attachSource(video, playbackUrl);
  }, [attachSource, playbackUrl]);

  // Only for the source that failed: a new authorization is a new chance.
  const cannotPlay = unplayable !== null && unplayable === playbackUrl;

  // Autoplay only where the controller said ACTIVE and motion is allowed.
  // A rejected play() promise is normal -- browsers refuse autoplay under
  // their own rules -- and leaves the Play control as the way in.
  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;

    if (startOnRequest) {
      // Only a press starts it, even once it is ACTIVE; a hold (Q
      // speaking, another preview opened) still pauses it.
      if (hold) {
        if (!video.paused) video.pause();
        return;
      }
      if (pendingPlay.current && playbackUrl !== null) {
        pendingPlay.current = false;
        void video.play().catch(() => undefined);
      }
      return;
    }

    if (!intent.autoplay || playbackUrl === null || hold) {
      if (!video.paused) video.pause();
      return;
    }

    // `playing` is not set here. It is the element's own `play`/`pause`
    // events that say what is happening -- a promise that resolved is not
    // the same fact as a video that is running, and a browser may refuse
    // autoplay under its own policy without either of them being wrong.
    //
    // With sound on and no tap yet, a browser refuses the play outright.
    // Then it plays muted, and the first tap or key anywhere brings the
    // sound back (founder direction 2026-09-29: sound on, like TikTok).
    void video.play().catch((error: unknown) => {
      if (
        video.muted ||
        !(error instanceof DOMException) ||
        error.name !== "NotAllowedError"
      ) {
        return;
      }
      video.muted = true;
      setSoundBlocked(true);
      void video.play().catch(() => undefined);
    });
  }, [intent.autoplay, playbackUrl, hold, startOnRequest]);

  // The first gesture after a muted fallback restores the sound the person
  // has on; one they turned off stays off.
  useEffect(() => {
    if (!soundBlocked) return;
    const restore = (event: Event) => {
      // The sound control handles its own tap.
      if (
        event.target instanceof Element &&
        event.target.closest("[data-sound-toggle]") !== null
      ) {
        return;
      }
      const video = videoRef.current;
      if (video !== null && !mutedRef.current) video.muted = false;
      setSoundBlocked(false);
    };
    const options = { once: true, capture: true } as const;
    window.addEventListener("pointerdown", restore, options);
    window.addEventListener("keydown", restore, options);
    return () => {
      window.removeEventListener("pointerdown", restore, options);
      window.removeEventListener("keydown", restore, options);
    };
  }, [soundBlocked]);

  // Leaving the page is leaving the claim.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (video !== null) releaseActivePlayer(video);
    };
  }, []);

  // Captions are a choice, carried to the element's own track list: the
  // `default` attribute is read once, when the track is added.
  useEffect(() => {
    showCaptions(videoRef.current, captionsOn);
  }, [captionsOn, playbackUrl]);

  // The viewer's speed, on the element itself; the pitch's voice keeps its
  // pitch at 0.5x and 2x rather than turning into a cartoon.
  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;
    video.playbackRate = rate;
    video.defaultPlaybackRate = rate;
    video.preservesPitch = true;
  }, [rate, playbackUrl]);

  // The stage's captions follow the feed's one choice.
  useEffect(() => {
    if (variant === "stage") showCaptions(videoRef.current, stageCaptionsOn);
  }, [variant, stageCaptionsOn, playbackUrl]);

  // The card in view hands its element to the feed's progress bar.
  useEffect(() => {
    if (onElement === undefined) return;
    onElement(videoRef.current);
    return () => onElement(null);
  }, [onElement]);

  /*
   * Buffering, said quietly: a ring only after a stall has lasted
   * BUFFERING_DELAY_MS, on the poster or the last frame (never a black
   * box), and only for the card that is meant to be playing. Each stall is
   * reported to the preload budget, which narrows the warm window on a
   * link that keeps stalling (doc 20 §53).
   */
  const [buffering, setBuffering] = useState(false);
  const [lowQuality, setLowQuality] = useState(false);
  const meantToPlay = policy === "ACTIVE" && !hold && intent.autoplay;
  useEffect(() => {
    const video = videoRef.current;
    if (video === null || playbackUrl === null) return;
    let timer: number | undefined;
    const clear = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      setBuffering(false);
    };
    const stalled = () => {
      if (timer !== undefined || video.paused) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        setBuffering(true);
        reportPlaybackStall();
      }, BUFFERING_DELAY_MS);
    };
    const resized = () => {
      const short = Math.min(video.videoWidth, video.videoHeight);
      setLowQuality(short > 0 && short < LOW_QUALITY_SHORT_SIDE);
    };
    video.addEventListener("waiting", stalled);
    video.addEventListener("playing", clear);
    video.addEventListener("canplaythrough", clear);
    video.addEventListener("pause", clear);
    video.addEventListener("emptied", clear);
    video.addEventListener("resize", resized);
    return () => {
      clear();
      video.removeEventListener("waiting", stalled);
      video.removeEventListener("playing", clear);
      video.removeEventListener("canplaythrough", clear);
      video.removeEventListener("pause", clear);
      video.removeEventListener("emptied", clear);
      video.removeEventListener("resize", resized);
    };
  }, [playbackUrl]);

  /** Try again, on a press: re-ask for the grant and reload the source. */
  // The silent refresh above: a new grant and source, played once attached.
  useEffect(() => {
    silentRefresh.current = () => {
      pendingPlay.current = true;
      retry();
    };
    return () => {
      silentRefresh.current = null;
    };
  }, [retry]);

  const tryAgain = () => {
    setUnplayable(null);
    retry();
    const video = videoRef.current;
    if (video !== null && playbackUrl !== null && !failed) {
      video.load();
      if (meantToPlay) void video.play().catch(() => undefined);
    }
  };

  const startPlaying = () => {
    const video = videoRef.current;
    if (!requested) {
      // The source is not attached yet: lift the cap, and play as soon
      // as it is.
      pendingPlay.current = true;
      setRequested(true);
      return;
    }
    void video?.play().catch(() => undefined);
  };
  const onPlay = () => {
    const video = videoRef.current;
    if (video !== null) claimActivePlayer(video);
    setPlaying(true);
  };

  // Muting is a property, not an attribute: React sets the attribute on
  // first render only, and the element's own state is what the browser
  // reads when deciding whether autoplay is allowed.
  useEffect(() => {
    const video = videoRef.current;
    if (video !== null) video.muted = muted;
  }, [muted]);

  const pitch = company.pitch;
  if (pitch === null) return null;

  const frame = pitchFrame(pitch.aspectRatio);

  if (variant === "stage") {
    // The stage is portrait; a landscape pitch is letterboxed, not cropped.
    const [w = 9, h = 16] = frame.aspectRatio.split("/").map(Number);
    const captions = pitch.captionState === "AVAILABLE";
    const problem: "OFFLINE" | "FAILED" | "UNPLAYABLE" | null =
      policy !== "ACTIVE"
        ? null
        : offline && !playing
          ? "OFFLINE"
          : failed
            ? "FAILED"
            : cannotPlay
              ? "UNPLAYABLE"
              : null;
    const explicitPlay =
      intent.requiresExplicitPlay && !playing && problem === null;
    return (
      <div
        className="cq-feed-player"
        data-pitch-frame
        data-orientation={w > h ? "landscape" : "portrait"}
        data-problem={problem ?? undefined}
      >
        <video
          ref={videoRef}
          className="cq-feed-video"
          playsInline
          muted={muted}
          loop
          // Streamed (MSE/HLS) sources can ignore `loop`; restart by hand so
          // a pitch always loops seamlessly (founder, 2026-09-28).
          onEnded={(event) => {
            const video = event.currentTarget;
            video.currentTime = 0;
            void video.play().catch(() => undefined);
          }}
          {...(intent.preload === null ? {} : { preload: intent.preload })}
          {...(posterUrl === null ? {} : { poster: posterUrl })}
          aria-label={`Pitch from ${company.canonicalName}`}
          data-policy={policy}
          data-playing={playing ? "true" : "false"}
          onPlay={onPlay}
          onPause={() => setPlaying(false)}
        >
          {/* Captions, same-origin (see the inline player), only once a
              source is attached so a cold card fetches nothing. */}
          {captions && playbackUrl !== null ? (
            <track
              kind="captions"
              srcLang="en"
              label="English (generated)"
              src={`/api/pitch-captions/${company.companyId}/${pitch.mediaAssetId}`}
              default={stageCaptionsOn}
            />
          ) : null}
        </video>

        {/* Sound belongs to the card on screen only: a preloaded card
            offering its own Unmute read as "Unmute Unmute". */}
        {intent.attach && policy === "ACTIVE" && problem === null ? (
          <div className="cq-feed-player-controls">
            <button
              type="button"
              className="cq-feed-sound"
              aria-pressed={!silent}
              aria-label={silent ? "Unmute" : "Mute"}
              onClick={toggleSound}
              data-sound-toggle
            >
              {silent ? (
                <VolumeX
                  aria-hidden="true"
                  size={ICON_SIZE.prominent}
                  strokeWidth={ICON_STROKE}
                />
              ) : (
                <Volume2
                  aria-hidden="true"
                  size={ICON_SIZE.prominent}
                  strokeWidth={ICON_STROKE}
                />
              )}
            </button>
            {lowQuality && playing ? (
              <span className="cq-feed-quality" data-low-quality>
                <Signal
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                />
                Slow connection · lower quality
              </span>
            ) : null}
          </div>
        ) : null}

        {buffering && meantToPlay && problem === null ? (
          <span
            className="cq-feed-buffering"
            role="status"
            aria-label="The pitch is loading"
            data-buffering
          >
            <span className="cq-feed-ring" aria-hidden="true" />
          </span>
        ) : null}

        {explicitPlay ? (
          /*
            Reduced motion keeps the video and removes the surprise: the
            poster and an explicit Play with a word on it (ADR-001), sound
            off until the person turns it on.
          */
          <div className="cq-feed-center" data-explicit-play>
            <button
              type="button"
              className="cq-feed-play"
              onClick={() => {
                void videoRef.current?.play().catch(() => undefined);
              }}
              disabled={playbackUrl === null}
            >
              <Play
                aria-hidden="true"
                size={ICON_SIZE.regular}
                strokeWidth={ICON_STROKE}
                fill="currentColor"
              />
              Play pitch
            </button>
            {silent ? (
              <span className="cq-feed-center-note">
                Sound stays off until you turn it on
              </span>
            ) : null}
          </div>
        ) : null}

        {problem === null ? null : (
          <div className="cq-feed-center cq-feed-problem" role="status">
            {problem === "OFFLINE" ? (
              <WifiOff
                aria-hidden="true"
                size={ICON_SIZE.prominent}
                strokeWidth={ICON_STROKE}
              />
            ) : null}
            <p className="cq-feed-problem-title">
              {problem === "OFFLINE"
                ? "No connection"
                : problem === "FAILED"
                  ? "This pitch couldn't load"
                  : "This pitch can't play here"}
            </p>
            <p className="cq-feed-center-note">
              {problem === "OFFLINE"
                ? "The pitch picks up where it stopped once you're back online. Saves and passes are kept."
                : problem === "FAILED"
                  ? "Check your connection, then try again. The company's profile is still one tap away."
                  : CANNOT_PLAY}
            </p>
            {problem === "UNPLAYABLE" ? null : (
              <button
                type="button"
                className="cq-feed-play"
                onClick={tryAgain}
                disabled={offline}
                data-pitch-retry
              >
                <RotateCw
                  aria-hidden="true"
                  size={ICON_SIZE.regular}
                  strokeWidth={ICON_STROKE}
                />
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // A request-to-play player always offers Play when it is not playing:
  // another player taking the page pauses it, and it must be resumable.
  const explicitPlay = startOnRequest || intent.requiresExplicitPlay;
  const captions = pitch.captionState === "AVAILABLE";

  return (
    <div className="cq-pitch flex flex-col gap-3" data-pitch-player>
      {/*
        A known aspect ratio at all times, so a poster arriving or a source
        attaching never moves the page (doc 20 §60, CLS), and a height that
        leaves the decision controls on the first screen.
      */}
      <div
        className="relative w-full overflow-hidden rounded-lg bg-(--cq-surface-strong)"
        style={{ aspectRatio: frame.aspectRatio, maxWidth: frame.maxWidth }}
        data-pitch-frame
      >
        <video
          ref={videoRef}
          // Contained, not cropped: a narrated deck video (16:9, the
          // slides are the picture) must never lose its edges to a frame
          // whose ratio was unknown.
          className="size-full object-contain"
          // Inline on iOS; fullscreen takeover is not a feed.
          playsInline
          muted={muted}
          loop
          // Streamed (MSE/HLS) sources can ignore `loop`; restart by hand so
          // a pitch always loops seamlessly (founder, 2026-09-28).
          onEnded={(event) => {
            const video = event.currentTarget;
            video.currentTime = 0;
            void video.play().catch(() => undefined);
          }}
          // Derived only from the controller's tier. `undefined` when no
          // source is attached, so the browser is told nothing to fetch.
          {...(intent.preload === null ? {} : { preload: intent.preload })}
          {...(posterUrl === null ? {} : { poster: posterUrl })}
          aria-label={`Pitch from ${company.canonicalName}`}
          data-policy={policy}
          data-playing={playing ? "true" : "false"}
          onPlay={onPlay}
          onPause={() => setPlaying(false)}
        >
          {/*
            Captions (R18), same-origin because a <track> cannot carry the
            API's bearer token: the route attaches it server-side, and the
            API decides under the playback rule. Only once a source is
            attached, so a cold card fetches nothing.
          */}
          {captions && playbackUrl !== null ? (
            <track
              kind="captions"
              srcLang="en"
              label="English (generated)"
              src={`/api/pitch-captions/${company.companyId}/${pitch.mediaAssetId}`}
              default={captionsOn}
            />
          ) : null}
        </video>

        {/*
          Poster first (R36): one large, plain Play over the still, the
          same action as the Play below, so the obvious place to press
          works. Hidden from assistive technology because the labelled
          button below is the one it should find, once.
        */}
        {explicitPlay && !playing && !failed && !cannotPlay ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center"
            onClick={startPlaying}
            disabled={requested && playbackUrl === null}
            data-pitch-poster-play
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-(--cq-surface-raised) text-(--cq-text-primary) shadow-(--cq-shadow-overlay)">
              <Play size={ICON_SIZE.prominent} strokeWidth={ICON_STROKE} />
            </span>
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/*
          Reduced motion keeps the video and removes the surprise: poster
          plus an explicit Play (ADR-001). The control is a real button
          with a word on it, not an icon overlay, so it is reachable by
          keyboard and announced by a screen reader.
        */}
        {cannotPlay ? (
          <p className="cq-caption text-(--cq-text-secondary)" role="status">
            {CANNOT_PLAY}
          </p>
        ) : null}
        {explicitPlay && !playing && !cannotPlay ? (
          <Button
            variant="secondary"
            onClick={startPlaying}
            disabled={requested && playbackUrl === null}
          >
            <Play
              aria-hidden="true"
              size={ICON_SIZE.regular}
              strokeWidth={ICON_STROKE}
            />
            Play
          </Button>
        ) : null}
        {explicitPlay && playing ? (
          <Button variant="secondary" onClick={() => videoRef.current?.pause()}>
            <Pause
              aria-hidden="true"
              size={ICON_SIZE.regular}
              strokeWidth={ICON_STROKE}
            />
            Pause
          </Button>
        ) : null}

        {/*
          Audio is off until a person enables it. The label states the
          action and the state is never carried by colour alone.
        */}
        {intent.attach ? (
          <Button
            variant="quiet"
            aria-pressed={!silent}
            onClick={toggleSound}
            data-sound-toggle
          >
            {silent ? (
              <VolumeX
                aria-hidden="true"
                size={ICON_SIZE.regular}
                strokeWidth={ICON_STROKE}
              />
            ) : (
              <Volume2
                aria-hidden="true"
                size={ICON_SIZE.regular}
                strokeWidth={ICON_STROKE}
              />
            )}
            <span className="sr-only">{silent ? "Unmute" : "Mute"}</span>
          </Button>
        ) : null}

        {captions ? (
          <Button
            variant="quiet"
            aria-pressed={captionsOn}
            onClick={() => setCaptionsOn((on) => !on)}
            data-pitch-captions
          >
            {captionsOn ? (
              <Captions
                aria-hidden="true"
                size={ICON_SIZE.regular}
                strokeWidth={ICON_STROKE}
              />
            ) : (
              <CaptionsOff
                aria-hidden="true"
                size={ICON_SIZE.regular}
                strokeWidth={ICON_STROKE}
              />
            )}
            Captions
          </Button>
        ) : null}
      </div>

      {failed ? (
        <p className="cq-caption text-(--cq-text-secondary)">
          This pitch couldn&apos;t load right now. Try again in a moment.
        </p>
      ) : null}
    </div>
  );
}
