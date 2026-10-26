import type { ModelMessage, ModelToolCall } from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

/**
 * The Capital Q conversation, not their mailbox (QA F-32, live 2026-10-23):
 * a reply drafted to Savanna, a connected investor, then "Send it to
 * them", came back "Connect Gmail in Settings". With a relationship on
 * Capital Q the message goes through its own conversation, with approval;
 * email is for when they ask for an email.
 *
 * So when an email to one of their relationships comes back
 * MAILBOX_NOT_CONNECTED, code prepares the same words as a message in that
 * relationship's conversation, in the same round, through the chat tool's
 * own authorize step (which refuses where messages are not open: then the
 * first-contact path applies). It only prepares: one approval card with the
 * exact text, nothing sent until the person approves.
 */
export const CHAT_INSTEAD_TOOL = "propose_chat_message";
const EMAIL_TOOL = "propose_email";

type ChatArguments = (
  | { readonly relationshipId: string }
  | { readonly companyId: string }
  | { readonly investorOrganisationId: string }
  | { readonly counterpartName: string }
) & { readonly body: string };

/** The chat message's arguments for an email their mailbox could not send; null otherwise. */
export function chatInsteadOf(
  call: Pick<ModelToolCall, "name" | "arguments">,
  outcome: QToolCallOutcome,
): ChatArguments | null {
  if (call.name !== EMAIL_TOOL || !outcome.result.ok) return null;
  const status = (outcome.result.data as { readonly status?: unknown } | null)
    ?.status;
  // No mailbox, or no address for them (guard F-106, 2026-10-25): the
  // same words go as a Capital Q message, never nowhere.
  if (status !== "MAILBOX_NOT_CONNECTED" && status !== "NO_RECIPIENT") {
    return null;
  }
  const args = call.arguments ?? {};
  const body = typeof args["body"] === "string" ? args["body"].trim() : "";
  if (body.length === 0) return null;
  // The email's own order (its authorize): their name for the other side
  // first, so the message goes to the relationship the email resolved.
  for (const key of [
    "counterpartName",
    "relationshipId",
    "companyId",
    "investorOrganisationId",
  ] as const) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return { [key]: value.trim(), body } as ChatArguments;
    }
  }
  // A reply to an inbound email has no relationship conversation to use.
  return null;
}

/**
 * B2 (coordinator 2026-10-26): the reply once the message they asked for is
 * on its card, said by code. Every round after the card only wrote text
 * that the card's status replaced (run 42cecfd2: two more ~48k-token calls
 * after it). The card carries the words; nothing is sent until they approve.
 */
export const MESSAGE_PREPARED_REPLY =
  "It's drafted and on the card for your approval. Nothing is sent until you approve it.";

/** The same, when Capital Q prepared it as a Capital Q message instead. */
export function chatInsteadReply(why: "NO_MAILBOX" | "NO_ADDRESS"): string {
  return why === "NO_ADDRESS"
    ? "I don't have their email address, so the same words are ready to send as a Capital Q message, waiting for your approval. Add their address if you'd rather it went by email."
    : "Your mailbox isn't connected, so the same words are ready to send as a Capital Q message, waiting for your approval. Nothing is sent until you approve it.";
}

/** What the model is told once Capital Q prepared the message instead. */
export function chatInsteadMessage(
  outcome: QToolCallOutcome,
  why: "NO_MAILBOX" | "NO_ADDRESS" = "NO_MAILBOX",
): ModelMessage | null {
  if (!outcome.result.ok) return null;
  const data = outcome.result.data as {
    readonly status?: unknown;
    readonly awaitingApprovalOf?: unknown;
  } | null;
  if (data?.status !== "PREPARED") return null;
  const what =
    typeof data.awaitingApprovalOf === "string"
      ? data.awaitingApprovalOf
      : "A message to them";
  return {
    role: "USER",
    content:
      why === "NO_ADDRESS"
        ? `[Capital Q, not the person] There is no email address for them on this relationship, so Capital Q prepared the same words as a message in their Capital Q conversation, for their approval: "${what}". Nothing is sent until they approve. In your answer say plainly that you don't have their email address, that the words are ready to send as a Capital Q message and wait for their approval, and that they can add the address if they want it emailed instead.`
        : `[Capital Q, not the person] Their mailbox is not connected, and they are on Capital Q with this relationship, so Capital Q prepared the same words as a message in their Capital Q conversation, for their approval: "${what}". Nothing is sent until they approve. In your answer say, in your own words, that it is ready to send through Capital Q and waits for their approval. Do not tell them to connect Gmail or mention email unless they asked for an email.`,
  };
}
