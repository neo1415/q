"use client";

import { useEffect, useRef, useState } from "react";

import type {
  DiscoveredCompanyDto,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import type { FeedPreloadPolicy } from "../feed/feed-state";
import {
  attachNativeSource,
  type AttachSource,
  type PlaybackSource,
} from "./pitch-playback";
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
};

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
}: PitchPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ownMuted, setOwnMuted] = useState(true);
  const muted = controlledMuted ?? ownMuted;
  const setMuted = (next: boolean) => {
    if (onMutedChange !== undefined) onMutedChange(next);
    else setOwnMuted(next);
  };
  const [playing, setPlaying] = useState(false);

  const { intent, posterUrl, playbackUrl, failed } = usePitchPlayback({
    mediaAssetId: company.pitch?.mediaAssetId ?? null,
    policy,
    authorize,
    reducedMotion,
    initialAuthorization,
  });

  // Attaching and detaching is the strategy's job, including cancelling an
  // in-flight fetch when this card goes cold (doc 20 §236).
  useEffect(() => {
    const video = videoRef.current;
    if (video === null || playbackUrl === null) return;
    return attachSource(video, playbackUrl);
  }, [attachSource, playbackUrl]);

  // Autoplay only where the controller said ACTIVE and motion is allowed.
  // A rejected play() promise is normal -- browsers refuse autoplay under
  // their own rules -- and leaves the Play control as the way in.
  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;

    if (!intent.autoplay || playbackUrl === null || hold) {
      if (!video.paused) video.pause();
      return;
    }

    // `playing` is not set here. It is the element's own `play`/`pause`
    // events that say what is happening -- a promise that resolved is not
    // the same fact as a video that is running, and a browser may refuse
    // autoplay under its own policy without either of them being wrong.
    void video.play().catch(() => undefined);
  }, [intent.autoplay, playbackUrl, hold]);

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
    return (
      <div
        className="cq-feed-player"
        data-pitch-frame
        data-orientation={w > h ? "landscape" : "portrait"}
      >
        <video
          ref={videoRef}
          className="cq-feed-video"
          playsInline
          muted={muted}
          loop
          {...(intent.preload === null ? {} : { preload: intent.preload })}
          {...(posterUrl === null ? {} : { poster: posterUrl })}
          aria-label={`Pitch from ${company.canonicalName}`}
          data-policy={policy}
          data-playing={playing ? "true" : "false"}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        {intent.attach || failed ? (
          <div className="cq-feed-player-controls">
            {intent.requiresExplicitPlay && !playing ? (
              <button
                type="button"
                className="cq-stage-control"
                onClick={() => {
                  void videoRef.current?.play().catch(() => undefined);
                }}
                disabled={playbackUrl === null}
              >
                Play
              </button>
            ) : null}
            {intent.attach ? (
              <button
                type="button"
                className="cq-stage-control"
                aria-pressed={!muted}
                onClick={() => setMuted(!muted)}
              >
                {muted ? "Unmute" : "Mute"}
              </button>
            ) : null}
            {failed ? (
              <span className="cq-caption text-(--cq-text-secondary)">
                This pitch could not be loaded right now.
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="cq-pitch flex flex-col gap-3">
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
          className="size-full object-cover"
          // Inline on iOS; fullscreen takeover is not a feed.
          playsInline
          muted={muted}
          loop
          // Derived only from the controller's tier. `undefined` when no
          // source is attached, so the browser is told nothing to fetch.
          {...(intent.preload === null ? {} : { preload: intent.preload })}
          {...(posterUrl === null ? {} : { poster: posterUrl })}
          aria-label={`Pitch from ${company.canonicalName}`}
          data-policy={policy}
          data-playing={playing ? "true" : "false"}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        >
          {/*
            Captions (R18), same-origin because a <track> cannot carry the
            API's bearer token: the route attaches it server-side, and the
            API decides under the playback rule. Only once a source is
            attached, so a cold card fetches nothing.
          */}
          {pitch.captionState === "AVAILABLE" && playbackUrl !== null ? (
            <track
              kind="captions"
              srcLang="en"
              label="English (generated)"
              src={`/api/pitch-captions/${company.companyId}/${pitch.mediaAssetId}`}
              default
            />
          ) : null}
        </video>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/*
          Reduced motion keeps the video and removes the surprise: poster
          plus an explicit Play (ADR-001). The control is a real button
          with a word on it, not an icon overlay, so it is reachable by
          keyboard and announced by a screen reader.
        */}
        {intent.requiresExplicitPlay && !playing ? (
          <Button
            variant="secondary"
            size="compact"
            onClick={() => {
              void videoRef.current?.play().catch(() => undefined);
            }}
            disabled={playbackUrl === null}
          >
            Play
          </Button>
        ) : null}

        {/*
          Audio is off until a person enables it. The label states the
          action and the state is never carried by colour alone.
        */}
        {intent.attach ? (
          <Button
            variant="quiet"
            size="compact"
            aria-pressed={!muted}
            onClick={() => setMuted(!muted)}
          >
            {muted ? "Unmute" : "Mute"}
          </Button>
        ) : null}

        {pitch.captionState === "AVAILABLE" ? (
          <span className="cq-caption text-(--cq-text-tertiary)">
            Captions on (generated)
          </span>
        ) : null}
      </div>

      {failed ? (
        <p className="cq-caption text-(--cq-text-secondary)">
          This pitch could not be loaded right now.
        </p>
      ) : null}
    </div>
  );
}
