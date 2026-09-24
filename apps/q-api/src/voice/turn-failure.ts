import { isModelGatewayError } from "@capital-q/model-gateway";
import {
  clearFailure,
  EMPTY_FAILURES,
  isExhausted,
  noteFailure,
  shouldNotify,
  subsystemNotice,
  type FailureLedger,
  type FailureOperation,
} from "@capital-q/q-core";

/**
 * What Q says when a whole spoken turn threw (CQ-QX-005 §6, §7, §8).
 *
 * "I couldn't take that just now. Could you say it again?" was the one
 * line for every failure of every kind, said the same way every time.
 * Hosted, a Q runtime that could not start a run turned every question
 * the person asked into that sentence — and the sentence blamed their
 * words for a fault that was Q's, so they said it again, and it failed
 * again.
 *
 * A thrown turn is Q's side failing, and the line says which side: a
 * reasoning failure is named as reasoning, anything else as a step that
 * did not go through — never as hearing. The count lives in the
 * conversation core's failure ledger, per line and per subsystem, so the
 * first failure and the one that stops the retries are said, the ones in
 * between are short and alternate, and no two consecutive failures
 * produce the same sentence. Nothing here retries anything.
 */
// Keyed by the spoken line (its session binding), held only while it lives.
const ledgers = new WeakMap<object, FailureLedger>();
const lastLine = new WeakMap<object, string>();

/** Which subsystem a thrown turn failed in, from the error's own type. */
export function failedOperation(error: unknown): FailureOperation {
  return isModelGatewayError(error) ? "MODEL" : "TOOL";
}

export function turnFailureLine(binding: object, error: unknown): string {
  const operation = failedOperation(error);
  const ledger = noteFailure(ledgers.get(binding) ?? EMPTY_FAILURES, operation);
  ledgers.set(binding, ledger);
  const candidates = shouldNotify(ledger, operation)
    ? [subsystemNotice(operation, isExhausted(ledger, operation))]
    : [];
  candidates.push(
    operation === "MODEL"
      ? "Still nothing from my reasoning service. What you've told me so far is safe."
      : "That still isn't going through on my side. What you've told me so far is safe.",
    "Still failing on my side, I'm afraid. If it keeps up, tapping Type will get us through.",
  );
  const previous = lastLine.get(binding);
  const line =
    candidates.find((candidate) => candidate !== previous) ??
    candidates[0] ??
    "";
  lastLine.set(binding, line);
  return line;
}

/** A turn that worked clears the ledger: the next failure is a first again. */
export function turnSucceeded(binding: object): void {
  const ledger = ledgers.get(binding);
  if (ledger === undefined) return;
  ledgers.set(binding, clearFailure(clearFailure(ledger, "MODEL"), "TOOL"));
  lastLine.delete(binding);
}
