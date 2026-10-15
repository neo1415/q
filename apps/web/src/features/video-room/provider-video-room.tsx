"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@capital-q/ui/button";

/**
 * Capital Q's own video room shell (directive C3), shared by Rehearsals and
 * the GateQ video interview. The provider's private room is embedded as an
 * iframe inside an owned, bounded tile; everything around it (title,
 * disclosure, time left, the way out, the fallback, a side panel) is ours.
 * Session state, transcript and canonical interview state never live here:
 * the caller owns them and is told only "end" or "fall back".
 *
 * The time limit is the server's. The countdown is a courtesy; at zero the
 * room asks the caller to end (the server ends it regardless).
 */
/**
 * The room URL with the participant's own name, so Daily Prebuilt joins them
 * directly instead of stopping on "Enter your name" (its `name` parameter;
 * `userName` is ignored, checked in a production test-mode room). Only the
 * provider's room is touched; a blank name leaves the URL as it was.
 */
export function joinUrlWithName(
  joinUrl: string | null,
  name: string,
): string | null {
  const display = name.trim().slice(0, 60);
  if (joinUrl === null || display === "") return joinUrl;
  try {
    const url = new URL(joinUrl);
    url.searchParams.set("name", display);
    return url.toString();
  } catch {
    return joinUrl;
  }
}

const JOINING_MS = 30_000;

export type ProviderVideoRoomProps = {
  readonly title: string;
  /** Plain AI/recording disclosure, always visible. */
  readonly disclosure: string;
  /** The provider's private join link; null when it cannot be rejoined here. */
  readonly joinUrl: string | null;
  /** Shown in the room as this person; skips the provider's name prompt. */
  readonly participantName?: string | undefined;
  /** Accessible name of the provider tile. */
  readonly tileLabel: string;
  readonly endsAt: string;
  readonly maxSeconds: number;
  /** The primary way out, e.g. "End and see my review". */
  readonly endLabel: string;
  /** The typed or voice fallback, e.g. "Carry on by voice instead". */
  readonly fallbackLabel: string;
  /** Caller ends the session; `fallback` true continues without video. */
  readonly onEnd: (fallback: boolean) => Promise<{ readonly message?: string }>;
  readonly closingNote: string;
  /**
   * Shown while the provider's interviewer is still joining. Its face takes
   * about 20 seconds to appear (production, 2026-10-15); an unexplained
   * room with only your own camera reads as a broken, blank call.
   */
  readonly joiningNote?: string | undefined;
  /** Shown in the last 30 seconds. */
  readonly closingSoonNote?: string | undefined;
  readonly unavailableNote: ReactNode;
  readonly footnote?: ReactNode;
  /** Live transcript / coverage beside the tile (below it on small screens). */
  readonly aside?: ReactNode;
};

export function ProviderVideoRoom(props: ProviderVideoRoomProps) {
  const endsAt = Date.parse(props.endsAt);
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.ceil((endsAt - Date.now()) / 1_000)),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [joining, setJoining] = useState(true);
  const [ending, setEnding] = useState(false);
  const ended = useRef(false);
  const onEnd = useRef(props.onEnd);
  useEffect(() => {
    onEnd.current = props.onEnd;
  });

  const end = (fallback: boolean) => {
    if (ended.current) return;
    ended.current = true;
    setMessage(null);
    setEnding(true);
    void onEnd
      .current(fallback)
      .then((result) => {
        if (result.message !== undefined) {
          ended.current = false;
          setMessage(result.message);
        }
      })
      .catch(() => {
        ended.current = false;
        setMessage("That didn't go through. Try again.");
      })
      .finally(() => setEnding(false));
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setJoining(false), JOINING_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1_000));
      setLeft(seconds);
      if (seconds === 0) {
        window.clearInterval(timer);
        end(false);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
    // `end` guards itself with a ref and reads the latest callback.
  }, [endsAt]);

  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");

  const tile =
    left === 0 ? (
      <div
        role="status"
        className="cq-stage flex min-h-80 flex-1 items-center justify-center rounded-(--cq-radius-xl) p-8 text-center"
      >
        {props.closingNote}
      </div>
    ) : props.joinUrl === null ? (
      <div className="cq-stage flex min-h-80 flex-1 flex-col items-center justify-center gap-3 rounded-(--cq-radius-xl) p-8 text-center">
        {props.unavailableNote}
      </div>
    ) : (
      // A floor keeps the room usable on a landscape phone, where the
      // controls and footnote would otherwise squeeze it to a sliver.
      <div className="cq-stage relative min-h-60 flex-1 overflow-hidden rounded-(--cq-radius-xl)">
        <iframe
          src={
            joinUrlWithName(props.joinUrl, props.participantName ?? "") ??
            undefined
          }
          title={props.tileLabel}
          allow="camera; microphone; autoplay; display-capture; fullscreen"
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full border-0"
        />
      </div>
    );

  return (
    <section
      className="cq-stage fixed inset-0 z-(--cq-z-modal) flex flex-col gap-4 overflow-y-auto p-4 sm:p-6"
      data-video-room
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="cq-title-md text-(--cq-text-primary)">
            {props.title}
          </h1>
          <p className="cq-caption text-(--cq-text-secondary)">
            {props.disclosure}
          </p>
        </div>
        <p
          className="cq-label text-(--cq-text-primary) tabular-nums"
          aria-live="off"
        >
          <span className="sr-only">Time left: </span>
          {minutes}:{seconds}
        </p>
      </div>

      {props.aside === undefined ? (
        tile
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <div className="flex min-h-80 flex-1 flex-col">{tile}</div>
          <div className="lg:w-80 lg:shrink-0 lg:overflow-y-auto">
            {props.aside}
          </div>
        </div>
      )}

      {joining &&
      left > 0 &&
      props.joinUrl !== null &&
      props.joiningNote !== undefined ? (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {props.joiningNote}
        </p>
      ) : null}

      {left > 0 && left <= 30 ? (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {props.closingSoonNote ??
            "We’re closing shortly. Finish your last point."}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="large"
          onClick={() => end(false)}
          disabled={ending}
        >
          {ending ? "Ending…" : props.endLabel}
        </Button>
        <Button variant="secondary" onClick={() => end(true)} disabled={ending}>
          {props.fallbackLabel}
        </Button>
      </div>
      {props.footnote === undefined ? null : (
        <p className="cq-caption text-(--cq-text-tertiary)">{props.footnote}</p>
      )}
      {message === null ? null : (
        <p role="alert" className="cq-body-sm text-(--cq-text-secondary)">
          {message}
        </p>
      )}
      <span className="sr-only">
        Calls last up to {Math.round(props.maxSeconds / 60)} minutes.
      </span>
    </section>
  );
}
