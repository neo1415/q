import { randomUUID } from "node:crypto";

import {
  Q_ROOM_HOLD_MS,
  Q_ROOM_KEPT,
  Q_ROOM_PREVIEW_MS,
  QRunIdSchema,
  type QArtifactPreview,
  type CorrelationId,
  type QResponseMessage,
  type QRoomEntry,
  type QRoomPreview,
  type QRoomRead,
  type QRoomSource,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { QRunStreamService } from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

/**
 * The person's Q room feed (voice-cards, founder 2026-10-08).
 *
 * Root cause it removes: a spoken answer's cards reached the screen only
 * if the browser, on its own, worked out which conversation a voice turn
 * landed in and re-read it at the right moment (voice turn board sequence
 * -> conversation id -> a guarded re-read that is skipped while the page
 * thinks a run is still in flight). On the duplex line the run is started
 * by the server inside ask_q, so the browser never held its run id and
 * every link of that chain was a guess; live 2026-10-08 the run stored ten
 * cards and none were shown.
 *
 * Now the server is the single source: every Q run that finishes with an
 * answer is published here as it completes -- voice runs (standard or
 * duplex ask_q) by the voice turn handler, which already follows the run's
 * stream; typed runs by `watchRun` while the person has a reader open --
 * and the browser renders from it, keyed by run, de-duplicated, in order.
 *
 * Process-local and forgettable, like the voice turn board and the duplex
 * lines it sits beside: the epoch names this process, so a reader whose
 * epoch changed starts again. Nothing here is authority; an entry is the
 * person's own recorded answer, read back under their own session.
 */

export type QRoomPublish = {
  readonly runId: string;
  readonly conversationId: string | null;
  readonly source: QRoomSource;
  readonly message: QResponseMessage;
};

export type QRoomFeed = {
  readonly epoch: string;
  readonly publish: (actor: ActorContext, entry: QRoomPublish) => void;
  /**
   * Artifacts live on a voice line: the cards for what Q is saying now,
   * before its answer lands. Replaces the last one; dropped when that
   * run's answer is published.
   */
  readonly preview: (
    actor: ActorContext,
    input: { readonly runId: string; readonly preview: QArtifactPreview },
  ) => void;
  /** Entries after `after`; held up to `holdMs` for the next when none. */
  readonly read: (input: {
    readonly actor: ActorContext;
    readonly after: number;
    readonly epoch?: string | undefined;
    readonly wait: boolean;
    readonly signal?: AbortSignal | undefined;
    readonly holdMs?: number | undefined;
  }) => Promise<QRoomRead>;
  /** A reader is open (or was, in the last minute) for this person. */
  readonly watched: (actor: ActorContext) => boolean;
  /**
   * Follow a typed run to its answer and publish it, when the person has
   * a reader open; nothing otherwise (their own page streams it already).
   */
  readonly watchRun: (input: {
    readonly actor: ActorContext;
    readonly runId: string;
    readonly conversationId: string | null;
    readonly correlationId?: CorrelationId | undefined;
  }) => void;
};

type Room = {
  sequence: number;
  readonly entries: QRoomEntry[];
  /** The live spoken preview and when it was set. */
  live: { readonly preview: QRoomPreview; readonly at: number } | null;
  readonly listeners: Set<() => void>;
  lastReadAt: number;
  readers: number;
};

/** A reader that read within this long still counts as watching. */
const WATCHING_MS = 60_000;
/** A typed run followed for at most this long. */
const WATCH_RUN_MS = 5 * 60_000;
/** Rooms nobody has read or written for this long are forgotten. */
const FORGET_MS = 2 * 60 * 60_000;

const keyOf = (actor: ActorContext) => `${actor.tenantId}:${actor.userId}`;

export function createQRoomFeed(
  dependencies: {
    readonly qStream?: QRunStreamService | undefined;
    readonly logger?: Logger | undefined;
    readonly now?: (() => number) | undefined;
  } = {},
): QRoomFeed {
  const now = dependencies.now ?? Date.now;
  const epoch = randomUUID();
  const rooms = new Map<string, Room>();

  const roomOf = (actor: ActorContext): Room => {
    const key = keyOf(actor);
    let room = rooms.get(key);
    if (room === undefined) {
      const at = now();
      for (const [other, old] of rooms) {
        if (old.readers === 0 && at - old.lastReadAt > FORGET_MS) {
          rooms.delete(other);
        }
      }
      room = {
        sequence: 0,
        entries: [],
        live: null,
        listeners: new Set(),
        lastReadAt: 0,
        readers: 0,
      };
      rooms.set(key, room);
    }
    return room;
  };

  const after = (room: Room, cursor: number) =>
    room.entries.filter((entry) => entry.sequence > cursor);
  /** The live preview, when it is newer than the cursor and still fresh. */
  const liveAfter = (room: Room, cursor: number): QRoomPreview | undefined =>
    room.live !== null &&
    room.live.preview.sequence > cursor &&
    now() - room.live.at <= Q_ROOM_PREVIEW_MS
      ? room.live.preview
      : undefined;

  const publish: QRoomFeed["publish"] = (actor, entry) => {
    const room = roomOf(actor);
    // One entry per answer: a run's answer published twice (the voice
    // handler and a watcher) is published once.
    if (
      room.entries.some(
        (one) => one.message.messageId === entry.message.messageId,
      )
    ) {
      return;
    }
    room.sequence += 1;
    room.entries.push({
      sequence: room.sequence,
      runId: QRunIdSchema.parse(entry.runId),
      conversationId: entry.conversationId as QRoomEntry["conversationId"],
      source: entry.source,
      message: entry.message,
    });
    room.entries.splice(0, Math.max(0, room.entries.length - Q_ROOM_KEPT));
    // The answer's blocks win: its preview is done.
    if (room.live?.preview.runId === entry.runId) room.live = null;
    room.lastReadAt = Math.max(room.lastReadAt, now());
    for (const listener of room.listeners) listener();
  };

  const preview: QRoomFeed["preview"] = (actor, input) => {
    const runId = QRunIdSchema.safeParse(input.runId);
    if (!runId.success) return;
    const room = roomOf(actor);
    // A run whose answer is already here has nothing left to preview.
    if (room.entries.some((one) => one.runId === runId.data)) return;
    room.sequence += 1;
    room.live = {
      preview: {
        sequence: room.sequence,
        runId: runId.data,
        preview: input.preview,
      },
      at: now(),
    };
    for (const listener of room.listeners) listener();
  };

  const watched: QRoomFeed["watched"] = (actor) => {
    const room = rooms.get(keyOf(actor));
    return (
      room !== undefined &&
      (room.readers > 0 || now() - room.lastReadAt < WATCHING_MS)
    );
  };

  return {
    epoch,
    publish,
    preview,
    watched,

    read: async ({
      actor,
      after: cursorIn,
      epoch: theirs,
      wait,
      signal,
      holdMs,
    }) => {
      const room = roomOf(actor);
      room.lastReadAt = now();
      // Another process's cursor means nothing here: from the start.
      const cursor =
        theirs !== undefined && theirs !== epoch
          ? 0
          : Math.min(cursorIn, room.sequence);
      const answer = (): QRoomRead => {
        const live = liveAfter(room, cursor);
        return {
          epoch,
          cursor: room.sequence,
          entries: after(room, cursor),
          ...(live === undefined ? {} : { preview: live }),
        };
      };
      if (
        !wait ||
        after(room, cursor).length > 0 ||
        liveAfter(room, cursor) !== undefined ||
        signal?.aborted === true
      ) {
        return answer();
      }
      room.readers += 1;
      try {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            room.listeners.delete(done);
            signal?.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, holdMs ?? Q_ROOM_HOLD_MS);
          room.listeners.add(done);
          signal?.addEventListener("abort", done, { once: true });
        });
      } finally {
        room.readers -= 1;
        room.lastReadAt = now();
      }
      return answer();
    },

    watchRun: ({ actor, runId, conversationId, correlationId }) => {
      const qStream = dependencies.qStream;
      if (qStream === undefined || !watched(actor)) return;
      const run = QRunIdSchema.safeParse(runId);
      if (!run.success) return;
      void (async () => {
        try {
          const record = await qStream.authorize(
            actor,
            run.data,
            correlationId,
          );
          for await (const item of qStream.open({
            run: record,
            afterSequence: 0,
            signal: AbortSignal.timeout(WATCH_RUN_MS),
          })) {
            if (item.kind === "end") return;
            const event = item.event;
            if (event.type === "q.message.completed") {
              publish(actor, {
                runId,
                conversationId: record.conversationId ?? conversationId,
                source: "TYPED",
                message: event.data.message,
              });
            }
            if (
              event.type === "q.run.completed" ||
              event.type === "q.run.failed"
            ) {
              return;
            }
          }
        } catch (error: unknown) {
          dependencies.logger?.warn(
            { err: error, qRunId: runId },
            "q room could not follow a typed run",
          );
        }
      })();
    },
  };
}
