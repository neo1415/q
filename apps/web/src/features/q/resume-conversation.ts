import type {
  QConversationSummary,
  QPendingApproval,
} from "@capital-q/contracts";

import type { QSubject } from "./q-subject";

/**
 * Which conversation Q's dock opens on a fresh load that names none (live
 * Zino run 2026-10-01: after a reload on a company page, Ctrl+K opened a
 * new conversation, so "yes, go ahead" found nothing waiting while an
 * errand's approval sat in the conversation before, reachable only from
 * /home?c=).
 *
 * In order: the conversation holding the most recent change still waiting
 * for this person's approval, if it was asked for recently (its card then
 * shows again); else their most recent conversation about the page they
 * are on, then their most recent at all, if it was active recently.
 * Otherwise none: an old conversation is not resumed, a new one starts.
 */
export const RESUME_WITHIN_MS = 30 * 60_000;

function about(conversation: QConversationSummary, subject: QSubject): boolean {
  return conversation.subjects.some((ref) => {
    switch (subject.kind) {
      case "COMPANY":
        return ref.kind === "COMPANY" && ref.companyId === subject.companyId;
      case "INVESTOR_ORGANISATION":
        return (
          ref.kind === "INVESTOR_ORGANISATION" &&
          ref.investorOrganisationId === subject.investorOrganisationId
        );
      case "RELATIONSHIP":
        return (
          ref.kind === "RELATIONSHIP" &&
          ref.relationshipId === subject.relationshipId
        );
      case "NONE":
        return false;
    }
  });
}

export function resumableConversation(input: {
  readonly now: number;
  readonly subject: QSubject;
  readonly pending: readonly QPendingApproval[];
  readonly conversations: readonly QConversationSummary[];
}): string | null {
  const recent = (at: string) => input.now - Date.parse(at) <= RESUME_WITHIN_MS;
  const waiting = input.pending
    .filter((item) => item.conversationId !== null && recent(item.requestedAt))
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
  if (waiting?.conversationId != null) return waiting.conversationId;
  const active = input.conversations
    .filter((conversation) => recent(conversation.lastMessageAt))
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  const here = active.find((conversation) =>
    about(conversation, input.subject),
  );
  return (here ?? active[0])?.conversationId ?? null;
}
