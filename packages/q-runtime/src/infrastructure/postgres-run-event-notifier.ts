import type { DatabaseNotificationListener } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import type { QRunId } from "@capital-q/contracts";

import {
  Q_RUN_EVENTS_CHANNEL,
  QRunEventNoticeSchema,
  type QRunEventListener,
  type QRunEventNotifier,
} from "../application/stream.js";

/**
 * The wake-up that reaches every q-api instance (CQ-Q-009 §53-§54).
 *
 * The run-event repository issues `pg_notify` inside the transaction that
 * appends an event, so the notice is delivered on commit and only on
 * commit. This side LISTENs on one dedicated connection, opened on the
 * first subscription, and fans each notice out to the readers of that run.
 * A notice is `{ runId, sequence }` and nothing else: no payload, no
 * tenant name, no content. The reader re-reads the table.
 *
 * When the driver re-establishes the connection, every subscribed reader
 * is told to re-check (sequence 0): whatever was notified while the
 * connection was down is still in the table.
 */
export function createPostgresQRunEventNotifier(dependencies: {
  readonly listen: DatabaseNotificationListener;
  readonly logger?: Logger | undefined;
}): QRunEventNotifier {
  const { listen, logger } = dependencies;
  const listeners = new Map<string, Set<QRunEventListener>>();
  let subscription: Promise<{ readonly unlisten: () => Promise<void> }> | null =
    null;
  let closed = false;

  function dispatch(runId: string, sequence: number): void {
    const set = listeners.get(runId);
    if (set === undefined) {
      return;
    }
    const notice = QRunEventNoticeSchema.safeParse({ runId, sequence });
    if (!notice.success) {
      return;
    }
    for (const listener of set) {
      listener(notice.data);
    }
  }

  function ensureListening(): void {
    if (subscription !== null || closed) {
      return;
    }
    subscription = listen(
      Q_RUN_EVENTS_CHANNEL,
      (payload) => {
        let raw: unknown;
        try {
          raw = JSON.parse(payload);
        } catch {
          return;
        }
        const notice = QRunEventNoticeSchema.safeParse(
          typeof raw === "object" && raw !== null
            ? {
                runId: (raw as Record<string, unknown>)["runId"],
                sequence: (raw as Record<string, unknown>)["sequence"],
              }
            : raw,
        );
        if (notice.success) {
          dispatch(notice.data.runId, notice.data.sequence);
        }
      },
      () => {
        // (Re)connected: every reader re-checks its cursor.
        for (const runId of listeners.keys()) {
          dispatch(runId, 0);
        }
      },
    );
    subscription.catch((error: unknown) => {
      logger?.error({ err: error }, "q run event listener failed");
      subscription = null;
    });
  }

  return {
    subscribe: (runId: QRunId, listener) => {
      const set = listeners.get(runId) ?? new Set();
      set.add(listener);
      listeners.set(runId, set);
      ensureListening();
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
    close: async () => {
      closed = true;
      listeners.clear();
      const current = subscription;
      subscription = null;
      if (current !== null) {
        try {
          const meta = await current;
          await meta.unlisten();
        } catch (error: unknown) {
          logger?.warn({ err: error }, "q run event listener close failed");
        }
      }
    },
  };
}
