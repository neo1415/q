# Evidence: apps/web/src/features/q/room-feed.ts (lines 1-174)

- Original path: `apps/web/src/features/q/room-feed.ts`
- Line range: 1-174 (HEAD 520bd123)
- Why included: Complete: browser long-poll of /api/q-room while a voice line is active; body cast to QRoomRead after a shape check.

```
    1  "use client";
    2  
    3  import { useEffect, useRef } from "react";
    4  
    5  import type { QRoomEntry, QRoomRead } from "@capital-q/contracts";
    6  
    7  /**
    8   * voice-cards: the person's Q room feed, read in the browser.
    9   *
   10   * The Q API publishes every run's answer -- typed, spoken, or asked by
   11   * the duplex line's ask_q -- to the person's room; this reads it while a
   12   * voice line is open and hands each new answer over once, in order,
   13   * keyed by its message. The screen renders cards from what arrives here,
   14   * so nothing depends on the voice model or a transcript carrying them.
   15   */
   16  
   17  export const ROOM_FEED_PATH = "/api/q-room";
   18  /** After a failed read, the next one waits this long. */
   19  export const ROOM_RETRY_MS = 2_000;
   20  /**
   21   * A first read hands over answers this recent: one that landed while the
   22   * page was changing under a live line is not lost; older ones are history
   23   * the conversation already shows.
   24   */
   25  export const ROOM_RECENT_MS = 45_000;
   26  
   27  export type RoomRead = (input: {
   28    readonly after: number;
   29    readonly epoch: string | undefined;
   30    readonly wait: boolean;
   31    readonly signal: AbortSignal;
   32  }) => Promise<QRoomRead | null>;
   33  
   34  export type RoomFeedReader = { readonly stop: () => void };
   35  
   36  /** The loop, without React: tested with a fake read and a fake clock. */
   37  export function startRoomFeed(options: {
   38    readonly read: RoomRead;
   39    readonly onEntries: (entries: readonly QRoomEntry[]) => void;
   40    readonly now?: (() => number) | undefined;
   41    readonly wait?:
   42      ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
   43    /** Answers already handed over (shared across restarts of the reader). */
   44    readonly seen?: Set<string> | undefined;
   45  }): RoomFeedReader {
   46    const controller = new AbortController();
   47    const now = options.now ?? Date.now;
   48    const seen = options.seen ?? new Set<string>();
   49    const pause =
   50      options.wait ??
   51      ((ms: number, signal: AbortSignal) =>
   52        new Promise<void>((resolve) => {
   53          const timer = setTimeout(resolve, ms);
   54          signal.addEventListener(
   55            "abort",
   56            () => {
   57              clearTimeout(timer);
   58              resolve();
   59            },
   60            { once: true },
   61          );
   62        }));
   63    const startedAt = now();
   64  
   65    void (async () => {
   66      let epoch: string | undefined;
   67      let cursor = 0;
   68      let first = true;
   69      while (!controller.signal.aborted) {
   70        let read: QRoomRead | null;
   71        try {
   72          read = await options.read({
   73            after: cursor,
   74            epoch,
   75            wait: !first,
   76            signal: controller.signal,
   77          });
   78        } catch {
   79          read = null;
   80        }
   81        if (controller.signal.aborted) return;
   82        if (read === null) {
   83          await pause(ROOM_RETRY_MS, controller.signal);
   84          continue;
   85        }
   86        // A different process: its sequence starts again from its own 0.
   87        const restarted = epoch !== undefined && read.epoch !== epoch;
   88        const opening = first || restarted;
   89        epoch = read.epoch;
   90        cursor = read.cursor;
   91        first = false;
   92        const fresh = [...read.entries]
   93          .sort((a, b) => a.sequence - b.sequence)
   94          .filter((entry) => {
   95            if (seen.has(entry.message.messageId)) return false;
   96            // A first read: only what landed around the time it opened.
   97            if (opening) {
   98              const at = Date.parse(entry.message.createdAt);
   99              if (Number.isFinite(at) && at < startedAt - ROOM_RECENT_MS) {
  100                seen.add(entry.message.messageId);
  101                return false;
  102              }
  103            }
  104            return true;
  105          });
  106        for (const entry of fresh) seen.add(entry.message.messageId);
  107        if (fresh.length > 0) options.onEntries(fresh);
  108      }
  109    })();
  110  
  111    return { stop: () => controller.abort() };
  112  }
  113  
  114  /** The browser's read: the same-origin route, under the session cookie. */
  115  export const fetchRoomRead: RoomRead = async ({
  116    after,
  117    epoch,
  118    wait,
  119    signal,
  120  }) => {
  121    const query = new URLSearchParams({
  122      after: String(after),
  123      wait: wait ? "1" : "0",
  124      ...(epoch === undefined ? {} : { epoch }),
  125    });
  126    const response = await fetch(`${ROOM_FEED_PATH}?${query.toString()}`, {
  127      cache: "no-store",
  128      signal,
  129    });
  130    if (!response.ok) return null;
  131    const body: unknown = await response.json();
  132    // The same-origin route parsed the Q API's answer against the room
  133    // contract on the server (api-client `call`); here only the shape the
  134    // loop relies on, so the contracts stay out of every page's bundle.
  135    if (
  136      typeof body !== "object" ||
  137      body === null ||
  138      !("epoch" in body) ||
  139      !("cursor" in body) ||
  140      !("entries" in body) ||
  141      typeof body.epoch !== "string" ||
  142      typeof body.cursor !== "number" ||
  143      !Array.isArray(body.entries)
  144    ) {
  145      return null;
  146    }
  147    return body as QRoomRead;
  148  };
  149  
  150  /**
  151   * Read the room while `active`, handing each new answer to `onEntries`.
  152   * Answers are remembered across a line ending and starting again, so the
  153   * same one is never handed over twice in this page's life.
  154   */
  155  export function useQRoomFeed(
  156    active: boolean,
  157    onEntries: (entries: readonly QRoomEntry[]) => void,
  158    read: RoomRead = fetchRoomRead,
  159  ): void {
  160    const handler = useRef(onEntries);
  161    useEffect(() => {
  162      handler.current = onEntries;
  163    }, [onEntries]);
  164    const seen = useRef(new Set<string>());
  165    useEffect(() => {
  166      if (!active) return;
  167      const reader = startRoomFeed({
  168        read,
  169        seen: seen.current,
  170        onEntries: (entries) => handler.current(entries),
  171      });
  172      return () => reader.stop();
  173    }, [active, read]);
  174  }
```

