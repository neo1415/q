import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  isTerminalQRunStatus,
  isTerminalQStreamEvent,
  Q_STREAM_DELTA_MAX_LENGTH,
  QRunIdSchema,
  QStreamEventSchema,
  type CorrelationId,
  type QArtifactPreview,
  type QMessageId,
  type QRunId,
  type QStreamEvent,
} from "@capital-q/contracts";
import type { ActorContext, TenantId } from "@capital-q/security";

import type { QRunEventRecord, QRunRecord } from "../contracts/index.js";
import { ownedRun } from "./access.js";
import type { QRuntimeDependencies } from "./dependencies.js";

/**
 * The resumable run stream (CQ-Q-009; doc 22 §69-76; AEC-018..021).
 *
 * Truth is `q_runtime.run_events`: durable, per-run sequenced, replayed by
 * cursor. Everything here is a way of reading that table promptly:
 *
 *   notifier   wakes a reader when a run gained an event (NOTIFY, or an
 *              in-process publisher in tests). It carries identifiers only
 *              and is never the source of an event.
 *   delta bus  carries q.message.delta between two durable boundaries.
 *              In-process, bounded, never stored, never replayed.
 *   projector  turns a stored record into the public QStreamEvent, by
 *              parsing it into the contract. What the contract does not
 *              name does not leave.
 *   open()     replay after a cursor, then live: subscribe first, then
 *              read, then read again on every wake-up — so an event that
 *              commits while the reader is switching from replay to live is
 *              announced by a notice the reader already holds. Every read is
 *              "after my cursor", which is why nothing is delivered twice
 *              by the same connection and nothing is skipped by any.
 */

export const Q_RUN_EVENTS_CHANNEL = "q_run_events";

/** What a NOTIFY carries: which run, and the sequence it reached. 0 = "re-check". */
export const QRunEventNoticeSchema = z
  .object({
    runId: QRunIdSchema,
    sequence: z.number().int().min(0),
  })
  .strict();

export type QRunEventNotice = z.infer<typeof QRunEventNoticeSchema>;

export type QRunEventListener = (notice: QRunEventNotice) => void;

export type QRunEventNotifier = {
  /** Wakes the listener for the run's new events. Returns the unsubscribe. */
  readonly subscribe: (
    runId: QRunId,
    listener: QRunEventListener,
  ) => () => void;
  /** Live listeners, for one run or in total; the leak tests read this. */
  readonly subscriberCount: (runId?: QRunId) => number;
  readonly close: () => Promise<void>;
};

export type QRunEventPublisher = {
  readonly publish: (notice: QRunEventNotice) => void;
};

/**
 * One process, one map. This is the V1 wake-up for tests and for a single
 * q-api instance; production uses the Postgres notifier, whose NOTIFY
 * reaches every instance. Either way the reader re-reads the table.
 */
export function createInProcessQRunEventNotifier(): QRunEventNotifier &
  QRunEventPublisher {
  const listeners = new Map<string, Set<QRunEventListener>>();
  return {
    subscribe: (runId, listener) => {
      const set = listeners.get(runId) ?? new Set();
      set.add(listener);
      listeners.set(runId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) {
          listeners.delete(runId);
        }
      };
    },
    subscriberCount: (runId) =>
      runId === undefined
        ? [...listeners.values()].reduce((n, set) => n + set.size, 0)
        : (listeners.get(runId)?.size ?? 0),
    publish: (notice) => {
      for (const listener of listeners.get(notice.runId) ?? []) {
        listener(notice);
      }
    },
    close: () => {
      listeners.clear();
      return Promise.resolve();
    },
  };
}

/** A live text fragment of the Q message being produced. Presentation only. */
export type QLiveDelta = {
  readonly runId: QRunId;
  readonly tenantId: TenantId;
  readonly messageId: QMessageId;
  readonly text: string;
  /**
   * Artifacts live: the subjects named so far, sent as their own
   * `q.artifact.preview` frame ahead of this delta's text (which may then
   * be empty). Never merged with another delta.
   */
  readonly preview?:
    Pick<QArtifactPreview, "subjects" | "layout" | "table"> | undefined;
  /** A holding line said before the turn is read (QMessageDeltaEvent). */
  readonly holding?: true | undefined;
};

export type QLiveDeltaListener = (delta: QLiveDelta) => void;

