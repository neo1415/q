import type { ReactNode } from "react";

import { Button } from "../components/button.js";
import { cx } from "../primitives/class-names.js";
import { QMark } from "./q-mark.js";

/**
 * "Q suggests …" with Use / Dismiss. A suggestion is an offer, not a fact:
 * nothing becomes true until the founder uses it. Callers only render this
 * with a real suggestion source (or, in development, a clearly synthetic one).
 */
export type QSuggestionProps = {
  readonly title?: string | undefined;
  readonly children: ReactNode;
  readonly onUse: () => void;
  readonly onDismiss: () => void;
  readonly useLabel?: string | undefined;
  readonly className?: string | undefined;
};

export function QSuggestion({
  title = "Q suggests",
  children,
  onUse,
  onDismiss,
  useLabel = "Use",
  className,
}: QSuggestionProps) {
  return (
    <div
      role="group"
      aria-label={title}
      className={cx(
        "flex flex-col gap-3 rounded-lg border border-(--cq-accent-soft) bg-(--cq-surface-raised) p-3",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <QMark size="sm" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="cq-label text-(--cq-text-secondary)">{title}</p>
          <div className="cq-body text-(--cq-text-primary)">{children}</div>
        </div>
      </div>
      <div className="flex gap-2 pl-9">
        <Button variant="primary" size="compact" onClick={onUse}>
          {useLabel}
        </Button>
        <Button variant="quiet" size="compact" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
