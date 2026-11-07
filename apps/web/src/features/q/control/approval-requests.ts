import {
  bindingOf,
  executeApproved,
  type ApprovalAction,
  type ApprovalPayload,
  type ApprovedOutcome,
} from "./approval";

/**
 * W5.1: an APPROVAL action Q asked for, prepared and waiting on screen
 * with the exact payload it would carry (Prepare → Recommend → Human
 * Approval → Execute). The person's Approve binds that payload; anything
 * edited since needs approving again (approval.ts, executeApproved).
 */
export type ApprovalRequest = {
  readonly id: string;
  readonly actionId: string;
  readonly summary: string;
  readonly payload: ApprovalPayload;
  readonly binding: string;
};

/** Why an act did not run, for the notice (the receipt says NOT_APPLICABLE). */
export type HeldReason =
  | "AWAITING_APPROVAL"
  /** An APPROVAL action with nothing to approve yet (an empty draft). */
  | "NOTHING_PREPARED"
  | "NEVER"
  | "DECLINED"
  | "UNCLASSIFIED";

const held = new Map<string, HeldReason>();
const HELD_MAX = 32;

export function noteHeld(actId: string, reason: HeldReason): void {
  held.set(actId, reason);
  if (held.size > HELD_MAX) {
    const oldest = held.keys().next().value;
    if (oldest !== undefined) held.delete(oldest);
  }
}

/** Why this act was held, if it was. */
export function heldReason(actId: string): HeldReason | undefined {
  return held.get(actId);
}

const actions = new Map<string, ApprovalAction>();
const listeners = new Set<(pending: readonly ApprovalRequest[]) => void>();
let pending: readonly ApprovalRequest[] = [];
let seq = 0;

function publish(next: readonly ApprovalRequest[]): void {
  pending = next;
  for (const listener of listeners) listener(next);
}

export function subscribeApprovals(
  listener: (requests: readonly ApprovalRequest[]) => void,
): () => void {
  listeners.add(listener);
  listener(pending);
  return () => listeners.delete(listener);
}

/**
 * Prepares one APPROVAL action for the person: its exact payload, now.
 * False when there is nothing to prepare (an empty draft). One request
 * per action at a time: asking again replaces the older one.
 */
export function requestApproval(action: ApprovalAction): boolean {
  const payload = action.prepare();
  if (payload === null) return false;
  seq += 1;
  actions.set(action.id, action);
  publish([
    ...pending.filter((one) => one.actionId !== action.id),
    {
      // Also the idempotency key: one approval, one execution.
      id: `apr-${String(Date.now())}-${String(seq)}`,
      actionId: action.id,
      summary: action.summary(payload),
      payload,
      binding: bindingOf(payload),
    },
  ]);
  return true;
}

/** The person approved this request: it runs, once, on what they saw. */
export async function approveRequest(id: string): Promise<ApprovedOutcome> {
  const request = pending.find((one) => one.id === id);
  const action =
    request === undefined ? undefined : actions.get(request.actionId);
  if (request === undefined || action === undefined) {
    return { status: "REFUSED", reason: "NO_APPROVAL" };
  }
  const outcome = await executeApproved(action, "APPROVAL", {
    actionId: request.actionId,
    binding: request.binding,
    idempotencyKey: request.id,
  });
  // Done, failed or refused, this request is answered.
  publish(pending.filter((one) => one.id !== id));
  return outcome;
}

/** The person declined: nothing runs. */
export function declineRequest(id: string): void {
  publish(pending.filter((one) => one.id !== id));
}

/** Clears everything (tests). */
export function resetApprovalRequests(): void {
  held.clear();
  actions.clear();
  publish([]);
}
