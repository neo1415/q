import type { QControlKind, QUiActIntent } from "@capital-q/contracts";

/**
 * W5.1 (Q Workspace plan §7; DECISIONS 71): every action a page lets Q
 * operate carries an approval class, set in code by the page that
 * registers it -- never by the model, never by anything the model sends.
 *
 * - NONE: view only (open, filter, sort, expand, select, scroll, layout).
 *   Q does it.
 * - CONFIRM: a reversible write to the person's own things (save, a
 *   draft, a hold, a note, a tag). Q does it after one tap of theirs.
 * - APPROVAL: outward or binding (send, accept or decline, share or
 *   revoke, invite, a soft or hard commitment). A UI act never runs it.
 *   Q prepares it; it runs only through `executeApproved`, bound to the
 *   exact payload the person approved and an idempotency key.
 * - NEVER: moving money, signing for someone. Never run by Q, approved or
 *   not; Q can only prepare the paperwork.
 *
 * Kinds that can only change what is on screen are NONE by nature and
 * cannot be declared otherwise. A clickable kind (button, toggle, input,
 * list item) must declare its class; one that does not is refused, so a
 * new button can never become an unclassified way for Q to act.
 */

export const APPROVAL_CLASSES = [
  "NONE",
  "CONFIRM",
  "APPROVAL",
  "NEVER",
] as const;
export type ApprovalClass = (typeof APPROVAL_CLASSES)[number];

/** Kinds whose acts only change the view: always NONE. */
const VIEW_KINDS: ReadonlySet<QControlKind> = new Set<QControlKind>([
  "TAB",
  "SECTION",
  "LIST",
  "FILTER",
  "DISCLOSURE",
  "CAROUSEL",
  "DIALOG",
  "MENU",
]);

/** Acts that never change anything but position or focus. */
const VIEW_ACTS: ReadonlySet<QUiActIntent["act"]> = new Set<
  QUiActIntent["act"]
>([
  "SCROLL_TO",
  "FOCUS",
  "SCROLL_DOWN",
  "SCROLL_UP",
  "SCROLL_TOP",
  "SCROLL_BOTTOM",
  "BACK",
  "FORWARD",
]);

/**
 * The class that governs one act on one control. Null: the control is
 * clickable and declared none, which is refused (never treated as NONE).
 */
export function classOfAct(
  kind: QControlKind,
  declared: ApprovalClass | undefined,
  act: QUiActIntent["act"],
): ApprovalClass | null {
  // Bringing any control into view, or focusing it, does nothing to it.
  if (VIEW_ACTS.has(act)) return "NONE";
  if (VIEW_KINDS.has(kind)) return "NONE";
  return declared ?? null;
}

// ---------------------------------------------------------------------------
// CONFIRM: one tap of the person's, asked on screen.
// ---------------------------------------------------------------------------

export type ConfirmRequest = {
  readonly id: string;
  /** What will happen, in the page's own words ("Save Brightwell"). */
  readonly summary: string;
  readonly answer: (confirmed: boolean) => void;
};

/** How long a confirmation waits before it counts as declined. */
export const CONFIRM_WAIT_MS = 60_000;

const confirmListeners = new Set<
  (pending: readonly ConfirmRequest[]) => void
>();
let pendingConfirms: readonly ConfirmRequest[] = [];
let confirmSeq = 0;

function publishConfirms(next: readonly ConfirmRequest[]): void {
  pendingConfirms = next;
  for (const listener of confirmListeners) listener(next);
}

/** The prompts waiting for the person (the shell renders them). */
export function subscribeConfirms(
  listener: (pending: readonly ConfirmRequest[]) => void,
): () => void {
  confirmListeners.add(listener);
  listener(pendingConfirms);
  return () => confirmListeners.delete(listener);
}

/**
 * Asks the person, on screen, to confirm one act. Resolves true only on
 * their own tap; a decline, or no answer in time, is false.
 */
