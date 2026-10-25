import type { ModelMessage, ModelToolCall } from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

/**
 * Their Q Card, offered right there (QA F-34, live 2026-10-23): "Show my Q
 * Card" with none made was answered "hasn't been made yet" and a generic
 * "What should I take on?". When get_q_card reads NOT_MADE with a handle
 * from their organisation's own name, code prepares the claim in the same
 * round, through claim_q_card_handle's own authorize and refuse steps (a
 * handle taken is refused there). Claiming makes the card public at its
 * address, so it is only prepared: one approval card with the exact
 * handle, nothing made until they approve.
 */
export const Q_CARD_CLAIM_TOOL = "claim_q_card_handle";
export const Q_CARD_READ_TOOL = "get_q_card";
const READ_TOOL = Q_CARD_READ_TOOL;

/**
 * The turn is about their own Q Card (guard run 1, 2026-10-25): its words
 * name it, or its share link. A hint for one read-only read of their own
 * card, never a decision: what is said comes from that read.
 */
export function asksAboutOwnQCard(said: string): boolean {
  return /\b(?:my|our)\s+q[\s-]*card\b|\bq[\s-]*card\b[^.?!]*\b(?:link|url|address|handle)\b|\bshare\s+link\b/iu.test(
    said,
  );
}

/** The claim's arguments for a card not made yet; null otherwise. */
export function qCardOfferOf(
  call: Pick<ModelToolCall, "name" | "arguments">,
  outcome: QToolCallOutcome,
): { readonly subject: string; readonly handle: string } | null {
  if (call.name !== READ_TOOL || !outcome.result.ok) return null;
  const data = outcome.result.data as {
    readonly status?: unknown;
    readonly suggestedHandle?: unknown;
  } | null;
  if (data?.status !== "NOT_MADE") return null;
  if (typeof data.suggestedHandle !== "string") return null;
  const subject = (call.arguments as { readonly subject?: unknown } | null)
    ?.subject;
  return {
    subject:
      subject === "INVESTOR_ORGANISATION" ? "INVESTOR_ORGANISATION" : "COMPANY",
    handle: data.suggestedHandle,
  };
}

/** What the model is told once the card was prepared for approval. */
export function qCardOfferMessage(
  outcome: QToolCallOutcome,
  handle: string,
): ModelMessage | null {
  if (!outcome.result.ok) return null;
  const status = (outcome.result.data as { readonly status?: unknown } | null)
    ?.status;
  if (status !== "PREPARED") return null;
  return {
    role: "USER",
    content: `[Capital Q, not the person] They have no Q Card yet, so Capital Q prepared one for their approval with the handle @${handle}, from their organisation's name. Nothing is made until they approve. In your answer say, in your own words and in one or two sentences: there is no Q Card yet, you have prepared one at @${handle} for them to approve on the card, and they can ask for another handle. Do not ask what to take on.`,
  };
}

/**
 * What get_q_card read this turn, for code's own reply (QA, batch 9):
 * "Show me my Q Card and the share link" was answered "Understood." -- the
 * model's words were all approval talk, removed because the engine narrates
 * the prepared claim, and nothing was left. Unclaimed, the reply says so
 * with the address the card would have; claimed, it gives the card's
 * whole address exactly as the tool returned it (F-85).
 */
export type QCardRead = {
  readonly status: "SAVED" | "NOT_MADE";
  readonly handle: string | null;
  readonly publicUrl: string | null;
  readonly suggestedHandle: string | null;
  readonly suggestedUrl: string | null;
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
/** Only an absolute https address is quoted (F-85). */
const httpsUrl = (value: unknown): string | null => {
  const url = text(value);
  return url !== null && /^https:\/\/[^\s]+$/u.test(url) ? url : null;
};

export function qCardReadOf(
  call: Pick<ModelToolCall, "name">,
  outcome: QToolCallOutcome,
): QCardRead | null {
  if (call.name !== READ_TOOL || !outcome.result.ok) return null;
  const data = outcome.result.data as Record<string, unknown> | null;
  if (data?.["status"] !== "SAVED" && data?.["status"] !== "NOT_MADE") {
    return null;
  }
  return {
    status: data["status"],
    handle: text(data["handle"]),
    publicUrl: httpsUrl(data["publicUrl"]),
    suggestedHandle: text(data["suggestedHandle"]),
    suggestedUrl: httpsUrl(data["suggestedUrl"]),
  };
}

/** Code's own line about their card; never just "Understood.". */
export function qCardLine(read: QCardRead): string {
  if (read.status === "SAVED") {
    if (read.publicUrl !== null) {
      return `Your Q Card is live. Share this link: ${read.publicUrl}`;
    }
    return "Your Q Card is saved, but it has no handle yet, so there is no link to share. Claim a handle to give it one.";
  }
  if (read.suggestedHandle === null) {
    return "You don't have a Q Card yet. Tell me the handle you want and I'll prepare it for your approval.";
  }
  const at = read.suggestedUrl === null ? "" : ` at ${read.suggestedUrl}`;
  return `You don't have a Q Card yet, so there is no link to share. Claiming @${read.suggestedHandle} makes it${at}: approve the claim on the card, or ask for another handle.`;
}

/** A sentence about their card, its handle, link or approval. */
const ABOUT_CARD =
  /\bq\s*card\b|@[a-z0-9][a-z0-9-]*|\bhandle\b|\bapprov|\blink\b/iu;

/**
 * The answer with the card's link, from the tool's own read:
 *
 * - it already quotes the address: as written;
 * - unclaimed: its sentences about the card give way to code's line (no
 *   card yet, the handle and the address it would have);
 * - saved: the link is added after the words.
 */
export function withQCardLink(answer: string, read: QCardRead): string {
  const trimmed = answer.trim();
  const url = read.status === "SAVED" ? read.publicUrl : read.suggestedUrl;
  if (url !== null && trimmed.includes(url)) return trimmed;
  if (read.status === "SAVED") {
    if (trimmed.length === 0 || read.publicUrl === null) {
      return trimmed.length === 0 ? qCardLine(read) : trimmed;
    }
    return `${trimmed}\n\nShare this link: ${read.publicUrl}`;
  }
  const rest = (trimmed.match(/[^.!?\n]+[.!?]*\s*/gu) ?? [])
    .filter((sentence) => !ABOUT_CARD.test(sentence))
    .join("")
    .trim();
  return rest.length === 0 ? qCardLine(read) : `${rest}\n\n${qCardLine(read)}`;
}
