"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * The pitch's progress bar, on the seam between the video and what is
 * below it (Discover v2). Thin while the pitch plays, thicker when it is
 * paused, and a thumb with a large time readout while a finger or the
 * pointer drags it. Client-only: where someone scrubs to is never sent
 * anywhere and never read as interest.
 *
 * The bar is written straight to the DOM from the element's own clock
 * (one requestAnimationFrame loop while playing), so the progress moving
 * re-renders nothing. React state changes only when the bar's shape does:
 * playing, paused, dragging.
 */

/** Arrow keys move the pitch by this much, as on most players. */
export const SEEK_STEP_SECONDS = 5;

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${String(minutes)}:${String(rest).padStart(2, "0")}`;
}

function durationOf(
  video: HTMLVideoElement,
  fallback: number | null | undefined,
): number {
  const own = video.duration;
  if (Number.isFinite(own) && own > 0) return own;
  return fallback !== null && fallback !== undefined && fallback > 0
    ? fallback
    : 0;
}

/** Move the pitch, in seconds, staying inside it. */
export function seekBy(
  video: HTMLVideoElement,
  seconds: number,
  fallbackDuration?: number | null,
): void {
  const duration = durationOf(video, fallbackDuration);
  const target = video.currentTime + seconds;
  video.currentTime =
    duration > 0
      ? Math.min(Math.max(0, target), duration - 0.05)
      : Math.max(0, target);
}

/**
 * Put the pitch at a time. A plain function on purpose: the element is the
 * truth about the position, and moving it is an effect on the element, not
 * a change to anything this component renders from.
 */
function jumpTo(video: HTMLVideoElement, seconds: number, fast = false): void {
  // fastSeek lands on a keyframe: right for a moving finger.
  if (fast && typeof video.fastSeek === "function") video.fastSeek(seconds);
  else video.currentTime = seconds;
}

function bufferedEnd(video: HTMLVideoElement): number {
  const ranges = video.buffered;
  const now = video.currentTime;
  for (let index = 0; index < ranges.length; index += 1) {
    if (ranges.start(index) <= now + 0.25 && ranges.end(index) >= now) {
      return ranges.end(index);
    }
  }
  return now;
}

export function PitchScrubber({
  video,
  durationSeconds,
  companyName,
  onScrubbingChange,
}: {
  /** The active card's element; null while there is none. */
  readonly video: HTMLVideoElement | null;
  /** The stored duration, for the label before the element knows its own. */
  readonly durationSeconds?: number | null | undefined;
  readonly companyName: string;
  readonly onScrubbingChange?: ((scrubbing: boolean) => void) | undefined;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  // Playing or paused is the element's own state, read from its events.
  const subscribePaused = useCallback(
    (onChange: () => void) => {
      if (video === null) return () => undefined;
      video.addEventListener("play", onChange);
      video.addEventListener("pause", onChange);
      return () => {
        video.removeEventListener("play", onChange);
        video.removeEventListener("pause", onChange);
      };
    },
    [video],
  );
  const paused = useSyncExternalStore(
    subscribePaused,
    () => video?.paused ?? true,
    () => true,
  );
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const resumeAfter = useRef(false);
  const seekFrame = useRef<number | null>(null);
  const pendingRatio = useRef<number | null>(null);

  /** Draw the bar at a ratio of the pitch, without a render. */
  const paint = useCallback(
    (ratio: number, buffered: number) => {
      const clamped = Math.min(1, Math.max(0, ratio));
      fillRef.current?.style.setProperty(
        "transform",
        `scaleX(${String(clamped)})`,
      );
      bufferRef.current?.style.setProperty(
        "transform",
        `scaleX(${String(Math.min(1, Math.max(clamped, buffered)))})`,
      );
      thumbRef.current?.style.setProperty("left", `${String(clamped * 100)}%`);
      const root = rootRef.current;
      if (root !== null && video !== null) {
        const duration = durationOf(video, durationSeconds);
        const at = clamped * duration;
        root.setAttribute("aria-valuenow", String(Math.round(at)));
        root.setAttribute("aria-valuemax", String(Math.round(duration)));
        root.setAttribute(
          "aria-valuetext",
          `${formatTime(at)} of ${formatTime(duration)}`,
        );
        if (readoutRef.current !== null) {
          readoutRef.current.textContent = formatTime(at);
        }
      }
    },
    [video, durationSeconds],
  );

  const paintFromVideo = useCallback(() => {
    if (video === null || draggingRef.current) return;
    const duration = durationOf(video, durationSeconds);
    if (duration <= 0) {
      paint(0, 0);
      return;
    }
    paint(video.currentTime / duration, bufferedEnd(video) / duration);
  }, [video, durationSeconds, paint]);

  // The element's own clock drives the bar: a frame loop while it plays,
  // one paint on every event that moves it while it does not.
  useEffect(() => {
    if (video === null) return;
    let frame: number | null = null;
    const loop = () => {
      paintFromVideo();
      frame = window.requestAnimationFrame(loop);
    };
    const start = () => {
      if (frame === null) frame = window.requestAnimationFrame(loop);
    };
    const stop = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      paintFromVideo();
    };
    if (!video.paused) start();
    else paintFromVideo();
    video.addEventListener("play", start);
    video.addEventListener("playing", start);
    video.addEventListener("pause", stop);
    video.addEventListener("seeked", paintFromVideo);
    video.addEventListener("loadedmetadata", paintFromVideo);
    video.addEventListener("progress", paintFromVideo);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      video.removeEventListener("play", start);
      video.removeEventListener("playing", start);
      video.removeEventListener("pause", stop);
      video.removeEventListener("seeked", paintFromVideo);
      video.removeEventListener("loadedmetadata", paintFromVideo);
      video.removeEventListener("progress", paintFromVideo);
    };
  }, [video, paintFromVideo]);

  const ratioAt = (clientX: number): number => {
    const box = rootRef.current?.getBoundingClientRect();
    if (box === undefined || box.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width));
  };

  /** Seek once per frame at most while dragging: a decoder is not a pen. */
  const seekTo = (ratio: number) => {
    pendingRatio.current = ratio;
    if (seekFrame.current !== null) return;
    seekFrame.current = window.requestAnimationFrame(() => {
      seekFrame.current = null;
      const target = pendingRatio.current;
      if (video === null || target === null) return;
      const duration = durationOf(video, durationSeconds);
      if (duration <= 0) return;
      jumpTo(
        video,
        Math.min(target * duration, duration - 0.05),
        draggingRef.current,
      );
    });
  };
  useEffect(
    () => () => {
      if (seekFrame.current !== null) {
        window.cancelAnimationFrame(seekFrame.current);
      }
    },
    [],
  );

  // The readout mounts with the drag; show where the finger is at once.
  useEffect(() => {
    if (dragging && pendingRatio.current !== null) {
      paint(pendingRatio.current, 0);
    }
  }, [dragging, paint]);

  const setDrag = (on: boolean) => {
    draggingRef.current = on;
    setDragging(on);
    onScrubbingChange?.(on);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (video === null || !event.isPrimary) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resumeAfter.current = !video.paused;
    if (!video.paused) video.pause();
    setDrag(true);
    const ratio = ratioAt(event.clientX);
    paint(ratio, 0);
    seekTo(ratio);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    event.stopPropagation();
    const ratio = ratioAt(event.clientX);
    paint(ratio, 0);
    seekTo(ratio);
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    event.stopPropagation();
    const ratio = ratioAt(event.clientX);
    setDrag(false);
    if (video !== null) {
      const duration = durationOf(video, durationSeconds);
      if (duration > 0) {
        // The exact frame where the finger let go, not the keyframe.
        jumpTo(video, Math.min(ratio * duration, duration - 0.05));
      }
      if (resumeAfter.current) void video.play().catch(() => undefined);
    }
    resumeAfter.current = false;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (video === null) return;
    const duration = durationOf(video, durationSeconds);
    let handled = true;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      seekBy(video, -SEEK_STEP_SECONDS, durationSeconds);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      seekBy(video, SEEK_STEP_SECONDS, durationSeconds);
    } else if (event.key === "PageDown") {
      seekBy(video, -duration / 10, durationSeconds);
    } else if (event.key === "PageUp") {
      seekBy(video, duration / 10, durationSeconds);
    } else if (event.key === "Home") {
      jumpTo(video, 0);
    } else if (event.key === "End" && duration > 0) {
      jumpTo(video, duration - 0.05);
    } else {
      handled = false;
    }
    if (handled) {
      // The slider's keys are the slider's: the feed must not also move.
      event.preventDefault();
      event.stopPropagation();
      paintFromVideo();
    }
  };

  const state = dragging ? "dragging" : paused ? "paused" : "playing";
  const total =
    video === null
      ? (durationSeconds ?? 0)
      : durationOf(video, durationSeconds);

  return (
    <div
      ref={rootRef}
      className="cq-scrubber"
      data-state={state}
      role="slider"
      tabIndex={video === null ? -1 : 0}
      aria-label={`Position in ${companyName}'s pitch`}
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={0}
      aria-valuetext={`0:00 of ${formatTime(total)}`}
      aria-disabled={video === null}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      // Its gestures are its own: the feed must not swipe, pause or move.
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      data-pitch-scrubber
    >
      <div className="cq-scrubber-track" aria-hidden="true">
        <div ref={bufferRef} className="cq-scrubber-buffered" />
        <div ref={fillRef} className="cq-scrubber-fill" />
        <div ref={thumbRef} className="cq-scrubber-thumb" />
      </div>
      {dragging ? (
        <div className="cq-scrubber-readout" aria-hidden="true">
          <span ref={readoutRef} className="cq-scrubber-now">
            0:00
          </span>
          <span className="cq-scrubber-total"> / {formatTime(total)}</span>
        </div>
      ) : null}
    </div>
  );
}
