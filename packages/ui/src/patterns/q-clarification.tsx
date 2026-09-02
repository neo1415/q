import type { ReactNode } from "react";

import { cx } from "../primitives/class-names.js";
import { QMark } from "./q-mark.js";

/**
 * A single material clarification from Q: what was noticed, why it matters,
 * and the founder's answer below. Calm "needs clarification" framing, never
 * an accusation, and never a transcript -- one question at a time.
 */
export type ClarificationPromptProps = {
  readonly observation: string;
  readonly question: string;
  readonly why?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
};

export function ClarificationPrompt({
  observation,
  question,
  why,
  children,
  className,
}: ClarificationPromptProps) {
  return (
    <div className={cx("flex flex-col gap-5", className)}>
      <div className="flex items-start gap-3">
        <QMark size="md" state="NEEDS_INPUT" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="cq-label text-(--cq-text-secondary)">
            Needs clarification
          </p>
          <p className="cq-body text-(--cq-text-primary)">{observation}</p>
          <p className="cq-title-md text-(--cq-text-primary)">{question}</p>
          {why !== undefined ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">{why}</p>
          ) : null}
        </div>
      </div>
      <div className="pl-0 sm:pl-11">{children}</div>
    </div>
  );
}