/**
 * Joins consecutive fragments of one message into one, so a reader that
 * fell behind (a slow socket, a busy event loop) receives the text in a
 * single frame instead of replaying every fragment. Order is preserved and
 * a fragment of another message or run is never merged across.
 */
export function coalesceDeltas(
  queued: readonly QLiveDelta[],
): readonly QLiveDelta[] {
  const out: QLiveDelta[] = [];
  for (const delta of queued) {
    const last = out[out.length - 1];
    if (
      last !== undefined &&
      last.preview === undefined &&
      delta.preview === undefined &&
      last.runId === delta.runId &&
      last.tenantId === delta.tenantId &&
      last.messageId === delta.messageId
    ) {
      out[out.length - 1] = { ...last, text: last.text + delta.text };
    } else {
      out.push(delta);
    }
  }
  return out;
}

/**
 * The seam a streaming-capable answer path publishes into (§33). Nothing
 * publishes in production yet: no configured provider streams, and the
 * answer is a structured call (§35). The bus exists so that the transport,
 * the client and the tests are ready for the first real delta source,
 * and so that source never needs to know about SSE.
 */
export type QLiveDeltaBus = {
  readonly publish: (delta: QLiveDelta) => void;
  readonly subscribe: (
    runId: QRunId,
    listener: QLiveDeltaListener,
  ) => () => void;
  readonly subscriberCount: (runId?: QRunId) => number;
};

export function createInProcessQLiveDeltaBus(
  now: () => number = Date.now,
): QLiveDeltaBus {
  const listeners = new Map<string, Set<QLiveDeltaListener>>();
  /**
   * Each run's holding line, until anything else of the run is said
   * (owner 2026-10-23): it goes out as the turn arrives, which can be
   * before the person's stream has connected (live: the stream opened
   * about a second after the turn was sent), so a late subscriber is
   * handed it. Bounded and short-lived; never stored.
   */
  const holding = new Map<string, { delta: QLiveDelta; at: number }>();
  return {
    subscribe: (runId, listener) => {
      const set = listeners.get(runId) ?? new Set();
      set.add(listener);
      listeners.set(runId, set);
      const held = holding.get(runId);
      if (held !== undefined && now() - held.at <= HOLDING_TTL_MS) {
        listener(held.delta);
      }
      return () => {
        set.delete(listener);
        if (set.size === 0) {
          listeners.delete(runId);
        }
      };
    },
    subscriberCount: (runId) =>
      runId === undefined
        ? [...listeners.values()].reduce((n, set) => n + set.size, 0)
        : (listeners.get(runId)?.size ?? 0),
    publish: (delta) => {
      if (delta.holding === true) {
        holding.delete(delta.runId);
        holding.set(delta.runId, { delta, at: now() });
        while (holding.size > HOLDING_MAX) {
          const oldest = holding.keys().next().value;
          if (oldest === undefined) break;
          holding.delete(oldest);
        }
      } else {
        holding.delete(delta.runId);
      }
      for (const listener of listeners.get(delta.runId) ?? []) {
        listener(delta);
      }
    },
  };
}

/** How long a holding line waits for its run's stream to connect. */
const HOLDING_TTL_MS = 60_000;
/** Runs whose holding line is kept at once. */
const HOLDING_MAX = 512;

/**
 * The public projector (§26, §117-§119). A stored record becomes a stream
 * event only by parsing into the closed contract: an unknown type, an
 * extra field or a malformed payload yields null and is skipped, never
 * serialised. There is no internal record type to leak because the store
 * only holds contract events; this is the guarantee that keeps it so.
 */
export function projectPublicStreamEvent(
  record: QRunEventRecord,
): QStreamEvent | null {
  const parsed = QStreamEventSchema.safeParse({
    contractVersion: 1,
    eventId: record.id,
    runId: record.runId,
    sequence: record.sequence,
    occurredAt: record.occurredAt,
    type: record.eventType,
    data: record.payload,
  });
  return parsed.success ? parsed.data : null;
}

export type QRunStreamItem =
  /** A persisted event; its sequence is the SSE id and the resume cursor. */
  | { readonly kind: "durable"; readonly event: QStreamEvent }
  /** Live presentation; no SSE id, not replayable. */
  | { readonly kind: "delta"; readonly event: QStreamEvent }
  /** The reader is done; the transport closes. */
  | {
      readonly kind: "end";
      readonly reason: "TERMINAL" | "RUN_ENDED" | "REPLAY_LIMIT";
    };

