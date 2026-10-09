"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createQStreamState,
  reduceQStream,
  type QStreamState,
  type QStreamTransportStatus,
} from "@capital-q/api-client";
import type { QMessage, QViewingMoment } from "@capital-q/contracts";

import {
  approveQApprovalAction,
  askQAction,
  cancelQRunAction,
  continueQRunAction,
  pendingQApprovalsAction,
  readQConversationAction,
  rejectQApprovalAction,
  type QStartedRun,
  type QSubjectInput,
} from "./actions";
import { carriedApproval, type CarriedApproval } from "./carried-approval";
import type { PendingTurn } from "./conversation";
import { navigationHeard } from "./control/fast-navigation";
import { noteTypedRun } from "./follow-navigation";
import { currentScreen, currentViewing } from "./screen";
import {
  forgetPendingAsk,
  readPendingAsk,
  rememberPendingAsk,
} from "./pending-ask";

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

/** The record holds its newest run's outcome: nothing more will land. */
export function recordSettled(
  latestRun: { readonly status: string } | null,
): boolean {
  return latestRun === null || FINISHED_STATUSES.has(latestRun.status);
}

export type QConversation = {
  /** The current run's stream state, with the conversation's earlier turns folded in. */
  readonly state: QStreamState;
  readonly pending: readonly PendingTurn[];
  readonly transport: QStreamTransportStatus | null;
  /** True from submit until the run's stream ends, except while the run waits on the person's approval. */
  readonly working: boolean;
  /** True while the conversation named by the caller is being read back. */
  readonly loading: boolean;
  /** Something that went wrong outside the stream. Plain wording only. */
  readonly notice: string | null;
  readonly runId: string | null;
  /** The conversation this surface is in, once the server has named it. */
  readonly conversationId: string | null;
  /** `viewing`: where in a pitch the person was; sent only when a run starts. */
  readonly ask: (
    question: string,
    extras?: {
      readonly viewing?: QViewingMoment | undefined;
      /** What the surface said first; sent only when a conversation starts. */
      readonly opening?: string | undefined;
    },
  ) => Promise<void>;
  readonly stop: () => Promise<void>;
  /**
   * Read the open conversation back from the server. For turns recorded
   * by another channel -- a voice line -- which this surface's stream
   * never carried, so their result blocks (a document card, companies)
   * reach the stage and the Board. Does nothing while a typed run is
   * still streaming: that stream is the source of truth for it.
   *
   * Resolves true once the record holds the conversation's newest run as
   * finished (its answer, and the answer's cards, are in what was read);
   * false when it could not read, or the run is still going, so a voice
   * turn's caller knows to read again (P10).
   */
  readonly refresh: () => Promise<boolean>;
  /**
   * voice-cards: Q's answer as the room feed delivered it (a run this
   * page did not start: a spoken one, the duplex line's ask_q). Added to
   * this conversation once, by message id, unless the stream or the
   * record already holds it; never guarded on a run being in flight.
   */
  readonly absorb: (message: QMessage) => void;
  /** Decide on what Q has prepared and is waiting for (CQ-Q-008). */
  readonly approve: () => Promise<void>;
  readonly decline: () => Promise<void>;
  /**
   * The person edited what Q prepared (BIZ-007: an email's words). The
   * server voided the old approval and requested a new one on the same
   * run; follow the run again so the new proposal arrives as the first did.
   */
  readonly revised: () => void;
};

export type QConversationOptions = {
  /** The company this surface's questions are about, resolved on the server. */
  readonly companyId?: string | undefined;
  /** Or the investor organisation, for an investor. Never both. */
  readonly investorOrganisationId?: string | undefined;
  /** Or a relationship itself, for either of its parties (never with the others). */
  readonly relationshipId?: string | undefined;
  /**
   * The conversation to open, from the URL. Null opens nothing: the next
   * question starts a new one, and `onConversation` says which.
   */
  readonly conversationId?: string | null | undefined;
  /** The server named (or changed) the conversation this surface is in. */
  readonly onConversation?: ((conversationId: string) => void) | undefined;
};

