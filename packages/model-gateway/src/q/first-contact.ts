import {
  INTEREST_NOTE_MAX,
  type ModelMessage,
  type ModelToolCall,
} from "@capital-q/contracts";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

/**
 * One step for a first contact (owner 2026-10-23, coordinator decision A):
 * "draft a short note to the founders of the second company" to a company
 * the investor is not connected with came back as a note in prose, "I
 * couldn't prepare the note because Anchor isn't a connected relationship
 * yet", then "Want me to prepare a connection request instead?" -- two
 * steps where an investor expects one.
 *
 * Messages and emails open only once both sides are connected (interest
 * expressed and accepted). So when a message or email to a company comes
 * back not connected (or not available: no relationship yet), code
 * prepares the canonical first contact, Express Interest, in the same
 * round, through the same tool port and its own authorize step (which
 * refuses where interest cannot be expressed: a founder, already
 * interested, already connected). It only prepares: one approval card
 * with the exact payload, nothing sent until the person approves.
 *
 * The note they asked for travels with that interest (coordinator,
 * decision B follow-up): the drafted body becomes the interest's note on
 * the same approval card, so approving it sends both, and an edited note
 * is a new approval. A body longer than an interest note allows is not
 * cut: the interest is prepared without it and the note waits for the
 * connection.
 */
export const FIRST_CONTACT_TOOL = "propose_express_interest";

/**
 * What Q says when code prepared the first contact (QO-08): plain, true,
 * no tool named and no permission asked for what was asked. The card's
 * own line follows it with the note in full and "Ready to send".
 */
export const FIRST_CONTACT_REPLY =
  "You're not connected with them yet, so I've prepared this as an expression of interest: messages open once the founders accept.";
export const MESSAGE_TOOLS: ReadonlySet<string> = new Set([
  "propose_chat_message",
  "propose_email",
]);

type FirstContactArguments = (
  { readonly companyId: string } | { readonly company: string }
) & { readonly note?: string };

/** Express Interest's arguments for the company a message could not reach; null when none. */
export function firstContactOf(
  call: Pick<ModelToolCall, "name" | "arguments">,
  outcome: QToolCallOutcome,
): FirstContactArguments | null {
  if (!MESSAGE_TOOLS.has(call.name)) return null;
  const notConnected =
    outcome.result.ok &&
    (outcome.result.data as { readonly status?: unknown } | null)?.status ===
      "NOT_CONNECTED";
  const notAvailable =
    !outcome.result.ok && outcome.failureCode === "NOT_AVAILABLE";
  if (!notConnected && !notAvailable) return null;
  const args = (call.arguments ?? {}) as {
    readonly companyId?: unknown;
    readonly counterpartName?: unknown;
    readonly body?: unknown;
  };
  const body = typeof args.body === "string" ? args.body.trim() : "";
  const note =
    body.length > 0 && body.length <= INTEREST_NOTE_MAX ? { note: body } : {};
  if (typeof args.companyId === "string" && args.companyId.length > 0) {
    return { companyId: args.companyId, ...note };
  }
  if (
    typeof args.counterpartName === "string" &&
    args.counterpartName.trim().length > 0
  ) {
    return { company: args.counterpartName.trim(), ...note };
  }
  return null;
}

/** What the model is told once Capital Q prepared the interest. */
export function firstContactMessage(
  outcome: QToolCallOutcome,
  withNote = false,
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
      : "Express interest";
  if (withNote) {
    return {
      role: "USER",
      content: `[Capital Q, not the person] They are not connected with this company yet, and messages open only once both sides are connected, so Capital Q prepared the first step for their approval: "${what}". The note they asked for goes with it, on the same approval card, exactly as drafted, and Capital Q's own line under your answer shows the note in full and says it is ready to send. Nothing is sent until they approve. Do not repeat the note or its status. In your answer say only, in your own words and in one or two sentences, why the note fits: what in their mandate matches what the company does. Do not offer a connection request or ask whether to do this: it is already prepared.`,
    };
  }
  return {
    role: "USER",
    content: `[Capital Q, not the person] They are not connected with this company yet, and messages open only once both sides are connected, so Capital Q prepared the first step for their approval: "${what}". Nothing is sent until they approve. In your answer say, in your own words: you have prepared ${what.replace(/^Express interest/u, "Express Interest")} for them to approve; messages open once the founders accept; and the note they asked for is below, ready to send then. Then give the note in full. Do not offer a connection request or ask whether to do this: it is already prepared.`,
  };
}
