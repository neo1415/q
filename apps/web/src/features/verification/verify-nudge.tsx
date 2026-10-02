import Link from "next/link";

import { ICON_SIZE, ICON_STROKE, ShieldCheck } from "@capital-q/ui/icons";

import { VERIFY_NUDGE_WORDS, type VerifyNudge } from "./verify-state";

/**
 * The shell's quiet "Verify you and <organisation>" item (founder direction
 * 2026-10-02): one line and its state in words, linking to the one
 * verification flow. Rendered only while a claim is not VERIFIED; the
 * caller passes null once both are, and it is gone.
 */
export function VerifyNudgeLink({
  nudge,
  onNavigate,
}: {
  readonly nudge: VerifyNudge;
  readonly onNavigate?: (() => void) | undefined;
}) {
  return (
    <Link
      href="/verification"
      {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
      data-verify-nudge={nudge.state}
      className="flex min-h-11 min-w-0 items-center gap-2 rounded-md px-3 py-1.5 transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle)"
    >
      <ShieldCheck
        aria-hidden="true"
        size={ICON_SIZE.regular}
        strokeWidth={ICON_STROKE}
        className="shrink-0 text-(--cq-text-secondary)"
      />
      <span className="flex min-w-0 flex-col">
        <span className="cq-body-sm truncate text-(--cq-text-primary)">
          {nudge.title}
        </span>
        <span className="cq-caption truncate text-(--cq-text-secondary)">
          {VERIFY_NUDGE_WORDS[nudge.state]}
        </span>
      </span>
    </Link>
  );
}
