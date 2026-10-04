import type {
  QActionProposal,
  QMessage,
  QPendingApproval,
} from "@capital-q/contracts";

/**
 * A change still waiting for the person's decision in this conversation,
 * found again after its run is no longer the open one (QA 2026-10-01: the
 * approval card disappeared from /home?c= once another turn had run, so
 * the change could be decided only from somewhere else). The approval is
 * the server's (GET /v1/q/approvals, the caller's own); the proposal shown
 * is the one its run recorded in this conversation. Nothing is inferred:
 * no recorded proposal for the run, no card.
 */
export type CarriedApproval = {
  readonly approval: {
    readonly approvalId: string;
    readonly proposalId: string;
    readonly expiresAt: string | undefined;
  };
  readonly proposal: QActionProposal;
  readonly runId: string;
};

/**
 * The conversation has moved on from a card (founder, voiceq-63): Q has
 * since answered something else, in another run, without naming the card.
 * The card leaves the screen on its own; the approval itself still waits,
 * is listed under Needs you on Work, and "go ahead" or "cancel that" still
 * decides it on the server.
 */
export function movedOn(
  history: readonly QMessage[],
  runId: string,
  proposal: Pick<QActionProposal, "summary">,
): boolean {
  const at = history.findLastIndex(
    (message) => message.role === "Q" && message.runId === runId,
  );
  if (at < 0) return false;
  const summary = proposal.summary
    .trim()
    .replace(/[.\s]+$/u, "")
    .toLowerCase();
  return history
    .slice(at + 1)
    .some(
      (message) =>
        message.role === "Q" &&
        message.runId !== runId &&
        !(message.text ?? "").toLowerCase().includes(summary),
    );
}

export function carriedApproval(
  conversationId: string | null,
  history: readonly QMessage[],
  pending: readonly QPendingApproval[],
): CarriedApproval | null {
  if (conversationId === null) return null;
  const mine = pending
    .filter((item) => item.conversationId === conversationId)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  for (const item of mine) {
    const proposal = [...history]
      .reverse()
      .filter((message) => message.runId === item.runId)
      .flatMap((message) =>
        (message.role === "Q" ? (message.blocks ?? []) : []).flatMap((block) =>
          block.kind === "ACTION_PROPOSAL" ? [block.proposal] : [],
        ),
      )
      .at(0);
    if (proposal !== undefined && !movedOn(history, item.runId, proposal)) {
      return {
        approval: {
          approvalId: item.approvalId,
          proposalId: proposal.proposalId,
          expiresAt: item.expiresAt,
        },
        proposal,
        runId: item.runId,
      };
    }
  }
  return null;
}
