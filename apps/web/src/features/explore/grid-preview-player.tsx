"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { PlaybackAuthorizationDto } from "@capital-q/contracts";

import {
  claimActivePlayer,
  releaseActivePlayer,
} from "../discover/player/active-player";
import {
  attachHlsOrNativeSource,
  restartPitch,
} from "../discover/player/hls-source";
import { isPlaybackUsable } from "../discover/player/pitch-playback";
import { useReducedMotionPreference } from "../discover/player/use-pitch-playback";

import {
  HOVER_DWELL_MS,
  chooseActivePreview,
  createPreviewGrants,
  linkIsConstrained,
  type LinkInfo,
} from "./grid-preview";

/**
 * The grid's one preview player (owner 2026-10-16) and the controller that
 * picks its tile. The controller is the only thing that decides; a tile
 * renders a `<video>` only while it is the chosen one, so the page never
 * holds more than one grid player, and that one claims the page's active
 * player slot (R36), so it also yields to the opened pitch.
 */

/**
 * One grant cache per authorizer, for the life of the page: revisiting a
 * tile reuses its grant, and at most one request is ever in flight.
 */
const grantCaches = new WeakMap<
  AuthorizePreview,
  ReturnType<typeof createPreviewGrants<PlaybackAuthorizationDto>>
>();
export function previewGrantsFor(
  authorize: AuthorizePreview,
): ReturnType<typeof createPreviewGrants<PlaybackAuthorizationDto>> {
  let grants = grantCaches.get(authorize);
  if (grants === undefined) {
    grants = createPreviewGrants(authorize);
    grantCaches.set(authorize, grants);
  }
  return grants;
}

export type AuthorizePreview = (
  companyId: string,
  mediaAssetId: string,
) => Promise<PlaybackAuthorizationDto>;

const THRESHOLDS = [0, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];

function readLink(): LinkInfo | undefined {
  if (typeof navigator === "undefined") return undefined;
  const value: unknown = Reflect.get(navigator, "connection");
  return typeof value === "object" && value !== null ? value : undefined;
}

function canHoverNow(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches
    );
  } catch {
    return false;
  }
}

type ChangeSource = {
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

function subscribeLink(onChange: () => void): () => void {
  const link = readLink() as ChangeSource | undefined;
  link?.addEventListener?.("change", onChange);
  return () => link?.removeEventListener?.("change", onChange);
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function subscribePointer(onChange: () => void): () => void {
  try {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  } catch {
    return () => undefined;
  }
}

/**
 * Watches the grid's tiles under `host` and answers which one previews.
 * `order` is the tiles' media asset ids in rank order.
 */
export function useGridPreview(
  host: React.RefObject<HTMLElement | null>,
  order: readonly string[],
  suspended: boolean,
): {
  readonly active: string | null;
  /** A mouse entered this tile: it takes over after HOVER_DWELL_MS. */
  readonly hover: (mediaAssetId: string) => void;
  /** The mouse left this tile: a takeover still waiting is dropped. */
  readonly leave: (mediaAssetId: string) => void;
} {
  const reducedMotion = useReducedMotionPreference();
  const canHover = useSyncExternalStore(
    subscribePointer,
    canHoverNow,
    () => false,
  );
  const constrained = useSyncExternalStore(
    subscribeLink,
    () => linkIsConstrained(readLink()),
    () => false,
  );
  const hidden = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "hidden",
    () => false,
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const [visible, setVisible] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );

  // How much of each tile is on screen.
  const orderKey = order.join(",");
  useEffect(() => {
    const root = host.current;
    if (root === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((known) => {
          const next = new Map(known);
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset["exploreTile"];
            if (id === undefined) continue;
            if (entry.isIntersecting) next.set(id, entry.intersectionRatio);
            else next.delete(id);
          }
          return next;
        });
      },
      { threshold: THRESHOLDS },
    );
    for (const cell of root.querySelectorAll<HTMLElement>(
      "[data-explore-tile]",
    )) {
      observer.observe(cell);
    }
    return () => observer.disconnect();
  }, [host, orderKey]);

  const active = chooseActivePreview({
    order,
    visible,
    hovered,
    canHover,
    reducedMotion,
    constrained,
    suspended: suspended || hidden,
  });

  // A resting pointer, not a pass across the grid: the takeover waits.
  const dwell = useRef<{
    readonly id: string;
    readonly timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  useEffect(
    () => () => {
      if (dwell.current !== null) clearTimeout(dwell.current.timer);
    },
    [],
  );
  const hover = useCallback((mediaAssetId: string) => {
    if (dwell.current !== null) clearTimeout(dwell.current.timer);
    dwell.current = {
      id: mediaAssetId,
      timer: setTimeout(() => {
        dwell.current = null;
        setHovered(mediaAssetId);
      }, HOVER_DWELL_MS),
    };
  }, []);
  const leave = useCallback((mediaAssetId: string) => {
    if (dwell.current?.id !== mediaAssetId) return;
    clearTimeout(dwell.current.timer);
    dwell.current = null;
  }, []);
  return { active, hover, leave };
}

/**
 * The preview itself: muted, inline, looping, never audible. The source is
 * attached only now, from a fresh signed grant (the same one the pitch
 * view asks for), so the bytes come straight from the video CDN. It stays
 * transparent over the poster until it is actually playing, so there is
 * no flash and no shift.
 */
export function GridPreviewVideo({
  companyId,
  mediaAssetId,
  authorize,
}: {
  readonly companyId: string;
  readonly mediaAssetId: string;
  readonly authorize: AuthorizePreview;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (video === null) return;
    // The property, not only the attribute: React does not reflect `muted`.
    video.muted = true;
    video.volume = 0;
    let cancelled = false;
    let detach: (() => void) | null = null;
    const start = () => {
      if (!cancelled) void video.play().catch(() => undefined);
    };
    const onPlay = () => claimActivePlayer(video);
    const onPlaying = () => setReady(true);
    // A streamed source turns the element's own `loop` off (an MSE loop
    // seeks to exactly 0; see loopStart), so the end restarts it, as the
    // pitch player does.
    const onEnded = () => restartPitch(video);
    video.addEventListener("canplay", start);
    video.addEventListener("play", onPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("ended", onEnded);
    previewGrantsFor(authorize)(companyId, mediaAssetId).then(
      (grant) => {
        if (cancelled || !isPlaybackUsable(grant, Date.now())) return;
        detach = attachHlsOrNativeSource(
          video,
          grant.playbackUrl,
          mediaAssetId,
        );
        start();
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      video.removeEventListener("canplay", start);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("ended", onEnded);
      video.pause();
      detach?.();
      releaseActivePlayer(video);
    };
  }, [authorize, companyId, mediaAssetId]);
  return (
    <video
      ref={ref}
      className="cq-explore-preview"
      data-ready={ready ? "true" : "false"}
      data-explore-preview={mediaAssetId}
      muted
      playsInline
      loop
      preload="none"
      disablePictureInPicture
      disableRemotePlayback
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
