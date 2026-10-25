"use client";

import { useEffect, useState } from "react";

import type { QStreamEvent } from "@capital-q/contracts";

import { startPacedPoll, type PacedPoll } from "@/features/polling/paced-poll";

import { preparedAction, type Prepared } from "./work-page-actions";

/** The stream route the Q page follows runs through (same origin). */
const STREAM_BASE_URL = "/api/q-stream";
/** Fallback only: the run's own stream is the signal. */
const PREPARED_PACE = { firstMs: 1_200, maxMs: 10_000 } as const;
/** How long a run may stay WORKING before it reads as failed. */
const PREPARED_LIMIT_MS = 90_000;

/** The events after which the run's outcome can be read. */
const SETTLES: ReadonlySet<QStreamEvent["type"]> = new Set([
  "q.approval.required",
  "q.input.required",
  "q.run.completed",
  "q.run.failed",
]);

export function settlesPrepared(event: QStreamEvent): boolean {
  return SETTLES.has(event.type);
}

/**
 * Follows a run Q was asked to prepare until a card, an answer or a
 * failure (egress review 2026-10-24: it read the run every 1.2 s). It reads
 * once, then waits on the run's event stream and reads again when the run
 * settles; only if the stream is unavailable does it poll, paced and never
 * while the tab is hidden.
 */
export function usePrepared(runId: string): Prepared | null {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  useEffect(() => {
    let live = true;
    const started = Date.now();
    const stream = new AbortController();
    let poll: PacedPoll | null = null;

    /** One read; true once there is nothing more to wait for. */
    const read = async (): Promise<boolean> => {
      const result = await preparedAction(runId).catch(() => null);
      if (!live) return true;
      const value: Prepared =
        result?.ok === true ? result.value : { state: "FAILED" };
      if (value.state !== "WORKING") {
        setPrepared(value);
        return true;
      }
      if (Date.now() - started > PREPARED_LIMIT_MS) {
        setPrepared({ state: "FAILED" });
        return true;
      }
      setPrepared(value);
      return false;
    };
    const fallBack = () => {
      if (!live || poll !== null) return;
      poll = startPacedPoll(
        async () => ((await read()) ? "done" : "same"),
        PREPARED_PACE,
      );
    };
    const settle = async () => {
      if (await read()) {
        stream.abort();
        return;
      }
      // Settled on the stream, but the card is not listed yet: a short,
      // paced wait for it.
      fallBack();
    };

    // A run that never settles still ends: past the limit it reads once
    // more, and a run still working then is shown as failed.
    const limit = window.setTimeout(() => {
      void read().then((done) => {
        if (!done) return;
        stream.abort();
        poll?.stop();
      });
    }, PREPARED_LIMIT_MS + 1);

    void read().then((done) => {
      if (done || !live) return;
      void import("@/features/q/q-stream-transport")
        .then(({ streamQRunEvents }) =>
          streamQRunEvents(
            { baseUrl: STREAM_BASE_URL, accessToken: "" },
            runId,
            {
              signal: stream.signal,
              // A stream that keeps failing hands over soon, not after
              // twenty reconnects.
              backoff: { maxAttempts: 3 },
              onEvent: (event) => {
                if (settlesPrepared(event)) void settle();
              },
            },
          ),
        )
        .then((closed) => {
          // A stream that ended without the run settling (refused, lost,
          // gave up) hands over to the paced poll.
          if (closed.reason !== "ABORTED" && closed.reason !== "TERMINAL")
            fallBack();
        })
        .catch(fallBack);
    });

    return () => {
      live = false;
      window.clearTimeout(limit);
      stream.abort();
      poll?.stop();
    };
  }, [runId]);
  return prepared;
}
