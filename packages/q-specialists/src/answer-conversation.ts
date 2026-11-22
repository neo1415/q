// W3-B (audit finding 4): moved unchanged out of answer.ts, which
// re-exports what it exported. Here: the conversation state an answer reads, and its fixed replies.
import {
  type DatabaseExecutor,
  type TransactionManager,
} from "@capital-q/database";
import { TURN_READER_ATTEMPT_TIMEOUT_MS } from "@capital-q/model-gateway/q";
import { type Logger } from "@capital-q/observability";
import {
  type QAnswerPort,
  type QConversationMessage,
  type QConversationState,
  type QConversationSummaryRevision,
  type QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { type TenantId, type UserId } from "@capital-q/security";

import { type CompanyIntelligenceResult } from "./company/contracts.js";
import { foldConversationState } from "./conversation-ledger.js";

export type SpecialistQAnswer = QAnswerPort & {
  /** The last investigation, for developer smokes and evals. Never a public path. */
  readonly lastResult: () => CompanyIntelligenceResult | null;
};

export const ANSWER_LIMIT_CHARS = 32_000;

/**
 * The extra reading after a failed one is bounded: it goes to the fallback
 * model the gateway has not parked, which reads a turn in about a second;
 * one still unread after this is answered as unread rather than holding
 * the turn for another full gateway budget (production: a failed reading
 * plus its retry stacked past 10 s).
 */
/**
 * Live 2026-10-29 (run B): both first attempts timed out on a slow spell,
 * and the 2.5 s re-read was cancelled before its model answered (p50
 * 2.0 s, p90 4.2 s, p99 5.5 s) -- shorter than the reader's own hedge
 * (3.5 s), so it could never get a second chance. One fresh reading gets
 * the reader's whole attempt: its hedge can fire.
 *
 * Live 2026-10-30 (run 8bc5116c): this deadline equalled the attempt's
 * own timeout (6 s), so the re-read's model answered at 5,986 ms and was
 * thrown away by this cut-off a few milliseconds later, paid for. It now
 * covers the attempt plus the gateway's own work around it (prompt,
 * validation, the usage record), so an attempt that answers in time is
 * never discarded here.
 */
export const TURN_REREAD_DEADLINE_MS = TURN_READER_ATTEMPT_TIMEOUT_MS + 1_000;

/**
 * What Q says when its turn could not be read even on the extra try
 * (live 2026-10-30, run 8bc5116c): "Plan my raise over 8 weeks" was
 * answered by the general answer as a chat memo about the raise, told in
 * a prompt note that it could not start anything; it wrote around that
 * note, the plan was never started and nothing said so. Not knowing what
 * kind of request a turn is, Q does not guess one: no answer path is
 * chosen for it, nothing is started, and it says so in code's own words.
 * Sent again, the turn is read afresh (the same ask in a new chat started
 * the plan). Localised to the turn's language like any recorded answer.
 */
export const TURN_UNREAD_REPLY =
  "Sorry, I couldn't read that request just now, so I haven't started anything. Please send it again in a moment.";

/**
 * What Q says instead when the turn went unread because no reasoning route
 * could be reached at all (an exhausted provider account, a refused key,
 * an outage). Live 2026-10-31: OpenAI credit ran out and every turn was
 * told TURN_UNREAD_REPLY, as if the person's words were the problem. It is
 * Q's side; their message is kept on the thread.
 */
export const TURN_UNREACHABLE_REPLY =
  "I can't reach my reasoning service right now, so I haven't started anything on that yet. It's a temporary fault on my side, not in your message, and your message is kept here. I check again about every 30 seconds, so send it again in a minute or two and I'll take it from there.";

/**
 * Live 14 Nov 2026 (run b58ece1a): the answer came back malformed
 * (INVALID_MODEL_OUTPUT) and the person was told Q could not reach its
 * reasoning service, which had answered. What is true: the answer was
 * unusable, and nothing was prepared or sent on it.
 */
export const MALFORMED_ANSWER_LINE =
  "That answer came back malformed on my side, so nothing was prepared or sent. Ask again and I'll redo it.";

/**
 * How much of the conversation the specialist reads (CQ-QX-007 H3a).
 * Enough to carry a correction made a few turns back; bounded so a long
 * conversation does not become a long prompt.
 */
const CONVERSATION_TURNS_MAX = 12;

const CONVERSATION_TURN_CHARS_MAX = 4_000;

/** The conversation before this message, as the prompt's DATA. */
export function earlierTurns(
  history: readonly QConversationMessage[],
  latestId: string,
): readonly { readonly role: "USER" | "Q"; readonly content: string }[] {
  return history
    .filter((message) => message.id !== latestId)
    .flatMap((message) =>
      (message.role === "USER" || message.role === "Q") &&
      message.content.trim().length > 0
        ? [
            {
              role: message.role,
              content: message.content.slice(0, CONVERSATION_TURN_CHARS_MAX),
            },
          ]
        : [],
    )
    .slice(-CONVERSATION_TURNS_MAX);
}

/**
 * What a person reads when the specialist could not produce findings.
 *
 * Plain English, and specific enough to be useful without naming a
 * provider, a schema, a policy code or a table (§105). "No eligible route"
 * is deliberately not phrased as an outage: refusing to send private
 * material to an unsuitable provider is Capital Q working, not failing.
 */
export function publicBlockedMessage(
  reason: NonNullable<CompanyIntelligenceResult["blocked"]>,
): string {
  switch (reason) {
    case "NO_AUTHORISED_SUBJECT":
      return "I don't have access to that company's information in this conversation, so I can't analyse it.";
    case "NO_ELIGIBLE_MODEL_ROUTE":
      return "Some of the information involved is too sensitive to send for analysis with the options available right now, so I've stopped rather than work around it. I can still answer from what's already recorded if you'd like to ask something narrower.";
    case "MODEL_UNAVAILABLE":
      return "I couldn't get a full review through just now. I can still answer from what's already recorded, read a website you point me at, or you can ask again in a moment.";
    case "MODEL_OUTPUT_REJECTED":
      return "I couldn't put together a reliable answer from the available information this time.";
    case "CANCELLED":
      return "I stopped before finishing that analysis.";
  }
}

/**
 * A last-resort answer built from findings alone, for the case where the
 * model produced findings but no usable prose.
 *
 * Deterministic and dull on purpose: it is better for Q to state what it
 * found in flat sentences than to say nothing, and better still that this
 * path is obviously not the normal one.
 */
export function synthesisFromFindings(
  result: CompanyIntelligenceResult,
): string {
  const lines: string[] = [];
  const byType = (type: string): readonly string[] =>
    result.findings
      .filter((finding) => finding.type === type)
      .map((finding) => `- ${finding.statement}`);
  const sections: readonly (readonly [string, readonly string[]])[] = [
    ["What the evidence shows", [...byType("FACT"), ...byType("OBSERVATION")]],
    ["What looks strong", byType("STRENGTH")],
    ["What needs attention", byType("RISK")],
    ["What is uncertain", byType("UNCERTAINTY")],
    ["What we don't know", byType("GAP")],
  ];
  for (const [heading, items] of sections) {
    if (items.length > 0) {
      lines.push(`**${heading}**`, ...items, "");
    }
  }
  return lines.length === 0
    ? "I don't have enough information about this company to say anything useful yet."
    : lines.join("\n").trim();
}

/** Q intelligence step 2: a run's folded conversation state. */
export type RunConversationState = {
  /** The state as folded for this run (the version it was read at). */
  readonly state: QConversationState;
  readonly summary: QConversationSummaryRevision | null;
  /**
   * Step 11: the save, off the reader's path. False when another writer
   * saved first (this run saves nothing more) or when there is no store.
   */
  readonly saving: Promise<boolean>;
  /** Step 11: how long the read and fold took, for "q turn timing". */
  readonly loadMs: number;
  /** Step 11: read from this process's cache rather than the store. */
  readonly cached: boolean;
};

/**
 * Step 11: whether a cached state can stand for the store on this turn.
 * Only when this process folded the conversation's turn before this one:
 * the cached state's newest message is in the history, and at most one of
 * the person's messages (this turn's) follows it. Anything else -- a turn
 * served by another instance, or one this process answered without folding
 * -- reads the store, where another instance's summary may be waiting.
 */
export function continuesFrom(
  state: QConversationState,
  history: readonly QConversationMessage[],
): boolean {
  if (state.throughMessageId === null) return false;
  const index = history.findIndex(
    (message) => message.id === state.throughMessageId,
  );
  if (index < 0) return false;
  let theirs = 0;
  for (const message of history.slice(index + 1)) {
    if (message.role === "USER") theirs += 1;
  }
  return theirs <= 1;
}

/**
 * Reads the stored state (or this process's committed copy of it), folds
 * in the messages it does not cover yet, and returns at once. The save is
 * one short transaction (no model call inside it) that runs beside the
 * reader instead of before it; its result reaches the cache only once it
 * has committed. A composition with no state store folds from the history
 * alone, so a turn is never worse off than before.
 */
export async function loadConversationState(
  deps: {
    readonly repositories: QRuntimeRepositories;
    readonly sql: DatabaseExecutor;
    readonly transactions: TransactionManager;
    readonly logger?: Logger | undefined;
  },
  who: {
    readonly tenantId: TenantId;
    readonly userId: UserId;
    readonly runId: string;
  },
  history: readonly QConversationMessage[],
): Promise<RunConversationState | null> {
  const started = Date.now();
  const conversationId = history[0]?.conversationId;
  if (conversationId === undefined) return null;
  const store = deps.repositories.conversationStates;
  const cache = store?.cache;
  const key = { tenantId: who.tenantId, userId: who.userId, conversationId };
  let hit = cache?.get(key);
  if (hit !== undefined && !continuesFrom(hit.state, history)) {
    cache?.forget(key);
    hit = undefined;
  }
  const [previous, summary] =
    hit !== undefined
      ? [hit.state, hit.summary]
      : store === undefined
        ? [null, null]
        : await Promise.all([
            store.find(deps.sql, who.tenantId, who.userId, conversationId),
            store.latestSummary(
              deps.sql,
              who.tenantId,
              who.userId,
              conversationId,
            ),
          ]);
  const fold = foldConversationState({
    previous,
    identity: { conversationId, tenantId: who.tenantId, userId: who.userId },
    history,
  });
  const loaded = {
    state: fold.state,
    summary,
    loadMs: Date.now() - started,
    cached: hit !== undefined,
  };
  if (store === undefined) {
    return { ...loaded, saving: Promise.resolve(false) };
  }
  if (!fold.changed) {
    // Nothing new, and what was read is committed: worth keeping.
    if (previous !== null) cache?.remember({ state: fold.state, summary });
    return { ...loaded, saving: Promise.resolve(true) };
  }
  const saving = deps.transactions
    .run((tx) => store.save(tx, fold.state))
    .then(
      (saved) => {
        if (saved) {
          // Committed: the stored version is one on from the one read.
          cache?.remember({
            state: { ...fold.state, version: fold.state.version + 1 },
            summary,
          });
        } else {
          // Another writer saved first: what this process holds is behind.
          cache?.forget(key);
        }
        return saved;
      },
      (error: unknown) => {
        cache?.forget(key);
        deps.logger?.warn(
          { err: error, qRunId: who.runId },
          "the conversation state was not saved; it is folded again next turn",
        );
        return false;
      },
    );
  return { ...loaded, saving };
}
