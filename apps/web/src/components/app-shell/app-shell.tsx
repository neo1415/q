import type { ReactNode } from "react";

import type { ContextScope } from "@capital-q/ui/tokens";

import { AppHeader } from "./app-header";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileNavigation } from "./mobile-navigation";
import { NetworkStatus } from "./network-status";

/**
 * The workspace cue the shell shows: which organisation context this person
 * is acting in, resolved on the server. `unset` is an honest answer for a
 * person with no company and no investor organisation yet; the shell never
 * invents one (CQ-PRE-REC-001 §12).
 */
export type ShellContext = {
  readonly scope: ContextScope;
  readonly label?: string | undefined;
};

const UNSET: ShellContext = { scope: "unset" };

/**
 * The application shell. Server-rendered structure; only the pieces that
 * need the browser (current route, network state) are client components.
 *
 * Mobile: header → main → bottom navigation. Desktop: sidebar + workspace.
 * `main` carries the id the skip link targets.
 */
export function AppShell({
  children,
  context = UNSET,
}: {
  readonly children: ReactNode;
  readonly context?: ShellContext | undefined;
}) {
  return (
    <div className="cq-shell">
      <a
        href="#main"
        className="sr-only z-(--cq-z-toast) rounded-md bg-(--cq-surface-raised) px-4 py-3 cq-body-sm font-medium text-(--cq-text-primary) shadow-(--cq-shadow-overlay) focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <DesktopSidebar context={context} />
      <div className="cq-shell-body">
        <AppHeader context={context} />
        <NetworkStatus />
        <main id="main" className="cq-shell-main">
          {children}
        </main>
        <MobileNavigation />
      </div>
    </div>
  );
}
