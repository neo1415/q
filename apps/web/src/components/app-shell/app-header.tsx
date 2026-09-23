import Link from "next/link";

import { ContextIndicator } from "@capital-q/ui/context-indicator";

import type { ShellContext } from "./app-shell";
import { GlobalQTrigger } from "./global-q";

/**
 * Compact mobile top bar: wordmark and the current context. Hidden on
 * desktop, where the sidebar carries both.
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
          <ContextIndicator scope={context.scope} detail={context.label} />
          <GlobalQTrigger variant="header" />
        </div>
      </div>
    </header>
  );
}