export type QRunStreamOptions = {
  /** Rows per replay query. */
  readonly replayPageSize?: number | undefined;
  /** Durable events one connection may replay before it is closed (§45). */
  readonly replayMaxEvents?: number | undefined;
  /** How long to wait for a wake-up before re-reading anyway (§55). */
  readonly safetyPollMs?: number | undefined;
  /** Deltas held for a reader that has not consumed them yet; oldest dropped beyond this. */
  readonly deltaQueueMax?: number | undefined;
};

type ResolvedQRunStreamOptions = {
  readonly [K in keyof QRunStreamOptions]-?: Exclude<
    QRunStreamOptions[K],
    undefined
  >;
};

const DEFAULT_OPTIONS: ResolvedQRunStreamOptions = {
  replayPageSize: 200,
  replayMaxEvents: 10_000,
  safetyPollMs: 15_000,
  deltaQueueMax: 256,
};

export type QRunStreamOpenInput = {
  /** Already authorised through `authorize`. */
  readonly run: QRunRecord;
  /** The last durable sequence the client processed; 0 from the beginning. */
  readonly afterSequence: number;
  readonly signal: AbortSignal;
};

export type QRunStreamStats = {
  readonly noticeSubscribers: number;
  readonly deltaSubscribers: number;
  readonly deltasDropped: number;
};

export type QRunStreamService = {
  /** The run as its owner, or QRunNotFoundError (same answer for a stranger). */
  readonly authorize: (
    actor: ActorContext,
    runId: QRunId,
    correlationId?: CorrelationId,
  ) => Promise<QRunRecord>;
  readonly open: (input: QRunStreamOpenInput) => AsyncGenerator<QRunStreamItem>;
  readonly stats: () => QRunStreamStats;
};

export type QRunStreamDependencies = QRuntimeDependencies & {
  readonly notifier: QRunEventNotifier;
  readonly deltas?: QLiveDeltaBus | undefined;
  readonly options?: QRunStreamOptions | undefined;
};

type Wake = "WOKE" | "TIMEOUT" | "ABORTED";

