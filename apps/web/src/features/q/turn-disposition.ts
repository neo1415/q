import type {
  QFailureClass,
  QPublicFailureCode,
  QTurnDisposition,
} from "@capital-q/contracts";

import type { QTurn } from "./conversation";

/**
 * How each rendered turn ended (RECOVERY-2026-10 G-R3; SPEC §4.3: every
 * accepted turn reaches a terminal disposition, and nothing is silent).
 * The page shows it as data attributes on the turn's own element, so a
 * test (and a person's tooling) reads the same outcome the person sees.
 * Pure: the rules are tested.
 */

/** A settled Q answer's disposition; null while it is still streaming. */
export function dispositionOfTurn(
  turn: Extract<QTurn, { kind: "Q" }>,
): QTurnDisposition | null {
  if (turn.streaming) return null;
  if (turn.blocks.some((block) => block.kind === "CLARIFICATION_REQUEST")) {
    return "CLARIFIED";
  }
  // Something done on screen or filed, with no words of an answer.
  const acted = turn.blocks.some(
    (block) =>
      block.kind === "UI_INTENT" ||
      block.kind === "ARTIFACT_REFERENCE" ||
      block.kind === "ACTION_PROPOSAL",
  );
  if (acted && turn.text.trim().length === 0) return "ACTED";
  return "ANSWERED";
}

const FAILURE_CLASS: Readonly<
  Record<QPublicFailureCode, QFailureClass | null>
> = {
  REQUEST_INVALID: "MODEL_REASONING",
  NOT_AVAILABLE_IN_CONTEXT: "PERMISSION_DENIED",
  Q_TIMEOUT: "TIMEOUT",
  Q_UNAVAILABLE: "NETWORK",
  EVIDENCE_UNAVAILABLE: "TOOL_UNAVAILABLE",
  ACTION_EXPIRED: "NOT_CONFIRMED",
  CANCELLED: null,
  EXPIRED: "NOT_CONFIRMED",
  Q_FAILED: "MODEL_REASONING",
};

/** A typed run that ended without an answer: its disposition and class. */
export function dispositionOfFailure(code: QPublicFailureCode): {
  readonly disposition: QTurnDisposition;
  readonly failure: QFailureClass | null;
} {
  if (code === "CANCELLED") return { disposition: "CANCELLED", failure: null };
  return { disposition: "FAILED", failure: FAILURE_CLASS[code] };
}

/** What a voice turn that got no answer looks like in the thread. */
export function outcomeWords(input: {
  readonly disposition: QTurnDisposition;
  readonly notice?: string | undefined;
}): string {
  if (input.notice !== undefined && input.notice.trim().length > 0) {
    return input.notice;
  }
  switch (input.disposition) {
    case "IGNORED":
      return "Q heard that but didn't take it as something to answer. Say it again if you meant Q.";
    case "CANCELLED":
      return "Stopped.";
    case "SUPERSEDED":
      return "Q moved on to what you said next.";
    case "FAILED":
      return "Q couldn't finish that one. Try again.";
    case "ANSWERED":
    case "CLARIFIED":
    case "ACTED":
      return "";
  }
}
