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
 * decides it on the server. `at` is the last answer that showed the card.
 */
export function movedOn(
  history: readonly QMessage[],
  at: number,
  proposal: Pick<QActionProposal, "summary">,
): boolean {
  const shownBy = history[at]?.runId;
  const summary = proposal.summary
    .trim()
    .replace(/[.\s]+$/u, "")
    .toLowerCase();
  return history
    .slice(at + 1)
    .some(
      (message) =>
        message.role === "Q" &&
        message.runId !== shownBy &&
        !(message.text ?? "").toLowerCase().includes(summary),
    );
}

/**
 * The last answer in this conversation that showed the approval's card,
 * and the card it showed. F-106 (2026-10-24): the same change asked for
 * again is answered "That's ready: … It's waiting for your yes" with the
 * card it already has, recorded by an earlier run (perhaps in another
 * conversation). That answer shows the card, so the card is found by its
 * approval wherever it was shown, not only in the run that first made it.
 */
function lastShown(
  history: readonly QMessage[],
  item: QPendingApproval,
): { readonly at: number; readonly proposal: QActionProposal } | null {
  for (let at = history.length - 1; at >= 0; at -= 1) {
    const message = history[at];
    if (message?.role !== "Q") continue;
    for (const block of message.blocks ?? []) {
      if (block.kind !== "ACTION_PROPOSAL") continue;
      const required = block.proposal.approval;
      const approvalId = required.required
        ? required.approval?.approvalId
        : undefined;
      const same =
        approvalId === undefined
          ? block.proposal.runId === item.runId
          : approvalId === item.approvalId;
      if (same) return { at, proposal: block.proposal };
    }
  }
  return null;
}

export function carriedApproval(
  conversationId: string | null,
  history: readonly QMessage[],
  pending: readonly QPendingApproval[],
): CarriedApproval | null {
  if (conversationId === null) return null;
  // Asked for here, or shown here since: the newest shown first.
  const shown = pending
    .flatMap((item) => {
      const found = lastShown(history, item);
      if (found === null) return [];
      // Another conversation's change is carried here only when an answer
      // here showed it again.
      if (
        item.conversationId !== conversationId &&
        history[found.at]?.runId === item.runId
      ) {
        return [];
      }
      return [{ item, ...found }];
    })
    .sort(
      (a, b) =>
        b.at - a.at || b.item.requestedAt.localeCompare(a.item.requestedAt),
    );
  for (const { item, at, proposal } of shown) {
    if (!movedOn(history, at, proposal)) {
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

/**
 * Which cards this thread shows, as one key (egress, 2026-10-24): the
 * waiting approvals are asked of the server again only when this changes.
 * A thread that shows no card has nothing to carry and asks nothing.
 */
export function shownCardsKey(history: readonly QMessage[]): string {
  const ids = new Set<string>();
  for (const message of history) {
    if (message.role !== "Q") continue;
    for (const block of message.blocks ?? []) {
      if (block.kind === "ACTION_PROPOSAL") ids.add(block.proposal.proposalId);
    }
  }
  return [...ids].sort().join(",");
}
