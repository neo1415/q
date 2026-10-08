"use client";

import { useEffect, useRef } from "react";

import type { QRoomEntry, QRoomRead } from "@capital-q/contracts";

/**
 * voice-cards: the person's Q room feed, read in the browser.
 *
 * The Q API publishes every run's answer -- typed, spoken, or asked by
 * the duplex line's ask_q -- to the person's room; this reads it while a
 * voice line is open and hands each new answer over once, in order,
 * keyed by its message. The screen renders cards from what arrives here,
 * so nothing depends on the voice model or a transcript carrying them.
 */

export const ROOM_FEED_PATH = "/api/q-room";
/** After a failed read, the next one waits this long. */
export const ROOM_RETRY_MS = 2_000;
/**
 * A first read hands over answers this recent: one that landed while the
 * page was changing under a live line is not lost; older ones are history
 * the conversation already shows.
 */
export const ROOM_RECENT_MS = 45_000;

export type RoomRead = (input: {
  readonly after: number;
  readonly epoch: string | undefined;
  readonly wait: boolean;
  readonly signal: AbortSignal;
}) => Promise<QRoomRead | null>;

export type RoomFeedReader = { readonly stop: () => void };

/** The loop, without React: tested with a fake read and a fake clock. */
export function startRoomFeed(options: {
  readonly read: RoomRead;
  readonly onEntries: (entries: readonly QRoomEntry[]) => void;
  readonly now?: (() => number) | undefined;
  readonly wait?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
  /** Answers already handed over (shared across restarts of the reader). */
  readonly seen?: Set<string> | undefined;
}): RoomFeedReader {
  const controller = new AbortController();
  const now = options.now ?? Date.now;
  const seen = options.seen ?? new Set<string>();
  const pause =
    options.wait ??
    ((ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      }));
  const startedAt = now();

  void (async () => {
    let epoch: string | undefined;
    let cursor = 0;
    let first = true;
    while (!controller.signal.aborted) {
      let read: QRoomRead | null;
      try {
        read = await options.read({
          after: cursor,
          epoch,
          wait: !first,
          signal: controller.signal,
        });
      } catch {
        read = null;
      }
      if (controller.signal.aborted) return;
      if (read === null) {
        await pause(ROOM_RETRY_MS, controller.signal);
        continue;
      }
      // A different process: its sequence starts again from its own 0.
      const restarted = epoch !== undefined && read.epoch !== epoch;
      const opening = first || restarted;
      epoch = read.epoch;
      cursor = read.cursor;
      first = false;
      const fresh = [...read.entries]
        .sort((a, b) => a.sequence - b.sequence)
        .filter((entry) => {
          if (seen.has(entry.message.messageId)) return false;
          // A first read: only what landed around the time it opened.
          if (opening) {
            const at = Date.parse(entry.message.createdAt);
            if (Number.isFinite(at) && at < startedAt - ROOM_RECENT_MS) {
              seen.add(entry.message.messageId);
              return false;
            }
          }
          return true;
        });
      for (const entry of fresh) seen.add(entry.message.messageId);
      if (fresh.length > 0) options.onEntries(fresh);
    }
  })();

  return { stop: () => controller.abort() };
}

/** The browser's read: the same-origin route, under the session cookie. */
export const fetchRoomRead: RoomRead = async ({
  after,
  epoch,
  wait,
  signal,
}) => {
  const query = new URLSearchParams({
    after: String(after),
    wait: wait ? "1" : "0",
    ...(epoch === undefined ? {} : { epoch }),
  });
  const response = await fetch(`${ROOM_FEED_PATH}?${query.toString()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  // The same-origin route parsed the Q API's answer against the room
  // contract on the server (api-client `call`); here only the shape the
  // loop relies on, so the contracts stay out of every page's bundle.
  if (
    typeof body !== "object" ||
    body === null ||
    !("epoch" in body) ||
    !("cursor" in body) ||
    !("entries" in body) ||
    typeof body.epoch !== "string" ||
    typeof body.cursor !== "number" ||
    !Array.isArray(body.entries)
  ) {
    return null;
  }
  return body as QRoomRead;
};

/**
 * Read the room while `active`, handing each new answer to `onEntries`.
 * Answers are remembered across a line ending and starting again, so the
 * same one is never handed over twice in this page's life.
 */
export function useQRoomFeed(
  active: boolean,
  onEntries: (entries: readonly QRoomEntry[]) => void,
  read: RoomRead = fetchRoomRead,
): void {
  const handler = useRef(onEntries);
  useEffect(() => {
    handler.current = onEntries;
  }, [onEntries]);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!active) return;
    const reader = startRoomFeed({
      read,
      seen: seen.current,
      onEntries: (entries) => handler.current(entries),
    });
    return () => reader.stop();
  }, [active, read]);
}
