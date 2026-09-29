import Link from "next/link";

import { ContextIndicator } from "@capital-q/ui/context-indicator";

import { ThemeMenu } from "@/features/appearance/theme-menu";

import { AccountMenu } from "./account-menu";
import type { ShellContext } from "./app-shell";

/**
 * Compact mobile top bar: wordmark, the current context (the scope, never
 * inside the input), the theme as one icon and the account menu. Q is the floating dock on a phone
 * (ADR 0017 F1), not a header button. Hidden on desktop.
 */
export function AppHeader({ context }: { readonly context: ShellContext }) {
  return (
    <header className="cq-shell-header">
      <div className="flex h-(--cq-header-height) items-center justify-between gap-3 px-4">
        <Link
          href="/home"
          className="cq-title-md shrink-0 rounded-xs whitespace-nowrap text-(--cq-text-primary)"
        >
          Capital Q
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <ContextIndicator
            scope={context.scope}
            detail={context.label}
            compact
          />
          <ThemeMenu align="end" />
          <AccountMenu
            founder={context.scope === "founder_private"}
            investor={context.scope === "investor_private"}
          />
        </div>
      </div>
    </header>
  );
}
