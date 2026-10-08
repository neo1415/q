# Excerpt: apps/q-api/src/room/feed.ts lines 1-250

- Original path: `apps/q-api/src/room/feed.ts`
- Line range: 1-250
- Why included: Process-local room feed (long-poll), the server source of voice/typed answer cards. Lost on restart/deploy; single-replica assumption.

```
    1  import { randomUUID } from "node:crypto";
    2
    3  import {
    4    Q_ROOM_HOLD_MS,
    5    Q_ROOM_KEPT,
    6    QRunIdSchema,
    7    type CorrelationId,
    8    type QResponseMessage,
    9    type QRoomEntry,
   10    type QRoomRead,
   11    type QRoomSource,
   12  } from "@capital-q/contracts";
   13  import type { Logger } from "@capital-q/observability";
   14  import type { QRunStreamService } from "@capital-q/q-runtime";
   15  import type { ActorContext } from "@capital-q/security";
   16
   17  /**
   18   * The person's Q room feed (voice-cards, founder 2026-10-08).
   19   *
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
  161      publish,
  162      watched,
  163
  164      read: async ({
  165        actor,
  166        after: cursorIn,
  167        epoch: theirs,
  168        wait,
  169        signal,
  170        holdMs,
  171      }) => {
  172        const room = roomOf(actor);
  173        room.lastReadAt = now();
  174        // Another process's cursor means nothing here: from the start.
  175        const cursor =
  176          theirs !== undefined && theirs !== epoch
  177            ? 0
  178            : Math.min(cursorIn, room.sequence);
  179        const answer = (): QRoomRead => ({
  180          epoch,
  181          cursor: room.sequence,
  182          entries: after(room, cursor),
  183        });
  184        if (!wait || after(room, cursor).length > 0 || signal?.aborted === true) {
  185          return answer();
  186        }
  187        room.readers += 1;
  188        try {
  189          await new Promise<void>((resolve) => {
  190            const done = () => {
  191              clearTimeout(timer);
  192              room.listeners.delete(done);
  193              signal?.removeEventListener("abort", done);
  194              resolve();
  195            };
  196            const timer = setTimeout(done, holdMs ?? Q_ROOM_HOLD_MS);
  197            room.listeners.add(done);
  198            signal?.addEventListener("abort", done, { once: true });
  199          });
  200        } finally {
  201          room.readers -= 1;
  202          room.lastReadAt = now();
  203        }
  204        return answer();
  205      },
  206
  207      watchRun: ({ actor, runId, conversationId, correlationId }) => {
  208        const qStream = dependencies.qStream;
  209        if (qStream === undefined || !watched(actor)) return;
  210        const run = QRunIdSchema.safeParse(runId);
  211        if (!run.success) return;
  212        void (async () => {
  213          try {
  214            const record = await qStream.authorize(
  215              actor,
  216              run.data,
  217              correlationId,
  218            );
  219            for await (const item of qStream.open({
  220              run: record,
  221              afterSequence: 0,
  222              signal: AbortSignal.timeout(WATCH_RUN_MS),
  223            })) {
  224              if (item.kind === "end") return;
  225              const event = item.event;
  226              if (event.type === "q.message.completed") {
  227                publish(actor, {
  228                  runId,
  229                  conversationId: record.conversationId ?? conversationId,
  230                  source: "TYPED",
  231                  message: event.data.message,
  232                });
  233              }
  234              if (
  235                event.type === "q.run.completed" ||
  236                event.type === "q.run.failed"
  237              ) {
  238                return;
  239              }
  240            }
  241          } catch (error: unknown) {
  242            dependencies.logger?.warn(
  243              { err: error, qRunId: runId },
  244              "q room could not follow a typed run",
  245            );
  246          }
  247        })();
  248      },
  249    };
  250  }
```

# Excerpt: apps/q-api/src/room/routes.ts lines 1-60

- Original path: `apps/q-api/src/room/routes.ts`
- Line range: 1-60
- Why included: GET /v1/q/room route.

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

# Excerpt: apps/web/app/api/q-room/route.ts lines 1-49

- Original path: `apps/web/app/api/q-room/route.ts`
- Line range: 1-49
- Why included: Web route handler that proxies the long poll with the cookie session's bearer.

```
    1  import { NextResponse } from "next/server";
    2
    3  import { readQRoom } from "@capital-q/api-client";
    4  import { loadWebServerConfig } from "@capital-q/config/web";
    5  import { QRoomReadQuerySchema } from "@capital-q/contracts";
    6
    7  import { getSessionAccessToken } from "@/auth/session";
    8
    9  /**
   10   * voice-cards: the person's Q room feed, for the Q page and every page's
   11   * dock while a voice line is open. A route, not a server action: server
   12   * actions run one at a time per client, and this long poll runs beside
   13   * everything else the page does. The session cookie is the only
   14   * authority; the Q API answers with the session's own person's room.
   15   */
   16  export const dynamic = "force-dynamic";
   17
   18  const empty = (status: number) =>
   19    NextResponse.json(
   20      { entries: [], unavailable: true },
   21      { status, headers: { "cache-control": "no-store" } },
   22    );
   23
   24  export async function GET(request: Request): Promise<NextResponse> {
   25    const url = new URL(request.url);
   26    const query = QRoomReadQuerySchema.safeParse(
   27      Object.fromEntries(url.searchParams.entries()),
   28    );
   29    if (!query.success) return empty(400);
   30    const { qApiBaseUrl } = loadWebServerConfig();
   31    if (qApiBaseUrl === undefined) return empty(503);
   32    const accessToken = await getSessionAccessToken();
   33    if (accessToken === null) return empty(401);
   34    try {
   35      const read = await readQRoom(
   36        { baseUrl: qApiBaseUrl, accessToken },
   37        {
   38          after: query.data.after,
   39          epoch: query.data.epoch,
   40          wait: query.data.wait === 1,
   41        },
   42      );
   43      return NextResponse.json(read, {
   44        headers: { "cache-control": "no-store" },
   45      });
   46    } catch {
   47      return empty(502);
   48    }
   49  }
```