export function createQRunStreamService(
  dependencies: QRunStreamDependencies,
): QRunStreamService {
  const { sql, repositories, notifier, deltas, logger } = dependencies;
  const options: ResolvedQRunStreamOptions = {
    replayPageSize:
      dependencies.options?.replayPageSize ?? DEFAULT_OPTIONS.replayPageSize,
    replayMaxEvents:
      dependencies.options?.replayMaxEvents ?? DEFAULT_OPTIONS.replayMaxEvents,
    safetyPollMs:
      dependencies.options?.safetyPollMs ?? DEFAULT_OPTIONS.safetyPollMs,
    deltaQueueMax:
      dependencies.options?.deltaQueueMax ?? DEFAULT_OPTIONS.deltaQueueMax,
  };
  let deltasDropped = 0;

  function deltaEvents(delta: QLiveDelta, cursor: number): QStreamEvent[] {
    // A frame is bounded by the contract; a longer fragment is several
    // frames. The sequence names the durable boundary the text follows.
    const events: QStreamEvent[] = [];
    if (delta.preview !== undefined) {
      // Parsed into the closed contract like every frame: a subject the
      // contract refuses is not sent at all, never sent half-checked.
      const parsed = QStreamEventSchema.safeParse({
        contractVersion: 1,
        eventId: randomUUID(),
        runId: delta.runId,
        sequence: Math.max(cursor, 1),
        occurredAt: new Date().toISOString(),
        type: "q.artifact.preview",
        data: {
          messageId: delta.messageId,
          subjects: delta.preview.subjects,
          layout: delta.preview.layout,
          ...(delta.preview.table === undefined
            ? {}
            : { table: delta.preview.table }),
        },
      });
      if (parsed.success) events.push(parsed.data);
    }
    for (let i = 0; i < delta.text.length; i += Q_STREAM_DELTA_MAX_LENGTH) {
      const text = delta.text.slice(i, i + Q_STREAM_DELTA_MAX_LENGTH);
      const parsed = QStreamEventSchema.safeParse({
        contractVersion: 1,
        eventId: randomUUID(),
        runId: delta.runId,
        sequence: Math.max(cursor, 1),
        occurredAt: new Date().toISOString(),
        type: "q.message.delta",
        data: {
          messageId: delta.messageId,
          text,
          ...(delta.holding === true ? { holding: true as const } : {}),
        },
      });
      if (parsed.success) {
        events.push(parsed.data);
      }
    }
    return events;
  }

  async function* open(
    input: QRunStreamOpenInput,
  ): AsyncGenerator<QRunStreamItem> {
    const { run, signal } = input;
    let cursor = input.afterSequence;
    let dirty = true;
    // A run that has already ended gets its remaining events and nothing
    // more (§43): there is no live phase to wait for.
    let runEnded = isTerminalQRunStatus(run.status);
    let replayed = 0;
    /** Live text waiting to go out, with when it arrived (wait is logged). */
    const pending: { readonly delta: QLiveDelta; readonly at: number }[] = [];
    let deltaWaitMaxMs = 0;
    let deltasSent = 0;
    /**
     * Live 2026-10-30 (run 2c8fd21b): the lead lines were published 4.9 s
     * after Enter, the browser painted them at 12.4 s, and this log's one
     * line (written at the stream's end) could not say when they left.
     * When the first and last live text left this stream, from its open.
     */
    const openedAt = Date.now();
    let firstDeltaMs: number | null = null;
    let lastDeltaMs: number | null = null;
    /** The first that was not a holding line: the answer's own text. */
    let firstTextMs: number | null = null;
    let wake: ((value: Wake) => void) | null = null;
    const wakeUp = (value: Wake) => {
      const current = wake;
      wake = null;
      current?.(value);
    };

    // Subscribe BEFORE the first read (§23): a notice for an event that
    // commits during the read only sets `dirty`, and the loop reads again.
    const unsubscribeNotices = notifier.subscribe(run.id, () => {
      dirty = true;
      wakeUp("WOKE");
    });
    const unsubscribeDeltas =
      deltas === undefined
        ? () => undefined
        : deltas.subscribe(run.id, (delta) => {
            if (delta.tenantId !== run.tenantId) {
              return;
            }
            if (pending.length >= options.deltaQueueMax) {
              pending.shift();
              deltasDropped += 1;
            }
            pending.push({ delta, at: Date.now() });
            wakeUp("WOKE");
          });
    const onAbort = () => wakeUp("ABORTED");
    signal.addEventListener("abort", onAbort, { once: true });

    const waitForWake = (): Promise<Wake> =>
      new Promise<Wake>((resolve) => {
        if (signal.aborted) {
          resolve("ABORTED");
          return;
        }
        const timer = setTimeout(() => {
          wake = null;
          resolve("TIMEOUT");
        }, options.safetyPollMs);
        wake = (value) => {
          clearTimeout(timer);
          resolve(value);
        };
      });

    /** Everything queued goes out now, one frame per message. */
    function* flushDeltas(): Generator<QRunStreamItem> {
      while (pending.length > 0 && !signal.aborted) {
        const queued = pending.splice(0, pending.length);
        const sentAt = Date.now();
        for (const { at } of queued) {
          deltaWaitMaxMs = Math.max(deltaWaitMaxMs, sentAt - at);
        }
        deltasSent += queued.length;
        firstDeltaMs ??= sentAt - openedAt;
        lastDeltaMs = sentAt - openedAt;
        if (queued.some(({ delta }) => delta.holding !== true)) {
          firstTextMs ??= sentAt - openedAt;
        }
        for (const delta of coalesceDeltas(queued.map((one) => one.delta))) {
          for (const event of deltaEvents(delta, cursor)) {
            yield { kind: "delta", event };
          }
        }
      }
    }

    /**
     * A durable re-read, with live text let through while it waits.
     *
     * Live 2026-10-30 (run 2): the answer's opening lines were published
     * about 3.4 s before the browser showed them. Text queued while the
     * stream re-read the event table (each stage, finding or message is a
     * re-read) went out only after that read returned, and the read shares
     * the database pool with the answer's own reads at exactly that moment.
     * A delta needs nothing from the table: it is presentation only, keyed
     * by its message id, and the client drops one whose message is already
     * persisted, so sending it ahead of a pending durable event is safe.
     */
    async function* readingWithDeltas<T>(
      work: Promise<T>,
    ): AsyncGenerator<QRunStreamItem, T> {
      type Settled =
        | { readonly ok: true; readonly value: T }
        | { readonly ok: false; readonly error: unknown };
      // Set by the callbacks below; read through a box so the type is not
      // narrowed to its initial null.
      const box: { outcome: Settled | null } = { outcome: null };
      void work.then(
        (value) => {
          box.outcome = { ok: true, value };
          wakeUp("WOKE");
        },
        (error: unknown) => {
          box.outcome = { ok: false, error };
          wakeUp("WOKE");
        },
      );
      for (;;) {
        const settled = box.outcome;
        if (settled !== null) {
          if (settled.ok) return settled.value;
          throw settled.error;
        }
        if (pending.length > 0 && !signal.aborted) {
          yield* flushDeltas();
          continue;
        }
        // Woken by the read settling, a delta, a notice or an abort; an
        // abort still waits for the read, which is bounded.
        await new Promise<void>((resolve) => {
          wake = () => resolve();
        });
      }
    }

    try {
      while (!signal.aborted) {
        if (dirty) {
          dirty = false;
          let page: readonly QRunEventRecord[];
          do {
            page = yield* readingWithDeltas(
              repositories.runEvents.listForRun(sql, run.tenantId, run.id, {
                afterSequence: cursor,
                limit: options.replayPageSize,
              }),
            );
            for (const record of page) {
              // The cursor moves past every stored row, projected or not: a
              // record the contract refuses is skipped, never looped on.
              cursor = record.sequence;
              const event = projectPublicStreamEvent(record);
              if (event === null) {
                logger?.warn(
                  {
                    qRunId: run.id,
                    sequence: record.sequence,
                    eventType: record.eventType,
                  },
                  "q run event not projectable; skipped",
                );
                continue;
              }
              replayed += 1;
              if (signal.aborted) {
                return;
              }
              yield { kind: "durable", event };
              if (isTerminalQStreamEvent(event)) {
                yield { kind: "end", reason: "TERMINAL" };
                return;
              }
            }
            if (replayed >= options.replayMaxEvents) {
              logger?.warn(
                { qRunId: run.id, replayed },
                "q run stream replay limit reached",
              );
              yield { kind: "end", reason: "REPLAY_LIMIT" };
              return;
            }
          } while (page.length >= options.replayPageSize && !signal.aborted);
          if (runEnded && !dirty) {
            // The run is over but no terminal event followed the cursor:
            // nothing more will ever be appended, so the stream ends now.
            yield { kind: "end", reason: "RUN_ENDED" };
            return;
          }
          continue;
        }

        // Everything queued while the last frame was being written goes
        // out as one frame per message, not one per fragment.
        yield* flushDeltas();
        if (dirty) {
          continue;
        }

        const woke = await waitForWake();
        if (woke === "ABORTED") {
          return;
        }
        if (woke === "TIMEOUT") {
          // Safety re-read (§55): bounded, on the heartbeat cadence, and the
          // only place the run's own status is consulted — a run that ended
          // without a terminal event visible to us ends the stream.
          dirty = true;
          const current = await repositories.runs.findForActor(
            sql,
            run.tenantId,
            run.actorUserId,
            run.id,
          );
          if (current === null || isTerminalQRunStatus(current.status)) {
            runEnded = true;
          }
        }
      }
    } finally {
      unsubscribeNotices();
      unsubscribeDeltas();
      signal.removeEventListener("abort", onAbort);
      if (deltasSent > 0) {
        // How long live text waited in this stream before going out; the
        // measure of the delivery lag a person sees (no content).
        logger?.info(
          {
            qRunId: run.id,
            deltasSent,
            deltaWaitMaxMs,
            firstDeltaMs,
            firstTextMs,
            lastDeltaMs,
          },
          "q stream live text delivery",
        );
      }
    }
  }

  return {
    authorize: (actor, runId, correlationId) =>
      ownedRun(dependencies, sql, actor, runId, correlationId),
    open,
    stats: () => ({
      noticeSubscribers: notifier.subscriberCount(),
      deltaSubscribers: deltas?.subscriberCount() ?? 0,
      deltasDropped,
    }),
  };
}
