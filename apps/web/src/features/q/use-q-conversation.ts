"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createQStreamState,
  reduceQStream,
  streamQRunEvents,
  type QStreamState,
  type QStreamTransportStatus,
} from "@capital-q/api-client";
import { isTerminalQStreamEvent, type QMessage } from "@capital-q/contracts";

import {
  askQAction,
  cancelQRunAction,
  continueQRunAction,
  readQRunAction,
} from "./actions";
import type { PendingTurn } from "./conversation";

/**
 * One live Q conversation in the browser (CQ-C5-R1 §13-§16).
 *
 * The order below is the Q API's, not this hook's invention:
 *
 *   create run (or append to the one still open) → connect to that run's
 *   event stream → reduce durable events and deltas → terminal event →
 *   the next question opens a new run in the SAME conversation
 *
 * Three things it deliberately does not do. It does not own the
 * conversation: the server does, every message here arrived as a durable
 * event, and a reload rebuilds from the server rather than from memory. It
 * does not invent a stage, a status or an answer. And it never touches the
 * Q API directly — the session token lives in an HttpOnly cookie, so writes
 * go through server actions and the stream through the web app's own
 * single-purpose route.
 *
 * Why the two message lists: the stream reducer is per run, and correctly
 * refuses deltas once a run is terminal. A conversation outlives its runs,
 * so completed runs' messages move to `history` and the reducer starts
 * clean for the next one. Neither list is authoritative — both are what the
 * server sent.
 */

/** Where the browser reaches the Q event stream. Same origin, cookie-authenticated. */
const STREAM_BASE_URL = "/api/q-stream";

/**
 * Which run this tab was following, so a refresh reopens the conversation
 * rather than starting a new one.
 *
 * A run id, and nothing else. The conversation itself is never cached here:
 * on reload the turns are read back from the Q API under the person's own
 * session, so what reappears is what the server recorded — not a browser's
 * account of it, which could outlive the access that produced it.
 */
const RUN_STORAGE_KEY = "cq.q.run";

function rememberRun(runId: string | null): void {
  try {
    if (runId === null) {
      window.sessionStorage.removeItem(RUN_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(RUN_STORAGE_KEY, runId);
    }
  } catch {
    // Storage can be unavailable or full. Losing the pointer costs a
    // reopened conversation, never a lost one: the server still has it.
  }
}

function rememberedRun(): string | null {
  try {
    return window.sessionStorage.getItem(RUN_STORAGE_KEY);
  } catch {
    return null;
  }
}

const FINISHED_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);

export type QConversation = {
  /** The current run's stream state, with the conversation's earlier turns folded in. */
  readonly state: QStreamState;
  readonly pending: readonly PendingTurn[];
  readonly transport: QStreamTransportStatus | null;
  /** True from submit until the run's stream ends. */
  readonly working: boolean;
  /** Something that went wrong outside the stream. Plain wording only. */
  readonly notice: string | null;
  readonly runId: string | null;
  readonly ask: (question: string) => Promise<void>;
  readonly stop: () => Promise<void>;
};

export type QConversationOptions = {
  /** The company this surface's questions are about, resolved on the server. */
  readonly companyId?: string | undefined;
};

export function useQConversation(
  options: QConversationOptions = {},
): QConversation {
  const [runState, setRunState] = useState<QStreamState>(createQStreamState);
  const [history, setHistory] = useState<readonly QMessage[]>([]);
  const [pending, setPending] = useState<readonly PendingTurn[]>([]);
  const [transport, setTransport] = useState<QStreamTransportStatus | null>(
    null,
  );
  /** A submit in flight: the run has been asked for but is not streaming yet. */
  const [submitting, setSubmitting] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const conversationId = useRef<string | null>(null);
  const openRun = useRef<string | null>(null);
  /** Whether the open run has reached a terminal event. True when none is open. */
  const finished = useRef(true);
  const abort = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  const follow = useCallback((run: string) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setStreaming(true);
    void streamQRunEvents({ baseUrl: STREAM_BASE_URL, accessToken: "" }, run, {
      signal: controller.signal,
      onStatus: (status) => {
        setTransport(status);
      },
      onEvent: (event) => {
        setRunState((current) => reduceQStream(current, event));
        if (isTerminalQStreamEvent(event)) {
          finished.current = true;
        }
      },
    })
      .catch(() => {
        // A refusal on the stream is not a failed run — the run may still
        // be recorded and answered. Say so plainly; do not claim it failed.
        setNotice("I lost the connection to Q. Please try again.");
      })
      .finally(() => {
        if (abort.current === controller) {
          setStreaming(false);
        }
      });
  }, []);

  // Reopen the conversation this tab was in (§15, §44). The run is read
  // back from the server, so a refresh shows the turns that were actually
  // recorded; a run this person may no longer read simply does not return.
  useEffect(() => {
    const remembered = rememberedRun();
    if (remembered === null) {
      return;
    }
    let cancelled = false;
    void readQRunAction(remembered).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        rememberRun(null);
        return;
      }
      openRun.current = result.value.runId;
      conversationId.current = result.value.conversationId ?? null;
      setRunId(result.value.runId);
      setHistory(result.value.messages ?? []);
      // A run still in flight keeps streaming; a finished one does not
      // reconnect, because there is nothing further to receive.
      const live = !FINISHED_STATUSES.has(result.value.status);
      finished.current = !live;
      if (live) {
        follow(result.value.runId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [follow]);

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (text.length === 0 || submitting || streaming) {
        return;
      }
      setNotice(null);
      setSubmitting(true);
      const placeholder: PendingTurn = {
        id: crypto.randomUUID(),
        text,
        at: new Date().toISOString(),
      };
      setPending((current) => [...current, placeholder]);
      const drop = () => {
        setPending((current) =>
          current.filter((turn) => turn.id !== placeholder.id),
        );
      };

      try {
        const open = openRun.current;
        if (open !== null && !finished.current) {
          // The run is still live: this is its next turn, and the stream
          // already open will carry the answer.
          const appended = await continueQRunAction(open, text);
          if (!appended.ok) {
            drop();
            setNotice(appended.message);
          }
          return;
        }

        const started = await askQAction(
          text,
          conversationId.current ?? undefined,
          options.companyId,
        );
        if (!started.ok) {
          drop();
          setNotice(started.message);
          return;
        }

        // The finished run's turns become the conversation's history, and
        // the reducer starts clean for the run about to begin.
        setHistory((current) => [...current, ...runState.messages]);
        setRunState(createQStreamState());
        finished.current = false;
        conversationId.current =
          started.value.conversationId ?? conversationId.current;
        openRun.current = started.value.runId;
        setRunId(started.value.runId);
        rememberRun(started.value.runId);
        follow(started.value.runId);
      } finally {
        setSubmitting(false);
      }
    },
    [follow, options.companyId, runState.messages, streaming, submitting],
  );

  const stop = useCallback(async () => {
    const open = openRun.current;
    if (open === null) {
      return;
    }
    const result = await cancelQRunAction(open);
    if (!result.ok) {
      setNotice(result.message);
    }
  }, []);

  return {
    state: { ...runState, messages: [...history, ...runState.messages] },
    pending,
    transport,
    // A run is "working" from the moment it is asked for until its stream
    // ends. Never inferred from elapsed time or the absence of text.
    working: submitting || streaming,
    notice,
    runId,
    ask,
    stop,
  };
}
