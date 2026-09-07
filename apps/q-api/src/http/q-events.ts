import type { ServerResponse } from "node:http";

import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CorrelationIdSchema,
  isDurableQStreamEvent,
  LAST_EVENT_ID_HEADER,
  LastEventIdHeaderSchema,
  parseContract,
  Q_RUN_EVENTS_SUFFIX,
  Q_RUNS_PATH,
  Q_SSE_CONTENT_TYPE,
  QRunIdSchema,
  QStreamEventSchema,
  type CorrelationId,
  type QRunId,
} from "@capital-q/contracts";
import {
  createCorrelationId,
  getMeter,
  getTracer,
  type Logger,
} from "@capital-q/observability";
import type { QRunStreamService } from "@capital-q/q-runtime";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import { formatSseComment, formatSseFrame, formatSseRetry } from "./sse.js";

/**
 * `GET /v1/q/runs/:runId/events` — the resumable Q run stream (CQ-Q-009;
 * doc 22 §69-76; AEC-018..021).
 *
 * Before a byte of stream is committed the request is a normal protected
 * request: the session is verified, the actor and tenant are resolved on
 * the server, the run is loaded as its owner (a stranger, a colleague and
 * a foreign tenant all get the same 404), and Last-Event-ID is parsed
 * strictly. Only then are the SSE headers written; after that point a
 * failure can no longer become a problem document, so it becomes a
 * comment and a clean close, and the client reconnects with its cursor.
 *
 * The response is a projection of `q_runtime.run_events`. Durable events
 * carry their sequence as `id:`; deltas carry no id. Heartbeats are
 * comments. Nothing here decides anything about the run: a closed browser
 * is a closed socket, never a cancellation.
 */

export type QEventStreamOptions = {
  /** Comment cadence; keeps idle streams alive through proxies (§46). */
  readonly heartbeatIntervalMs?: number | undefined;
  /** `retry:` hint sent once at stream start (§47). */
  readonly retryHintMs?: number | undefined;
  /** Process-local hygiene, never authorization (§51). */
  readonly maxStreamsPerUser?: number | undefined;
  readonly maxStreamsPerUserRun?: number | undefined;
  /** A client that cannot drain within this is disconnected (§56). */
  readonly drainTimeoutMs?: number | undefined;
  /** A frame larger than this is not sent (§106). */
  readonly maxFrameBytes?: number | undefined;
};

type ResolvedQEventStreamOptions = {
  readonly [K in keyof QEventStreamOptions]-?: Exclude<
    QEventStreamOptions[K],
    undefined
  >;
};

const DEFAULT_STREAM_OPTIONS: ResolvedQEventStreamOptions = {
  heartbeatIntervalMs: 15_000,
  retryHintMs: 3_000,
  maxStreamsPerUser: 8,
  maxStreamsPerUserRun: 4,
  drainTimeoutMs: 30_000,
  maxFrameBytes: 65_536,
};

export type QEventRoutesDependencies = ActorContextDependencies & {
  readonly qStream: QRunStreamService;
  readonly options?: QEventStreamOptions | undefined;
  readonly logger?: Logger | undefined;
};

/** Too many concurrent streams for this person; a 429 before headers. */
export class QStreamLimitError extends Error {
  readonly errorCode = "Q_STREAM_LIMIT" as const;

  constructor() {
    super("Too many open Q streams. Close one and try again.");
    this.name = "QStreamLimitError";
  }
}

export type QEventStreamRegistry = {
  /** Open streams in this process. */
  readonly activeStreams: () => number;
  /** Ends every open stream with a comment; clients reconnect elsewhere (§113). */
  readonly closeAll: (reason: string) => void;
};

type OpenStream = {
  readonly userId: string;
  readonly runId: string;
  readonly close: (reason: string) => void;
};

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
}

function runIdParam(request: FastifyRequest): QRunId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    QRunIdSchema,
    params["runId"],
    "The Q request identifier is not valid.",
  );
}

