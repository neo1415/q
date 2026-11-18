/**
 * S9 (docs/specs/meetings/2026-11-18-meetings-design.md R11; admin design
 * §6.3-6.4): how well a commitment's latest step is corroborated, on the
 * ADR-001 evidence axis, kept apart from its status (lifecycle) and level.
 *
 * Deterministic, no model. Capital Q never holds or moves money (decision
 * 106): it records what each side says and how far the two agree.
 *
 *   SELF_REPORTED           one side's word for the latest step
 *   DOCUMENT_SUPPORTED      a document backs it (signed terms, a transfer
 *                           confirmation), still one side's
 *   MULTI_SOURCE_SUPPORTED  both sides, independently: the amount stated by
 *                           one and confirmed by the other; or the money
 *                           marked sent with a reference by the investor
 *                           AND received by the company
 *
 * Nothing becomes EXTERNALLY_VERIFIED or PLATFORM_VERIFIED: there is no
 * verification source for it yet. Facilitation-fee reporting counts only
 * MULTI_SOURCE_SUPPORTED; the rest shows as claimed.
 */

export type CommitmentEvidenceStatus =
  "SELF_REPORTED" | "DOCUMENT_SUPPORTED" | "MULTI_SOURCE_SUPPORTED";

export type CommitmentEvidenceFacts = {
  readonly status: string;
  readonly transferSentAt: Date | string | null;
  readonly transferReference: string | null;
  readonly evidenceDocumentId: string | null;
};

export function commitmentEvidenceStatus(
  c: CommitmentEvidenceFacts,
): CommitmentEvidenceStatus {
  const documented = c.evidenceDocumentId !== null;
  switch (c.status) {
    // The amount, agreed by the side that did not state it.
    case "CONFIRMED":
      return "MULTI_SOURCE_SUPPORTED";
    // Arrival: both sides only when the investor said it was sent, with
    // something to match it by.
    case "RECEIVED": {
      const sentWithReference =
        c.transferSentAt !== null &&
        (c.transferReference?.trim().length ?? 0) > 0;
      if (sentWithReference) return "MULTI_SOURCE_SUPPORTED";
      return documented ? "DOCUMENT_SUPPORTED" : "SELF_REPORTED";
    }
    // Sent, stated, heard by Q: one side's word, unless a document backs it.
    default:
      return documented ? "DOCUMENT_SUPPORTED" : "SELF_REPORTED";
  }
}

/** Only both sides' independent word counts toward a facilitation fee. */
export function countsTowardFee(status: CommitmentEvidenceStatus): boolean {
  return status === "MULTI_SOURCE_SUPPORTED";
}

export type CommitmentReviewReason =
  "RECEIVED_WITHOUT_SENT" | "AMOUNT_MISMATCH";

/**
 * A claim the two sides' records disagree on, for the admin's review
 * queue. The flag only describes: it never changes either side's facts,
 * and the other party never sees it.
 */
export function commitmentReviewFlags(c: {
  readonly status: string;
  readonly transferSentAt: Date | string | null;
  readonly evidenceDocumentId: string | null;
}): readonly {
  readonly reason: CommitmentReviewReason;
  readonly detail: string;
}[] {
  if (
    c.status === "RECEIVED" &&
    c.transferSentAt === null &&
    c.evidenceDocumentId === null
  ) {
    return [
      {
        reason: "RECEIVED_WITHOUT_SENT",
        detail:
          "The company confirmed money arrived that the investor never marked sent, and no document backs it.",
      },
    ];
  }
  return [];
}

/** A changed amount one side proposes against the stated one. */
export function amountMismatch(
  stated: { readonly amount: string; readonly currencyCode: string },
  proposed: { readonly amount: string; readonly currencyCode: string },
): string | null {
  const same =
    stated.currencyCode === proposed.currencyCode &&
    Number(stated.amount) === Number(proposed.amount);
  return same
    ? null
    : `One side says ${proposed.currencyCode} ${proposed.amount}; the commitment states ${stated.currencyCode} ${stated.amount}. Both stand until the other side agrees.`;
}

/**
 * What Q asks which side next (owner, 2026-11-18): the right question to
 * the right side, never a step for the other side to take for them.
 */
export function commitmentPrompt(
  c: {
    readonly status: string;
    readonly statedBySide: "COMPANY" | "INVESTOR" | null;
    readonly money: string;
    readonly counterpart: string;
  },
  side: "COMPANY" | "INVESTOR",
): string | null {
  switch (c.status) {
    case "DETECTED":
      return side === "INVESTOR"
        ? `In the call you mentioned ${c.money}. Is that your commitment to ${c.counterpart}? Confirm it, add any terms, or tell me it's wrong.`
        : `In the call ${c.counterpart} mentioned ${c.money}. Shall I record it for them to confirm?`;
    case "STATED":
      return c.statedBySide === side
        ? null
        : `${c.counterpart} recorded ${c.money}. Is that right? Confirm it, or note what's different.`;
    case "CONFIRMED":
      return side === "INVESTOR"
        ? `You committed ${c.money} to ${c.counterpart}. Was it sent? Confirm with the transfer reference.`
        : `Has ${c.money} from ${c.counterpart} arrived? Confirm when it has.`;
    case "TRANSFER_SENT":
      return side === "COMPANY"
        ? `${c.counterpart} marked ${c.money} as sent. Did it arrive?`
        : null;
    default:
      return null;
  }
}
