import type { QConversationId } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { TenantId, UserId } from "@capital-q/security";

import { gateConversationSummary } from "../domain/conversation-summary-gate.js";
import type {
  QConversationRepository,
  QConversationStateRepository,
} from "./ports.js";

/**
 * Superseding a conversation's summary whose counts a document contradicts
 * (Thames Arc, 16 Nov 2026: Q's wrong "4 public-sector account managers",
 * the plan's row says 3, sat in earlier conversations' summaries and was
 * recalled into later ones).
 *
 * The summary's own lifecycle is the one this goes through: revisions are
 * append-only (20261231250000), so the correction is the next revision,
 * marked by its gate version as a correction, and the stale revision stays
 * as history; nothing is deleted or rewritten. The conversation's digest
 * (what recall reads) moves to the corrected text in the same transaction.
 *
 * Idempotent: it only acts while the digest still holds exactly the text
 * the correction was computed from; once corrected (or moved on by a newer
 * turn), it does nothing. The corrected text passes the same deterministic
 * summary gate as any revision (no figure its sources do not hold).
 */
export const SUMMARY_CORRECTION_GATE_VERSION = "summary-correction-v1";

export type SummarySupersession = {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly conversationId: QConversationId;
  /** The summary as it was read when the correction was computed. */
  readonly from: string;
  /** The same summary with the contradicted counts put right. */
  readonly summary: string;
  /** The source lines that state the counts it now carries. */
  readonly grounds: readonly string[];
  /** The run whose claim check found it, for attribution. */
  readonly runId?: string | undefined;
};

export type SummarySupersessionOutcome =
  | { readonly kind: "SUPERSEDED"; readonly revision: number }
  | { readonly kind: "MOVED_ON" | "NOT_FOUND" | "UNCHANGED" }
  | { readonly kind: "REFUSED"; readonly figures: readonly string[] };

export type SummarySupersessionDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly conversations: Pick<
    QConversationRepository,
    "findForOwner" | "setDigest"
  >;
  readonly states: Pick<
    QConversationStateRepository,
    "latestSummary" | "appendSummary" | "cache"
  >;
};

/** What a supersession would do, without writing (the dry run's answer). */
export async function planSummarySupersession(
  dependencies: Pick<SummarySupersessionDependencies, "sql" | "conversations">,
  input: SummarySupersession,
): Promise<SummarySupersessionOutcome | { readonly kind: "WOULD_SUPERSEDE" }> {
  const summary = input.summary.trim();
  if (summary.length === 0 || summary === input.from.trim()) {
    return { kind: "UNCHANGED" };
  }
  const conversation = await dependencies.conversations.findForOwner(
    dependencies.sql,
    input.tenantId,
    input.userId,
    input.conversationId,
  );
  if (conversation === null || conversation.summaryThrough === null) {
    return { kind: "NOT_FOUND" };
  }
  if (conversation.summary !== input.from) return { kind: "MOVED_ON" };
  const gated = gateConversationSummary({
    summary,
    sources: [input.from, ...input.grounds],
  });
  if (gated.kind === "REFUSED") {
    return { kind: "REFUSED", figures: gated.figures };
  }
  return { kind: "WOULD_SUPERSEDE" };
}

export async function supersedeConversationSummary(
  dependencies: SummarySupersessionDependencies,
  input: SummarySupersession,
): Promise<SummarySupersessionOutcome> {
  const planned = await planSummarySupersession(dependencies, input);
  if (planned.kind !== "WOULD_SUPERSEDE") return planned;
  const { sql, transactions, conversations, states } = dependencies;
  const conversation = await conversations.findForOwner(
    sql,
    input.tenantId,
    input.userId,
    input.conversationId,
  );
  if (conversation === null || conversation.summaryThrough === null) {
    return { kind: "NOT_FOUND" };
  }
  const summaryThrough = conversation.summaryThrough;
  const summary = input.summary.trim();
  const previous = await states.latestSummary(
    sql,
    input.tenantId,
    input.userId,
    input.conversationId,
  );
  const coversThroughAt = previous?.coversThroughAt ?? summaryThrough;
  const coveredMessages = previous?.coveredMessages ?? 1;
  const revision = await transactions.run(async (tx) => {
    // Re-read inside the transaction: a turn that moved the digest on
    // since the plan wins, and nothing is written.
    const current = await conversations.findForOwner(
      tx.sql,
      input.tenantId,
      input.userId,
      input.conversationId,
    );
    if (current?.summary !== input.from) return null;
    const next = await states.appendSummary(tx, {
      tenantId: input.tenantId,
      userId: input.userId,
      conversationId: input.conversationId,
      summary,
      coversThroughAt,
      coveredMessages,
      gateVersion: SUMMARY_CORRECTION_GATE_VERSION,
      runId: input.runId,
    });
    await conversations.setDigest(tx, input.tenantId, input.conversationId, {
      title: null,
      summary,
      summaryThrough,
    });
    return next;
  });
  if (revision === null) return { kind: "MOVED_ON" };
  states.cache?.noteSummary(
    {
      tenantId: input.tenantId,
      userId: input.userId,
      conversationId: input.conversationId,
    },
    { revision, summary, coversThroughAt, coveredMessages },
  );
  return { kind: "SUPERSEDED", revision };
}