# Evidence: apps/q-api/src/room/feed.ts (lines 20-160)

- Original path: `apps/q-api/src/room/feed.ts`
- Line range: 20-160 (HEAD 520bd123)
- Why included: Server room feed: process-local in-memory Map keyed by tenant:user; epoch per process.

```
   20   * Root cause it removes: a spoken answer's cards reached the screen only
   21   * if the browser, on its own, worked out which conversation a voice turn
   22   * landed in and re-read it at the right moment (voice turn board sequence
   23   * -> conversation id -> a guarded re-read that is skipped while the page
   24   * thinks a run is still in flight). On the duplex line the run is started
   25   * by the server inside ask_q, so the browser never held its run id and
   26   * every link of that chain was a guess; live 2026-10-08 the run stored ten
   27   * cards and none were shown.
   28   *
   29   * Now the server is the single source: every Q run that finishes with an
   30   * answer is published here as it completes -- voice runs (standard or
   31   * duplex ask_q) by the voice turn handler, which already follows the run's
   32   * stream; typed runs by `watchRun` while the person has a reader open --
   33   * and the browser renders from it, keyed by run, de-duplicated, in order.
   34   *
   35   * Process-local and forgettable, like the voice turn board and the duplex
   36   * lines it sits beside: the epoch names this process, so a reader whose
   37   * epoch changed starts again. Nothing here is authority; an entry is the
   38   * person's own recorded answer, read back under their own session.
   39   */
   40  
   41  export type QRoomPublish = {
   42    readonly runId: string;
   43    readonly conversationId: string | null;
   44    readonly source: QRoomSource;
   45    readonly message: QResponseMessage;
   46  };
   47  
   48  export type QRoomFeed = {
   49    readonly epoch: string;
   50    readonly publish: (actor: ActorContext, entry: QRoomPublish) => void;
   51    /** Entries after `after`; held up to `holdMs` for the next when none. */
   52    readonly read: (input: {
   53      readonly actor: ActorContext;
   54      readonly after: number;
   55      readonly epoch?: string | undefined;
   56      readonly wait: boolean;
   57      readonly signal?: AbortSignal | undefined;
   58      readonly holdMs?: number | undefined;
   59    }) => Promise<QRoomRead>;
   60    /** A reader is open (or was, in the last minute) for this person. */
   61    readonly watched: (actor: ActorContext) => boolean;
   62    /**
   63     * Follow a typed run to its answer and publish it, when the person has
   64     * a reader open; nothing otherwise (their own page streams it already).
   65     */
   66    readonly watchRun: (input: {
   67      readonly actor: ActorContext;
   68      readonly runId: string;
   69      readonly conversationId: string | null;
   70      readonly correlationId?: CorrelationId | undefined;
   71    }) => void;
   72  };
   73  
   74  type Room = {
   75    sequence: number;
   76    readonly entries: QRoomEntry[];
   77    readonly listeners: Set<() => void>;
   78    lastReadAt: number;
   79    readers: number;
   80  };
   81  
   82  /** A reader that read within this long still counts as watching. */
   83  const WATCHING_MS = 60_000;
   84  /** A typed run followed for at most this long. */
   85  const WATCH_RUN_MS = 5 * 60_000;
   86  /** Rooms nobody has read or written for this long are forgotten. */
   87  const FORGET_MS = 2 * 60 * 60_000;
   88  
   89  const keyOf = (actor: ActorContext) => `${actor.tenantId}:${actor.userId}`;
   90  
   91  export function createQRoomFeed(
   92    dependencies: {
   93      readonly qStream?: QRunStreamService | undefined;
   94      readonly logger?: Logger | undefined;
   95      readonly now?: (() => number) | undefined;
   96    } = {},
   97  ): QRoomFeed {
   98    const now = dependencies.now ?? Date.now;
   99    const epoch = randomUUID();
  100    const rooms = new Map<string, Room>();
  101  
  102    const roomOf = (actor: ActorContext): Room => {
  103      const key = keyOf(actor);
  104      let room = rooms.get(key);
  105      if (room === undefined) {
  106        const at = now();
  107        for (const [other, old] of rooms) {
  108          if (old.readers === 0 && at - old.lastReadAt > FORGET_MS) {
  109            rooms.delete(other);
  110          }
  111        }
  112        room = {
  113          sequence: 0,
  114          entries: [],
  115          listeners: new Set(),
  116          lastReadAt: 0,
  117          readers: 0,
  118        };
  119        rooms.set(key, room);
  120      }
  121      return room;
  122    };
  123  
  124    const after = (room: Room, cursor: number) =>
  125      room.entries.filter((entry) => entry.sequence > cursor);
  126  
  127    const publish: QRoomFeed["publish"] = (actor, entry) => {
  128      const room = roomOf(actor);
  129      // One entry per answer: a run's answer published twice (the voice
  130      // handler and a watcher) is published once.
  131      if (
  132        room.entries.some(
  133          (one) => one.message.messageId === entry.message.messageId,
  134        )
  135      ) {
  136        return;
  137      }
  138      room.sequence += 1;
  139      room.entries.push({
  140        sequence: room.sequence,
  141        runId: QRunIdSchema.parse(entry.runId),
  142        conversationId: entry.conversationId as QRoomEntry["conversationId"],
  143        source: entry.source,
  144        message: entry.message,
  145      });
  146      room.entries.splice(0, Math.max(0, room.entries.length - Q_ROOM_KEPT));
  147      room.lastReadAt = Math.max(room.lastReadAt, now());
  148      for (const listener of room.listeners) listener();
  149    };
  150  
  151    const watched: QRoomFeed["watched"] = (actor) => {
  152      const room = rooms.get(keyOf(actor));
  153      return (
  154        room !== undefined &&
  155        (room.readers > 0 || now() - room.lastReadAt < WATCHING_MS)
  156      );
  157    };
  158  
  159    return {
  160      epoch,
```