/** The one subject a surface names, in the order the options document. */
function subjectInputOf(options: {
  readonly companyId?: string | undefined;
  readonly investorOrganisationId?: string | undefined;
  readonly relationshipId?: string | undefined;
}): QSubjectInput | undefined {
  return options.companyId !== undefined
    ? { companyId: options.companyId }
    : options.investorOrganisationId !== undefined
      ? { investorOrganisationId: options.investorOrganisationId }
      : options.relationshipId !== undefined
        ? { relationshipId: options.relationshipId }
        : undefined;
}

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
  /** A change still waiting in this conversation whose run is not the open one. */
  const [carried, setCarried] = useState<CarriedApproval | null>(null);

  const conversationId = useRef<string | null>(null);
  /** The conversation id last taken from the caller, so a URL the hook itself wrote is not reopened. */
  const opened = useRef<string | null | undefined>(undefined);
  const openRun = useRef<string | null>(null);
  /** Whether the open run has reached a terminal event. True when none is open. */
  const finished = useRef(true);
  const abort = useRef<AbortController | null>(null);
  /** Recovers a question a reload interrupted (H1); set below, once `begin` exists. */
  const recoverRef = useRef<() => void>(() => undefined);
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
    // W7: the stream (and the contracts it checks events against) loads
    // with the first run followed, not with the page.
    void import("./q-stream-transport")
      .then(({ streamQRunEvents, isTerminalQStreamEvent }) =>
        streamQRunEvents({ baseUrl: STREAM_BASE_URL, accessToken: "" }, run, {
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
        }),
      )
      .catch(() => {
        // A refusal on the stream is not a failed run — the run may still
        // be recorded and answered. Say so plainly; do not claim it failed.
        setNotice("I lost the connection to Q. Try again.");
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
    /**
     * What this effect had opened before, so an abandoned open can be
     * taken back (QX-003A).
     *
     * The mark below says "this conversation is open". It is set before
     * the read it guards, which is correct only if the read then happens.
     * When the effect is cleaned up first the read never lands, and a
     * second invocation used to find the conversation already marked open
     * and return early — leaving the surface empty for the rest of the
     * page's life, with a successful read, a correct merge and no error
     * anywhere to show for it.
     *
     * React's development double-invoke is the reliable way to produce
     * that second invocation, but it is not the only one: any remount of
     * this surface does the same thing in any build.
     */
    const previously = opened.current;
    opened.current = wanted;
    if (wanted !== null && wanted === conversationId.current) {
      // Named by this hook a moment ago and written to the URL by the
      // caller: already open, nothing to read back.
      return;
    }
    let cancelled = false;
    /** True until the open has run; a cleanup before that abandons it. */
    let opening = true;
    // One microtask later, so the state changes belong to the open rather
    // than to the render that scheduled it.
    void Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        reset();
        conversationId.current = wanted;
        setConversationIdState(wanted);
        if (wanted === null) {
          // A surface that names no conversation may be a reload of one
          // whose first question was still being accepted (H1, below).
          // Asked from here, after the reset, so nothing clears it again,
          // and only by the open that was not abandoned.
          recoverRef.current();
          return null;
        }
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
          // Q's side of the live run arrives again on the stream, so it is
          // not also taken from the recorded thread. The person's own
          // question is not on the stream at all: it is only ever in the
          // record, so it stays. Dropping it left a conversation opened
          // mid-run (a Home card that started the run, then /home?c=)
          // showing Q's answer to a question nobody asked.
          setHistory(
            detail.messages.filter(
              (message) =>
                message.runId !== latest.runId || message.role === "USER",
            ),
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
        opening = false;
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (opening) {
        // Abandoned before it opened anything: the mark would otherwise
        // claim a conversation is open that was never read.
        opened.current = previously;
      }
    };
  }, [wanted, follow, reset]);

  /** A run the Q API accepted: this surface is now in its conversation, following it. */
  const begin = useCallback(
    (started: QStartedRun) => {
      // The finished run's turns become the conversation's history, and
      // the reducer starts clean for the run about to begin.
      setHistory((current) => [...current, ...runState.messages]);
      setRunState(createQStreamState());
      finished.current = false;
      const named = started.conversationId ?? conversationId.current;
      const isNew = named !== null && named !== conversationId.current;
      conversationId.current = named;
      setConversationIdState(named);
      openRun.current = started.runId;
      setRunId(started.runId);
      // Started from a typed question (ask, or its resume after a reload).
      noteTypedRun(started.runId);
      if (isNew && named !== null) {
        // The caller writes it to the URL; that change is ours, not a
        // request to reopen.
        opened.current = named;
        onConversation.current?.(named);
        announceConversationsChanged();
      }
      follow(started.runId);
    },
    [follow, runState.messages],
  );

  const awaitingPerson = runState.approval !== null;
  const ask = useCallback(
    async (
      question: string,
      extras?: {
        readonly viewing?: QViewingMoment | undefined;
        /**
         * What the surface said before this question (Home's welcome), so
         * a new conversation starts with it; ignored when one is open.
         */
        readonly opening?: string | undefined;
      },
    ) => {
      const text = question.trim();
      // A run paused on an approval is waiting for the person, not busy:
      // what they type starts the conversation's next turn ("go ahead"
      // approves through the Approval Engine, the same as the card).
      if (text.length === 0 || submitting || (streaming && !awaitingPerson)) {
        return;
      }
      setNotice(null);
      setSubmitting(true);
      // RECOVERY-2026-10 (C, "stupid fast"): a typed "open X" moves the
      // screen now, beside the run; the answer does not move it again.
      void navigationHeard(text);
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
        // A run paused on an approval takes no more turns: a message
        // appended to it is stored and never answered (live 2026-09-28 #4:
        // "go ahead" sat unanswered and the change stayed "approval
        // needed"). What they type then is a new turn of the conversation,
        // where Q approves the waiting change through the Approval Engine
        // exactly as the card does.
        if (open !== null && !finished.current && !awaitingPerson) {
          // The run is still live: this is its next turn, and the stream
          // already open will carry the answer.
          const appended = await continueQRunAction(open, text);
          if (!appended.ok) {
            drop();
            setNotice(appended.message);
          }
          return;
        }

        // A question that starts a conversation is remembered for this
        // tab until the conversation is named, so a reload in between
        // reopens it (CQ-QX-007 H1; pending-ask.ts).
        const idempotencyKey = crypto.randomUUID();
        const startsConversation = conversationId.current === null;
        if (startsConversation) {
          rememberPendingAsk({
            idempotencyKey,
            text,
            at: placeholder.at,
            ...(options.companyId === undefined
              ? {}
              : { companyId: options.companyId }),
            ...(options.investorOrganisationId === undefined
              ? {}
              : { investorOrganisationId: options.investorOrganisationId }),
            ...(options.relationshipId === undefined
              ? {}
              : { relationshipId: options.relationshipId }),
          });
        }
        const started = await askQAction(
          text,
          conversationId.current ?? undefined,
          subjectInputOf({
            companyId: options.companyId,
            investorOrganisationId: options.investorOrganisationId,
            relationshipId: options.relationshipId,
          }),
          idempotencyKey,
          // R18/R21: the pitch on screen as they ask, read now (the dock
          // may have opened on another card); else the opening's moment.
          currentViewing() ?? extras?.viewing,
          // R21: the screen they asked from, resolved or dropped server-side.
          currentScreen(),
          startsConversation ? extras?.opening : undefined,
        );
        if (!started.ok) {
          forgetPendingAsk(idempotencyKey);
          drop();
          setNotice(started.message);
          return;
        }
        begin(started.value);
        forgetPendingAsk(idempotencyKey);
      } finally {
        setSubmitting(false);
      }
    },
    [
      begin,
      options.companyId,
      options.investorOrganisationId,
      options.relationshipId,
      streaming,
      submitting,
      awaitingPerson,
    ],
  );

  /**
   * A reload while the question that started this conversation was still
   * being accepted (CQ-QX-007 H1). The same question is asked again under
   * the same key: the Q API hands back the run it already created — or
   * creates it, if the first request never arrived — and the page is in
   * that conversation, following that run, as if it had never reloaded.
   * Only on a surface that names no conversation and is about the same
   * subject the question was asked about.
   */
  useEffect(() => {
    recoverRef.current = () => {
      const remembered = readPendingAsk();
      if (
        remembered === null ||
        remembered.companyId !== options.companyId ||
        remembered.investorOrganisationId !== options.investorOrganisationId ||
        remembered.relationshipId !== options.relationshipId
      ) {
        return;
      }
      const placeholder: PendingTurn = {
        id: crypto.randomUUID(),
        text: remembered.text,
        at: remembered.at,
      };
      setPending((current) => [...current, placeholder]);
      setSubmitting(true);
      void askQAction(
        remembered.text,
        undefined,
        subjectInputOf(remembered),
        remembered.idempotencyKey,
      )
        .then((started) => {
          forgetPendingAsk(remembered.idempotencyKey);
          if (!started.ok) {
            setPending((current) =>
              current.filter((turn) => turn.id !== placeholder.id),
            );
            setNotice(started.message);
            return;
          }
          begin(started.value);
        })
        .finally(() => {
          setSubmitting(false);
        });
    };
  }, [
    begin,
    options.companyId,
    options.investorOrganisationId,
    options.relationshipId,
  ]);

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

  // The change still waiting in this conversation, found again whenever
  // the thread settles: its card stays until it is decided (QA 2026-10-01).
  const live = runState.approval !== null;
  useEffect(() => {
    if (streaming || live || conversationIdState === null) return;
    let current = true;
    const id = conversationIdState;
    void pendingQApprovalsAction().then((result) => {
      if (!current || !result.ok) return;
      setCarried(carriedApproval(id, history, result.value));
    });
    return () => {
      current = false;
    };
  }, [streaming, live, conversationIdState, history]);

  // A decision on the open run's proposal. The run resumes on the server
  // after a yes and its remaining events are followed again from the
  // cursor, so what the gate did arrives the same way the answer did.
  const decide = useCallback(
    async (decision: "APPROVE" | "REJECT") => {
      if (runState.approval === null && carried !== null) {
        // A change from an earlier run of this conversation: decided by
        // the same engine calls; the thread is read back once it has run.
        const result =
          decision === "APPROVE"
            ? await approveQApprovalAction(carried.approval.approvalId)
            : await rejectQApprovalAction(carried.approval.approvalId);
        if (!result.ok) {
          setNotice(result.message);
          return;
        }
        setCarried(null);
        const id = conversationId.current;
        if (id !== null) {
          for (const wait of [3_000, 10_000]) {
            setTimeout(() => {
              void readQConversationAction(id).then((read) => {
                if (
                  read.ok &&
                  conversationId.current === id &&
                  finished.current
                ) {
                  setHistory(read.value.messages);
                }
              });
            }, wait);
          }
        }
        return;
      }
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
    [follow, runState.approval, carried],
  );
  const approve = useCallback(() => decide("APPROVE"), [decide]);
  const revised = useCallback(() => {
    const open = openRun.current;
    if (open === null) return;
    setRunState((current) => ({ ...current, approval: null }));
    finished.current = false;
    follow(open);
  }, [follow]);
  const decline = useCallback(() => decide("REJECT"), [decide]);

  const refresh = useCallback(async (): Promise<boolean> => {
    const id = conversationId.current;
    if (id === null || !finished.current) return false;
    const result = await readQConversationAction(id);
    // Only if nothing moved while the read was out: same conversation, and
    // no typed run started in the meantime.
    if (!result.ok || conversationId.current !== id || !finished.current) {
      return false;
    }
    setHistory(result.value.messages);
    // Every finished run's messages are in the record now; keeping the
    // streamed copy as well would show them twice.
    setRunState(createQStreamState());
    return recordSettled(result.value.latestRun);
  }, []);

  const streamedMessages = useRef<readonly QMessage[]>([]);
  useEffect(() => {
    streamedMessages.current = runState.messages;
  }, [runState.messages]);
  const absorb = useCallback((message: QMessage) => {
    if (
      streamedMessages.current.some(
        (streamed) => streamed.messageId === message.messageId,
      )
    ) {
      return;
    }
    setHistory((current) =>
      current.some((held) => held.messageId === message.messageId)
        ? current
        : [...current, message],
    );
  }, []);

  return {
    state: {
      ...runState,
      messages: [...history, ...runState.messages],
      ...(runState.approval === null && carried !== null
        ? {
            approval: carried.approval,
            proposals: runState.proposals.some(
              (proposal) => proposal.proposalId === carried.proposal.proposalId,
            )
              ? runState.proposals
              : [...runState.proposals, carried.proposal],
          }
        : {}),
    },
    pending,
    transport,
    // A run is "working" from the moment it is asked for until its stream
    // ends. Never inferred from elapsed time or the absence of text.
    // A run paused on the person's approval is not working: the composer
    // stays open for "go ahead", and nothing says "Q is working".
    working: submitting || (streaming && !awaitingPerson),
    loading,
    notice,
    runId,
    conversationId: conversationIdState,
    ask,
    stop,
    approve,
    decline,
    revised,
    refresh,
    absorb,
  };
}