export function askConfirm(
  summary: string,
  waitMs: number = CONFIRM_WAIT_MS,
): Promise<boolean> {
  confirmSeq += 1;
  const id = `confirm-${String(confirmSeq)}`;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      publishConfirms(pendingConfirms.filter((one) => one.id !== id));
      resolve(confirmed);
    };
    const timer = setTimeout(() => settle(false), waitMs);
    publishConfirms([
      ...pendingConfirms,
      { id, summary, answer: (confirmed) => settle(confirmed) },
    ]);
  });
}

// ---------------------------------------------------------------------------
// APPROVAL: prepared, approved on its exact payload, executed once.
// ---------------------------------------------------------------------------

/** What an APPROVAL action would do, exactly, in plain fields. */
export type ApprovalPayload = Readonly<
  Record<string, string | number | boolean | null>
>;

export type ApprovalAction = {
  /** The action's registered id (a control id). */
  readonly id: string;
  /** "Send this message to Brightwell", for the person to read. */
  readonly summary: (payload: ApprovalPayload) => string;
  /** The exact payload the action would carry now (its draft, its amount). */
  readonly prepare: () => ApprovalPayload | null;
  /** Runs it with the approved payload; only `executeApproved` calls it. */
  readonly execute: (
    payload: ApprovalPayload,
    idempotencyKey: string,
  ) => Promise<"DONE" | "FAILED">;
};

/**
 * The payload as one canonical string: keys sorted, so the same payload
 * is the same binding whatever order it was built in, and any change to
 * any field is a different binding.
 */
export function bindingOf(payload: ApprovalPayload): string {
  return JSON.stringify(
    Object.keys(payload)
      .sort()
      .map((key) => [key, payload[key]]),
  );
}

/** A person's approval of one action on one exact payload. */
export type BoundApproval = {
  readonly actionId: string;
  /** `bindingOf` the payload they saw when they approved. */
  readonly binding: string;
  /** One per approval; a repeat with it runs nothing again. */
  readonly idempotencyKey: string;
};

export type ApprovedOutcome =
  | { readonly status: "DONE" | "FAILED"; readonly repeated: boolean }
  | {
      readonly status: "REFUSED";
      readonly reason:
        | "NOT_APPROVAL_CLASS"
        | "NO_APPROVAL"
        | "PAYLOAD_CHANGED"
        | "NOTHING_PREPARED"
        | "WRONG_ACTION";
    };

/** Idempotency: what each key's execution came to (this tab). */
const executed = new Map<string, Promise<"DONE" | "FAILED">>();

/**
 * Runs an APPROVAL action, only with a bound approval of the payload it
 * would carry now. A payload edited after approval needs approving again;
 * a key already used returns its first outcome and runs nothing.
 */
export async function executeApproved(
  action: ApprovalAction,
  declared: ApprovalClass | undefined,
  approval: BoundApproval | null,
): Promise<ApprovedOutcome> {
  if (declared !== "APPROVAL") {
    return { status: "REFUSED", reason: "NOT_APPROVAL_CLASS" };
  }
  if (approval === null) return { status: "REFUSED", reason: "NO_APPROVAL" };
  if (approval.actionId !== action.id) {
    return { status: "REFUSED", reason: "WRONG_ACTION" };
  }
  const previous = executed.get(approval.idempotencyKey);
  if (previous !== undefined) {
    return { status: await previous, repeated: true };
  }
  const payload = action.prepare();
  if (payload === null)
    return { status: "REFUSED", reason: "NOTHING_PREPARED" };
  if (bindingOf(payload) !== approval.binding) {
    return { status: "REFUSED", reason: "PAYLOAD_CHANGED" };
  }
  const running = action
    .execute(payload, approval.idempotencyKey)
    .catch(() => "FAILED" as const);
  executed.set(approval.idempotencyKey, running);
  return { status: await running, repeated: false };
}

/** Clears the idempotency ledger and prompts (tests). */
export function resetApprovals(): void {
  executed.clear();
  publishConfirms([]);
}
