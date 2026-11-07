"use client";

import { useEffect, useRef, type RefObject } from "react";

import { engagementReporter } from "./engagement-reporter";

/**
 * Q Workspace §8 A1 collection points. Each reports what was on the
 * person's screen through the one batched reporter: no await, no retry,
 * nothing in the swipe or click path. The server decides whether a view
 * counts (the company's own team never does) and who may see it.
 */

/** Shorter than this on a slide is a flick past it, not reading. */
const SLIDE_DWELL_MIN_MS = 1_000;

/** A deck opened by a reader: the open, then time on each slide. */
export function useDeckEngagement(input: {
  readonly enabled: boolean;
  readonly companyId: string;
  readonly documentId: string;
  readonly slide: number;
}): void {
  const { enabled, companyId, documentId, slide } = input;
  const opened = useRef(false);
  useEffect(() => {
    if (!enabled || opened.current) return;
    opened.current = true;
    engagementReporter().report({ type: "DECK_OPEN", companyId, documentId });
  }, [enabled, companyId, documentId]);

  useEffect(() => {
    if (!enabled) return;
    const reporter = engagementReporter();
    let stop = reporter.dwell((durationMs) =>
      durationMs < SLIDE_DWELL_MIN_MS
        ? null
        : {
            type: "DECK_SLIDE_DWELL",
            companyId,
            documentId,
            slideNumber: slide,
            durationMs,
          },
    );
    // A hidden tab is not reading: close the slide's time there, and start
    // it again when the page comes back.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        stop = reporter.dwell((durationMs) =>
          durationMs < SLIDE_DWELL_MIN_MS
            ? null
            : {
                type: "DECK_SLIDE_DWELL",
                companyId,
                documentId,
                slideNumber: slide,
                durationMs,
              },
        );
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [enabled, companyId, documentId, slide]);
}

/** A pitch video watched: time played, and how far it got. */
export function useWatchEngagement(input: {
  readonly video: RefObject<HTMLVideoElement | null>;
  readonly playing: boolean;
  readonly companyId: string;
  readonly mediaAssetId: string | null;
}): void {
  const { video, playing, companyId, mediaAssetId } = input;
  useEffect(() => {
    const element = video.current;
    if (!playing || element === null || mediaAssetId === null) return;
    let furthest = element.currentTime;
    const onTime = () => {
      furthest = Math.max(furthest, element.currentTime);
    };
    element.addEventListener("timeupdate", onTime);
    const stop = engagementReporter().dwell((durationMs) => {
      if (durationMs < SLIDE_DWELL_MIN_MS) return null;
      const length = element.duration;
      return {
        type: "VIDEO_WATCH",
        companyId,
        mediaAssetId,
        durationMs,
        maxPositionMs: Math.round(furthest * 1000),
        ...(Number.isFinite(length) && length > 0
          ? { mediaDurationMs: Math.round(length * 1000) }
          : {}),
      };
    });
    return () => {
      element.removeEventListener("timeupdate", onTime);
      stop();
    };
  }, [video, playing, companyId, mediaAssetId]);
}

/** One data-room document opened by a reader. */
export function reportDataRoomView(companyId: string, documentId: string) {
  engagementReporter().report({
    type: "DATA_ROOM_DOCUMENT_VIEW",
    companyId,
    documentId,
  });
}
