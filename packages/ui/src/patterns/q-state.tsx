import { cx } from "../primitives/class-names.js";
import type { QState } from "../tokens/index.js";
import { QMark } from "./q-mark.js";

/**
 * Q state indicator (doc 18 §§34–41). Presentation for the seven visual
 * states; the runtime that drives them does not exist yet and nothing here
 * pretends otherwise. The label is the meaning; motion (working dots) is
 * decoration that disappears under reduced motion.
 *
 * Working stages are approved high-level text supplied by the caller --
 * never internal reasoning, never specialist names.
 */

const stateLabel: Record<QState, string> = {
  IDLE: "Q is ready",
  LISTENING: "Listening",
  WORKING: "Working",
  NEEDS_INPUT: "Q needs your input",
  NEEDS_APPROVAL: "Ready for your approval",
  COMPLETE: "Complete",
  ERROR: "Q couldn't finish",
};

export type QStateIndicatorProps = {
  readonly state: QState;
  /** Optional approved stage text, e.g. "Reviewing evidence". */
  readonly detail?: string | undefined;
  readonly className?: string | undefined;
};

export function QStateIndicator({
  state,
  detail,
  className,
}: QStateIndicatorProps) {
  return (
    <div
      role="status"
      data-q-state={state}
      className={cx("flex items-center gap-3", className)}
    >
      <QMark size="sm" state={state} />
      <div className="flex min-w-0 flex-col">
        <span className="cq-label text-(--cq-text-primary)">
          {stateLabel[state]}
          {state === "WORKING" ? (
            <span
              aria-hidden="true"
              className="ml-1 inline-flex gap-0.5 align-middle"
            >
              <span className="cq-working-dot">·</span>
              <span className="cq-working-dot">·</span>
              <span className="cq-working-dot">·</span>
            </span>
          ) : null}
        </span>
        {detail !== undefined ? (
          <span className="cq-caption text-(--cq-text-secondary)">
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function qStateLabel(state: QState): string {
  return stateLabel[state];
}
