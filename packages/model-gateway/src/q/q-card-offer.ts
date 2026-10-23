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
const READ_TOOL = "get_q_card";

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