# Evidence: apps/q-api/src/room/routes.ts (lines 1-60)

- Original path: `apps/q-api/src/room/routes.ts`
- Line range: 1-60 (HEAD 520bd123)
- Why included: GET /v1/q/room route (actor from session).

```
    1  import type { FastifyInstance } from "fastify";
    2  
    3  import {
    4    parseContract,
    5    Q_ROOM_PATH,
    6    QRoomReadQuerySchema,
    7    QRoomReadSchema,
    8  } from "@capital-q/contracts";
    9  import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";
   10  
   11  import {
   12    getActorContext,
   13    requireActorContextHook,
   14    requireActorContextOrPersonalHook,
   15    type ActorContextDependencies,
   16  } from "../security/actor-context.js";
   17  import type { QRoomFeed } from "./feed.js";
   18  
   19  /**
   20   * `GET /v1/q/room` (voice-cards): the person's own Q room feed, as a long
   21   * poll. A normal protected request: the actor is resolved on the server,
   22   * and a person only ever reads their own room (the feed is keyed by the
   23   * resolved tenant and user, never by anything the request names).
   24   */
   25  export function registerQRoomRoutes(
   26    app: FastifyInstance,
   27    dependencies: ActorContextDependencies & {
   28      readonly identity?: ApplicationIdentityLookup | undefined;
   29      readonly room: QRoomFeed;
   30    },
   31  ): void {
   32    const identity = dependencies.identity;
   33    const withContext =
   34      identity === undefined
   35        ? requireActorContextHook(dependencies)
   36        : requireActorContextOrPersonalHook({ ...dependencies, identity });
   37  
   38    app.get(Q_ROOM_PATH, { onRequest: withContext }, async (request, reply) => {
   39      const query = parseContract(
   40        QRoomReadQuerySchema,
   41        request.query ?? {},
   42        "That room read is not valid.",
   43      );
   44      const controller = new AbortController();
   45      reply.raw.once("close", () => {
   46        if (!reply.raw.writableFinished) controller.abort();
   47      });
   48      const read = await dependencies.room.read({
   49        actor: getActorContext(request),
   50        after: query.after,
   51        epoch: query.epoch,
   52        wait: query.wait === 1,
   53        signal: controller.signal,
   54      });
   55      return reply
   56        .code(200)
   57        .header("Cache-Control", "no-store")
   58        .send(QRoomReadSchema.parse(read));
   59    });
   60  }
```

