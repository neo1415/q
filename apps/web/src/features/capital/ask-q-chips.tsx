"use client";

import { useGlobalQ } from "@/components/app-shell/global-q";

/**
 * One-tap asks to Q (founder direction 2026-09-29: states and actions, not
 * explanations). Each opens Q with the question; nothing here acts itself.
 */
export function AskQChips({
  asks,
}: {
  readonly asks: readonly { readonly label: string; readonly prompt: string }[];
}) {
  const { askNow } = useGlobalQ();
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Ask Q">
      {asks.map((ask) => (
        <li key={ask.label}>
          <button
            type="button"
            onClick={() => askNow(ask.prompt)}
            className="cq-body-sm inline-flex min-h-11 items-center rounded-full border border-(--cq-border-subtle) bg-(--cq-surface) px-4 text-(--cq-text-primary) hover:bg-(--cq-surface-raised) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
          >
            {ask.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
