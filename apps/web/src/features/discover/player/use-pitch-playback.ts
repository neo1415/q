"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { PlaybackAuthorizationDto } from "@capital-q/contracts";

import type { FeedPreloadPolicy } from "../feed/feed-state";
import {
  PLAYBACK_EXPIRY_SKEW_MS,
  isPlaybackUsable,
  playbackIntentFor,
  type PitchPlaybackIntent,
  type PlaybackSource,
} from "./pitch-playback";

/**
 * One card's playback state (CQ-WEB-021).
 *
 * The controller says what tier this card is in; this hook turns that into
 * an authorization when one is needed and keeps it fresh. It deliberately
 * holds no opinion about which card is active — that belongs to the feed
 * controller, and a player that decided for itself is how a feed ends up
 * with two of them playing.
 */

/** `window.matchMedia`, injectable so the preference can be asserted. */
export function prefersReducedMotion(): boolean {
  try {
    // `typeof` and not `in`: a host can expose `matchMedia` as a property
    // that is not callable (jsdom does), and `in` says yes to that.
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return false;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * How many times one card may ask before it stops asking.
 *
 * Three covers a genuinely short-lived first answer and a retry; beyond
 * that the server is returning something this client cannot use, and
 * saying so is better than a quiet loop against the playback endpoint.
 */
const MAX_AUTHORIZATION_ATTEMPTS = 3;

export type UsePitchPlaybackOptions = {
  /** Null when the company has no playable pitch; the hook then does nothing. */
  readonly mediaAssetId: string | null;
  readonly policy: FeedPreloadPolicy;
  readonly authorize: PlaybackSource;
  readonly reducedMotion: boolean;
  /** Injectable clock, so expiry is tested without waiting for it. */
  readonly now?: () => number;
};

export type PitchPlayback = {
  readonly intent: PitchPlaybackIntent;
  readonly posterUrl: string | null;
  /** Present only when the intent says to attach one. */
  readonly playbackUrl: string | null;
  readonly isAuthorizing: boolean;
  /** The authorization was refused or failed; the card shows a poster-less still. */
  readonly failed: boolean;
};

export function usePitchPlayback(
  options: UsePitchPlaybackOptions,
): PitchPlayback {
  const {
    mediaAssetId,
    policy,
    authorize,
    reducedMotion,
    now = Date.now,
  } = options;

  /**
   * State is stored against the asset it describes, never bare.
   *
   * An authorization is per-viewer, per-asset and short-lived. Holding it
   * bare and clearing it when the card changes would work until the clear
   * lagged a render, and for that one render the previous company's
   * playback URL would be attached to this company's element. Tagging it
   * instead makes the stale value unreadable rather than merely tidied up:
   * if the tag does not match, there is no authorization, full stop.
   */
  const [held, setHeld] = useState<{
    readonly mediaAssetId: string;
    readonly authorization: PlaybackAuthorizationDto;
  } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [authorizingFor, setAuthorizingFor] = useState<string | null>(null);

  const authorization =
    held !== null && held.mediaAssetId === mediaAssetId
      ? held.authorization
      : null;
  const failed = refused !== null && refused === mediaAssetId;
  const isAuthorizing =
    authorizingFor !== null && authorizingFor === mediaAssetId;

  const intent = useMemo(
    () => playbackIntentFor(policy, { reducedMotion }),
    [policy, reducedMotion],
  );

  const authorizeRef = useRef(authorize);
  const nowRef = useRef(now);
  /**
   * In-flight tracking lives in a ref, not in the dependency array.
   *
   * `isAuthorizing` is state because the UI reports it, but it must not
   * also gate the effect: setting it re-renders, the dependency changes,
   * the cleanup marks the request cancelled, and the response it was
   * waiting for is thrown away -- a request that cancels itself and never
   * retries, because on re-entry the guard it just set turns it back.
   */
  const authorizingRef = useRef<object | null>(null);
  /**
   * A bound on re-asking. An authorization that arrives already inside the
   * expiry margin makes `usable` false immediately, which is a legitimate
   * reason to ask once more and an illegitimate reason to ask forever.
   */
  const attemptsRef = useRef<{ mediaAssetId: string | null; count: number }>({
    mediaAssetId: null,
    count: 0,
  });
  useEffect(() => {
    authorizeRef.current = authorize;
    nowRef.current = now;
  }, [authorize, now]);

  const usable = isPlaybackUsable(authorization, now());
  const wanted = intent.authorize && mediaAssetId !== null;

  useEffect(() => {
    if (!wanted || usable || failed || authorizingRef.current !== null) {
      return;
    }
    if (mediaAssetId === null) return;

    // The attempt budget belongs to one asset; a new card starts fresh.
    const attempts = attemptsRef.current;
    if (attempts.mediaAssetId !== mediaAssetId) {
      attemptsRef.current = { mediaAssetId, count: 0 };
    }
    if (attemptsRef.current.count >= MAX_AUTHORIZATION_ATTEMPTS) {
      setRefused(mediaAssetId);
      return;
    }

    let cancelled = false;
    const request = {};
    authorizingRef.current = request;
    attemptsRef.current = {
      mediaAssetId,
      count: attemptsRef.current.count + 1,
    };
    setAuthorizingFor(mediaAssetId);

    authorizeRef
      .current(mediaAssetId)
      .then((fresh) => {
        if (cancelled) return;
        setHeld({ mediaAssetId, authorization: fresh });
      })
      .catch(() => {
        if (cancelled) return;
        // No silent retry loop: a refused authorization is an answer, and
        // hammering the endpoint would turn one refusal into many.
        setRefused(mediaAssetId);
      })
      .finally(() => {
        // Only the request that still holds the slot releases it; a
        // cancelled one already gave it up.
        if (authorizingRef.current === request) authorizingRef.current = null;
        if (!cancelled) setAuthorizingFor(null);
      });

    return () => {
      cancelled = true;
      // A cancelled request's answer is thrown away, so it must not keep
      // the slot either. It used to: the effect re-ran (a dependency
      // changed, or React's development double-run of effects), found the
      // slot still taken and returned, and the cancelled answer then set
      // nothing and triggered no render. Nothing ever asked again, and an
      // investor's feed showed a grey box where an authorised pitch should
      // play (CQ-ACCEPT-001, C7).
      if (authorizingRef.current === request) authorizingRef.current = null;
    };
    // `authorization` and not only `usable`: an answer that arrives
    // already inside the expiry margin leaves `usable` false, so keying on
    // the derived boolean alone would see no change and never ask again --
    // the card would sit on a dead URL forever. The attempt cap is what
    // keeps re-asking from becoming a loop.
  }, [wanted, usable, failed, mediaAssetId, authorization]);

  /**
   * Re-authorise before the URL dies rather than after it fails.
   *
   * Without this the only thing that would notice an expiry is the media
   * element, and by then the person is watching an error.
   */
  useEffect(() => {
    if (authorization === null || !wanted || mediaAssetId === null) return;
    const expiresInMs = Date.parse(authorization.expiresAt) - nowRef.current();
    if (Number.isNaN(expiresInMs)) return;

    const timer = setTimeout(
      () =>
        setHeld((current) =>
          current !== null && current.mediaAssetId === mediaAssetId
            ? null
            : current,
        ),
      Math.max(expiresInMs - PLAYBACK_EXPIRY_SKEW_MS, 0),
    );
    return () => clearTimeout(timer);
  }, [authorization, wanted, mediaAssetId]);

  const fresh = isPlaybackUsable(authorization, now());

  return {
    intent,
    posterUrl: fresh ? (authorization?.posterUrl ?? null) : null,
    playbackUrl:
      fresh && intent.attach ? (authorization?.playbackUrl ?? null) : null,
    isAuthorizing,
    failed,
  };
}

function subscribeToReducedMotion(onChange: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => undefined;
  }
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Convenience for a caller that has no reason to inject the preference.
 *
 * `useSyncExternalStore` rather than an effect that sets state: the media
 * query is an external store, the server snapshot is a definite `false`
 * (there is no media query to ask), and React reconciles the real value on
 * hydration without a mismatch or an extra render pass.
 */
export function useReducedMotionPreference(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    prefersReducedMotion,
    () => false,
  );
}

export type { PitchPlaybackIntent, PlaybackSource };
