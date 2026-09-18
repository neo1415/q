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
  approveQApprovalAction,
  askQAction,
  cancelQRunAction,
  continueQRunAction,
  readQConversationAction,
  rejectQApprovalAction,
} from "./actions";
import type { PendingTurn } from "./conversation";

/**
 * One live Q conversation in the browser (CQ-C5-R1 §13-§16; ADR 0012).
 *
 * The order below is the Q API's, not this hook's invention:
 *
 *   open a conversation (or none) → create run (or append to the one
 *   still open) → connect to that run's event stream → reduce durable
 *   events and deltas → terminal event → the next question opens a new
 *   run in the SAME conversation
 *
 * The conversation is the server's. Which one this surface is in comes
 * from the caller (the URL), and reopening it reads the recorded turns
 * back from the Q API under the person's own session: nothing is cached
 * in the browser, so what reappears after a refresh is what was said, and
 * a conversation this person may no longer read simply does not open. A
 * run still in flight when the page loads is followed from where it is.
 *
 * Why the two message lists: the stream reducer is per run, and correctly
 * refuses deltas once a run is terminal. A conversation outlives its runs,
 * so completed runs' messages move to `history` and the reducer starts
 * clean for the next one. Neither list is authoritative — both are what
 * the server sent.
 */

/** Where the browser reaches the Q event stream. Same origin, cookie-authenticated. */
const STREAM_BASE_URL = "/api/q-stream";

/** Something changed in this person's conversations: the list should be read again. */
export const Q_CONVERSATIONS_CHANGED_EVENT = "cq:q-conversations-changed";

export function announceConversationsChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(Q_CONVERSATIONS_CHANGED_EVENT));
  } catch {
    // Nothing listens, or no window: nothing to announce.
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
  /** True while the conversation named by the caller is being read back. */
  readonly loading: boolean;
  /** Something that went wrong outside the stream. Plain wording only. */
  readonly notice: string | null;
  readonly runId: string | null;
  /** The conversation this surface is in, once the server has named it. */
  readonly conversationId: string | null;
  readonly ask: (question: string) => Promise<void>;
  readonly stop: () => Promise<void>;
  /** Decide on what Q has prepared and is waiting for (CQ-Q-008). */
  readonly approve: () => Promise<void>;
  readonly decline: () => Promise<void>;
};

export type QConversationOptions = {
  /** The company this surface's questions are about, resolved on the server. */
  readonly companyId?: string | undefined;
  /** Or the investor organisation, for an investor. Never both. */
  readonly investorOrganisationId?: string | undefined;
  /**
   * The conversation to open, from the URL. Null opens nothing: the next
   * question starts a new one, and `onConversation` says which.
   */
  readonly conversationId?: string | null | undefined;
  /** The server named (or changed) the conversation this surface is in. */
  readonly onConversation?: ((conversationId: string) => void) | undefined;
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
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [conversationIdState, setConversationIdState] = useState<string | null>(
    options.conversationId ?? null,
  );

  const conversationId = useRef<string | null>(null);
  /** The conversation id last taken from the caller, so a URL the hook itself wrote is not reopened. */
  const opened = useRef<string | null | undefined>(undefined);
  const openRun = useRef<string | null>(null);
  /** Whether the open run has reached a terminal event. True when none is open. */
  const finished = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const onConversation = useRef(options.onConversation);
  useEffect(() => {
    onConversation.current = options.onConversation;
  }, [options.onConversation]);

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
          // A finished run may have named the conversation for the
          // first time; the list is read again either way.
          announceConversationsChanged();
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

  const reset = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setRunState(createQStreamState());
    setHistory([]);
    setPending([]);
    setTransport(null);
    setStreaming(false);
    setNotice(null);
    setRunId(null);
    openRun.current = null;
    finished.current = true;
  }, []);

  // Open the conversation the caller named, or start clean when it named
  // none. Every turn is read back from the server, so a refresh shows
  // what was actually recorded; a run still in flight is followed from
  // its cursor rather than reconstructed.
  const wanted = options.conversationId ?? null;
  useEffect(() => {
    if (opened.current === wanted) {
      return;
    }
    opened.current = wanted;
    if (wanted !== null && wanted === conversationId.current) {
      // Named by this hook a moment ago and written to the URL by the
      // caller: already open, nothing to read back.
      return;
    }
    let cancelled = false;
    // One microtask later, so the state changes belong to the open rather
    // than to the render that scheduled it.
    void Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        reset();
        conversationId.current = wanted;
        setConversationIdState(wanted);
        if (wanted === null) return null;
        setLoading(true);
        return readQConversationAction(wanted);
      })
      .then((result) => {
        if (cancelled || result === null) return;
        if (!result.ok) {
          // Not theirs, or gone: the surface starts clean and says so.
          conversationId.current = null;
          setConversationIdState(null);
          setNotice(result.message);
          return;
        }
        const detail = result.value;
        const latest = detail.latestRun;
        const live = latest !== null && !FINISHED_STATUSES.has(latest.status);
        if (live) {
          // Its own turns arrive again on the stream, so they are not
          // also taken from the recorded thread.
          setHistory(
            detail.messages.filter((message) => message.runId !== latest.runId),
          );
          openRun.current = latest.runId;
          finished.current = false;
          setRunId(latest.runId);
          follow(latest.runId);
        } else {
          setHistory(detail.messages);
          openRun.current = latest?.runId ?? null;
          finished.current = true;
          setRunId(latest?.runId ?? null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wanted, follow, reset]);

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
          options.companyId !== undefined
            ? { companyId: options.companyId }
            : options.investorOrganisationId !== undefined
              ? { investorOrganisationId: options.investorOrganisationId }
              : undefined,
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
        const named = started.value.conversationId ?? conversationId.current;
        const isNew = named !== null && named !== conversationId.current;
        conversationId.current = named;
        setConversationIdState(named);
        openRun.current = started.value.runId;
        setRunId(started.value.runId);
        if (isNew && named !== null) {
          // The caller writes it to the URL; that change is ours, not a
          // request to reopen.
          opened.current = named;
          onConversation.current?.(named);
          announceConversationsChanged();
        }
        follow(started.value.runId);
      } finally {
        setSubmitting(false);
      }
    },
    [
      follow,
      options.companyId,
      options.investorOrganisationId,
      runState.messages,
      streaming,
      submitting,
    ],
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

  // A decision on the open run's proposal. The run resumes on the server
  // after a yes and its remaining events are followed again from the
  // cursor, so what the gate did arrives the same way the answer did.
  const decide = useCallback(
    async (decision: "APPROVE" | "REJECT") => {
      const approval = runState.approval;
      const open = openRun.current;
      if (approval === null || open === null) {
        return;
      }
      const result =
        decision === "APPROVE"
          ? await approveQApprovalAction(approval.approvalId)
          : await rejectQApprovalAction(approval.approvalId);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setRunState((current) => ({ ...current, approval: null }));
      if (decision === "APPROVE") {
        finished.current = false;
        follow(open);
      }
    },
    [follow, runState.approval],
  );
  const approve = useCallback(() => decide("APPROVE"), [decide]);
  const decline = useCallback(() => decide("REJECT"), [decide]);

  return {
    state: { ...runState, messages: [...history, ...runState.messages] },
    pending,
    transport,
    // A run is "working" from the moment it is asked for until its stream
    // ends. Never inferred from elapsed time or the absence of text.
    working: submitting || streaming,
    loading,
    notice,
    runId,
    conversationId: conversationIdState,
    ask,
    stop,
    approve,
    decline,
  };
}