/** The header, or 0. An array (a repeated header) is as invalid as text. */
function lastEventId(request: FastifyRequest): number {
  const raw = request.headers[LAST_EVENT_ID_HEADER];
  if (raw === undefined) {
    return 0;
  }
  return parseContract(
    LastEventIdHeaderSchema,
    typeof raw === "string" ? raw.trim() : raw,
    "The Last-Event-ID header is not a valid Q event sequence.",
  );
}

export function registerQEventRoutes(
  app: FastifyInstance,
  dependencies: QEventRoutesDependencies,
): QEventStreamRegistry {
  const withContext = requireActorContextHook(dependencies);
  const { qStream, logger } = dependencies;
  const given = dependencies.options ?? {};
  const options: ResolvedQEventStreamOptions = {
    heartbeatIntervalMs:
      given.heartbeatIntervalMs ?? DEFAULT_STREAM_OPTIONS.heartbeatIntervalMs,
    retryHintMs: given.retryHintMs ?? DEFAULT_STREAM_OPTIONS.retryHintMs,
    maxStreamsPerUser:
      given.maxStreamsPerUser ?? DEFAULT_STREAM_OPTIONS.maxStreamsPerUser,
    maxStreamsPerUserRun:
      given.maxStreamsPerUserRun ?? DEFAULT_STREAM_OPTIONS.maxStreamsPerUserRun,
    drainTimeoutMs:
      given.drainTimeoutMs ?? DEFAULT_STREAM_OPTIONS.drainTimeoutMs,
    maxFrameBytes: given.maxFrameBytes ?? DEFAULT_STREAM_OPTIONS.maxFrameBytes,
  };
  const tracer = getTracer("@capital-q/q-api");
  const meter = getMeter("@capital-q/q-api");
  const metrics = {
    active: meter.createUpDownCounter("q_sse_connections_active"),
    total: meter.createCounter("q_sse_connections_total"),
    reconnects: meter.createCounter("q_sse_reconnects_total"),
    replayed: meter.createCounter("q_sse_replay_events_total"),
    live: meter.createCounter("q_sse_live_events_total"),
    authDenied: meter.createCounter("q_sse_auth_denied_total"),
    errors: meter.createCounter("q_sse_errors_total"),
    backpressure: meter.createCounter("q_sse_backpressure_events"),
    deltasDropped: meter.createCounter("q_sse_deltas_dropped_total"),
    heartbeats: meter.createCounter("q_sse_heartbeats_total"),
    duration: meter.createHistogram("q_sse_connection_duration_ms"),
    timeToFirstEvent: meter.createHistogram("q_sse_time_to_first_event_ms"),
  };
  const open = new Map<symbol, OpenStream>();

  const countFor = (userId: string, runId: string) => {
    let user = 0;
    let userRun = 0;
    for (const stream of open.values()) {
      if (stream.userId === userId) {
        user += 1;
        if (stream.runId === runId) {
          userRun += 1;
        }
      }
    }
    return { user, userRun };
  };

  const eventsPath = `${Q_RUNS_PATH}/:runId${Q_RUN_EVENTS_SUFFIX}`;

  app.get(eventsPath, { onRequest: withContext }, async (request, reply) => {
    const actor = getActorContext(request);
    const runId = runIdParam(request);
    const requestedAfter = lastEventId(request);
    const correlationId = correlation();

    // Everything that can still be a problem document happens here.
    const run = await tracer.startActiveSpan(
      "q.stream.authorize",
      async (span) => {
        try {
          return await qStream.authorize(actor, runId, correlationId);
        } catch (error: unknown) {
          metrics.authDenied.add(1, { route: "q_run_events" });
          throw error;
        } finally {
          span.end();
        }
      },
    );
    const counts = countFor(actor.userId, run.id);
    if (
      counts.user >= options.maxStreamsPerUser ||
      counts.userRun >= options.maxStreamsPerUserRun
    ) {
      metrics.errors.add(1, { stage: "limit" });
      throw new QStreamLimitError();
    }

    // A cursor ahead of the run's own sequence names nothing we hold; the
    // stream continues from the run's actual last event instead.
    const afterSequence = Math.min(requestedAfter, run.lastEventSequence);
    const reconnecting = requestedAfter > 0;
    if (reconnecting) {
      metrics.reconnects.add(1, { route: "q_run_events" });
    }

    // From here the response is ours: headers are committed, Fastify's
    // serialisation and error handler no longer apply.
    reply.hijack();
    const raw: ServerResponse = reply.raw;
    const controller = new AbortController();
    const startedAt = Date.now();
    const key = Symbol("q-sse");
    let framesSent = 0;
    let replayedCount = 0;
    let liveCount = 0;
    let closeReason = "client_disconnect";
    let heartbeat: NodeJS.Timeout | undefined;

    const finish = (reason: string) => {
      if (!open.has(key)) {
        return;
      }
      open.delete(key);
      closeReason = reason;
      if (heartbeat !== undefined) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
      controller.abort();
      metrics.active.add(-1, { route: "q_run_events" });
      metrics.duration.record(Date.now() - startedAt, { reason });
      // An event stream is not a connection worth keeping alive: once the
      // last frame has been flushed the socket is torn down, so a stream
      // that ended (or a peer that vanished mid-write) never lingers as a
      // half-open connection that would hold the process at shutdown.
      if (raw.destroyed) {
        return;
      }
      const graceful =
        reason === "terminal" ||
        reason === "run_ended" ||
        reason === "replay_limit" ||
        reason === "server-shutdown" ||
        reason === "stream_error";
      if (!graceful || raw.writableEnded) {
        raw.destroy();
        return;
      }
      // Flush the last frame, then tear down; a peer that never drains is
      // torn down anyway after a short grace.
      const grace = setTimeout(() => raw.destroy(), 1_000);
      grace.unref();
      raw.end(() => {
        clearTimeout(grace);
        raw.destroy();
      });
      logger?.info(
        {
          qRunId: run.id,
          requestId: request.id,
          correlationId,
          reason,
          framesSent,
          replayed: replayedCount,
          live: liveCount,
          durationMs: Date.now() - startedAt,
        },
        "q stream closed",
      );
    };

    open.set(key, {
      userId: actor.userId,
      runId: run.id,
      close: (reason) => {
        if (!raw.destroyed && !raw.writableEnded) {
          raw.write(formatSseComment(reason));
        }
        finish(reason);
      },
    });
    metrics.active.add(1, { route: "q_run_events" });
    metrics.total.add(1, {
      route: "q_run_events",
      mode: reconnecting ? "reconnect" : "initial",
    });

    raw.writeHead(200, {
      "content-type": `${Q_SSE_CONTENT_TYPE}; charset=utf-8`,
      "cache-control": "no-cache, no-transform",
      // Tells buffering reverse proxies (nginx and friends) to pass frames
      // through as they are written.
      "x-accel-buffering": "no",
      "x-request-id": request.id,
    });
    raw.flushHeaders();
    raw.on("close", () => {
      finish(closeReason);
    });
    raw.on("error", () => {
      finish("socket_error");
    });

    /** Waits for the socket to drain, or gives up on a client that cannot keep up. */
    const drained = (): Promise<boolean> =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          raw.off("drain", onDrain);
          resolve(false);
        }, options.drainTimeoutMs);
        const onDrain = () => {
          clearTimeout(timer);
          resolve(true);
        };
        raw.once("drain", onDrain);
      });

    /**
     * Writes one frame honouring backpressure (§56). A delta is dropped
     * while the socket is congested — the durable message will follow —
     * whereas a durable frame waits for the drain, and a client that never
     * drains is disconnected and will reconnect with its cursor.
     */
    const send = async (
      frame: string,
      kind: "durable" | "delta" | "comment",
    ): Promise<boolean> => {
      if (raw.destroyed || raw.writableEnded || controller.signal.aborted) {
        return false;
      }
      if (kind !== "durable" && raw.writableNeedDrain) {
        if (kind === "delta") {
          metrics.deltasDropped.add(1, { reason: "backpressure" });
        }
        return true;
      }
      const ok = raw.write(frame);
      framesSent += 1;
      if (!ok) {
        metrics.backpressure.add(1, { kind });
        const recovered = await drained();
        if (!recovered) {
          metrics.errors.add(1, { stage: "drain_timeout" });
          raw.destroy();
          return false;
        }
      }
      return true;
    };

    heartbeat = setInterval(() => {
      metrics.heartbeats.add(1, { route: "q_run_events" });
      void send(formatSseComment("heartbeat"), "comment");
    }, options.heartbeatIntervalMs);

    let firstEventAt: number | undefined;
    try {
      if (!(await send(formatSseRetry(options.retryHintMs), "comment"))) {
        return;
      }
      for await (const item of qStream.open({
        run,
        afterSequence,
        signal: controller.signal,
      })) {
        if (item.kind === "end") {
          closeReason =
            item.reason === "TERMINAL"
              ? "terminal"
              : item.reason === "RUN_ENDED"
                ? "run_ended"
                : "replay_limit";
          break;
        }
        // The public projector already validated the event; parsing again
        // here is the allowlist at the last step before the wire (§26).
        const event = QStreamEventSchema.parse(item.event);
        const durable = item.kind === "durable" && isDurableQStreamEvent(event);
        const frame = formatSseFrame({
          event: event.type,
          ...(durable ? { id: String(event.sequence) } : {}),
          data: JSON.stringify(event),
        });
        if (Buffer.byteLength(frame, "utf8") > options.maxFrameBytes) {
          metrics.errors.add(1, { stage: "frame_too_large" });
          logger?.warn(
            { qRunId: run.id, eventType: event.type, sequence: event.sequence },
            "q stream frame exceeds the bound; not sent",
          );
          continue;
        }
        if (firstEventAt === undefined) {
          firstEventAt = Date.now();
          metrics.timeToFirstEvent.record(firstEventAt - startedAt, {
            mode: reconnecting ? "reconnect" : "initial",
          });
        }
        if (durable) {
          if (event.sequence <= afterSequence + replayedCount) {
            // Not reachable by construction (every read is after the
            // cursor); counted so a regression would be visible.
            metrics.errors.add(1, { stage: "duplicate" });
          }
          replayedCount += 1;
          metrics.replayed.add(1, { event_type: event.type });
        } else {
          liveCount += 1;
          metrics.live.add(1, { event_type: event.type });
        }
        if (!(await send(frame, durable ? "durable" : "delta"))) {
          return;
        }
      }
      finish(closeReason);
    } catch (error: unknown) {
      // After headers there is no problem document. The class of fault is
      // logged, the client gets a comment and a clean close, and durable
      // state is untouched: reconnecting with the cursor recovers.
      metrics.errors.add(1, { stage: "stream" });
      logger?.error(
        {
          qRunId: run.id,
          requestId: request.id,
          correlationId,
          errorName: error instanceof Error ? error.name : typeof error,
        },
        "q stream ended with an error",
      );
      if (!raw.destroyed && !raw.writableEnded) {
        raw.write(formatSseComment("stream-error"));
      }
      finish("stream_error");
    }
  });

  const registry: QEventStreamRegistry = {
    activeStreams: () => open.size,
    closeAll: (reason) => {
      for (const stream of [...open.values()]) {
        stream.close(reason);
      }
    },
  };

  // Graceful shutdown (doc 21 §80, §219): open streams are told and ended
  // BEFORE the server stops accepting and waits for connections — Fastify
  // runs preClose hooks ahead of server.close(), whereas an onClose hook
  // would wait behind the very sockets it needs to end. Clients reconnect
  // to the replacement instance and replay from their cursor. Nothing
  // about a run is decided here.
  app.addHook("preClose", (done) => {
    registry.closeAll("server-shutdown");
    done();
  });

  return registry;
}
