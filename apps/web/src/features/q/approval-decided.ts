/**
 * Live e11 (2026-10-29): an approval was given in the conversation; work it
 * starts (a plan's steps) is shown on another card, which reads its own
 * record again. The event carries nothing: each card reads as the person
 * from the Q API, so a forged event costs one read and grants nothing.
 */
export const Q_APPROVAL_DECIDED_EVENT = "cq:q-approval-decided";

export function announceApprovalDecided(): void {
  try {
    window.dispatchEvent(new CustomEvent(Q_APPROVAL_DECIDED_EVENT));
  } catch {
    // No window: nothing to announce.
  }
}
