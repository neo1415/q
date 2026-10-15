import type { QToolCallOutcome } from "@capital-q/q-runtime";

/**
 * K9 / G-D23 (D's finding, 2026-10-09): a `propose_*` tool answers
 * PREPARED as soon as its port has staged the proposal, but the Approval
 * Engine persists it only after the answer -- and may refuse it. The model
 * read PREPARED and told the person a card was ready that never appeared.
 * What the model sees is therefore "proposed, pending confirmation", with
 * the rule for saying it; the card itself is the post-commit truth. The
 * tool's own result (and what code reads from it) is unchanged.
 */

export const PENDING_CONFIRMATION = "PROPOSED_PENDING_CONFIRMATION" as const;

export const PENDING_CONFIRMATION_GUIDANCE =
  "Proposed, pending confirmation: Capital Q saves it for their approval after this answer and may still refuse it. Say you have proposed it for their approval; never say it is ready, saved, prepared or done, and never describe a card as already there.";

/** The outcome as the model should read it; others pass through as is. */
export function forModelReading(
  outcome: QToolCallOutcome,
  classification: string | undefined,
): QToolCallOutcome {
  if (
    !outcome.result.ok ||
    classification === undefined ||
    classification === "READ_ONLY" ||
    classification === "ANALYTICAL"
  ) {
    return outcome;
  }
  const data = outcome.result.data;
  if (
    data === null ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    (data as { readonly status?: unknown }).status !== "PREPARED"
  ) {
    return outcome;
  }
  return {
    ...outcome,
    result: {
      ok: true,
      data: {
        ...(data as Record<string, unknown>),
        status: PENDING_CONFIRMATION,
        guidance: PENDING_CONFIRMATION_GUIDANCE,
      },
    },
  };
}
